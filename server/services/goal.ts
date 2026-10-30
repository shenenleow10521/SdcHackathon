// Goal progress (docs/API.md "Goal progress"): the one job a person commits to, its steps (every skill the plan still
// needs, plus the steps already ticked), who vouches for each skill, weekly study check-ins and an on-track status.
// Every number here is computed in code from the plan (server/services/planning.ts) and the database: no AI model.
//
// Steps    = the goal plan's `missing` list (catalogue or ESCO plan, same code as GET /plan), in plan order, then the
//            ticked steps that have left that list because the tick raised the skill. Ticking a step raises the profile:
//              catalogue skill  -> its level becomes the level the job needs (levelTo for a level-up, else the job's
//                                  requirement, else HAVE_LEVEL), never lower than it was
//              ESCO skill       -> added to the person's ESCO skills (profile_esco_skills, source 'self')
//              AI-era skill     -> its catalogue twin (prompt, aisup) raised to HAVE_LEVEL; without a twin, nothing changes
//            Unticking undoes exactly what the tick changed (if nothing else changed that skill since).
// Proofs   = per skill (skill_proofs): 'check' (passed the HalaTuju skill check) and 'advisor' (an advisor confirmed it)
//            count as verified; 'credential' (a link the person added) is shown but never counts as verified.
// Pace     = expected hours = hours per week x days since the goal was set / 7; studied = check-in hours from the week
//            the goal was set onwards. More than GOAL_PACE.toleranceWeeks of study hours over -> "ahead", under -> "behind".
// Practise = up to 2 real O*NET task statements linked to the step's skill in db/seed/quiz_tasks.json (bge-m3 links
//            built by scripts/build-quiz.ts; never the LLM-written chip text), only from work like the goal job's
//            (see PRACTISE below).
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { displayWeeks, PARAMS, HAVE_LEVEL } from "../../shared/engine.js";
import type { Services } from "../context.ts";
import type { Db } from "../lib/db.ts";
import { projectRoot } from "../lib/db.ts";
import type { FullGraph } from "../kb.ts";
import { loadProfile, setSkillLevels, type Profile } from "../repo.ts";
import { buildJobPlan } from "./planning.ts";
import { escoJobId } from "./esco-plan.ts";
import { loadEsco } from "./esco.ts";
import { aiSkill, isAiNode } from "./ai-skills.ts";
import { loadTaskLinks } from "./quiz.ts";
import { skillOutlook } from "./outlook.ts";
import { nextJobs } from "./esco-network.ts";

export const GOAL_PACE = {
  toleranceWeeks: 1,   // ahead / behind only when studied hours differ from expected by more than one week of study
  practiseMax: 2,      // O*NET task statements per step
};
export const CHECK_BY = "HalaTuju skill check";

const DAY_MS = 86_400_000;
const r1 = (x: number) => Math.round(10 * x) / 10;
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const toDay = (v: any) => (v == null ? null : typeof v === "string" ? v.slice(0, 10) : isoDay(new Date(v)));
const toIso = (v: any) => (v == null ? null : new Date(v).toISOString());

/** The Monday (UTC) of the week a day falls in. */
export function weekStartOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return isoDay(new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY_MS));
}

export interface CheckIn { weekStart: string; hours: number }
export type PaceStatus = "ahead" | "on_track" | "behind";

/** On-track maths (see the header). */
export function paceOf(o: { setAt: string; today: string; hoursPerWeek: number; checkIns: CheckIn[] }) {
  const daysElapsed = Math.max(0, Math.round((Date.parse(o.today) - Date.parse(o.setAt)) / DAY_MS));
  const from = weekStartOf(o.setAt);
  const counted = o.checkIns.filter(c => c.weekStart >= from && c.weekStart <= o.today);
  const studied = counted.reduce((s, c) => s + c.hours, 0);
  const expected = (o.hoursPerWeek * daysElapsed) / 7;
  const tolerance = o.hoursPerWeek * GOAL_PACE.toleranceWeeks;
  const diff = studied - expected;
  const status: PaceStatus = diff > tolerance ? "ahead" : diff < -tolerance ? "behind" : "on_track";
  const last = [...o.checkIns].sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0] ?? null;
  return {
    status, setAt: o.setAt, today: o.today, daysElapsed, weeksElapsed: r1(daysElapsed / 7), hoursPerWeek: o.hoursPerWeek,
    expectedHours: r1(expected), studiedHours: r1(studied), differenceHours: r1(diff), toleranceHours: tolerance,
    checkInsCounted: counted.length, lastCheckIn: last,
  };
}

