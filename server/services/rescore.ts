// Re-scoring after a knowledge change.
//   simulate(): which users WOULD be rerouted (or see a skill change zone) if these changes were applied?
//               Used by triage ("changes no user's route or zone") before anything is written.
//   applyRescore(): after a version is created, record snapshots and offer new routes on saved plans
//               (plans.pending_route). Nothing changes a user's plan silently: they keep or switch.
// Settings: each profile at the default view (2026, moderate). Jobs checked: the profile's saved plans
// (with their mode), or, if it has none, every job shown on its map (all sector rings), fastest mode.
import { createEngine, displayWeeks, HAVE_LEVEL } from "../../shared/engine.js";
import type { Services } from "../context.ts";
import { loadGraph, engineGraph, type FullGraph, type KbChange } from "../kb.ts";
import { listProfileIds, loadProfile, engineProfile, type Profile } from "../repo.ts";

const VIEW = { year: 2026, scenario: "moderate" as const };

export interface Reroute { profileId: number; job: string; mode: string; from: string | null; to: string | null; planId?: number }
export interface ZoneChange { profileId: number; skillId: string; from: string; to: string }
export interface Simulation { usersRerouted: number; rerouted: Reroute[]; usersZoneChanged: number; zoneChanges: ZoneChange[] }

type EGraph = ReturnType<typeof engineGraph>;

/** The engine graph with changes applied in memory (mirrors kb.ts; nothing is written). */
export function withChanges(g: EGraph, changes: KbChange[]): EGraph {
  const out: EGraph = { ...g, nodes: { ...g.nodes }, edges: [...g.edges], req: { ...g.req }, deltas: { e: { ...(g.deltas?.e || {}) }, d: { ...(g.deltas?.d || {}) } } };
  for (const c of changes) {
    if (c.kind === "delta" && c.nodeId && out.nodes[c.nodeId]) {
      if (c.deltaE) out.deltas.e[c.nodeId] = (out.deltas.e[c.nodeId] || 0) + c.deltaE;
      if (c.deltaD) out.deltas.d[c.nodeId] = (out.deltas.d[c.nodeId] || 0) + c.deltaD;
    } else if (c.kind === "emerging_status" && c.nodeId && out.nodes[c.nodeId]) {
      out.nodes[c.nodeId] = { ...out.nodes[c.nodeId], emerging: { ...(out.nodes[c.nodeId].emerging || {}), status: c.payload?.status } };
    } else if (c.kind === "add_skill" && c.payload?.skill) {
      const s = c.payload.skill;
      out.nodes[s.id] = { name: s.label, type: "skill", e: s.e, d: s.d, emerging: s.emerging || { status: "provisional" } };
      for (const e of c.payload.edges || []) out.edges.push({ from: e.from, to: e.to, weeks: e.weeks, why: e.why, kind: e.kind || "build" });
      for (const r of c.payload.req || []) out.req[r.job] = [...(out.req[r.job] || []), { skill: s.id, weight: r.weight, need: HAVE_LEVEL, share: null, status: "emerging", source: "committee" } as any];
    }
  }
  return out;
}

interface Target { profile: Profile; jobs: { job: string; mode: string; planId?: number; planRoute?: any }[] }

async function targets(svc: Services, g: EGraph): Promise<Target[]> {
  const plans = (await svc.db.query(`select id, profile_id, occupation_id, mode, route from plans where status <> 'archived' order by id`)).rows as any[];
  const byProfile = new Map<number, any[]>();
  for (const p of plans) byProfile.set(p.profile_id, [...(byProfile.get(p.profile_id) || []), p]);
  const out: Target[] = [];
  for (const id of await listProfileIds(svc.db)) {
    const profile = await loadProfile(svc.db, id);
    if (!profile || !g.nodes[profile.occupationId]) continue;
    const saved = byProfile.get(id) || [];
    if (saved.length) out.push({ profile, jobs: saved.map(p => ({ job: p.occupation_id, mode: p.mode || "fastest", planId: p.id, planRoute: p.route })) });
    else {
      const E = createEngine(g, engineProfile(profile), VIEW);
      const jobs = new Set<string>(E.sectorJobs("best"));
      for (const s of g.sectors || []) if (s.jobs) for (const j of E.sectorJobs(s.id)) jobs.add(j);
      out.push({ profile, jobs: [...jobs].map(job => ({ job, mode: "fastest" })) });
    }
  }
  return out;
}

