// Explainer: the LLM sees only a fact sheet; the code fact checker removes sentences that cite unknown ids,
// cite nothing, or contain numbers not in the cited records. Template fallback when the model is down.
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.ts";
import { loadGraph } from "../server/kb.ts";
import { loadProfile } from "../server/repo.ts";
import { factSheet, factCheck, templateSentences } from "../server/agents/explainer.ts";
import { LlmUnavailableError, createMockLlm } from "../server/lib/llm.ts";
import { testServices } from "./helpers/services.ts";

async function sheetFor(node = "esgRole") {
  const svc = await testServices();
  const g = await loadGraph(svc.db);
  const p = (await loadProfile(svc.db, 1))!;
  return factSheet(g, p, { node, mode: "fastest", year: 2026, scenario: "moderate" });
}

describe("fact sheet", () => {
  it("holds the job, its route skills, requirements and sources, each with an id", async () => {
    const s = await sheetFor();
    const ids = s.records.map(r => r.id);
    expect(ids).toEqual(expect.arrayContaining(["ctx", "esgRole", "recon", "ghg", "disc", "esgdata", "audit", "excel", "src1"]));
    expect(s.records.find(r => r.id === "esgRole")).toMatchObject({ matchPct: 57, routeWeeksAtYourPace: 6 });
    expect(s.records.find(r => r.id === "ghg")).toMatchObject({ onRoute: true, legFrom: "recon" });
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("works for a skill and rejects unknown nodes", async () => {
    const s = await sheetFor("dispute");
    expect(s.records.find(r => r.id === "dispute")).toMatchObject({ type: "skill", impact: "Rising human skill" });
    await expect(sheetFor("nope")).rejects.toMatchObject({ status: 404 });
  });
});

describe("fact checker", () => {
  it("keeps cited, supported sentences and removes the rest", async () => {
    const s = await sheetFor();
    const { kept, removed } = factCheck([
      { text: "Your match for this job is 57%.", cites: ["esgRole"] },               // ok
      { text: "GHG accounting is the next stop [ghg].", cites: [] },                  // ok: inline citation
      { text: "You will earn RM 9,000 a month.", cites: ["esgRole"] },                // invented number
      { text: "Carbon jobs are booming.", cites: [] },                                // no citation
      { text: "Python is required.", cites: ["python"] },                             // id not in the fact sheet
      { text: "Approved by the minister [madeUpId].", cites: ["esgRole"] },          // unknown inline id
      { text: "It takes ninety years.", cites: ["esgRole"] },                            // number word not in the records
      { text: "Learning GHG accounting takes four weeks.", cites: ["ghg"] },          // number word backed by the record (4)
    ], s);
    expect(kept.map(k => k.text)).toEqual(["Your match for this job is 57%.", "GHG accounting is the next stop.", "Learning GHG accounting takes four weeks."]);
    expect(kept[1].cites).toEqual(["ghg"]);
    expect(removed).toBe(5);
  });
  it("the template passes its own fact check", async () => {
    for (const node of ["esgRole", "dispute", "ap"]) {
      const s = await sheetFor(node);
      const t = templateSentences(s);
      expect(factCheck(t, s).removed).toBe(0);
    }
  });
});

describe("GET /api/explain", () => {
  it("uses the LLM with only the fact sheet, and reports removed sentences", async () => {
    const svc = await testServices({ llmHandler: () => ({ sentences: [
      { text: "Your match is 57%.", cites: ["esgRole"] },
      { text: "Your route reuses vendor reconciliation.", cites: ["recon"] },
      { text: "This job pays well.", cites: ["salary"] },
      { text: "It takes 3 years.", cites: ["esgRole"] },
    ] }) });
    const res = await request(createApp(svc)).get("/api/explain?job=esgRole");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ node: "esgRole", removed: 2, model: "mock-main", cached: false });
    expect(res.body.citations).toEqual(["esgRole", "recon"]);
    expect(res.body.text).toBe("Your match is 57%. [esgRole] Your route reuses vendor reconciliation. [recon]");
    const call = (svc.llm as ReturnType<typeof createMockLlm>).calls[0];
    const sent = JSON.parse(call.user);
    expect(sent.subject).toBe("esgRole");
    expect(sent.records.every((r: any) => typeof r.id === "string")).toBe(true);
  });

  it("falls back to the template when the model is unavailable", async () => {
    const svc = await testServices({ llmHandler: () => new LlmUnavailableError("quota") });
    const res = await request(createApp(svc)).get("/api/explain?node=esgRole");
    expect(res.status).toBe(200);
    expect(res.body.model).toBe("template");
    expect(res.body.text).toContain("57%");
    expect(res.body.citations).toContain("esgRole");
    expect(res.body.removed).toBe(0);
  });

  it("falls back to the template if every LLM sentence fails the check", async () => {
    const svc = await testServices({ llmHandler: () => ({ sentences: [{ text: "Made up.", cites: ["nope"] }] }) });
    const res = await request(createApp(svc)).get("/api/explain?job=esgRole");
    expect(res.body).toMatchObject({ model: "template", removed: 1 });
  });

  it("needs a node", async () => {
    const svc = await testServices();
    expect((await request(createApp(svc)).get("/api/explain")).status).toBe(400);
    expect((await request(createApp(svc)).get("/api/explain?node=nope")).status).toBe(404);
  });
});
