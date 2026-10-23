// Offline check of confidence cut-offs for the ESCO skills the CV reader shows (no model calls).
//   npx tsx scripts/esco-cutoff.ts           # score the rules (offline)
//   npx tsx scripts/esco-cutoff.ts --embed   # first (re)compute the phrase-to-skill cosines (bge-m3 on RunPod, deterministic)
// Uses the saved suggestions (eval/results/esco-suggestions-full-latest.json, in the order the app kept them: phrase
// by phrase, then the AI's pick order), the blind judge's verdicts (eval/results/esco-judge/items.json) and the ESCO
// answer key (eval/cv/esco-labels.json). The run did not save the retrieval score (its query was the phrase plus an AI
// "skill hint" that was not saved), so --embed computes the bge-m3 cosine between the phrase alone and each suggested
// ESCO skill (eval/results/esco-suggestions-cosine.json): a stand-in for the retrieval score, which the app could compute from vectors it already has. Precision and recall use the same rules as esco-judge.ts and eval-cv.ts.
// The rule is CHOSEN ON THE TUNING SET (c01-c14) ONLY, by a criterion fixed before held-out numbers were printed:
//   highest tuning precision whose tuning lenient recall is at most 5 points below the current system's;
//   ties go to the higher tuning lenient recall.
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "../server/lib/db.ts";
import { loadEscoVectors } from "../server/services/esco-match.ts";
import { createEmbedder } from "../server/lib/embedder.ts";

const read = (...p: string[]) => JSON.parse(readFileSync(path.join(projectRoot, ...p), "utf8"));
const sugg: any[] = read("eval", "results", "esco-suggestions-full-latest.json");
const judged: any[] = read("eval", "results", "esco-judge", "items.json");
const facts = new Map<string, { escoIds: string[] }[]>(read("eval", "cv", "esco-labels.json").cases.map((c: any) => [c.id, c.facts]));
const tuning = new Set(read("eval", "cv", "labels.json").cases.map((c: any) => c.id));
// bge-m3 cosine between a raw query vector and one stored (int8) ESCO skill vector.
function escoCosine(raw: number[], escoId: string) {
  const v = loadEscoVectors()!, i = v.ids.indexOf(escoId);
  const norm = Math.sqrt(raw.reduce((s, x) => s + x * x, 0)) || 1;
  let dot = 0;
  for (let d = 0, off = i * v.dims; d < v.dims; d++) dot += (raw[d] / norm) * v.q[off + d];
  return dot * v.scales[i];
}
const COS = path.join(projectRoot, "eval", "results", "esco-suggestions-cosine.json");
if (process.argv.includes("--embed")) {
  const e = createEmbedder(process.env);
  if (e.model !== loadEscoVectors()?.model) throw new Error(`needs the bge-m3 embedder (got ${e.provider}); set EMBED_PROVIDER=runpod`);
  const phrases = [...new Set(sugg.map(s => s.phrase as string))], vecs: number[][] = [];
  for (let i = 0; i < phrases.length; i += 64) vecs.push(...await e.embed(phrases.slice(i, i + 64)));
  const vec = new Map(phrases.map((p, i) => [p, vecs[i]]));
  writeFileSync(COS, JSON.stringify(sugg.map(s => Math.round(1000 * escoCosine(vec.get(s.phrase)!, s.escoId)) / 1000)) + "\n");
}
const cosine: number[] = JSON.parse(readFileSync(COS, "utf8"));
const verdict = new Map(judged.map(x => [`${x.caseId}|${x.escoId}`, x]));

// Rank of each suggestion within its phrase (1 = the AI's first pick that the app kept).
let prev = "", rank = 0;
const rows = sugg.map((s, i) => {
  const k = `${s.caseId}|${s.phrase}`; rank = k === prev ? rank + 1 : 1; prev = k;
  const j = verdict.get(`${s.caseId}|${s.escoId}`);
  if (!j) throw new Error(`no verdict for ${s.caseId} ${s.escoId}`);
  return { ...s, rank, cosine: cosine[i], correct: j.verdict === "used" || (j.verdict === "listed" && j.flag === "listed") }; // as esco-judge.ts
});

