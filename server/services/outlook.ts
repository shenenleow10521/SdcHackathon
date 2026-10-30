// Skill outlook (the My skills tab) and the "Stay AI-ready in your job" track, for any profile, from data we hold:
//
//   Risk       our exposure model's score for each of your ESCO skills ("AI can do 62% of this work"), banded into
//              at risk / changing / holding up by OUTLOOK. Knowledge items (nouns) are left out: the model was trained on
//              task statements and is weakest on them.
//   Your job   the core tasks of your own job (the O*NET occupation linked to your ESCO job), as rated by people in the
//              "GPTs are GPTs" study: tasks AI can do (alone or with tools) and tasks still yours. We show them for the
//              job, not per skill: matching single skills to task statements by words proved too loose to trust.
//   Learn      for a skill at risk or changing: an AI-era skill linked to it (db/seed/ai_skills_links.json neighbours,
//              each with published sources: this is how the skill changes with AI), else the most related skill in the
//              ESCO skill network that AI can do clearly less of (OUTLOOK.saferGain) and that your job or one of its
//              closest jobs asks for, so the advice stays within your field. A real course only where the catalogue
//              has one for that skill.
//   Stay       the AI-era skills linked to your job (aiSkillsFor), or, for computer-based jobs with none linked
//              (O*NET GPTs-are-GPTs beta >= OUTLOOK.generalBeta), the general ones; plus the "learn" skill for each of
//              your skills at risk. Hours use the ESCO plan's estimate formula and are always flagged estimated.
import { loadEsco, escoCoverage, currentEscoFor } from "./esco.ts";
import { loadAiSkills, aiSkillsFor } from "./ai-skills.ts";
import { neighbours } from "./skill-network.ts";
import { ESCO_PLAN } from "./esco-plan.ts";
import { nextJobs } from "./esco-network.ts";

export const OUTLOOK = {
  // Our model is coarse for single skills (a nurse's "apply first response" scores 0.69, "provide first aid" 0.09), so
  // "at risk" needs a high score: the same bar the ESCO plan uses before it steers anyone away from a skill.
  atRisk: 0.7,        // model score at or above this: "at risk" (about the top 5% of ESCO skills)
  changing: 0.35,     // ... at or above this: "changing" (about the top third)
  saferGain: 0.15,    // a "shift towards" skill must score at least this much lower than the skill it replaces
  minRel: 0.4,        // ... and be at least this related to it in the skill network
  minAiRel: 0.2,      // an AI-era skill must be at least this related to the skill (links file, rescaled cosine)
  generalBeta: 0.3,   // computer-based job: O*NET GPTs-are-GPTs beta at or above this
  general: ["ai-literacy", "ai-check-output", "ai-draft-summarise"],
  stayMax: 5,         // items in the stay track
  jobTasks: 3,        // core tasks shown per side for your job
  nearJobs: 5,        // "shift towards" skills come from your job and its closest jobs (ESCO skill overlap)
};

type Band = "risk" | "changing" | "safe";
const band = (e: number): Band => (e >= OUTLOOK.atRisk ? "risk" : e >= OUTLOOK.changing ? "changing" : "safe");
const r2 = (x: number) => Math.round(100 * x) / 100;

// ---------- estimates ----------
let idfCache: Map<string, number> | null = null;
function idf(sid: string) {
  if (!idfCache) {
    const d = loadEsco()!, occ = Object.values<any>(d.occupations), df = new Map<string, number>();
    for (const o of occ) for (const s of new Set<string>([...o.essential, ...o.optional])) df.set(s, (df.get(s) || 0) + 1);
    idfCache = new Map([...df].map(([s, n]) => [s, Math.log(occ.length / n) / Math.log(occ.length)]));
  }
  return idfCache.get(sid) ?? 1;
}
/** Hours to learn a skill that is `rel` related to one you have: the ESCO plan's estimate formula. */
const hoursFor = (rel: number, idfValue: number) => {
  const P = ESCO_PLAN;
  return Math.round((P.skillHoursMin + P.skillHoursSpan * (1 - Math.max(0, Math.min(1, rel)))) * (P.commonFloor + (1 - P.commonFloor) * idfValue));
};

export interface OutlookInput {
  level: Record<string, number>;         // catalogue skills you have
  confirmed: Set<string>;                // ESCO skills you confirmed
  currentEscoId?: string | null;         // your job today (ESCO), if known
  jobTitle?: string | null;              // else your job title, to find it
  courses?: Record<string, any[]>;       // catalogue courses by catalogue skill id
}

