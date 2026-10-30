import { describe, it, expect, afterAll } from "vitest";
import { existsSync, statSync } from "node:fs";
import { loadEsco } from "../server/services/esco.ts";
import {
  buildContext, discover, evidence, checkPair, sparseCos, dwaIdf, activityKeys, decodeBridges, setBridges, loadBridges, bridgesFrom, allApproved,
  BRIDGES_FILE, BRIDGE_PARAMS, type BridgeInput,
} from "../server/services/bridges.ts";

// Tiny world, two fields. Finance: accountant + bookkeeper (O*NET code ACC) and auditor (code AUD).
// Environment: environmental officer (code ENV). "reconcile" (finance) and "check emissions" (environment) never share a
// job, but both verify figures against source records: a bridge. "audit check" verifies too, but it sits in finance
// (it is listed with the same skills as reconcile), so it is a same-field link, not a bridge. "meet clients" is an
// activity every O*NET occupation has, so idf gives it no weight. The cook is there so "verify" is not universal.
const tasks: BridgeInput["tasks"] = {
  "ACC#1": { text: "Verify figures against source documents.", dwas: ["verify"] },
  "ACC#2": { text: "Post entries to the ledger.", dwas: ["record"] },
  "ACC#3": { text: "Meet clients.", dwas: ["meet"] },
  "ENV#1": { text: "Check emissions data against source records.", dwas: ["verify", "envdata"] },
  "ENV#2": { text: "Collect air samples.", dwas: ["sample"] },
  "ENV#3": { text: "Meet clients.", dwas: ["meet"] },
  "AUD#1": { text: "Verify financial figures.", dwas: ["verify"] },
  "AUD#2": { text: "Examine internal controls.", dwas: ["control"] },
  "AUD#3": { text: "Meet clients.", dwas: ["meet"] },
  "COOK#1": { text: "Cook meals.", dwas: ["cook"] },
  "COOK#2": { text: "Meet clients.", dwas: ["meet"] },
};
const rel: Record<string, Record<string, number>> = {
  reconcile: { "ACC#1": 0.8, "ACC#3": 0.6 },
  ledger: { "ACC#2": 0.8, "AUD#2": 0.5 },
  emissions: { "ENV#1": 0.8, "ENV#3": 0.6 },
  sampling: { "ENV#2": 0.8 },
  auditCheck: { "AUD#1": 0.8, "AUD#2": 0.6 },
  cooking: { "COOK#1": 0.9 },
};
const code: Record<string, string> = { accountant: "ACC", bookkeeper: "ACC", envOfficer: "ENV", auditor: "AUD", cook: "COOK" };
const fixture: BridgeInput = {
  skills: {
    reconcile: { title: "reconcile accounts" }, ledger: { title: "keep ledger" }, emissions: { title: "check emissions" },
    sampling: { title: "take samples" }, auditCheck: { title: "audit check" }, cooking: { title: "cook food" }, taxLaw: { title: "tax law", type: "knowledge" },
  },
  occupations: {
    accountant: { title: "accountant", isco: "2411", essential: ["reconcile", "ledger"], optional: ["taxLaw"] },
    bookkeeper: { title: "bookkeeper", isco: "4311", essential: ["reconcile", "ledger"], optional: [] },
    envOfficer: { title: "environmental officer", isco: "2133", essential: ["emissions", "sampling"], optional: [] },
    auditor: { title: "auditor", isco: "2411", essential: ["auditCheck", "ledger"], optional: [] },
    cook: { title: "cook", isco: "5120", essential: ["cooking"], optional: [] },
  },
  onetOf: o => code[o],
  onetTasks: { ACC: ["ACC#1", "ACC#2", "ACC#3"], ENV: ["ENV#1", "ENV#2", "ENV#3"], AUD: ["AUD#1", "AUD#2", "AUD#3"], COOK: ["COOK#1", "COOK#2"] },
  tasks,
  dwaTitle: { verify: "Verify accuracy of records.", record: "Maintain records.", meet: "Meet with clients.", envdata: "Collect environmental data.", sample: "Collect samples.", cook: "Cook food.", control: "Evaluate controls." },
  skillTaskCos: (s, t) => rel[s]?.[t] ?? 0.3,
  skillCos: (a, b) => (a === "emissions" && b === "sampling") || (a === "sampling" && b === "emissions") ? 0.8 : 0.6,
};

