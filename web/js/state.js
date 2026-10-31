// App state. S = data from the server + forecast settings; UI = what the user is looking at; D = derived per render.
// The shared engine runs here on every change (cheap), so sliders and toggles respond instantly.
// Server results (GET /api/plan, /api/map …) are authoritative; the browser engine is for feedback.
import { createEngine, displayWeeks } from "/shared/engine.js";
import { store } from "./util.js";
import { t } from "./i18n.js";

/** The forecast time in words, measured from today ("now" / "in 3 years"); the data's end year never shows. */
export const isLater = () => S.year >= 2030;
export const when = () => t(isLater() ? "time.whenLater" : "time.whenNow");
/** The whole forecast setting in words: "today" or "3 years from now, with fast AI adoption". */
export const scope = () => (isLater() ? t("time.scopeLater", { scenario: t("scn." + S.scenario) }) : t("time.scopeNow"));

/** "Show 10 more": the list (and the map, which shows the same jobs) starts at SHOW_STEP best matches and grows by
 *  SHOW_STEP up to MAP_STARS_MAX. */
export const SHOW_STEP = 10;
/** Your top picks on the map: at least TOP_PICKS jobs, up to TOP_MAX when more ESCO jobs beat the weakest pick.
 *  A catalogue pick that fits well (match >= CAT_KEEP) always stays, so a curated route is never pushed off the map. */
export const TOP_PICKS = 4, TOP_MAX = 6, CAT_KEEP = 40;
/** How many ESCO best matches to ask for (the list and the top picks choose from these). */
export const ESCO_BEST_LIMIT = 60;

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
  escoBest: [],         // GET /api/esco/profile/:id/best-jobs: your best matches across all ESCO jobs
  escoMine: [],         // ... and the ESCO skills you have, most useful first ({id,title,fromCatalogue})
  escoPending: false,   // those are still loading for this profile
  escoDefault: null,    // "esco:<id>" the server says to open on (best-jobs defaultPick: match vs time, never your own job)
  escoPlan: null,       // { id, keys, missing, weeks, match, safer } for the selected ESCO job (GET /api/plan?job=<ESCO id>)
  xsNames: {},          // names of ESCO skills drawn on the map ("xs:<id>"), which aren't in the catalogue graph
  xsOwned: new Set(),   // those of them you already have (a selected ESCO job's route starts from them)
  xsMeta: {},           // "xs:<id>" -> { aiEra, sources:[{publisher,title,url,date}], description } for AI-era skills on a plan
  escoExtra: [],        // ESCO jobs opened from the search box that aren't among your best matches (same row shape)
  outlook: null,        // GET /api/esco/profile/:id/outlook: your skills' outlook and the "Stay AI-ready" track
};

