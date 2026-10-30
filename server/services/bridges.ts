// BRIDGES: pairs of ESCO skills from DIFFERENT fields whose underlying work is similar, so a person can carry what they
// do across fields ("check accounting records" -> "advise on carbon emissions reduction": both verify figures against
// source records). The within-field network (skill-network.ts) can't see these: it links skills that ESCO jobs list
// together, and no single ESCO job lists both ends of a bridge.
//
// 1. WORK PROFILE of a skill = what the work involves, in O*NET's field-independent activity vocabulary:
//      skill -> ESCO occupations needing it (essential 1.0, optional 0.5) -> crosswalked O*NET occupation -> its task
//      statements, each weighted by how much it is about THIS skill (bge-m3 cosine of skill and task text, ramped
//      between taskFloor and taskCeil; only the topTasks most relevant count) -> the activities O*NET links each task
//      to, at three levels of O*NET's work-activity hierarchy:
//        DWA  Detailed Work Activity (~2,000, e.g. "Verify accuracy of financial information")
//        IWA  Intermediate Work Activity (332, e.g. "Examine financial records or processes")
//        GWA  Generalized Work Activity (37 used, e.g. "Evaluating Information to Determine Compliance with Standards")
//      Each level is idf-weighted over O*NET occupations (generic activities count less) and L2-normalised; the levels
//      are joined with weights levelWeights, so the profile cosine is a hierarchical soft cosine: the same DWA counts
//      fully, the same IWA or GWA partly. DWAs alone are too field-worded to meet across fields ("Verify accuracy of
//      financial information" vs "Evaluate green operations for compliance with standards" share only their GWA).
// 2. BRIDGE SCORE = cosine of two work profiles x sqrt(confidence of each), where confidence = min(1, summed task
//    relevance / minMass) shrinks skills that only a task or two describe. Kept only when the pair crosses fields:
//      - no ESCO occupation lists both skills (co-occurrence = 0),
//      - their job contexts differ: cosine of their second-order co-occurrence vectors (the OTHER skills each appears
//        with, PPMI-weighted) <= maxContext, so "check accounting records" vs "maintain financial records" (same
//        field, never listed together) is not a bridge,
//      - they are mainly needed in different FIELDS: the ISCO-08 sub-major group where each is most needed, mapped to
//        one of 12 level-free field families (FIELD_FAMILY: e.g. 21 Science and engineering professionals and 31 their
//        associate professionals are one family; ISCO's first digit is skill level, not field),
//      - the evidence comes from different O*NET occupations (task-mass overlap of O*NET codes <= maxCodeOverlap),
//      - both are practical skills (ESCO type "skill"), and bge-m3 skill-to-skill cosine >= minCos (sanity floor),
//      - they share at least one specific activity (DWA or IWA), not only a broad GWA, so the evidence is concrete.
// 3. EVIDENCE, from data only: the shared activities (most specific first), the task statements behind them on each
//    side, example occupations.
// 4. Status: discovered bridges are "proposed" until a person approves them; hand-made routes are "approved" (team).
// Built by scripts/discover-bridges.ts into db/seed/esco_bridges.json.gz. O*NET 30.2 (USDOL/ETA, CC BY 4.0), ESCO v1.2.1
// (European Commission, CC BY 4.0); see the file's _meta for full attribution.
import { readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { projectRoot } from "../lib/db.ts";

export const BRIDGES_FILE = path.join(projectRoot, "db", "seed", "esco_bridges.json.gz");

export const BRIDGE_PARAMS = {
  optionalWeight: 0.5,
  taskFloor: 0.55,      // skill-task cosine below this = the task is not about the skill (about the median for own-job tasks)
  taskCeil: 0.75,       // ... at or above this = fully about it
  topTasks: 12,         // tasks that make up a skill's work profile
  topDwas: 30,          // DWAs kept per profile (all IWAs and GWAs are kept)
  levelWeights: { dwa: 0.5, iwa: 0.3, gwa: 0.2 }, // share of the profile cosine from each level of the hierarchy
  minMass: 3,           // relevance mass (sum over the profile's tasks) for full confidence; thinner profiles are shrunk
  minScore: 0.3,        // score = work-profile cosine x sqrt(confidence of both profiles), needed to propose a bridge
  minCos: 0.5,          // bge-m3 skill-to-skill cosine floor (median random ESCO pair is about 0.52)
  maxContext: 0.1,      // second-order co-occurrence cosine above this = same field
  maxCodeOverlap: 0.2,  // share of task mass from O*NET occupations both sides use
  perSkill: 5,          // bridges kept per source skill
  maxInDegree: 30,      // a target is proposed to at most this many sources (the strongest), so hubs don't crowd lists
};
export type BridgeParams = typeof BRIDGE_PARAMS;

export interface BridgeInput {
  skills: Record<string, { title: string; type?: string }>;
  occupations: Record<string, { title: string; isco?: string; essential: string[]; optional: string[] }>;
  /** O*NET occupation code crosswalked to an ESCO occupation, if any. */
  onetOf: (occId: string) => string | undefined;
  /** O*NET occupation code -> its task keys. */
  onetTasks: Record<string, string[]>;
  tasks: Record<string, { text: string; dwas: string[] }>;
  dwaTitle: Record<string, string>;
  /** IWA / GWA titles by O*NET id (optional; used for evidence text). */
  iwaTitle?: Record<string, string>;
  gwaTitle?: Record<string, string>;
  /** bge-m3 cosine of a skill and a task statement (null = no vector). */
  skillTaskCos: (skillId: string, taskKey: string) => number | null;
  /** bge-m3 cosine of two skills (null = no vector). */
  skillCos: (a: string, b: string) => number | null;
}

export interface ProfileTask { task: string; code: string; weight: number; rel: number; occs: string[] }
/** keys: "D|<dwa id>", "I|<iwa id>", "G|<gwa id>" -> weight; the whole map has unit L2 norm. */
export interface WorkProfile { keys: Map<string, number>; tasks: ProfileTask[]; codeMass: Map<string, number>; mass: number }

/** The three activity keys a DWA counts towards. O*NET ids nest: DWA 4.A.2.a.3.I03.D05 -> IWA 4.A.2.a.3.I03 -> GWA 4.A.2.a.3. */
export function activityKeys(dwa: string): [string, string, string] {
  const parts = dwa.split(".");
  const iwa = parts.length > 6 ? parts.slice(0, 6).join(".") : dwa, gwa = parts.length > 5 ? parts.slice(0, 5).join(".") : iwa;
  return [`D|${dwa}`, `I|${iwa}`, `G|${gwa}`];
}

/** Human-readable title of an activity key. */
export function activityTitle(key: string, input: BridgeInput) {
  const id = key.slice(2);
  return key[0] === "D" ? input.dwaTitle[id] ?? id : key[0] === "I" ? input.iwaTitle?.[id] ?? id : input.gwaTitle?.[id] ?? id;
}

const ramp = (x: number, lo: number, hi: number) => Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
const isPractical = (s?: { type?: string }) => !!s && s.type !== "knowledge";

/** skill -> [occupation id, weight] (essential wins over optional). */
export function skillOccupations(input: BridgeInput, p: BridgeParams = BRIDGE_PARAMS) {
  const out = new Map<string, Map<string, number>>();
  for (const [oid, o] of Object.entries(input.occupations)) {
    for (const [list, w] of [[o.optional, p.optionalWeight], [o.essential, 1]] as const)
      for (const s of list) { if (!out.has(s)) out.set(s, new Map()); out.get(s)!.set(oid, w); }
  }
  return out;
}

/** idf of each activity key (all three levels) over O*NET occupations: log(N / occupations with a task linked to it). */
export function dwaIdf(input: BridgeInput) {
  const df = new Map<string, number>();
  const codes = Object.keys(input.onetTasks);
  for (const c of codes) {
    const seen = new Set<string>();
    for (const t of input.onetTasks[c]) for (const d of input.tasks[t]?.dwas || []) for (const k of activityKeys(d)) seen.add(k);
    for (const k of seen) df.set(k, (df.get(k) || 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [k, n] of df) idf.set(k, Math.log(codes.length / n));
  return idf;
}

/** The work profile of one skill (empty when none of its occupations has O*NET tasks about it). */
export function workProfile(skillId: string, occs: Map<string, number> | undefined, idf: Map<string, number>,
                            input: BridgeInput, p: BridgeParams = BRIDGE_PARAMS): WorkProfile {
  const empty: WorkProfile = { keys: new Map(), tasks: [], codeMass: new Map(), mass: 0 };
  if (!occs) return empty;
  // Weight of each O*NET occupation = sum of the ESCO occupations (needing this skill) that crosswalk to it.
  const codeW = new Map<string, { w: number; occs: string[] }>();
  for (const [oid, w] of occs) {
    const c = input.onetOf(oid);
    if (!c || !input.onetTasks[c]) continue;
    const e = codeW.get(c) || { w: 0, occs: [] };
    e.w += w; e.occs.push(oid); codeW.set(c, e);
  }
  if (!codeW.size) return empty;
  const maxW = Math.max(...[...codeW.values()].map(e => e.w));
  const cand: ProfileTask[] = [];
  for (const [c, { w, occs: os }] of codeW) {
    for (const t of input.onetTasks[c]) {
      const cos = input.skillTaskCos(skillId, t);
      if (cos === null) continue;
      const rel = ramp(cos, p.taskFloor, p.taskCeil);
      if (rel > 0) cand.push({ task: t, code: c, weight: rel * Math.sqrt(w / maxW), rel, occs: os });
    }
  }
  cand.sort((a, b) => b.weight - a.weight || (a.task < b.task ? -1 : 1));
  const tasks = cand.slice(0, p.topTasks);
  const level = { D: new Map<string, number>(), I: new Map<string, number>(), G: new Map<string, number>() };
  const codeMass = new Map<string, number>();
  for (const t of tasks) {
    codeMass.set(t.code, (codeMass.get(t.code) || 0) + t.weight);
    const ds = input.tasks[t.task].dwas;
    for (const d of ds) for (const k of activityKeys(d)) {
      const m = level[k[0] as "D" | "I" | "G"];
      m.set(k, (m.get(k) || 0) + t.weight / ds.length * (idf.get(k) ?? 0));
    }
  }
  const keys = new Map<string, number>();
  const lw = { D: p.levelWeights.dwa, I: p.levelWeights.iwa, G: p.levelWeights.gwa };
  const totalW = lw.D + lw.I + lw.G;
  for (const L of ["D", "I", "G"] as const) {
    let entries = [...level[L]].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    if (L === "D") entries = entries.slice(0, p.topDwas);
    const norm = Math.sqrt(entries.reduce((s, [, v]) => s + v * v, 0));
    if (!norm || !lw[L]) continue;
    for (const [k, v] of entries) keys.set(k, v / norm * Math.sqrt(lw[L] / totalW));
  }
  // A profile needs at least one specific (DWA-level) activity; then re-normalise, since a level can be empty.
  if (![...keys.keys()].some(k => k[0] === "D")) return empty;
  const n2 = Math.sqrt([...keys.values()].reduce((s, v) => s + v * v, 0));
  for (const [k, v] of keys) keys.set(k, v / n2);
  const total = [...codeMass.values()].reduce((a, b) => a + b, 0) || 1;
  for (const [c, m] of codeMass) codeMass.set(c, m / total);
  return { keys, tasks, codeMass, mass: tasks.reduce((s, t) => s + t.rel, 0) };
}

/** Cosine of two (L2-normalised) sparse profiles. */
export function sparseCos(a: Map<string, number>, b: Map<string, number>) {
  const [s, l] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [k, v] of s) { const w = l.get(k); if (w) dot += v * w; }
  return dot;
}

/** Share of task mass that comes from O*NET occupations both profiles use (max of the two directions). */
export function codeOverlap(a: WorkProfile, b: WorkProfile) {
  let ab = 0, ba = 0;
  for (const [c, m] of a.codeMass) if (b.codeMass.has(c)) { ab += m; ba += b.codeMass.get(c)!; }
  return Math.max(ab, ba);
}

/** Do two profiles share a specific activity (a DWA or IWA), not only a broad GWA? Bridges need concrete evidence. */
export function sharesSpecific(a: WorkProfile, b: WorkProfile) {
  for (const k of a.keys.keys()) if (k[0] !== "G" && b.keys.has(k)) return true;
  return false;
}

/** Second-order co-occurrence: each skill as a PPMI-weighted vector of the other skills it is listed with. */
export function contextVectors(skillOccs: Map<string, Map<string, number>>) {
  const occSkills = new Map<string, Map<string, number>>();
  for (const [s, os] of skillOccs) for (const [o, w] of os) { if (!occSkills.has(o)) occSkills.set(o, new Map()); occSkills.get(o)!.set(s, w); }
  const mass = new Map<string, number>();
  let total = 0;
  for (const [s, os] of skillOccs) { let m = 0; for (const w of os.values()) m += w; mass.set(s, m); total += m; }
  const out = new Map<string, Map<string, number>>();
  for (const [s, os] of skillOccs) {
    const co = new Map<string, number>();
    for (const [o, w] of os) for (const [c, wc] of occSkills.get(o)!) if (c !== s) co.set(c, (co.get(c) || 0) + w * wc);
    // PPMI over the occupation-weighted co-occurrence counts (marginals approximated by skill mass).
    const v = new Map<string, number>();
    let n2 = 0;
    for (const [c, x] of co) {
      const pmi = Math.log((x * total) / (mass.get(s)! * mass.get(c)!));
      if (pmi > 0) { v.set(c, pmi); n2 += pmi * pmi; }
    }
    const n = Math.sqrt(n2) || 1;
    for (const [c, x] of v) v.set(c, x / n);
    out.set(s, v);
  }
  return out;
}

export type Gate = "ok" | "knowledge" | "cooccur" | "context" | "sameField" | "sameOnet" | "embedding" | "noProfile" | "onlyGeneral";

export interface PairCheck { work: number; score: number; cos: number | null; context: number; codeOverlap: number; sharedOccs: number; gate: Gate }

/** Confidence in a profile: 1 once its tasks' relevance adds up to minMass, less for skills only thinly described. */
export const confidence = (prof: WorkProfile | undefined, p: BridgeParams) => (prof ? Math.min(1, prof.mass / p.minMass) : 0);

/** Every number behind one candidate pair and the first gate it fails ("ok" = a bridge if score >= minScore). */
export function checkPair(a: string, b: string, ctx: BridgeContext, p: BridgeParams = ctx.params): PairCheck {
  const { input, profiles, skillOccs, contexts } = ctx;
  const pa = profiles.get(a), pb = profiles.get(b);
  const work = pa && pb ? sparseCos(pa.keys, pb.keys) : 0;
  const score = work * Math.sqrt(confidence(pa, p) * confidence(pb, p));
  const cos = input.skillCos(a, b);
  const oa = skillOccs.get(a), ob = skillOccs.get(b);
  let sharedOccs = 0;
  if (oa && ob) for (const o of oa.keys()) if (ob.has(o)) sharedOccs++;
  const context = contexts.get(a) && contexts.get(b) ? sparseCos(contexts.get(a)!, contexts.get(b)!) : 0;
  const ov = pa && pb ? codeOverlap(pa, pb) : 0;
  let gate: Gate = "ok";
  if (!isPractical(input.skills[a]) || !isPractical(input.skills[b])) gate = "knowledge";
  else if (!pa?.keys.size || !pb?.keys.size) gate = "noProfile";
  else if (sharedOccs > 0) gate = "cooccur";
  else if (context > p.maxContext) gate = "context";
  else if (fieldFamily(mainField(a, ctx)) === fieldFamily(mainField(b, ctx))) gate = "sameField";
  else if (ov > p.maxCodeOverlap) gate = "sameOnet";
  else if (cos === null || cos < p.minCos) gate = "embedding";
  else if (!sharesSpecific(pa!, pb!)) gate = "onlyGeneral";
  return { work, score, cos, context, codeOverlap: ov, sharedOccs, gate };
}

export interface BridgeContext {
  input: BridgeInput;
  params: BridgeParams;
  skillOccs: Map<string, Map<string, number>>;
  profiles: Map<string, WorkProfile>;
  contexts: Map<string, Map<string, number>>;
  idf: Map<string, number>;
  fields: Map<string, string | null>; // cache for mainField
}

export function buildContext(input: BridgeInput, opts: Partial<BridgeParams> = {}, only?: Iterable<string>): BridgeContext {
  const p = { ...BRIDGE_PARAMS, ...opts };
  const skillOccs = skillOccupations(input, p);
  const idf = dwaIdf(input);
  const profiles = new Map<string, WorkProfile>();
  for (const s of only ?? Object.keys(input.skills)) {
    if (!isPractical(input.skills[s])) continue;
    const prof = workProfile(s, skillOccs.get(s), idf, input, p);
    if (prof.keys.size) profiles.set(s, prof);
  }
  return { input, params: p, skillOccs, profiles, contexts: contextVectors(skillOccs), idf, fields: new Map() };
}

export interface Candidate { from: string; to: string; score: number; work: number; cos: number; context: number }

/** Top bridges per source skill. Inverted index over activity keys so only pairs sharing an activity are scored.
 *  Each source collects up to 3 x perSkill gated candidates; then, strongest first over all sources, a candidate is
 *  kept while its source has fewer than perSkill and its target fewer than maxInDegree. */
export function discover(ctx: BridgeContext, sources?: Iterable<string>): Map<string, Candidate[]> {
  const p = ctx.params;
  const postings = new Map<string, [string, number][]>();
  for (const [s, prof] of ctx.profiles) for (const [d, w] of prof.keys) { if (!postings.has(d)) postings.set(d, []); postings.get(d)!.push([s, w]); }
  const out = new Map<string, Candidate[]>();
  for (const a of sources ?? ctx.profiles.keys()) {
    const pa = ctx.profiles.get(a);
    if (!pa) continue;
    const dot = new Map<string, number>();
    for (const [d, w] of pa.keys) for (const [b, wb] of postings.get(d)!) if (b !== a) dot.set(b, (dot.get(b) || 0) + w * wb);
    const ca = confidence(pa, p);
    const scored = [...dot].map(([b, w]) => [b, w * Math.sqrt(ca * confidence(ctx.profiles.get(b), p))] as const);
    const list: Candidate[] = [];
    for (const [b, score] of scored.filter(([, v]) => v >= p.minScore).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))) {
      const c = checkPair(a, b, ctx, p);
      if (c.gate !== "ok") continue;
      list.push({ from: a, to: b, score, work: c.work, cos: c.cos!, context: c.context });
      if (list.length >= p.perSkill * 3) break;
    }
    if (list.length) out.set(a, list);
  }
  const all = [...out.values()].flat().sort((x, y) => y.score - x.score || (x.from + x.to < y.from + y.to ? -1 : 1));
  const kept = new Map<string, Candidate[]>(), inDeg = new Map<string, number>();
  for (const c of all) {
    const list = kept.get(c.from) || [];
    if (list.length >= p.perSkill || (inDeg.get(c.to) || 0) >= p.maxInDegree) continue;
    list.push(c); kept.set(c.from, list); inDeg.set(c.to, (inDeg.get(c.to) || 0) + 1);
  }
  return kept;
}