// ---------- goal rows ----------
export interface Goal { job: string; mode: "closest" | "safest"; setAt: string }

export async function loadGoal(db: Db, profileId: number): Promise<Goal | null> {
  const r = (await db.query("select job, mode, set_at from goals where profile_id=$1", [profileId])).rows[0] as any;
  return r ? { job: r.job, mode: r.mode, setAt: toDay(r.set_at)! } : null;
}

/** A goal job as stored: a catalogue job id, or "esco:<uuid>" for any ESCO occupation; null if unknown. */
export function goalJobId(graph: FullGraph, job: string): string | null {
  if (graph.nodes[job]?.type === "job") return job;
  const esco = escoJobId(job);
  return esco ? `esco:${esco}` : null;
}

export async function escoSkillsOf(db: Db, profileId: number) {
  return new Set((await db.query<{ skill_id: string }>("select skill_id from profile_esco_skills where profile_id=$1", [profileId])).rows.map(r => r.skill_id));
}

export interface PlanOpts { year: number; scenario: "moderate" | "fast" }

/** The goal job's plan, by the same code as GET /plan. */
export async function goalPlan(svc: Services, graph: FullGraph, p: Profile, g: Goal, o: PlanOpts) {
  const esco = graph.nodes[g.job]?.type === "job" ? null : escoJobId(g.job);
  return buildJobPlan(graph, p, { job: g.job, mode: g.mode, year: o.year, scenario: o.scenario, now: svc.now(),
    escoSkills: esco ? await escoSkillsOf(svc.db, p.id) : undefined });
}
export type GoalPlan = Awaited<ReturnType<typeof goalPlan>>;
/** Match % and weeks to job-ready at the person's hours: what "Match 48% → 56%, 8 weeks left" shows. */
export const planNumbers = (plan: GoalPlan) => ({ match: plan.match as number, weeks: ((plan as any).weeksReady ?? plan.weeks ?? null) as number | null });

export function skillName(graph: FullGraph, id: string): string {
  return graph.nodes[id]?.name ?? loadEsco()?.skills[id]?.title ?? (isAiNode(id) ? aiSkill(id)?.label : null) ?? id;
}
export const isKnownSkill = (graph: FullGraph, id: string) => graph.nodes[id]?.type === "skill" || !!loadEsco()?.skills[id] || (isAiNode(id) && !!aiSkill(id));

// ---------- proofs ----------
export interface Proof { id: number; kind: "check" | "advisor" | "credential"; by: string; at: string; url: string | null; title: string | null }
export const isVerifiedProof = (p: Proof) => p.kind === "check" || p.kind === "advisor";

export async function proofsOf(db: Db, profileId: number): Promise<Map<string, Proof[]>> {
  const rows = (await db.query("select * from skill_proofs where profile_id=$1 order by at, id", [profileId])).rows as any[];
  const out = new Map<string, Proof[]>();
  for (const r of rows) {
    if (!out.has(r.skill_id)) out.set(r.skill_id, []);
    out.get(r.skill_id)!.push({ id: r.id, kind: r.kind, by: r.vouched_by, at: toIso(r.at)!, url: r.url, title: r.title });
  }
  return out;
}

