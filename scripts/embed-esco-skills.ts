// Embeds all 13,939 ESCO skills once with the configured provider: bge-m3 on RunPod (GPU work must run on RunPod under
// the hackathon rules) or Gemini embeddings (Google's API, no GPU of ours)
// and writes them compactly for in-memory retrieval during CV intake:
//   db/seed/esco_skill_vectors.bin       int8 vectors (count x dims), then float32 per-vector scales
//   db/seed/esco_skill_vectors.meta.json model, dims, count, skill id order, how the text was built
// Usage: EMBED_PROVIDER=gemini|runpod npx tsx scripts/embed-esco-skills.ts
import "dotenv/config";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "../server/lib/db.ts";
import { createEmbedder } from "../server/lib/embedder.ts";
import { loadEsco } from "../server/services/esco.ts";
import { escoSkillText } from "../server/services/esco-match.ts";

const esco = loadEsco();
if (!esco) throw new Error("db/seed/esco_full.json.gz not found");
const embed = createEmbedder({ ...process.env, EMBED_PROVIDER: process.env.EMBED_PROVIDER || "runpod" }, undefined, { timeoutMs: 240000 });
if (embed.provider === "none") throw new Error("No embedding provider configured");
// Vectors are only ever compared with query vectors from the same model (esco-match.ts checks the model label).

// RunPod: use the job API (submit, poll, cancel on timeout) so a slow batch can never leave work stuck on the worker.
const rpKey = (process.env.RUNPOD_API_KEY || process.env.run_pod_key || "").trim(), rpId = (process.env.RUNPOD_EMBED_ENDPOINT_ID || "").trim();
async function runpodJob(texts: string[]): Promise<number[][]> {
  const base = `https://api.runpod.ai/v2/${rpId}`, headers = { Authorization: `Bearer ${rpKey}`, "Content-Type": "application/json" };
  let sub: any;
  // Just after max workers is raised, the router can still answer "paused" for a minute or two: wait and resubmit.
  for (let t = 0; t < 12; t++) {
    sub = await (await fetch(`${base}/run`, { method: "POST", headers, body: JSON.stringify({ input: { model: "BAAI/bge-m3", input: texts } }) })).json();
    if (sub?.id || sub?.code !== "ENDPOINT_PAUSED") break;
    await new Promise(r => setTimeout(r, 15000));
  }
  if (!sub?.id) throw new Error(`RunPod did not accept the job: ${JSON.stringify(sub).slice(0, 200)}`);
  const deadline = Date.now() + 1260000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));
    const st: any = await (await fetch(`${base}/status/${sub.id}`, { headers })).json().catch(() => ({}));
    if (st.status === "COMPLETED") return [...(st.output?.data || [])].sort((a: any, b: any) => a.index - b.index).map((d: any) => d.embedding);
    if (st.status === "FAILED" || st.status === "CANCELLED" || st.status === "TIMED_OUT") throw new Error(`RunPod job ${st.status}: ${st.error || ""}`);
  }
  await fetch(`${base}/cancel/${sub.id}`, { method: "POST", headers }).catch(() => {});
  throw new Error("RunPod job took over 21 minutes (cancelled)");
}
const embedTexts = (t: string[]) => (embed.provider === "runpod-bge-m3" && rpKey && rpId ? runpodJob(t) : embed.embed(t));

const ids = Object.keys(esco.skills).sort();
const texts = ids.map(id => escoSkillText(esco.skills[id]));
const n = ids.length;
const dims = (await embedTexts([texts[0]]))[0].length;
const q = new Int8Array(n * dims), scales = new Float32Array(n);
const t0 = Date.now();
const CHUNK = 64;
// Progress is checkpointed so an interrupted run resumes; each chunk is retried with a back-off.
const CKPT = path.join(projectRoot, "data", `esco_embed_checkpoint_${embed.provider}.json`);
mkdirSync(path.dirname(CKPT), { recursive: true });
const done: Record<number, number[][]> = existsSync(CKPT) ? JSON.parse(readFileSync(CKPT, "utf8")) : {};
for (let i = 0; i < n; i += CHUNK) {
  let vecs = done[i];
  for (let attempt = 1; !vecs; attempt++) {
    try { vecs = await embedTexts(texts.slice(i, i + CHUNK)); }
    catch (e: any) {
      if (attempt >= 8) throw e;
      console.log(`
chunk ${i}: ${e.message}; retry ${attempt}`);
      await new Promise(r => setTimeout(r, 30000 * Math.min(attempt, 3)));
    }
  }
  if (!done[i]) { done[i] = vecs.map(v => v.map(x => Math.round(x * 1e5) / 1e5)); writeFileSync(CKPT, JSON.stringify(done)); }
  // Free-tier Gemini embeddings allow 100 texts per minute per key: pace to stay under the limit.
  if (embed.provider === "gemini") await new Promise(r => setTimeout(r, Number(process.env.EMBED_PACE_MS || 11000)));
  vecs.forEach((v, j) => {
    if (v.length !== dims) throw new Error(`expected ${dims} dims, got ${v.length}`);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    const u = v.map(x => x / norm);
    const max = Math.max(...u.map(Math.abs)) || 1;
    scales[i + j] = max / 127;
    for (let k = 0; k < dims; k++) q[(i + j) * dims + k] = Math.round(u[k] / max * 127);
  });
  process.stdout.write(`
${Math.min(i + CHUNK, n)} / ${n} skills (${Math.round((Date.now() - t0) / 1000)} s)`);
}
const out = path.join(projectRoot, "db", "seed");
writeFileSync(path.join(out, "esco_skill_vectors.bin"), Buffer.concat([Buffer.from(q.buffer), Buffer.from(scales.buffer)]));
writeFileSync(path.join(out, "esco_skill_vectors.meta.json"), JSON.stringify({
  model: embed.model, provider: embed.provider, dims, count: n, quantization: "int8 per-vector scale, L2-normalised",
  text: "title. up to 4 alternative labels. first 240 characters of the description",
  esco: "ESCO v1.2.1", generated: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), ids,
}) + "\n");
console.log(`\nWrote ${n} vectors in ${Math.round((Date.now() - t0) / 1000)} s`);
