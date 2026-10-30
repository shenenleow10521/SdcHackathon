// The three-agent vote end to end (mocked AI): gate, 3/3, 2/3, 1/3, 0/3, AI down, copied quotes, keep-or-switch, replay.
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.ts";
import { testServices } from "./helpers/services.ts";
import { scoutNet, scoutLlm, A, B, C, QA, QB, QC } from "./fixtures/sources/scout-world.ts";
import { processCandidates, countIndependent, quoteSimilarity, runScout, type Candidate } from "../server/agents/scout.ts";
import { latestVersion } from "../server/kb.ts";
import { LlmUnavailableError, type LlmRequest } from "../server/lib/llm.ts";

const isVoter = (req: LlmRequest<any>) => /three-person panel/.test(req.system);
const INC = { vote: "include", confidence: 0.9, reason: "ok" }, EXC = { vote: "exclude", confidence: 0.8, reason: "weak" };
/** Voters answer by role: evidence checker, skill matcher, sceptic. */
const panel = (e: any, s: any, c: any) => (req: LlmRequest<any>) => (/EVIDENCE CHECKER/.test(req.system) ? e : /SKILL MATCHER/.test(req.system) ? s : c);
const voterCalls = (svc: any) => ((svc.llm as any).calls as LlmRequest<any>[]).filter(isVoter);

const cand = (over: Partial<Candidate> = {}): Candidate => ({
  nodeId: "viz", kind: "capability", direction: "up", magnitude: "small", quote: QA, claim: "AI builds dashboards",
  url: A, title: "AI agents build dashboards", date: "2026-10-21", sourceKind: "rss", quoteFound: true, excerpt: `Intro. ${QA} More text.`, ...over,
});
async function run(handler: (req: LlmRequest<any>) => unknown, cands: Candidate[]) {
  const svc = await testServices({ llmHandler: handler });
  const runId = (await svc.db.query<{ id: number }>("insert into runs(kind,status,trigger) values ('scout','running','manual') returning id")).rows[0].id;
  const out = await processCandidates(svc, runId, cands, { replayed: false });
  return { svc, out, sig: out.signals[0] };
}

describe("the gate rejects without any vote", () => {
  it("untrusted source, missing quote and stale source never reach the voters", async () => {
    for (const c of [cand({ url: "https://random-blog.example.com/x" }), cand({ date: "2025-01-01" })]) {
      const { svc, sig } = await run(() => new Error("no AI expected"), [c]);
      expect(sig).toMatchObject({ triage: "rejected", status: "rejected", votes: null });
      expect(voterCalls(svc)).toHaveLength(0);
    }
    const { svc, sig } = await run(() => new Error("no AI expected"), [cand({ quoteFound: false })]);
    expect(sig.triageReasons).toContain("Quote not found on the source page");
    expect(voterCalls(svc)).toHaveLength(0);
  });
});

describe("the vote rule", () => {
  it("3 of 3 include -> applied automatically, labelled, undoable, with the votes stored", async () => {
    const { svc, sig } = await run(panel(INC, INC, INC), [cand()]);
    expect(sig).toMatchObject({ status: "applied", triage: "auto", approvedBy: "agent vote (3 of 3)", decidedBy: "auto (agent vote 3 of 3)", voteTally: "3 of 3" });
    expect(sig.votes.votes.map((v: any) => v.role)).toEqual(["evidence", "skill", "sceptic"]);
    expect(await latestVersion(svc.db)).toBe(2);
    const row = (await svc.db.query("select votes from signals where id=$1", [sig.id])).rows[0] as any;
    expect(row.votes.votes[0]).toMatchObject({ role: "evidence", vote: "include", model: "mock-reviewer" });
    const undo = await request(createApp(svc)).post(`/api/kb/versions/${sig.kbVersion}/undo`).send({});   // the existing undo path
    expect(undo.status).toBe(200);
  });

  it("2 of 3 include -> applied automatically, even for a large change from one source", async () => {
    const { svc, sig } = await run(panel(INC, INC, EXC), [cand({ magnitude: "large" })]);
    expect(sig).toMatchObject({ status: "applied", approvedBy: "agent vote (2 of 3)", deltaE: 0.1, nSources: 1 });
    expect(await latestVersion(svc.db)).toBe(2);
  });

  it("1 of 3 include -> flagged for a person, nothing applied, the three reasons attached and shown by the review API", async () => {
    const { svc, sig } = await run(panel(EXC, INC, EXC), [cand()]);
    expect(sig).toMatchObject({ status: "pending", triage: "flagged", approvedBy: null, voteTally: "1 of 3" });
    expect(sig.triageReasons).toHaveLength(4);
    expect(await latestVersion(svc.db)).toBe(1);
    const review = (await request(createApp(svc)).get("/api/review")).body;
    const p = review.pending.find((s: any) => s.id === sig.id);
    expect(p.votes.votes.map((v: any) => v.reason)).toEqual(["weak", "ok", "weak"]);
    expect(review.rules).toMatchObject({ voters: 3, approveAt: 2 });
  });

  it("0 of 3 include -> rejected and logged with the reasons", async () => {
    const { svc, sig } = await run(panel(EXC, EXC, EXC), [cand()]);
    expect(sig).toMatchObject({ status: "rejected", triage: "rejected" });
    expect(sig.triageReasons[0]).toBe("Rejected by agent vote (0 of 3 include)");
    expect(sig.votes.votes).toHaveLength(3);
    expect(await latestVersion(svc.db)).toBe(1);
  });

  it("AI unavailable -> flagged with the reason, never applied", async () => {
    const { svc, sig, out } = await run(() => new LlmUnavailableError("quota"), [cand()]);
    expect(sig).toMatchObject({ status: "pending", triage: "flagged", voteTally: null });
    expect(sig.triageReasons[0]).toMatch(/Agent vote could not happen: evidence voter unavailable: quota/);
    expect(sig.votes.error).toMatch(/quota/);
    expect(out.counts.flagged).toBe(1);
    expect(await latestVersion(svc.db)).toBe(1);
  });

  it("a voter that fails half way: the vote does not count and the signal is flagged", async () => {
    const { sig } = await run(req => (/SCEPTIC/.test(req.system) ? new Error("timeout") : INC), [cand()]);
    expect(sig).toMatchObject({ triage: "flagged", status: "pending" });
    expect(sig.votes.votes).toHaveLength(2);
  });
});