export async function addProof(db: Db, profileId: number, skillId: string, p: { kind: Proof["kind"]; by: string; at: Date; url?: string; title?: string }) {
  await db.query("insert into skill_proofs(profile_id, skill_id, kind, vouched_by, at, url, title) values ($1,$2,$3,$4,$5,$6,$7)",
    [profileId, skillId, p.kind, p.by, p.at.toISOString(), p.url ?? null, p.title ?? null]);
}

export async function checkInsOf(db: Db, profileId: number): Promise<CheckIn[]> {
  return ((await db.query("select week_start, hours from goal_checkins where profile_id=$1 order by week_start", [profileId])).rows as any[])
    .map(r => ({ weekStart: toDay(r.week_start)!, hours: Number(r.hours) }));
}

// ---------- practise tasks ----------
// A task is shown only when it is clearly about the step's skill AND comes from work like the goal job's, so a finance
// analyst never sees a grinding-machine task and a bus driver never sees a flight attendant's:
//   link   the task's best ESCO link is this skill (db/seed/quiz_tasks.json lists up to 3 ESCO skills of the task's own
//          occupation by bge-m3 cosine, best first; PRACTISE.escoRank = 1 keeps only the best), or its catalogue link
//          is PRACTISE.catLink or more (the quiz's 0.68 bar let "Start machines, monitor operations" through for
//          "Supervising AI workflows" at 0.69);
//   near   the task's O*NET occupation is the goal job's own, or that of one of the goal job's PRACTISE.nearJobs closest
//          ESCO jobs (skill-overlap network, server/services/esco-network.ts). The O*NET minor group was too broad:
//          29-1 put audiologists' and optometrists' tasks on a nurse's steps.
// Measured with scripts/practise-report.ts on the sample persona's four catalogue goals and five varied ESCO jobs: 126
// tasks over 235 steps before (many off-topic), 23 after, each one a thing a person in that role does. No link that passes both bars:
// no task (an empty "Practise at work" beats a wrong one).
export const PRACTISE = { catLink: 0.7, escoRank: 1, nearJobs: 10 };

let practiseIx: { bySkill: Map<string, [string, number][]>; catToEsco: Map<string, string[]>; occOnet: Record<string, string>; occEsco: Record<string, string> } | null | undefined;
function practiseIndex() {
  if (practiseIx !== undefined) return practiseIx;
  const L = loadTaskLinks(), d = loadEsco();
  if (!L || !d) return (practiseIx = null);
  // skill -> [task id, link score]; ESCO links carry 1 (they passed the build's own bar)
  const bySkill = new Map<string, [string, number][]>();
  const add = (k: string, t: string, s: number) => { if (!bySkill.has(k)) bySkill.set(k, []); bySkill.get(k)!.push([t, s]); };
  for (const [tid, l] of Object.entries<{ esco?: string[]; cat?: [string, number][] }>(L.tasks)) {
    (l.esco || []).forEach((e, rank) => { if (rank < PRACTISE.escoRank) add(e, tid, 1); });
    for (const [c, cos] of l.cat || []) if (cos >= PRACTISE.catLink) add(c, tid, cos);
  }
  const catToEsco = new Map<string, string[]>();
  for (const [e, cats] of d.catalogueByEsco) for (const c of cats) catToEsco.set(c, [...(catToEsco.get(c) || []), e]);
  const f = path.join(projectRoot, "db", "seed", "esco_map.json");
  const occOnet: Record<string, string> = {}, occEsco: Record<string, string> = {};
  if (existsSync(f)) for (const [id, o] of Object.entries<any>(JSON.parse(readFileSync(f, "utf8")).occupations || {})) {
    if (o?.onet) occOnet[id] = o.onet;
    const u = /occupation\/([0-9a-f-]{36})$/.exec(o?.uri || "")?.[1];
    if (u && d.occupations[u]) occEsco[id] = u;
  }
  return (practiseIx = { bySkill, catToEsco, occOnet, occEsco });
}
/** For tests: forget the index. */
export function resetGoalCache() { practiseIx = undefined; nearCache.clear(); }

