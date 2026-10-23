// Emerging-skill committee: page ranking (incl. Tavily trusted-domain search), the ESCO duplicate check (vector and the
// explicit text fallback), what the skeptic sees, and evidence accumulating across runs into a "watching" candidate.
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("../server/services/esco-match.ts", async orig => {
  const real: any = await orig();
  return { ...real, escoMatchingAvailable: vi.fn(real.escoMatchingAvailable), escoCandidates: vi.fn(real.escoCandidates) };
});
import request from "supertest";
import * as escoMatch from "../server/services/esco-match.ts";
import { runCommittee, committeeRelevance, selectPages, evidenceFor, candidateJson, committeeSettings } from "../server/agents/committee.ts";
import { skillTermWeights } from "../server/agents/scout.ts";
import { loadGraph } from "../server/kb.ts";
import { createApp } from "../server/app.ts";
import { testServices } from "./helpers/services.ts";
import { mockFetch, page, rss } from "./fixtures/sources/mock-net.ts";
import type { SourceItem } from "../server/sources/index.ts";

const FEED = "https://techcrunch.com/category/artificial-intelligence/feed/";
const ROBOTAXI = "https://techcrunch.com/2026/10/22/robotaxi-raises/";
const REUTERS = "https://www.reuters.com/business/finance-ai-risk/";
const AT = "https://www.accountingtoday.com/news/aicpa-ai-guide";
const Q_AT = "The guidance will aid CPAs in evaluating AI-related risks, understanding how AI may affect controls, and determining appropriate audit responses.";
const Q_RT = "Audit teams say AI risk evaluation is now a core skill for finance staff reviewing automated controls.";
const json = (o: unknown) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(o) });

function world({ tavily = true } = {}) {
  return mockFetch([
    [FEED, { body: rss([
      { title: "Robotaxi startup raises $500m for its AI driver", link: ROBOTAXI, date: "2026-10-22T00:00:00Z" },   // newest, off-topic
      { title: "Finance teams and AI risk", link: REUTERS, date: "2026-10-19T00:00:00Z", description: "Accounting and audit staff need new AI skills" },
    ]), headers: { "content-type": "application/rss+xml" } }],
    ["https://api.tavily.com/search", json({ results: tavily ? [
      { url: AT, title: "AICPA AI practice guide", content: "AICPA guidance helps CPAs and auditors evaluate AI risks in audit and accounting.", published_date: "2026-10-13T08:00:00Z" },
    ] : [] })],
    [ROBOTAXI, { body: page("Robotaxi startup raises", ["The AI driver company raised money for its fleet.", "x ".repeat(80)]) }],
    [REUTERS, { body: page("Finance teams and AI risk", [Q_RT, "Accounting firms are training auditors in AI risk evaluation. ".repeat(4)], "2026-10-19T08:00:00Z") }],
    [AT, { body: page("AICPA AI practice guide", [Q_AT, "Auditors and accountants will need training in AI risk evaluation for finance. ".repeat(3)], "2026-10-13T08:00:00Z") }],
    [/.*/, { status: 404, body: "" }],
  ]);
}
const docOf = (user: string, text: string) => { const parts = user.split(/\nDocument (\d+): /); const i = parts.findIndex((p, j) => j > 0 && j % 2 === 0 && p.includes(text)); return i > 0 ? Number(parts[i - 1]) : 0; };
const withTavily = () => { vi.stubEnv("TAVILY_API_KEY", "test-key"); vi.stubEnv("BRAVE_API_KEY", ""); vi.stubEnv("GEMINI_GROUNDING", "off"); };
afterEach(() => { vi.unstubAllEnvs(); vi.mocked(escoMatch.escoMatchingAvailable).mockRestore(); vi.mocked(escoMatch.escoCandidates).mockRestore(); vi.restoreAllMocks(); });

