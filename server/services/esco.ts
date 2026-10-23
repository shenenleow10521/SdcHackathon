// The full ESCO v1.2.1 taxonomy (every occupation and skill, English), loaded once into memory from
// db/seed/esco_full.json.gz, plus our exposure model's score for every skill (db/seed/esco_skill_scores.json.gz).
// Built by scripts/data/build_esco_full.py and scripts/score-esco-skills.ts.
//
// "Check any job": your match for an ESCO occupation is the share of its ESSENTIAL skills you cover:
//   have    (1.0) you confirmed this ESCO skill (profile_esco_skills), or a skill in your profile is mapped to it
//                 (db/seed/esco_map.json)
//   related (PARAMS.bridgeCoverage) the ESCO skill's nearest catalogue skill (bge-m3 cosine >= RELATED_COSINE) is in your profile
//   missing (0)
// Optional skills are listed but don't count. AI exposure comes from ILO WP140 for the occupation's ISCO-08 group,
// plus (through the ESCO-O*NET crosswalk, db/seed/esco_onet.json.gz) the closest O*NET occupation's task list with
// human ratings, the "GPTs are GPTs" occupation score and the Anthropic Economic Index; and the Malaysian wage and
// wage-earner trend (DOSM, db/seed/dosm.json) for its major group (MASCO 2020 major groups = ISCO-08 major groups); and
// whether its 4-digit group is on Malaysia's Critical Occupations List (TalentCorp MyCOL 2024/2025, db/seed/mycol.json).
import { readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { projectRoot } from "../lib/db.ts";
import { PARAMS, HAVE_LEVEL } from "../../shared/engine.js";

export const RELATED_COSINE = 0.8;

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
const DOSM_GROUP: Record<string, string> = { "1": "managers", "2": "professionals", "3": "technicians", "4": "clerical", "5": "service_sales", "6": "agriculture", "7": "craft", "8": "operators", "9": "elementary" };

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
export function occupationDetail(id: string, level: Record<string, number> = {}, confirmed: Set<string> = new Set()) {
  const d = loadEsco();
  const o = d?.occupations[id];
  if (!d || !o) return null;
  const lvl = (cat: string) => level[cat] || 0;
  const owned = (cat: string) => lvl(cat) > 0;
  const skill = (sid: string): SkillCoverage => {
    const s = d.skills[sid], sc = d.scores[sid];
    const mine = confirmed.has(sid);
    // Same rule as the catalogue: the exact skill counts as yours at HAVE_LEVEL; below it, partial credit (level / HAVE_LEVEL).
    const cats = mine ? [] : d.catalogueByEsco.get(sid) || [];
    const exact = cats.find(c => lvl(c) >= HAVE_LEVEL) || null;
    const started = exact ? null : cats.find(owned) || null;
    const related = !mine && !exact && !started && sc && sc[2] >= RELATED_COSINE && owned(sc[1]) ? sc[1] : null;
    return {
      id: sid, title: s.title, type: s.type, modelExposure: sc?.[0] ?? null, confirmed: mine,
      basis: mine || exact ? "have" : started || related ? "related" : "missing", via: exact || started || related || null,
      coverage: mine || exact ? 1 : started ? Math.max(PARAMS.bridgeCoverage, lvl(started) / HAVE_LEVEL) : related ? PARAMS.bridgeCoverage : 0,
    };
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
    match: essential.length ? Math.round(100 * essential.reduce((s, x) => s + x.coverage, 0) / essential.length) : 0,
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