/** The O*NET occupation behind a goal job (ESCO crosswalk, or the catalogue job's mapping), to rank its own tasks first. */
export function goalOnet(job: string): string | null {
  const esco = escoJobId(job);
  if (esco) return loadEsco()?.onetLinks[esco]?.onet ?? null;
  return practiseIndex()?.occOnet[job] ?? null;
}

const nearCache = new Map<string, { onet: string | null; near: Set<string> }>();
/** The work like the goal job's (see "near" above): its O*NET code and the O*NET codes of its closest ESCO jobs. */
export function nearWork(job: string) {
  if (nearCache.has(job)) return nearCache.get(job)!;
  const d = loadEsco(), ix = practiseIndex();
  const esco = escoJobId(job) ?? ix?.occEsco[job] ?? null, onet = goalOnet(job);
  const near = new Set<string>();
  if (onet) near.add(onet);
  if (d && esco) for (const j of [esco, ...(nextJobs(esco, PRACTISE.nearJobs)?.jobs || []).map(x => x.id)]) {
    const o = d.onetLinks[j]?.onet;
    if (o) near.add(o);
  }
  const r = { onet, near };
  nearCache.set(job, r);
  return r;
}

export interface Practise { text: string; onet: string; occupation: string }
/** Up to GOAL_PACE.practiseMax real O*NET task statements that use this skill in work like the goal job's: the goal
 *  job's own tasks first, then core tasks, then the stronger link. None without a goal job. */
export function practiseFor(skillId: string, job: string | null): Practise[] {
  const ix = practiseIndex(), d = loadEsco();
  if (!ix || !d || !job) return [];
  const w = nearWork(job);
  if (!w.near.size) return [];
  const twin = isAiNode(skillId) ? aiSkill(skillId)?.catalogue ?? null : null;
  const keys = [skillId, ...(twin ? [twin] : [])];
  for (const k of [...keys]) keys.push(...(ix.catToEsco.get(k) || []));
  const seen = new Set<string>(), out: (Practise & { core: boolean; id: string; score: number })[] = [];
  for (const k of keys) for (const [tid, score] of ix.bySkill.get(k) || []) {
    if (seen.has(tid)) continue;
    seen.add(tid);
    const [onet, i] = tid.split("#");
    if (!w.near.has(onet)) continue;
    const occ = d.onetTasks[onet], t = occ?.tasks?.[Number(i)];
    if (!t) continue;
    out.push({ id: tid, text: t[0], onet, occupation: occ.title, core: t[2] === 1, score });
  }
  const texts = new Set<string>();
  return out.sort((a, b) => Number(b.onet === w.onet) - Number(a.onet === w.onet) || Number(b.core) - Number(a.core) || b.score - a.score || a.id.localeCompare(b.id))
    .filter(x => (texts.has(x.text) ? false : (texts.add(x.text), true)))
    .slice(0, GOAL_PACE.practiseMax).map(({ text, onet, occupation }) => ({ text, onet, occupation }));
}

// ---------- the goal view ----------
interface StepRow { skill_id: string; done: boolean; done_at: any; hours: number | null; raised_skill: string | null; level_before: number | null; level_set: number | null; esco_added: boolean }
const stepRows = (db: Db, profileId: number) => tickRows(db, "goal_steps", profileId);

/** Is this skill a step of the goal: still needed by the plan, or ticked already? */
export async function isStep(db: Db, profileId: number, plan: GoalPlan, skillId: string) {
  if ((plan.missing as any[]).some(m => m.id === skillId)) return true;
  return !!(await stepRows(db, profileId)).get(skillId)?.done;
}

/** The goal steps that a check or confirmation of `skillId` counts for: the step itself, or an ESCO / AI-era step whose
 *  catalogue equivalent it is. */
export function stepsMatching(plan: GoalPlan, done: Set<string>, skillId: string): string[] {
  const d = loadEsco();
  const ids = [...new Set([...(plan.missing as any[]).map(m => m.id as string), ...done])];
  return ids.filter(id => id === skillId || (d?.catalogueByEsco.get(id) || []).includes(skillId) || (isAiNode(id) && aiSkill(id)?.catalogue === skillId));
}

