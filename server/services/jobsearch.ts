// Job search: catalogue jobs by title, description and the skills they need (token match + embeddings
// when an embedder is configured). Titles we don't have get the nearest catalogue jobs, marked low
// confidence, plus a live lookup in the ESCO occupation search (European Commission, free, no key).
import type { Services } from "../context.ts";
import type { FullGraph } from "../kb.ts";
import { cosine } from "../lib/embed.ts";

/** A result at or above this score is a confident catalogue match; below it the title is "unknown". */
export const CONFIDENT = 0.8;
const ESCO_URL = "https://ec.europa.eu/esco/api/search";
const ESCO_TIMEOUT_MS = 5000;
const STOP = new Set(["and", "of", "the", "for", "a", "an", "in", "to", "with", "on", "at", "or", "role", "job"]);

/** Lower-case word tokens with a light stem (accounting/accountant -> account), stop words removed. */
export function tokens(s: string): string[] {
  return (s.toLowerCase().normalize("NFKD").match(/[a-z0-9]+/g) || [])
    .filter(t => !STOP.has(t))
    .map(stem);
}
function stem(t: string) {
  for (const suf of ["ants", "ant", "ents", "ent", "ings", "ing", "ers", "er", "ors", "or", "ists", "ist", "s"])
    if (t.length - suf.length >= 4 && t.endsWith(suf)) return t.slice(0, -suf.length);
  return t;
}

/**
 * Token score in [0,1]: each query token counts 1 if it is in the job title, 0.5 if it is only in the
 * description or in the name/aliases of a skill the job needs; the score is the average over query tokens.
 */
export function tokenScore(q: string[], title: string[], other: Set<string>): number {
  if (!q.length) return 0;
  const t = new Set(title);
  return q.reduce((s, w) => s + (t.has(w) ? 1 : other.has(w) ? 0.5 : 0), 0) / q.length;
}

function jobTexts(graph: FullGraph) {
  return Object.entries(graph.nodes).filter(([, n]) => n.type === "job").map(([id, n]) => {
    const skillWords = (graph.req[id] || []).flatMap(r => [graph.nodes[r.skill]?.name || "", ...(graph.nodes[r.skill]?.aliases || [])]);
    return {
      id, title: n.name as string,
      titleTokens: tokens(n.name),
      otherTokens: new Set([...tokens(n.blurb || ""), ...tokens(skillWords.join(" "))]),
      text: `${n.name}. ${n.blurb || ""}`,
    };
  });
}

// Job-text embeddings, cached per embedding model and knowledge-base version.
const vecCache = new Map<string, number[][]>();

async function semanticScores(svc: Services, graph: FullGraph, q: string, jobs: ReturnType<typeof jobTexts>): Promise<number[] | null> {
  try {
    const key = `${svc.embed.provider}:${svc.embed.model}:${graph.kbVersion}`;
    let vecs = vecCache.get(key);
    if (!vecs) { vecs = await svc.embed.embed(jobs.map(j => j.text)); vecCache.set(key, vecs); }
    const [qv] = await svc.embed.embed([q]);
    return vecs.map(v => Math.max(0, cosine(qv, v)));
  } catch {
    return null; // no embedder configured or provider down: token matching only ("basic matching")
  }
}

export interface EscoHit { uri: string; title: string }

/** Parse the ESCO search response: _embedded.results[].{uri, title | preferredLabel.en}. */
export function parseEsco(body: any): EscoHit[] {
  const rows = body?._embedded?.results;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r: any) => ({ uri: String(r?.uri || ""), title: String(r?.title || r?.preferredLabel?.en || "") }))
    .filter(r => /^https?:\/\/data\.europa\.eu\/esco\/occupation\//.test(r.uri) && r.title);
}

const escoCache = new Map<string, { at: number; hits: EscoHit[] }>();

/** Live ESCO occupation search. Returns null on any failure (timeout, HTTP error, bad shape): the caller omits it. */
export async function escoSearch(svc: Services, q: string, limit = 5): Promise<EscoHit[] | null> {
  const key = q.toLowerCase().trim();
  const hit = escoCache.get(key);
  if (hit && svc.now().getTime() - hit.at < 86_400_000) return hit.hits;
  const url = `${ESCO_URL}?text=${encodeURIComponent(q)}&type=occupation&language=en&limit=${limit}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ESCO_TIMEOUT_MS);
  try {
    const res = await svc.fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json", "User-Agent": "HalaTuju/0.1 (hackathon prototype)" } });
    if (!res.ok) return null;
    const hits = parseEsco(await res.json()).slice(0, limit);
    escoCache.set(key, { at: svc.now().getTime(), hits });
    return hits;
  } catch {
    return null;
  } finally { clearTimeout(timer); }
}

export function clearSearchCaches() { vecCache.clear(); escoCache.clear(); }

/** Search the catalogue; for unknown titles add the nearest catalogue jobs (low confidence) and ESCO matches. */
export async function searchJobs(svc: Services, graph: FullGraph, q: string) {
  const jobs = jobTexts(graph);
  const qt = tokens(q);
  const sem = await semanticScores(svc, graph, q, jobs);
  const scored = jobs.map((j, i) => {
    const tok = tokenScore(qt, j.titleTokens, j.otherTokens);
    const s = sem ? sem[i] : 0;
    return { job: j.id, title: j.title, score: Math.round(Math.max(tok, s) * 100) / 100, via: s > tok ? "semantic" : "text" };
  }).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  const results = scored.filter(r => r.score >= CONFIDENT);
  const matching = sem ? "semantic" : "basic";
  if (results.length) return { q, matching, results };
  const esco = await escoSearch(svc, q);
  return {
    q, matching, results: [],
    unknown: {
      title: q, confidence: "low" as const,
      nearest: scored.filter(r => r.score > 0).slice(0, 3).map(({ job, title, score }) => ({ job, title, score })),
      ...(esco ? { esco, escoSource: "ESCO classification, European Commission (live search)" } : {}),
    },
  };
}
