// Planning: typed steps, costed route, deadline tracking, human edge, sources, SDG ranking,
// saved plans with advisor approval, route updates and profile history.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.ts";
import { loadGraph, createVersion, clearGraphCache, type FullGraph } from "../server/kb.ts";
import { loadProfile, type Profile } from "../server/repo.ts";
import { buildPlan, costFor, deadlineFor, stepsFor, engineFor, taskSplit, AHEAD_SHARE } from "../server/services/planning.ts";
import { rankBySdg, SDG_BONUS } from "../server/services/ranking.ts";
import { displayWeeks } from "../shared/engine.js";
import { testServices } from "./helpers/services.ts";
import type { Services } from "../server/context.ts";

const NOW = new Date("2026-10-23T10:00:00Z");
let svc: Services, g: FullGraph, persona: Profile;
beforeAll(async () => {
  svc = await testServices();
  g = await loadGraph(svc.db);
  persona = (await loadProfile(svc.db, 1))!;
});
const jobs = () => Object.keys(g.nodes).filter(k => g.nodes[k].type === "job");

describe("buildPlan", () => {
  it("demo persona, ESG fastest: route ap>recon>ghg>esgRole with reuse + reskill steps", () => {
    const p = buildPlan(g, persona, { job: "esgRole", mode: "fastest", now: NOW });
    expect(p.route!.key).toBe("ap>recon>ghg>esgRole");
    expect(p.mode).toBe("closest"); // "fastest" is the old name
    expect(p.keySkills).toEqual(["ghg"]);
    expect(p.steps.filter(s => s.part === "route").map(s => [s.type, s.skillId])).toEqual([["reuse", "recon"], ["reskill", "ghg"]]);
    const reuse = p.steps[0];
    expect(reuse.weeks).toBe(0);
    expect(reuse.course).toBeNull();
    const ghg = p.steps[1];
    expect(ghg.learn?.title).toBeTruthy();
    expect(ghg.practice).toBeTruthy();
    expect(ghg.prove).toBeTruthy();
    expect(p.alternatives.map(a => a!.key)).toContain("ap>audit>disc>esgRole");
    expect(p.match).toBe(57);
  });

  it("classifies every step by the documented rule, and all four types occur", () => {
    const seen = new Set<string>();
    for (const job of jobs()) for (const mode of ["fastest", "noregret", "safest"] as const) {
      const E = engineFor(g, persona);
      const p = buildPlan(g, persona, { job, mode, now: NOW });
      for (const s of p.steps) {
        seen.add(s.type);
        if (s.type === "reuse") { expect(E.owned(s.skillId)).toBe(true); expect(s.weeksRef).toBe(0); }
        if (s.type === "upskill") { expect(E.owned(s.skillId)).toBe(true); expect(s.levelFrom!).toBeLessThan(s.levelTo!); expect(s.weeksRef).toBe(s.levelTo! - s.levelFrom!); }
        if (s.type === "evolve" || s.type === "reskill") expect(E.owned(s.skillId)).toBe(false);
        if (s.type === "evolve") expect(g.edges.some(e => e.to === s.skillId && e.kind === "evolve")).toBe(true);
      }
    }
    expect([...seen].sort()).toEqual(["evolve", "reskill", "reuse", "upskill"]);
  });

  it("one weeks figure: time to job-ready from ALL missing skills, at the user's hours", () => {
    const slow = buildPlan(g, { ...persona, hours: 3 }, { job: "esgRole", now: NOW });
    const fast = buildPlan(g, { ...persona, hours: 12 }, { job: "esgRole", now: NOW });
    expect(slow.weeksReadyRef).toBe(fast.weeksReadyRef);
    expect(slow.totalHours).toBe(slow.missing.reduce((s, m) => s + m.hours, 0));
    expect(slow.weeksReadyRef).toBeCloseTo(slow.totalHours / 6, 2);
    expect(slow.weeks).toBe(displayWeeks(slow.weeksReadyRef!, 3));
    expect(fast.weeks).toBe(displayWeeks(fast.weeksReadyRef!, 12));
    expect(slow).not.toHaveProperty("weeksCore");
    const ghg = slow.missing.find(m => m.id === "ghg")!;
    expect(ghg).toMatchObject({ key: true, group: "ghg" });
    expect(slow.route!.legs.find((l: any) => l.to === "ghg")!.weeks).toBe(displayWeeks(ghg.hours / 6, 3));
    // every missing item says whether its hours are a course's or an estimate
    expect(slow.missing.every(m => typeof m.estimated === "boolean" && m.hours > 0)).toBe(true);
    expect(slow.weeksEstimated).toBe(slow.missing.some(m => m.estimated));
  });

  it("safer alternative: only when the safest route differs, with what it avoids, why, and the weeks difference", () => {
    const p = buildPlan(g, persona, { job: "esgRole", now: NOW });
    expect(p.saferAlternative).toMatchObject({ mode: "safest", route: { key: "ap>audit>disc>esgRole" }, adds: [{ id: "disc" }] });
    expect(p.saferAlternative!.avoids).toContainEqual(expect.objectContaining({ id: "recon", name: "Vendor reconciliation", reason: "exposure" }));
    expect(p.saferAlternative!.addedWeeks).toBe(p.saferAlternative!.weeks - p.weeks!);
    expect(buildPlan(g, persona, { job: "esgRole", mode: "safest", now: NOW }).saferAlternative).toBeNull();
    expect(buildPlan(g, persona, { job: "procRole", now: NOW }).saferAlternative).toBeNull(); // same road both ways
  });

  it("human edge: task split interpolated like the engine; rising skills are the engine's label", () => {
    const s = g.nodes.esgRole.split;
    expect(taskSplit(g, "esgRole", 2026, "moderate")).toEqual(s[0]);
    expect(taskSplit(g, "esgRole", 2030, "fast")).toEqual(s[2]);
    expect(taskSplit(g, "esgRole", 2028, "moderate")).toEqual([0, 1, 2].map(i => Math.round(s[0][i] + (s[1][i] - s[0][i]) * 0.5)));
    const p = buildPlan(g, persona, { job: "esgRole", now: NOW });
    expect(p.humanEdge.split).toEqual(s[0]);
    const E = engineFor(g, persona);
    expect(p.humanEdge.risingSkills.length).toBeGreaterThan(0);
    for (const r of p.humanEdge.risingSkills) expect(E.impact(r.skillId).label).toBe("Rising human skill");
    expect(p.humanEdge.risingSkills.map(r => r.skillId)).toContain("dispute");
  });

  it("employer extra requirements add steps and change the match", () => {
    const base = buildPlan(g, persona, { job: "esgRole", now: NOW });
    const withPy = buildPlan(g, persona, { job: "esgRole", now: NOW, extraReq: [{ skill: "python", weight: 3, need: 3 }] });
    expect(withPy.match).toBeLessThan(base.match);
    expect(withPy.steps.some(s => s.skillId === "python")).toBe(true);
    expect(withPy.breakdown.at(-1)).toMatchObject({ skill: "python", from: "employer" });
  });
});

