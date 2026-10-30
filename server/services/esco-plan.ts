// A plan for ANY ESCO occupation (GET /api/plan?job=esco:<uuid>), in the same shape as a catalogue plan.
//
// The road network is HYBRID:
//   - within a field: the data skill network (server/services/skill-network.ts, ESCO co-occurrence x bge-m3);
//   - across fields: the hand-made catalogue edges as "bridges" (catalogue skill ids mapped to ESCO ids through
//     db/seed/esco_map.json; catalogue skills with no ESCO equivalent stay as their own nodes), plus a link from each
//     catalogue skill to the ESCO skills whose nearest catalogue skill it is (bge-m3 cosine >= ANCHOR_COSINE).
// Knowledge items ("emission standards") are never route stops: they are attached to the nearest key skill and counted
// in the gap list and the time.
//
// Route = a short chain of KEY stepping stones (3-5), picked from the job's missing practical skills by
//   how core it is to the job (shared by the job's closest sibling jobs), reachability (how close it is to what you know),
//   distinctiveness (idf: few jobs need it) and future relevance (1 - AI exposure); attitudes and transversal items are
//   never picked (they stay in the gap list as "also needed"). Then ordered by distance from what you know ("start from what you know").
// Distances are Dijkstra over the hybrid network with the engine's cost: hopCost + (1 - relatedness) + exposure term.
// Time comes from ALL missing items (course hours where a catalogue course exists, else an estimate flagged estimated).
import { PARAMS, HAVE_LEVEL, displayWeeks, clamp, normMode } from "../../shared/engine.js";
import type { FullGraph } from "../kb.ts";
import type { Profile } from "../repo.ts";
import { loadEsco, occupationDetail } from "./esco.ts";
import { loadSkillNetwork } from "./skill-network.ts";
import { loadEscoVectors } from "./esco-match.ts";
import { signalFor, type Engine, type SignalInfo } from "./planning.ts";
import { allApproved } from "./bridges.ts";
import { nextJobs } from "./esco-network.ts";
import { isAttitude } from "./esco-attitude.ts";
import { loadAiSkills, aiSkillsFor, aiSkill, aiSkillJson, isAiNode } from "./ai-skills.ts";