describe("bridge math", () => {
  const ctx = buildContext(fixture, { minScore: 0.2, minMass: 1 });

  it("idf gives an activity every occupation has no weight", () => {
    const idf = dwaIdf(fixture);
    expect(idf.get("D|meet")).toBe(0);
    expect(idf.get("D|verify")!).toBeGreaterThan(0);
    expect(idf.get("D|envdata")!).toBeGreaterThan(idf.get("D|verify")!); // rarer counts more
  });

  it("profiles come from the tasks about the skill, normalised, knowledge items left out", () => {
    const p = ctx.profiles.get("reconcile")!;
    // record is not about reconciling; meet has idf 0. (Fixture ids have no hierarchy, so each level repeats the id.)
    expect([...p.keys.keys()].sort()).toEqual(["D|verify", "G|verify", "I|verify"]);
    expect(sparseCos(p.keys, p.keys)).toBeCloseTo(1, 6);
    expect(ctx.profiles.has("taxLaw")).toBe(false);
    expect(p.tasks.map(t => t.task)).toContain("ACC#1");
  });

  it("finds the cross-field bridge and gates the same-field look-alike", () => {
    const found = discover(ctx);
    const to = (s: string) => (found.get(s) || []).map(c => c.to);
    expect(to("reconcile")).toContain("emissions");
    expect(to("emissions")).toContain("reconcile");
    expect(to("reconcile")).not.toContain("auditCheck");
    expect(checkPair("reconcile", "auditCheck", ctx).gate).toBe("context");
    expect(checkPair("reconcile", "ledger", ctx).gate).toBe("cooccur");
    expect(checkPair("reconcile", "taxLaw", ctx).gate).toBe("knowledge");
    for (const list of found.values()) for (const c of list) { expect(c.score).toBeGreaterThanOrEqual(0.2); expect(c.score).toBeLessThanOrEqual(c.work + 1e-9); }
  });

  it("the embedding floor vetoes pairs that look unrelated", () => {
    const strict = buildContext(fixture, { minScore: 0.2, minMass: 1, minCos: 0.7 });
    expect(checkPair("reconcile", "emissions", strict).gate).toBe("embedding");
    expect(discover(strict).get("reconcile")).toBeUndefined();
  });

  it("evidence is the shared activity and the real tasks and occupations on each side", () => {
    const ev = evidence("reconcile", "emissions", ctx);
    expect(ev.keys).toEqual(["D|verify"]); // the IWA/GWA keys under it are not repeated
    expect(ev.tasksFrom).toEqual(["ACC#1"]);
    expect(ev.tasksTo).toEqual(["ENV#1"]);
    expect(ev.occFrom.sort()).toEqual(["accountant", "bookkeeper"]);
    expect(ev.occTo).toEqual(["envOfficer"]);
  });

  it("O*NET's activity hierarchy gives partial credit: same GWA only = the GWA share of the cosine", () => {
    expect(activityKeys("4.A.2.a.3.I03.D05")).toEqual(["D|4.A.2.a.3.I03.D05", "I|4.A.2.a.3.I03", "G|4.A.2.a.3"]);
    // "Examine financial records" and "Evaluate green operations for compliance" sit in different DWAs and IWAs,
    // but both under GWA 4.A.2.a.3 (Evaluating Information to Determine Compliance with Standards).
    const soft: BridgeInput = { ...fixture, tasks: { ...tasks,
      "ACC#1": { text: "Examine financial records.", dwas: ["4.A.2.a.3.I03.D01"] },
      "ENV#1": { text: "Evaluate green operations for compliance.", dwas: ["4.A.2.a.3.I02.D02"] } } };
    const c = buildContext(soft, { minScore: 0.1 });
    const lw = BRIDGE_PARAMS.levelWeights;
    expect(checkPair("reconcile", "emissions", c).work).toBeCloseTo(lw.gwa / (lw.dwa + lw.iwa + lw.gwa), 6);
    const exact = buildContext(soft, { minScore: 0.1, levelWeights: { dwa: 1, iwa: 0, gwa: 0 } });
    expect(checkPair("reconcile", "emissions", exact).work).toBe(0); // DWAs alone never meet across fields here
  });

  it("decodes the compact file, approved first", () => {
    const file = {
      _meta: { test: true }, skills: ["a", "b", "c"], titles: ["A", "B", "C"], fields: ["24", "21", null],
      activities: ["Verify accuracy of records."], tasks: ["t1", "t2"], occs: [["o1", "accountant"], ["o2", "environmental officer"]],
      bridges: [[0, 1, 812, 0, 0, [0], [0], [1], [0], [1]], [0, 2, 400, 1, 1, [], [], [], [], [], "team reason"]],
    };
    setBridges(decodeBridges(file));
    const out = bridgesFrom("a");
    expect(out.map(b => b.to)).toEqual(["c", "b"]);
    expect(out[1]).toMatchObject({ score: 0.812, status: "proposed", source: "discovered", fields: ["24 Business and administration professionals", "21 Science and engineering professionals"], families: ["business & administration", "science & engineering"] });
    expect(out[1].evidence).toEqual({ sharedActivities: ["Verify accuracy of records."], tasksFrom: ["t1"], tasksTo: ["t2"], occFrom: ["accountant"], occTo: ["environmental officer"] });
    expect(out[0]).toMatchObject({ status: "approved", source: "team", why: "team reason" });
    expect(allApproved()).toHaveLength(1);
    expect(bridgesFrom("zzz")).toEqual([]);
  });
  afterAll(() => setBridges(null));
});

