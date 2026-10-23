// Knowledge pipeline API: approve -> new version -> routes visibly reroute (with the source) -> undo restores.
// Also: reject, spot check, emerging-skill confirm/reject, the committee, demo-mode replay and the admin token.
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.ts";
import { createEngine } from "../shared/engine.js";
import { loadGraph, engineGraph, latestVersion, createVersion } from "../server/kb.ts";
import { loadProfile, engineProfile } from "../server/repo.ts";
import { testServices } from "./helpers/services.ts";
import { mockFetch, page, rss } from "./fixtures/sources/mock-net.ts";
import { scoutNet, scoutLlm } from "./fixtures/sources/scout-world.ts";
import { REPLAY_FILE } from "../server/seed/knowledge.ts";
import { existsSync } from "node:fs";
import type { Services } from "../server/context.ts";

const ESG_BEFORE = "ap>recon>ghg>esgRole", ESG_AFTER = "ap>audit>disc>esgRole";

async function esgRoute(svc: Services, version?: number) {
  const p = engineProfile((await loadProfile(svc.db, 1))!);
  return createEngine(engineGraph(await loadGraph(svc.db, version)), p).shortestPath("esgRole", "fastest")!.key;
}
async function setup(config = {}) {
  const svc = await testServices({ config });
  return { svc, app: createApp(svc) };
}
const pendingFor = async (app: any, node: string) => (await request(app).get("/api/review")).body.pending.find((s: any) => s.nodeId === node);

describe("GET /api/sources", () => {
  it("returns the trust list, link-only job boards and the written policy", async () => {
    const { app } = await setup();
    const res = await request(app).get("/api/sources");
    expect(res.status).toBe(200);
    expect(res.body.trusted).toEqual(expect.arrayContaining([{ domain: "reuters.com", kind: "news", why: expect.any(String) }]));
    expect(res.body.linkOnly.map((l: any) => l.name)).toEqual(expect.arrayContaining(["JobStreet", "LinkedIn", "Indeed"]));
    expect(res.body.policy.join(" ")).toMatch(/robots\.txt/);
  });
});

describe("review queue", () => {
  it("lists the seeded sample signals and emerging candidates, labelled sample", async () => {
    const { app } = await setup();
    const res = await request(app).get("/api/review");
    expect(res.status).toBe(200);
    expect(res.body.pending.length).toBe(3);
    const recon = res.body.pending.find((s: any) => s.nodeId === "recon");
    expect(recon).toMatchObject({ nodeName: "Vendor reconciliation", deltaE: 0.18, isSample: true, source: "sample", status: "pending", triage: "flagged" });
    expect(res.body.emerging.map((c: any) => c.skillId).sort()).toEqual(["aiinv", "prompt"]);
    expect(res.body.emerging[0].isSample).toBe(true);
    expect(res.body.counts.pending).toBe(3);
  });
});

