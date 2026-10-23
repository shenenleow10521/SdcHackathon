// "Prove" checks (OWNER: intake agent): short multiple-choice checks that move a skill to confidence 'verified'.
// Questions are built only from our database, not written by an AI model:
//   - one question per task of the skill: "who does this task today?" (answer key = the task's mode: ai / assist / human)
//   - one question: "which of these tasks is part of <skill>?" (answer = one of its tasks; the others are tasks of
//     unrelated skills)
// The answer key is stored server-side (skill_checks) and never sent to the browser. A check can be submitted once.
// Pass mark: 70%. Task modes are sample values from the prototype until real data is loaded, so the response says so.
import { randomUUID, randomInt } from "node:crypto";
import type { Services } from "../context.ts";
import { HttpError, notFound } from "../lib/http.ts";
import { loadProfile, audit, type Profile } from "../repo.ts";

export const PASS_MARK = 0.7;
const EXPIRES_MS = 2 * 60 * 60 * 1000; // 2 hours to answer
const MODE_OPTIONS = ["AI can do it on its own", "AI helps, but a person does it", "It still needs a person"];
const MODE_INDEX: Record<string, number> = { ai: 0, assist: 1, human: 2 };

export interface CheckQuestion { id: string; text: string; options: string[] }

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export async function createCheck(svc: Services, profileId: number, skillId: string) {
  if (!(await loadProfile(svc.db, profileId))) throw notFound("Profile");
  const skill = (await svc.db.query("select id, label, source from skills where id=$1", [skillId])).rows[0] as any;
  if (!skill) throw notFound("Skill");
  const tasks = (await svc.db.query("select text, mode, source from tasks where skill_id=$1 order by id", [skillId])).rows as any[];
  if (tasks.length < 2) throw new HttpError(404, "no_check", "There is no check for this skill yet");

  const questions: CheckQuestion[] = [];
  const key: Record<string, number> = {};
  for (const t of tasks.slice(0, 4)) {
    if (!(t.mode in MODE_INDEX)) continue;
    const id = `q${questions.length + 1}`;
    questions.push({ id, text: `In "${skill.label}", who does this task today: "${t.text}"?`, options: MODE_OPTIONS });
    key[id] = MODE_INDEX[t.mode];
  }

  // Distractors: tasks from skills with no direct link (edge) to this one, so the right answer is clear.
  const others = (await svc.db.query(
    `select t.text from tasks t where t.skill_id <> $1
       and t.skill_id not in (select to_id from edges where from_id=$1 union select from_id from edges where to_id=$1)`, [skillId])).rows as any[];
  if (others.length >= 3) {
    const right = tasks[randomInt(tasks.length)].text as string;
    const wrong = shuffle(others.map(o => o.text as string).filter(x => x !== right)).slice(0, 3);
    const options = shuffle([right, ...wrong]);
    const id = `q${questions.length + 1}`;
    questions.push({ id, text: `Which of these tasks is part of "${skill.label}"?`, options });
    key[id] = options.indexOf(right);
  }

  const course = (await svc.db.query("select title, prove_check, source from courses where skill_id=$1 and prove_check is not null order by id limit 1", [skillId])).rows[0] as any;
  const checkId = randomUUID();
  await svc.db.query(
    "insert into skill_checks(id, profile_id, skill_id, questions, answer_key, created_at) values ($1,$2,$3,$4,$5,$6)",
    [checkId, profileId, skillId, JSON.stringify(questions), JSON.stringify(key), svc.now().toISOString()]);
  return {
    checkId, skillId, label: skill.label, questions, passMark: PASS_MARK,
    basis: "Built from the task list for this skill in our knowledge base" + (tasks.some(t => t.source === "sample") ? " (sample values)." : "."),
    isSample: tasks.some(t => t.source === "sample"),
    // The fuller, practical check from the course (done with an advisor or the course provider), if there is one.
    proveNext: course ? { course: course.title, check: course.prove_check, source: course.source } : null,
  };
}

export async function submitCheck(svc: Services, skillId: string, input: { profileId: number; checkId: string; answers: Record<string, number> }):
  Promise<{ passed: boolean; score: number; total: number; confidence: string | null; saved: boolean; profile: Profile }> {
  const c = (await svc.db.query("select * from skill_checks where id=$1", [input.checkId])).rows[0] as any;
  if (!c || c.skill_id !== skillId || c.profile_id !== input.profileId) throw notFound("Check");
  if (c.completed_at) throw new HttpError(409, "check_used", "This check was already submitted. Start a new one.");
  if (svc.now().getTime() - new Date(c.created_at).getTime() > EXPIRES_MS) throw new HttpError(410, "check_expired", "This check has expired. Start a new one.");

  const key: Record<string, number> = typeof c.answer_key === "string" ? JSON.parse(c.answer_key) : c.answer_key;
  const total = Object.keys(key).length;
  const score = Object.entries(key).filter(([qid, right]) => input.answers[qid] === right).length;
  const passed = total > 0 && score / total >= PASS_MARK;

  // The shared sample persona is read-only: the check is scored, but the profile isn't changed.
  const isDemo = !!(await loadProfile(svc.db, input.profileId))?.isDemo;
  await svc.db.tx(async t => {
    await t.query("update skill_checks set completed_at=$2, score=$3, total=$4, passed=$5 where id=$1", [c.id, svc.now().toISOString(), score, total, passed]);
    // A pass verifies the skill at the level the user already has (at least 1). A fail changes nothing.
    if (passed && !isDemo)
      await t.query(`insert into profile_skills(profile_id, skill_id, level, confidence, evidence) values ($1,$2,1,'verified','Passed the HalaTuju check')
                     on conflict (profile_id, skill_id) do update set confidence='verified'`, [input.profileId, skillId]);
  });
  await audit(svc.db, "user", "skill.check", `${input.profileId}:${skillId}`, { score, total, passed });
  const profile = (await loadProfile(svc.db, input.profileId))!;
  const current = profile.skills.find(s => s.skillId === skillId)?.confidence ?? null;
  return { passed, score, total, confidence: passed && isDemo ? "verified" : current, saved: !isDemo, profile };
}
