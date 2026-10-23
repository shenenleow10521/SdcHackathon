// Retrieval over all 13,939 ESCO skills for CV intake.
// The skill vectors are bge-m3 embeddings made once on RunPod (scripts/embed-esco-skills.ts), stored as int8.
// They are only compared with bge-m3 query vectors (RunPod or a local bge-m3 server), never with Gemini vectors.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "../lib/db.ts";
import type { Services } from "../context.ts";
import { loadEsco } from "./esco.ts";

const BIN = path.join(projectRoot, "db", "seed", "esco_skill_vectors.bin");
const META = path.join(projectRoot, "db", "seed", "esco_skill_vectors.meta.json");

/** The text each ESCO skill is embedded from. Kept here so the build script and any re-embedding agree. */
export function escoSkillText(s: { title: string; alt?: string[]; description?: string }) {
  return [s.title, (s.alt || []).slice(0, 4).join("; "), (s.description || "").slice(0, 240)].filter(Boolean).join(". ");
}

interface Vectors { model: string; dims: number; ids: string[]; q: Int8Array; scales: Float32Array }
let cache: Vectors | null | undefined;

export function loadEscoVectors(): Vectors | null {
  if (cache !== undefined) return cache;
  if (!existsSync(BIN) || !existsSync(META)) return (cache = null);
  const meta = JSON.parse(readFileSync(META, "utf8"));
  const buf = readFileSync(BIN);
  const n = meta.count, dims = meta.dims;
  const q = new Int8Array(buf.buffer, buf.byteOffset, n * dims);
  const scales = new Float32Array(buf.buffer.slice(buf.byteOffset + n * dims, buf.byteOffset + n * dims + n * 4));
  return (cache = { model: meta.model, dims, ids: meta.ids, q, scales });
}

export interface EscoCandidate { escoId: string; title: string; score: number }

/** Can ESCO retrieval run with the active embeddings? (Needs the same model the skill vectors were made with.) */
export function escoMatchingAvailable(svc: Services) {
  const v = loadEscoVectors();
  return !!v && !!loadEsco() && svc.embed.model === v.model;
}

/** Top-k ESCO skills for each phrase, by cosine similarity. Returns [] per phrase when unavailable. */
export async function escoCandidates(svc: Services, phrases: string[], k = 6): Promise<EscoCandidate[][]> {
  const v = loadEscoVectors(), esco = loadEsco();
  if (!v || !esco || !phrases.length || svc.embed.model !== v.model) return phrases.map(() => []);
  const qv = await svc.embed.embed(phrases);
  return qv.map(raw => {
    const norm = Math.sqrt(raw.reduce((s, x) => s + x * x, 0)) || 1;
    const u = Float32Array.from(raw, x => x / norm);
    // Keep a small sorted top-k while scanning all skills.
    const top: { i: number; s: number }[] = [];
    for (let i = 0, off = 0; i < v.ids.length; i++, off += v.dims) {
      let dot = 0;
      for (let d = 0; d < v.dims; d++) dot += u[d] * v.q[off + d];
      const s = dot * v.scales[i];
      if (top.length < k || s > top[top.length - 1].s) {
        top.push({ i, s });
        top.sort((a, b) => b.s - a.s);
        if (top.length > k) top.pop();
      }
    }
    return top.map(({ i, s }) => ({ escoId: v.ids[i], title: esco.skills[v.ids[i]].title, score: Math.round(s * 1000) / 1000 }));
  });
}
