// Builds the configured embedding provider (OWNER: intake agent). First match wins:
//   1. RunPod Serverless, BAAI/bge-m3 (worker-infinity-embedding)  if RUNPOD_API_KEY + RUNPOD_EMBED_ENDPOINT_ID are set
//   2. a local Infinity server, BAAI/bge-m3                         if LOCAL_EMBED_URL is set (e.g. http://127.0.0.1:7997)
//   3. Gemini gemini-embedding-001 (768 dims)                       if a Gemini key is set
//   4. none: callers fall back to keyword matching, labelled "basic matching".
// EMBED_PROVIDER=runpod|local|gemini|none forces one. With RunPod + LOCAL_EMBED_URL, RunPod failures fail over to local.
// RunPod and local run the same engine (Infinity) with the same OpenAI-compatible API, so they share one client
// and store the same model name: their vectors are interchangeable. Gemini vectors have a different model label,
// so they are never compared with bge-m3 vectors (matching checks skills.embedding_model).
// Every vector is cached in embedding_cache, keyed by model + sha256(text), so the same text is embedded once.
import { createHash } from "node:crypto";
import type { Db } from "./db.ts";
import { noEmbedder, type Embedder } from "./embed.ts";
import { geminiKeysFromEnv } from "./llm.ts";

export const RUNPOD_MODEL = "BAAI/bge-m3";
export const GEMINI_EMBED_MODEL = "gemini-embedding-001";
export const GEMINI_DIMS = 768;
// The model label stored next to every vector. It names everything that changes the numbers (model + size).
export const GEMINI_MODEL_LABEL = `${GEMINI_EMBED_MODEL}@${GEMINI_DIMS}`;

interface Opts { fetch?: typeof fetch; timeoutMs?: number }

export function createEmbedder(env: NodeJS.ProcessEnv, db?: Db, opts: Opts = {}): Embedder {
  const doFetch = opts.fetch || globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 90000; // a cold RunPod worker takes about a minute to load bge-m3
  // EMBED_PROVIDER picks one explicitly (runpod | local | gemini | none); "auto" (default) = first configured.
  const choice = (env.EMBED_PROVIDER || "auto").trim().toLowerCase();
  const want = (p: string) => choice === "auto" || choice === p;
  const runpodKey = (env.RUNPOD_API_KEY || env.run_pod_key || env.RUNPOD_KEY || "").trim(), runpodId = (env.RUNPOD_EMBED_ENDPOINT_ID || "").trim();
  const localUrl = (env.LOCAL_EMBED_URL || "").trim().replace(/\/+$/, "");
  const bgeModel = (env.RUNPOD_EMBED_MODEL || env.LOCAL_EMBED_MODEL || RUNPOD_MODEL).trim();
  const local = localUrl ? openAiCompatible(doFetch, timeoutMs, "Local embeddings", localUrl, bgeModel, null) : null;
  if (choice === "none") return noEmbedder;
  if (want("runpod") && runpodKey && runpodId) {
    // A cold RunPod worker can take minutes; when a local bge-m3 server is also running, fail over to it quickly.
    const runpod = openAiCompatible(doFetch, local ? Math.min(timeoutMs, 20000) : timeoutMs, "RunPod",
      `https://api.runpod.ai/v2/${encodeURIComponent(runpodId)}/openai/v1`, bgeModel, runpodKey);
    return withCache(db, "runpod-bge-m3", bgeModel, local
      ? async texts => { try { return await runpod(texts); } catch { return local(texts); } } // same model: vectors interchangeable
      : runpod);
  }
  if (want("local") && local) return withCache(db, "local-bge-m3", bgeModel, local);
  const keys = geminiKeysFromEnv(env);
  if (want("gemini") && keys.length) {
    let keyIdx = 0;
    return withCache(db, "gemini", GEMINI_MODEL_LABEL, async texts => {
      let lastErr = "";
      // Rate limit or server error: rotate to the next key. Each key gets one try.
      for (let attempt = 0; attempt < keys.length; attempt++) {
        const key = keys[keyIdx % keys.length];
        const res = await timedFetch(doFetch, `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBED_MODEL}:batchEmbedContents`, timeoutMs, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            requests: texts.map(text => ({
              model: `models/${GEMINI_EMBED_MODEL}`, content: { parts: [{ text }] }, outputDimensionality: GEMINI_DIMS,
            })),
          }),
        });
        if (res.status === 429 || res.status === 403 || res.status >= 500) { lastErr = `Gemini embeddings HTTP ${res.status}`; keyIdx++; continue; }
        if (!res.ok) throw new Error(`Gemini embeddings HTTP ${res.status}`);
        const body: any = await res.json();
        return (body?.embeddings || []).map((e: any) => e.values);
      }
      throw new Error(lastErr || "Gemini embeddings unavailable");
    });
  }
  return noEmbedder;
}