describe("independent sources", () => {
  it("the same quote copied on two sites counts once; a different quote on another organisation counts twice", () => {
    expect(countIndependent([{ url: A, quote: QA, date: "2026-10-21" }, { url: B, quote: QA.toUpperCase().replace(/\./g, ""), date: "2026-10-22" }])).toBe(1);
    expect(countIndependent([{ url: A, quote: QA, date: "2026-10-21" }, { url: B, quote: QB, date: "2026-10-22" }])).toBe(2);
    expect(countIndependent([{ url: A, quote: QA, date: "2026-10-21" }, { url: A + "2", quote: QB, date: "2026-10-22" }])).toBe(1); // same organisation
    expect(quoteSimilarity(QA, QB)).toBeLessThan(0.8);
  });

  it("a merged signal keeps both sources but reports one independent source", async () => {
    const { sig } = await run(panel(INC, INC, INC), [cand(), cand({ url: B, title: "Copy", date: "2026-10-22" })]);
    expect(sig.sources).toHaveLength(2);
    expect(sig.nSources).toBe(1);
  });
});

describe("an auto-applied vote reaches saved plans like a human approval", () => {
  it("offers the new route (keep or switch) and the offer can be kept", async () => {
    const svc = await testServices({ llmHandler: panel(INC, INC, INC) });
    const plan = (await svc.db.query(`insert into plans(profile_id, occupation_id, mode, route, kb_version) values (1,'esgRole','fastest',$1,1) returning id`,
      [JSON.stringify({ key: "ap>recon>ghg>esgRole" })])).rows[0] as any;
    const runId = (await svc.db.query<{ id: number }>("insert into runs(kind,status,trigger) values ('scout','running','manual') returning id")).rows[0].id;
    const out = await processCandidates(svc, runId, [cand({ nodeId: "recon", url: C, quote: QC, magnitude: "large", excerpt: QC })], { replayed: false });
    expect(out.signals[0]).toMatchObject({ status: "applied", approvedBy: "agent vote (3 of 3)" });
    const p = (await svc.db.query("select pending_route from plans where id=$1", [plan.id])).rows[0] as any;
    expect(p.pending_route).toMatchObject({ previousKey: "ap>recon>ghg>esgRole", signalId: out.signals[0].id, route: { key: "ap>audit>disc>esgRole" } });
    expect(out.signals[0].usersRerouted).toBeGreaterThanOrEqual(1);
    const kept = await request(createApp(svc)).post(`/api/plans/${plan.id}/route-update`).send({ action: "keep" });
    expect(kept.body.plan.pendingRoute).toBeNull();
    expect(kept.body.plan.route.key).toBe("ap>recon>ghg>esgRole");
  });
});

describe("replay", () => {
  it("reuses the recorded votes and makes no AI call", async () => {
    const live = await testServices({ fetch: scoutNet(), llmHandler: scoutLlm });
    const first = await runScout(live, { sources: ["rss"], nodes: ["viz", "recon"] });
    const recording = ((await live.db.query("select summary from runs where kind='scout' order by id desc limit 1")).rows[0] as any).summary;
    expect(Object.keys(recording.recording.votes).length).toBe(2);
    const fresh = await testServices({ llmHandler: () => new Error("no AI calls during a replay") });
    await fresh.db.query("insert into runs(kind,status,summary) values ('scout','ok',$1)", [JSON.stringify(recording)]);
    const again = await runScout(fresh, { replay: true });
    expect(again.status).toBe("replayed");
    expect(((fresh.llm as any).calls as any[]).length).toBe(0);
    const strip = (s: any) => ({ nodeId: s.nodeId, triage: s.triage, votes: s.votes });
    expect(again.signals.filter(s => s.triage !== "rejected").map(strip)).toEqual(first.signals.filter(s => s.triage !== "rejected").map(strip));
    expect(again.signals.find(s => s.nodeId === "viz")).toMatchObject({ status: "applied", approvedBy: "agent vote (3 of 3)", replayed: true });
  });

  it("an old recording without votes is flagged for a person, not applied", async () => {
    const svc = await testServices({ llmHandler: () => new Error("no AI") });
    const runId = (await svc.db.query<{ id: number }>("insert into runs(kind,status,trigger) values ('scout','running','manual') returning id")).rows[0].id;
    const out = await processCandidates(svc, runId, [cand()], { replayed: true, votes: {} });
    expect(out.signals[0]).toMatchObject({ triage: "flagged", status: "pending" });
    expect(out.signals[0].triageReasons[0]).toMatch(/no vote was recorded/);
  });
});