describe("approve -> reroute -> undo (the live demo path)", () => {
  it("approving the reconciliation signal creates a version and reroutes the demo persona's ESG route", async () => {
    const { svc, app } = await setup();
    expect(await esgRoute(svc)).toBe(ESG_BEFORE);
    const recon = await pendingFor(app, "recon");
    const res = await request(app).post(`/api/review/signals/${recon.id}/approve`).set("x-actor", "Aisyah").send({ note: "Checked the vendor release notes" });
    expect(res.status).toBe(200);
    expect(res.body.kbVersion).toBe(2);
    expect(res.body.rerouted).toEqual(expect.arrayContaining([{ profileId: 1, job: "esgRole", mode: "fastest", from: ESG_BEFORE, to: ESG_AFTER }]));
    expect(res.body.signal).toMatchObject({ status: "applied", kbVersion: 2, decidedBy: "Aisyah", decisionNote: "Checked the vendor release notes" });
    expect(res.body.signal.usersRerouted).toBeGreaterThanOrEqual(1);
    expect(await esgRoute(svc)).toBe(ESG_AFTER);

    // The change is visible in the graph with its signal, and in "Why this number?"
    const g = (await request(app).get("/api/graph")).body;
    expect(g.deltas.e.recon).toBeCloseTo(0.18, 5);
    expect(g.appliedChanges).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "delta", nodeId: "recon", signalId: recon.id })]));
    const sig = (await request(app).get("/api/signals?node=recon")).body.signals;
    expect(sig.map((s: any) => s.id)).toContain(recon.id);
    // Audit + snapshot
    const a = (await svc.db.query("select * from audit_log where action='signal.approve'")).rows[0] as any;
    expect(a).toMatchObject({ actor: "Aisyah", target: `signal:${recon.id}` });
    const snap = (await svc.db.query("select * from profile_snapshots where profile_id=1 and kb_version=2")).rows[0] as any;
    expect(snap.routes.esgRole).toBe(ESG_AFTER);
  });

  it("a saved plan gets a pending route offer (keep/switch), and undo withdraws it", async () => {
    const { svc, app } = await setup();
    const plan = (await svc.db.query(`insert into plans(profile_id, occupation_id, mode, route, kb_version) values (1,'esgRole','fastest',$1,1) returning id`,
      [JSON.stringify({ key: ESG_BEFORE })])).rows[0] as any;
    const recon = await pendingFor(app, "recon");
    const ok = await request(app).post(`/api/review/signals/${recon.id}/approve`).send({});
    const p = (await svc.db.query("select pending_route from plans where id=$1", [plan.id])).rows[0] as any;
    expect(p.pending_route).toMatchObject({ kbVersion: ok.body.kbVersion, previousKey: ESG_BEFORE, signalId: recon.id, route: { key: ESG_AFTER } });
    expect(p.pending_route.reason).toMatch(/AI agents now close the month-end books/);
    expect(p.pending_route.route.nodes).toEqual(ESG_AFTER.split(">"));

    const undo = await request(app).post(`/api/kb/versions/${ok.body.kbVersion}/undo`).send({});
    expect(undo.status).toBe(200);
    expect(undo.body.kbVersion).toBe(ok.body.kbVersion + 1);
    expect(await esgRoute(svc)).toBe(ESG_BEFORE);
    expect((await svc.db.query("select pending_route from plans where id=$1", [plan.id])).rows[0]).toMatchObject({ pending_route: null });
    const s = (await request(app).get("/api/review")).body.handled.find((h: any) => h.type === "signal" && h.id === recon.id);
    expect(s.status).toBe("reverted");
    expect((await svc.db.query("select * from audit_log where action='kb.undo'")).rows.length).toBe(1);
  });

  it("undo rules: not twice, not the seed, not an undo", async () => {
    const { app } = await setup();
    const recon = await pendingFor(app, "recon");
    const v = (await request(app).post(`/api/review/signals/${recon.id}/approve`).send({})).body.kbVersion;
    const u = (await request(app).post(`/api/kb/versions/${v}/undo`).send({})).body.kbVersion;
    expect((await request(app).post(`/api/kb/versions/${v}/undo`).send({})).status).toBe(409);
    expect((await request(app).post(`/api/kb/versions/${u}/undo`).send({})).status).toBe(400);
    expect((await request(app).post(`/api/kb/versions/1/undo`).send({})).status).toBe(400);
    expect((await request(app).post(`/api/kb/versions/999/undo`).send({})).status).toBe(404);
  });

  it("a signal can only be decided once", async () => {
    const { app } = await setup();
    const recon = await pendingFor(app, "recon");
    expect((await request(app).post(`/api/review/signals/${recon.id}/approve`).send({})).status).toBe(200);
    expect((await request(app).post(`/api/review/signals/${recon.id}/approve`).send({})).status).toBe(409);
    expect((await request(app).post(`/api/review/signals/${recon.id}/reject`).send({})).status).toBe(409);
    expect((await request(app).post(`/api/review/signals/99999/approve`).send({})).status).toBe(404);
    expect((await request(app).post(`/api/review/signals/abc/approve`).send({})).status).toBe(400);
  });

  it("reject leaves the knowledge base unchanged and is audited", async () => {
    const { svc, app } = await setup();
    const tax = await pendingFor(app, "tax");
    const res = await request(app).post(`/api/review/signals/${tax.id}/reject`).set("x-actor", "Ben").send({ note: "Single job-board report" });
    expect(res.status).toBe(200);
    expect(res.body.signal).toMatchObject({ status: "rejected", decidedBy: "Ben" });
    expect(await latestVersion(svc.db)).toBe(1);
    expect((await svc.db.query("select * from audit_log where action='signal.reject'")).rows.length).toBe(1);
  });
});