export interface Evidence {
  sharedActivities: string[];
  tasksFrom: string[];
  tasksTo: string[];
  occFrom: string[];
  occTo: string[];
}

/** Why two skills are a bridge, from data only: the shared activity keys that contribute most, specific ones first (an
 *  IWA or GWA is skipped when a shared activity under it is already shown), and the tasks and occupations behind them. */
export function evidence(a: string, b: string, ctx: BridgeContext, nAct = 3, nTask = 2): { keys: string[]; tasksFrom: string[]; tasksTo: string[]; occFrom: string[]; occTo: string[] } {
  const pa = ctx.profiles.get(a)!, pb = ctx.profiles.get(b)!;
  const ranked = [...pa.keys].filter(([k]) => pb.keys.has(k)).map(([k, w]) => [k, w * pb.keys.get(k)!] as const)
    // Specific activities (DWA, IWA) first; a broad GWA ("Thinking Creatively") only fills remaining slots.
    .sort((x, y) => Number(x[0][0] === "G") - Number(y[0][0] === "G") || y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).map(([k]) => k);
  // Is broader key k already explained by a shown, more specific key?
  const parentKeys = (shown: string) => (shown[0] === "D" ? activityKeys(shown.slice(2)).slice(1) : shown[0] === "I" ? [`G|${shown.slice(2).split(".").slice(0, 5).join(".")}`] : []);
  const shared: string[] = [];
  for (const k of ranked) { if (shared.length >= nAct) break; if (!shared.some(s => parentKeys(s).includes(k))) shared.push(k); }
  const linked = (task: string, k: string) => ctx.input.tasks[task].dwas.some(d => (activityKeys(d) as string[]).includes(k));
  const pick = (prof: WorkProfile, skill: string) => {
    const tasks: string[] = [], occs: string[] = [];
    for (const k of shared) {
      const t = prof.tasks.find(x => linked(x.task, k) && !tasks.includes(x.task)) || prof.tasks.find(x => linked(x.task, k));
      if (!t) continue;
      if (tasks.length < nTask && !tasks.includes(t.task)) tasks.push(t.task);
      // Example occupations: those behind the evidence task, the ones that list the skill as essential first.
      const os = [...t.occs].sort((x, y) => (ctx.skillOccs.get(skill)!.get(y)! - ctx.skillOccs.get(skill)!.get(x)!) || (x < y ? -1 : 1));
      for (const o of os) if (!occs.includes(o) && occs.length < 3) occs.push(o);
    }
    return { tasks, occs };
  };
  const f = pick(pa, a), t = pick(pb, b);
  return { keys: shared, tasksFrom: f.tasks, tasksTo: t.tasks, occFrom: f.occs, occTo: t.occs };
}

