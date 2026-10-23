// Matching CV phrases to skills and job titles to occupations (OWNER: intake agent).
// Semantic matching: embed the phrase, compare with each skill's vector (cosine), keep the top 5.
// Skill vectors are only used if they were made by the SAME model as the phrase vectors (skills.embedding_model);
// otherwise they are recomputed with the active model and stored. If embeddings are unavailable, we fall back to
// keyword/alias overlap and report matching: 'basic'.
import type { Services } from "../context.ts";
import type { Db } from "../lib/db.ts";
import { cosine } from "../lib/embed.ts";

export interface SkillInfo { id: string; label: string; aliases: string[]; description: string | null; tasks: string[] }
export interface Candidate { skillId: string; label: string; score: number }
export interface PhraseCandidates { phrase: string; candidates: Candidate[] }
export interface MatchResult { matching: "semantic" | "basic"; phrases: PhraseCandidates[]; embedError?: string }

const TOP_K = 5;

export async function loadSkillCatalog(db: Db): Promise<SkillInfo[]> {
  const [skills, aliases, tasks] = await Promise.all([
    db.query("select id, label, description from skills order by id"),
    db.query("select skill_id, alias from skill_aliases order by alias"),
    db.query("select skill_id, text from tasks order by id"),
  ]);
  const byId = new Map<string, SkillInfo>();
  for (const s of skills.rows as any[]) {
    // A label like "ERP operation (SAP)" also gives the aliases "ERP operation" and "SAP".
    const paren = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(s.label);
    byId.set(s.id, { id: s.id, label: s.label, description: s.description, tasks: [], aliases: paren ? [paren[1], paren[2]] : [] });
  }
  for (const a of aliases.rows as any[]) byId.get(a.skill_id)?.aliases.push(a.alias);
  for (const t of tasks.rows as any[]) byId.get(t.skill_id)?.tasks.push(t.text);
  return [...byId.values()];
}

/** The text we embed for a skill: label, aliases, description and its tasks. */
export function skillText(s: SkillInfo): string {
  return [s.label, s.aliases.length ? `Also called: ${s.aliases.join(", ")}.` : "", s.description || "", s.tasks.length ? `Tasks: ${s.tasks.join("; ")}.` : ""]
    .filter(Boolean).join(" ");
}

/** Skill vectors for the active embedding model; (re)computes and stores any that are missing or from another model. */
export async function ensureSkillVectors(svc: Services, skills: SkillInfo[]): Promise<Map<string, number[]>> {
  const model = svc.embed.model;
  const rows = (await svc.db.query("select id, embedding, embedding_model from skills")).rows as any[];
  const out = new Map<string, number[]>();
  for (const r of rows)
    if (r.embedding && r.embedding_model === model) out.set(r.id, typeof r.embedding === "string" ? JSON.parse(r.embedding) : r.embedding);
  const stale = skills.filter(s => !out.has(s.id));
  if (stale.length) {
    const vecs = await svc.embed.embed(stale.map(skillText));
    for (let i = 0; i < stale.length; i++) {
      out.set(stale[i].id, vecs[i]);
      await svc.db.query("update skills set embedding=$2, embedding_model=$3 where id=$1", [stale[i].id, JSON.stringify(vecs[i]), model]);
    }
  }
  return out;
}

/** Top-5 skill candidates for each phrase. Semantic when embeddings work, otherwise keyword overlap ('basic'). */
export async function candidates(svc: Services, phrases: string[], skills?: SkillInfo[]): Promise<MatchResult> {
  const catalog = skills || (await loadSkillCatalog(svc.db));
  const label = new Map(catalog.map(s => [s.id, s.label]));
  if (svc.embed.provider !== "none" && phrases.length) {
    try {
      const skillVecs = await ensureSkillVectors(svc, catalog);
      const phraseVecs = await svc.embed.embed(phrases);
      return {
        matching: "semantic",
        phrases: phrases.map((phrase, i) => ({
          phrase,
          candidates: [...skillVecs.entries()]
            .map(([id, v]) => ({ skillId: id, label: label.get(id) || id, score: round3(cosine(phraseVecs[i], v)) }))
            .filter(c => label.has(c.skillId))
            .sort((a, b) => b.score - a.score).slice(0, TOP_K),
        })),
      };
    } catch (e: any) {
      return { matching: "basic", phrases: phrases.map(p => ({ phrase: p, candidates: basicCandidates(catalog, p) })), embedError: e?.message || String(e) };
    }
  }
  return { matching: "basic", phrases: phrases.map(p => ({ phrase: p, candidates: basicCandidates(catalog, p) })) };
}

