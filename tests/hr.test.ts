// HR redeployment: the sample team seed, per-person options, the greedy assignment rule and totals.
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.ts";
import { clearGraphCache } from "../server/kb.ts";
import { assign } from "../server/services/hr.ts";
import { HR_SAMPLE_EMPLOYER } from "../server/seed/hr.ts";
import { testServices } from "./helpers/services.ts";
import type { Services } from "../server/context.ts";
import { displayWeeks } from "../shared/engine.js";

async function hrEmployerId(svc: Services) {
  return (await svc.db.query<{ id: number }>("select id from employers where name=$1", [HR_SAMPLE_EMPLOYER])).rows[0].id;
}
const opt = (o: any) => ({ roleId: 1, job: "x", title: "x", match: 50, weeks: 5, routeKey: "k", costRm: 0, hrdClaimableRm: 0, unknownCostCount: 0, readyBy: "2027-01-01", deadline: "2027-04-01", onTime: true, ...o });

describe("assignment rule (greedy by match, within openings and deadlines)", () => {
  const roles = [{ id: 1, job: "a", title: "A", openings: 1, deadline: "2027-04-01" }, { id: 2, job: "b", title: "B", openings: 2, deadline: "2027-04-01" }];
  it("gives a one-opening role to the best match, and each person at most one role", () => {
    const team = [
      { profileId: 10, options: [opt({ roleId: 1, match: 80 }), opt({ roleId: 2, match: 79 })] },
      { profileId: 11, options: [opt({ roleId: 1, match: 70 }), opt({ roleId: 2, match: 40 })] },
      { profileId: 12, options: [opt({ roleId: 1, match: 90, onTime: false }), opt({ roleId: 2, match: 30 })] },
    ];
    const { assignment, openingsLeft } = assign(team as any, roles);
    expect(assignment.map(a => [a.profileId, a.roleId])).toEqual([[10, 1], [11, 2], [12, 2]]);
    expect(openingsLeft).toEqual({ 1: 0, 2: 0 });
  });
  it("never assigns a late option, and breaks match ties by fewer weeks", () => {
    const team = [
      { profileId: 1, options: [opt({ roleId: 1, match: 60, weeks: 9 })] },
      { profileId: 2, options: [opt({ roleId: 1, match: 60, weeks: 4 })] },
      { profileId: 3, options: [opt({ roleId: 2, match: 99, onTime: false })] },
    ];
    const { assignment } = assign(team as any, roles);
    expect(assignment.map(a => a.profileId)).toEqual([2]);
  });
});

