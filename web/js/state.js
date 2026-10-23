// App state. S = data from the server + forecast settings; UI = what the user is looking at; D = derived per render.
// The shared engine runs here on every change (cheap), so sliders and toggles respond instantly.
// Server results (GET /api/plan, /api/map …) are authoritative; the browser engine is for feedback.
import { createEngine, displayWeeks } from "/shared/engine.js";
import { reduce, store } from "./util.js";

export const S = {
  graph: null,          // GET /api/graph
  profile: null,        // GET /api/profile/:id
  profileFallback: false, // true when the profile service is unavailable and we show the built-in sample persona
  health: null,
  year: 2026,
  scenario: "moderate",
  E: null,              // engine bound to graph + profile + scenario
  signalNode: null,     // node of the last approved signal (incident marker on the map)
  ghost: null,          // { keys:Set, nodes:Set, alpha } old route fading out after a reroute
};

export const UI = {
  tab: "jobs", sector: "best", pinned: null, ring: [], job: null, mode: "fastest",
  labelsAll: false, rotating: !reduce, drawer: null, search: "",
  view: "user",         // user | admin
  sdg: null, rank: null, // SDG priority and the server's ranking for it
  employer: null,       // { id, name } chosen for the selected job
  employerReq: [],      // that employer's requirements for the selected job, engine shape
  plans: [],            // saved plans for this profile
  picked: false,        // has the user chosen a job yet? (the Path tab asks them to pick one first)
  explore: false,       // is "Find other jobs" (search, sectors, SDG) open?
};

export const D = { plans: {}, plan: null };

/** Filled by app.js so panels can trigger app-level work without import cycles. */
export const actions = {};

/** The demo persona, used only if the profile service can't be reached. Same values as the database seed. */
export const FALLBACK_PROFILE = {
  id: 1, displayName: "Priya Nair (sample persona)", occupationId: "ap", hours: 6, budgetRm: null, targetDate: null,
  sdgPriority: null, lang: "en", employerId: null, isDemo: true,
  skills: Object.entries({ inv: [5, "cv"], three: [5, "cv"], pay: [4, "self"], tax: [3, "self"], erp: [4, "cv"], dispute: [3, "self"], process: [2, "self"], audit: [4, "verified"], recon: [4, "cv"], excel: [4, "verified"] })
    .map(([skillId, [level, confidence]]) => ({ skillId, level, confidence, evidence: null })),
};

export function normaliseProfile(p) {
  const skills = Array.isArray(p.skills) ? p.skills : [];
  const level = p.level && typeof p.level === "object" ? p.level : Object.fromEntries(skills.filter(s => s.level > 0).map(s => [s.skillId, s.level]));
  return { ...p, skills, level, hours: Number(p.hours) || 6 };
}

export const profileId = () => Number(store.get("profileId", 1)) || 1;
export const setProfileId = id => store.set("profileId", id);

export const N = id => S.graph?.nodes?.[id];
export const nameOf = id => N(id)?.name || id;

/** Rebuild the engine for the current graph, profile and forecast. */
export function rebuild() {
  const p = S.profile;
  let occ = p.occupationId;
  if (!N(occ)) occ = Object.keys(S.graph.nodes).find(k => S.graph.nodes[k].type === "occupation") || occ;
  S.E = createEngine(S.graph, { occupationId: occ, level: p.level, hours: p.hours }, { year: S.year, scenario: S.scenario });
  return S.E;
}

/** Weeks at the user's own pace (graph weeks assume 6 h/week). */
export const W = w => displayWeeks(w, S.profile?.hours || 6);

/** you | have | learn | job — "have" depends on the profile, not the node. */
export function kindOf(id) {
  const E = S.E;
  if (id === E.root) return "you";
  const n = N(id);
  if (!n) return "learn";
  if (n.type === "job") return "job";
  if (n.type === "occupation") return "you";
  return E.owned(id) ? "have" : "learn";
}

export const confOf = k => S.profile?.skills?.find(s => s.skillId === k)?.confidence || null;

/** The jobs on the map: the sector's jobs (or the server's SDG-aware ranking), plus a searched job. */
export function computeRing() {
  const E = S.E;
  let ring;
  const ranked = UI.sdg && UI.rank && Array.isArray(UI.rank.jobs) ? UI.rank.jobs.filter(x => E.isJob(x.job)) : null;
  if (ranked && UI.sector === "best") ring = [...ranked].sort((a, b) => a.rank - b.rank).slice(0, 4).map(x => x.job);
  else ring = E.sectorJobs(UI.sector);
  ring = ring.filter(j => E.isJob(j));
  if (UI.pinned && E.isJob(UI.pinned) && !ring.includes(UI.pinned)) ring.push(UI.pinned);
  if (ranked) { const r = Object.fromEntries(ranked.map(x => [x.job, x.rank])); ring.sort((a, b) => (r[a] ?? 99) - (r[b] ?? 99)); }
  else ring.sort((a, b) => E.match(b) - E.match(a));
  UI.ring = ring;
  if (!ring.includes(UI.job)) UI.job = ring[0] || null;
}

export function computePlans() {
  D.plans = {};
  for (const j of UI.ring) {
    try { D.plans[j] = S.E.planFor(j, UI.mode, j === UI.job ? UI.employerReq : []); }
    catch (e) { console.warn("planFor failed", j, e); D.plans[j] = { job: j, route: null, ups: [], extras: [], core: 0, ready: 0 }; }
  }
  D.plan = UI.job ? D.plans[UI.job] : null;
}

/** Match for the selected job includes the chosen employer's extra requirements. */
export const matchOf = j => S.E.match(j, j === UI.job ? UI.employerReq : []);

/** Who does the work: [AI does, AI assists, you] for a job or occupation, interpolated for the year and scenario. */
export function humanSplit(id) {
  const s = N(id)?.split;
  if (!Array.isArray(s) || s.length < 3) return null;
  const f = Math.max(0, Math.min(1, (S.year - 2026) / 4));
  const end = S.scenario === "fast" ? s[2] : s[1];
  return [0, 1, 2].map(i => Math.round(s[0][i] + (end[i] - s[0][i]) * f));
}

export const isSampleProfile = () => !!(S.profile?.isDemo || S.profileFallback);
