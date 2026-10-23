// HalaTuju scoring engine. Pure functions, no I/O.
// Runs on the server (authoritative) and in the browser (instant slider feedback).
// Every formula here is listed in docs/ARCHITECTURE.md §7; change both together.

/**
 * @typedef {{ name: string, type: "occupation"|"skill"|"job", e: number[], d: number[],
 *   emerging?: { status: "provisional"|"confirmed" } | null, stay?: boolean }} GraphNode
 * @typedef {{ from: string, to: string, weeks: number, why: string, kind: string }} GraphEdge
 * @typedef {{ skill: string, weight: number, need: number, share?: number|null, status?: string }} Requirement
 * @typedef {{ kbVersion?: number, nodes: Record<string, GraphNode>, edges: GraphEdge[],
 *   req: Record<string, Requirement[]>, sectors?: { id: string, jobs: string[]|null }[],
 *   deltas?: { e?: Record<string, number>, d?: Record<string, number> } }} Graph
 * @typedef {{ occupationId: string, level: Record<string, number>, hours?: number }} EngineProfile
 * @typedef {{ year?: number, scenario?: "slow"|"moderate"|"fast", extraE?: Record<string, number>, extraD?: Record<string, number> }} Scenario
 */

/**
 * One rule for every job: a skill counts as yours at level 3 of 5 ("I can do it on my own").
 * Catalogue and committee requirements all need this level; only an employer's own requirements may differ.
 * Below it, a skill you have started still gives partial credit (coverage = level / need) and a level-up step.
 */
export const HAVE_LEVEL = 3;

export const PARAMS = Object.freeze({
  baseYear: 2026,
  endYear: 2030,
  takenBase: 0.85,          // taken over when exposure >= 0.85 - 0.2 * tide ...
  takenTideSlope: 0.2,      // ... and demand < 0
  moderateTide: 0.6,
  takenCoverage: 0.3,       // a skill you have that AI has taken over still counts a little
  bridgeCoverage: 0.4,      // a skill you lack but can bridge to from one you have
  emergingWeight: 0.5,      // unconfirmed emerging skills count at half weight
  rankMatch: 0.6, rankOutlook: 0.4,
  fastestPenalty: 30, safestWeeks: 0.3, safestPenalty: 10, noregretPenalty: 6,
  edgeBase: 0.01,
  referenceHours: 6,        // edge weeks assume 6 learning hours a week
  maxExposure: 0.99,
  slowFactor: 0.5,          // "Slow AI": half of the Moderate change by 2030 (our assumption, not sourced)
});

/**
 * The random inputs of the future stress test (a Monte Carlo simulation). Each run draws one value of each;
 * the plan "works" in a run if it passes the same three checks as always (see stressTest).
 */
export const MONTE_CARLO = Object.freeze({
  runs: 1000,               // futures per plan; at 1,000 the rate is within about ±2 points near 85-90% (95% confidence)
  // How fast AI arrives, on a scale where -1 = Slow (PARAMS.slowFactor of Moderate's change), 0 = Moderate, 1 = Fast
  // (our two scenarios). Triangular, centred on Moderate: any speed between Slow and Fast can come up.
  aiSpeed: { min: -1, mode: 0, max: 1 },
  // Error in our AI-exposure estimate, added to each skill's exposure (then clamped). Normal with SD = MAE × 1.2533
  // (for normal errors SD = MAE × sqrt(pi/2)); MAE 0.065 is the exposure model's held-out per-occupation error
  // (ml/artifacts/eval.json, perOccupation.model.mae, 185 occupations never seen in training).
  exposureSD: 0.065 * 1.2533,
  // Share of that error variance common to all skills in a run (when the model is off, it tends to be off the
  // same way for related skills); the rest is each skill's own. Our assumption.
  exposureShared: 0.5,
  // Hours you really study each week: your planned hours × a factor, triangular 0.5..1.5, mode 1 (busy weeks, keen weeks).
  hoursFactor: { min: 0.5, mode: 1, max: 1.5 },
  // Weeks each step really takes: the catalogue estimate × a factor, uniform 0.8..1.2, drawn per step.
  weeksFactor: { min: 0.8, max: 1.2 },
});