describe("costed route", () => {
  it("sums known prices, separates the HRD-claimable share and counts unknown prices", () => {
    const g2: FullGraph = { ...g, courses: {
      ...g.courses,
      ghg: [{ title: "GHG course", costRm: 400, hrdClaimable: true, source: "provider-page", url: "https://example.org/ghg" }],
      disc: [{ title: "Disclosure course", costRm: 150.5, hrdClaimable: false, source: "provider-page" }],
      esgdata: [{ title: "ESG data workshop", costRm: null, hrdClaimable: true, source: "sample" }],
    } };
    const E = engineFor(g2, persona);
    const steps = stepsFor(g2, E, E.planFor("esgRole", "fastest"), 6);
    const c = costFor(g2, steps, 300);
    expect(c.items.map(i => i.skillId).sort()).toEqual(["disc", "esgdata", "ghg"]); // reuse steps cost nothing
    expect(c.totalRm).toBe(550.5);
    expect(c.hrdClaimableRm).toBe(400);
    expect(c.outOfPocketRm).toBe(150.5);
    expect(c.unknownCount).toBe(1);
    expect(c.items.find(i => i.skillId === "esgdata")!.costRm).toBeNull(); // never guessed
    expect(c.items.find(i => i.skillId === "ghg")!.source).toBe("provider-page");
    expect(c.withinBudget).toBe(true);
    expect(costFor(g2, steps, 100).withinBudget).toBe(false);
  });

  it("prefers a real course over a sample one", () => {
    const g2: FullGraph = { ...g, courses: { ...g.courses, ghg: [{ title: "Sample", source: "sample", costRm: 0 }, { title: "Real", source: "openlearning", costRm: 99 }] } };
    const E = engineFor(g2, persona);
    const steps = stepsFor(g2, E, E.planFor("esgRole", "fastest"), 6);
    expect(steps.find(s => s.skillId === "ghg")!.learn!.title).toBe("Real");
  });
});