describe("spot check of automatic changes", () => {
  it("'wrong' undoes the auto-applied change; 'ok' just records the check", async () => {
    const { svc, app } = await setup();
    const mk = async () => {
      const id = (await svc.db.query(`insert into signals(node_id,kind,title,delta_e,quote,source_url,triage,status,needs_spotcheck,decided_by)
        values ('viz','capability','t',0.02,'q','https://www.reuters.com/x','auto','pending',true,'auto (rules)') returning id`)).rows[0].id as number;
      const v = await createVersion(svc.db, "auto", "auto", [{ kind: "delta", nodeId: "viz", deltaE: 0.02, signalId: id }]);
      await svc.db.query("update signals set status='applied', kb_version=$2 where id=$1", [id, v]);
      return id;
    };
    const a = await mk(), b = await mk();
    expect((await request(app).get("/api/review")).body.spotcheck.length).toBe(2);
    const bad = await request(app).post(`/api/review/spotcheck/${a}`).send({ ok: false, note: "Quote is about a different product" });
    expect(bad.status).toBe(200);
    expect(bad.body.signal).toMatchObject({ status: "reverted", spotcheck: "wrong" });
    expect((await loadGraph(svc.db)).deltas.e.viz).toBeCloseTo(0.02, 5); // only b's change remains
    const good = await request(app).post(`/api/review/spotcheck/${b}`).send({ ok: true });
    expect(good.body.signal).toMatchObject({ status: "applied", spotcheck: "ok" });
    expect((await request(app).post(`/api/review/spotcheck/${b}`).send({ ok: true })).status).toBe(409);
  });
});

describe("emerging skills", () => {
  it("confirming a provisional (sample) skill gives it full weight; rejecting another changes nothing", async () => {
    const { svc, app } = await setup();
    const em = (await request(app).get("/api/review")).body.emerging;
    const prompt = em.find((c: any) => c.skillId === "prompt"), aiinv = em.find((c: any) => c.skillId === "aiinv");
    const res = await request(app).post(`/api/review/emerging/${prompt.id}/confirm`).set("x-actor", "Aisyah").send({});
    expect(res.status).toBe(200);
    expect(res.body.candidate).toMatchObject({ status: "confirmed", decidedBy: "Aisyah", isSample: true });
    const g = await loadGraph(svc.db, res.body.kbVersion);
    expect(g.nodes.prompt.emerging.status).toBe("confirmed");
    const E = createEngine(engineGraph(g), engineProfile((await loadProfile(svc.db, 1))!));
    const row = E.matchBreakdown("stayRole").find((r: any) => r.skill === "prompt")!;
    expect(row.effectiveWeight).toBe(row.weight);
    const rej = await request(app).post(`/api/review/emerging/${aiinv.id}/reject`).send({});
    expect(rej.body).toMatchObject({ candidate: { status: "rejected" }, kbVersion: null });
    expect((await request(app).post(`/api/review/emerging/${aiinv.id}/confirm`).send({})).status).toBe(409);
    expect((await svc.db.query("select count(*)::int as n from audit_log where action like 'emerging.%'")).rows[0]).toMatchObject({ n: 2 });
  });
});