export function skillOutlook(inp: OutlookInput) {
  const d = loadEsco();
  if (!d) return null;
  const L = loadAiSkills();
  const cov = escoCoverage(inp.level, inp.confirmed);
  // your ESCO skills: confirmed ones, plus those your catalogue skills stand for
  const mine = new Set<string>([...inp.confirmed].filter(s => d.skills[s]));
  for (const [esco] of d.catalogueByEsco) if (cov(esco).basis === "have") mine.add(esco);

  const jobId = inp.currentEscoId && d.occupations[inp.currentEscoId] ? inp.currentEscoId : currentEscoFor(inp.jobTitle, mine)?.id ?? null;
  const link = jobId ? d.onetLinks[jobId] : null, ot = link ? d.onetTasks[link.onet] : null;
  // skills that staying in your job can lead to: those your job and its closest jobs ask for
  const nearJobIds = jobId ? [jobId, ...(nextJobs(jobId, OUTLOOK.nearJobs)?.jobs || []).map(j => j.id)] : [];
  const inField = new Set<string>(nearJobIds.flatMap(j => [...d.occupations[j].essential, ...d.occupations[j].optional]));

  const courseOf = (catIds: string[]) => { for (const c of catIds) { const co = inp.courses?.[c]?.[0]; if (co) return { title: co.title, url: co.url ?? null, provider: co.provider ?? null, hours: co.hours ?? null }; } return null; };
  const aiFor = (sid: string) => (L?.links.get(sid) || []).filter(([id, rel]) => id.startsWith("ai:") && rel >= OUTLOOK.minAiRel).sort((a, b) => b[1] - a[1]);
  const aiItem = (id: string, rel: number, why: string) => {
    const s = L!.skills.get(id)!;
    return { id, name: s.label, kind: "ai" as const, why, sources: s.sources, hours: hoursFor(rel, ESCO_PLAN.aiIdf), estimated: true, course: s.catalogue ? courseOf([s.catalogue]) : null };
  };

  const skills = [...mine].filter(s => d.skills[s].type !== "knowledge" && typeof d.scores[s]?.[0] === "number").map(sid => {
    const s = d.skills[sid], e = d.scores[sid][0], b = band(e);
    let learn: any = null;
    if (b !== "safe") {
      const a = aiFor(sid)[0];
      if (a) learn = aiItem(a[0], a[1], "grows");
      else {
        const n = neighbours(sid, 25).find(([nid, rel]) => !mine.has(nid) && inField.has(nid) && d.skills[nid] && d.skills[nid].type !== "knowledge" && rel >= OUTLOOK.minRel
          && typeof d.scores[nid]?.[0] === "number" && d.scores[nid][0] <= e - OUTLOOK.saferGain);
        if (n) { const [nid, rel] = n; learn = { id: nid, name: d.skills[nid].title, kind: "skill" as const, why: "safer", exposure: r2(d.scores[nid][0]), hours: hoursFor(rel, idf(nid)), estimated: true, course: courseOf(d.catalogueByEsco.get(nid) || []) }; }
      }
    }
    return { id: sid, title: s.title, exposure: r2(e), band: b, catalogue: d.catalogueByEsco.get(sid) || [], learn };
  }).sort((a, b) => b.exposure - a.exposure || a.title.localeCompare(b.title));

  // Stay AI-ready: AI skills that fit your job (or general ones for a computer-based job), then what replaces each skill at risk
  const items: any[] = [];
  const fit = jobId ? aiSkillsFor(jobId) : [];
  const general = !fit.length && (link?.gptsBeta ?? 0) >= OUTLOOK.generalBeta ? OUTLOOK.general.map(k => L?.skills.get("ai:" + k.replace(/^ai-/, ""))).filter(Boolean) as any[] : [];
  for (const s of [...fit, ...general].slice(0, 3)) {
    const rel = Math.max(0, ...[...mine].map(m => (L?.links.get(m) || []).find(([id]) => id === s.id)?.[1] ?? 0));
    items.push(aiItem(s.id, rel, fit.length ? "job" : "general"));
  }
  for (const sk of skills.filter(x => x.band === "risk" && x.learn)) {
    if (items.length >= OUTLOOK.stayMax) break;
    if (!items.some(x => x.id === sk.learn.id)) items.push({ ...sk.learn, replaces: sk.title, replacesExposure: sk.exposure });
  }
  // your job, task by task: the core tasks people rated as ones AI can do (alone or with tools) and as still yours
  const tasks = (ot?.tasks || []).map(([text, rating, core]) => ({ text, rating, core: core === 1 }));
  const core = tasks.filter(t => t.core);
  const jobTasks = { ai: core.filter(t => t.rating !== 0).slice(0, OUTLOOK.jobTasks).map(t => t.text), yours: core.filter(t => t.rating === 0).slice(0, OUTLOOK.jobTasks).map(t => t.text),
    share: tasks.length ? Math.round(100 * tasks.filter(t => t.rating !== 0).length / tasks.length) : null };
  return {
    job: jobId ? { id: jobId, title: d.occupations[jobId].title, onet: link ? { code: link.onet, title: link.title } : null, tasks: jobTasks } : null,
    counts: { skills: skills.length, risk: skills.filter(x => x.band === "risk").length, changing: skills.filter(x => x.band === "changing").length, safe: skills.filter(x => x.band === "safe").length },
    skills,
    stay: { items, hours: items.reduce((s, x) => s + x.hours, 0), estimated: true },
    method: "Risk: our exposure model's score per ESCO skill (at risk >= 0.6, changing >= 0.35). Your job: the linked O*NET occupation's core tasks with GPTs-are-GPTs human ratings. Learn: a linked AI-era skill with sources, else the most related skill in your field that AI can do clearly less of. Hours: the ESCO plan's estimate formula.",
  };
}

/** For tests: forget the computed idf. */
export function resetOutlook() { idfCache = null; }
