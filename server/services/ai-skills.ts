// AI-ERA SKILLS: the 27 sourced skills ESCO v1.2.1 (2022) does not have (db/seed/ai_skills.json, every one with 1-3
// public sources), as nodes "ai:<slug>" that ESCO plans can use.
//
// - Requirements: an AI skill is attached to an ESCO occupation as an "emerging" requirement only when the computed
//   link (db/seed/ai_skills_links.json, scripts/link-ai-skills.ts) clears AI_SKILL_PARAMS.minLinkScore, the occupation is
//   not one of the generic hubs the link script flags for review (proposed for 4+ AI skills), and the pair is not on
//   our hand-checked list of wrong links (AI_EXCLUDE). Emerging requirements are shown and timed in the plan, but they
//   are not part of the ESCO match (ESCO's own essential skills are).
// - Graph: each AI skill links to its nearest ESCO skills (bge-m3 cosine of "label. description", the links file's
//   neighbours) with relatedness (cos - 0.5) / 0.5, the same scale as the rest of the ESCO plan network.
// - Exposure: none. Our exposure model measures how much an LLM speeds a task, so AI-usage skills would look "highly
//   exposed"; the plan marks them aiEra:true with exposure null, they never count as at risk, and routes don't penalise them.
// - Catalogue: where the catalogue already has the same skill (prompt, aisup) the AI node points to it (`catalogue`),
//   so a profile that has it at HAVE_LEVEL has the AI skill too, and catalogue jobs keep their own node (no duplicate).
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "../lib/db.ts";
import { loadEsco } from "./esco.ts";

export const AI_SKILL_PARAMS = {
  // Link score = fit x (0.75 + 0.25 x GPTs-are-GPTs beta). Over the 27 x 15 computed links the median is 0.54 and the
  // lower quartile 0.50; below 0.5 the lists turn generic (rental service representatives, distribution managers,
  // social-work jobs for "AI impact assessment"), so 0.5 is the bar.
  minLinkScore: 0.5,
  neighbours: 5,          // ESCO skills each AI skill links to in the route network
  minNeighbourCos: 0.6,   // ... at least this bge-m3 cosine (median random ESCO pair ~0.52)
};

/** Catalogue skills that ARE the AI skill (same thing, finance-worded): the catalogue node is used for catalogue jobs. */
export const AI_CATALOGUE: Record<string, string> = {
  "ai-write-prompts": "prompt",   // "Prompting AI tools for finance"
  "ai-check-output": "aisup",     // "Supervising AI workflows" (human-in-the-loop review)
  "ai-manage-agents": "aisup",    // "Supervising AI workflows" (AI agent oversight)
};

/** Computed links we checked by hand and found wrong (AI skill -> ESCO occupation titles). Logged in aiSkillsReport(). */
export const AI_EXCLUDE: Record<string, { titles: string[]; why: string }[]> = {
  "ai-write-prompts": [{ titles: ["aquaculture biologist", "field survey manager", "pipeline compliance coordinator"], why: "writing is not central to the job; matched on generic report tasks" }],
  "ai-draft-summarise": [{ titles: ["aquaculture biologist", "field survey manager", "ecologist", "conservation scientist"], why: "field science jobs matched on generic report-writing tasks" }],
  "ai-find-use-cases": [{ titles: ["product quality inspector", "machinery assembly coordinator"], why: "shop-floor jobs, not where AI use cases are chosen" }],
  "ai-analyse-data": [{ titles: ["microsystem engineer", "electromagnetic engineer", "microelectronics engineer"], why: "hardware engineering, matched on generic data-analysis software" }],
  "ai-manage-agents": [{ titles: ["waste management supervisor", "gambling manager", "machinery assembly coordinator"], why: "matched on generic delegation and team skills" }],
  "ai-automation-bias": [{ titles: ["social work researcher"], why: "matched on research-method skills, not on overseeing AI output" }],
  "ai-finance-close": [{ titles: ["court administrative officer"], why: "not a finance-close job" }],
  "ai-automate-workflows": [{ titles: ["rental service representative", "vehicle rental agent", "veterinary receptionist", "medical goods specialised seller"], why: "front-desk and sales jobs, not finance or admin back office" }],
  "ai-audit-systems": [{ titles: ["industrial quality manager", "emergency response coordinator", "product quality inspector", "government planning inspector"], why: "inspection of products or plans, not audits of AI systems" }],
  "ai-esg-data": [{ titles: ["aquaculture biologist", "toxicologist", "epidemiologist", "bioinformatics scientist", "transport planner"], why: "lab and field science, not ESG reporting data" }],
  "ai-data-readiness": [{ titles: ["zoo registrar"], why: "record-keeping job matched on generic data skills" }],
  "ai-select-tools": [{ titles: ["supermarket manager"], why: "matched on generic purchasing skills" }],
  "ai-redesign-work": [{ titles: ["venture capitalist"], why: "invests in companies; does not redesign their workflows" }],
  "ai-lead-adoption": [{ titles: ["exhibition curator"], why: "matched on generic leadership skills" }],
  "ai-manage-risk": [{ titles: ["youth centre manager", "machinery, industrial equipment, ships and aircraft distribution manager", "waste and scrap distribution manager", "agricultural machinery and equipment distribution manager", "agricultural raw materials, seeds and animal feeds distribution manager", "beverages distribution manager", "chemical products distribution manager"], why: "matched on generic risk-management skills" }],
  "ai-responsible-use": [{ titles: ["education welfare officer", "pipeline environmental project manager", "social work practice educator"], why: "matched on generic ethics skills" }],
  "ai-build-apps": [{ titles: ["biometrician", "mathematician"], why: "maths research, not building software on AI models" }],
};