export async function goalView(svc: Services, graph: FullGraph, p: Profile, g: Goal, plan: GoalPlan) {
  const [rows, proofs, checkIns] = await Promise.all([stepRows(svc.db, p.id), proofsOf(svc.db, p.id), checkInsOf(svc.db, p.id)]);
  const hours = p.hours || PARAMS.referenceHours;
  const step = (id: string, base: { name: string; key: boolean; kind: string | null; type: string; hours: number | null; weeks: number | null }) => {
    const r = rows.get(id), pr = proofs.get(id) || [];
    return { skillId: id, ...base, done: !!r?.done, doneAt: r?.done ? toIso(r.done_at) : null,
      verified: pr.some(isVerifiedProof), proofs: pr, practise: practiseFor(id, g.job) };
  };
  const missing = plan.missing as any[];
  const inPlan = new Set(missing.map(m => m.id));
  const steps = [
    ...missing.map(m => step(m.id, { name: m.name, key: !!m.key, kind: m.kind ?? null, type: m.type ?? "skill", hours: m.hours, weeks: m.weeks })),
    ...[...rows.values()].filter(r => r.done && !inPlan.has(r.skill_id)).sort((a, b) => a.skill_id.localeCompare(b.skill_id)).map(r => step(r.skill_id, {
      name: skillName(graph, r.skill_id), key: false, kind: null, type: loadEsco()?.skills[r.skill_id]?.type === "knowledge" ? "knowledge" : "skill",
      hours: r.hours, weeks: r.hours == null ? null : displayWeeks(r.hours / PARAMS.referenceHours, hours) })),
  ];
  const n = planNumbers(plan);
  return {
    profileId: p.id, readOnly: p.isDemo,
    goal: { job: g.job, title: plan.title, source: plan.source, mode: g.mode, setAt: g.setAt },
    match: n.match, weeksLeft: n.weeks, hoursPerWeek: hours,
    progress: { done: steps.filter(s => s.done).length, total: steps.length, verified: steps.filter(s => s.verified).length },
    steps,
    checkIns,
    pace: paceOf({ setAt: g.setAt, today: isoDay(svc.now()), hoursPerWeek: hours, checkIns }),
    practiseSource: "O*NET 30 task statements (USDOL/ETA, CC BY 4.0) linked to skills by bge-m3 similarity (db/seed/quiz_tasks.json, scripts/build-quiz.ts)",
  };
}

// ---------- ticks ----------
type TickTable = "goal_steps" | "stay_steps";
async function tickRows(db: Db, table: TickTable, profileId: number) {
  return new Map(((await db.query(`select * from ${table} where profile_id=$1`, [profileId])).rows as StepRow[]).map(r => [r.skill_id, r]));
}

/**
 * Tick (or untick) one skill of a track (the goal's steps, or the stay track): raise (or restore) the profile's skill,
 * record the tick in `table`. `needOf(cat)` is the level a ticked catalogue skill is raised to. See the header.
 */
