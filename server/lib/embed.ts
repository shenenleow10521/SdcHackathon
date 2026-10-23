// Embedding interface for semantic matching (CV phrases -> skills, signal de-duplication, synonym merging).
// Providers are built in ./embedder.ts: RunPod Serverless bge-m3 (if configured), then Gemini embeddings,
// then none (callers fall back to keyword matching, labelled "basic matching").

export interface Embedder {
  provider: "runpod-bge-m3" | "local-bge-m3" | "gemini" | "none" | "mock";
  model: string;
  embed(texts: string[]): Promise<number[][]>;
  status(): { provider: string; model: string; configured: boolean; lastError: string | null };
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export const noEmbedder: Embedder = {
  provider: "none", model: "none",
  async embed() { throw new Error("No embedding provider configured"); },
  status: () => ({ provider: "none", model: "none", configured: false, lastError: null }),
};

/** Deterministic bag-of-words vectors, for tests. */
export function createMockEmbedder(dims = 64): Embedder {
  const vec = (t: string) => {
    const v = new Array(dims).fill(0);
    for (const w of t.toLowerCase().match(/[a-z0-9]+/g) || []) { let h = 0; for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0; v[h % dims] += 1; }
    return v;
  };
  return { provider: "mock", model: "mock-bow", embed: async ts => ts.map(vec), status: () => ({ provider: "mock", model: "mock-bow", configured: true, lastError: null }) };
}