/**
 * A value's position on its 2026 -> 2030 path for an AI speed s in [-1, 1] (-1 Slow, 0 Moderate, 1 Fast, blends between).
 * arr = [2026, 2030 Moderate, 2030 Fast]; f = share of the way from 2026 to 2030.
 */
export function aiInterp(arr, f, s) {
  if (s <= 0) return arr[0] + (arr[1] - arr[0]) * f * (1 + (1 - PARAMS.slowFactor) * s);
  return arr[0] + ((arr[1] - arr[0]) * (1 - s) + (arr[2] - arr[0]) * s) * f;
}
/** The AI "tide" (how far the takeover bar has dropped) for an AI speed s in [-1, 1]. */
export function aiTide(f, s) {
  if (s <= 0) return f * PARAMS.moderateTide * (1 + (1 - PARAMS.slowFactor) * s);
  return f * (PARAMS.moderateTide + (1 - PARAMS.moderateTide) * s);
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const MODES = ["fastest", "noregret", "safest"];

/**
 * Weeks at the user's own pace. Edge weeks are stored at 6 h/week.
 * @param {number} weeks
 * @param {number} [hours]
 */
export function displayWeeks(weeks, hours = 6) {
  if (!weeks) return 0;
  return Math.max(1, Math.round(weeks * PARAMS.referenceHours / Math.max(1, hours)));
}

/** @param {number} avgExposure */
export function riskOf(avgExposure) {
  return avgExposure < 0.35 ? "Low" : avgExposure < 0.55 ? "Medium" : "High";
}

/**
 * Build an engine bound to one knowledge-base snapshot, one profile and one scenario.
 * @param {Graph} graph
 * @param {EngineProfile} profile
 * @param {Scenario} [scenario]
 */
export function createEngine(graph, profile, scenario = {}) {
  const N = graph.nodes;
  const year = scenario.year ?? PARAMS.baseYear;
  const fast = scenario.scenario === "fast", slow = scenario.scenario === "slow";
  const dE = { ...(graph.deltas?.e || {}) }, dD = { ...(graph.deltas?.d || {}) };
  for (const [k, v] of Object.entries(scenario.extraE || {})) dE[k] = (dE[k] || 0) + v;
  for (const [k, v] of Object.entries(scenario.extraD || {})) dD[k] = (dD[k] || 0) + v;
  const ROOT = profile.occupationId;
  if (!N[ROOT]) throw new Error(`Unknown occupation: ${ROOT}`);

  const node = id => { const n = N[id]; if (!n) throw new Error(`Unknown node: ${id}`); return n; };
  const lvl = k => profile.level[k] || 0;
  const owned = k => N[k]?.type === "skill" && lvl(k) > 0;        // started: on your map, a route start, partial credit
  const has = k => owned(k) && lvl(k) >= HAVE_LEVEL;              // counts as yours ("You have X of Y skills")
  const isSkill = id => N[id]?.type === "skill";
  const isJob = id => N[id]?.type === "job";
  const f = clamp((year - PARAMS.baseYear) / (PARAMS.endYear - PARAMS.baseYear), 0, 1);
  const speed = fast ? 1 : slow ? -1 : 0; // AI speed on the scale of aiInterp
  const interp = arr => aiInterp(arr, f, speed);

  const boostE = id => dE[id] || 0;
  const exposure = id => clamp(interp(node(id).e) + boostE(id), 0, PARAMS.maxExposure);
  const demand = id => interp(node(id).d) + (dD[id] || 0);
  const tide = () => aiTide(f, speed);

  /** AI has taken the skill over: it becomes a closed road. */
  function taken(id) {
    const t = node(id).type;
    if (t !== "skill" && t !== "occupation") return false;
    return exposure(id) >= PARAMS.takenBase - PARAMS.takenTideSlope * tide() && demand(id) < 0;
  }
  function zone(id) {
    const e = exposure(id), d = demand(id);
    return d >= 0 ? (e < 0.5 ? "Grow" : "Augment") : (e < 0.5 ? "Hold" : "At risk");
  }
  /** Plain-language impact label for a skill. */
  function impact(id) {
    if (taken(id)) return { label: "Declining", tone: "mute", why: "AI has taken over most of this" };
    const z = zone(id), e = exposure(id), d = demand(id);
    if (z === "At risk") return { label: "Declining", tone: "crit", why: "AI can do most of it and demand is falling" };
    if (z === "Augment") return { label: "Changing", tone: "warn", why: "Still needed, but AI changes how it is done" };
    if (e < 0.3 && d >= 5) return { label: "Rising human skill", tone: "good", why: "AI can't do this well, and it matters more as AI takes the routine work" };
    return { label: "Durable", tone: "info", why: "Steady demand; AI only helps at the edges" };
  }

  // Outgoing edges. The root (you) connects to every skill you own at zero cost.
  const outIndex = new Map();
  for (const e of graph.edges) { if (!outIndex.has(e.from)) outIndex.set(e.from, []); outIndex.get(e.from).push(e); }
  const rootEdges = Object.keys(N).filter(owned).map(k => ({ from: ROOT, to: k, weeks: 0, why: "A skill you already have", kind: "own" }));
  const outEdges = u => (u === ROOT ? rootEdges.concat(outIndex.get(u) || []) : outIndex.get(u) || []);
  const inEdges = v => graph.edges.filter(e => e.to === v);

  function edgeCost(mode, to, weeks) {
    const base = PARAMS.edgeBase;
    if (!isSkill(to)) return (mode === "safest" ? PARAMS.safestWeeks * weeks : weeks) + base;
    const e = exposure(to);
    if (mode === "fastest") return weeks + base + PARAMS.fastestPenalty * Math.max(0, e - 0.5) ** 2;
    if (mode === "safest") return PARAMS.safestWeeks * weeks + base + PARAMS.safestPenalty * e * e;
    const worst = clamp(node(to).e[2] + boostE(to), 0, PARAMS.maxExposure); // no-regret: worst case, Fast AI 2030
    return weeks + base + PARAMS.noregretPenalty * worst * worst;
  }

  /** Dijkstra from you to a job. Jobs are destinations, never stopovers; taken skills are closed roads. */
  function shortestPath(dest, mode = "fastest", opts = {}) {
    if (!isJob(dest)) throw new Error(`Not a job: ${dest}`);
    const blocked = new Set(opts.avoid || []);
    const dist = { [ROOT]: 0 }, prev = {}, done = new Set();
    while (true) {
      let u = null;
      for (const k in dist) if (!done.has(k) && (u === null || dist[k] < dist[u])) u = k;
      if (u === null || u === dest) break;
      done.add(u);
      for (const ed of outEdges(u)) {
        const b = ed.to;
        if (!N[b] || done.has(b) || blocked.has(b)) continue;
        if (isJob(b) && b !== dest) continue;
        if (isSkill(b) && taken(b)) continue;
        const nd = dist[u] + edgeCost(mode, b, ed.weeks);
        if (dist[b] === undefined || nd < dist[b]) { dist[b] = nd; prev[b] = { from: u, w: ed.weeks, why: ed.why, kind: ed.kind }; }
      }
    }
    if (dist[dest] === undefined) return null;
    const legs = [];
    for (let v = dest; v !== ROOT; v = prev[v].from) legs.unshift({ from: prev[v].from, to: v, weeks: prev[v].w, why: prev[v].why, kind: prev[v].kind });
    const nodes = [ROOT, ...legs.map(l => l.to)];
    const skills = nodes.filter(isSkill);
    const avgE = skills.reduce((s, k) => s + exposure(k), 0) / Math.max(1, skills.length);
    return { dest, mode, legs, nodes, weeks: legs.reduce((s, l) => s + l.weeks, 0), avgE, risk: riskOf(avgE), key: nodes.join(">"), cost: dist[dest] };
  }

  /** Other good routes: block each stop on the best route in turn and keep distinct results. */
  function alternatives(dest, mode = "fastest", max = 2) {
    const best = shortestPath(dest, mode);
    if (!best) return [];
    const seen = new Set([best.key]), out = [];
    for (const stop of best.nodes.slice(1, -1)) {
      if (owned(stop)) continue;
      const alt = shortestPath(dest, mode, { avoid: [stop] });
      if (alt && !seen.has(alt.key)) { seen.add(alt.key); out.push(alt); }
    }
    return out.sort((a, b) => a.cost - b.cost).slice(0, max);
  }

  const bridgedFrom = skill => inEdges(skill).filter(e => owned(e.from) && (e.kind === "evolve" || !taken(e.from)));
  function coverage(skill, need) {
    if (owned(skill)) return taken(skill) ? PARAMS.takenCoverage : Math.min(1, lvl(skill) / need);
    return bridgedFrom(skill).length ? PARAMS.bridgeCoverage : 0;
  }
  const weightOf = (k, w) => w * (N[k]?.emerging && N[k].emerging.status !== "confirmed" ? PARAMS.emergingWeight : 1);

  /** Match % = Σ(weight × coverage) ÷ Σ weight, rounded. Optional extra requirements (e.g. an employer's). */
  function match(job, extraReq = []) {
    const r = [...(graph.req[job] || []), ...extraReq];
    if (!r.length) return 0;
    const num = r.reduce((s, q) => s + weightOf(q.skill, q.weight) * coverage(q.skill, q.need), 0);
    const den = r.reduce((s, q) => s + weightOf(q.skill, q.weight), 0);
    return Math.round(100 * num / den);
  }
  /** Per-requirement breakdown behind a match %, for "Why this number?". */
  function matchBreakdown(job, extraReq = []) {
    return [...(graph.req[job] || []), ...extraReq].map(q => ({
      skill: q.skill, weight: q.weight, effectiveWeight: weightOf(q.skill, q.weight), need: q.need,
      level: lvl(q.skill), coverage: Math.round(coverage(q.skill, q.need) * 100) / 100,
      basis: owned(q.skill) ? (taken(q.skill) ? "taken" : "owned") : bridgedFrom(q.skill).length ? "bridged" : "missing",
      status: q.status || null, share: q.share ?? null,
    }));
  }
  function outlook(job) { return clamp(50 + demand(job) - 40 * exposure(job), 0, 100); }
  function rankScore(job) { return PARAMS.rankMatch * match(job) + PARAMS.rankOutlook * outlook(job); }

  /** Route + upskill steps + remaining gaps. Weeks are at the reference 6 h/week. */
  function planFor(job, mode = "fastest", extraReq = []) {
    const route = shortestPath(job, mode);
    const onRoute = new Set(route ? route.nodes : []);
    const ups = [], extras = [];
    for (const q of [...(graph.req[job] || []), ...extraReq]) {
      const k = q.skill;
      if (owned(k)) { if (!taken(k) && lvl(k) < q.need) ups.push({ id: k, from: lvl(k), to: q.need, weeks: q.need - lvl(k) }); }
      else if (!onRoute.has(k) && !extras.some(x => x.id === k)) {
        const inc = inEdges(k).filter(e => (owned(e.from) && (e.kind === "evolve" || !taken(e.from))) || onRoute.has(e.from));
        const best = inc.sort((x, y) => x.weeks - y.weeks)[0];
        extras.push({ id: k, weeks: best ? best.weeks : 4, from: best ? best.from : null, why: best ? best.why : "", kind: best && best.kind === "evolve" ? "evolve" : "reskill" });
      }
    }
    const core = route ? route.weeks : 0;
    return { job, mode, route, ups, extras, core, ready: core + ups.reduce((s, u) => s + u.weeks, 0) + extras.reduce((s, x) => s + x.weeks, 0) };
  }

  const ownedSkills = () => Object.keys(N).filter(owned);
  /** Share of your skills that are safe (Grow or Augment, not taken) in this year and scenario. */
  function futureScore(extra = []) {
    const ids = [...ownedSkills(), ...extra];
    if (!ids.length) return 0;
    return Math.round(100 * ids.filter(k => !taken(k) && (zone(k) === "Grow" || zone(k) === "Augment")).length / ids.length);
  }
  const allJobs = () => Object.keys(N).filter(isJob);
  /** Jobs for a sector. "best" = top 4 by rank, always including a stay-and-adapt option if one exists. */
  function sectorJobs(sector = "best") {
    const s = (graph.sectors || []).find(x => x.id === sector);
    if (s && s.jobs) return s.jobs.filter(isJob);
    const top = allJobs().sort((a, b) => rankScore(b) - rankScore(a)).slice(0, 4);
    const stay = allJobs().find(j => N[j].stay);
    if (stay && !top.includes(stay)) top[Math.min(3, top.length - 1)] = stay;
    return top;
  }

  return {
    root: ROOT, year, scenario: fast ? "fast" : slow ? "slow" : "moderate",
    lvl, owned, has, isSkill, isJob, exposure, demand, tide, taken, zone, impact, edgeCost,
    shortestPath, alternatives, bridgedFrom, coverage, weightOf, match, matchBreakdown, outlook, rankScore,
    planFor, futureScore, ownedSkills, allJobs, sectorJobs,
  };
}

/** A date (or ISO string) as a fractional year, e.g. 2026-07-02 -> ~2026.5. */
export function yearOf(d) {
  const t = d instanceof Date ? d : new Date(d);
  const y = t.getUTCFullYear();
  return y + (t - Date.UTC(y, 0, 1)) / (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1));
}