const routeKey = (E: ReturnType<typeof createEngine>, job: string, mode: string) => (E.isJob(job) ? E.shortestPath(job, mode as any)?.key ?? null : null);

function compare(before: EGraph, after: EGraph, ts: Target[]): Simulation {
  const rerouted: Reroute[] = [], zoneChanges: ZoneChange[] = [];
  for (const t of ts) {
    const p = engineProfile(t.profile);
    const A = createEngine(before, p, VIEW), B = createEngine(after, p, VIEW);
    for (const j of t.jobs) {
      const from = routeKey(A, j.job, j.mode), to = routeKey(B, j.job, j.mode);
      if (from !== to) rerouted.push({ profileId: t.profile.id, job: j.job, mode: j.mode, from, to, planId: j.planId });
    }
    for (const k of A.ownedSkills()) {
      const z1 = A.taken(k) ? "Taken over" : A.zone(k), z2 = B.taken(k) ? "Taken over" : B.zone(k);
      if (z1 !== z2) zoneChanges.push({ profileId: t.profile.id, skillId: k, from: z1, to: z2 });
    }
  }
  return {
    usersRerouted: new Set(rerouted.map(r => r.profileId)).size, rerouted,
    usersZoneChanged: new Set(zoneChanges.map(z => z.profileId)).size, zoneChanges,
  };
}

/** Who would be affected if `changes` were applied on top of `graph`? */
export async function simulate(svc: Services, graph: FullGraph, changes: KbChange[]): Promise<Simulation> {
  const before = engineGraph(graph);
  return compare(before, withChanges(before, changes), await targets(svc, before));
}

/**
 * After a new version: write a snapshot for every profile, and on each saved plan whose route changed,
 * offer the new route (plans.pending_route) for the user to keep or switch. If a change is undone and the
 * route goes back to the one the user accepted, the offer is withdrawn.
 */
export async function applyRescore(svc: Services, fromVersion: number, toVersion: number, ctx: { reason: string; signalId?: number | null }): Promise<Reroute[]> {
  const gBefore = engineGraph(await loadGraph(svc.db, fromVersion));
  const full = await loadGraph(svc.db, toVersion);
  const gAfter = engineGraph(full);
  const ts = await targets(svc, gAfter);
  const sim = compare(gBefore, gAfter, ts);

  for (const t of ts) {
    const E = createEngine(gAfter, engineProfile(t.profile), VIEW);
    const jobs = E.allJobs();
    const mode = t.jobs.find(j => j.planId)?.mode || "fastest";
    await svc.db.query("insert into profile_snapshots(profile_id, kb_version, future_score, matches, routes) values ($1,$2,$3,$4,$5)",
      [t.profile.id, toVersion, E.futureScore(), JSON.stringify(Object.fromEntries(jobs.map(j => [j, E.match(j)]))),
       JSON.stringify(Object.fromEntries(jobs.map(j => [j, E.shortestPath(j, mode as any)?.key ?? null])))]);
    for (const j of t.jobs) {
      if (!j.planId) continue;
      const r = E.isJob(j.job) ? E.shortestPath(j.job, j.mode as any) : null;
      const accepted = j.planRoute?.key ?? null;
      if (r && r.key === accepted) {
        await svc.db.query("update plans set pending_route=null, updated_at=now() where id=$1 and pending_route is not null", [j.planId]);
      } else if (sim.rerouted.some(x => x.planId === j.planId)) {
        const pending = {
          kbVersion: toVersion, previousKey: accepted, reason: ctx.reason, signalId: ctx.signalId ?? null,
          route: r ? { key: r.key, nodes: r.nodes, legs: r.legs, weeks: r.weeks, weeksAtPace: displayWeeks(r.weeks, t.profile.hours) } : null,
        };
        await svc.db.query("update plans set pending_route=$2, updated_at=now() where id=$1", [j.planId, JSON.stringify(pending)]);
      }
    }
  }
  await svc.db.query("insert into runs(kind, status, trigger, finished_at, summary) values ('rescore','ok','manual',$1,$2)",
    [svc.now().toISOString(), JSON.stringify({ fromVersion, toVersion, reason: ctx.reason, signalId: ctx.signalId ?? null, profiles: ts.length, usersRerouted: sim.usersRerouted, rerouted: sim.rerouted.slice(0, 200) })]);
  return sim.rerouted;
}
