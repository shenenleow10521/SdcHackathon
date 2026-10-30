// The full ESCO v1.2.1 taxonomy (every occupation and skill, English), loaded once into memory from
// db/seed/esco_full.json.gz, plus our exposure model's score for every skill (db/seed/esco_skill_scores.json.gz).
// Built by scripts/data/build_esco_full.py and scripts/score-esco-skills.ts.
//
// "Check any job": your match for an ESCO occupation uses the ONE match rule shown for every job in the app
// ("Match = how much of what the job needs you already have"): the weighted share of its ESSENTIAL skills you cover,
// practical skills weight 1, knowledge items ("tax legislation") weight MATCH.knowledgeWeight, each covered:
//   have    (1.0) you confirmed this ESCO skill (profile_esco_skills), or a skill in your profile is mapped to it
//                 (db/seed/esco_map.json) at HAVE_LEVEL or above
//   related (part) you have a skill close to it: a catalogue skill mapped to it below HAVE_LEVEL (level / HAVE_LEVEL,
//                 at least PARAMS.bridgeCoverage), its nearest catalogue skill (bge-m3 cosine >= RELATED_COSINE,
//                 PARAMS.bridgeCoverage), or a skill you have linked to it in the ESCO skill network
//                 (server/services/skill-network.ts) or by an approved cross-field bridge (server/services/bridges.ts):
//                 credit = that link's relatedness, from MATCH.relatedMin, capped at MATCH.relatedMax
//   missing (0)
// Optional skills are listed but don't count (ESCO lists 10-40 per job; they would drag every number down alike).
// Catalogue jobs use the same rule on their hand-picked requirements (shared/engine.js match()), so the numbers compare. AI exposure comes from ILO WP140 for the occupation's ISCO-08 group,
// plus (through the ESCO-O*NET crosswalk, db/seed/esco_onet.json.gz) the closest O*NET occupation's task list with
// human ratings, the "GPTs are GPTs" occupation score and the Anthropic Economic Index; and the Malaysian wage and
// wage-earner trend (DOSM, db/seed/dosm.json) for its major group (MASCO 2020 major groups = ISCO-08 major groups); and
// whether its 4-digit group is on Malaysia's Critical Occupations List (TalentCorp MyCOL 2024/2025, db/seed/mycol.json).
import { readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { projectRoot } from "../lib/db.ts";
import { PARAMS, HAVE_LEVEL } from "../../shared/engine.js";
import { loadSkillNetwork } from "./skill-network.ts";
import { allApproved } from "./bridges.ts";

export const RELATED_COSINE = 0.8;

/** The match rule's weights (see the header). */
export const MATCH = {
  knowledgeWeight: 0.5, // a knowledge item counts half as much as a practical skill
  relatedMin: 0.35,     // a skill-network or bridge link must be at least this strong to give credit
  relatedMax: 0.5,      // ... and a close skill counts at most half of having the skill itself
};

const seedFile = (f: string) => path.join(projectRoot, "db", "seed", f);
const readGz = (f: string) => (existsSync(seedFile(f)) ? JSON.parse(gunzipSync(readFileSync(seedFile(f))).toString("utf8")) : null);

interface EscoData {
  meta: any; scoresMeta: any; onetMeta: any; dosm: Record<string, any> | null;
  mycol: { meta: any; byCode: Map<string, any> } | null;
  onetLinks: Record<string, any>; onetTasks: Record<string, { title: string; tasks: [string, number, number][] }>;
  occupations: Record<string, any>; skills: Record<string, any>;
  scores: Record<string, [number, string, number]>;
  catalogueByEsco: Map<string, string[]>; // ESCO skill id -> catalogue skill ids mapped to it
  index: { id: string; text: string; title: string }[];
}
let cache: EscoData | null | undefined;

// ISCO-08 / MASCO 2020 major group (first digit of the code) -> DOSM occupation category.
export const DOSM_GROUP: Record<string, string> = { "1": "managers", "2": "professionals", "3": "technicians", "4": "clerical", "5": "service_sales", "6": "agriculture", "7": "craft", "8": "operators", "9": "elementary" };

/** Malaysian salaries & wages by MASCO major group (both sexes): latest year, and change in wage earners since the first year. */
function loadDosm() {
  const f = seedFile("dosm.json");
  if (!existsSync(f)) return null;
  const ds = JSON.parse(readFileSync(f, "utf8")).datasets?.find((x: any) => x.id === "wages_occupation");
  if (!ds) return null;
  const out: Record<string, any> = {};
  for (const g of Object.values(DOSM_GROUP)) {
    const rows = ds.rows.filter((r: any) => r.occupation === g && r.sex === "both").sort((a: any, b: any) => a.date.localeCompare(b.date));
    if (!rows.length) continue;
    const first = rows[0], last = rows[rows.length - 1];
    out[g] = {
      group: g, year: Number(last.date.slice(0, 4)), since: Number(first.date.slice(0, 4)),
      medianWageRm: last.wages_median, meanWageRm: last.wages_mean, wageEarnersK: last.recipients,
      wageEarnersChangePct: Math.round(1000 * (last.recipients - first.recipients) / first.recipients) / 10,
      medianWageChangePct: Math.round(1000 * (last.wages_median - first.wages_median) / first.wages_median) / 10,
      source: `DOSM, ${ds.title} (${ds.page || ds.url}), CC BY 4.0`, url: ds.page || ds.url,
    };
  }
  return out;
}

export function loadEsco(): EscoData | null {
  if (cache !== undefined) return cache;
  const full = readGz("esco_full.json.gz");
  if (!full) return (cache = null);
  const sc = readGz("esco_skill_scores.json.gz");
  const on = readGz("esco_onet.json.gz");
  const map = existsSync(seedFile("esco_map.json")) ? JSON.parse(readFileSync(seedFile("esco_map.json"), "utf8")) : { skills: {} };
  const catalogueByEsco = new Map<string, string[]>();
  for (const [cat, s] of Object.entries<any>(map.skills || {})) {
    if (!s?.uri) continue;
    const id = String(s.uri).split("/").pop()!;
    catalogueByEsco.set(id, [...(catalogueByEsco.get(id) || []), cat]);
  }
  const index = Object.entries<any>(full.occupations).map(([id, o]) => ({ id, title: o.title, text: [o.title, ...(o.alt || [])].join(" | ").toLowerCase() }));
  const mc = existsSync(seedFile("mycol.json")) ? JSON.parse(readFileSync(seedFile("mycol.json"), "utf8")) : null;
  const mycol = mc ? { meta: mc._meta, byCode: new Map<string, any>(mc.occupations.map((o: any) => [o.masco, o])) } : null;
  return (cache = { mycol, dosm: loadDosm(), meta: full._meta, scoresMeta: sc?._meta ?? null, onetMeta: on?._meta ?? null, onetLinks: on?.occupations ?? {}, onetTasks: on?.onet ?? {}, occupations: full.occupations, skills: full.skills, scores: sc?.scores ?? {}, catalogueByEsco, index });
}

export interface SkillCoverage {
  id: string; title: string; type: string; modelExposure: number | null; confirmed: boolean;
  basis: "have" | "related" | "missing"; via: string | null; coverage: number;
}

export const isEscoSkill = (id: string) => !!loadEsco()?.skills[id];

/** For tests: forget the loaded data. */
export function resetEscoCache() { cache = undefined; }

export function escoStats() {
  const d = loadEsco();
  if (!d) return { available: false };
  return {
    available: true, version: "ESCO v1.2.1", counts: d.meta.counts, generated: d.meta.generated, source: d.meta.esco, ilo: d.meta.ilo,
    mycol: d.mycol ? { occupations: d.mycol.byCode.size, escoOccupationsFlagged: Object.values<any>(d.occupations).filter(o => o.isco && d.mycol!.byCode.has(o.isco)).length, source: d.mycol.meta.source } : null,
    onet: d.onetMeta ? { counts: d.onetMeta.counts, crosswalk: d.onetMeta.crosswalk, tasks: d.onetMeta.tasks } : null,
    modelScores: d.scoresMeta ? { skills: Object.keys(d.scores).length, embeddingModel: d.scoresMeta.embeddingModel, provider: d.scoresMeta.embeddingProvider, iloAgreement: d.scoresMeta.iloAgreement, note: d.scoresMeta.note } : null,
  };
}

const words = (q: string) => q.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);

