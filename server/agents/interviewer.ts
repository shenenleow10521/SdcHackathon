// Interviewer agent (OWNER: intake agent). After a CV is read, asks at most 3 short questions, only where the CV
// was unclear: skills the CV extractor was not sure about, likely skills it could not place, and weekly hours if
// they weren't given. Questions use fixed templates (EN/BM), so they are predictable and testable.
// Question ids say what they change: "skill:<skillId>" (answer = level 0-5) or "hours" (answer = hours a week).
// Answers are the user's own rating: confidence becomes 'self'.
import type { Services } from "../context.ts";
import type { Draft } from "./cv.ts";
import { HttpError, badRequest } from "../lib/http.ts";
import { loadProfile, audit, type Profile } from "../repo.ts";

export const MAX_QUESTIONS = 3;
export const HOURS_OPTIONS = [2, 4, 6, 8, 10, 15, 20];

export interface Question { id: string; text: string; skillId?: string; field?: string; options: { value: number; label: string }[] }
type Lang = "en" | "ms";

const LEVELS: Record<Lang, string[]> = {
  en: ["0 · Not yet", "1 · Beginner: done it with help", "2 · Basic: done it a few times", "3 · Working: do it regularly on my own",
       "4 · Strong: handle complex cases", "5 · Expert: lead or teach others"],
  ms: ["0 · Belum pernah", "1 · Permulaan: pernah buat dengan bantuan", "2 · Asas: pernah buat beberapa kali", "3 · Biasa: buat sendiri secara kerap",
       "4 · Mahir: urus kes yang rumit", "5 · Pakar: memimpin atau mengajar orang lain"],
};
const T = {
  confirm: { en: (l: string) => `Your CV suggests you know "${l}". How would you rate yourself?`,
             ms: (l: string) => `CV anda menunjukkan anda tahu "${l}". Bagaimana anda menilai diri sendiri?` },
  gap: { en: (l: string, task: string) => `Have you done "${l}"${task ? ` (for example: ${task})` : ""}? If so, how well?`,
         ms: (l: string, task: string) => `Pernahkah anda buat "${l}"${task ? ` (contohnya: ${task})` : ""}? Jika ya, setakat mana?` },
  hours: { en: "How many hours a week can you spend learning?", ms: "Berapa jam seminggu anda boleh luangkan untuk belajar?" },
};

// "Check AI-captured fields" -> "check AI-captured fields" (keeps acronyms like "AI" or "PO").
const lowerFirst = (t: string) => (/^[A-Z][A-Z]/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1));
const levelOptions = (lang: Lang) => LEVELS[lang].map((label, value) => ({ value, label }));

/**
 * Picks up to 3 questions, in priority order:
 *   1. weekly hours, if not given (needed for every time estimate);
 *   2. skills found in the CV that the extractor was not sure about;
 *   3. skills the user's current job needs but the CV doesn't mention, then near-misses from matching.
 */
export async function buildQuestions(svc: Services, draft: Draft, opts: { hoursGiven: boolean; lang?: Lang }): Promise<Question[]> {
  const lang: Lang = opts.lang === "ms" ? "ms" : "en";
  const qs: Question[] = [];
  if (!opts.hoursGiven)
    qs.push({ id: "hours", field: "hours", text: T.hours[lang], options: HOURS_OPTIONS.map(h => ({ value: h, label: lang === "ms" ? `${h} jam` : `${h} hours` })) });

  // Unsure skills, highest level first (those matter most to the routes).
  for (const s of [...draft.skills].filter(s => !s.sure).sort((a, b) => b.level - a.level)) {
    if (qs.length >= MAX_QUESTIONS) return qs;
    qs.push({ id: `skill:${s.skillId}`, skillId: s.skillId, text: T.confirm[lang](s.label), options: levelOptions(lang) });
  }

  // Gaps: requirements of the current occupation (by weight), then near-misses.
  const have = new Set(draft.skills.map(s => s.skillId));
  const req = (await svc.db.query("select skill_id from occupation_skills where occupation_id=$1 order by weight desc, skill_id", [draft.occupation.id])).rows.map((r: any) => r.skill_id as string);
  const gapIds = [...new Set([...req, ...draft.nearMisses])].filter(id => !have.has(id));
  if (!gapIds.length || qs.length >= MAX_QUESTIONS) return qs.slice(0, MAX_QUESTIONS);
  const info = (await svc.db.query(
    `select s.id, s.label, (select t.text from tasks t where t.skill_id = s.id order by t.id limit 1) as task
     from skills s where s.id in (${gapIds.map((_, i) => `$${i + 1}`).join(",")})`, gapIds)).rows as any[];
  const byId = new Map(info.map(r => [r.id, r]));
  for (const id of gapIds) {
    if (qs.length >= MAX_QUESTIONS) break;
    const r = byId.get(id);
    if (!r) continue;
    // Task texts are written in English in the knowledge base, so they are only used as examples in English.
    qs.push({ id: `skill:${id}`, skillId: id, text: T.gap[lang](r.label, lang === "en" && r.task ? lowerFirst(String(r.task)) : ""), options: levelOptions(lang) });
  }
  return qs;
}

/** Applies interviewer answers: { "skill:<id>": 0-5, "hours": 1-40 }. Level 0 removes the skill. */
export async function applyAnswers(svc: Services, profileId: number, answers: Record<string, unknown>, actor = "user"): Promise<Profile> {
  if (!(await loadProfile(svc.db, profileId))) throw new HttpError(404, "not_found", "Profile not found");
  const entries = Object.entries(answers);
  if (!entries.length) throw badRequest("No answers given");
  if (entries.length > 50) throw badRequest("Too many answers");

  // Validate everything first, so a bad answer changes nothing.
  const skillIds = new Set((await svc.db.query("select id from skills")).rows.map((r: any) => r.id as string));
  const changes: ({ kind: "hours"; hours: number } | { kind: "skill"; skillId: string; level: number })[] = [];
  const problems: { path: string; message: string }[] = [];
  for (const [qid, raw] of entries) {
    const v = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
    if (qid === "hours") {
      if (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 40) changes.push({ kind: "hours", hours: v as number });
      else problems.push({ path: `answers.${qid}`, message: "Hours must be a whole number from 1 to 40" });
    } else if (qid.startsWith("skill:")) {
      const id = qid.slice(6);
      if (!skillIds.has(id)) problems.push({ path: `answers.${qid}`, message: "Unknown skill" });
      else if (!(Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 5)) problems.push({ path: `answers.${qid}`, message: "Level must be a whole number from 0 to 5" });
      else changes.push({ kind: "skill", skillId: id, level: v as number });
    } else problems.push({ path: `answers.${qid}`, message: "Unknown question" });
  }
  if (problems.length) throw badRequest("Invalid answers", problems);

  await svc.db.tx(async t => {
    for (const c of changes) {
      if (c.kind === "hours") await t.query("update profiles set hours_per_week=$2 where id=$1", [profileId, c.hours]);
      else if (c.level === 0) await t.query("delete from profile_skills where profile_id=$1 and skill_id=$2", [profileId, c.skillId]);
      else await t.query(`insert into profile_skills(profile_id, skill_id, level, confidence) values ($1,$2,$3,'self')
                          on conflict (profile_id, skill_id) do update set level=excluded.level, confidence='self'`, [profileId, c.skillId, c.level]);
    }
  });
  await audit(svc.db, actor, "profile.answers", String(profileId), { answered: changes.length });
  return (await loadProfile(svc.db, profileId))!;
}