describe("page selection", () => {
  it("scores off-topic AI news 0 and finance / ESG AI items above it", async () => {
    const svc = await testServices();
    const w = skillTermWeights(await loadGraph(svc.db));
    expect(committeeRelevance({ title: "Robotaxi startup raises $500m", text: "Its AI driver will expand to new cities." }, w)).toBe(0);
    expect(committeeRelevance({ title: "Bursa opens higher", text: "Shares in finance stocks rose." }, w)).toBe(0); // no AI term
    expect(committeeRelevance({ title: "AI agents reshape accounts payable", text: "Finance teams need staff skilled in reviewing AI-matched invoices." }, w)).toBeGreaterThan(5);
  });

  it("reads the most relevant pages first, at most 4 per organisation, up to the page budget", async () => {
    const svc = await testServices();
    const graph = await loadGraph(svc.db);
    const item = (url: string, title: string, date = "2026-10-20"): SourceItem => ({ sourceKind: "rss", url, title, date, text: title });
    const items = [
      item("https://techcrunch.com/robotaxi", "Robotaxi firm expands AI fleet", "2026-10-22"),
      ...Array.from({ length: 6 }, (_, i) => item(`https://www.accountingtoday.com/a${i}`, `AI audit skills for accountants ${i}`)),
      item("https://www.cfo.com/ai-esg", "AI and ESG reporting: finance teams need new skills"),
    ];
    const sel = await selectPages(svc, graph, items, new Date("2026-09-23"));
    expect(sel.pages.map(p => p.url)).not.toContain("https://techcrunch.com/robotaxi");
    expect(sel.pages.filter(p => p.url.includes("accountingtoday")).length).toBe(committeeSettings.maxPagesPerOrg);
    expect(sel.pages.map(p => p.url)).toContain("https://www.cfo.com/ai-esg");
  });

  it("includes Tavily trusted-domain search results and skips the newest off-topic RSS item", async () => {
    withTavily();
    const net = world();
    const svc = await testServices({ fetch: net, llmHandler: () => ({ proposals: [] }) });
    const r = await runCommittee(svc, { sources: ["websearch", "rss"] });
    expect(r.status).toBe("ok");
    const tav = net.calls.filter(c => c.url.includes("api.tavily.com"));
    expect(tav.length).toBe(committeeSettings.queriesPerRun);
    expect(JSON.parse(String(tav[0].init!.body)).include_domains).toContain("accountingtoday.com");
    const s = (await svc.db.query("select summary from runs where id=$1", [r.runId])).rows[0].summary as any;
    expect(s.items.map((i: any) => i.url).sort()).toEqual([AT, REUTERS].sort());
    expect(net.calls.some(c => c.url === ROBOTAXI)).toBe(false);
    expect(s.funnel).toMatchObject({ pagesRead: 2, proposerCalls: 1, verifiedProposals: 0 });
    // The next run takes the next queries, and doesn't read the same pages again.
    const r2 = await runCommittee(svc, { sources: ["websearch", "rss"] });
    const s2 = (await svc.db.query("select summary from runs where id=$1", [r2.runId])).rows[0].summary as any;
    expect(s2.queries[0]).not.toBe(s.queries[0]);
    expect(s2.funnel).toMatchObject({ skippedReadBefore: 2, pagesRead: 0 });
  });
});

