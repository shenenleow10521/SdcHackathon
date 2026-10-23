// Planning routes (docs/API.md "Planning"): map, plan, SDG ranking, job search, explanations, studies,
// saved plans with advisor approval, and profile history.
// Rule: the app suggests, people decide. A plan only changes through the user (send, keep/switch route)
// or an advisor decision, and every change is written to the audit log.
import { Router } from "express";
import { z } from "zod";
import type { Services } from "../context.ts";
import { loadGraph, type FullGraph } from "../kb.ts";
import { loadProfile, audit, type Profile } from "../repo.ts";
import { parse, scenarioQuery, notFound, requireRole, actorOf, rateLimit, HttpError, badRequest } from "../lib/http.ts";
import { displayWeeks } from "../../shared/engine.js";
import { buildPlan, engineFor, type ExtraReq, type SignalInfo } from "../services/planning.ts";
import { mapJobs, rankBySdg } from "../services/ranking.ts";
import { searchJobs } from "../services/jobsearch.ts";
import { explain, factSheet } from "../agents/explainer.ts";

/** Studies "disagree" when their exposure values are this far apart (0-1 scale). */
export const DISAGREE_SPREAD = 0.15;

export async function requireProfile(svc: Services, id: number): Promise<Profile> {
  const p = await loadProfile(svc.db, id);
  if (!p) throw notFound("Profile");
  return p;
}

/** Details of the signals behind the graph's applied changes, for the "Why this number?" sources list. */
export async function signalInfo(svc: Services, graph: FullGraph): Promise<Record<number, SignalInfo>> {
  const ids = [...new Set(graph.appliedChanges.map(c => c.signalId).filter((x): x is number => x != null))];
  if (!ids.length) return {};
  const rows = (await svc.db.query("select id, title, source_title, source_date, source_url from signals where id = any($1::int[])", [ids])).rows as any[];
  return Object.fromEntries(rows.map(r => [r.id, { id: r.id, title: r.title, sourceTitle: r.source_title,
    sourceDate: r.source_date ? String(r.source_date instanceof Date ? r.source_date.toISOString() : r.source_date).slice(0, 10) : null, sourceUrl: r.source_url }]));
}

/** An employer's extra requirements for one job, in engine shape. */
export async function employerExtraReq(svc: Services, graph: FullGraph, employerId: number, job: string): Promise<ExtraReq[]> {
  const rows = (await svc.db.query("select skill_id, weight, level_needed from employer_requirements where employer_id=$1 and occupation_id=$2 order by id", [employerId, job])).rows as any[];
  return rows.filter(r => graph.nodes[r.skill_id]?.type === "skill").map(r => ({ skill: r.skill_id, weight: r.weight, need: r.level_needed, status: "employer", source: "employer" }));
}

function requireJob(graph: FullGraph, job: string) {
  if (graph.nodes[job]?.type !== "job") throw notFound(`Job '${job}'`);
}

// ---------- Saved plans ----------
const PLAN_SELECT = `select pl.*, p.hours_per_week, p.display_name, p.current_occupation_id, p.target_date
                     from plans pl join profiles p on p.id = pl.profile_id`;

