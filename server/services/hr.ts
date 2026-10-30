// HR redeployment view: for each team member, every open role with match, weeks at their own pace,
// course cost and the date they could be ready; then a SUGGESTED assignment. HR decides; nothing is applied.
//
// Assignment rule (greedy, documented so anyone can check it by hand):
//   1. List every (person, role) option that has an open route AND is ready on or before the role's deadline.
//   2. Sort by match % (high first), then weeks (fewer first), then profile id, then role id.
//   3. Walk the list: assign if the person is still free and the role still has openings.
// People left over are listed as unassigned with the reason.
import { displayWeeks } from "../../shared/engine.js";
import type { Services } from "../context.ts";
import type { FullGraph } from "../kb.ts";
import { loadProfile, type Profile } from "../repo.ts";
import { costFor, engineFor, stepsFor, type ExtraReq, type Mode } from "./planning.ts";

export const ASSIGNMENT_RULE = "Greedy suggestion: options ready by the role's deadline, sorted by match % (high first), then fewer weeks; each person gets at most one role and each role at most its openings. HR decides.";

const DAY_MS = 86_400_000;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const toDate = (v: any) => (typeof v === "string" ? v.slice(0, 10) : new Date(v).toISOString().slice(0, 10));

export interface OpenRole { id: number; job: string; title: string; openings: number; deadline: string }

/** One person's options for each open role. Employer-specific requirements for a role are included. */
export function optionsFor(graph: FullGraph, p: Profile, roles: OpenRole[], extraByJob: Record<string, ExtraReq[]>, opts: { year: number; scenario: "slow" | "moderate" | "fast"; mode: Mode; now: Date }) {
  const E = engineFor(graph, p, opts.year, opts.scenario);
  return roles.map(role => {
    const extra = extraByJob[role.job] || [];
    const plan = E.planFor(role.job, opts.mode, extra as any);
    const cost = costFor(graph, stepsFor(graph, E, plan, p.hours));
    const weeks = plan.route ? displayWeeks(plan.ready, p.hours) : null;
    const readyBy = weeks == null ? null : isoDate(new Date(opts.now.getTime() + weeks * 7 * DAY_MS));
    return {
      roleId: role.id, job: role.job, title: role.title, match: E.match(role.job, extra as any), weeks, weeksRef: plan.route ? plan.ready : null, routeKey: plan.route?.key ?? null,
      costRm: cost.totalRm, hrdClaimableRm: cost.hrdClaimableRm, unknownCostCount: cost.unknownCount,
      readyBy, deadline: role.deadline, onTime: readyBy != null && readyBy <= role.deadline,
    };
  });
}

/** Greedy assignment over all options (see the rule at the top of this file). */
export function assign(team: { profileId: number; options: ReturnType<typeof optionsFor> }[], roles: OpenRole[]) {
  const left = new Map(roles.map(r => [r.id, r.openings]));
  const pairs = team.flatMap(m => m.options.filter(o => o.onTime).map(o => ({ profileId: m.profileId, ...o })))
    .sort((a, b) => b.match - a.match || a.weeks! - b.weeks! || a.profileId - b.profileId || a.roleId - b.roleId);
  const done = new Set<number>();
  const assignment: (typeof pairs)[number][] = [];
  for (const p of pairs) {
    if (done.has(p.profileId) || (left.get(p.roleId) || 0) < 1) continue;
    done.add(p.profileId); left.set(p.roleId, left.get(p.roleId)! - 1);
    assignment.push(p);
  }
  return { assignment, openingsLeft: Object.fromEntries(left) };
}

export async function redeployment(svc: Services, graph: FullGraph, employerId: number, opts: { year: number; scenario: "slow" | "moderate" | "fast"; mode?: Mode }) {
  const emp = (await svc.db.query("select * from employers where id=$1", [employerId])).rows[0] as any;
  if (!emp) return null;
  const roles: OpenRole[] = ((await svc.db.query("select * from open_roles where employer_id=$1 order by deadline, id", [employerId])).rows as any[])
    .filter(r => graph.nodes[r.occupation_id]?.type === "job")
    .map(r => ({ id: r.id, job: r.occupation_id, title: graph.nodes[r.occupation_id].name, openings: r.openings, deadline: toDate(r.deadline) }));
  const extraByJob: Record<string, ExtraReq[]> = {};
  for (const q of (await svc.db.query("select * from employer_requirements where employer_id=$1 order by id", [employerId])).rows as any[])
    if (graph.nodes[q.skill_id]) (extraByJob[q.occupation_id] ||= []).push({ skill: q.skill_id, weight: q.weight, need: q.level_needed, status: "employer" });
  const ids = (await svc.db.query<{ id: number }>("select id from profiles where employer_id=$1 order by id", [employerId])).rows.map(r => r.id);
  const now = svc.now(), mode = opts.mode ?? "fastest";
  const team: { profileId: number; name: string; hours: number; current: { occupationId: string; title: string; futureScore: number }; options: ReturnType<typeof optionsFor> }[] = [];
  for (const id of ids) {
    const p = (await loadProfile(svc.db, id))!;
    const E = engineFor(graph, p, opts.year, opts.scenario);
    team.push({
      profileId: p.id, name: p.displayName, hours: p.hours,
      current: { occupationId: p.occupationId, title: graph.nodes[p.occupationId]?.name ?? p.occupationId, futureScore: E.futureScore() },
      options: optionsFor(graph, p, roles, extraByJob, { year: opts.year, scenario: opts.scenario, mode, now }),
    });
  }
  const { assignment, openingsLeft } = assign(team, roles);
  const assigned = new Set(assignment.map(a => a.profileId));
  const round2 = (x: number) => Math.round(x * 100) / 100;
  return {
    employer: { id: emp.id, name: emp.name, sector: emp.sector, source: emp.source, verified: emp.verified, isSample: emp.source === "sample" },
    year: opts.year, scenario: opts.scenario, mode, asOf: isoDate(now),
    team,
    openRoles: roles.map(r => ({ roleId: r.id, job: r.job, title: r.title, openings: r.openings, deadline: r.deadline, openingsLeft: openingsLeft[r.id] })),
    assignment: assignment.map(a => ({ profileId: a.profileId, name: team.find(t => t.profileId === a.profileId)!.name, roleId: a.roleId, job: a.job,
      match: a.match, weeks: a.weeks, readyBy: a.readyBy, costRm: a.costRm, hrdClaimableRm: a.hrdClaimableRm, unknownCostCount: a.unknownCostCount })),
    unassigned: team.filter(t => !assigned.has(t.profileId)).map(t => ({
      profileId: t.profileId, name: t.name,
      reason: t.options.some(o => o.onTime) ? "Roles they could reach in time were filled by closer matches" : "Not ready for any open role before its deadline",
    })),
    totals: {
      people: team.length, assigned: assignment.length, onTime: assignment.filter(a => a.onTime).length,
      peopleWithOnTimeOption: team.filter(t => t.options.some(o => o.onTime)).length,
      openings: roles.reduce((s, r) => s + r.openings, 0),
      costRm: round2(assignment.reduce((s, a) => s + a.costRm, 0)),
      hrdClaimableRm: round2(assignment.reduce((s, a) => s + a.hrdClaimableRm, 0)),
      unknownCostCount: assignment.reduce((s, a) => s + a.unknownCostCount, 0),
    },
    rule: ASSIGNMENT_RULE,
    note: emp.source === "sample" ? "Sample employer and synthetic team members, for demonstration only." : null,
  };
}