async function applyTick(svc: Services, graph: FullGraph, p: Profile, table: TickTable, skillId: string, done: boolean,
  o: { needOf: (cat: string) => number; hours: number | null; confidence?: "verified" }) {
  const row = (await tickRows(svc.db, table, p.id)).get(skillId);
  let levelChanged = false;
  await svc.db.tx(async t => {
    if (done) {
      let raised: string | null = null, before: number | null = null, set: number | null = null, escoAdded = false;
      const twin = isAiNode(skillId) ? aiSkill(skillId)?.catalogue ?? null : null;
      const cat = graph.nodes[skillId]?.type === "skill" ? skillId : twin && graph.nodes[twin]?.type === "skill" ? twin : null;
      if (cat) {
        const cur = p.level[cat] || 0;
        const need = cat === skillId ? o.needOf(cat) : HAVE_LEVEL;
        const target = Math.max(cur, need);
        if (target > cur) {
          await setSkillLevels(t, p.id, [{ skillId: cat, level: target }], o.confidence);
          raised = cat; before = cur || null; set = target; levelChanged = true;
        } else if (o.confidence) await setSkillLevels(t, p.id, [{ skillId: cat, level: Math.max(cur, 1) }], o.confidence);
      } else if (loadEsco()?.skills[skillId]) {
        const ins = await t.query("insert into profile_esco_skills(profile_id, skill_id, source) values ($1,$2,'self') on conflict do nothing returning skill_id", [p.id, skillId]);
        escoAdded = ins.rows.length > 0; levelChanged = escoAdded;
      }
      if (row?.done) {
        // already ticked: keep the first tick's record of what it changed
        if (levelChanged) await t.query(`update ${table} set raised_skill=coalesce(raised_skill,$3), level_before=coalesce(level_before,$4), level_set=coalesce(level_set,$5), esco_added=esco_added or $6 where profile_id=$1 and skill_id=$2`,
          [p.id, skillId, raised, before, set, escoAdded]);
      } else {
        await t.query(`insert into ${table}(profile_id, skill_id, done, done_at, hours, raised_skill, level_before, level_set, esco_added) values ($1,$2,true,$3,$4,$5,$6,$7,$8)
                       on conflict (profile_id, skill_id) do update set done=true, done_at=excluded.done_at, hours=coalesce(excluded.hours, ${table}.hours),
                         raised_skill=excluded.raised_skill, level_before=excluded.level_before, level_set=excluded.level_set, esco_added=excluded.esco_added`,
          [p.id, skillId, svc.now().toISOString(), o.hours ?? row?.hours ?? null, raised, before, set, escoAdded]);
      }
    } else if (row?.done) {
      // Undo exactly what the tick changed, unless the skill was changed again since.
      if (row.raised_skill && row.level_set != null && (p.level[row.raised_skill] || 0) === row.level_set) {
        await setSkillLevels(t, p.id, [{ skillId: row.raised_skill, level: row.level_before ?? 0 }]);
        levelChanged = true;
      }
      if (row.esco_added) {
        const del = await t.query("delete from profile_esco_skills where profile_id=$1 and skill_id=$2 and source='self' returning skill_id", [p.id, skillId]);
        levelChanged ||= del.rows.length > 0;
      }
      await t.query(`update ${table} set done=false, done_at=null, raised_skill=null, level_before=null, level_set=null, esco_added=false where profile_id=$1 and skill_id=$2`, [p.id, skillId]);
    }
  });
  return { levelChanged };
}

/** Tick (or untick) one goal step: raise (or restore) the profile's skill, record the tick. See the header. */
export async function setStepDone(svc: Services, graph: FullGraph, p: Profile, g: Goal, plan: GoalPlan, skillId: string, done: boolean, confidence?: "verified") {
  const m = (plan.missing as any[]).find(x => x.id === skillId);
  return applyTick(svc, graph, p, "goal_steps", skillId, done, {
    needOf: cat => m?.levelTo ?? (graph.req[g.job] || []).find((q: any) => q.skill === cat)?.need ?? HAVE_LEVEL,
    hours: m?.hours ?? null, confidence,
  });
}

// ---------- the "Stay AI-ready in your job" track ----------
// The same track web/js/features/stay.js shows: the missing skills of a hand-made "stay & adapt" catalogue job that fits
// you (match >= STAY.catKeep), else the stay items of your skill outlook (server/services/outlook.ts). A tick raises the
// skill exactly as a goal step's tick does (catalogue level, ESCO skill added, an AI-era skill's catalogue twin) and is
// kept in stay_steps, so My skills and every match follow.
export const STAY = { catKeep: 40 }; // = CAT_KEEP in web/js/state.js
export interface StayItem { id: string; name: string; hours: number | null; levelTo: number | null }