export const ESCO_PLAN = {
  anchorCosine: 0.75,       // a catalogue skill links to ESCO skills whose nearest catalogue skill it is at >= this cosine
  keyMin: 3, keyMax: 5,     // key stepping stones on the route
  // Key-skill score weights, in plain words: [core, reachability, distinctiveness, future relevance]
  //   core            how much this skill IS the job: the share of the job's closest sibling jobs that also need it
  //                   (every bus-like job needs "manoeuvre bus"; only one needs a rare oddity). The biggest weight, so the
  //                   heart of the job leads the route.
  //   reachability    "start from what you know": how close the skill is to skills you already have.
  //   distinctiveness (idf) few jobs in ESCO need it. A tie-breaker now: on its own it favoured rare, peripheral skills.
  //   future          1 - AI exposure; the safest mode weighs this much more.
  // Attitudes and transversal items (esco-attitude.ts) never compete: they are not key steps at all.
  weights: { closest: [0.4, 0.3, 0.15, 0.15], safest: [0.3, 0.2, 0.1, 0.4] } as Record<string, number[]>,
  coreSiblings: 8,          // how many of the job's closest sibling jobs (esco-network.ts) the core term looks at
  aiCore: 0.5,              // an AI-era skill has no sibling jobs: it counts as moderately core (like aiIdf)
  // Time per missing ESCO item, when no course gives real hours (all flagged estimated). ESCO items are finer-grained
  // than catalogue skills, so they get smaller estimates:
  //   hours = (min + span x (1 - relatedness to your nearest skill)) x (commonFloor + (1 - commonFloor) x idf)
  //           x (1 - groupDiscount x relatedness to its key skill, for non-key items)
  // Common skills that many jobs need (low idf) are quicker to pick up; items close to a key skill you are already
  // learning share most of the work.
  skillHoursMin: 6, skillHoursSpan: 24, knowledgeHoursMin: 4, knowledgeHoursSpan: 12,
  commonFloor: 0.4, groupDiscount: 0.5,
  relatedStart: 0.7,        // relatedness of a skill ESCO already counts as "related" to one of yours
  // AI-era skills (server/services/ai-skills.ts): not in ESCO, so no idf; they count as moderately distinctive, have no
  // exposure (future relevance 1: favoured, never penalised), and at most aiKeyMax of them are key stepping stones.
  aiIdf: 0.5, aiKeyMax: 1,
  aiCatalogueRel: 0.9,      // relatedness of an AI skill to the catalogue skill that is the same thing (prompt, aisup)
  // Safer route: offered only when a skill it avoids is one AI does a lot of: our model's exposure >= this for ESCO
  // skills (catalogue skills use the knowledge base's PARAMS.saferMinExposure), or an approved signal raised it; and
  // that skill is at least PARAMS.saferMinGain more exposed than any skill on the safer route.
  saferMinModelExposure: 0.7,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The ESCO occupation id behind a plan job id ("esco:<uuid>" or a bare ESCO uuid), or null. */
export function escoJobId(job: string): string | null {
  const id = job.startsWith("esco:") ? job.slice(5) : job;
  if (!UUID.test(id)) return null;
  return loadEsco()?.occupations[id] ? id : null;
}

// ---- static indexes (built once per process) ----------------------------------------------------------------
interface Static {
  N: number; df: Map<string, number>;
  rev: Map<string, [string, number][]>;            // reverse skill-network links
  anchors: Map<string, [string, number][]>;        // catalogue skill id <-> ESCO skill, from nearest-catalogue scores
  catToEsco: Map<string, string>;
}
let stat: Static | null = null;
function statics(): Static | null {
  if (stat) return stat;
  const d = loadEsco();
  if (!d) return null;
  const df = new Map<string, number>();
  const occ = Object.values<any>(d.occupations);
  for (const o of occ) for (const s of new Set<string>([...o.essential, ...o.optional])) df.set(s, (df.get(s) || 0) + 1);
  const rev = new Map<string, [string, number][]>();
  for (const [a, list] of loadSkillNetwork()?.byId || []) for (const [b, r] of list) { if (!rev.has(b)) rev.set(b, []); rev.get(b)!.push([a, r]); }
  const catToEsco = new Map<string, string>();
  for (const [esco, cats] of d.catalogueByEsco) for (const c of cats) catToEsco.set(c, esco);
  const anchors = new Map<string, [string, number][]>();
  const add = (a: string, b: string, r: number) => { if (!anchors.has(a)) anchors.set(a, []); anchors.get(a)!.push([b, r]); };
  for (const [sid, sc] of Object.entries<any>(d.scores)) {
    if (!sc || sc[2] < ESCO_PLAN.anchorCosine || d.skills[sid]?.type === "knowledge") continue;
    const cat = String(sc[1]), node = catToEsco.get(cat) || cat;
    if (node === sid) continue;
    const r = clamp((sc[2] - 0.5) / 0.5, 0, 1);
    add(node, sid, r); add(sid, node, r);
  }
  return (stat = { N: occ.length, df, rev, anchors, catToEsco });
}

/** Embedding relatedness of two ESCO skills in [0,1] (cosine 0.5 -> 0, 1 -> 1), or 0 without vectors. */
let rowIx: Map<string, number> | null = null;
function embRel(a: string, b: string) {
  const v = loadEscoVectors();
  if (!v) return 0;
  rowIx ||= new Map(v.ids.map((id, i) => [id, i]));
  const i = rowIx.get(a), j = rowIx.get(b);
  if (i === undefined || j === undefined) return 0;
  let dot = 0;
  for (let x = i * v.dims, y = j * v.dims, end = x + v.dims; x < end; x++, y++) dot += v.q[x] * v.q[y];
  return clamp((dot * v.scales[i] * v.scales[j] - 0.5) / 0.5, 0, 1);
}

// ---- a tiny binary heap for Dijkstra -----------------------------------------------------------------------
class Heap {
  private a: [number, string][] = [];
  get size() { return this.a.length; }
  push(x: [number, string]) {
    const a = this.a; a.push(x);
    for (let i = a.length - 1; i > 0;) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop(): [number, string] {
    const a = this.a, top = a[0], last = a.pop()!;
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

export interface EscoPlanOptions {
  mode?: string; year: number; scenario: "slow" | "moderate" | "fast"; now: Date;
  escoSkills: Set<string>;
  signals?: Record<number, SignalInfo>;
}

/** "Core to this job": the share of its closest sibling jobs that also list a skill as essential (0 to 1). */
function coreOf(occId: string) {
  const d = loadEsco()!;
  const sibs = (nextJobs(occId, ESCO_PLAN.coreSiblings)?.jobs || []).map(j => new Set<string>(d.occupations[j.id].essential));
  return (s: string) => (isAiNode(s) ? ESCO_PLAN.aiCore : sibs.length ? sibs.filter(e => e.has(s)).length / sibs.length : 0);
}

/** Everything one mode needs, for a profile + job. */
function solve(graph: FullGraph, E: Engine, profile: Profile, occId: string, mode: "closest" | "safest", escoSkills: Set<string>) {
  const d = loadEsco()!, S = statics()!;
  const nodeOf = (cat: string) => S.catToEsco.get(cat) || cat;
  const catsOf = (node: string): string[] => (E.isSkill(node) ? [node] : (d.catalogueByEsco.get(node) || []).filter(c => E.isSkill(c)));
  // AI-era skills this job asks for (emerging requirements).
  const ai = aiSkillsFor(occId), aiJob = new Set(ai.map(s => s.id));
  const aiLinks = loadAiSkills()?.links;
  // AI-era skills have no exposure number: 0 here, so routes and key picks never penalise them.
  const exposure = (node: string) => { if (isAiNode(node)) return 0; const c = catsOf(node)[0]; return c ? E.exposure(c) : d.scores[node]?.[0] ?? 0.5; };
  const isTaken = (node: string) => catsOf(node).some(c => E.taken(c));
  const traversable = (node: string) => (isAiNode(node) ? aiJob.has(node) : d.skills[node] ? d.skills[node].type !== "knowledge" : E.isSkill(node));
  const name = (node: string) => d.skills[node]?.title ?? (isAiNode(node) ? aiSkill(node)?.label : null) ?? graph.nodes[node]?.name ?? node;
  const penalty = (node: string) => {
    const e = exposure(node);
    return mode === "safest" ? PARAMS.safestPenalty * Math.max(0, e - PARAMS.safestFrom) ** 2 : PARAMS.closestPenalty * Math.max(0, e - 0.5) ** 2;
  };

  // What you have: catalogue skills you started (mapped to ESCO where possible) + ESCO skills you confirmed.
  const owned = new Set<string>();
  for (const c of E.ownedSkills()) if (!E.taken(c)) owned.add(nodeOf(c));
  for (const s of escoSkills) if (traversable(s) && !isTaken(s)) owned.add(s);
  // An AI-era skill is yours when the catalogue skill that is the same thing is (prompt, aisup at HAVE_LEVEL).
  for (const s of ai) if (s.catalogue && E.lvl(s.catalogue) >= HAVE_LEVEL && !E.taken(s.catalogue)) owned.add(s.id);

  // Bridges: the hand-made skill -> skill edges, on ESCO ids where mapped.
  const bridges = new Map<string, { to: string; rel: number; why: string }[]>();
  for (const e of graph.edges) {
    if (!E.isSkill(e.from) || !E.isSkill(e.to)) continue;
    const a = nodeOf(e.from), b = nodeOf(e.to);
    if (!bridges.has(a)) bridges.set(a, []);
    bridges.get(a)!.push({ to: b, rel: PARAMS.weeksScale / (PARAMS.weeksScale + Math.max(0, e.weeks || 0)), why: e.why });
  }
  // ... plus the data's cross-field bridges that a PERSON approved (server/services/bridge-review.ts). Proposed bridges
  // are never used. The team's own bridges in that file are the hand-made edges above, already here.
  for (const b of allApproved()) {
    if (b.source === "team") continue;
    if (!bridges.has(b.from)) bridges.set(b.from, []);
    const act = b.evidence.sharedActivities[0];
    bridges.get(b.from)!.push({ to: b.to, rel: b.score, why: act ? `both involve "${act.replace(/\.$/, "")}" (reviewed bridge)` : "reviewed bridge" });
  }
  // AI-era skills: to the catalogue skill that is the same thing (their links to ESCO skills are in out()).
  for (const s of ai) if (s.catalogue) {
    for (const [x, y] of [[s.catalogue, s.id], [s.id, s.catalogue]]) {
      if (!bridges.has(x)) bridges.set(x, []);
      bridges.get(x)!.push({ to: y, rel: ESCO_PLAN.aiCatalogueRel, why: "the same skill" });
    }
  }
  const net = loadSkillNetwork()?.byId;
  function* out(u: string): Generator<[string, number, string | null]> {
    for (const [v, r] of net?.get(u) || []) yield [v, r, null];
    for (const [v, r] of S.rev.get(u) || []) yield [v, r, null];
    for (const [v, r] of S.anchors.get(u) || []) yield [v, r, null];
    for (const [v, r] of aiLinks?.get(u) || []) yield [v, r, null];
    for (const b of bridges.get(u) || []) yield [b.to, b.rel, b.why];
  }

  // Multi-source Dijkstra from your skills.
  const dist = new Map<string, number>(), prev = new Map<string, { from: string; rel: number; bridge: string | null }>(), prod = new Map<string, number>();
  const src = new Map<string, string>(); // which of your skills each node is reached from
  const heap = new Heap();
  for (const s of owned) { const c = PARAMS.hopCost + penalty(s); dist.set(s, c); prod.set(s, 1); src.set(s, s); heap.push([c, s]); }
  const done = new Set<string>();
  while (heap.size) {
    const [du, u] = heap.pop();
    if (done.has(u) || du > dist.get(u)!) continue;
    done.add(u);
    for (const [v, rel, bridge] of out(u)) {
      if (done.has(v) || !traversable(v) || isTaken(v)) continue;
      const nd = du + PARAMS.hopCost + (1 - rel) + penalty(v);
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd); prev.set(v, { from: u, rel, bridge }); prod.set(v, prod.get(u)! * rel); src.set(v, src.get(u)!); heap.push([nd, v]);
      }
    }
  }

  // The job's gaps (ESCO's own coverage rule, as in "Check any job").
  const level = Object.fromEntries(E.ownedSkills().map(c => [c, E.lvl(c)]));
  const det = occupationDetail(occId, level, escoSkills)!;
  const gaps = det.essential.filter(s => s.basis !== "have");
  const practical = gaps.filter(s => s.type !== "knowledge"), knowledge = gaps.filter(s => s.type === "knowledge");
  // AI-era skills you don't have yet: emerging requirements, in the gap list and the time, not in the ESCO match.
  const aiGaps = ai.filter(s => !owned.has(s.id)).map(s => ({ id: s.id, title: s.label, type: "skill", basis: "emerging" as const, via: null }));

  const idf = (s: string) => (isAiNode(s) ? ESCO_PLAN.aiIdf : Math.log(S.N / (S.df.get(s) || 1)) / Math.log(S.N));
  const reach = (s: string) => (dist.has(s) ? 1 / (1 + dist.get(s)!) : 0);
  const w = ESCO_PLAN.weights[mode], core = coreOf(occId);
  const score = (s: string) => w[0] * core(s) + w[1] * reach(s) + w[2] * idf(s) + w[3] * (1 - exposure(s));
  const k = practical.length <= ESCO_PLAN.keyMin ? practical.length : clamp(Math.round(practical.length / 4), ESCO_PLAN.keyMin, ESCO_PLAN.keyMax);
  const picked: string[] = [];
  // Attitudes ("tolerate sitting for long periods") count in the gaps and the time, but are never numbered key steps.
  const candidates = [...practical.filter(x => !isAttitude(x.id)), ...aiGaps];
  for (const s of candidates.map(x => x.id).sort((a, b) => score(b) - score(a) || (a < b ? -1 : 1))) {
    if (picked.length >= k) break;
    if (isAiNode(s) && picked.filter(isAiNode).length >= ESCO_PLAN.aiKeyMax) continue;
    picked.push(s);
  }
  const keys = picked.sort((a, b) => (dist.get(a) ?? Infinity) - (dist.get(b) ?? Infinity) || (a < b ? -1 : 1));

  return { d, det, practical, knowledge, aiGaps, ai, keys, dist, prev, prod, src, owned, exposure, name, catsOf, nodeOf, aiLinks };
}

/** The full plan for an ESCO occupation. */
export function buildEscoPlan(graph: FullGraph, E: Engine, profile: Profile, occId: string, opts: EscoPlanOptions) {
  const mode = normMode(opts.mode) as "closest" | "safest";
  const hours = profile.hours || PARAMS.referenceHours;
  const job = `esco:${occId}`;
  const sol = solve(graph, E, profile, occId, mode, opts.escoSkills);
  const { d, det, keys, name, exposure } = sol;
  const pickCourse = (cat: string) => { const l = graph.courses[cat] || []; return l.find(c => c.source && c.source !== "sample") || l[0] || null; };
  // a real course that is long enough to learn the skill gives the hours (same rule as the engine's courseHours)
  const courseFor = (sid: string) => {
    const aiCat = isAiNode(sid) ? aiSkill(sid)?.catalogue : null;
    for (const c of sol.catsOf(sid).concat(d.catalogueByEsco.get(sid) || [], aiCat ? [aiCat] : [])) {
      const co = (graph.courses[c] || []).find(x => x.source && x.source !== "sample" && Number(x.hours) >= PARAMS.minCourseHours) || pickCourse(c);
      if (co) return { cat: c, co };
    }
    return null;
  };
  const courseHours = (c: { co: any } | null) => (c && c.co.source && c.co.source !== "sample" && Number(c.co.hours) >= PARAMS.minCourseHours ? Number(c.co.hours) : null);
  const ownedEsco = [...sol.owned].filter(s => d.skills[s]);

  // Relatedness of a gap to the nearest skill you have.
  const relNear = (s: any) => {
    // ESCO's catalogue-based "related" kinds start at relatedStart; a skill-network link (via an ESCO skill) uses the path
    if (s.basis === "related" && !d.skills[s.via]) return ESCO_PLAN.relatedStart;
    const path = sol.prod.get(s.id) ?? 0;
    return Math.max(path, ...ownedEsco.map(o => embRel(o, s.id)), 0);
  };
  const net = loadSkillNetwork()?.byId;
  const netRel = (a: string, b: string) => net?.get(a)?.find(([x]) => x === b)?.[1] ?? net?.get(b)?.find(([x]) => x === a)?.[1]
    ?? sol.aiLinks?.get(a)?.find(([x]) => x === b)?.[1] ?? 0;
  const groupOf = (sid: string): [string | null, number] => {
    if (keys.includes(sid)) return [sid, 1];
    let best: string | null = null, bv = -1;
    for (const k of keys) { const r = Math.max(netRel(k, sid), embRel(k, sid)); if (r > bv) { bv = r; best = k; } }
    return [best, Math.max(0, bv)];
  };
  const S = statics()!, P = ESCO_PLAN;
  const idf = (s: string) => (isAiNode(s) ? P.aiIdf : Math.log(S.N / (S.df.get(s) || 1)) / Math.log(S.N));
  const r2 = (x: number) => Math.round(100 * x) / 100;
  const missing = [...sol.practical, ...sol.knowledge, ...sol.aiGaps].map(s => {
    const rel = relNear(s), c = courseFor(s.id);
    const knowledgeItem = s.type === "knowledge";
    const [g, gRel] = groupOf(s.id);
    const est = (knowledgeItem ? P.knowledgeHoursMin + P.knowledgeHoursSpan * (1 - rel) : P.skillHoursMin + P.skillHoursSpan * (1 - rel))
      * (P.commonFloor + (1 - P.commonFloor) * idf(s.id)) * (g && g !== s.id ? 1 - P.groupDiscount * gRel : 1);
    const ch = courseHours(c), h = ch ?? Math.max(1, Math.round(est));
    const aiInfo = isAiNode(s.id) ? aiSkill(s.id) : null;
    return {
      id: s.id, name: s.title, type: knowledgeItem ? "knowledge" : "skill", key: keys.includes(s.id),
      group: g, groupName: g ? name(g) : null, estimated: ch === null, hours: h,
      weeks: displayWeeks(h / PARAMS.referenceHours, hours), rel: r2(rel), exposure: aiInfo ? null : r2(exposure(s.id)), basis: s.basis,
      course: c ? { skillId: c.cat, title: c.co.title, provider: c.co.provider ?? null, url: c.co.url ?? null, hours: c.co.hours ?? null } : null,
      uri: aiInfo ? null : `http://data.europa.eu/esco/skill/${s.id}`,
      ...(aiInfo ? { aiEra: true, exposureNote: "AI-era skill: grows with AI", description: aiInfo.description, catalogue: aiInfo.catalogue, sources: aiInfo.sources } : {}),
    };
  }).sort((a, b) => Number(b.key) - Number(a.key) || (a.group || "").localeCompare(b.group || "") || Number(a.type === "knowledge") - Number(b.type === "knowledge") || a.name.localeCompare(b.name));
  const totalHours = missing.reduce((s, m) => s + m.hours, 0);
  const weeks = displayWeeks(totalHours / PARAMS.referenceHours, hours);

  const route = routeOf(sol, E, job, d.occupations[occId].title, missing, hours);
  let saferAlternative: any = null;
  if (mode === "closest") {
    const safe = solve(graph, E, profile, occId, "safest", opts.escoSkills);
    const sr = routeOf(safe, E, job, d.occupations[occId].title, missing, hours);
    // Only a real safety gain counts: a skill on the default road that AI does a lot of (high exposure, or an approved
    // signal raised it), clearly more exposed than anything on the safer road. Otherwise there is no safer route to offer.
    const isStep = (n: string) => n !== E.root && n !== job;
    const safeMax = Math.max(0, ...sr.nodes.filter(n => isStep(n) && !isAiNode(n)).map(n => safe.exposure(n)));
    const inSafe = new Set(sr.nodes);
    const avoids = sr.key === route.key ? [] : route.nodes.filter(n => isStep(n) && !isAiNode(n) && !inSafe.has(n)).map(n => {
      const cats = sol.catsOf(n), e = exposure(n);
      const signal = cats.map(c => signalFor(graph, c, opts.signals)).find(Boolean) || null;
      // Our model is coarse for single skills, so on model scores we never steer someone away from a skill they already have
      // (only an approved signal can do that), and the bar for unowned skills is high.
      const high = cats.length ? e >= PARAMS.saferMinExposure : e >= P.saferMinModelExposure && !sol.owned.has(n);
      return { id: n, name: name(n), owned: sol.owned.has(n), exposure: r2(e), aiSharePct: Math.round(100 * e),
        exposureSource: cats.length ? "knowledge-base" : "model", reason: signal ? "signal" : high ? "exposure" : null, signal, gain: e - safeMax };
    }).filter(a => a.reason && a.gain >= PARAMS.saferMinGain).map(({ gain: _gain, ...a }) => a);
    if (avoids.length) {
      saferAlternative = {
        mode: "safest", route: sr, keySkills: safe.keys,
        avoids, adds: sr.nodes.filter(n => n !== E.root && n !== job && !route.nodes.includes(n)).map(n => ({ id: n, name: name(n) })),
        weeks, addedWeeks: 0, // the gap list (and so the time) is the same; the safer route leads with different skills
      };
    }
  }
  const emerging = sol.ai.map(s => ({ ...aiSkillJson(s), have: sol.owned.has(s.id) }));
  const sources = [
    { kind: "esco", label: `ESCO: ${det.title}`, url: det.uri, date: null },
    ...sol.ai.flatMap(s => s.sources.map(x => ({ kind: "ai-skill", label: `AI-era skill "${s.label}": ${x.publisher}, ${x.title}`, url: x.url, date: x.date }))),
    { kind: "method", label: "Key route: ESCO skill network (job co-occurrence x bge-m3 meaning) plus hand-made cross-field bridges; key skills by distinctiveness, closeness to your skills and AI exposure", url: null, date: null },
    { kind: "formula", label: "Fixed formulas: docs/ARCHITECTURE.md §7 (route cost, time estimates at your pace)", url: null, date: null },
  ];
  return {
    kbVersion: graph.kbVersion, job, source: "esco", escoId: occId, uri: det.uri, title: det.title, mode, year: opts.year, scenario: opts.scenario, hours,
    match: det.match, counts: { ...det.counts, emerging: emerging.length },
    emerging,                 // AI-era skills this job now asks for (not in ESCO 2022, not in the match), with their sources
    route, keySkills: keys, missing,
    weeks, weeksReady: weeks, weeksEstimated: missing.some(m => m.estimated), totalHours,
    saferAlternative,
    alternatives: [], steps: [],
    cost: { totalRm: 0, hrdClaimableRm: 0, outOfPocketRm: 0, unknownCount: 0, items: [], budgetRm: profile.budgetRm, withinBudget: null },
    deadline: null as any,
    sources,
  };
}

/** The key route as a chain: you -> the skill of yours it starts from -> key skills (closest first) -> the job. */
function routeOf(sol: ReturnType<typeof solve>, E: Engine, job: string, title: string, missing: any[], hours: number) {
  const { keys, name } = sol;
  const first = keys.find(k => sol.dist.has(k));
  const anchor = first ? sol.src.get(first)! : null;
  const nodes = [E.root, ...(anchor ? [anchor] : []), ...keys, job];
  const hoursOf = (k: string) => missing.find(m => m.id === k)?.hours ?? 0;
  const legs = nodes.slice(1).map((to, i) => {
    const from = nodes[i];
    if (to === anchor) return { from, to, toName: name(to), kind: "own", why: "A skill you already have", weeks: 0, weeksRef: 0, rel: 1, bridge: false };
    if (to === job) return { from, to, toName: title, kind: "build", why: "", weeks: 0, weeksRef: 0, rel: null, bridge: false };
    // the step's real link: its last edge in the Dijkstra tree (a hand-made bridge, or a data link), and the skill of
    // yours that path starts from
    const p = sol.prev.get(to), reached = sol.dist.has(to);
    const bridge = !!p?.bridge, src = sol.src.get(to), viaYours = !!p && (p.from === src || sol.owned.has(p.from));
    const why = !reached || !p ? "New ground: no close link from your skills yet"
      : bridge ? `Bridge from ${name(p.from)}: ${p.bridge}`
      : viaYours ? `Builds on ${name(p.from)}, which you have`
      : `Builds on ${name(p.from)} (close to ${name(src!)}, which you have)`;
    const w = hoursOf(to) / PARAMS.referenceHours;
    return { from, to, toName: name(to), kind: bridge ? "bridge" : "build", why, weeks: displayWeeks(w, hours), weeksRef: Math.round(100 * w) / 100,
      rel: reached ? Math.round(100 * (sol.prod.get(to) ?? 0)) / 100 : 0, bridge };
  });
  // AI-era skills carry no exposure number, so they are left out of the route's risk (neither "at risk" nor "safe").
  const skills = nodes.filter(n => n !== E.root && n !== job && !isAiNode(n));
  const avgE = skills.reduce((s, k) => s + sol.exposure(k), 0) / Math.max(1, skills.length);
  const weeksRef = legs.reduce((s, l) => s + l.weeksRef, 0);
  return { key: nodes.join(">"), nodes, legs, names: Object.fromEntries(nodes.map(n => [n, n === job ? title : n === E.root ? name(n) : name(n)])),
    risk: avgE < 0.35 ? "Low" : avgE < 0.55 ? "Medium" : "High", weeks: displayWeeks(weeksRef, hours), weeksRef: Math.round(100 * weeksRef) / 100 };
}

/** For tests: forget the static indexes. */
export function resetEscoPlan() { stat = null; rowIx = null; }