// ---- ISCO-08 sub-major groups: the "field" label shown on each side of a bridge ------------------------------
export const ISCO_SUBMAJOR: Record<string, string> = {
  "01": "Armed forces officers", "02": "Armed forces NCOs", "03": "Armed forces, other ranks",
  "11": "Chief executives and legislators", "12": "Administrative and commercial managers", "13": "Production and specialised services managers", "14": "Hospitality, retail and other services managers",
  "21": "Science and engineering professionals", "22": "Health professionals", "23": "Teaching professionals", "24": "Business and administration professionals", "25": "ICT professionals", "26": "Legal, social and cultural professionals",
  "31": "Science and engineering associate professionals", "32": "Health associate professionals", "33": "Business and administration associate professionals", "34": "Legal, social and cultural associate professionals", "35": "ICT technicians",
  "41": "General and keyboard clerks", "42": "Customer services clerks", "43": "Numerical and material recording clerks", "44": "Other clerical support workers",
  "51": "Personal service workers", "52": "Sales workers", "53": "Personal care workers", "54": "Protective services workers",
  "61": "Skilled agricultural workers", "62": "Skilled forestry, fishery and hunting workers", "63": "Subsistence farmers and fishers",
  "71": "Building trades", "72": "Metal and machinery trades", "73": "Handicraft and printing workers", "74": "Electrical and electronics trades", "75": "Food, wood, garment and other craft trades",
  "81": "Plant and machine operators", "82": "Assemblers", "83": "Drivers and mobile plant operators",
  "91": "Cleaners and helpers", "92": "Agricultural, forestry and fishery labourers", "93": "Labourers in mining, construction, manufacturing and transport", "94": "Food preparation assistants", "95": "Street sales and service workers", "96": "Refuse and other elementary workers",
};

