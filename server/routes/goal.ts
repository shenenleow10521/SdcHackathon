// Goal progress routes (docs/API.md "Goal progress"; maths and rules in server/services/goal.ts).
//   GET    /profile/:id/goal                          goal, steps (done, proofs, practise tasks), check-ins, on-track status
//   PUT    /profile/:id/goal                          { job, mode } set the goal (a new job resets the ticks)
//   DELETE /profile/:id/goal                          clear the goal (proofs and check-ins stay)
//   POST   /profile/:id/goal/steps/:skillId           { done } tick / untick; returns match and weeks before and after
//   POST   /profile/:id/goal/steps/:skillId/proof     { kind:'credential', url, title, provider? } add a credential link
//   DELETE /profile/:id/goal/steps/:skillId/proof/:proofId   remove a credential you added
//   POST   /profile/:id/checkins                      { weekStart, hours } weekly study check-in (one per week)
//   GET    /profile/:id/stay                          the "Stay AI-ready" track's ticks
//   POST   /profile/:id/stay/:skillId                 { done } tick / untick a stay skill (raises it like a goal step)
//   GET    /profile/:id/record                        the skills record (printable)
//   POST   /advisor/profiles/:id/goal/steps/:skillId/confirm   🧑‍🏫 { name? } an advisor confirms a step's skill
//   GET    /hr/:employerId/progress                   🧑‍🏫 goal progress of team members who chose to share it
// The sample persona is read-only: GET works (no goal is stored for it), every write is 403 demo_profile_read_only.
import { Router } from "express";
import { z } from "zod";
import type { Services } from "../context.ts";
import { loadGraph, type FullGraph } from "../kb.ts";
import { loadProfile, audit, type Profile } from "../repo.ts";
import { parse, notFound, badRequest, rateLimit, requireRole, actorOf, HttpError } from "../lib/http.ts";
import { loadEsco } from "../services/esco.ts";
import { aiSkill, isAiNode } from "../services/ai-skills.ts";
import { loadGoal, goalJobId, goalPlan, goalView, goalSummary, planNumbers, setStepDone, isStep, addProof, proofsOf, checkInsOf,
  skillName, isVerifiedProof, weekStartOf, isoDay, paceOf, stayView, setStayDone, type Goal, type PlanOpts } from "../services/goal.ts";

const idParam = z.object({ id: z.coerce.number().int().positive() });
const stepParams = idParam.extend({ skillId: z.string().min(1).max(60) });
const planQuery = z.object({
  year: z.coerce.number().int().min(2026).max(2030).default(2026),
  scenario: z.enum(["moderate", "fast"]).default("moderate"),
});
const goalBody = z.object({
  job: z.string().trim().min(1).max(60),
  mode: z.enum(["closest", "safest", "fastest", "noregret"]).default("closest")
    .transform(m => (m === "safest" || m === "noregret" ? "safest" : "closest") as "closest" | "safest"),
}).strict();
const stepBody = z.object({ done: z.boolean() }).strict();
const credentialBody = z.object({
  kind: z.literal("credential"),
  url: z.url({ protocol: /^https$/, error: "Use a full https:// link" }).max(500),
  title: z.string().trim().min(2).max(120),
  provider: z.string().trim().min(2).max(80).optional(),
}).strict();
const checkInBody = z.object({
  weekStart: z.iso.date(),
  hours: z.number().min(0).max(80),
}).strict();
const confirmBody = z.object({ name: z.string().trim().min(2).max(80).optional() }).strict();
/** Credentials one skill may carry, so the record stays readable. */
const MAX_CREDENTIALS = 5;

