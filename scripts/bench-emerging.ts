// Emerging-skill benchmark (eval/EMERGING.md). Runs on its own database, never the demo one:
//   PGLITE_DIR=data/pglite-bench EMBED_PROVIDER=runpod SUPABASE_URL= SUPABASE_ANON_KEY= SCOUT_SCHEDULE=off npx tsx scripts/bench-emerging.ts
// Phase 0: ESCO pre-check of the 5 catalogue skills mapped to "no ESCO equivalent" (bge-m3 vector search).
// Phase A: one committee run exactly as designed (runCommittee).
// Phase B: one focused run: the committee's own proposer, quote check, catalogue duplicate check and skeptic,
//          on pages picked for finance / accounting / ESG relevance (incl. Tavily trusted-domain search),
//          plus a duplicate check against all 13,939 ESCO skills (bge-m3). Thresholds are unchanged.
import { writeFileSync, mkdirSync } from "node:fs";
import { createServices } from "../server/services.ts";
import { loadGraph } from "../server/kb.ts";
import { runCommittee, propose, duplicateOf, evidenceFor, committeeSettings, SKEPTIC_SYSTEM, SkepticSchema, EMERGING_RULES, type Proposal } from "../server/agents/committee.ts";
import { collectItems, hydrate, type Query, type SourceItem } from "../server/sources/index.ts";
import { escoCandidates, escoMatchingAvailable } from "../server/services/esco-match.ts";
import { loadEsco } from "../server/services/esco.ts";