describe("deadline tracking", () => {
  // 2026-10-23 10:00 + 140 days -> 2027-03-12: exactly 20 whole weeks available.
  const target = "2027-03-12";
  it("boundaries: ahead <= 0.75 x available < on_track <= available < behind", () => {
    expect(deadlineFor(target, 1, NOW).weeksAvailable).toBe(20);
    expect(AHEAD_SHARE).toBe(0.75);
    expect(deadlineFor(target, 15, NOW).status).toBe("ahead");
    expect(deadlineFor(target, 16, NOW).status).toBe("on_track");
    expect(deadlineFor(target, 20, NOW).status).toBe("on_track");
    expect(deadlineFor(target, 21, NOW).status).toBe("behind");
  });
  it("no date -> none; readyBy = now + weeks needed", () => {
    expect(deadlineFor(null, 10, NOW)).toMatchObject({ status: "none", weeksAvailable: null, readyBy: "2027-01-01" });
    expect(deadlineFor(target, 2, NOW).readyBy).toBe("2026-11-06");
  });
  it("a slower pace can push the plan behind", () => {
    const p = buildPlan(g, { ...persona, hours: 1, targetDate: target }, { job: "esgRole", now: NOW });
    expect(p.deadline.weeksNeeded).toBe(displayWeeks(p.weeksReadyRef!, 1));
    expect(p.deadline.status).toBe("behind");
  });
});

