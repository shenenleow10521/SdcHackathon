// Market scout end to end with mocked network and AI: auto-applied vs flagged vs rejected, dedupe, failures.
import { describe, it, expect } from "vitest";
import { testServices } from "./helpers/services.ts";
import { mockFetch } from "./fixtures/sources/mock-net.ts";
import { scoutNet, scoutLlm, A, B, C, D, QA, QC } from "./fixtures/sources/scout-world.ts";
import { runScout, quoteInText, normalizeText, queriesFor, relevance, skillTermWeights, RELEVANCE_MIN, embedWithin } from "../server/agents/scout.ts";
import { loadGraph, latestVersion } from "../server/kb.ts";
import { LlmUnavailableError, type LlmRequest } from "../server/lib/llm.ts";

describe("quote verification", () => {
  it("matches word for word after normalising case, quotes, dashes and spaces", () => {
    const text = "He said: “AI agents now close the books” — and it’s   fast.";
    expect(quoteInText('"AI agents now close the books" - and it\'s fast', text)).toBe(true);
    expect(quoteInText("...AI agents now close the books…", text)).toBe(true);
    expect(quoteInText("AI agents now close all the books", text)).toBe(false);
    expect(quoteInText("AI", text)).toBe(false); // too short to be evidence
    expect(normalizeText("A B  C")).toBe("a b c");
  });
});

describe("queries and relevance (code, not AI)", () => {
  it("builds 1-2 queries per skill from its name and an automatable task", async () => {
    const g = await loadGraph((await testServices()).db);
    const qs = queriesFor("recon", g.nodes.recon);
    expect(qs[0].terms).toEqual(["Vendor reconciliation", "AI"]);
    expect(qs[1].terms).toEqual(["match", "statements", "ledger", "AI"]);
    const w = skillTermWeights(g);
    expect(w.recon.reconciliation).toBe(3);   // from the skill's name
    expect(w.recon.ledger).toBe(1);           // from a task
    expect(w.viz.build).toBeUndefined();      // generic word: says little, dropped
    expect(relevance({ title: "AI agents match statements", text: "to the ledger" }, w.recon)).toBeGreaterThanOrEqual(RELEVANCE_MIN);
    expect(relevance({ title: "Match statements to the ledger", text: "manual work" }, w.recon)).toBe(0); // no AI term
    expect(relevance({ title: "Tesla profits drop on AI spending", text: "robotics and data" }, w.recon)).toBeLessThan(RELEVANCE_MIN);
  });
});

