// Replay accuracy of the three-agent vote: run it on past signals that a PERSON already decided and
// report how often the agents agree with the person. Nothing is invented: only real human decisions count.
//
//   npx tsx scripts/eval-votes.ts [--data data/pglite] [--peek 0]
//
// What counts as a human decision (read from the signals table of a LOCAL PGlite folder, never from DATABASE_URL):
//   approved   status 'applied' and decided_by is a person (not 'auto...')         -> human said include
//   rejected   status 'rejected' and decided_by is a person                         -> human said exclude
//   spot check an auto-applied signal a person checked: 'ok' -> include, 'wrong' -> exclude
// Not counted (listed in the report with the reason): signals applied by rules and never checked, pending ones,
// rejections by the fixed rules, sample rows, and undos that were made by a test or to roll back, not to judge the evidence.
// The folder is copied to a temp folder first, so a running server's data is never touched.
// The vote sees what the database kept: the claim, the quote, the source and the date. The live pipeline also shows a
// page excerpt around the quote; the database does not keep page text, so here the excerpt is the quote itself.
// --peek N also votes on up to N not-counted real signals, shown separately as "not scored".
import "dotenv/config";
import { cpSync, rmSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb, projectRoot } from "../server/lib/db.ts";
import { loadGraph } from "../server/kb.ts";
import { createGeminiLlm, geminiKeysFromEnv } from "../server/lib/llm.ts";
import type { Services } from "../server/context.ts";
import { claimText } from "../server/agents/reviewer.ts";
import { castVotes, type VoteSet } from "../server/agents/voters.ts";
import { EXPOSURE_STEP, DEMAND_STEP } from "../server/agents/scout.ts";
import { TRIAGE } from "../server/triage.ts";