describe("GET /plan, /map, /rank", () => {
  it("GET /api/plan returns the full contract for the demo persona", async () => {
    const res = await request(createApp(svc)).get("/api/plan?job=esgRole&mode=fastest");
    expect(res.status).toBe(200);
    for (const k of ["kbVersion", "job", "mode", "match", "breakdown", "route", "keySkills", "missing", "weeks", "saferAlternative", "alternatives", "steps", "weeksReady", "cost", "deadline", "humanEdge", "sources"])
      expect(res.body).toHaveProperty(k);
    expect(res.body.route.key).toBe("ap>recon>ghg>esgRole");
    expect(res.body.sources.some((s: any) => s.kind === "sample")).toBe(true);
    expect(["ahead", "on_track", "behind"]).toContain(res.body.deadline.status);
  });
  it("unknown job -> 404, unknown profile -> 404, bad mode -> 400", async () => {
    const app = createApp(svc);
    expect((await request(app).get("/api/plan?job=nope")).status).toBe(404);
    expect((await request(app).get("/api/plan?job=esgRole&profile=999")).status).toBe(404);
    expect((await request(app).get("/api/plan?job=esgRole&mode=quick")).status).toBe(400);
    expect((await request(app).get("/api/plan?job=recon")).status).toBe(404); // a skill, not a job
  });
  it("sources include approved signals that changed a node on the plan, with their URL", async () => {
    const s2 = await testServices();
    const sig = await s2.db.query<{ id: number }>(`insert into signals(node_id, kind, title, delta_e, triage, status, source_url, source_date)
      values ('ghg','capability','AI tool automates emissions factor lookup',0.02,'auto','applied','https://www.reuters.com/test-article','2026-10-20') returning id`);
    await createVersion(s2.db, "Apply signal", "auto", [{ kind: "delta", nodeId: "ghg", deltaE: 0.02, signalId: sig.rows[0].id, sourceUrl: "https://www.reuters.com/test-article" }]);
    const res = await request(createApp(s2)).get("/api/plan?job=esgRole");
    const src = res.body.sources.find((x: any) => x.kind === "signal");
    expect(src).toMatchObject({ url: "https://www.reuters.com/test-article", date: "2026-10-20" });
    expect(src.label).toContain("AI tool automates emissions factor lookup");
    expect(res.body.kbVersion).toBe(2);
  });
  it("GET /api/map: best matches keep a stay-and-adapt option; sectors; bad sector 400", async () => {
    const app = createApp(svc);
    const best = await request(app).get("/api/map");
    expect(best.status).toBe(200);
    expect(best.body.jobs).toHaveLength(4);
    expect(best.body.jobs.some((j: any) => j.stay)).toBe(true);
    expect(best.body.futureScore).toBeGreaterThanOrEqual(0);
    // Without an SDG, the order equals the engine's own sectorJobs("best").
    expect(best.body.jobs.map((j: any) => j.job)).toEqual(engineFor(g, persona).sectorJobs("best"));
    const sus = await request(app).get("/api/map?sector=sustain");
    expect(sus.body.jobs.map((j: any) => j.job)).toEqual(["esgRole", "lcaRole", "greenRole", "assurRole"]);
    expect((await request(app).get("/api/map?sector=nope")).status).toBe(400);
  });
});

describe("SDG-aware ranking", () => {
  it("adds a fixed, visible bonus and reports the trade-off against the no-SDG top job", () => {
    const r = rankBySdg(g, persona, { sdg: 13, year: 2026, scenario: "moderate" });
    for (const j of r.jobs) expect(j.score).toBeCloseTo(j.scoreWithoutSdg + (j.sdgFit ? SDG_BONUS : 0), 5);
    expect(r.jobs.map(j => j.rank)).toEqual(r.jobs.map((_, i) => i + 1));
    const top = r.jobs.find(j => j.job === r.topWithoutSdg)!;
    expect(top.rankWithoutSdg).toBe(1);
    for (const j of r.jobs) {
      expect(j.tradeoff.matchDelta).toBe(j.match - top.match);
      if (j.weeks != null && top.weeks != null) expect(j.tradeoff.weeksDelta).toBe(j.weeks - top.weeks);
    }
    const esg = r.jobs.find(j => j.job === "esgRole")!;
    expect(esg.sdgFit).toBe(true);
    expect(esg.rank).toBeLessThan(esg.rankWithoutSdg);
    expect(r.jobs.find(j => j.job === "stayRole")!.sdgFit).toBe(false);
  });
  it("GET /api/rank needs an SDG", async () => {
    const app = createApp(svc);
    expect((await request(app).get("/api/rank")).status).toBe(400);
    const res = await request(app).get("/api/rank?sdg=13");
    expect(res.status).toBe(200);
    expect(res.body.jobs[0]).toHaveProperty("tradeoff");
    expect(res.body.bonus).toBe(SDG_BONUS);
  });
});

