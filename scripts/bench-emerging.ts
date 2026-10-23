// Emerging-skill benchmark (eval/EMERGING.md). Runs on its own database, never the demo one:
//   PGLITE_DIR=data/pglite-committee EMBED_PROVIDER=runpod SUPABASE_URL= SUPABASE_ANON_KEY= DATABASE_URL= SCOUT_SCHEDULE=off npx tsx scripts/bench-emerging.ts
// Phase 0: ESCO pre-check of the 5 catalogue skills mapped to "no ESCO equivalent" (bge-m3 vector search).
// Phase 1: one run of the shipped committee (runCommittee): page ranking + Tavily trusted-domain search, ESCO and catalogue
//          duplicate checks, skeptic with the nearest skills. Thresholds unchanged. Writes the run's funnel, every
//          candidate with its evidence, and the cost.
// (The 24 Oct "phase B" prototype that this replaced is described in eval/EMERGING.md.)
import { writeFileSync, mkdirSync } from "node:fs";
import { createServices } from "../server/services.ts";
import { runCommittee, EMERGING_RULES, committeeSettings } from "../server/agents/committee.ts";
import { escoCandidates, escoMatchingAvailable } from "../server/services/esco-match.ts";

if (!/bench|committee/.test(process.env.PGLITE_DIR || "") || process.env.DATABASE_URL) throw new Error("Set PGLITE_DIR to a separate directory (e.g. data/pglite-committee) and DATABASE_URL empty, so the demo DB is never touched");
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

// ---------- Phase 0: ESCO pre-check (also warms the RunPod worker) ----------
const pre = ["Prompting AI tools for finance", "Supervising AI workflows", "AI invoice review & exceptions", "GHG emissions accounting", "Three-way matching"];
const precheck = escoMatchingAvailable(svc) ? (await escoCandidates(svc, pre, 6)).map((top, i) => ({ skill: pre[i], top })) : [];
for (const p of precheck) log(" ", p.skill, "->", p.top.slice(0, 3).map(t => `${t.title} (${t.score})`).join("; "));

// ---------- Phase 1: the shipped committee ----------
const result: any = { startedAt: new Date(t0).toISOString(), embedder: embed.model, rules: EMERGING_RULES, settings: committeeSettings, precheck };
const before = JSON.parse(JSON.stringify(cost));
const c = await runCommittee(svc, { trigger: "manual" });
const run = (await svc.db.query("select summary from runs where id=$1", [c.runId])).rows[0] as any;
const s = run.summary || {};
result.committee = {
  runId: c.runId, status: c.status, error: c.error, counts: c.counts, funnel: s.funnel, escoCheck: s.escoCheck, notes: s.notes,
  queries: s.queries, sources: s.sources, pagesRead: s.items, proposerErrors: s.errors,
  candidates: c.candidates.map(x => ({ label: x.label, state: x.state, status: x.status, wordings: x.synonyms, committee: x.committee, evidence: x.evidence, progress: x.progress, linkedSkill: x.linkedSkill })),
  cost: diff(before, cost),
};
for (const x of c.candidates) log(`  ${x.label}: ${x.state} | ${x.committee?.duplicate} | skeptic: ${x.committee?.skeptic}`);
result.seconds = Math.round((Date.now() - t0) / 1000);
mkdirSync("eval/results", { recursive: true });
writeFileSync(OUT, JSON.stringify(result, null, 1));
log("wrote", OUT, "funnel:", JSON.stringify(s.funnel));
process.exit(0);

function diff(a: any, b: any): any { const o: any = {}; for (const k of Object.keys(b)) o[k] = typeof b[k] === "object" ? diff(a[k], b[k]) : Math.round((b[k] - a[k]) * 10) / 10; return o; }