describe("ESCO duplicate check and the skeptic", () => {
  const proposer = (phrase: string, quote: string) => (req: any) =>
    req.role === "main" ? { proposals: docOf(req.user, quote) ? [{ phrase, doc: docOf(req.user, quote), quote, linkedSkill: "audit" }] : [] } : undefined;

  it("an ESCO vector match (cosine >= 0.85) is an alias of that ESCO skill, recorded, and the skeptic is not asked", async () => {
    withTavily();
    vi.mocked(escoMatch.escoMatchingAvailable).mockReturnValue(true);
    vi.mocked(escoMatch.escoCandidates).mockImplementation(async (_s, phrases) => phrases.map(() => [{ escoId: "esco-risk", title: "assess AI risks", score: 0.91 }]));
    const calls: any[] = [];
    const svc = await testServices({ fetch: world(), llmHandler: req => { calls.push(req); return req.role === "main" ? proposer("Evaluating AI-related risks", Q_AT)(req) : new Error("skeptic not expected"); } });
    const r = await runCommittee(svc, { sources: ["websearch", "rss"] });
    const c = r.candidates[0];
    expect(c).toMatchObject({ label: "Evaluating AI-related risks", status: "merged", escoMatch: { id: "esco-risk", name: "assess AI risks", score: 0.91, how: "vector", source: "esco" } });
    expect(c.committee.duplicate).toMatch(/^ESCO has it: 'assess AI risks'/);
    expect(calls.filter(x => x.role === "reviewer")).toHaveLength(0);
    expect(r.counts).toMatchObject({ mergedEsco: 1, watching: 0 });
  });

  it("below the threshold the skeptic sees the nearest ESCO skills with similarity; a 'duplicate' that names none of them is not one", async () => {
    withTavily();
    vi.mocked(escoMatch.escoMatchingAvailable).mockReturnValue(true);
    vi.mocked(escoMatch.escoCandidates).mockImplementation(async (_s, phrases) => phrases.map(() => [
      { escoId: "e1", title: "implement ICT risk management", score: 0.6 }, { escoId: "e2", title: "identify ICT security risks", score: 0.58 }]));
    let seen = "";
    const skeptic = (sameAs: string) => testServices({ fetch: world(), llmHandler: req => req.role === "main" ? proposer("Evaluating AI-related risks", Q_AT)(req)
      : (seen = req.user, { verdict: "duplicate", sameAs, reason: "A kind of risk management" }) });
    const r = await runCommittee(await skeptic("risk management in general"), { sources: ["websearch", "rss"] });
    expect(seen).toContain("NEAREST ESCO SKILLS (ESCO v1.2.1, all 13,939 skills searched, bge-m3 cosine similarity)");
    expect(seen).toContain("implement ICT risk management (similarity 0.60)");
    expect(seen).toMatch(/NEAREST SKILLS IN OUR CATALOGUE[^\n]*\n  - [^\n]*: tasks: /); // our skills come with their tasks
    expect(seen).toMatch(/EVIDENCE .*1 trusted source, 1 organisation/);
    expect(seen).toContain("(accountingtoday.com, 2026-10-13)");
    expect(r.candidates[0]).toMatchObject({ status: "pending", state: "watching" });
    expect(r.candidates[0].committee.skeptic).toMatch(/named none of the listed skills/);

    // Naming a listed ESCO skill makes it an alias of that skill (recorded).
    const r2 = await runCommittee(await skeptic("implement ICT risk management"), { sources: ["websearch", "rss"] });
    expect(r2.candidates[0]).toMatchObject({ status: "merged", escoMatch: { id: "e1", name: "implement ICT risk management" } });
    expect(r2.counts.mergedSkeptic).toBe(1);
  });

  it("without bge-m3 it falls back to a word search over all ESCO skills, says so, and still catches an ESCO skill by name", async () => {
    withTavily();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const quote = "Accounts payable clerks process payments for suppliers once AI tools have matched the invoices.";
    const net = mockFetch([
      ["https://api.tavily.com/search", json({ results: [{ url: AT, title: "AI in accounts payable", content: "AI matches invoices for accounts payable teams.", published_date: "2026-10-13T08:00:00Z" }] })],
      [AT, { body: page("AI in accounts payable", [quote, "Finance teams use AI to match invoices. ".repeat(4)], "2026-10-13T08:00:00Z") }],
      [/.*/, { status: 404, body: "" }],
    ]);
    const svc = await testServices({ fetch: net, llmHandler: req => req.role === "main" ? proposer("process payments", quote)(req) : new Error("skeptic not expected") });
    const r = await runCommittee(svc, { sources: ["websearch", "rss"] });
    expect(r.candidates[0]).toMatchObject({ status: "merged", escoMatch: { name: "process payments", how: "same name", source: "esco" } });
    const s = (await svc.db.query("select summary from runs where id=$1", [r.runId])).rows[0].summary as any;
    expect(s.escoCheck).toMatchObject({ mode: "text" });
    expect(s.escoCheck.reason).toMatch(/mock-bow.*word-overlap search over all ESCO/);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/ESCO duplicate check/));
  });
});

