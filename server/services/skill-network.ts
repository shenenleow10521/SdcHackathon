// Skill -> skill network over all 13,939 ESCO skills, computed from data (no hand-made edges).
// Two skills are related when BOTH:
//   (a) jobs need them together: normalised pointwise mutual information (NPMI) of the two skills across the
//       3,039 ESCO occupations, each link weighted essential 1.0 / optional 0.5. NPMI compares how often two skills
//       co-occur with how often they would by chance, so generic skills ("use spreadsheets software", needed by
//       hundreds of jobs) don't link to everything. This is the co-occurrence notion of skill relatedness used in
//       labour-market research (e.g. Neffke & Henning 2013; Alabdulkareem et al. 2018, Science Advances;
//       Dawson et al. 2021, PLOS ONE), shrunk towards 0 when the evidence is only one or two jobs;
//   (b) they mean similar things: cosine of their bge-m3 embeddings (db/seed/esco_skill_vectors.bin).
// Requiring both filters co-occurrence accidents (two unrelated skills in one niche job) and embedding false
// friends ("prompting AI tools" ~ "prompt performers", which never share a job). Knowledge items ("emission
// standards") only link to knowledge items, and practical skills to practical skills, because a route step
// should be something you learn to do, reached from something you already do.
// relatedness = sqrt(cooc * emb), both rescaled to [0,1]; each skill keeps its top-k neighbours.
// Built by scripts/build-skill-network.ts into db/seed/esco_skill_network.json.gz.
import { readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { projectRoot } from "../lib/db.ts";
import { loadEsco } from "./esco.ts";
import { loadEscoVectors } from "./esco-match.ts";

export const NETWORK_FILE = path.join(projectRoot, "db", "seed", "esco_skill_network.json.gz");

export const NETWORK_PARAMS = {
  k: 10,              // neighbours kept per skill
  optionalWeight: 0.5,
  shrink: 1,          // NPMI x c/(c + shrink), c = weighted number of shared jobs: one shared job halves the score
  minCooc: 0.1,       // gate on the shrunk NPMI
  cosFloor: 0.5,      // bge-m3 cosine of a typical random ESCO skill pair (median 0.52) -> 0
  minCos: 0.58,       // gate on cosine (about the 70th percentile of random pairs)
};
export type NetworkParams = typeof NETWORK_PARAMS;

export interface NetworkInput {
  occupations: Record<string, { essential: string[]; optional: string[] }>;
  skills: Record<string, { type?: string }>;
  /** Embedding cosine of two skills, or null when either has no vector. */
  cosine: (a: string, b: string) => number | null;
}
export type Neighbour = [id: string, relatedness: number];

/** Weighted NPMI from co-occurrence mass `ab`, marginal masses `a`, `b` and the number of occupations `n`. */
export function npmi(ab: number, a: number, b: number, n: number) {
  if (ab <= 0) return -1;
  const pab = Math.min(ab / n, 1), pa = a / n, pb = b / n;
  if (pab >= 1) return 1; // both skills in every job: degenerate, treat as fully associated
  return Math.log(pab / (pa * pb)) / -Math.log(pab);
}

/** Combine the two signals; 0 when either fails its gate. */
export function combine(npmiValue: number, sharedJobs: number, cos: number, p: NetworkParams = NETWORK_PARAMS) {
  const cooc = Math.max(0, npmiValue) * sharedJobs / (sharedJobs + p.shrink);
  if (cooc < p.minCooc || cos < p.minCos) return 0;
  const emb = Math.min(1, Math.max(0, (cos - p.cosFloor) / (1 - p.cosFloor)));
  return Math.sqrt(Math.min(1, cooc) * emb);
}

/** Every skill's top-k related skills, strongest first. Pure: all data comes in through `input`. */
export function buildSkillNetwork(input: NetworkInput, opts: Partial<NetworkParams> = {}) {
  const p = { ...NETWORK_PARAMS, ...opts };
  const occ = Object.values(input.occupations);
  const n = occ.length;
  // Each job as a skill -> weight map (essential wins over optional if a skill is listed twice).
  const jobs = occ.map(o => {
    const m = new Map<string, number>();
    for (const s of o.optional) if (input.skills[s]) m.set(s, p.optionalWeight);
    for (const s of o.essential) if (input.skills[s]) m.set(s, 1);
    return m;
  });
  const mass = new Map<string, number>(); // weighted number of jobs that need each skill
  const postings = new Map<string, number[]>(); // skill -> indexes of jobs that need it
  jobs.forEach((m, j) => { for (const [s, w] of m) { mass.set(s, (mass.get(s) || 0) + w); if (!postings.has(s)) postings.set(s, []); postings.get(s)!.push(j); } });
  const kind = (s: string) => (input.skills[s]?.type === "knowledge" ? "knowledge" : "skill");

  const out = new Map<string, Neighbour[]>();
  for (const [a, js] of postings) {
    const co = new Map<string, number>();
    for (const j of js) {
      const wa = jobs[j].get(a)!;
      for (const [b, wb] of jobs[j]) if (b !== a) co.set(b, (co.get(b) || 0) + wa * wb);
    }
    const top: Neighbour[] = [];
    for (const [b, ab] of co) {
      if (kind(a) !== kind(b)) continue;
      const pre = npmi(ab, mass.get(a)!, mass.get(b)!, n) * ab / (ab + p.shrink);
      if (pre < p.minCooc) continue; // cheap gate before the 1,024-dim cosine
      const cos = input.cosine(a, b);
      if (cos === null) continue;
      const r = combine(npmi(ab, mass.get(a)!, mass.get(b)!, n), ab, cos, p);
      if (r > 0) top.push([b, r]);
    }
    top.sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
    if (top.length) out.set(a, top.slice(0, p.k));
  }
  return out;
}

/** The real inputs: ESCO occupations/skills and the int8 bge-m3 skill vectors. Null if either is missing. */
export function escoNetworkInput(): NetworkInput | null {
  const d = loadEsco(), v = loadEscoVectors();
  if (!d || !v) return null;
  const row = new Map(v.ids.map((id, i) => [id, i]));
  const cosine = (a: string, b: string) => {
    const i = row.get(a), j = row.get(b);
    if (i === undefined || j === undefined) return null;
    let dot = 0;
    for (let x = i * v.dims, y = j * v.dims, end = x + v.dims; x < end; x++, y++) dot += v.q[x] * v.q[y];
    return dot * v.scales[i] * v.scales[j];
  };
  return { occupations: d.occupations, skills: d.skills, cosine };
}

// ---- Loading the built artefact ------------------------------------------------------------------------------
// File format (compact): { _meta, ids: [skillId...], links: { [index]: [nbIndex, relatedness x 1000, ...] } }

interface Loaded { meta: any; byId: Map<string, Neighbour[]> }
let cache: Loaded | null | undefined;

/** Turn the compact file contents into skillId -> neighbours. */
export function decodeNetwork(file: { _meta?: any; ids: string[]; links: Record<string, number[]> }): Loaded {
  const byId = new Map<string, Neighbour[]>();
  for (const [i, flat] of Object.entries(file.links)) {
    const list: Neighbour[] = [];
    for (let t = 0; t < flat.length; t += 2) list.push([file.ids[flat[t]], flat[t + 1] / 1000]);
    byId.set(file.ids[Number(i)], list);
  }
  return { meta: file._meta ?? null, byId };
}

/** The opposite of decodeNetwork, used by the build script. */
export function encodeNetwork(net: Map<string, Neighbour[]>, meta: any) {
  const ids = [...new Set([...net.keys(), ...[...net.values()].flat().map(([b]) => b)])].sort();
  const ix = new Map(ids.map((id, i) => [id, i]));
  const links: Record<string, number[]> = {};
  for (const [a, list] of net) links[ix.get(a)!] = list.flatMap(([b, r]) => [ix.get(b)!, Math.round(r * 1000)]);
  return { _meta: meta, ids, links };
}

export function loadSkillNetwork(): Loaded | null {
  if (cache !== undefined) return cache;
  if (!existsSync(NETWORK_FILE)) return (cache = null);
  return (cache = decodeNetwork(JSON.parse(gunzipSync(readFileSync(NETWORK_FILE)).toString("utf8"))));
}

/** A skill's related skills, strongest first ([] if unknown or the network isn't built). */
export function neighbours(skillId: string, limit?: number): Neighbour[] {
  const list = loadSkillNetwork()?.byId.get(skillId) || [];
  return limit === undefined ? list : list.slice(0, limit);
}

/** Relatedness of two skills in [0,1]: the link from either side's neighbour list, else 0. */
export function relatedness(a: string, b: string): number {
  if (a === b) return 1;
  const find = (x: string, y: string) => neighbours(x).find(([id]) => id === y)?.[1];
  return find(a, b) ?? find(b, a) ?? 0;
}

/** For tests: use an in-memory network instead of the file (null = forget it and reload from disk). */
export function setSkillNetwork(net: Loaded | null) { cache = net ?? undefined; }