function planJson(graph: FullGraph, r: any) {
  const route = r.route || null;
  return {
    id: r.id, profileId: r.profile_id, job: r.occupation_id, title: graph.nodes[r.occupation_id]?.name ?? r.occupation_id,
    employerId: r.employer_id, mode: r.mode, status: r.status, kbVersion: r.kb_version,
    route, weeks: route?.weeks != null ? displayWeeks(route.weeks, r.hours_per_week) : null,
    userNote: r.user_note ?? null, advisorNote: r.advisor_note, decidedBy: r.decided_by,
    pendingRoute: r.pending_route || null,
    sentAt: r.sent_at ?? null, decidedAt: r.decided_at ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

async function getPlanRow(svc: Services, id: number) {
  const r = (await svc.db.query(`${PLAN_SELECT} where pl.id=$1`, [id])).rows[0];
  if (!r) throw notFound("Plan");
  return r;
}

/** Atomic state change: only applies if the plan is in one of the allowed states; 409 otherwise. */
async function transition(svc: Services, id: number, from: string[], set: string, params: unknown[]) {
  const r = await svc.db.query(`update plans set ${set}, updated_at = now() where id=$1 and status = any($2::text[]) returning id`, [id, from, ...params]);
  if (!r.rows.length) {
    const cur = await getPlanRow(svc, id);
    throw new HttpError(409, "invalid_state", `Plan is '${cur.status}'; this action needs it to be ${from.map(s => `'${s}'`).join(" or ")}`);
  }
  return getPlanRow(svc, id);
}

/** Record the profile's matches and routes at the current knowledge-base version (feeds /profile/:id/history). */
export async function snapshotProfile(svc: Services, graph: FullGraph, p: Profile, mode = "fastest") {
  const E = engineFor(graph, p);
  const jobs = E.allJobs();
  const matches = Object.fromEntries(jobs.map(j => [j, E.match(j)]));
  const routes = Object.fromEntries(jobs.map(j => [j, E.shortestPath(j, mode as any)?.key ?? null]));
  await svc.db.query("insert into profile_snapshots(profile_id, kb_version, future_score, matches, routes) values ($1,$2,$3,$4,$5)",
    [p.id, graph.kbVersion, E.futureScore(), JSON.stringify(matches), JSON.stringify(routes)]);
}

export default function planRoutes(svc: Services) {
  const r = Router();
  const advisor = requireRole(svc, "advisor");
  const intId = z.coerce.number().int().positive();

  // GET /map — jobs for a sector with match, rank, outlook, route weeks and risk.
  r.get("/map", async (req, res) => {
    const q = parse(scenarioQuery.extend({ sector: z.string().max(40).default("best"), sdg: z.coerce.number().int().min(1).max(17).optional() }), req.query);
    const [g, p] = await Promise.all([loadGraph(svc.db), requireProfile(svc, q.profile)]);
    res.json(mapJobs(g, p, { sector: q.sector, sdg: q.sdg ?? p.sdgPriority, year: q.year, scenario: q.scenario, mode: q.mode }));
  });

  // GET /plan — the full plan for one job (optionally with an employer's extra requirements).
  r.get("/plan", async (req, res) => {
    const q = parse(scenarioQuery.extend({ job: z.string().min(1).max(60), employer: intId.optional() }), req.query);
    const [g, p] = await Promise.all([loadGraph(svc.db), requireProfile(svc, q.profile)]);
    requireJob(g, q.job);
    const extraReq = q.employer ? await employerExtraReq(svc, g, q.employer, q.job) : [];
    const plan = buildPlan(g, p, { job: q.job, mode: q.mode, year: q.year, scenario: q.scenario, extraReq, now: svc.now(), signals: await signalInfo(svc, g) });
    res.json({ ...plan, employerId: q.employer ?? null });
  });

  // GET /rank — SDG-aware ranking with the trade-off against the top job without the SDG.
  r.get("/rank", async (req, res) => {
    const q = parse(scenarioQuery.extend({ sdg: z.coerce.number().int().min(1).max(17).optional() }), req.query);
    const [g, p] = await Promise.all([loadGraph(svc.db), requireProfile(svc, q.profile)]);
    const sdg = q.sdg ?? p.sdgPriority;
    if (!sdg) throw badRequest("Choose an SDG (?sdg=13) or set an SDG priority on the profile");
    res.json(rankBySdg(g, p, { sdg, year: q.year, scenario: q.scenario, mode: q.mode }));
  });

  // GET /jobs/search?q= — catalogue search; unknown titles get nearest jobs + live ESCO matches.
  r.get("/jobs/search", rateLimit(30, 60_000), async (req, res) => {
    const q = parse(z.object({ q: z.string().trim().min(1).max(120) }), req.query);
    res.json(await searchJobs(svc, await loadGraph(svc.db), q.q));
  });

  // GET /explain — cited explanation; the fact checker removes unsupported sentences.
  r.get("/explain", rateLimit(20, 60_000), async (req, res) => {
    const q = parse(scenarioQuery.extend({ node: z.string().max(60).optional(), job: z.string().max(60).optional() }), req.query);
    const node = q.node || q.job;
    if (!node) throw badRequest("Give ?node= or ?job=");
    const [g, p] = await Promise.all([loadGraph(svc.db), requireProfile(svc, q.profile)]);
    const sheet = factSheet(g, p, { node, mode: q.mode, year: q.year, scenario: q.scenario, signals: await signalInfo(svc, g) });
    res.json({ node, ...(await explain(svc, sheet)) });
  });

  // GET /studies?job= — AI-exposure estimates from several studies, side by side.
  r.get("/studies", async (req, res) => {
    const q = parse(z.object({ job: z.string().min(1).max(60) }), req.query);
    const g = await loadGraph(svc.db);
    if (!g.nodes[q.job] || g.nodes[q.job].type === "skill") throw notFound(`Job '${q.job}'`);
    const rows = (await svc.db.query("select study, value, raw_value, note, source_url, source from exposure_studies where occupation_id=$1 order by study, id", [q.job])).rows as any[];
    const studies = rows.map(s => ({ study: s.study, value: s.value == null ? null : Math.round(Number(s.value) * 1000) / 1000, rawValue: s.raw_value, note: s.note, sourceUrl: s.source_url, source: s.source }));
    const vals = studies.map(s => s.value).filter((v): v is number => v != null);
    const spread = vals.length >= 2 ? Math.round((Math.max(...vals) - Math.min(...vals)) * 1000) / 1000 : 0;
    res.json({
      job: q.job, title: g.nodes[q.job].name, studies, spread, disagree: vals.length >= 2 && spread >= DISAGREE_SPREAD, threshold: DISAGREE_SPREAD,
      ...(studies.length ? {} : { note: "No exposure studies loaded for this job yet." }),
    });
  });

  // ---------- Saved plans + advisor ----------
  r.post("/plans", async (req, res) => {
    const b = parse(z.object({ profileId: intId, job: z.string().min(1).max(60), mode: z.enum(["fastest", "noregret", "safest"]).default("fastest"), employerId: intId.optional() }), req.body);
    const [g, p] = await Promise.all([loadGraph(svc.db), requireProfile(svc, b.profileId)]);
    requireJob(g, b.job);
    if (b.employerId && !(await svc.db.query("select 1 from employers where id=$1", [b.employerId])).rows.length) throw notFound("Employer");
    const extra = b.employerId ? await employerExtraReq(svc, g, b.employerId, b.job) : [];
    const route = engineFor(g, p).planFor(b.job, b.mode, extra as any).route;
    if (!route) throw new HttpError(409, "no_route", "There is no open route to this job right now");
    const stored = { key: route.key, nodes: route.nodes, legs: route.legs, weeks: route.weeks };
    const ins = await svc.db.query<{ id: number }>("insert into plans(profile_id, occupation_id, employer_id, mode, route, kb_version, status) values ($1,$2,$3,$4,$5,$6,'draft') returning id",
      [p.id, b.job, b.employerId ?? null, b.mode, JSON.stringify(stored), g.kbVersion]);
    await snapshotProfile(svc, g, p, b.mode);
    await audit(svc.db, `user:${p.id}`, "plan.create", `plan:${ins.rows[0].id}`, { job: b.job, mode: b.mode, routeKey: route.key });
    res.status(201).json({ plan: planJson(g, await getPlanRow(svc, ins.rows[0].id)) });
  });

  r.get("/plans", async (req, res) => {
    const q = parse(z.object({ profile: intId.default(1) }), req.query);
    const g = await loadGraph(svc.db);
    const rows = (await svc.db.query(`${PLAN_SELECT} where pl.profile_id=$1 order by pl.id desc`, [q.profile])).rows;
    res.json({ plans: rows.map(x => planJson(g, x)) });
  });

  // The user sends a draft (or a plan the advisor asked to change) for review.
  r.post("/plans/:id/send", async (req, res) => {
    const id = parse(intId, req.params.id);
    const b = parse(z.object({ note: z.string().max(1000).optional() }).default({}), req.body ?? {});
    const row = await transition(svc, id, ["draft", "changes_requested"], "status='sent', sent_at=now(), user_note=coalesce($3, user_note)", [b.note ?? null]);
    await audit(svc.db, `user:${row.profile_id}`, "plan.send", `plan:${id}`, { note: b.note ?? null });
    res.json({ plan: planJson(await loadGraph(svc.db), row) });
  });

  // 🔒 Plans waiting for an advisor, with a short profile summary.
  r.get("/advisor/queue", advisor, async (_req, res) => {
    const g = await loadGraph(svc.db);
    const rows = (await svc.db.query(`${PLAN_SELECT} where pl.status='sent' order by pl.sent_at nulls last, pl.id`)).rows as any[];
    const plans = [];
    for (const x of rows) {
      const p = await loadProfile(svc.db, x.profile_id);
      plans.push({
        ...planJson(g, x),
        profile: p && { id: p.id, displayName: p.displayName, occupationId: p.occupationId, occupationTitle: g.nodes[p.occupationId]?.name ?? p.occupationId,
          hours: p.hours, targetDate: p.targetDate, isDemo: p.isDemo, matchNow: g.nodes[x.occupation_id]?.type === "job" ? engineFor(g, p).match(x.occupation_id) : null },
      });
    }
    res.json({ plans });
  });

  // 🔒 Advisor decision on a sent plan.
  r.post("/plans/:id/decision", advisor, async (req, res) => {
    const id = parse(intId, req.params.id);
    const b = parse(z.discriminatedUnion("decision", [
      z.object({ decision: z.literal("approve"), note: z.string().max(2000).optional() }),
      z.object({ decision: z.literal("changes"), note: z.string().trim().min(1, "Say what should change").max(2000) }),
    ]), req.body);
    const actor = actorOf(req);
    const status = b.decision === "approve" ? "approved" : "changes_requested";
    const row = await transition(svc, id, ["sent"], "status=$3, advisor_note=$4, decided_by=$5, decided_at=now()", [status, b.note ?? null, actor]);
    await audit(svc.db, actor, "plan.decision", `plan:${id}`, { decision: b.decision, note: b.note ?? null });
    res.json({ plan: planJson(await loadGraph(svc.db), row) });
  });

  // The user keeps their route or switches to the one a knowledge change offered (plans.pending_route).
  r.post("/plans/:id/route-update", async (req, res) => {
    const id = parse(intId, req.params.id);
    const b = parse(z.object({ action: z.enum(["keep", "switch"]) }), req.body);
    const cur = await getPlanRow(svc, id);
    const pending = cur.pending_route;
    if (!pending?.route) throw new HttpError(409, "no_pending_route", "This plan has no route update waiting");
    const upd = b.action === "switch"
      ? await svc.db.query("update plans set route=$2, kb_version=coalesce($3, kb_version), pending_route=null, updated_at=now() where id=$1 and pending_route is not null returning id",
          [id, JSON.stringify(pending.route), pending.kbVersion ?? null])
      : await svc.db.query("update plans set pending_route=null, updated_at=now() where id=$1 and pending_route is not null returning id", [id]);
    if (!upd.rows.length) throw new HttpError(409, "no_pending_route", "This plan has no route update waiting");
    await audit(svc.db, `user:${cur.profile_id}`, `plan.route_${b.action}`, `plan:${id}`,
      { from: cur.route?.key ?? null, offered: pending.route.key ?? null, reason: pending.reason ?? null, signalId: pending.signalId ?? null, kbVersion: pending.kbVersion ?? null });
    res.json({ plan: planJson(await loadGraph(svc.db), await getPlanRow(svc, id)) });
  });

  // GET /profile/:id/history — snapshots, with what changed since the previous one.
  r.get("/profile/:id/history", async (req, res) => {
    const id = parse(intId, req.params.id);
    await requireProfile(svc, id);
    const g = await loadGraph(svc.db);
    const rows = (await svc.db.query("select * from profile_snapshots where profile_id=$1 order by created_at, id", [id])).rows as any[];
    const name = (j: string) => g.nodes[j]?.name ?? j;
    const snapshots = rows.map((s, i) => {
      const prev = rows[i - 1];
      const changed: any[] = [];
      if (prev) {
        if (prev.kb_version !== s.kb_version) changed.push({ kind: "kbVersion", from: prev.kb_version, to: s.kb_version, text: `Knowledge base v${prev.kb_version} → v${s.kb_version}` });
        if (prev.future_score !== s.future_score) changed.push({ kind: "futureScore", from: prev.future_score, to: s.future_score, text: `Future score ${prev.future_score} → ${s.future_score}` });
        for (const [j, m] of Object.entries<any>(s.matches || {}))
          if (prev.matches?.[j] !== undefined && prev.matches[j] !== m) changed.push({ kind: "match", job: j, from: prev.matches[j], to: m, text: `${name(j)} match ${prev.matches[j]}% → ${m}%` });
        for (const [j, k] of Object.entries<any>(s.routes || {}))
          if (prev.routes?.[j] !== undefined && prev.routes[j] !== k) changed.push({ kind: "route", job: j, from: prev.routes[j], to: k, text: `${name(j)} route changed` });
      }
      return { id: s.id, kbVersion: s.kb_version, futureScore: s.future_score, createdAt: s.created_at, changed };
    });
    res.json({ profileId: id, snapshots });
  });

  return r;
}