export const UI = {
  tab: "jobs", sector: "best", pinned: null, ring: [], job: null, mode: "closest",
  labelsAll: false, rotating: false, drawer: null, search: "",
  view: "user",         // user | admin
  sdg: null, rank: null, // SDG priority and the server's ranking for it
  employer: null,       // { id, name } chosen for the selected job
  employerReq: [],      // that employer's requirements for the selected job, engine shape
  plans: [],            // saved plans for this profile
  picked: false,        // has the user chosen a job yet? (the Path tab asks them to pick one first)
  explore: false,       // is "Find other jobs" (search, sectors, SDG) open?
  shown: SHOW_STEP,     // how many best matches the list and the map show ("Show 10 more" adds SHOW_STEP)
  base: [],             // the recommended jobs, always on the map (their skills are drawn in the middle ring)
  escoRing: [],         // ESCO jobs on the map ("esco:<id>"): your best matches up to UI.shown, plus a selected or searched one
  escoPinned: null,     // an ESCO job opened from the search box (kept on the map like UI.pinned)
  poolSize: 0,          // how many best matches the list could show (for "Show 10 more")
  topMatch: 100,        // the best match on the map (job stars are sized and lit relative to it)
  escoJob: null,        // the selected ESCO job, if one is selected instead of a catalogue job
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
export const isEsco = id => typeof id === "string" && id.startsWith("esco:");
export const escoRow = id => isEsco(id) ? S.escoBest.find(r => "esco:" + r.id === id) || S.escoExtra.find(r => "esco:" + r.id === id) || null : null;

/** ESCO titles come lowercase; show them with a capital first letter. */
export const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
/** An AI-era skill (newer than ESCO; the plan marks it aiEra): shown with a badge and sources, never an exposure %. */
export const isAiEra = id => !!(S.xsMeta[id]?.aiEra || S.xsMeta["xs:" + id]?.aiEra);
/** Your job today in words: the ESCO job the server matched (profile.currentEsco), else the catalogue occupation, else null
 *  when the profile only has the placeholder "Other job" occupation. */
export function currentJobTitle() {
  const c = S.profile?.currentEsco?.title;
  if (c) return cap(String(c));
  const occ = S.E?.root || S.profile?.occupationId;
  return occ && occ !== "other" && N(occ) ? N(occ).name : null;
}
export const nameOf = id => N(id)?.name || (isEsco(id) ? cap(escoRow(id)?.title) : cap(S.xsNames[id])) || id;
/** The job the map is centred on: a selected ESCO job, otherwise the catalogue job. */
export const selJob = () => UI.escoJob || UI.job;
/** At most this many job stars are drawn; the list can show more. */
export const MAP_STARS_MAX = 40;
/** Every job star on the map: your top picks, the selected and pinned job, then the best matches up to MAP_STARS_MAX. */
export function mapJobs() {
  const all = [...UI.ring, ...UI.escoRing];
  if (all.length <= MAP_STARS_MAX) return all;
  const keep = new Set([...UI.base, selJob(), UI.job, UI.pinned].filter(j => j && all.includes(j)));
  const m = j => (isEsco(j) ? escoRow(j)?.match ?? 0 : S.E.match(j));
  for (const j of [...all].sort((a, b) => m(b) - m(a))) { if (keep.size >= MAP_STARS_MAX) break; keep.add(j); }
  return all.filter(j => keep.has(j));
}

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
/** Weeks to job-ready for an ESCO best-match row, and for a loaded ESCO plan, at the user's own pace (so changing the
 *  hours updates them without asking the server again). */
export const escoRowWeeks = r => (r?.weeksRef != null ? W(r.weeksRef) : r?.weeks ?? null);
export const escoPlanWeeks = xp => (xp?.totalHours != null ? W(xp.totalHours / 6) : xp?.weeks ?? null);
/** Weeks to job-ready for a job star at your pace: the figure its label and list row show (null when unknown). */
export function jobWeeks(j) {
  if (isEsco(j)) {
    const xp = UI.escoJob === j && S.escoPlan?.id === j ? S.escoPlan : null, r = escoRow(j);
    return (xp && escoPlanWeeks(xp)) ?? (r && !r.isCurrent ? escoRowWeeks(r) : null);
  }
  const p = D.plans[j]; return p?.route ? W(p.ready) : null;
}

/** you | have | learn | job — "have" depends on the profile, not the node. */
export function kindOf(id) {
  const E = S.E;
  if (id === E.root) return "you";
  if (isEsco(id)) return "job";
  if (S.xsOwned.has(id)) return "have";
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
  // Best matches across ALL jobs (one match rule for catalogue and ESCO jobs): catalogue picks that fit well stay, the
  // best overall fill up to TOP_PICKS, and ESCO jobs that beat the weakest pick join up to TOP_MAX. So a nurse sees
  // nursing jobs, not finance jobs at 5%.
  let escoTop = [];
  if (UI.sector === "best" && !ranked && S.escoBest.length) {
    const m = j => (isEsco(j) ? escoRow(j)?.match ?? 0 : E.match(j));
    const pool = [...ring, ...S.escoBest.filter(r => !r.isCurrent).map(r => "esco:" + r.id)].sort((a, b) => m(b) - m(a));
    const picks = new Set(ring.filter(j => E.match(j) >= CAT_KEEP));
    if (!picks.size && escoDefaultPick()) picks.add(S.escoDefault); // only when no catalogue job fits (Priya's map stays as it is)
    for (const j of pool) { if (picks.size >= TOP_PICKS) break; picks.add(j); }
    const floor = Math.min(...[...picks].map(m));
    for (const j of pool) { if (picks.size >= TOP_MAX || m(j) <= floor) break; picks.add(j); }
    ring = ring.filter(j => picks.has(j));
    escoTop = pool.filter(j => isEsco(j) && picks.has(j));
  } else if (UI.sector === "best" && !ranked && S.escoPending) {
    // until your ESCO matches arrive, show only catalogue picks that really fit (never finance jobs at 5% to a nurse)
    ring = ring.filter(j => E.match(j) >= CAT_KEEP);
  }
  UI.base = [...ring, ...escoTop];
  // The list and the map: your best matches across catalogue and ESCO jobs (your own job is not a destination), up to
  // UI.shown, always including your top picks. "Show 10 more" raises UI.shown.
  const listed = UI.sector === "best" && !ranked;
  let escoList = escoTop;
  if (listed) {
    const m = j => (isEsco(j) ? escoRow(j)?.match ?? 0 : E.match(j));
    // (until your ESCO matches arrive, only catalogue jobs that really fit: never finance jobs at 5% to a nurse)
    const cat = S.escoPending ? E.allJobs().filter(j => E.match(j) >= CAT_KEEP) : E.allJobs();
    const pool = [...cat, ...S.escoBest.filter(r => !r.isCurrent).map(r => "esco:" + r.id)].sort((a, b) => m(b) - m(a) || (a < b ? -1 : 1));
    const keep = new Set(UI.base);
    for (const j of pool) { if (keep.size >= UI.shown) break; keep.add(j); }
    ring = E.allJobs().filter(j => keep.has(j));
    escoList = pool.filter(j => isEsco(j) && keep.has(j));
    UI.poolSize = pool.length;
  } else UI.poolSize = 0;
  // a selected ESCO job (your own job's "stay & adapt", or one opened from the search box) stays on the map while selected
  UI.escoRing = [...new Set([...escoList, ...[UI.escoJob, UI.escoPinned].filter(j => j && escoRow(j))])]
    .sort((a, b) => (escoRow(b)?.match ?? 0) - (escoRow(a)?.match ?? 0));
  if (UI.escoJob && !UI.escoRing.includes(UI.escoJob)) { UI.escoJob = null; S.escoPlan = null; }
  if (UI.pinned && E.isJob(UI.pinned) && !ring.includes(UI.pinned)) ring.push(UI.pinned);
  if (ranked) { const r = Object.fromEntries(ranked.map(x => [x.job, x.rank])); ring.sort((a, b) => (r[a] ?? 99) - (r[b] ?? 99)); }
  else ring.sort((a, b) => E.match(b) - E.match(a));
  UI.ring = ring;
  if (!ring.includes(UI.job)) UI.job = ring[0] || null;
  UI.topMatch = Math.max(1, ...mapJobs().map(j => (isEsco(j) ? escoRow(j)?.match ?? 0 : E.match(j))));
}

/** A job star's strength on the map, 0..1: its match relative to the best match on the map (size and brightness). */
export const jobStrength = j => Math.max(0, Math.min(1, matchOf(j) / (UI.topMatch || 100)));

/** The best match on the map when it is an ESCO job that beats every catalogue job there (to open on it), else null. */
/** The server's job to open on (best-jobs defaultPick), unless its match is far below your best ESCO match: the trade-off
 *  of match against time should pick between close options, not open a nurse on a 22% job over a 37% one. */
export function escoDefaultPick() {
  const d = S.escoDefault && escoRow(S.escoDefault); if (!d) return null;
  const top = Math.max(0, ...S.escoBest.filter(r => !r.isCurrent && !r.stepDown).map(r => r.match || 0));
  return d.match >= 0.75 * top ? S.escoDefault : null;
}
export function bestEscoPick() {
  const def = escoDefaultPick() && UI.escoRing.includes(S.escoDefault) ? S.escoDefault : null;
  const top = def || UI.escoRing.find(j => UI.base.includes(j) && !escoRow(j)?.isCurrent); // never open on the job you have
  if (!top) return null;
  const m = escoRow(top)?.match ?? 0;
  return UI.ring.every(j => S.E.match(j) < m) ? top : null;
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
export const matchOf = j => isEsco(j) ? escoRow(j)?.match ?? 0 : S.E.match(j, j === UI.job ? UI.employerReq : []);

/** Who does the work: [AI does, AI assists, you] for a job or occupation, interpolated for the year and scenario. */
export function humanSplit(id) {
  const s = N(id)?.split;
  if (!Array.isArray(s) || s.length < 3) return null;
  const f = Math.max(0, Math.min(1, (S.year - 2026) / 4));
  const end = S.scenario === "fast" ? s[2] : s[1];
  return [0, 1, 2].map(i => Math.round(s[0][i] + (end[i] - s[0][i]) * f));
}

export const isSampleProfile = () => !!(S.profile?.isDemo || S.profileFallback);