/** ISCO-08 sub-major group -> level-free field family. ISCO's first digit is a skill level, so 21 Science and engineering
 *  professionals and 31 their associate professionals are one field, as are 22/32/53 (health and care) and 24/33/41/43/44
 *  (business and administration). A bridge must join different families. */
export const FIELD_FAMILY: Record<string, string> = {
  "11": "management", "12": "management", "13": "management",
  "24": "business & administration", "33": "business & administration", "41": "business & administration", "43": "business & administration", "44": "business & administration",
  "21": "science & engineering", "31": "science & engineering",
  "22": "health & care", "32": "health & care", "53": "health & care",
  "25": "ICT", "35": "ICT",
  "23": "education, social & culture", "26": "education, social & culture", "34": "education, social & culture",
  "14": "services & sales", "42": "services & sales", "51": "services & sales", "52": "services & sales", "95": "services & sales",
  "54": "protective services", "01": "protective services", "02": "protective services", "03": "protective services",
  "61": "agriculture & fishery", "62": "agriculture & fishery", "63": "agriculture & fishery", "92": "agriculture & fishery",
  "71": "trades & crafts", "72": "trades & crafts", "73": "trades & crafts", "74": "trades & crafts", "75": "trades & crafts",
  "81": "operators & drivers", "82": "operators & drivers", "83": "operators & drivers",
  "91": "elementary work", "93": "elementary work", "94": "elementary work", "96": "elementary work",
};
export const fieldFamily = (isco2: string | null) => (isco2 ? FIELD_FAMILY[isco2] ?? isco2 : null);