export default function goalRoutes(svc: Services) {
  const r = Router();
  const advisor = requireRole(svc, "advisor");

  const mustLoad = async (id: number) => {
    const p = await loadProfile(svc.db, id);
    if (!p) throw notFound("Profile");
    return p;
  };
  const mustEdit = async (id: number) => {
    const p = await mustLoad(id);
    if (p.isDemo) throw new HttpError(403, "demo_profile_read_only", "The sample persona can't be changed. Start your own profile to edit it.");
    return p;
  };
  const mustGoal = async (p: Profile) => {
    const g = await loadGoal(svc.db, p.id);
    if (!g) throw new HttpError(409, "no_goal", "Choose a goal job first.");
    return g;
  };
  const notAStep = (skillId: string) => new HttpError(404, "not_a_step", `'${skillId}' is not a step of this goal`);
  const view = async (g: FullGraph, p: Profile, goal: Goal, o: PlanOpts) => goalView(svc, g, p, goal, await goalPlan(svc, g, p, goal, o));

  r.get("/profile/:id/goal", async (req, res) => {
    const { id } = parse(idParam, req.params);
    const o = parse(planQuery, req.query);
    const p = await mustLoad(id);
    const goal = await loadGoal(svc.db, id);
    if (!goal) {
      res.json({ profileId: id, readOnly: p.isDemo, goal: null, match: null, weeksLeft: null, hoursPerWeek: p.hours, progress: null, steps: [],
        checkIns: await checkInsOf(svc.db, id), pace: null });
      return;
    }
    res.json(await view(await loadGraph(svc.db), p, goal, o));
  });

  r.put("/profile/:id/goal", async (req, res) => {
    const { id } = parse(idParam, req.params);
    const b = parse(goalBody, req.body || {});
    const p = await mustEdit(id);
    const g = await loadGraph(svc.db);
    const job = goalJobId(g, b.job);
    if (!job) throw badRequest("Invalid input", [{ path: "job", message: "Unknown job: give a catalogue job id or esco:<uuid>" }]);
    const old = await loadGoal(svc.db, id);
    const changed = old?.job !== job;
    await svc.db.tx(async t => {
      // A new job starts again: new date, no ticks (like goal.js). Proofs and check-ins are about the person: they stay.
      if (changed) await t.query("delete from goal_steps where profile_id=$1", [id]);
      await t.query(`insert into goals(profile_id, job, mode, set_at) values ($1,$2,$3,$4)
                     on conflict (profile_id) do update set job=excluded.job, mode=excluded.mode,
                       set_at = case when goals.job = excluded.job then goals.set_at else excluded.set_at end, updated_at=now()`,
        [id, job, b.mode, isoDay(svc.now())]);
    });
    await audit(svc.db, `user:${id}`, "goal.set", String(id), { job, mode: b.mode, changed });
    res.json(await view(g, p, (await loadGoal(svc.db, id))!, parse(planQuery, req.query)));
  });

  r.delete("/profile/:id/goal", async (req, res) => {
    const { id } = parse(idParam, req.params);
    await mustEdit(id);
    await svc.db.tx(async t => {
      await t.query("delete from goal_steps where profile_id=$1", [id]);
      await t.query("delete from goals where profile_id=$1", [id]);
    });
    await audit(svc.db, `user:${id}`, "goal.clear", String(id));
    res.json({ profileId: id, goal: null });
  });

  r.post("/profile/:id/goal/steps/:skillId", async (req, res) => {
    const { id, skillId } = parse(stepParams, req.params);
    const { done } = parse(stepBody, req.body || {});
    const o = parse(planQuery, req.query);
    const p = await mustEdit(id);
    const goal = await mustGoal(p);
    const g = await loadGraph(svc.db);
    const before = await goalPlan(svc, g, p, goal, o);
    if (!(await isStep(svc.db, id, before, skillId))) throw notAStep(skillId);
    const { levelChanged } = await setStepDone(svc, g, p, goal, before, skillId, done);
    const p2 = (await loadProfile(svc.db, id))!;
    const after = await goalPlan(svc, g, p2, goal, o);
    await audit(svc.db, `user:${id}`, done ? "goal.step_done" : "goal.step_undone", `${id}:${skillId}`, { job: goal.job, levelChanged });
    res.json({ change: { skillId, done, levelChanged, before: planNumbers(before), after: planNumbers(after) }, ...(await goalView(svc, g, p2, goal, after)) });
  });

  r.post("/profile/:id/goal/steps/:skillId/proof", rateLimit(20, 60_000), async (req, res) => {
    const { id, skillId } = parse(stepParams, req.params);
    const b = parse(credentialBody, req.body || {});
    const p = await mustEdit(id);
    const goal = await mustGoal(p);
    const g = await loadGraph(svc.db);
    const plan = await goalPlan(svc, g, p, goal, parse(planQuery, req.query));
    if (!(await isStep(svc.db, id, plan, skillId))) throw notAStep(skillId);
    const n = (await svc.db.query<{ n: number }>("select count(*)::int as n from skill_proofs where profile_id=$1 and skill_id=$2 and kind='credential'", [id, skillId])).rows[0].n;
    if (n >= MAX_CREDENTIALS) throw new HttpError(409, "too_many_credentials", `A skill can show up to ${MAX_CREDENTIALS} credentials. Remove one first.`);
    // Who vouches: the provider the person named, else the link's site.
    await addProof(svc.db, id, skillId, { kind: "credential", by: b.provider ?? new URL(b.url).hostname, at: svc.now(), url: b.url, title: b.title });
    await audit(svc.db, `user:${id}`, "goal.credential_add", `${id}:${skillId}`, { host: new URL(b.url).hostname });
    res.status(201).json(await goalView(svc, g, p, goal, plan));
  });

  r.delete("/profile/:id/goal/steps/:skillId/proof/:proofId", async (req, res) => {
    const { id, skillId, proofId } = parse(stepParams.extend({ proofId: z.coerce.number().int().positive() }), req.params);
    const p = await mustEdit(id);
    // Only a credential the person added can be removed; checks and advisor confirmations are not theirs to delete.
    const del = await svc.db.query("delete from skill_proofs where id=$1 and profile_id=$2 and skill_id=$3 and kind='credential' returning id", [proofId, id, skillId]);
    if (!del.rows.length) throw notFound("Credential");
    await audit(svc.db, `user:${id}`, "goal.credential_remove", `${id}:${skillId}`, { proofId });
    const goal = await loadGoal(svc.db, id);
    res.json(goal ? await view(await loadGraph(svc.db), p, goal, parse(planQuery, req.query)) : { profileId: id, goal: null });
  });

  r.post("/profile/:id/checkins", async (req, res) => {
    const { id } = parse(idParam, req.params);
    const b = parse(checkInBody, req.body || {});
    const p = await mustEdit(id);
    const goal = await mustGoal(p);
    const weekStart = weekStartOf(b.weekStart), today = isoDay(svc.now());
    if (weekStart > today) throw badRequest("Invalid input", [{ path: "weekStart", message: "That week hasn't started yet" }]);
    const hours = Math.round(10 * b.hours) / 10;
    await svc.db.query(`insert into goal_checkins(profile_id, week_start, hours) values ($1,$2,$3)
                        on conflict (profile_id, week_start) do update set hours=excluded.hours, updated_at=now()`, [id, weekStart, hours]);
    await audit(svc.db, `user:${id}`, "goal.checkin", String(id), { weekStart, hours });
    const checkIns = await checkInsOf(svc.db, id);
    res.json({ checkIn: { weekStart, hours }, checkIns, pace: paceOf({ setAt: goal.setAt, today, hoursPerWeek: p.hours, checkIns }) });
  });

  // The "Stay AI-ready in your job" track's ticks (server/services/goal.ts). The track itself is computed where it is
  // shown (web/js/features/stay.js); the server checks a tick against the same track before it raises the skill.
  r.get("/profile/:id/stay", async (req, res) => {
    const { id } = parse(idParam, req.params);
    const p = await mustLoad(id);
    res.json(await stayView(svc, await loadGraph(svc.db), p));
  });

  r.post("/profile/:id/stay/:skillId", async (req, res) => {
    const { id, skillId } = parse(stepParams, req.params);
    const { done } = parse(stepBody, req.body || {});
    const p = await mustEdit(id);
    const g = await loadGraph(svc.db);
    const r1 = await setStayDone(svc, g, p, skillId, done);
    if (!r1) throw new HttpError(404, "not_on_stay_track", `'${skillId}' is not on your stay track`);
    await audit(svc.db, `user:${id}`, done ? "stay.step_done" : "stay.step_undone", `${id}:${skillId}`, { levelChanged: r1.levelChanged });
    res.json({ change: { skillId, done, levelChanged: r1.levelChanged }, ...(await stayView(svc, g, (await loadProfile(svc.db, id))!)) });
  });

  r.get("/profile/:id/record", async (req, res) => {
    const { id } = parse(idParam, req.params);
    const p = await mustLoad(id);
    const g = await loadGraph(svc.db);
    const d = loadEsco();
    const [proofs, esco, goal] = await Promise.all([proofsOf(svc.db, id), svc.db.query("select skill_id, source from profile_esco_skills where profile_id=$1", [id]), loadGoal(svc.db, id)]);
    const escoRows = new Map((esco.rows as any[]).map(x => [x.skill_id as string, x.source as string]));
    const ids = new Set<string>([...p.skills.map(s => s.skillId), ...escoRows.keys(), ...proofs.keys()]);
    const skills = [...ids].map(sid => {
      const cat = p.skills.find(s => s.skillId === sid);
      const pr = proofs.get(sid) || [];
      const source = g.nodes[sid]?.type === "skill" ? "catalogue" : d?.skills[sid] ? "esco" : isAiNode(sid) ? "ai" : "other";
      return {
        skillId: sid, name: skillName(g, sid), source,
        level: cat ? cat.level : null,                               // catalogue skills: 1-5; ESCO and AI-era skills have no level
        basis: cat ? cat.confidence : (escoRows.get(sid) ?? null),  // how we know: cv | self | quiz | verified (catalogue), cv | self (ESCO)
        evidence: cat?.evidence ?? null,
        held: !!cat || escoRows.has(sid),                            // false: only a proof so far (e.g. a credential on a goal step)
        verified: cat?.confidence === "verified" || pr.some(isVerifiedProof),
        proofs: pr,
        uri: source === "esco" ? `http://data.europa.eu/esco/skill/${sid}` : null,
      };
    }).sort((a, b) => Number(b.verified) - Number(a.verified) || Number(b.held) - Number(a.held) || a.name.localeCompare(b.name));
    const sources = [
      ...(skills.some(s => s.source === "catalogue") ? [{ kind: "catalogue", label: "HalaTuju skills catalogue (sample data)", url: null }] : []),
      ...(skills.some(s => s.source === "esco") ? [{ kind: "esco", label: "ESCO v1.2.1 skills, European Commission (CC BY 4.0)", url: "https://esco.ec.europa.eu/" }] : []),
      ...[...new Map(skills.filter(s => s.source === "ai").flatMap(s => aiSkill(s.skillId)?.sources || []).map(x => [x.url, x])).values()]
        .map(x => ({ kind: "ai-skill", label: `${x.publisher}: ${x.title}`, url: x.url })),
      ...(skills.some(s => s.proofs.some(x => x.kind === "check")) ? [{ kind: "check", label: "HalaTuju skill check: a short quiz, pass mark 70%", url: null }] : []),
      ...skills.flatMap(s => s.proofs.filter(x => x.kind === "credential").map(x => ({ kind: "credential", label: `${x.title} (${x.by}), added by the person`, url: x.url }))),
    ];
    res.json({
      profileId: id, name: p.displayName, isSample: p.isDemo, asOf: isoDay(svc.now()),
      currentJob: p.currentEsco ? { id: `esco:${p.currentEsco.id}`, title: p.currentEsco.title } : { id: p.occupationId, title: g.nodes[p.occupationId]?.name ?? p.occupationId },
      goal: goal ? { job: goal.job, title: g.nodes[goal.job]?.name ?? d?.occupations[goal.job.replace(/^esco:/, "")]?.title ?? goal.job, mode: goal.mode, setAt: goal.setAt } : null,
      counts: { skills: skills.filter(s => s.held).length, verified: skills.filter(s => s.verified).length, credentials: skills.reduce((n, s) => n + s.proofs.filter(x => x.kind === "credential").length, 0) },
      skills, sources,
      note: "Verified = passed the HalaTuju skill check or confirmed by an advisor. Credentials are links the person added; HalaTuju has not checked them.",
    });
  });

  // 🧑‍🏫 An advisor confirms a worker's goal step: proof { kind:'advisor', by: the advisor's name }, and the step is ticked
  // (the skill is raised and marked verified). Not under /profile/:id, whose writes are for the owner only.
  r.post("/advisor/profiles/:id/goal/steps/:skillId/confirm", advisor, async (req, res) => {
    const { id, skillId } = parse(stepParams, req.params);
    const b = parse(confirmBody, req.body || {});
    const p = await mustEdit(id);
    const goal = await mustGoal(p);
    const g = await loadGraph(svc.db);
    const o = parse(planQuery, req.query);
    const before = await goalPlan(svc, g, p, goal, o);
    if (!(await isStep(svc.db, id, before, skillId))) throw notAStep(skillId);
    const actor = actorOf(req), by = b.name ?? actor;
    await addProof(svc.db, id, skillId, { kind: "advisor", by, at: svc.now() });
    await setStepDone(svc, g, p, goal, before, skillId, true, "verified");
    await audit(svc.db, actor, "goal.advisor_confirm", `${id}:${skillId}`, { by, job: goal.job });
    const p2 = (await loadProfile(svc.db, id))!;
    const after = await goalPlan(svc, g, p2, goal, o);
    res.json({ change: { skillId, done: true, before: planNumbers(before), after: planNumbers(after) }, ...(await goalView(svc, g, p2, goal, after)) });
  });

  // 🧑‍🏫 HR: goal progress of an employer's team members who turned "share my progress" on. Nobody else appears.
  r.get("/hr/:employerId/progress", advisor, async (req, res) => {
    const employerId = parse(z.coerce.number().int().positive(), req.params.employerId);
    const o = parse(planQuery, req.query);
    const emp = (await svc.db.query("select id, name, source from employers where id=$1", [employerId])).rows[0] as any;
    if (!emp) throw notFound("Employer");
    const rows = (await svc.db.query<{ id: number; share_progress: boolean }>("select id, share_progress from profiles where employer_id=$1 order by id", [employerId])).rows;
    const g = await loadGraph(svc.db);
    const members = [];
    for (const row of rows.filter(x => x.share_progress)) {
      const p = (await loadProfile(svc.db, row.id))!;
      const goal = await loadGoal(svc.db, p.id);
      const base = { profileId: p.id, name: p.displayName, hoursPerWeek: p.hours };
      if (!goal) {
        const checkIns = await checkInsOf(svc.db, p.id);
        members.push({ ...base, goal: null, match: null, weeksLeft: null, stepsDone: 0, stepsTotal: 0, verified: 0,
          lastCheckIn: checkIns[checkIns.length - 1] ?? null, status: null, pace: null });
        continue;
      }
      members.push({ ...base, ...goalSummary(await view(g, p, goal, o)) });
    }
    res.json({
      employer: { id: emp.id, name: emp.name, isSample: emp.source === "sample" }, asOf: isoDay(svc.now()),
      members, notSharing: rows.length - members.length,
      note: "Only team members who chose to share their progress are listed. Ticks are self-reported; verified = passed the HalaTuju skill check or confirmed by an advisor.",
    });
  });

  return r;
}