// Recall: copied from scripts/eval-cv.ts (strict, and lenient with cosine >= 0.80 between ESCO skills).
const LENIENT_COSINE = 0.8;
const v = loadEscoVectors()!;
const idx = new Map(v.ids.map((id, i) => [id, i]));
function escoCos(a: string, b: string) {
  const i = idx.get(a), j = idx.get(b);
  if (i === undefined || j === undefined) return 0;
  let dot = 0;
  for (let d = 0, oi = i * v.dims, oj = j * v.dims; d < v.dims; d++) dot += v.q[oi + d] * v.q[oj + d];
  return dot * v.scales[i] * v.scales[j];
}
function escoRecall(facts: { escoIds: string[] }[], suggested: string[]) {
  const strict = facts.map(f => f.escoIds.some(id => suggested.includes(id)));
  const usedStrict = new Set(suggested.filter(s => facts.some(f => f.escoIds.includes(s))));
  const pairs: { f: number; s: string; sim: number }[] = [];
  facts.forEach((f, fi) => {
    if (strict[fi]) return;
    for (const s of suggested) if (!usedStrict.has(s)) {
      const sim = Math.max(...f.escoIds.map(id => escoCos(s, id)));
      if (sim >= LENIENT_COSINE) pairs.push({ f: fi, s, sim });
    }
  });
  const lenientVia: (string | null)[] = facts.map(() => null), usedS = new Set<string>();
  for (const p of pairs.sort((a, b) => b.sim - a.sim)) if (!lenientVia[p.f] && !usedS.has(p.s)) { lenientVia[p.f] = p.s; usedS.add(p.s); }
  return { strict, lenient: strict.map((x, i) => x || !!lenientVia[i]) };
}

const wilson = (k: number, n: number) => {
  const z = 1.96, p = k / n, den = 1 + z * z / n, c = (p + z * z / (2 * n)) / den, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / den;
  return `${(100 * Math.max(0, c - h)).toFixed(1)} to ${(100 * Math.min(1, c + h)).toFixed(1)}`;
};
const rate = (k: number, n: number) => ({ k, n, pct: Math.round(1000 * k / n) / 10, ci95: wilson(k, n) });

function score(keep: (r: any) => boolean, split: "tuning" | "heldout" | "all") {
  const inSplit = (id: string) => split === "all" || (split === "tuning") === tuning.has(id);
  const kept = rows.filter(r => inSplit(r.caseId) && keep(r));
  let strict = 0, lenient = 0, total = 0;
  for (const [id, fs] of facts) if (inSplit(id)) {
    const r = escoRecall(fs, kept.filter(k => k.caseId === id).map(k => k.escoId));
    strict += r.strict.filter(Boolean).length; lenient += r.lenient.filter(Boolean).length; total += fs.length;
  }
  return { shown: kept.length, precision: rate(kept.filter(r => r.correct).length, kept.length), strict: rate(strict, total), lenient: rate(lenient, total) };
}

const rules: Record<string, (r: any) => boolean> = { "current (up to 3 per phrase)": () => true };
for (const n of [1, 2]) rules[`first ${n} per phrase`] = r => r.rank <= n;
rules["drop 'listed'"] = r => r.shownInUse;
for (const n of [1, 2]) rules[`first ${n} per phrase, drop 'listed'`] = r => r.rank <= n && r.shownInUse;
rules["first 1 for 'listed', up to 3 in use"] = r => r.shownInUse || r.rank === 1;
rules["first 2 in use, first 1 'listed'"] = r => (r.shownInUse && r.rank <= 2) || r.rank === 1;
for (let t = 0.40; t < 0.605; t += 0.02) rules[`cosine >= ${t.toFixed(2)}`] = r => r.cosine >= t - 1e-9;
for (let t = 0.40; t < 0.605; t += 0.02) rules[`cosine >= ${t.toFixed(2)} or first pick`] = r => r.cosine >= t - 1e-9 || r.rank === 1;

const tun = Object.entries(rules).map(([name, f]) => ({ name, f, ...score(f, "tuning") }));
console.log("TUNING SET (c01-c14): the only numbers used to choose");
for (const t of tun) console.log(`${t.name.padEnd(40)} shown ${String(t.shown).padStart(4)}  precision ${t.precision.pct}%  strict ${t.strict.pct}%  lenient ${t.lenient.pct}%`);
const base = tun[0];
const chosen = tun.filter(t => t.lenient.pct >= base.lenient.pct - 5)
  .sort((a, b) => b.precision.pct - a.precision.pct || b.lenient.pct - a.lenient.pct)[0];
console.log(`\nchosen: ${chosen.name}\n`);
for (const split of ["heldout", "all"] as const) for (const t of [base, chosen]) console.log(split, JSON.stringify({ rule: t.name, ...score(t.f, split) }));
if (process.argv.includes("--all-rules")) for (const split of ["heldout", "all"] as const) for (const t of tun) console.log(split, JSON.stringify({ rule: t.name, ...score(t.f, split) }));