describe("GET /api/hr/:employerId/redeployment", () => {
  it("seeds a clearly labelled sample team", async () => {
    const svc = await testServices();
    const id = await hrEmployerId(svc);
    const team = (await svc.db.query("select display_name, is_demo from profiles where employer_id=$1", [id])).rows as any[];
    expect(team.length).toBe(6);
    for (const m of team) { expect(m.display_name).toMatch(/\(sample\)$/); expect(m.is_demo).toBe(false); }
    expect((await svc.db.query("select count(*)::int as n from open_roles where employer_id=$1", [id])).rows[0].n).toBe(4);
  });

  it("options, onTime flags, an assignment within openings, and totals", async () => {
    const svc = await testServices();
    const id = await hrEmployerId(svc);
    // Fixed deadlines relative to the test clock (2026-10-23): faRole is due in a week, so nobody makes it.
    await svc.db.query("update open_roles set deadline='2027-04-23' where employer_id=$1", [id]);
    await svc.db.query("update open_roles set deadline='2026-10-30' where employer_id=$1 and occupation_id='faRole'", [id]);
    // Known prices for two courses so cost totals are checkable; one stays unknown (null).
    await svc.db.query("update courses set cost_rm=200, hrd_claimable=true where skill_id='prompt'");
    await svc.db.query("update courses set cost_rm=null where skill_id='aiinv'");
    clearGraphCache(svc.db);
    const res = await request(createApp(svc)).get(`/api/hr/${id}/redeployment`);
    expect(res.status).toBe(200);
    const b = res.body;
    expect(b.employer).toMatchObject({ name: HR_SAMPLE_EMPLOYER, isSample: true });
    expect(b.team).toHaveLength(6);
    expect(b.openRoles.map((r: any) => r.job).sort()).toEqual(["esgRole", "faRole", "opsRole", "stayRole"]);
    for (const m of b.team) {
      expect(m.options).toHaveLength(4);
      for (const o of m.options) {
        expect(o.onTime).toBe(o.readyBy != null && o.readyBy <= o.deadline);
        if (o.job === "faRole") expect(o.onTime).toBe(false);
      }
    }
    // Openings respected, people assigned once, only on-time options.
    const perRole: Record<string, number> = {};
    for (const a of b.assignment) perRole[a.roleId] = (perRole[a.roleId] || 0) + 1;
    for (const r of b.openRoles) expect(perRole[r.roleId] || 0).toBeLessThanOrEqual(r.openings);
    expect(new Set(b.assignment.map((a: any) => a.profileId)).size).toBe(b.assignment.length);
    expect(b.assignment.some((a: any) => a.job === "faRole")).toBe(false);
    for (const a of b.assignment) {
      const o = b.team.find((t: any) => t.profileId === a.profileId).options.find((x: any) => x.roleId === a.roleId);
      expect(o.onTime).toBe(true);
      expect(a.match).toBe(o.match);
    }
    expect(b.assignment.length + b.unassigned.length).toBe(6);
    expect(b.totals.people).toBe(6);
    expect(b.totals.assigned).toBe(b.assignment.length);
    expect(b.totals.openings).toBe(5);
    expect(b.totals.costRm).toBe(b.assignment.reduce((s: number, a: any) => s + a.costRm, 0));
    expect(b.totals.unknownCostCount).toBe(b.assignment.reduce((s: number, a: any) => s + a.unknownCostCount, 0));
    // Someone heading to stayRole learns 'prompt' (RM 200, claimable) on the way.
    const stay = b.assignment.find((a: any) => a.job === "stayRole");
    expect(stay).toBeTruthy();
    expect(stay.costRm).toBeGreaterThanOrEqual(200);
    expect(stay.hrdClaimableRm).toBeGreaterThanOrEqual(200);
    expect(b.rule).toMatch(/Greedy/);
  });

  it("weeks follow each person's own hours", async () => {
    const svc = await testServices();
    const id = await hrEmployerId(svc);
    const res = await request(createApp(svc)).get(`/api/hr/${id}/redeployment`);
    const d = res.body.team.find((t: any) => t.name.startsWith("Team member D"));  // 4 h/week
    const e = res.body.team.find((t: any) => t.name.startsWith("Team member E"));  // 10 h/week
    expect(d.hours).toBe(4);
    expect(e.hours).toBe(10);
    for (const m of [d, e]) for (const o of m.options) if (o.weeksRef != null) expect(o.weeks).toBe(displayWeeks(o.weeksRef, m.hours));
    expect(d.options.some((o: any) => o.weeksRef != null && o.weeks > o.weeksRef)).toBe(true);   // slower than the 6 h reference
    expect(e.options.some((o: any) => o.weeksRef != null && o.weeks < o.weeksRef)).toBe(true);   // faster
  });

  it("404 for unknown employer; admin token enforced when set", async () => {
    const svc = await testServices({ config: { adminToken: "t" } });
    const id = await hrEmployerId(svc);
    expect((await request(createApp(svc)).get(`/api/hr/${id}/redeployment`)).status).toBe(401);
    expect((await request(createApp(svc)).get(`/api/hr/${id}/redeployment`).set("x-admin-token", "t")).status).toBe(200);
    expect((await request(createApp(svc)).get(`/api/hr/9999/redeployment`).set("x-admin-token", "t")).status).toBe(404);
  });
});