// ---------- basic (keyword) matching ----------

const STOP = new Set(("a an the and or of to in on for with by from at as is are was were be been this that these those it its " +
  "i we you my our your their about into over per via using use used across also all any each every some more most other " +
  "month monthly week weekly daily year years day days etc including include such new").split(" "));

/** Lower-case content words, lightly stemmed (invoices -> invoice, matching -> match). */
export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter(w => !STOP.has(w) && (w.length > 1 || /\d/.test(w)))
    .map(w => w.replace(/(?<=\w{3})(?:ies)$/, "y").replace(/(?<=\w{4})(?:ing|ed|es|s)$/, ""));
}
// Two words match if equal, or if both are long and share their first 6 letters (reconcile ~ reconciliation).
const sameWord = (a: string, b: string) => a === b || (a.length >= 6 && b.length >= 6 && a.slice(0, 6) === b.slice(0, 6));
const norm = (t: string) => ` ${tokens(t).join(" ")} `;

/** Keyword score of a skill for a phrase: label/alias contained (+3), share of label words present (x2), task words (+0.5 each, max 1.5). */
export function basicScore(s: SkillInfo, phrase: string): number {
  const pw = tokens(phrase), np = ` ${pw.join(" ")} `;
  let score = 0;
  if ([s.label, ...s.aliases].some(n => { const nn = norm(n); return nn.trim() && np.includes(nn); })) score += 3;
  const lw = [...new Set(tokens(s.label))];
  if (lw.length) score += 2 * lw.filter(w => pw.some(p => sameWord(p, w))).length / lw.length;
  const tw = [...new Set(s.tasks.flatMap(tokens))].filter(w => !lw.includes(w));
  score += Math.min(1.5, 0.5 * tw.filter(w => pw.some(p => sameWord(p, w))).length);
  return round3(score);
}

export function basicCandidates(skills: SkillInfo[], phrase: string): Candidate[] {
  return skills.map(s => ({ skillId: s.id, label: s.label, score: basicScore(s, phrase) }))
    .filter(c => c.score > 0).sort((a, b) => b.score - a.score).slice(0, TOP_K);
}

/** Score at which a basic match is accepted without an AI model to confirm it. */
export const BASIC_ACCEPT = 1;

// ---------- occupations ----------

export interface OccupationMatch { id: string; title: string; confidence: "high" | "medium" | "low"; score: number }

export async function loadOccupations(db: Db): Promise<{ id: string; title: string; isDestination: boolean }[]> {
  return (await db.query(`select id, title, is_destination as "isDestination" from occupations order by id`)).rows as any[];
}

/** Best occupation for a job title by keyword overlap (at least half the occupation's title words), else 'other'. */
export async function matchOccupation(svc: Services, title: string, occs?: { id: string; title: string }[]): Promise<OccupationMatch> {
  const list = (occs || (await loadOccupations(svc.db))).filter(o => o.id !== "other");
  const other = { id: "other", title: "Other job (not in our catalogue yet)" };
  const tw = tokens(title);
  if (!tw.length) return { ...other, confidence: "low", score: 0 };
  let best = { id: "other", title: other.title, score: 0 };
  for (const o of list) {
    const ow = [...new Set(tokens(o.title))];
    const s = ow.length ? ow.filter(w => tw.some(t => sameWord(t, w))).length / ow.length : 0;
    if (s > best.score) best = { id: o.id, title: o.title, score: round3(s) };
  }
  if (best.score >= 0.5) return { ...best, confidence: best.score === 1 ? "high" : "medium" };
  // No embedding fallback here on purpose: without a calibrated threshold it would pick *some* job for any title.
  // An honest "Other job" is better; the AI model (when available) chooses from the full list instead.
  return { ...other, confidence: "low", score: 0 };
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