const args = process.argv.slice(2);
const arg = (name: string, d: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
const dataDir = path.resolve(projectRoot, arg("--data", "data/pglite"));
const peek = Number(arg("--peek", "0"));

type Human = "include" | "exclude";
interface Row { id: number; node_id: string; kind: string; title: string; delta_e: number; delta_d: number; quote: string; source_url: string; source_date: any;
  n_sources: number; status: string; triage: string; decided_by: string | null; decision_note: string | null; spotcheck: string | null; is_sample: boolean }

/** The person's verdict on this signal, or why there is none. */
function humanVerdict(r: Row): { verdict: Human | null; why: string } {
  if (r.is_sample) return { verdict: null, why: "sample row" };
  if (r.spotcheck === "ok") return { verdict: "include", why: "a person spot-checked it: ok" };
  if (r.spotcheck === "wrong") return { verdict: "exclude", why: "a person spot-checked it: wrong" };
  const person = !!r.decided_by && !/^auto/i.test(r.decided_by);
  if (r.status === "applied" && person) return { verdict: "include", why: `approved by ${r.decided_by}` };
  if (r.status === "rejected" && person) return { verdict: "exclude", why: `rejected by ${r.decided_by}` };
  if (r.status === "reverted") return { verdict: null, why: `approved, then undone (${r.decision_note || "no note"}): an undo, not a judgement of the evidence` };
  if (r.status === "applied") return { verdict: null, why: "applied by rules, never checked by a person" };
  if (r.status === "pending") return { verdict: null, why: "still waiting for a person" };
  return { verdict: null, why: "rejected by the fixed rules, not by a person" };
}

function magnitudeOf(r: Row): "small" | "medium" | "large" {
  const steps = r.kind === "demand" ? DEMAND_STEP : EXPOSURE_STEP;
  const v = Math.abs(r.kind === "demand" ? r.delta_d : r.delta_e);
  return (Object.entries(steps).sort((a, b) => Math.abs(a[1] - v) - Math.abs(b[1] - v))[0][0]) as any;
}

const copy = mkdtempSync(path.join(tmpdir(), "votes-eval-"));
cpSync(dataDir, path.join(copy, "db"), { recursive: true });
const db = await openDb({ dataDir: path.join(copy, "db") });   // always a local folder, never DATABASE_URL
const graph = await loadGraph(db);
const rows = (await db.query<Row>(`select id,node_id,kind,title,delta_e,delta_d,quote,source_url,source_date,n_sources,status,triage,decided_by,decision_note,spotcheck,is_sample
  from signals where quote is not null and source_url is not null order by id`)).rows
  .map(r => ({ ...r, delta_e: Number(r.delta_e), delta_d: Number(r.delta_d) }));
await db.close();
rmSync(copy, { recursive: true, force: true });

const llm = createGeminiLlm({ keys: geminiKeysFromEnv(), models: { main: process.env.GEMINI_MODEL || undefined, reviewer: process.env.GEMINI_REVIEWER_MODEL || undefined } });
if (!llm.status().configured) throw new Error("No Gemini key configured: the vote needs the AI models");
const svc = { llm } as unknown as Services;

async function vote(r: Row): Promise<VoteSet> {
  const node = graph.nodes[r.node_id];
  const tasks = (node?.tasks || []).map((t: any) => t.text as string);
  const d = r.kind === "demand" ? r.delta_d : r.delta_e;
  return castVotes(svc, {
    claim: claimText({ nodeName: node?.name || r.node_id, tasks, kind: r.kind, direction: d >= 0 ? "up" : "down", magnitude: magnitudeOf(r) }),
    skill: node?.name || r.node_id, tasks, quote: r.quote, excerpt: r.quote, sourceUrl: r.source_url, sourceTitle: r.title,
    sourceDate: r.source_date ? String(r.source_date instanceof Date ? r.source_date.toISOString() : r.source_date).slice(0, 10) : null, nSources: r.n_sources,
  }, 2500);
}
const includes = (v: VoteSet) => v.votes.filter(x => x.vote === "include").length;
/** What the system would have done with this vote. */
const outcome = (v: VoteSet) => (v.error || v.votes.length < TRIAGE.voters ? "no vote (flag)" : includes(v) >= TRIAGE.approveAt ? "auto-apply" : includes(v) === 0 ? "reject" : "flag (split)");

const judged = rows.map(r => ({ r, ...humanVerdict(r) }));
const scored = judged.filter(j => j.verdict);
const notScored = judged.filter(j => !j.verdict && !j.r.is_sample);

console.log(`Local data: ${path.relative(projectRoot, dataDir)}: ${rows.length} signals, ${scored.length} with a real human decision.`);
const results: { id: number; title: string; human: Human; why: string; votes: VoteSet; outcome: string; agrees: boolean }[] = [];
for (const j of scored) {
  const v = await vote(j.r);
  const o = outcome(v);
  // The agents "agree" when an approved signal would be auto-applied, or a rejected one would NOT be auto-applied.
  const agrees = j.verdict === "include" ? o === "auto-apply" : o !== "auto-apply";
  results.push({ id: j.r.id, title: j.r.title, human: j.verdict!, why: j.why, votes: v, outcome: o, agrees });
  console.log(`#${j.r.id} human ${j.verdict} -> agents ${o} (${v.votes.map(x => x.vote[0]).join("")}) ${agrees ? "agree" : "DISAGREE"}`);
}
const peeked: typeof results = [];
for (const j of notScored.slice(0, peek)) {
  const v = await vote(j.r);
  peeked.push({ id: j.r.id, title: j.r.title, human: "include", why: j.why, votes: v, outcome: outcome(v), agrees: false });
}

const X = results.filter(x => x.agrees).length, Y = results.length;
const cell = (h: Human, o: string) => results.filter(x => x.human === h && x.outcome === o).length;
const OUTS = ["auto-apply", "flag (split)", "reject", "no vote (flag)"];
const models = new Set<string>();
for (const x of [...results, ...peeked]) for (const v of x.votes.votes) models.add(v.model);
const today = new Date().toISOString().slice(0, 10);
const st = llm.status();

const md: string[] = [];
md.push("# Agent vote: replay accuracy", "");
md.push(`**Agents agreed with the human on ${X} of ${Y} signals a person had already decided.** ${Y < 20 ? `That is a very small sample (Y = ${Y}), so it says almost nothing about accuracy. It shows the script works and what data exists today. It is not evidence that the vote is right.` : ""}`, "");
md.push(`- Date: ${today}`);
md.push(`- Script: \`scripts/eval-votes.ts\`, data: \`${path.relative(projectRoot, dataDir).replace(/\\/g, "/")}\` (a local PGlite folder, copied before reading)`);
md.push(`- Models: main \`${st.models.main}\`, reviewer \`${st.models.reviewer}\`; models that actually answered: ${[...models].map(m => `\`${m}\``).join(", ") || "none"}`);
md.push(`- Roles: evidence checker and sceptic on the reviewer model, skill matcher on the main model; 3 calls per signal (${Y * 3 + peeked.length * 3} calls in this run)`);
md.push(`- Rule tested: 2 or 3 of 3 include = auto-apply; 1 of 3 = a person decides; 0 of 3 = reject. "Agree" means: the person approved and the agents would auto-apply, or the person rejected and the agents would not auto-apply.`);
md.push(`- Limit: the database keeps the quote, not the page, so the voters saw the quote as the page excerpt. In the live pipeline they also see the text around the quote.`, "");
md.push("## Human decisions found", "", `${rows.length} real and sample signals with a quote and a source link in the folder. Counted: **${Y}**.`, "");
md.push("| Signal | Human | Why it counts | Agents (evidence, skill, sceptic) | Agents would | Agree |", "|---|---|---|---|---|---|");
for (const x of results) md.push(`| #${x.id} ${x.title.slice(0, 60).replace(/\|/g, "/")} | ${x.human} | ${x.why} | ${x.votes.votes.map(v => `${v.vote} ${v.confidence.toFixed(2)}`).join(", ") || "-"} | ${x.outcome} | ${x.agrees ? "yes" : "no"} |`);
md.push("", "## Confusion breakdown", "", `| Human \\ Agents would | ${OUTS.join(" | ")} |`, `|---|${OUTS.map(() => "---").join("|")}|`);
for (const h of ["include", "exclude"] as Human[]) md.push(`| ${h === "include" ? "approved (include)" : "rejected (exclude)"} | ${OUTS.map(o => cell(h, o)).join(" | ")} |`);
md.push("", `Humans rejected: ${results.filter(x => x.human === "exclude").length}. Humans approved: ${results.filter(x => x.human === "include").length}. A rejection count of 0 means the false-approve rate (a bad signal the agents would let through) cannot be measured at all yet.`, "");
md.push("## Reasons the agents gave", "");
for (const x of results) { md.push(`**#${x.id}**`); for (const v of x.votes.votes) md.push(`- ${v.role} (${v.model}): ${v.vote}, ${v.confidence.toFixed(2)}. ${v.reason}`); if (x.votes.error) md.push(`- vote error: ${x.votes.error}`); md.push(""); }
md.push("## Not counted", "", "| Signal | Reason |", "|---|---|");
for (const j of notScored.filter(j => !peeked.some(p => p.id === j.r.id)).slice(0, 12)) md.push(`| #${j.r.id} ${j.r.title.slice(0, 60).replace(/\|/g, "/")} | ${j.why} |`);
const left = notScored.length - Math.min(12, notScored.length);
if (left > 0) md.push(`| ... and ${left} more | same reasons (pending, rules-applied or rejected by rules) |`);
const bySkip = new Map<string, number>();
for (const j of notScored) { const k = j.why.replace(/\s*\(.*$/, "").replace(/:.*$/, ""); bySkip.set(k, (bySkip.get(k) || 0) + 1); }
md.push("", `Counts by reason: ${[...bySkip].map(([k, n]) => `${k}: ${n}`).join("; ")}.`, "");
if (peeked.length) {
  md.push("## Not scored: what the vote says about signals no person has decided", "", "| Signal | Status today | Agents (evidence, skill, sceptic) | Agents would |", "|---|---|---|---|");
  for (const x of peeked) md.push(`| #${x.id} ${x.title.slice(0, 60).replace(/\|/g, "/")} | ${x.why} | ${x.votes.votes.map(v => v.vote).join(", ") || "-"} | ${x.outcome} |`);
  md.push("", "These are not part of X of Y: nobody has said whether they are right.", "");
}
writeFileSync(path.join(projectRoot, "eval", "VOTES.md"), md.join("\n"));
mkdirSync(path.join(projectRoot, "eval", "results"), { recursive: true });
writeFileSync(path.join(projectRoot, "eval", "results", `votes-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`), JSON.stringify({ date: today, models: st.models, answered: [...models], X, Y, results, peeked }, null, 1));
console.log(`\nAgents agreed with the human on ${X} of ${Y}. Wrote eval/VOTES.md`);