describe("emerging-skill committee", () => {
  const FEED = "https://techcrunch.com/category/artificial-intelligence/feed/";
  const art = (n: number) => `https://www.reuters.com/technology/ai-journal-review-${n}/`;
  const Q = "Finance teams now need staff skilled in reviewing AI-generated journal entries before they are posted.";
  const net = () => mockFetch([
    [FEED, { body: rss([{ title: "AI in accounting", link: art(1), date: "2026-10-21T00:00:00Z" }, { title: "AI copilots in finance", link: "https://www.bbc.com/news/copilot", date: "2026-10-21T00:00:00Z" }]), headers: { "content-type": "application/rss+xml" } }],
    [art(1), { body: page("AI in accounting", [Q, "Accounting AI tools are spreading. ".repeat(10)]) }],
    ["https://www.bbc.com/news/copilot", { body: page("AI copilots in finance", ["Teams are learning Copilot Studio to automate approvals.", "Prompt writing is also in demand for finance staff using generative AI.", "x ".repeat(100)]) }],
    [/.*/, { status: 404, body: "" }],
  ]);
  const llm = (req: any) => {
    if (req.role === "reviewer") return /Copilot Studio/.test(req.user) ? { verdict: "product_name", reason: "A Microsoft product" } : { verdict: "keep", reason: "A distinct ability" };
    if (req.user.includes("Document 2")) return { proposals: [
      { phrase: "Reviewing AI-generated journal entries", doc: 1, quote: Q, linkedSkill: "audit" },
      { phrase: "Copilot Studio", doc: 2, quote: "Teams are learning Copilot Studio to automate approvals.", linkedSkill: "auto" },
      { phrase: "Prompt writing", doc: 2, quote: "Prompt writing is also in demand for finance staff using generative AI.", linkedSkill: "prompt" },
      { phrase: "Quantum ledger design", doc: 2, quote: "Quantum ledgers are the future.", linkedSkill: "erp" },
    ] };
    return { proposals: [] };
  };

  it("keeps verified mentions, merges duplicates, lets the skeptic reject product names, and watches the rest", async () => {
    const svc = await testServices({ fetch: net(), llmHandler: llm });
    const app = createApp(svc);
    const res = await request(app).post("/api/committee/run").send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    const by = Object.fromEntries(res.body.candidates.map((c: any) => [c.label, c]));
    expect(by["Reviewing AI-generated journal entries"]).toMatchObject({ status: "pending", mentions: 1, organisations: 1, evidenceBasis: "trusted_source_mentions", linkedSkill: "audit", isSample: false });
    expect(by["Copilot Studio"].status).toBe("rejected");
    expect(by["Prompt writing"].status).toBe("merged");      // alias of the existing 'prompt' skill
    expect(by["Quantum ledger design"]).toBeUndefined();      // quote not on the page
    expect(await latestVersion(svc.db)).toBe(1);              // below thresholds: nothing added
  });

  it("passing the thresholds adds a provisional skill (half weight); a person confirms it", async () => {
    const svc = await testServices({ fetch: net(), llmHandler: llm });
    const app = createApp(svc);
    // Earlier evidence, as stored by previous runs: 14 mentions from 5 organisations over 5 weeks.
    const doms = ["apnews.com", "bbc.com", "theedgemalaysia.com", "thestar.com.my", "zdnet.com"];
    for (let i = 0; i < 14; i++)
      await svc.db.query(`insert into emerging_mentions(phrase_key,label,linked_skill,url,domain,quote,source_date) values ('reviewing ai generated journal entrie','Reviewing AI-generated journal entries','audit',$1,$2,'q',$3)`,
        [`https://www.${doms[i % 5]}/a${i}`, doms[i % 5], new Date(Date.parse("2026-09-20") + i * 2.5 * 86_400_000).toISOString().slice(0, 10)]);
    const res = await request(app).post("/api/committee/run").send({});
    const c = res.body.candidates.find((x: any) => x.label === "Reviewing AI-generated journal entries");
    expect(c).toMatchObject({ status: "provisional", mentions: 15, kbVersion: 2 });
    const g = await loadGraph(svc.db);
    expect(g.nodes[c.skillId]).toMatchObject({ type: "skill", emerging: { status: "provisional" } });
    expect(g.edges).toEqual(expect.arrayContaining([expect.objectContaining({ from: "audit", to: c.skillId })]));
    const conf = await request(app).post(`/api/review/emerging/${c.id}/confirm`).send({});
    expect(conf.status).toBe(200);
    expect((await loadGraph(svc.db)).nodes[c.skillId].emerging.status).toBe("confirmed");
  });
});