/** OpenAI-compatible embeddings call (Infinity, locally or on RunPod): POST {base}/embeddings. */
function openAiCompatible(doFetch: typeof fetch, timeoutMs: number, name: string, baseUrl: string, model: string, apiKey: string | null) {
  return async (texts: string[]): Promise<number[][]> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await timedFetch(doFetch, `${baseUrl}/embeddings`, timeoutMs, { method: "POST", headers, body: JSON.stringify({ model, input: texts }) });
    if (!res.ok) throw new Error(`${name} HTTP ${res.status}`);
    const body: any = await res.json();
    // Response: { data: [{ index, embedding }] }. Sort by index so vectors line up with the input texts.
    const rows = [...(body?.data || [])].sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0));
    return rows.map((r: any) => r.embedding);
  };
}

async function timedFetch(doFetch: typeof fetch, url: string, ms: number, init: RequestInit) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await doFetch(url, { ...init, signal: ctrl.signal }); }
  catch (e: any) { throw new Error(e?.name === "AbortError" ? "Embedding request timed out" : e?.message || String(e)); }
  finally { clearTimeout(timer); }
}

const BATCH = 100; // Gemini's batch limit; also a sensible request size for RunPod

/** Wraps a raw provider call with: the DB cache, batching, shape checks and status tracking. */
function withCache(db: Db | undefined, provider: Embedder["provider"], model: string,
                   call: (texts: string[]) => Promise<number[][]>): Embedder {
  let lastError: string | null = null;
  const hash = (t: string) => createHash("sha256").update(t).digest("hex");
  return {
    provider, model,
    status: () => ({ provider, model, configured: true, lastError }),
    async embed(texts: string[]) {
      if (!texts.length) return [];
      const hashes = texts.map(hash);
      const found = new Map<string, number[]>();
      if (db) {
        const uniq = [...new Set(hashes)];
        for (let i = 0; i < uniq.length; i += 500) {
          const part = uniq.slice(i, i + 500);
          const r = await db.query<{ text_hash: string; vector: any }>(
            `select text_hash, vector from embedding_cache where model=$1 and text_hash in (${part.map((_, j) => `$${j + 2}`).join(",")})`,
            [model, ...part]);
          for (const row of r.rows) found.set(row.text_hash, typeof row.vector === "string" ? JSON.parse(row.vector) : row.vector);
        }
      }
      // Embed only the texts we have not seen before (each distinct text once).
      const missing = [...new Map(texts.map((t, i) => [hashes[i], t])).entries()].filter(([h]) => !found.has(h));
      try {
        for (let i = 0; i < missing.length; i += BATCH) {
          const part = missing.slice(i, i + BATCH);
          const vecs = await call(part.map(([, t]) => t));
          if (vecs.length !== part.length || vecs.some(v => !Array.isArray(v) || !v.length || v.some(x => typeof x !== "number")))
            throw new Error(`${provider} returned ${vecs.length} vectors for ${part.length} texts`);
          for (let j = 0; j < part.length; j++) {
            found.set(part[j][0], vecs[j]);
            if (db) await db.query("insert into embedding_cache(model, text_hash, vector) values ($1,$2,$3) on conflict do nothing",
              [model, part[j][0], JSON.stringify(vecs[j])]);
          }
        }
      } catch (e: any) {
        lastError = e?.message || String(e);
        throw e;
      }
      lastError = null;
      return hashes.map(h => found.get(h)!);
    },
  };
}
