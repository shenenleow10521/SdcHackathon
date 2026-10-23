// Career network over all 3,039 ESCO occupations, computed from ESCO's own job -> skill links.
// Two jobs are close when they need the same skills. Each job is a weighted skill vector:
//   weight = (essential 1.0 | optional 0.5) x idf, where idf = ln(N / number of jobs that need the skill),
// so very common skills ("use spreadsheets software") count less than distinctive ones. Similarity = cosine.
// This is the standard skill-overlap method for job-transition pathways (e.g. Dawson et al. 2021, PLOS ONE).
// Nothing here is invented: it uses only ESCO links, ILO WP140 exposure and our model's skill scores.
import { loadEsco, occupationDetail } from "./esco.ts";

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

/** Your best matches across ALL ESCO jobs: coverage of each job's essential skills by your profile. */
export function bestJobsForProfile(level: Record<string, number>, confirmed: Set<string>, limit = 10) {
  const d = loadEsco();
  if (!d) return null;
  const rows: { id: string; match: number; have: number; essential: number }[] = [];
  for (const id of Object.keys(d.occupations)) {
    const det = occupationDetail(id, level, confirmed);
    if (det && det.counts.essential >= 5) rows.push({ id, match: det.match, have: det.counts.have, essential: det.counts.essential });
  }
  return rows.sort((a, b) => b.match - a.match || b.have - a.have).slice(0, limit).map(r => {
    const o = d.occupations[r.id];
    return { ...r, title: o.title, isco: o.isco, iloExposure: o.ilo?.mean ?? null, critical: !!(o.isco && d.mycol?.byCode.has(o.isco)) };
  });
}

/** For tests: forget the computed network. */
export function resetNetwork() { cache = null; }