/** The ISCO sub-major group where a skill is most needed (weighted by essential/optional). */
export function mainField(skill: string, ctx: BridgeContext): string | null {
  if (ctx.fields.has(skill)) return ctx.fields.get(skill)!;
  const m = new Map<string, number>();
  for (const [o, w] of ctx.skillOccs.get(skill) || []) {
    const g = (ctx.input.occupations[o]?.isco || "").slice(0, 2);
    if (g) m.set(g, (m.get(g) || 0) + w);
  }
  const top = [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  ctx.fields.set(skill, top ? top[0] : null);
  return top ? top[0] : null;
}

// ---- The built artefact ---------------------------------------------------------------------------------------
// File format (compact, string tables): { _meta, skills: [id], titles: [title], fields: [isco2 per skill], activities: [title],
//   tasks: [text], occs: [[escoOccId, title]],
//   bridges: [[from, to, score x 1000, status (0 proposed, 1 approved), source (0 discovered, 1 team), [activity], [taskFrom], [taskTo], [occFrom], [occTo], why?]] }
// Indexes point into the tables. Team bridges carry the team's own sentence ("why") and may have empty evidence.

export interface Bridge {
  /** Position in the built file: the id the review queue uses (stable until the file is rebuilt). */
  id: number;
  from: string; to: string; fromTitle: string; toTitle: string;
  score: number; fields: [string | null, string | null]; families: [string | null, string | null];
  evidence: Evidence; status: "proposed" | "approved"; source: "discovered" | "team"; why?: string;
}

interface Loaded { meta: any; bridges: Bridge[]; byFrom: Map<string, Bridge[]> }
let cache: Loaded | null | undefined;

export function decodeBridges(file: any): Loaded {
  const field = (i: number) => (file.fields[i] ? `${file.fields[i]} ${ISCO_SUBMAJOR[file.fields[i]] ?? ""}`.trim() : null);
  const bridges: Bridge[] = file.bridges.map((r: any[], id: number) => {
    const [f, t, score, status, source, dw, tf, tt, of, ot, why] = r;
    const b: Bridge = {
      id, from: file.skills[f], to: file.skills[t], fromTitle: file.titles[f], toTitle: file.titles[t],
      score: score / 1000, fields: [field(f), field(t)], families: [fieldFamily(file.fields[f]), fieldFamily(file.fields[t])],
      evidence: {
        sharedActivities: dw.map((i: number) => file.activities[i]),
        tasksFrom: tf.map((i: number) => file.tasks[i]), tasksTo: tt.map((i: number) => file.tasks[i]),
        occFrom: of.map((i: number) => file.occs[i][1]), occTo: ot.map((i: number) => file.occs[i][1]),
      },
      status: status ? "approved" : "proposed", source: source ? "team" : "discovered",
    };
    if (why) b.why = why;
    return b;
  });
  const byFrom = new Map<string, Bridge[]>();
  for (const b of bridges) { if (!byFrom.has(b.from)) byFrom.set(b.from, []); byFrom.get(b.from)!.push(b); }
  for (const list of byFrom.values()) list.sort((x, y) => Number(y.status === "approved") - Number(x.status === "approved") || y.score - x.score);
  return { meta: file._meta ?? null, bridges, byFrom };
}

export function loadBridges(): Loaded | null {
  if (cache !== undefined) return cache;
  if (!existsSync(BRIDGES_FILE)) return (cache = null);
  return (cache = decodeBridges(JSON.parse(gunzipSync(readFileSync(BRIDGES_FILE)).toString("utf8"))));
}

/** Bridges out of one ESCO skill: approved first, then by score ([] if none or not built). */
export function bridgesFrom(skillId: string, limit?: number): Bridge[] {
  const list = loadBridges()?.byFrom.get(skillId) || [];
  return limit === undefined ? list : list.slice(0, limit);
}

// ---- People decide: a proposed bridge stays out of routes and the match until a person approves it -------------
// Decisions live in the database (bridge_decisions, server/services/bridge-review.ts); this in-memory copy is what the
// synchronous match and route code read. Team bridges are approved in the file; a discovered bridge is approved only
// by a person's decision. A "rejected" decision takes a bridge out.
export interface BridgeDecision { status: "approved" | "rejected"; actor: string; decidedAt: string; note: string | null }
const decisionKey = (from: string, to: string) => `${from}>${to}`;
let decisions = new Map<string, BridgeDecision>();
let decisionsVersion = 0;
let approvedCache: { loaded: Loaded; version: number; list: Bridge[] } | null = null;

/** Replace the in-memory decisions (read from the database). Every route and match after this uses them. */
export function setBridgeDecisions(rows: { from: string; to: string; decision: BridgeDecision }[]) {
  decisions = new Map(rows.map(r => [decisionKey(r.from, r.to), r.decision]));
  decisionsVersion++;
}
export function bridgeDecision(b: Pick<Bridge, "from" | "to">): BridgeDecision | null {
  return decisions.get(decisionKey(b.from, b.to)) ?? null;
}
/** A bridge's status after people's decisions: team bridges start approved, discovered ones proposed. */
export function effectiveStatus(b: Bridge): "approved" | "proposed" | "rejected" {
  return bridgeDecision(b)?.status ?? b.status;
}

/** Every bridge a person has approved (the team's hand-made routes, plus any proposed bridge a person approved). */
export function allApproved(): Bridge[] {
  const loaded = loadBridges();
  if (!loaded) return [];
  if (approvedCache?.loaded === loaded && approvedCache.version === decisionsVersion) return approvedCache.list;
  const list = loaded.bridges.filter(b => effectiveStatus(b) === "approved");
  approvedCache = { loaded, version: decisionsVersion, list };
  return list;
}

/** For tests: use an in-memory artefact instead of the file (null = forget it and reload from disk). */
export function setBridges(l: Loaded | null) { cache = l ?? undefined; approvedCache = null; }