// Guards on the shipped artefact (skipped until scripts/discover-bridges.ts build has run).
describe.skipIf(!existsSync(BRIDGES_FILE))("esco_bridges.json.gz artefact", () => {
  const esco = loadEsco()!;
  const loaded = () => { setBridges(null); return loadBridges()!; };

  it("is compact and cites O*NET and ESCO", () => {
    expect(statSync(BRIDGES_FILE).size).toBeLessThan(10e6);
    const m = loaded().meta;
    expect(m.sources.onetLicence).toMatch(/O\*NET 30\.2 Database by the U\.S\. Department of Labor/);
    expect(m.sources.onetLicence).toMatch(/CC BY 4\.0/);
    expect(m.sources.esco).toMatch(/ESCO/);
    expect(m.counts.discovered).toBeGreaterThan(10000);
  });

  it("every discovered bridge is proposed, crosses fields, joins practical skills, and carries data evidence", () => {
    const { bridges } = loaded();
    const jobsOf = new Map<string, Set<string>>();
    for (const [oid, o] of Object.entries<any>(esco.occupations)) for (const s of [...o.essential, ...o.optional]) { if (!jobsOf.has(s)) jobsOf.set(s, new Set()); jobsOf.get(s)!.add(oid); }
    const disc = bridges.filter(b => b.source === "discovered");
    for (const b of disc) {
      expect(b.status).toBe("proposed");
      expect(b.from).not.toBe(b.to);
      expect(esco.skills[b.from].type).not.toBe("knowledge");
      expect(esco.skills[b.to].type).not.toBe("knowledge");
      expect(b.score).toBeGreaterThanOrEqual(BRIDGE_PARAMS.minScore);
      expect(b.evidence.sharedActivities.length).toBeGreaterThan(0);
      expect(b.evidence.tasksFrom.length).toBeGreaterThan(0);
      expect(b.evidence.tasksTo.length).toBeGreaterThan(0);
      expect(b.evidence.occFrom.length).toBeGreaterThan(0);
      expect(b.evidence.occTo.length).toBeGreaterThan(0);
    }
    // No ESCO occupation lists both ends (checked on a sample: the full check is O(bridges x jobs)).
    for (const b of disc.filter((_, i) => i % 50 === 0)) {
      const a = jobsOf.get(b.from)!;
      for (const o of jobsOf.get(b.to)!) expect(a.has(o)).toBe(false);
    }
    const perSource = new Map<string, number>();
    for (const b of disc) perSource.set(b.from, (perSource.get(b.from) || 0) + 1);
    expect(Math.max(...perSource.values())).toBeLessThanOrEqual(BRIDGE_PARAMS.perSkill);
    const inDeg = new Map<string, number>();
    for (const b of disc) inDeg.set(b.to, (inDeg.get(b.to) || 0) + 1);
    expect(Math.max(...inDeg.values())).toBeLessThanOrEqual(BRIDGE_PARAMS.maxInDegree);
    for (const b of disc) expect(b.families[0]).not.toBe(b.families[1]); // different fields, not just different skill levels
  });

  it("carries the team's hand-made routes as approved, including reconciliation -> carbon", () => {
    const approved = (loaded(), allApproved());
    expect(approved.length).toBeGreaterThanOrEqual(25);
    expect(approved.every(b => b.source === "team" && b.why)).toBe(true);
    const recon = "5f1ebff6-98ec-411f-a1d4-0bf04bd03bdf"; // check accounting records (catalogue "recon")
    expect(bridgesFrom(recon).some(b => b.status === "approved" && /carbon/.test(b.toTitle))).toBe(true);
  });
  afterAll(() => setBridges(null));
});