describe("scout run (mocked sources + AI)", () => {
  it("auto-applies a small corroborated change, flags a big single-source one, rejects an unverifiable quote", async () => {
    const svc = await testServices({ fetch: scoutNet(), llmHandler: scoutLlm });
    const v0 = await latestVersion(svc.db);
    const out = await runScout(svc, { sources: ["rss"], nodes: ["viz", "recon"] });
    expect(out.status).toBe("ok");
    expect(out.replayed).toBe(false);
    expect(out.counts).toMatchObject({ fetched: 4, candidates: 4, auto: 1, flagged: 1, rejected: 1, duplicates: 0 });

    const auto = out.signals.find(s => s.nodeId === "viz")!;
    expect(auto).toMatchObject({ status: "applied", triage: "auto", nSources: 2, deltaE: 0.02, deltaD: 0, decidedBy: "auto (rules)", nodeName: "Dashboard reporting", isSample: false });
    expect(auto.sources.map((s: any) => s.url).sort()).toEqual([B, A].sort());
    expect(auto.reviewer).toEqual({ supports: true, confidence: 0.92, issue: null });
    expect(auto.kbVersion).toBe(v0 + 1);
    expect((await loadGraph(svc.db)).deltas.e.viz).toBe(0.02);

    const flagged = out.signals.find(s => s.nodeId === "recon" && s.triage === "flagged")!;
    expect(flagged.status).toBe("pending");
    expect(flagged.deltaE).toBe(0.1);                       // "large" -> 0.10 by code
    expect(flagged.triageReasons).toEqual(expect.arrayContaining(["Big change", "Single source"]));
    expect(flagged.sourceUrl).toBe(C);
    expect(flagged.quote).toBe(QC);

    const rejected = out.signals.find(s => s.triage === "rejected")!;
    expect(rejected.triageReasons).toContain("Quote not found on the source page");
    expect(rejected.sourceUrl).toBe(D);

    // Only the auto change made a new version; the flagged one waits for a person.
    expect(await latestVersion(svc.db)).toBe(v0 + 1);
    const run = (await svc.db.query("select status, summary from runs where id=$1", [out.runId])).rows[0] as any;
    expect(run.status).toBe("ok");
    expect(run.summary.recording.candidates.length).toBe(4);
    expect(run.summary.items.every((i: any) => i.excerpt.length <= 300)).toBe(true);
    const auditRow = (await svc.db.query("select * from audit_log where action='signal.auto_apply'")).rows[0] as any;
    expect(auditRow.actor).toBe("auto");
  });

  it("stays within the AI call caps", async () => {
    const svc = await testServices({ fetch: scoutNet(), llmHandler: scoutLlm });
    await runScout(svc, { sources: ["rss"], nodes: ["viz", "recon"] });
    const calls = (svc.llm as any).calls as LlmRequest<any>[];
    expect(calls.filter(c => c.role !== "reviewer").length).toBe(4);
    expect(calls.filter(c => c.role === "reviewer").length).toBe(2);
  });

  it("a second run finds the same items and counts them as duplicates (nothing re-applied)", async () => {
    const svc = await testServices({ fetch: scoutNet(), llmHandler: scoutLlm });
    await runScout(svc, { sources: ["rss"], nodes: ["viz", "recon"] });
    const v = await latestVersion(svc.db);
    const again = await runScout(svc, { sources: ["rss"], nodes: ["viz", "recon"] });
    expect(again.counts.duplicates).toBe(2);
    expect(again.counts.auto).toBe(0);
    expect(again.counts.flagged).toBe(0);
    expect(await latestVersion(svc.db)).toBe(v);
  });

  it("dedupes by meaning too: a near-identical quote from another site within 30 days", async () => {
    const svc = await testServices({ fetch: scoutNet(), llmHandler: scoutLlm });
    await svc.db.query(`insert into signals(node_id, kind, title, delta_e, quote, source_url, triage, status, created_at)
      values ('viz','capability','earlier',0.02,$1,'https://apnews.com/x','auto','applied',$2)`, [QA, "2026-10-15T00:00:00Z"]);
    const out = await runScout(svc, { sources: ["rss"], nodes: ["viz"] });
    expect(out.counts.duplicates).toBe(1);
    expect(out.signals.some(s => s.nodeId === "viz" && s.triage !== "rejected")).toBe(false);
  });

  it("records a failed run when every source fails (no demo mode)", async () => {
    const svc = await testServices({ fetch: mockFetch([[/.*/, () => { throw new Error("network down"); }]]), llmHandler: scoutLlm });
    const out = await runScout(svc, { sources: ["rss", "arxiv"], nodes: ["viz"] });
    expect(out.status).toBe("failed");
    expect(out.error).toMatch(/Every live source failed/);
    const run = (await svc.db.query("select status, summary from runs where id=$1", [out.runId])).rows[0] as any;
    expect(run.status).toBe("failed");
  });

  it("records a failed run when the AI is unavailable", async () => {
    const svc = await testServices({ fetch: scoutNet(), llmHandler: () => new LlmUnavailableError("quota") });
    const out = await runScout(svc, { sources: ["rss"], nodes: ["viz"] });
    expect(out.status).toBe("failed");
    expect(out.error).toMatch(/AI extraction unavailable/);
    expect(await latestVersion(svc.db)).toBe(1);
  });

  it("rotates through tracked skills when none are named", async () => {
    const svc = await testServices({ fetch: mockFetch([[/.*/, { status: 404, body: "" }]]), llmHandler: scoutLlm });
    const a = await runScout(svc, { sources: ["rss"] });
    const b = await runScout(svc, { sources: ["rss"] });
    const sa = (await svc.db.query("select summary from runs where id=$1", [a.runId])).rows[0] as any;
    const sb = (await svc.db.query("select summary from runs where id=$1", [b.runId])).rows[0] as any;
    expect(sa.summary.skills.length).toBeGreaterThan(0);
    expect(sb.summary.skills[0]).not.toBe(sa.summary.skills[0]);
  });
});

describe("embeddings are optional", () => {
  it("a slow embedding endpoint times out instead of stalling the run", async () => {
    const svc = await testServices({ embed: { provider: "mock", model: "slow", embed: () => new Promise(() => {}), status: () => ({ provider: "mock", model: "slow", configured: true, lastError: null }) } as any });
    await expect(embedWithin(svc, ["x"], 50)).rejects.toThrow(/timed out/);
  });

  it("if embeddings fail, dedupe falls back to exact quote matching and the run still completes", async () => {
    const svc = await testServices({ fetch: scoutNet(), llmHandler: scoutLlm, embed: { provider: "none", model: "none", embed: async () => { throw new Error("down"); }, status: () => ({ provider: "none", model: "none", configured: false, lastError: "down" }) } as any });
    await svc.db.query(`insert into signals(node_id, kind, title, delta_e, quote, source_url, triage, status) values ('viz','capability','earlier',0.02,$1,'https://apnews.com/x','auto','applied')`, [QA]);
    const out = await runScout(svc, { sources: ["rss"], nodes: ["viz", "recon"] });
    expect(out.status).toBe("ok");
    expect(out.counts.duplicates).toBe(1); // the viz group matched the identical earlier quote
  });
});