if (!/bench/.test(process.env.PGLITE_DIR || "")) throw new Error("Set PGLITE_DIR to a bench directory (e.g. data/pglite-bench) so the demo DB is never touched");
const OUT = process.argv[2] || "eval/results/emerging-run-latest.json";
const t0 = Date.now();
const svc = await createServices();
const cost = { llmCalls: { main: 0, reviewer: 0 }, llmFailures: 0, tavilySearches: 0, otherFetches: 0, embedCalls: 0, embedSeconds: 0, embedTexts: 0 };
const llm = svc.llm, embed = svc.embed, origFetch = svc.fetch;
svc.llm = { ...llm, complete: async (req: any) => { cost.llmCalls[req.role as "main" | "reviewer"]++; try { return await llm.complete(req); } catch (e) { cost.llmFailures++; throw e; } } } as any;
svc.embed = { ...embed, model: embed.model, embed: async (texts: string[]) => { const s = Date.now(); cost.embedCalls++; cost.embedTexts += texts.length; try { return await embed.embed(texts); } finally { cost.embedSeconds += (Date.now() - s) / 1000; } } } as any;
svc.fetch = (async (url: any, init?: any) => { if (String(url).includes("api.tavily.com")) cost.tavilySearches++; else cost.otherFetches++; return origFetch(url, init); }) as any;
const log = (...a: any[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
log("embedder", embed.model, "ESCO vectors usable:", escoMatchingAvailable(svc));
if (!escoMatchingAvailable(svc)) throw new Error("ESCO duplicate check needs bge-m3 (EMBED_PROVIDER=runpod or local)");
const esco = loadEsco()!;

// ---------- Phase 0: ESCO pre-check ----------
const pre = ["Prompting AI tools for finance", "Supervising AI workflows", "AI invoice review & exceptions", "GHG emissions accounting", "Three-way matching"];
log("phase 0: warming RunPod + ESCO pre-check");
const preTop = await escoCandidates(svc, pre, 6);
const precheck = pre.map((p, i) => ({ skill: p, top: preTop[i] }));
for (const p of precheck) log(" ", p.skill, "->", p.top.slice(0, 3).map(t => `${t.title} (${t.score})`).join("; "));

const graph = await loadGraph(svc.db);
const result: any = { startedAt: new Date(t0).toISOString(), embedder: embed.model, rules: EMERGING_RULES, precheck };

// ---------- Phase A: as designed ----------
log("phase A: runCommittee as designed");
const costBeforeA = JSON.parse(JSON.stringify(cost));
try {
  const a = await runCommittee(svc, { trigger: "manual" });
  const run = (await svc.db.query("select summary from runs where id=$1", [a.runId])).rows[0] as any;
  result.asDesigned = { status: a.status, counts: a.counts, candidates: a.candidates.map(c => ({ label: c.label, status: c.status, committee: c.committee, evidence: c.evidence })),
    pagesRead: run.summary.items, sources: run.summary.sources, proposerCalls: run.summary.proposerCalls, errors: run.summary.errors, cost: diff(costBeforeA, cost) };
  log("phase A:", a.status, JSON.stringify(a.counts), "pages:", run.summary.items?.length);
} catch (e: any) { result.asDesigned = { error: String(e?.message || e) }; log("phase A failed", e?.message); }

// ---------- Phase B: focused on finance / accounting / ESG ----------
const QUERIES: Query[] = [
  { terms: ["AI", "skills", "accountants"] }, { terms: ["AI agents", "finance teams", "skills"] },
  { terms: ["generative AI", "accounts payable", "invoice"] }, { terms: ["AI", "audit", "skills"] },
  { terms: ["AI", "sustainability reporting", "ESG"] }, { terms: ["AI", "carbon accounting"] },
  { terms: ["AI", "shared services", "finance operations"] }, { terms: ["AI", "finance jobs", "new skills"] },
];
const DOMAIN = /\b(financ\w*|accounting|accountants?|audit\w*|invoices?|payables?|receivables?|ledger|reconcil\w*|bookkeep\w*|tax|treasury|procure\w*|esg|sustainab\w*|carbon|emissions?|cfo|controllers?|shared services)\b/gi;
const AI = /\b(ai|artificial intelligence|agents?|agentic|generative|genai|copilot|llms?|automation)\b/gi;
const WORK = /\b(skills?|workers?|workforce|jobs?|roles?|employees|staff|teams?|hiring|reskill\w*|upskill\w*|talent)\b/gi;
const hits = (re: RegExp, s: string) => (s.match(re) || []).length;
const score = (it: SourceItem) => { const s = `${it.title} ${it.text}`; const d = hits(DOMAIN, s), a = hits(AI, s), w = hits(WORK, s); return d && a ? Math.min(d, 10) + Math.min(a, 10) + Math.min(w, 10) : 0; };
const PAGES = 24;

log("phase B: collecting (websearch/Tavily, rss, arxiv, openalex, hn)");
const costBeforeB = JSON.parse(JSON.stringify(cost));
const { items: found, status, since } = await collectItems(svc, { sources: ["websearch", "rss", "arxiv", "openalex", "hn"], queries: QUERIES, gdeltQueries: [] });
const ranked = found.map(it => ({ it, s: score(it) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
log(`collected ${found.length} items, ${ranked.length} mention AI + finance/ESG`);
const pages: SourceItem[] = [];
const unreadable: string[] = [];
for (const { it } of ranked) {
  if (pages.length >= PAGES) break;
  const full = await hydrate(svc, it, since);
  if (full && score(full) > 0) pages.push(full); else unreadable.push(it.url);
}
log(`pages read: ${pages.length}`);
committeeSettings.maxProposerCalls = Math.ceil(PAGES / committeeSettings.perCall); // one call per 2 pages, as designed; only the page budget is larger
const pr = await propose(svc, graph, pages);
log(`proposer: ${pr.calls} calls, ${pr.proposals.length} verified proposals, ${pr.errors.length} errors`);

// Raw proposals before the code checks are not returned by propose(); count what survived.
const runId = (await svc.db.query<{ id: number }>("insert into runs(kind, status, trigger, started_at) values ('committee','running','manual',$1) returning id", [new Date().toISOString()])).rows[0].id;
for (const p of pr.proposals)
  await svc.db.query(`insert into emerging_mentions(run_id, phrase_key, label, linked_skill, url, domain, quote, source_date) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (phrase_key, url) do nothing`,
    [runId, p.key, p.phrase, p.linkedSkill, p.url, p.domain, p.quote.slice(0, 600), p.date || null]);

const keys = [...new Set(pr.proposals.map(p => p.key))];
const escoTop = await escoCandidates(svc, keys.map(k => pr.proposals.find(p => p.key === k)!.phrase), 5);
const candidates: any[] = [];
for (const [i, key] of keys.entries()) {
  const ps = pr.proposals.filter(p => p.key === key);
  const label = ps[0].phrase;
  const ev = await evidenceFor(svc, key);
  const dup = await duplicateOf(svc, graph, label);
  const top = escoTop[i];
  const escoDup = top[0] && top[0].score >= EMERGING_RULES.duplicateCosine ? top[0] : null;
  let skeptic: any = null;
  if (!dup && !escoDup) {
    // Same skeptic prompt as the committee; "existing skills" = the closest catalogue skill plus the 5 closest ESCO skills.
    const near = [(ev.linkedSkill && graph.nodes[ev.linkedSkill]?.name) || null, ...top.map(t => `${t.title} (ESCO: ${(esco.skills[t.escoId]?.description || "").slice(0, 140)})`)].filter(Boolean).join("\n  ");
    try {
      const r = await svc.llm.complete({ role: "reviewer", system: SKEPTIC_SYSTEM, schema: SkepticSchema, maxOutputTokens: 300,
        user: `PROPOSED SKILL: ${label}\nCLOSEST EXISTING SKILLS:\n  ${near}\nEVIDENCE (data):\n${ev.evidence.slice(0, 3).map(e => `- "${e.quote}"`).join("\n")}` });
      skeptic = r.data;
    } catch (e: any) { skeptic = { verdict: "error", reason: String(e?.message || e).slice(0, 200) }; }
  }
  const outcome = dup ? "duplicate_of_catalogue" : escoDup ? "duplicate_of_esco_vector" : skeptic?.verdict === "keep" ? "kept" : skeptic?.verdict === "duplicate" ? "duplicate_skeptic" : `rejected_${skeptic?.verdict}`;
  candidates.push({ label, key, outcome, catalogueDuplicate: dup ? { ...dup, name: graph.nodes[dup.skillId].name } : null, escoTop: top, skeptic,
    linkedSkill: ev.linkedSkill, thresholds: { mentions: ev.mentions, organisations: ev.organisations, weeks: ev.weeks, passes: ev.passes, all: ev.all },
    mentions: ps.map(p => ({ quote: p.quote, url: p.url, domain: p.domain, date: p.date, title: p.title, phrase: p.phrase })) });
  log(`  ${label}: ${outcome}${top[0] ? ` | ESCO top: ${top[0].title} ${top[0].score}` : ""}${skeptic ? ` | skeptic: ${skeptic.verdict}: ${skeptic.reason}` : ""}`);
}
await svc.db.query("update runs set status='ok', finished_at=$2, summary=$3 where id=$1", [runId, new Date().toISOString(), JSON.stringify({ bench: true, candidates: candidates.length })]);

result.focused = {
  queries: QUERIES.map(q => q.terms.join(" ")), sources: status, itemsCollected: found.length, itemsRelevant: ranked.length, pageBudget: PAGES,
  pagesRead: pages.map(p => ({ sourceKind: p.sourceKind, url: p.url, title: p.title, date: p.date, via: (p as any).via })), unreadable,
  proposerCalls: pr.calls, proposerErrors: pr.errors, verifiedProposals: pr.proposals.length, phrases: keys.length,
  funnel: candidates.reduce((m: any, c) => (m[c.outcome] = (m[c.outcome] || 0) + 1, m), {}),
  candidates, cost: diff(costBeforeB, cost),
};
result.totalCost = cost;
result.seconds = Math.round((Date.now() - t0) / 1000);
mkdirSync("eval/results", { recursive: true });
writeFileSync(OUT, JSON.stringify(result, null, 1));
log("wrote", OUT, "funnel:", JSON.stringify(result.focused.funnel));
process.exit(0);

function diff(a: any, b: any): any { const o: any = {}; for (const k of Object.keys(b)) o[k] = typeof b[k] === "object" ? diff(a[k], b[k]) : Math.round((b[k] - a[k]) * 10) / 10; return o; }
