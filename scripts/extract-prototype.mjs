// One-off: pull the sample data and reference outputs out of prototype/halatuju-app.html.
// Writes db/seed/knowledge.json (seed data) and tests/fixtures/golden.json (expected engine outputs).
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync("prototype/halatuju-app.html", "utf8");
const logic = html.split("/*LOGIC-START*/")[1].split("/*LOGIC-END*/")[0];
const ctx = {};
vm.createContext(ctx);
vm.runInContext(logic + `
;this.__ = { NODES, EDGES, REQ, JOBMETA, TASKS, LPP, SKILL_SDG, SECTORS, PROFILE, EMERGING, REVIEW, SIGNAL, SDG, AUTO, THRESH,
  S, match, planFor, futureScore, taken, rankScore, sectorJobs, exposure, demand, impact, humanSplit };`, ctx);
const P = ctx.__;
// One rule for every job (HAVE_LEVEL in shared/engine.js): each requirement needs level 3. The prototype's
// per-job levels were set by hand; ESCO publishes no proficiency levels. Applied before seed data and golden outputs.
for (const reqs of Object.values(P.REQ)) for (const q of reqs) q[2] = 3;

// ---- seed data ----
const parseFormat = s => {
  const parts = s.split(" · ");
  const hours = Number((parts.find(p => / h$/.test(p)) || "0").replace(" h", ""));
  return { format: parts[0], hours, free: parts.includes("free"), hrdClaimable: s.includes("HRD Corp") };
};
const knowledge = {
  _note: "Sample values from the HalaTuju prototype. Illustrative, not research results.",
  root: "ap",
  occupations: Object.entries(P.NODES).filter(([, n]) => n.type === "you" || n.type === "job").map(([id, n]) => ({
    id, title: n.name, isDestination: n.type === "job", stay: P.JOBMETA[id]?.move === false,
    blurb: P.JOBMETA[id]?.blurb || null, postings: P.JOBMETA[id]?.postings ?? null, conf: P.JOBMETA[id]?.conf || null,
    split: P.JOBMETA[id]?.split || null, sdg: P.JOBMETA[id]?.sdg || [], e: n.e, d: n.d })),
  skills: Object.entries(P.NODES).filter(([, n]) => n.type === "have" || n.type === "learn").map(([id, n]) => ({
    id, label: n.name, e: n.e, d: n.d, angle: n.a ?? null,
    emerging: P.EMERGING[id] ? { ...P.EMERGING[id] } : null,
    sdg: P.SKILL_SDG[id] || null, tasks: (P.TASKS[id] || []).map(([text, mode]) => ({ text, mode })) })),
  edges: P.EDGES.filter(e => e[4] !== "own").map(([from, to, weeks, why, kind]) => ({ from, to, weeks, why, kind })),
  requirements: Object.fromEntries(Object.entries(P.REQ).map(([job, r]) => [job, r.map(([skill, weight, need, share, status]) => ({ skill, weight, need, share, status }))])),
  courses: Object.entries(P.LPP).map(([skill, [title, fmt, practice, prove]]) => ({ skill, title, ...parseFormat(fmt), formatText: fmt, practice, prove })),
  sectors: Object.entries(P.SECTORS).map(([id, s]) => ({ id, ...s })),
  sdgs: Object.fromEntries(Object.entries(P.SDG).map(([k, [color, name]]) => [k, { color, name }])),
  thresholds: P.THRESH,
  reviewQueue: P.REVIEW.map(r => r.kind === "signal" ? { ...r, boostE: r.boostE ?? (r.id === "s1" ? P.SIGNAL.boost : 0), boostD: r.boostD ?? 0 } : r),
  autoLog: P.AUTO,
  persona: { displayName: "Priya Nair (sample persona)", occupation: "ap", hours: P.PROFILE.hours, level: P.PROFILE.level, conf: P.PROFILE.conf }
};
writeFileSync("db/seed/knowledge.json", JSON.stringify(knowledge, null, 2) + "\n");

// ---- golden outputs ----
const jobs = Object.keys(P.REQ), modes = ["fastest", "noregret", "safest"];
const cases = [];
for (const signal of [false, true]) for (const scenario of ["moderate", "fast"]) for (const year of [2026, 2028, 2030]) {
  Object.assign(P.S, { year, scenario, signal, extraE: {}, extraD: {} });
  const plans = {};
  for (const j of jobs) for (const m of modes) {
    const p = P.planFor(j, m);
    plans[j + ":" + m] = { key: p.route ? p.route.key : null, weeks: p.route ? p.route.weeks : null, core: p.core, ready: p.ready,
      ups: p.ups.map(u => u.id), extras: p.extras.map(x => x.id + "/" + x.kind) };
  }
  cases.push({ year, scenario, signal,
    match: Object.fromEntries(jobs.map(j => [j, P.match(j)])),
    rank: Object.fromEntries(jobs.map(j => [j, Math.round(P.rankScore(j) * 1000) / 1000])),
    taken: Object.keys(P.NODES).filter(k => P.taken(k)),
    futureScore: P.futureScore(),
    best: P.sectorJobs("best"),
    plans });
}
writeFileSync("tests/fixtures/golden.json", JSON.stringify({ signalNode: P.SIGNAL.node, signalBoost: P.SIGNAL.boost, cases }, null, 1) + "\n");
console.log("cases", cases.length, "esg fastest 2026 moderate:", cases[0].plans["esgRole:fastest"], "after signal:", cases[6].plans["esgRole:fastest"]);
