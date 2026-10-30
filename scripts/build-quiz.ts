// Builds db/seed/quiz_tasks.json for the no-CV quiz (server/services/quiz.ts): for every task the quiz may show,
//   esco: ESCO skills of the task's own occupations that the task uses (bge-m3 cosine, same vectors as CV intake)
//   cat:  the two nearest catalogue skills (bge-m3 cosine), so the server can require a clear winner
//   en/ms: (with --chips) a short plain-language chip written by the LLM from the task statement (never new tasks)
// Usage: npx tsx scripts/build-quiz.ts [--chips] [--sector finance,office]
// Needs RunPod bge-m3 (EMBED_PROVIDER=runpod, run_pod_key, RUNPOD_EMBED_ENDPOINT_ID); --chips needs a Gemini key.
// Re-running keeps chips already written, so an interrupted --chips run can continue.
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "../server/lib/db.ts";
import { createEmbedder } from "../server/lib/embedder.ts";
import { createGeminiLlm, geminiKeysFromEnv } from "../server/lib/llm.ts";
import { loadEsco } from "../server/services/esco.ts";
import { loadEscoVectors } from "../server/services/esco-match.ts";
import { SECTORS, sectorModel, rewriteChips, type QuizTask } from "../server/services/quiz.ts";

const OUT = path.join(projectRoot, "db", "seed", "quiz_tasks.json");
const ESCO_MIN = 0.62, ESCO_WITHIN = 0.06, ESCO_MAX = 3;
const BATCH = 256; // RunPod latency is mostly per request, so bigger batches are faster
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const sectors = arg("--sector")?.split(",") || SECTORS.map(s => s.id);

const d = loadEsco(), v = loadEscoVectors();
if (!d || !v) throw new Error("ESCO data or ESCO skill vectors missing (db/seed)");
const embed = createEmbedder(process.env);
if (embed.model !== v.model) throw new Error(`Need ${v.model} embeddings (got ${embed.provider}/${embed.model}); set EMBED_PROVIDER=runpod`);
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { tasks: {} };
const out: Record<string, any> = prev.tasks || {};

const tasks = new Map<string, QuizTask>();
for (const s of sectors) for (const t of sectorModel(s)!.pool) tasks.set(t.id, t);
console.log(`${tasks.size} pool tasks in ${sectors.length} sectors`);

// ESCO occupations per O*NET code (any sector): the skills a task may link to.
const escoByOnet = new Map<string, string[]>();
for (const [id, l] of Object.entries<any>(d.onetLinks)) escoByOnet.set(l.onet, [...(escoByOnet.get(l.onet) || []), id]);
const pos = new Map(v.ids.map((id, i) => [id, i]));
const K = JSON.parse(readFileSync(path.join(projectRoot, "db", "seed", "knowledge.json"), "utf8"));
const unit = (x: number[]) => { const n = Math.hypot(...x) || 1; return x.map(y => y / n); };
const catVec = (await embed.embed(K.skills.map((s: any) => [s.label, ...(s.tasks || []).map((t: any) => t.text)].join(". ")))).map(unit);

// Written to a temp file and renamed, so a server reading it never sees half a file.
const save = () => { writeFileSync(OUT + ".tmp", JSON.stringify({
  _meta: {
    generatedBy: "scripts/build-quiz.ts", generated: new Date().toISOString().slice(0, 10),
    tasks: "O*NET task statements (O*NET Database, USDOL/ETA, CC BY 4.0) via the ESCO-O*NET crosswalk; we have modified this information; USDOL/ETA has not approved, endorsed or tested these modifications.",
    esco: `ESCO v1.2.1 skills of the task's own occupations with bge-m3 cosine >= ${ESCO_MIN} (and within ${ESCO_WITHIN} of the best), at most ${ESCO_MAX}.`,
    cat: "The two nearest catalogue skills (db/seed/knowledge.json) by bge-m3 cosine to label + tasks.",
    chips: "en/ms: plain-language rewrites of the task statement by an LLM (only rewording; the server falls back to the statement).",
  },
  tasks: Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b))),
}) + "\n"); renameSync(OUT + ".tmp", OUT); };

const todo = [...tasks.values()].filter(t => !out[t.id]?.esco);
for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  const vecs = (await embed.embed(batch.map(t => t.text))).map(unit);
  batch.forEach((t, k) => {
    const u = vecs[k];
    const cand = [...new Set((escoByOnet.get(t.onet) || []).flatMap(id => [...d.occupations[id].essential, ...d.occupations[id].optional]))];
    const es = cand.filter(id => pos.has(id)).map(id => {
      const off = pos.get(id)! * v.dims; let dot = 0;
      for (let j = 0; j < v.dims; j++) dot += u[j] * v.q[off + j];
      return { id, s: dot * v.scales[pos.get(id)!] };
    }).sort((a, b) => b.s - a.s);
    const best = es[0]?.s ?? 0;
    const cs = K.skills.map((s: any, j: number) => [s.id, Math.round(1000 * u.reduce((acc, x, n) => acc + x * catVec[j][n], 0)) / 1000] as [string, number])
      .sort((a: any, b: any) => b[1] - a[1]).slice(0, 2);
    out[t.id] = { ...out[t.id], esco: es.filter(e => e.s >= ESCO_MIN && e.s >= best - ESCO_WITHIN).slice(0, ESCO_MAX).map(e => e.id), cat: cs };
  });
  save();
  console.log(`embedded ${Math.min(i + BATCH, todo.length)} / ${todo.length}`);
}

if (process.argv.includes("--chips")) {
  const llm = createGeminiLlm({ keys: geminiKeysFromEnv() });
  const need = [...tasks.values()].filter(t => !out[t.id]?.en);
  let done = 0;
  const chunks: QuizTask[][] = [];
  for (let i = 0; i < need.length; i += 40) chunks.push(need.slice(i, i + 40));
  const worker = async () => {
    for (let c = chunks.shift(); c; c = chunks.shift()) {
      try {
        const r = await rewriteChips({ llm }, c.map(t => ({ id: t.id, text: t.text })));
        for (const [id, x] of Object.entries(r)) out[id] = { ...out[id], en: x.en, ms: x.ms };
      } catch (e: any) { console.warn(`\nchunk failed: ${e.message}`); }
      done += c.length; process.stdout.write(`\rchips ${done} / ${need.length}`);
      save();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  console.log();
}
console.log(`wrote ${OUT}`);