describe("saved plans and advisor approval", () => {
  const admin = { "x-admin-token": "secret", "x-actor": "advisor:Encik Faiz (sample)" };
  let s: Services;
  beforeAll(async () => { s = await testServices({ config: { adminToken: "secret" } }); });

  async function newPlan(app: any, job = "esgRole") {
    const r = await request(app).post("/api/plans").send({ profileId: 1, job, mode: "fastest" });
    expect(r.status).toBe(201);
    return r.body.plan;
  }

  it("draft -> sent -> approved, with audit and only legal transitions", async () => {
    const app = createApp(s);
    const plan = await newPlan(app);
    expect(plan).toMatchObject({ status: "draft", job: "esgRole", kbVersion: 1 });
    expect(plan.route.key).toBe("ap>recon>ghg>esgRole");
    // Advisor cannot decide on a draft.
    expect((await request(app).post(`/api/plans/${plan.id}/decision`).set(admin).send({ decision: "approve" })).status).toBe(409);
    const sent = await request(app).post(`/api/plans/${plan.id}/send`).send({ note: "Please check" });
    expect(sent.body.plan).toMatchObject({ status: "sent", userNote: "Please check" });
    expect((await request(app).post(`/api/plans/${plan.id}/send`).send({})).status).toBe(409);
    // Admin-only.
    expect((await request(app).get("/api/advisor/queue")).status).toBe(401);
    const q = await request(app).get("/api/advisor/queue").set(admin);
    const item = q.body.plans.find((p: any) => p.id === plan.id);
    expect(item.profile).toMatchObject({ id: 1, occupationId: "ap", matchNow: 57 });
    expect((await request(app).post(`/api/plans/${plan.id}/decision`).send({ decision: "approve" })).status).toBe(401);
    const ok = await request(app).post(`/api/plans/${plan.id}/decision`).set(admin).send({ decision: "approve", note: "Good plan" });
    expect(ok.body.plan).toMatchObject({ status: "approved", advisorNote: "Good plan", decidedBy: "advisor:Encik Faiz (sample)" });
    expect((await request(app).post(`/api/plans/${plan.id}/decision`).set(admin).send({ decision: "changes", note: "x" })).status).toBe(409);
    expect((await request(app).post(`/api/plans/${plan.id}/send`).send({})).status).toBe(409);
    const log = (await s.db.query("select actor, action from audit_log where target=$1 order by id", [`plan:${plan.id}`])).rows;
    expect(log.map((l: any) => l.action)).toEqual(["plan.create", "plan.send", "plan.decision"]);
    expect(log[2].actor).toBe("advisor:Encik Faiz (sample)");
    const list = await request(app).get("/api/plans?profile=1");
    expect(list.body.plans.some((p: any) => p.id === plan.id && p.status === "approved")).toBe(true);
  });

  it("changes requested needs a note; the user can resend", async () => {
    const app = createApp(s);
    const plan = await newPlan(app, "stayRole");
    await request(app).post(`/api/plans/${plan.id}/send`).send({});
    expect((await request(app).post(`/api/plans/${plan.id}/decision`).set(admin).send({ decision: "changes" })).status).toBe(400);
    const ch = await request(app).post(`/api/plans/${plan.id}/decision`).set(admin).send({ decision: "changes", note: "Add the Python step" });
    expect(ch.body.plan.status).toBe("changes_requested");
    expect((await request(app).post(`/api/plans/${plan.id}/send`).send({})).body.plan.status).toBe("sent");
  });

  it("bad input and unknown plans", async () => {
    const app = createApp(s);
    expect((await request(app).post("/api/plans").send({ profileId: 1, job: "nope" })).status).toBe(404);
    expect((await request(app).post("/api/plans").send({ profileId: 999, job: "esgRole" })).status).toBe(404);
    expect((await request(app).post("/api/plans").send({ job: "esgRole" })).status).toBe(400);
    expect((await request(app).post("/api/plans/9999/send").send({})).status).toBe(404);
    expect((await request(app).post("/api/plans/abc/send").send({})).status).toBe(400);
  });

  it("route update: 409 with nothing pending; keep clears it; switch adopts the offered route", async () => {
    const app = createApp(s);
    const plan = await newPlan(app);
    expect((await request(app).post(`/api/plans/${plan.id}/route-update`).send({ action: "keep" })).status).toBe(409);
    const offered = { kbVersion: 2, route: { key: "ap>audit>disc>esgRole", nodes: ["ap", "audit", "disc", "esgRole"], legs: [], weeks: 7 }, previousKey: plan.route.key, reason: "Reconciliation is now mostly automated", signalId: 1 };
    await s.db.query("update plans set pending_route=$2 where id=$1", [plan.id, JSON.stringify(offered)]);
    const kept = await request(app).post(`/api/plans/${plan.id}/route-update`).send({ action: "keep" });
    expect(kept.body.plan.pendingRoute).toBeNull();
    expect(kept.body.plan.route.key).toBe("ap>recon>ghg>esgRole");
    await s.db.query("update plans set pending_route=$2 where id=$1", [plan.id, JSON.stringify(offered)]);
    const sw = await request(app).post(`/api/plans/${plan.id}/route-update`).send({ action: "switch" });
    expect(sw.body.plan.route.key).toBe("ap>audit>disc>esgRole");
    expect(sw.body.plan.kbVersion).toBe(2);
    expect(sw.body.plan.pendingRoute).toBeNull();
    expect((await request(app).post(`/api/plans/${plan.id}/route-update`).send({ action: "maybe" })).status).toBe(400);
    const log = (await s.db.query("select action, detail from audit_log where target=$1 order by id", [`plan:${plan.id}`])).rows as any[];
    expect(log.map(l => l.action)).toEqual(["plan.create", "plan.route_keep", "plan.route_switch"]);
    expect(log[2].detail.offered).toBe("ap>audit>disc>esgRole");
  });
});

