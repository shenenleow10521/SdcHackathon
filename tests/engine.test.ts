import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createEngine, displayWeeks, MODES, normMode, edgeRel, stressTest, MONTE_CARLO, PARAMS, yearOf, HAVE_LEVEL, aiInterp, aiTide } from "../shared/engine.js";
import { seedGraph, persona, knowledge } from "./helpers/seed-graph.ts";

const golden = JSON.parse(readFileSync(new URL("./fixtures/golden.json", import.meta.url), "utf8"));

// Match, rank, taken skills, future score and best jobs still match the prototype exactly. Routes no longer do: the
// prototype's route types (fastest / no-regret / safest by weeks) became closest / safest by relatedness.
describe("engine matches the prototype exactly (scores)", () => {
  for (const c of golden.cases) {
    const label = `${c.year} ${c.scenario}${c.signal ? " +signal" : ""}`;
    it(label, () => {
      const g = seedGraph(c.signal ? { e: { [golden.signalNode]: golden.signalBoost } } : {});
      const E = createEngine(g, persona, { year: c.year, scenario: c.scenario });
      for (const [job, m] of Object.entries(c.match)) expect(E.match(job), `match ${job}`).toBe(m);
      for (const [job, r] of Object.entries(c.rank)) expect(Math.round(E.rankScore(job) * 1000) / 1000, `rank ${job}`).toBeCloseTo(r as number, 3);
      expect(Object.keys(g.nodes).filter(k => E.taken(k)).sort()).toEqual([...c.taken].sort());
      expect(E.futureScore()).toBe(c.futureScore);
      expect(E.sectorJobs("best")).toEqual(c.best);
      // a route exists to the same jobs as in the prototype
      for (const [k, p] of Object.entries<any>(c.plans)) {
        const [job, mode] = k.split(":");
        expect(!!E.planFor(job, mode).route, `route ${k}`).toBe(p.key !== null);
      }
    });
  }
});