export async function stayItems(svc: Services, graph: FullGraph, p: Profile): Promise<{ mode: "catalogue" | "esco"; job: string | null; items: StayItem[] }> {
  for (const [job, n] of Object.entries<any>(graph.nodes)) {
    if (n.type !== "job" || !n.stay) continue;
    const plan = buildJobPlan(graph, p, { job, mode: "closest", now: svc.now() }) as any;
    if (plan.match < STAY.catKeep) continue;
    return { mode: "catalogue", job, items: plan.route ? (plan.missing as any[]).map(m => ({ id: m.id, name: m.name, hours: m.hours ?? null, levelTo: m.levelTo ?? null })) : [] };
  }
  const confirmed = await escoSkillsOf(svc.db, p.id);
  const occ = graph.nodes[p.occupationId];
  const o = skillOutlook({ level: p.level, confirmed, currentEscoId: p.currentEsco?.id ?? null, jobTitle: occ && p.occupationId !== "other" ? occ.name : null, courses: graph.courses });
  return { mode: "esco", job: o?.job ? `esco:${o.job.id}` : null, items: (o?.stay.items || []).map((x: any) => ({ id: x.id, name: x.name, hours: x.hours ?? null, levelTo: null })) };
}

/** The stay track's ticks: { skillId, name, doneAt, hours } for every skill ticked and still done. */
export async function stayView(svc: Services, graph: FullGraph, p: Profile) {
  const rows = [...(await tickRows(svc.db, "stay_steps", p.id)).values()].filter(r => r.done).sort((a, b) => a.skill_id.localeCompare(b.skill_id));
  return { profileId: p.id, readOnly: p.isDemo, done: rows.map(r => ({ skillId: r.skill_id, name: skillName(graph, r.skill_id), doneAt: toIso(r.done_at), hours: r.hours })) };
}

/** Tick (or untick) a stay skill. null: not on your stay track (and not ticked before). */
export async function setStayDone(svc: Services, graph: FullGraph, p: Profile, skillId: string, done: boolean) {
  const track = await stayItems(svc, graph, p);
  const item = track.items.find(x => x.id === skillId);
  if (!item && !(await tickRows(svc.db, "stay_steps", p.id)).get(skillId)?.done) return null;
  return applyTick(svc, graph, p, "stay_steps", skillId, done, {
    needOf: cat => item?.levelTo ?? (track.mode === "catalogue" && track.job ? (graph.req[track.job] || []).find((q: any) => q.skill === cat)?.need : null) ?? HAVE_LEVEL,
    hours: item?.hours ?? null,
  });
}

/** A passed skill check (POST /skills/:skillId/check) on a goal step: proof { kind:'check' } and the step is ticked
 *  (raised and verified). Returns the goal steps it counted for (none without a goal or a matching step). */
export async function recordCheckProof(svc: Services, graph: FullGraph, profileId: number, skillId: string): Promise<string[]> {
  const g = await loadGoal(svc.db, profileId);
  if (!g) return [];
  const o: PlanOpts = { year: 2026, scenario: "moderate" };
  let p = (await loadProfile(svc.db, profileId))!;
  const done = new Set([...(await stepRows(svc.db, profileId)).values()].filter(r => r.done).map(r => r.skill_id));
  const steps = stepsMatching(await goalPlan(svc, graph, p, g, o), done, skillId);
  for (const sid of steps) {
    await addProof(svc.db, profileId, sid, { kind: "check", by: CHECK_BY, at: svc.now() });
    await setStepDone(svc, graph, p, g, await goalPlan(svc, graph, p, g, o), sid, true, "verified");
    p = (await loadProfile(svc.db, profileId))!;
  }
  return steps;
}

/** For the HR view: a short summary of one person's goal. */
export function goalSummary(view: Awaited<ReturnType<typeof goalView>>) {
  return { goal: view.goal, match: view.match, weeksLeft: view.weeksLeft, stepsDone: view.progress.done, stepsTotal: view.progress.total,
    verified: view.progress.verified, lastCheckIn: view.pace.lastCheckIn, status: view.pace.status, pace: view.pace };
}