describe("profile history", () => {
  it("lists snapshots and what changed between them", async () => {
    const s = await testServices();
    const app = createApp(s);
    expect((await request(app).get("/api/profile/1/history")).body.snapshots).toEqual([]);
    await request(app).post("/api/plans").send({ profileId: 1, job: "esgRole" });
    await createVersion(s.db, "Approve reconciliation signal", "admin:test", [{ kind: "delta", nodeId: "recon", deltaE: 0.18 }]);
    clearGraphCache(s.db);
    await request(app).post("/api/plans").send({ profileId: 1, job: "esgRole" });
    const h = await request(app).get("/api/profile/1/history");
    expect(h.body.snapshots).toHaveLength(2);
    expect(h.body.snapshots[0].changed).toEqual([]);
    const ch = h.body.snapshots[1].changed;
    expect(ch).toContainEqual(expect.objectContaining({ kind: "kbVersion", from: 1, to: 2 }));
    expect(ch).toContainEqual(expect.objectContaining({ kind: "route", job: "esgRole", from: "ap>recon>ghg>esgRole", to: "ap>audit>disc>esgRole" }));
    expect((await request(app).get("/api/profile/999/history")).status).toBe(404);
  });
});

describe("GET /studies", () => {
  it("side by side, spread and disagree flag; empty list with a note when none", async () => {
    const s = await testServices();
    await s.db.query("delete from exposure_studies where occupation_id='esgRole'");
    const app = createApp(s);
    const none = await request(app).get("/api/studies?job=esgRole");
    expect(none.body).toMatchObject({ job: "esgRole", studies: [], spread: 0, disagree: false });
    expect(none.body.note).toBeTruthy();
    await s.db.query(`insert into exposure_studies(occupation_id, study, value, raw_value, source_url, source) values
      ('esgRole','ILO WP140',0.30,'Gradient 2','https://www.ilo.org/x','ilo'), ('esgRole','Anthropic Economic Index',0.50,'50%','https://www.anthropic.com/x','anthropic')`);
    const two = await request(app).get("/api/studies?job=esgRole");
    expect(two.body.studies).toHaveLength(2);
    expect(two.body.spread).toBe(0.2);
    expect(two.body.disagree).toBe(true);
    await s.db.query("update exposure_studies set value=0.4 where occupation_id='esgRole' and study='ILO WP140'");
    expect((await request(app).get("/api/studies?job=esgRole")).body.disagree).toBe(false);
    expect((await request(app).get("/api/studies?job=nope")).status).toBe(404);
  });
});