describe("engine behaviour", () => {
  const g = seedGraph();
  it("two route types, closest (default) and safest; old names still work", () => {
    expect(MODES).toEqual(["closest", "safest"]);
    expect([normMode("fastest"), normMode("noregret"), normMode(undefined), normMode("safest")]).toEqual(["closest", "safest", "closest", "safest"]);
    const E = createEngine(g, persona);
    expect(E.shortestPath("esgRole", "fastest")!.key).toBe(E.shortestPath("esgRole")!.key);
    expect(E.shortestPath("esgRole", "noregret")!.key).toBe(E.shortestPath("esgRole", "safest")!.key);
  });

  it("ESG closest route is recon → ghg → esgRole (the bridge), and reroutes after the reconciliation signal", () => {
    const before = createEngine(g, persona).shortestPath("esgRole", "closest")!;
    expect(before.key).toBe("ap>recon>ghg>esgRole");
    const after = createEngine(seedGraph({ e: { recon: 0.18 } }), persona).shortestPath("esgRole", "closest")!;
    expect(after.key).toBe("ap>audit>disc>esgRole");
  });

  it("route order is relatedness, not time: a hand-made edge's relatedness falls with its weeks", () => {
    expect(edgeRel({ weeks: 4 })).toBe(0.5);
    expect(edgeRel({ weeks: 2 })).toBeGreaterThan(edgeRel({ weeks: 4 }));
    expect(edgeRel({ weeks: 9, rel: 0.8 })).toBe(0.8);
    const E = createEngine(g, persona);
    // a skill you have is reused at no learning time; the cost of stepping onto it is just the hop (+ AI traffic)
    expect(E.edgeCost("closest", "audit", 1)).toBeCloseTo(PARAMS.hopCost, 9);
    expect(E.edgeCost("safest", "recon", 1)).toBeGreaterThan(E.edgeCost("closest", "recon", 1));
  });

  it("time to job-ready counts every missing skill, flags estimates, and grows with distance from what you know", () => {
    const E = createEngine(g, persona);
    const p = E.planFor("esgRole");
    expect(p.keySkills).toEqual(["ghg"]);
    expect(p.missing.map(m => m.id)).toEqual(expect.arrayContaining(["ghg"]));
    expect(p.missing.every(m => m.hours > 0 && m.estimated === true)).toBe(true); // no courses in the seed graph
    expect(p.hours).toBe(p.missing.reduce((s, m) => s + m.hours, 0));
    expect(p.ready).toBeCloseTo(p.hours / PARAMS.referenceHours, 2);
    const ghg = p.missing.find(m => m.id === "ghg")!;
    expect(ghg.hours).toBe(Math.round(PARAMS.estHoursMin + PARAMS.estHoursSpan * (1 - ghg.rel)));
    // with a real course long enough, its hours are used and not flagged estimated
    const withCourse = createEngine({ ...g, courses: { ghg: [{ hours: 24, source: "provider_listing" }] } } as any, persona).planFor("esgRole");
    expect(withCourse.missing.find(m => m.id === "ghg")).toMatchObject({ hours: 24, estimated: false });
  });

  it("offers a safer route only when it differs, with what it avoids and why", () => {
    const alt = createEngine(g, persona).saferAlternative("esgRole")!;
    expect(alt.route.key).toBe("ap>audit>disc>esgRole");
    expect(alt.avoids.find(a => a.id === "recon")).toMatchObject({ owned: true, reason: "exposure" });
    expect(alt.adds).toEqual(["disc"]);
    expect(typeof alt.addedRef).toBe("number");
    // after the signal the default route already avoids reconciliation: no separate safer route
    expect(createEngine(seedGraph({ e: { recon: 0.18 } }), persona).saferAlternative("esgRole")).toBeNull();
    // the safer route names an approved signal as the reason when one raised the skill's exposure
    const sig = createEngine(seedGraph({ e: { recon: 0.05 } }), persona).saferAlternative("esgRole")!;
    expect(sig.avoids.find(a => a.id === "recon")?.reason).toBe("signal");
  });

  it("never routes through a taken skill (closed road)", () => {
    const E = createEngine(g, persona, { year: 2030, scenario: "fast" });
    for (const job of E.allJobs()) for (const mode of MODES) {
      const r = E.shortestPath(job, mode);
      if (r) for (const n of r.nodes.slice(1, -1)) expect(E.taken(n), `${job} ${mode} via ${n}`).toBe(false);
    }
  });

  it("jobs are never stopovers", () => {
    const E = createEngine(g, persona);
    for (const job of E.allJobs()) {
      const r = E.shortestPath(job, "fastest");
      if (r) expect(r.nodes.slice(1, -1).every(n => g.nodes[n].type === "skill")).toBe(true);
    }
  });

  it("match is 0–100 and rises when a required skill level rises", () => {
    const E = createEngine(g, persona);
    for (const j of E.allJobs()) { const m = E.match(j); expect(m).toBeGreaterThanOrEqual(0); expect(m).toBeLessThanOrEqual(100); }
    const better = createEngine(g, { ...persona, level: { ...persona.level, ghg: 3 } });
    expect(better.match("esgRole")).toBeGreaterThan(E.match("esgRole"));
  });

  it("one level for every job: catalogue requirements all need level 3, and a skill counts as yours at 3", () => {
    expect(HAVE_LEVEL).toBe(3);
    for (const rs of Object.values<any[]>(g.req)) for (const r of rs) expect(r.need).toBe(HAVE_LEVEL);
    const E = createEngine(g, { ...persona, level: { ...persona.level, process: 2 } });
    expect(E.owned("process")).toBe(true);   // started: on the map and a route start
    expect(E.has("process")).toBe(false);    // but not yet yours
    expect(E.has("recon")).toBe(true);       // level 4
    expect(E.coverage("process", 3)).toBeCloseTo(2 / 3, 5); // partial credit below the bar
    expect(E.planFor("opsRole", "fastest").ups).toContainEqual({ id: "process", from: 2, to: 3, weeks: 1 });
    expect(E.planFor("opsRole").missing).toContainEqual(expect.objectContaining({ id: "process", kind: "upskill", hours: PARAMS.upskillHoursPerLevel, levelFrom: 2, levelTo: 3 }));
    expect(createEngine(g, { ...persona, level: { ...persona.level, process: 3 } }).has("process")).toBe(true);
  });

  it("unconfirmed emerging skills count at half weight", () => {
    const E = createEngine(g, persona);
    const prompt = E.matchBreakdown("stayRole").find(r => r.skill === "prompt")!;
    expect(prompt.effectiveWeight).toBe(prompt.weight * 0.5);
    const aisup = E.matchBreakdown("faRole").find(r => r.skill === "aisup")!;
    expect(aisup.effectiveWeight).toBe(aisup.weight); // confirmed
  });

  it("alternatives are distinct from the best route", () => {
    const E = createEngine(g, persona);
    const best = E.shortestPath("esgRole", "fastest")!;
    const alts = E.alternatives("esgRole", "fastest");
    expect(alts.length).toBeGreaterThan(0);
    for (const a of alts) expect(a.key).not.toBe(best.key);
  });

  it("a profile with no skills still works (no crash, low match)", () => {
    const E = createEngine(g, { occupationId: "ap", level: {} });
    expect(E.futureScore()).toBe(0);
    expect(E.match("esgRole")).toBe(0);
    expect(E.shortestPath("esgRole", "fastest")).toBeNull();
  });

  it("rejects unknown occupations", () => {
    expect(() => createEngine(g, { occupationId: "nope", level: {} })).toThrow();
  });

  it("scales weeks to the user's hours", () => {
    expect(displayWeeks(6, 6)).toBe(6);
    expect(displayWeeks(6, 12)).toBe(3);
    expect(displayWeeks(1, 40)).toBe(1);
    expect(displayWeeks(0, 6)).toBe(0);
  });
});