/** Seeded random numbers (mulberry32): the same seed always gives the same sequence in [0, 1). */
export function mulberry32(a) {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 32-bit FNV-1a hash of a string. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const triangular = (u, { min, mode, max }) => {
  const c = (mode - min) / (max - min);
  return u < c ? min + Math.sqrt(u * (max - min) * (mode - min)) : max - Math.sqrt((1 - u) * (max - min) * (max - mode));
};
const gauss = rnd => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

/**
 * The stress test's seed: who you are, the job, the view and your deadline. Today's date is left out (the number does
 * not reshuffle every day), and so are route type and study hours, so "Take the Safest route: 93%" or
 * "Study 1 more hour a week: 95%" is exactly what you see after making that change.
 */
export function stressSeed(profile, job, opts = {}) {
  const view = opts.view || { year: PARAMS.baseYear, scenario: "moderate" };
  const lv = Object.keys(profile.level || {}).sort().map(k => [k, profile.level[k]]);
  const deadline = opts.deadlineYear === undefined ? null : Math.round(opts.deadlineYear * 1000) / 1000;
  return hashString(JSON.stringify([profile.occupationId, lv, job, view.year, view.scenario || "moderate",
    deadline, (opts.extraReq || []).map(q => [q.skill, q.need])]));
}

/**
 * Future stress test, as a Monte Carlo simulation: replay one plan (route fixed, chosen in `view`) in `runs` random
 * futures (default MONTE_CARLO.runs), each drawing an AI speed, an error in our exposure estimate per skill, your real
 * study hours and how long each step really takes (ranges in MONTE_CARLO). Three yes/no checks per future:
 *   open  - no skill on the route is taken over by AI by the time you reach it,
 *   ready - you are job-ready (all steps, at that future's pace) before the deadline (target date, else end of 2030),
 *   worth - demand for the job is not falling when you arrive, nor at the end of 2030.
 * The plan works in a future if all three pass. Returns how many futures it works in, failure patterns (each failing
 * future counted once, under its first failed check), and single changes that would make the plan sturdier.
 * Seeded (stressSeed), so the same plan always gives the same number. It tests the plan; it is not a chance of being hired.
 */
export function stressTest(graph, profile, job, mode = "fastest", opts = {}) {
  const MC = MONTE_CARLO;
  const runs = Math.max(1, Math.round(opts.runs ?? MC.runs));
  const view = opts.view || { year: PARAMS.baseYear, scenario: "moderate" };
  const start = opts.startYear ?? PARAMS.baseYear;
  const deadline = opts.deadlineYear ?? PARAMS.endYear + 1;
  const seed = opts.seed ?? stressSeed(profile, job, opts);
  const hours = profile.hours ?? PARAMS.referenceHours;
  const planOf = m => createEngine(graph, profile, view).planFor(job, m, opts.extraReq || []);
  const plan = planOf(mode);
  if (!plan.route) return { job, mode, route: null, runs, works: 0, rate: 0, seed, patterns: [], sturdier: [] };

  const N = graph.nodes, dE = graph.deltas?.e || {}, dD = graph.deltas?.d || {};
  const fOf = y => clamp((y - PARAMS.baseYear) / (PARAMS.endYear - PARAMS.baseYear), 0, 1);
  const demandAt = (id, y, s) => aiInterp(N[id].d, fOf(y), s) + (dD[id] || 0);
  const takenAt = (id, y, s, err) => {
    const f = fOf(y), e = clamp(aiInterp(N[id].e, f, s) + (dE[id] || 0) + err, 0, PARAMS.maxExposure);
    return e >= PARAMS.takenBase - PARAMS.takenTideSlope * aiTide(f, s) && demandAt(id, y, s) < 0;
  };
  // Every random number comes from (seed, run, what it is for), so a step or skill shared by two plans gets the
  // same draw in both: comparing plans compares the plans, not the luck of the draw.
  const H = new Map();
  const rngFor = (run, key) => {
    if (!H.has(key)) H.set(key, Math.imul(hashString(key), 0x85EBCA6B));
    return mulberry32((seed ^ Math.imul(run + 1, 0x9E3779B1)) + H.get(key));
  };
  const sdShared = MC.exposureSD * Math.sqrt(MC.exposureShared), sdOwn = MC.exposureSD * Math.sqrt(1 - MC.exposureShared);
  const globals = [];
  for (let run = 0; run < runs; run++) {
    const r = rngFor(run, "");
    globals.push({ s: triangular(r(), MC.aiSpeed), hf: triangular(r(), MC.hoursFactor), z: gauss(r) });
  }
  const errOf = (run, id) => sdShared * globals[run].z + sdOwn * gauss(rngFor(run, "e:" + id));
  const wf = (run, key) => MC.weeksFactor.min + (MC.weeksFactor.max - MC.weeksFactor.min) * rngFor(run, "w:" + key)();

  function simulate(p, h) {
    const items = [...p.ups.map(u => ["up:" + u.id, u.weeks]), ...p.extras.map(x => ["x:" + x.id, x.weeks])];
    const out = [];
    let works = 0;
    for (let run = 0; run < runs; run++) {
      const { s, hf } = globals[run];
      const rate = PARAMS.referenceHours / Math.max(0.5, h * hf); // calendar weeks per reference week
      let weeks = 0, total = 0, fsum = 0, cause = null;
      for (const leg of p.route.legs) {
        const k = wf(run, leg.to);
        fsum += k; total += leg.weeks * k; weeks += leg.weeks * k * rate;
        if (cause || N[leg.to]?.type !== "skill") continue;
        const year = start + weeks / 52;
        if (takenAt(leg.to, year, s, errOf(run, leg.to))) cause = { check: "open", skill: leg.to };
      }
      for (const [key, w] of items) { const k = wf(run, key); fsum += k; total += w * k; }
      const arrive = start + Math.round(total * rate) / 52;
      if (!cause && arrive > deadline) cause = { check: "ready", skill: null };
      if (!cause && [Math.min(arrive, deadline), PARAMS.endYear].some(y => demandAt(job, y, s) < 0)) cause = { check: "worth", skill: null };
      if (!cause) works++;
      out.push({ cause, hours: h * hf, wf: fsum / Math.max(1, p.route.legs.length + items.length) });
    }
    return { works, out };
  }
  const pct = w => (w === runs ? 100 : w === 0 ? 0 : clamp(Math.round(100 * w / runs), 1, 99));

  const base = simulate(plan, hours);
  const works = base.works;

  // Failure patterns: group failing futures by cause, then say which random inputs stand out in that group
  // (group mean at least half a standard deviation away from the mean over all futures; only for causes seen in at
  // least MIN_WHEN futures, since a handful of runs is noise).
  const MIN_WHEN = 10;
  const groups = new Map();
  base.out.forEach((o, run) => {
    if (!o.cause) return;
    const key = o.cause.check + ":" + (o.cause.skill || "");
    if (!groups.has(key)) groups.set(key, { ...o.cause, runs: [] });
    groups.get(key).runs.push(run);
  });
  const stats = vals => { const m = vals.reduce((a, b) => a + b, 0) / vals.length; return { m, sd: Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length) || 1 }; };
  const overAll = v => [...Array(runs).keys()].map(v);
  const patterns = [...groups.values()].map(g => {
    const drivers = [
      ["speed", run => globals[run].s],
      ["hours", run => base.out[run].hours],
      ["weeks", run => base.out[run].wf],
      ...(g.skill ? [["estimate", run => errOf(run, g.skill)]] : []),
    ];
    const when = g.runs.length < MIN_WHEN ? [] : drivers.map(([factor, v]) => {
      const { m, sd } = stats(overAll(v)), d = (g.runs.reduce((a, run) => a + v(run), 0) / g.runs.length - m) / sd;
      const c = { factor, dir: d > 0 ? "high" : "low", d };
      if (factor === "hours" && d < 0) {
        const hs = g.runs.map(v).sort((a, b) => a - b), p90 = hs[Math.floor(0.9 * (hs.length - 1))];
        const below = Math.ceil(p90 * 2) / 2;
        if (below < hours) c.below = below;
      }
      return c;
    }).filter(c => Math.abs(c.d) >= 0.5).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 2)
      .map(({ d, ...c }) => c);
    return { check: g.check, skill: g.skill, count: g.runs.length, share: 100 * g.runs.length / runs, when };
  }).sort((a, b) => b.count - a.count);

  // Make it sturdier: one change at a time, in the same futures (same seed), kept if the rate goes up.
  const sturdier = [];
  if (!opts.noSuggestions && works < runs) {
    for (const m of MODES) {
      if (m === mode) continue;
      const alt = planOf(m);
      if (!alt.route || alt.route.key === plan.route.key) continue;
      const w = simulate(alt, hours).works;
      if (pct(w) > pct(works)) sturdier.push({ kind: "mode", mode: m, route: alt.route, works: w, rate: pct(w) });
    }
    const w = simulate(plan, hours + 1).works;
    if (pct(w) > pct(works)) sturdier.push({ kind: "hours", hours: hours + 1, works: w, rate: pct(w) });
    sturdier.sort((a, b) => b.works - a.works);
  }
  return { job, mode, route: plan.route, readyWeeks: plan.ready, runs, works, rate: pct(works), seed, patterns, sturdier };
}