describe("evidence accumulates across runs", () => {
  it("a second wording of a watched candidate joins it; the admin queue shows it as watching with progress", async () => {
    withTavily();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let round = 1;
    const llmHandler = (req: any) => {
      if (req.role === "reviewer") return { verdict: "keep", reason: "A concrete audit ability" };
      const [phrase, quote] = round === 1 ? ["AI risk evaluation", Q_RT] : ["Evaluation AI risk", Q_AT]; // same skill, different wording
      const doc = docOf(req.user, quote);
      return { proposals: doc ? [{ phrase, doc, quote, linkedSkill: "audit" }] : [] };
    };
    const svc = await testServices({ fetch: world({ tavily: false }), llmHandler, config: { adminToken: null } }); // day 1: only the Reuters page
    const r1 = await runCommittee(svc, { sources: ["websearch", "rss"] });
    expect(r1.candidates).toHaveLength(1);
    expect(r1.candidates[0]).toMatchObject({ label: "AI risk evaluation", state: "watching", mentions: 1, organisations: 1 });

    round = 2;
    svc.fetch = world(); // day 2: search also finds the Accounting Today page (Reuters was read already)
    svc.now = () => new Date("2026-10-24T10:00:00Z");
    const r2 = await runCommittee(svc, { sources: ["websearch", "rss"] });
    expect(r2.counts.accumulated).toBe(1);
    const c = r2.candidates[0];
    expect(c).toMatchObject({ id: r1.candidates[0].id, label: "AI risk evaluation", state: "watching", mentions: 2, organisations: 2,
      progress: { mentions: { have: 2, need: 15 }, organisations: { have: 2, need: 5 }, weeks: { have: 2, need: 4 } } });
    expect(c.synonyms).toEqual(expect.arrayContaining(["AI risk evaluation", "Evaluation AI risk"]));
    expect(c.evidence).toEqual(expect.arrayContaining([
      { quote: Q_AT, url: AT, date: "2026-10-13", organisation: "accountingtoday.com" },
      { quote: Q_RT, url: REUTERS, date: "2026-10-19", organisation: "reuters.com" },
    ]));
    expect((await svc.db.query("select count(*)::int as n from emerging_candidates where not is_sample")).rows[0].n).toBe(1);

    const q = (await request(createApp(svc)).get("/api/review")).body;
    expect(q.emerging.find((e: any) => e.id === c.id)).toMatchObject({ state: "watching", progress: { mentions: { have: 2, need: 15 } } });
  });

  it("one run's evidence alone never passes the thresholds (it can only start watching)", async () => {
    const svc = await testServices();
    const doms = ["apnews.com", "bbc.com", "theedgemalaysia.com", "thestar.com.my", "zdnet.com"];
    for (let i = 0; i < 15; i++)
      await svc.db.query(`insert into emerging_mentions(run_id,phrase_key,label,linked_skill,url,domain,quote,source_date) values (7,'k','K','audit',$1,$2,'q',$3)`,
        [`https://www.${doms[i % 5]}/a${i}`, doms[i % 5], new Date(Date.parse("2026-09-20") + i * 2.5 * 86_400_000).toISOString().slice(0, 10)]);
    const same = await evidenceFor(svc, "k", 7);
    expect(same.passes).toMatchObject({ mentions: true, organisations: true, growing: true, linked: true, earlierRun: false });
    expect(same.all).toBe(false);
    expect((await evidenceFor(svc, "k", 8)).all).toBe(true);
  });

  it("counts one page once, even under URL variants (trailing slash, www., utm_ tags)", async () => {
    const svc = await testServices();
    for (const url of ["https://techcrunch.com/2026/09/28/mavi/", "https://techcrunch.com/2026/09/28/mavi", "https://www.techcrunch.com/2026/09/28/mavi?utm_source=x"])
      await svc.db.query(`insert into emerging_mentions(run_id,phrase_key,label,linked_skill,url,domain,quote,source_date) values (1,'m','M','audit',$1,'techcrunch.com','q','2026-09-28')`, [url]);
    const ev = await evidenceFor(svc, "m");
    expect(ev.mentions).toBe(1);
    expect(ev.evidence).toHaveLength(1);
  });

  it("labels live candidates below the thresholds 'watching' and leaves sample skills as they were", () => {
    expect(candidateJson({ id: 1, label: "x", status: "pending", skill_id: null, is_sample: false, postings: 1, employers: 1, weeks: 1 })).toMatchObject({ state: "watching", progress: { mentions: { have: 1, need: 15 } } });
    expect(candidateJson({ id: 2, label: "y", status: "pending", skill_id: "prompt", is_sample: true }).state).toBe("pending");
  });
});
