// Career network over all 3,039 ESCO occupations, computed from ESCO's own job -> skill links.
// Two jobs are close when they need the same skills. Each job is a weighted skill vector:
//   weight = (essential 1.0 | optional 0.5) x idf, where idf = ln(N / number of jobs that need the skill),
// so very common skills ("use spreadsheets software") count less than distinctive ones. Similarity = cosine.
// This is the standard skill-overlap method for job-transition pathways (e.g. Dawson et al. 2021, PLOS ONE).
// Nothing here is invented: it uses only ESCO links, ILO WP140 exposure and our model's skill scores.
import { loadEsco, escoCoverage, escoMatchOf } from "./esco.ts";
import { ESCO_PLAN } from "./esco-plan.ts";
import { PARAMS, displayWeeks } from "../../shared/engine.js";

interface Vec { ids: string[]; w: number[]; norm: number }
let cache: { vec: Map<string, Vec>; byJob: Map<string, { id: string; sim: number }[]> } | null = null;

function build() {
  if (cache) return cache;
  const d = loadEsco();
  if (!d) return null;
  const occ = Object.entries<any>(d.occupations);
  const df = new Map<string, number>();
  for (const [, o] of occ) for (const s of new Set<string>([...o.essential, ...o.optional])) df.set(s, (df.get(s) || 0) + 1);
  const N = occ.length;
  const vec = new Map<string, Vec>();
  const postings = new Map<string, { job: string; w: number }[]>(); // skill -> jobs that need it
  for (const [id, o] of occ) {
    const m = new Map<string, number>();
    for (const s of o.optional) m.set(s, 0.5 * Math.log(N / (df.get(s) || 1)));
    for (const s of o.essential) m.set(s, 1.0 * Math.log(N / (df.get(s) || 1)));
    const ids = [...m.keys()], w = ids.map(k => m.get(k)!);
    vec.set(id, { ids, w, norm: Math.sqrt(w.reduce((a, x) => a + x * x, 0)) || 1 });
    ids.forEach((s, i) => { if (!postings.has(s)) postings.set(s, []); postings.get(s)!.push({ job: id, w: w[i] }); });
  }
  // Cosine with every job sharing at least one skill, via the postings lists (fast: no 3,039 x 3,039 loop).
  const byJob = new Map<string, { id: string; sim: number }[]>();
  for (const [id, v] of vec) {
    const dot = new Map<string, number>();
    v.ids.forEach((s, i) => { for (const p of postings.get(s)!) if (p.job !== id) dot.set(p.job, (dot.get(p.job) || 0) + v.w[i] * p.w); });
    const top = [...dot.entries()].map(([j, x]) => ({ id: j, sim: x / (v.norm * vec.get(j)!.norm) }))
      .sort((a, b) => b.sim - a.sim).slice(0, 25);
    byJob.set(id, top);
  }
  return (cache = { vec, byJob });
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** The closest jobs to an ESCO occupation, with what you'd keep, what you'd need, and AI exposure. */
export function nextJobs(id: string, limit = 10) {
  const d = loadEsco(), net = build();
  const from = d?.occupations[id];
  if (!d || !net || !from) return null;
  const fromEss = new Set<string>(from.essential);
  const exposure = (o: any) => {
    const sc = o.essential.map((s: string) => d.scores[s]?.[0]).filter((x: any) => typeof x === "number");
    return { ilo: o.ilo?.mean ?? null, model: sc.length ? r3(sc.reduce((a: number, b: number) => a + b, 0) / sc.length) : null };
  };
  return {
    from: { id, title: from.title, isco: from.isco, exposure: exposure(from) },
    method: "Skill overlap: cosine of idf-weighted ESCO skill vectors (essential 1.0, optional 0.5).",
    jobs: (net.byJob.get(id) || []).slice(0, limit).map(({ id: j, sim }) => {
      const o = d.occupations[j];
      const keep = o.essential.filter((s: string) => fromEss.has(s));
      const need = o.essential.filter((s: string) => !fromEss.has(s));
      return {
        id: j, title: o.title, isco: o.isco, similarity: r3(sim),
        keep: keep.length, need: need.length, essential: o.essential.length,
        needTop: need.slice(0, 5).map((s: string) => d.skills[s].title),
        exposure: exposure(o), critical: !!(o.isco && d.mycol?.byCode.has(o.isco)),
      };
    }),
  };
}

/**
 * Your best matches across ALL ESCO jobs, by the one match rule (server/services/esco.ts header), plus the ESCO skills
 * you have that matter most for them (for the map's inner ring when your catalogue skills are few).
 */
export function bestJobsForProfile(level: Record<string, number>, confirmed: Set<string>, limit = 10, opts: { current?: string | null; hours?: number } = {}) {
  const d = loadEsco();
  if (!d) return null;
  const cov = escoCoverage(level, confirmed);
  const idf = idfOf();
  const rows: { id: string; match: number; have: number; close: number; essential: number; gaps: number; hoursRef: number }[] = [];
  for (const [id, o] of Object.entries<any>(d.occupations)) {
    if (o.essential.length < 5) continue;
    const c = o.essential.map((s: string) => cov(s));
    rows.push({ id, match: escoMatchOf(o.essential, cov), have: c.filter((x: any) => x.basis === "have").length, close: c.filter((x: any) => x.basis === "related").length,
      essential: o.essential.length, gaps: c.filter((x: any) => x.basis === "missing").length, hoursRef: roughHours(o.essential, c, idf) });
  }
  const top = rows.sort((a, b) => b.match - a.match || b.have - a.have || (a.id < b.id ? -1 : 1)).slice(0, limit);
  const curLevel = opts.current && d.occupations[opts.current] ? skillLevel(d.occupations[opts.current].isco) : null;
  const jobs = top.map(({ hoursRef, ...r }) => {
    const o = d.occupations[r.id];
    const weeksRef = hoursRef / PARAMS.referenceHours;
    const isCurrent = r.id === opts.current;
    // A move to a job at a lower ISCO skill level than yours (a nurse to nurse assistant) is listed, never the default.
    const stepDown = curLevel !== null && !isCurrent && skillLevel(o.isco) < curLevel;
    return {
      ...r, title: o.title, isco: o.isco, iloExposure: o.ilo?.mean ?? null, critical: !!(o.isco && d.mycol?.byCode.has(o.isco)),
      weeks: displayWeeks(weeksRef, opts.hours || PARAMS.referenceHours), weeksRef: Math.round(weeksRef), reach: Math.round(100 * PICK.reachWeeks / (PICK.reachWeeks + weeksRef)) / 100,
      isCurrent, stepDown, pickScore: isCurrent ? 0 : Math.round(r.match * PICK.reachWeeks / (PICK.reachWeeks + weeksRef) * 10) / 10,
    };
  });
  // Only jobs close to the best match compete on reach, so a quick but weak match (22% vs 37%) never wins.
  const pool = jobs.filter(j => !j.isCurrent && !j.stepDown);
  const best = Math.max(0, ...pool.map(j => j.match));
  const eligible = pool.filter(j => j.match >= PICK.closeToBest * best);
  const defaultPick = eligible.length ? eligible.reduce((a, b) => (b.pickScore > a.pickScore ? b : a)).id : null;
  return { jobs, defaultPick };
}

/** The default pick balances match and reach: pickScore = match x reachWeeks / (reachWeeks + rough weeks to job-ready at
 *  6 h/week), so a 74% match one year away (52 weeks) scores 37 and a 70% match half a year away scores 47. */
export const PICK = { reachWeeks: 52, groupDiscount: 0.7, closeToBest: 0.9 };

/** ISCO-08 skill level of a 4-digit group (ILO: major group 1-2 = level 3-4, 3 = level 3, 4-8 = level 2, 9 = level 1). */
function skillLevel(isco: string | undefined) {
  const m = (isco || "")[0];
  return m === "1" || m === "2" ? 4 : m === "3" ? 3 : m === "9" ? 1 : 2;
}

let idfCache: Map<string, number> | null = null;
function idfOf() {
  if (idfCache) return idfCache;
  const d = loadEsco()!, occ = Object.values<any>(d.occupations), df = new Map<string, number>();
  for (const o of occ) for (const s of new Set<string>([...o.essential, ...o.optional])) df.set(s, (df.get(s) || 0) + 1);
  const N = occ.length;
  return (idfCache = new Map([...df].map(([s, n]) => [s, Math.log(N / n) / Math.log(N)])));
}

/** Rough hours to job-ready: the ESCO plan's time formula (server/services/esco-plan.ts) on every essential gap, with
 *  your coverage standing in for relatedness and one flat discount for related skills learned together. Cheap enough
 *  for every job; the plan itself gives the real figure. */
function roughHours(essential: string[], cov: { coverage: number }[], idf: Map<string, number>) {
  const d = loadEsco()!, P = ESCO_PLAN;
  let h = 0;
  essential.forEach((s, i) => {
    const c = cov[i].coverage;
    if (c >= 1) return;
    const k = d.skills[s]?.type === "knowledge";
    h += (k ? P.knowledgeHoursMin + P.knowledgeHoursSpan * (1 - c) : P.skillHoursMin + P.skillHoursSpan * (1 - c)) * (P.commonFloor + (1 - P.commonFloor) * (idf.get(s) ?? 1));
  });
  return h * PICK.groupDiscount;
}

/** The ESCO skills you have, most useful first: how many of your best jobs list each one as essential. */
export function mySkillsFor(level: Record<string, number>, confirmed: Set<string>, jobs: { id: string }[], limit = 16) {
  const d = loadEsco();
  if (!d) return [];
  const cov = escoCoverage(level, confirmed);
  const mine = new Set<string>([...confirmed].filter(s => d.skills[s]));
  for (const [esco] of d.catalogueByEsco) if (cov(esco).basis === "have") mine.add(esco);
  const uses = new Map<string, number>();
  for (const j of jobs) for (const s of d.occupations[j.id]?.essential || []) if (mine.has(s)) uses.set(s, (uses.get(s) || 0) + 1);
  return [...mine].sort((a, b) => (uses.get(b) || 0) - (uses.get(a) || 0) || d.skills[a].title.localeCompare(d.skills[b].title)).slice(0, limit)
    .map(id => ({ id, title: d.skills[id].title, type: d.skills[id].type, jobs: uses.get(id) || 0, fromCatalogue: !confirmed.has(id) }));
}

/** For tests: forget the computed network. */
export function resetNetwork() { cache = null; idfCache = null; }