export interface AiSource { publisher: string; title: string; url: string; date: string | null }
export interface AiSkill {
  id: string; key: string; label: string; description: string; category: string; categoryLabel: string;
  catalogue: string | null; sources: AiSource[];
  occupations: { id: string; score: number }[]; neighbours: [string, number][];
}
export interface Excluded { skill: string; occupation: string; title: string; score: number; why: string }

interface Loaded { skills: Map<string, AiSkill>; byOcc: Map<string, string[]>; links: Map<string, [string, number][]>; excluded: Excluded[]; note: string; linksMeta: any }
let cache: Loaded | null | undefined;

const seed = (f: string) => path.join(projectRoot, "db", "seed", f);
export const aiNodeId = (key: string) => `ai:${key.replace(/^ai-/, "")}`;
export const isAiNode = (id: string) => id.startsWith("ai:");

export function loadAiSkills(): Loaded | null {
  if (cache !== undefined) return cache;
  const d = loadEsco();
  if (!d || !existsSync(seed("ai_skills.json")) || !existsSync(seed("ai_skills_links.json"))) return (cache = null);
  const file = JSON.parse(readFileSync(seed("ai_skills.json"), "utf8"));
  const linksFile = JSON.parse(readFileSync(seed("ai_skills_links.json"), "utf8"));
  const P = AI_SKILL_PARAMS;
  // Generic hubs: occupations the link script proposed for 4+ AI skills (its own `review` flag), dropped for every skill.
  const hubs = new Set<string>(Object.values<any>(linksFile.links).flatMap(l => l.review || []));
  const skills = new Map<string, AiSkill>(), byOcc = new Map<string, string[]>(), links = new Map<string, [string, number][]>();
  const excluded: Excluded[] = [];
  const addLink = (a: string, b: string, r: number) => { if (!links.has(a)) links.set(a, []); links.get(a)!.push([b, r]); };
  for (const s of file.skills) {
    const L = linksFile.links[s.id];
    if (!L) continue;
    const id = aiNodeId(s.id);
    const wrong = new Map<string, string>();
    for (const x of AI_EXCLUDE[s.id] || []) for (const t of x.titles) wrong.set(t, x.why);
    const occupations: { id: string; score: number }[] = [];
    for (const [occ, score] of L.occupations as [string, number][]) {
      const title = d.occupations[occ]?.title;
      if (!title || score < P.minLinkScore) continue;
      const why = hubs.has(occ) ? "generic hub: the link script proposed it for 4+ AI skills (review flag)" : wrong.get(title);
      if (why) { excluded.push({ skill: id, occupation: occ, title, score, why }); continue; }
      occupations.push({ id: occ, score });
      byOcc.set(occ, [...(byOcc.get(occ) || []), id]);
    }
    const neighbours = (L.neighbours as [string, number][]).filter(([e, c]) => d.skills[e] && c >= P.minNeighbourCos).slice(0, P.neighbours)
      .map(([e, c]) => [e, Math.round(100 * Math.min(1, Math.max(0, (c - 0.5) / 0.5))) / 100] as [string, number]);
    for (const [e, r] of neighbours) { addLink(id, e, r); addLink(e, id, r); }
    skills.set(id, {
      id, key: s.id, label: s.label, description: s.description, category: s.category, categoryLabel: file.categories?.[s.category] ?? s.category,
      catalogue: AI_CATALOGUE[s.id] ?? null,
      sources: (s.sources || []).map((x: any) => ({ publisher: x.publisher, title: x.title, url: x.url, date: x.date ?? null })),
      occupations, neighbours,
    });
  }
  return (cache = { skills, byOcc, links, excluded, note: file._note, linksMeta: linksFile._meta });
}

export const aiSkill = (id: string) => loadAiSkills()?.skills.get(id) ?? null;
/** The AI-era skills attached to an ESCO occupation as emerging requirements (strongest link first). */
export function aiSkillsFor(occId: string): AiSkill[] {
  const L = loadAiSkills();
  if (!L) return [];
  const score = (s: AiSkill) => s.occupations.find(o => o.id === occId)?.score ?? 0;
  return (L.byOcc.get(occId) || []).map(id => L.skills.get(id)!).sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
}
/** An AI skill as shown to people: what it is, why it is not scored for exposure, and its sources. */
export function aiSkillJson(s: AiSkill) {
  return { id: s.id, name: s.label, description: s.description, category: s.categoryLabel, aiEra: true, exposure: null,
    exposureNote: "AI-era skill: grows with AI", catalogue: s.catalogue, sources: s.sources };
}
/** Everything about the AI skills, including the links we dropped and why (GET /ai-skills). */
export function aiSkillsReport() {
  const L = loadAiSkills();
  if (!L) return null;
  const d = loadEsco()!;
  return {
    note: L.note, params: AI_SKILL_PARAMS, linksMethod: L.linksMeta?.occupations ?? null,
    skills: [...L.skills.values()].map(s => ({ ...aiSkillJson(s),
      occupations: s.occupations.map(o => ({ id: o.id, title: d.occupations[o.id].title, score: o.score })),
      neighbours: s.neighbours.map(([id, rel]) => ({ id, title: d.skills[id].title, rel })) })),
    excluded: L.excluded,
  };
}

/** For tests: forget the loaded data. */
export function resetAiSkills() { cache = undefined; }