describe("demo mode replay", () => {
  it("replays the last recorded run when live sources fail, and labels it replayed", async () => {
    const svc = await testServices({ fetch: scoutNet(), llmHandler: scoutLlm, config: { demoMode: true } });
    const app = createApp(svc);
    const first = await request(app).post("/api/scout/run").send({ sources: ["rss"], nodes: ["viz", "recon"] });
    expect(first.body.status).toBe("ok");
    svc.fetch = mockFetch([[/.*/, () => { throw new Error("offline"); }]]);
    const again = await request(app).post("/api/scout/run").send({ sources: ["rss"], nodes: ["viz", "recon"] });
    expect(again.body).toMatchObject({ status: "replayed", replayed: true });
    expect(again.body.counts.candidates).toBe(4);
    expect(again.body.counts.duplicates).toBe(2);   // same evidence: nothing applied twice
    const runs = (await request(app).get("/api/scout/runs?kind=scout")).body.runs;
    expect(runs[0]).toMatchObject({ status: "replayed", replayed: true });
    expect(runs[0].summary.replayOf).toBe(first.body.runId);
  });

  it("replay on request, through the same rules, into a fresh database", async () => {
    const a = await testServices({ fetch: scoutNet(), llmHandler: scoutLlm });
    await request(createApp(a)).post("/api/scout/run").send({ sources: ["rss"], nodes: ["viz", "recon"] });
    const recording = ((await a.db.query("select summary from runs where kind='scout' order by id desc limit 1")).rows[0] as any).summary;
    const b = await testServices({ llmHandler: () => new Error("no AI calls during a replay") });
    await b.db.query("insert into runs(kind,status,summary) values ('scout','ok',$1)", [JSON.stringify(recording)]);
    const out = await request(createApp(b)).post("/api/scout/run").send({ replay: true });
    expect(out.body).toMatchObject({ status: "replayed", replayed: true, counts: { auto: 1, flagged: 1, rejected: 1 } });
    expect(out.body.signals.every((s: any) => s.replayed)).toBe(true);
  });

  it("without demo mode an outright failure is HTTP 502 scout_failed, with the run summary", async () => {
    const svc = await testServices({ fetch: mockFetch([[/.*/, () => { throw new Error("offline"); }]]), llmHandler: scoutLlm });
    const res = await request(createApp(svc)).post("/api/scout/run").send({ sources: ["rss"], nodes: ["viz"] });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatchObject({ code: "scout_failed", message: expect.stringMatching(/Every live source failed/) });
    expect(res.body.error.details.runId).toEqual(expect.any(Number));
    expect(res.body.error.details.summary.sources.rss.ok).toBe(false);
    const run = (await svc.db.query("select status from runs where id=$1", [res.body.error.details.runId])).rows[0] as any;
    expect(run.status).toBe("failed");
  });

  it("a partial failure (one source down) is still 200, with per-source errors listed", async () => {
    const net = scoutNet();
    const svc = await testServices({ fetch: mockFetch([[/export\.arxiv\.org/, { status: 503, body: "down" }], [/.*/, (u, i) => net(u, i) as any]]), llmHandler: scoutLlm });
    const res = await request(createApp(svc)).post("/api/scout/run").send({ sources: ["rss", "arxiv"], nodes: ["viz", "recon"] });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.sources.arxiv).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.stringMatching(/503/)]) });
    expect(res.body.sources.rss.ok).toBe(true);
  });

  it("a fresh install carries one recorded real run (seed), not applied, replayable offline", async () => {
    const svc = await testServices({ llmHandler: () => new Error("no AI calls during a replay") });
    const seeded = (await svc.db.query("select * from runs where kind='scout' and trigger='seed'")).rows as any[];
    if (!existsSync(REPLAY_FILE)) { expect(seeded.length).toBe(0); return; }
    expect(seeded.length).toBe(1);
    expect(seeded[0].summary.recording.candidates.length).toBeGreaterThan(0);
    expect(await latestVersion(svc.db)).toBe(1);                       // nothing applied at seed time
    const n0 = Number((await svc.db.query("select count(*)::int as n from signals where not is_sample")).rows[0].n);
    expect(n0).toBe(0);
    const res = await request(createApp(svc)).post("/api/scout/run").send({ replay: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "replayed", replayed: true, replayOf: seeded[0].id });
    expect(res.body.signals.length).toBeGreaterThan(0);
    for (const s of res.body.signals) {
      expect(s.replayed).toBe(true);
      expect(s.sourceUrl).toMatch(/^https:\/\//);
      expect(s.sourceDate).toMatch(/^2026-/);                          // original dates kept
    }
  });
});

describe("validation and admin protection", () => {
  it("rejects unknown sources and skill ids", async () => {
    const { app } = await setup();
    expect((await request(app).post("/api/scout/run").send({ sources: ["jobstreet"] })).status).toBe(400);
    expect((await request(app).post("/api/scout/run").send({ nodes: ["not_a_skill"] })).status).toBe(400);
  });

  it("admin routes need the token when ADMIN_TOKEN is set", async () => {
    const { app } = await setup({ adminToken: "s3cret" });
    expect((await request(app).get("/api/review")).status).toBe(401);
    expect((await request(app).post("/api/review/signals/1/approve").send({})).status).toBe(401);
    expect((await request(app).post("/api/scout/run").send({})).status).toBe(401);
    expect((await request(app).post("/api/kb/versions/2/undo").send({})).status).toBe(401);
    expect((await request(app).get("/api/review").set("x-admin-token", "s3cret")).status).toBe(200);
    // Public read-only routes stay open
    expect((await request(app).get("/api/sources")).status).toBe(200);
    expect((await request(app).get("/api/signals")).status).toBe(200);
    expect((await request(app).get("/api/scout/runs")).status).toBe(200);
  });
});
