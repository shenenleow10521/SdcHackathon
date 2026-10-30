import { describe, it, expect, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { loadEsco } from "../server/services/esco.ts";
import {
  buildSkillNetwork, combine, npmi, encodeNetwork, decodeNetwork, setSkillNetwork, neighbours, relatedness, NETWORK_FILE, type NetworkInput,
} from "../server/services/skill-network.ts";

// Tiny world: 6 jobs. "ledger" and "reconcile" always come together (bookkeeping jobs); "spreadsheet" is in every
// job (generic); "prompt AI" and "prompt actors" look alike to the embedding but never share a job.
const vec: Record<string, number[]> = {
  ledger: [1, 0.2, 0], reconcile: [0.95, 0.3, 0], spreadsheet: [0.6, 0.6, 0.5],
  promptAI: [0, 1, 0.1], promptActors: [0, 0.98, 0.15], stage: [0.1, 0.9, 0.3], tax: [0.9, 0.1, 0.1], taxLaw: [0.88, 0.12, 0.1],
};
const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0) / Math.hypot(...a) / Math.hypot(...b);
const fixture: NetworkInput = {
  occupations: {
    clerk: { essential: ["ledger", "reconcile", "spreadsheet"], optional: ["tax"] },
    bookkeeper: { essential: ["ledger", "reconcile", "spreadsheet", "tax"], optional: [] },
    accountant: { essential: ["ledger", "reconcile", "spreadsheet", "taxLaw"], optional: [] },
    analyst: { essential: ["promptAI", "spreadsheet"], optional: [] },
    stageManager: { essential: ["promptActors", "stage", "spreadsheet"], optional: [] },
    director: { essential: ["promptActors", "stage", "spreadsheet"], optional: [] },
  },
  skills: { ledger: {}, reconcile: {}, spreadsheet: {}, promptAI: {}, promptActors: {}, stage: {}, tax: {}, taxLaw: { type: "knowledge" } },
  cosine: (a, b) => (vec[a] && vec[b] ? cos(vec[a], vec[b]) : null),
};

describe("skill network math", () => {
  it("NPMI: 1 for skills that always co-occur, 0 for independent, negative for avoiding", () => {
    expect(npmi(2, 2, 2, 10)).toBeCloseTo(1, 6);
    expect(npmi(1, 2, 5, 10)).toBeCloseTo(0, 6);
    expect(npmi(1, 5, 5, 10)).toBeLessThan(0);
  });

  it("needs both signals, and stays in [0,1]", () => {
    expect(combine(0.8, 3, 0.9)).toBeGreaterThan(0);
    expect(combine(0.8, 3, 0.9)).toBeLessThanOrEqual(1);
    expect(combine(0.8, 3, 0.4)).toBe(0); // co-occur but mean different things
    expect(combine(0, 3, 0.99)).toBe(0);  // look alike but no shared jobs
    expect(combine(0.8, 1, 0.9)).toBeLessThan(combine(0.8, 5, 0.9)); // less evidence, weaker link
  });

  const net = buildSkillNetwork(fixture);
  const ids = (s: string) => (net.get(s) || []).map(([b]) => b);

  it("links skills that jobs need together and that mean similar things", () => {
    expect(ids("ledger")[0]).toBe("reconcile");
    expect(ids("reconcile")).toContain("ledger");
  });

  it("generic skills don't link to everything, false friends don't link, knowledge stays apart from skills", () => {
    expect(ids("spreadsheet")).toHaveLength(0);
    expect(ids("promptAI")).not.toContain("promptActors");
    expect(ids("promptActors")).toContain("stage");
    expect(ids("tax")).not.toContain("taxLaw");
    for (const list of net.values()) for (const [, r] of list) { expect(r).toBeGreaterThan(0); expect(r).toBeLessThanOrEqual(1); }
  });

  it("round-trips through the compact file format and answers neighbours / relatedness", () => {
    setSkillNetwork(decodeNetwork(JSON.parse(JSON.stringify(encodeNetwork(net, { test: true })))));
    expect(neighbours("ledger")[0][0]).toBe("reconcile");
    expect(relatedness("ledger", "reconcile")).toBeCloseTo(net.get("ledger")![0][1], 3);
    expect(relatedness("reconcile", "ledger")).toBeCloseTo(relatedness("ledger", "reconcile"), 3);
    expect(relatedness("ledger", "promptAI")).toBe(0);
    expect(relatedness("ledger", "ledger")).toBe(1);
    expect(neighbours("nope")).toEqual([]);
  });
  afterAll(() => setSkillNetwork(null));
});

describe.skipIf(!existsSync(NETWORK_FILE) || !loadEsco())("built ESCO skill network", () => {
  const CHECK_ACCOUNTING_RECORDS = "5f1ebff6-98ec-411f-a1d4-0bf04bd03bdf";
  const PROMPT_PERFORMERS = "e44a0396-77e2-4d57-8c80-36796238f80c";
  it("loads and gives sensible accounting neighbours", () => {
    setSkillNetwork(null);
    const nb = neighbours(CHECK_ACCOUNTING_RECORDS);
    expect(nb.length).toBeGreaterThan(3);
    expect(nb.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < nb.length; i++) expect(nb[i - 1][1]).toBeGreaterThanOrEqual(nb[i][1]);
    expect(relatedness(CHECK_ACCOUNTING_RECORDS, nb[0][0])).toBe(nb[0][1]);
  });
  it("does not link the 'prompt performers' false friend to AI skills", () => {
    const titles = neighbours(PROMPT_PERFORMERS).map(([id]) => loadEsco()!.skills[id].title);
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.some(t => /artificial intelligence|machine learning|data/i.test(t))).toBe(false);
  });
});
