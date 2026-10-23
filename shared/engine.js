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
 * @typedef {{ year?: number, scenario?: "slow"|"moderate"|"fast", shiftE?: number, extraE?: Record<string, number>, extraD?: Record<string, number> }} Scenario
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
  slowFactor: 0.5,          // stress test "slow AI": half of the Moderate change by 2030 (our assumption, not sourced)
  estimateSpread: 0.085,    // stress test low/high estimate: half the mean gap (0.17) between ILO WP140 and the
                            // Anthropic Economic Index over the 13 jobs in db/seed/studies.json
});

/** The 18 futures of the stress test: 3 AI speeds × 2 exposure estimates × 3 study paces. */
export const FUTURES = (() => {
  const out = [];
  for (const speed of ["slow", "moderate", "fast"])
    for (const estimate of ["low", "high"])
      for (const pace of [1, 0.75, 0.5]) out.push({ id: `${speed}-${estimate}-${pace * 100}`, speed, estimate, pace });
  return Object.freeze(out);
})();

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
  const shiftE = scenario.shiftE || 0; // stress test: every exposure moved up or down by the same amount
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
  const speed = slow ? PARAMS.slowFactor : 1;
  const interp = arr => arr[0] + ((fast ? arr[2] : arr[1]) - arr[0]) * f * speed;

  const boostE = id => dE[id] || 0;
  const exposure = id => clamp(interp(node(id).e) + boostE(id) + shiftE, 0, PARAMS.maxExposure);
  const demand = id => interp(node(id).d) + (dD[id] || 0);
  const tide = () => f * (fast ? 1 : PARAMS.moderateTide * speed);

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

/**
 * Future stress test: replay one plan (fixed route, chosen in `view`) in each of the 18 FUTURES.
 * Three yes/no checks per future:
 *   open  - no skill on the route is taken over by AI by the time you reach it,
 *   ready - you are job-ready (all steps, at that future's study pace) before the deadline (target date, else end of 2030),
 *   worth - demand for the job is not falling when you arrive, nor at the end of 2030.
 * Returns the count, each future's result, failure patterns, and single changes that would make the plan sturdier.
 * This is a stress test, not a probability.
 */
export function stressTest(graph, profile, job, mode = "fastest", opts = {}) {
  const view = opts.view || { year: PARAMS.baseYear, scenario: "moderate" };
  const start = opts.startYear ?? PARAMS.baseYear;
  const deadline = opts.deadlineYear ?? PARAMS.endYear + 1;
  const plan = createEngine(graph, profile, view).planFor(job, mode, opts.extraReq || []);
  if (!plan.route) return { job, mode, route: null, works: 0, total: FUTURES.length, futures: [], patterns: [], sturdier: [] };
  const N = graph.nodes;
  const futures = FUTURES.map(fu => {
    const at = year => createEngine(graph, profile, { year, scenario: fu.speed, shiftE: fu.estimate === "high" ? PARAMS.estimateSpread : -PARAMS.estimateSpread });
    const rate = PARAMS.referenceHours / Math.max(0.5, profile.hours * fu.pace); // calendar weeks per reference week
    const fails = [];
    let weeks = 0;
    for (const leg of plan.route.legs) {
      weeks += leg.weeks * rate;
      if (N[leg.to]?.type !== "skill") continue;
      const year = start + weeks / 52;
      if (at(year).taken(leg.to)) { fails.push({ check: "open", skill: leg.to, year: Math.floor(year) }); break; }
    }
    const readyWeeks = Math.round(plan.ready * rate);
    const arrive = start + readyWeeks / 52;
    if (arrive > deadline) fails.push({ check: "ready", weeks: readyWeeks, available: Math.max(0, Math.floor((deadline - start) * 52)) });
    // Still worth having: demand not falling when you arrive and at the end of 2030.
    const bad = [Math.min(arrive, deadline), PARAMS.endYear].find(y => at(y).demand(job) < 0);
    if (bad !== undefined) fails.push({ check: "worth", year: Math.floor(bad) });
    return { ...fu, hours: Math.round(profile.hours * fu.pace * 10) / 10, ok: fails.length === 0, fails };
  });
  const works = futures.filter(f => f.ok).length;
  const groups = new Map();
  for (const f of futures) for (const x of f.fails) {
    const key = x.check + ":" + (x.skill || "");
    groups.set(key, { check: x.check, skill: x.skill || null, count: (groups.get(key)?.count || 0) + 1 });
  }
  const patterns = [...groups.values()].sort((a, b) => b.count - a.count);
  const sturdier = [];
  if (!opts.noSuggestions && works < FUTURES.length) {
    const sub = { ...opts, noSuggestions: true };
    for (const m of MODES) {
      if (m === mode) continue;
      const r = stressTest(graph, profile, job, m, sub);
      if (r.route && r.route.key !== plan.route.key && r.works > works) sturdier.push({ kind: "mode", mode: m, route: r.route, works: r.works });
    }
    const more = stressTest(graph, { ...profile, hours: profile.hours + 1 }, job, mode, sub);
    if (more.works > works) sturdier.push({ kind: "hours", hours: profile.hours + 1, works: more.works });
    sturdier.sort((a, b) => b.works - a.works);
  }
  return { job, mode, route: plan.route, readyWeeks: plan.ready, works, total: FUTURES.length, futures, patterns, sturdier };
}