/** Search occupations by title and alternative labels: exact title, then all words in the title, then all words anywhere. */
export function searchOccupations(q: string, limit = 8) {
  const d = loadEsco();
  if (!d) return [];
  const s = q.trim().toLowerCase(), ws = words(q);
  if (!ws.length) return [];
  const scored: { id: string; score: number }[] = [];
  for (const o of d.index) {
    const title = o.title.toLowerCase();
    let score = 0;
    if (title === s) score = 100;
    else if (ws.every(w => title.includes(w))) score = 50 - title.length / 10;
    else if (ws.every(w => o.text.includes(w))) score = 20 - title.length / 10;
    if (score > 0) scored.push({ id: o.id, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(({ id }) => occSummary(d, id));
}

// Words in a job title that say rank or contract, not the job ("Senior Staff Nurse" is a nurse).
const TITLE_NOISE = new Set(["senior", "junior", "staff", "registered", "lead", "principal", "head", "trainee", "acting", "temporary", "contract", "part", "time", "full", "sr", "jr", "i", "ii", "iii"]);
// Too generic to name a job on their own.
const TITLE_GENERIC = new Set(["executive", "manager", "officer", "assistant", "specialist", "clerk", "worker", "associate", "consultant", "analyst", "technician", "supervisor", "staff", "admin", "administrator"]);

// Common Malaysian CV titles ESCO labels differently (after rank words are removed), checked by hand: title -> ESCO title.
const TITLE_ALIASES: Record<string, string> = {
  "nurse": "nurse responsible for general care",
  "software engineer": "software developer",
  "accounts assistant": "accounting assistant",
  "accounts executive": "accounting assistant",
  "customer service executive": "customer service representative",
  "admin assistant": "administrative assistant",
  "admin executive": "administrative assistant",
  "contact centre agent": "call centre agent",
};

/**
 * The person's current job as an ESCO occupation, from the job title they gave (CV) and the ESCO skills they have.
 * Tries the title, then without rank words ("senior", "staff", "registered"), then shorter runs of its words (never a
 * lone generic word like "manager"). Candidates: an exact title or alternative label, else labels holding all the words,
 * those ending in the title's head word first ("community staff nurse" before "nurse assistant"). Among them, the one
 * that lists most of the person's ESCO skills (essential 1, optional 0.5, per sqrt of its essential count) wins; with
 * no skill evidence, the best label match. Null when nothing in ESCO matches the title.
 */
export function currentEscoFor(title: string | null | undefined, skills: Iterable<string> = []) {
  const d = loadEsco();
  if (!d || !title) return null;
  // An internship or student title is not a current job: don't label a graduate a "marketing manager".
  if (/\b(intern|internship|student|undergraduate|graduate|fresh grad)\b/i.test(title)) return null;
  const ws = words(title.replace(/\(.*?\)/g, " ")).filter(w => !TITLE_NOISE.has(w));
  const tries: string[] = [words(title).join(" "), ws.join(" ")];
  for (let n = ws.length - 1; n >= 1; n--) for (let i = 0; i + n <= ws.length; i++) tries.push(ws.slice(i, i + n).join(" "));
  const mine = new Set(skills);
  const fit = (id: string) => {
    const o = d.occupations[id];
    const n = o.essential.filter((s: string) => mine.has(s)).length + 0.5 * o.optional.filter((s: string) => mine.has(s)).length;
    return n / Math.sqrt(Math.max(1, o.essential.length));
  };
  const byTitle = (t: string) => Object.keys(d.occupations).find(id => d.occupations[id].title === t);
  for (const q of [...new Set(tries)]) {
    const qw = words(q);
    if (!qw.length || (qw.length === 1 && TITLE_GENERIC.has(qw[0]))) continue;
    const alias = TITLE_ALIASES[q] && byTitle(TITLE_ALIASES[q]);
    const scored: { id: string; score: number }[] = alias ? [{ id: alias, score: 101 }] : []; // a hand-checked alias wins
    for (const [id, o] of Object.entries<any>(d.occupations)) {
      if (id === alias) continue;
      const labels = [o.title, ...(o.alt || [])].map((l: string) => l.toLowerCase());
      let score = 0;
      for (const l of labels) {
        const lw = words(l);
        const s = l === q ? 100 : qw.every(w => lw.includes(w)) ? (lw[lw.length - 1] === qw[qw.length - 1] ? 60 : 40) - lw.length : 0;
        score = Math.max(score, s);
      }
      if (score > 0) scored.push({ id, score });
    }
    if (!scored.length) continue;
    scored.sort((a, b) => b.score - a.score || d.occupations[a.id].title.length - d.occupations[b.id].title.length);
    const top = scored.slice(0, 30);
    const best = mine.size ? top.reduce((a, b) => (fit(b.id) > fit(a.id) ? b : a)) : top[0];
    const pick = mine.size && fit(best.id) === 0 ? top[0] : best;
    return { id: pick.id, title: d.occupations[pick.id].title, matchedFrom: q };
  }
  return null;
}

function occSummary(d: EscoData, id: string) {
  const o = d.occupations[id];
  return { id, title: o.title, isco: o.isco, essential: o.essential.length, optional: o.optional.length, iloExposure: o.ilo?.mean ?? null, critical: !!criticalOf(d, o) };
}

/** MyCOL entry for an occupation's 4-digit group, or null. */
function criticalOf(d: EscoData, o: any) {
  const c = o.isco && d.mycol?.byCode.get(o.isco);
  return c ? { ...c, source: d.mycol!.meta.source, url: d.mycol!.meta.url } : null;
}

/** Search skills by title and alternative labels (for intake and lookups). */
export function searchSkills(q: string, limit = 10) {
  const d = loadEsco();
  if (!d) return [];
  const ws = words(q);
  if (!ws.length) return [];
  const out: { id: string; score: number }[] = [];
  for (const [id, s] of Object.entries<any>(d.skills)) {
    const title = s.title.toLowerCase();
    if (ws.every(w => title.includes(w))) out.push({ id, score: 50 - title.length / 10 });
    else if (ws.every(w => [title, ...(s.alt || [])].join(" ").toLowerCase().includes(w))) out.push({ id, score: 20 - title.length / 10 });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit).map(({ id }) => ({ id, title: d.skills[id].title, type: d.skills[id].type, modelExposure: d.scores[id]?.[0] ?? null }));
}

/**
 * One occupation with your coverage of each skill. `level` is the profile's catalogue skill levels;
 * `confirmed` is the set of ESCO skill ids the person has confirmed they have.
 */
// Approved cross-field bridges, when that artefact is built and readable (optional: the match never depends on it).
function approvedBridges() {
  try { return allApproved(); } catch { return []; }
}

// Reverse skill-network links (b -> [a, r] for every a -> b), built once, so relatedness works from either side.
let revNet: { net: unknown; rev: Map<string, [string, number][]> } | null = null;
function reverseNetwork() {
  const net = loadSkillNetwork();
  if (!net) return null;
  if (revNet?.net === net) return revNet.rev;
  const rev = new Map<string, [string, number][]>();
  for (const [a, list] of net.byId) for (const [b, r] of list) { if (!rev.has(b)) rev.set(b, []); rev.get(b)!.push([a, r]); }
  revNet = { net, rev };
  return rev;
}

export type Coverage = Pick<SkillCoverage, "basis" | "via" | "coverage" | "confirmed">;

/**
 * Your coverage of any ESCO skill (the match rule in the header), for a profile's catalogue skill levels and confirmed
 * ESCO skills. Call once per profile, then ask for as many skills as you like (answers are memoised).
 */
export function escoCoverage(level: Record<string, number> = {}, confirmed: Set<string> = new Set()): (sid: string) => Coverage {
  const d = loadEsco();
  if (!d) return () => ({ basis: "missing", via: null, coverage: 0, confirmed: false });
  const lvl = (cat: string) => level[cat] || 0;
  const owned = (cat: string) => lvl(cat) > 0;
  // The ESCO skills you have: confirmed ones, and those a catalogue skill of yours at HAVE_LEVEL maps to.
  const mine = new Set(confirmed);
  for (const [esco, cats] of d.catalogueByEsco) if (cats.some(c => lvl(c) >= HAVE_LEVEL)) mine.add(esco);
  // The strongest link from one of them to every other skill: skill network (both directions) and approved bridges.
  const near = new Map<string, [string, number]>();
  const link = (to: string, from: string, r: number) => { if (!mine.has(to) && r > (near.get(to)?.[1] ?? 0)) near.set(to, [from, r]); };
  const net = loadSkillNetwork()?.byId, rev = reverseNetwork();
  for (const s of mine) {
    for (const [b, r] of net?.get(s) || []) link(b, s, r);
    for (const [b, r] of rev?.get(s) || []) link(b, s, r);
  }
  for (const b of approvedBridges()) if (mine.has(b.from)) link(b.to, b.from, b.score);
  const memo = new Map<string, Coverage>();
  return (sid: string) => {
    let c = memo.get(sid);
    if (c) return c;
    const sc = d.scores[sid], isMine = confirmed.has(sid);
    // Same rule as the catalogue: the exact skill counts as yours at HAVE_LEVEL; below it, partial credit (level / HAVE_LEVEL).
    const cats = isMine ? [] : d.catalogueByEsco.get(sid) || [];
    const exact = cats.find(x => lvl(x) >= HAVE_LEVEL) || null;
    const started = exact ? null : cats.find(owned) || null;
    const related = !isMine && !exact && !started && sc && sc[2] >= RELATED_COSINE && owned(sc[1]) ? sc[1] : null;
    const base = isMine || exact ? 1 : started ? Math.max(PARAMS.bridgeCoverage, lvl(started) / HAVE_LEVEL) : related ? PARAMS.bridgeCoverage : 0;
    const nb = base < 1 ? near.get(sid) : undefined;
    const netCredit = nb && nb[1] >= MATCH.relatedMin ? Math.min(MATCH.relatedMax, nb[1]) : 0;
    const coverage = Math.round(100 * Math.max(base, netCredit)) / 100;
    c = {
      confirmed: isMine,
      basis: isMine || exact ? "have" : coverage > 0 ? "related" : "missing",
      via: exact || (netCredit > base ? nb![0] : started || related) || null,
      coverage,
    };
    memo.set(sid, c);
    return c;
  };
}

/** Match % over an ESCO occupation's essential skills (the header's rule), from a coverage function. */
export function escoMatchOf(essential: string[], cov: (sid: string) => Coverage) {
  const d = loadEsco();
  let num = 0, den = 0;
  for (const sid of essential) { const w = d?.skills[sid]?.type === "knowledge" ? MATCH.knowledgeWeight : 1; num += w * cov(sid).coverage; den += w; }
  return den ? Math.round(100 * num / den) : 0;
}

export function occupationDetail(id: string, level: Record<string, number> = {}, confirmed: Set<string> = new Set(), cov = escoCoverage(level, confirmed)) {
  const d = loadEsco();
  const o = d?.occupations[id];
  if (!d || !o) return null;
  const skill = (sid: string): SkillCoverage => {
    const s = d.skills[sid], sc = d.scores[sid];
    return { id: sid, title: s.title, type: s.type, modelExposure: sc?.[0] ?? null, ...cov(sid) };
  };
  const essential: SkillCoverage[] = o.essential.map(skill), optional: SkillCoverage[] = o.optional.map(skill);
  const order = { have: 0, related: 1, missing: 2 } as const;
  const sort = (a: SkillCoverage, b: SkillCoverage) => order[a.basis] - order[b.basis] || a.title.localeCompare(b.title);
  const scored = essential.filter(s => s.modelExposure !== null);
  const link = d.onetLinks[id], ot = link ? d.onetTasks[link.onet] : null;
  const tasks = ot ? ot.tasks.map(([text, rating, core]) => ({ text, rating: rating === 1 ? "ai" : rating === 2 ? "tools" : "human", core: core === 1 })) : [];
  const share = (k: string) => (tasks.length ? Math.round(100 * tasks.filter(t => t.rating === k).length / tasks.length) : 0);
  return {
    id, title: o.title, description: o.description, code: o.code, isco: o.isco, alt: o.alt,
    uri: `http://data.europa.eu/esco/occupation/${id}`,
    match: escoMatchOf(o.essential, cov),
    counts: { essential: essential.length, have: essential.filter(s => s.basis === "have").length, related: essential.filter(s => s.basis === "related").length, optional: optional.length },
    exposure: {
      ilo: o.ilo ? { ...o.ilo, isco: o.isco, source: "ILO WP140 (2025), Annex Table A1" } : null,
      model: scored.length ? Math.round(1000 * scored.reduce((s, x) => s + (x.modelExposure ?? 0), 0) / scored.length) / 1000 : null,
      gptsBeta: link?.gptsBeta ?? null, aei: link?.aei ?? null,
    },
    critical: criticalOf(d, o),
    malaysia: o.code && d.dosm ? d.dosm[DOSM_GROUP[o.code[0]]] ?? null : null,
    onet: link ? {
      code: link.onet, title: link.title, match: link.match,
      split: tasks.length ? { ai: share("ai"), tools: share("tools"), human: share("human") } : null,
      tasks: tasks.sort((a, b) => Number(b.core) - Number(a.core)),
    } : null,
    essential: essential.sort(sort), optional: optional.sort(sort),
  };
}