describe("plans for any ESCO job (job=esco:<uuid>)", () => {
  const SOFTWARE_DEV = "esco:f2b15a0e-e65a-438a-affb-29b9d50b77d1";
  const SUSTAINABILITY_MGR = "esco:2cf2b905-3308-4b5d-8e8d-633fc7a3f3ce";
  const CALL_CENTRE = "esco:0ededdc2-050a-4ec3-8e70-6295105fcd19";

  it("returns the same plan shape: match, key route, full gap list, one weeks figure, sources with the ESCO URI", async () => {
    const app = createApp(svc);
    for (const job of [SOFTWARE_DEV, SUSTAINABILITY_MGR, CALL_CENTRE]) {
      const res = await request(app).get(`/api/plan?job=${job}`);
      expect(res.status, job).toBe(200);
      const b = res.body;
      expect(b).toMatchObject({ job, source: "esco", mode: "closest" });
      for (const k of ["route", "keySkills", "missing", "weeks", "saferAlternative", "match", "deadline", "sources"]) expect(b, `${job} ${k}`).toHaveProperty(k);
      expect(b.match).toBeGreaterThanOrEqual(0);
      // a short readable chain: you -> one of your skills -> 3-5 key stepping stones -> the job
      expect(b.keySkills.length).toBeGreaterThanOrEqual(3);
      expect(b.keySkills.length).toBeLessThanOrEqual(5);
      expect(b.route.nodes[0]).toBe("ap");
      expect(b.route.nodes.at(-1)).toBe(job);
      expect(b.route.nodes).toEqual(expect.arrayContaining(b.keySkills));
      expect(b.route.legs.length).toBe(b.route.nodes.length - 1);
      expect(b.route.legs.every((l: any) => typeof l.toName === "string" && l.toName.length > 0)).toBe(true);
      // knowledge items are in the gap list and the time, never route stops
      const ids = new Set(b.missing.map((m: any) => m.id));
      for (const k of b.keySkills) expect(ids.has(k)).toBe(true);
      for (const m of b.missing.filter((x: any) => x.type === "knowledge")) expect(b.route.nodes).not.toContain(m.id);
      expect(b.missing.every((m: any) => m.hours > 0 && typeof m.estimated === "boolean" && "group" in m && "name" in m)).toBe(true);
      expect(b.totalHours).toBe(b.missing.reduce((s: number, m: any) => s + m.hours, 0));
      expect(b.weeks).toBe(displayWeeks(b.totalHours / 6, persona.hours));
      expect(b.sources.some((s: any) => s.kind === "esco" && String(s.url).startsWith("http://data.europa.eu/esco/occupation/"))).toBe(true);
      if (b.saferAlternative) {
        expect(b.saferAlternative.route.key).not.toBe(b.route.key);
        expect(b.saferAlternative.avoids.length).toBeGreaterThan(0);
        expect(["signal", "exposure", "other"]).toContain(b.saferAlternative.avoids[0].reason);
      }
    }
  });

  it("uses the hand-made bridges across fields (Priya -> sustainability manager crosses one)", async () => {
    const b = (await request(createApp(svc)).get(`/api/plan?job=${SUSTAINABILITY_MGR}`)).body;
    expect(b.route.legs.some((l: any) => l.bridge === true && l.kind === "bridge")).toBe(true);
  });

  it("unknown ESCO ids are 404", async () => {
    const app = createApp(svc);
    expect((await request(app).get("/api/plan?job=esco:00000000-0000-0000-0000-000000000000")).status).toBe(404);
    expect((await request(app).get("/api/plan?job=esco:nope")).status).toBe(404);
  });
});