describe("future stress test (Monte Carlo)", () => {
  const today = yearOf("2026-10-23");
  const sum = (xs: any[]) => xs.reduce((a, x) => a + x.count, 0);

  it("the AI speed scale reproduces the Slow, Moderate and Fast scenarios at -1, 0 and 1", () => {
    const g = seedGraph();
    const [e0, e1, e2] = g.nodes.recon.e;
    const slow = createEngine(g, persona, { year: 2030, scenario: "slow" }).exposure("recon");
    expect(slow).toBeCloseTo(e0 + (e1 - e0) * PARAMS.slowFactor, 6);
    expect(aiInterp([e0, e1, e2], 1, -1)).toBeCloseTo(slow, 9);
    expect(aiInterp([e0, e1, e2], 1, 0)).toBeCloseTo(e1, 9);
    expect(aiInterp([e0, e1, e2], 1, 1)).toBeCloseTo(e2, 9);
    expect(aiTide(1, 1)).toBe(1);
    expect(aiTide(1, 0)).toBeCloseTo(PARAMS.moderateTide, 9);
  });

  it("uses 1,000 futures by default, and the number of runs is configurable", () => {
    expect(MONTE_CARLO.runs).toBe(1000);
    expect(stressTest(seedGraph(), persona, "esgRole", "fastest", { startYear: today }).runs).toBe(1000);
    expect(stressTest(seedGraph(), persona, "esgRole", "fastest", { startYear: today, runs: 250 }).runs).toBe(250);
  });

  it("a short plan with no deadline works in every future", () => {
    const r = stressTest(seedGraph(), persona, "esgRole", "noregret", { startYear: today });
    expect(r.works).toBe(r.runs);
    expect(r.rate).toBe(100);
    expect(r.patterns).toEqual([]);
  });

  it("is deterministic: same plan, same number; another seed gives other draws", () => {
    const opts = { startYear: today, deadlineYear: yearOf("2027-04-23") };
    const a = stressTest(seedGraph(), persona, "dataRole", "fastest", opts);
    const b = stressTest(seedGraph(), persona, "dataRole", "fastest", opts);
    expect(b).toEqual(a);
    const c = stressTest(seedGraph(), persona, "dataRole", "fastest", { ...opts, seed: a.seed + 1 });
    expect(c.works).not.toBe(a.works);
  });

  it("fails 'ready' when study time drops and the deadline is tight, and says so", () => {
    const r = stressTest(seedGraph(), persona, "dataRole", "fastest", { startYear: today, deadlineYear: yearOf("2027-04-23") });
    expect(r.works).toBeGreaterThan(0);
    expect(r.works).toBeLessThan(r.runs);
    expect(r.patterns[0]).toMatchObject({ check: "ready", skill: null });
    expect(r.patterns[0].when[0]).toMatchObject({ factor: "hours", dir: "low" });
    expect((r.patterns[0].when[0] as any).below).toBeLessThan(persona.hours);
  });

  it("fails 'open' when AI takes over a route skill before you reach it, and suggests a sturdier route", () => {
    const r = stressTest(seedGraph({ e: { recon: 0.05 } }), persona, "esgRole", "fastest", { startYear: 2029.6 });
    expect(r.patterns[0]).toMatchObject({ check: "open", skill: "recon" });
    expect(r.sturdier[0]).toMatchObject({ kind: "mode" });
    expect(r.sturdier[0].rate).toBeGreaterThan(r.rate);
    expect(r.sturdier[0].route?.nodes).not.toContain("recon");
  });

  it("fails 'worth' when demand for the job falls", () => {
    const r = stressTest(seedGraph({ d: { esgRole: -100 } }), persona, "esgRole", "fastest", { startYear: today });
    expect(r.works).toBe(0);
    expect(r.rate).toBe(0);
    expect(r.patterns[0]).toMatchObject({ check: "worth", count: r.runs, share: 100 });
  });

  it("keeps the rate in 0..100, counts each failing future once, and only suggests changes that raise the rate", () => {
    const cases: [any, string, string, any][] = [
      [seedGraph(), "dataRole", "fastest", { startYear: today, deadlineYear: yearOf("2027-04-23") }],
      [seedGraph(), "esgRole", "safest", { startYear: today, deadlineYear: yearOf("2027-04-24") }],
      [seedGraph({ e: { recon: 0.05 } }), "esgRole", "fastest", { startYear: 2029.6 }],
    ];
    for (const [g, job, mode, opts] of cases) {
      const r = stressTest(g, persona, job, mode, opts);
      expect(r.rate).toBeGreaterThanOrEqual(0);
      expect(r.rate).toBeLessThanOrEqual(100);
      expect(sum(r.patterns)).toBe(r.runs - r.works);
      expect(r.patterns.every((p: any) => p.share > 0 && p.share <= 100 && p.when.length <= 2)).toBe(true);
      expect(r.sturdier.every((s: any) => s.rate > r.rate)).toBe(true);
    }
  });

  it("a tip's rate is exactly what you get after making that change (same futures)", () => {
    const opts = { startYear: today, deadlineYear: yearOf("2027-01-25") };
    const r = stressTest(seedGraph(), persona, "esgRole", "safest", opts);
    const hoursTip = r.sturdier.find((s: any) => s.kind === "hours");
    expect(hoursTip).toBeTruthy();
    expect(stressTest(seedGraph(), { ...persona, hours: hoursTip!.hours }, "esgRole", "safest", opts).works).toBe(hoursTip!.works);
    for (const s of r.sturdier.filter((x: any) => x.kind === "mode"))
      expect(stressTest(seedGraph(), persona, "esgRole", s.mode, opts).works).toBe(s.works);
  });

  it("is fast: 10,000 futures well under a second in Node", () => {
    const t0 = performance.now();
    const r = stressTest(seedGraph(), persona, "dataRole", "fastest", { startYear: today, deadlineYear: yearOf("2027-04-23"), runs: 10000 });
    expect(r.runs).toBe(10000);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe("SDG mapping (README must-have)", () => {
  it("every job and skill has at least one SDG tag with a reason, using a goal the app defines", () => {
    const goals = new Set(Object.keys(knowledge.sdgs).map(Number));
    const tags = [...knowledge.occupations.flatMap((o: any) => o.sdg), ...knowledge.skills.map((s: any) => s.sdg)];
    expect(knowledge.occupations.every((o: any) => o.sdg.length > 0)).toBe(true);
    expect(knowledge.skills.every((s: any) => Array.isArray(s.sdg))).toBe(true);
    for (const [goal, why] of tags) { expect(goals.has(goal)).toBe(true); expect(String(why).trim().length).toBeGreaterThan(5); }
  });
});
