// Shared data access for profiles.
import type { Db } from "./lib/db.ts";
import { loadEsco } from "./services/esco.ts";

export interface Profile {
  id: number;
  displayName: string;
  occupationId: string;
  hours: number;
  budgetRm: number | null;
  targetDate: string | null;
  sdgPriority: number | null;
  lang: "en" | "ms";
  employerId: number | null;
  isDemo: boolean;
  /** The person lets their employer's HR view see their goal progress (off unless they turn it on). */
  shareProgress: boolean;
  skills: { skillId: string; level: number; confidence: "cv" | "self" | "verified"; evidence: string | null }[];
  /** skillId -> level, for the engine */
  level: Record<string, number>;
  /** The person's current job as an ESCO occupation (from the CV's job title or the quiz), or null. */
  currentEsco?: { id: string; title: string } | null;
}

const toDate = (v: any) => (v == null ? null : typeof v === "string" ? v.slice(0, 10) : new Date(v).toISOString().slice(0, 10));

export async function loadProfile(db: Db, id: number): Promise<Profile | null> {
  if (!Number.isInteger(id) || id < 1) return null;
  const p = (await db.query("select * from profiles where id=$1", [id])).rows[0] as any;
  if (!p) return null;
  const s = (await db.query("select skill_id, level, confidence, evidence from profile_skills where profile_id=$1 order by skill_id", [id])).rows as any[];
  return {
    id: p.id, displayName: p.display_name, occupationId: p.current_occupation_id, hours: p.hours_per_week,
    budgetRm: p.budget_rm === null ? null : Number(p.budget_rm), targetDate: toDate(p.target_date), sdgPriority: p.sdg_priority,
    lang: p.lang, employerId: p.employer_id, isDemo: p.is_demo, shareProgress: !!p.share_progress,
    skills: s.map(r => ({ skillId: r.skill_id, level: r.level, confidence: r.confidence, evidence: r.evidence })),
    level: Object.fromEntries(s.filter(r => r.level > 0).map(r => [r.skill_id, r.level])),
    currentEsco: escoOccupation(p.current_esco_id),
  };
}

function escoOccupation(id: string | null | undefined) {
  const o = id ? loadEsco()?.occupations[id] : null;
  return o ? { id: id!, title: o.title as string } : null;
}

/** Set skill levels (level 0 removes). A changed level is the user's own rating ('self'); re-saving the same level keeps
 *  its confidence. With confidence 'verified' (a passed check, an advisor's confirmation) the skill is marked verified. */
export async function setSkillLevels(db: Db, profileId: number, skills: { skillId: string; level: number }[], confidence?: "verified") {
  for (const s of skills) {
    if (s.level === 0) await db.query("delete from profile_skills where profile_id=$1 and skill_id=$2", [profileId, s.skillId]);
    else if (confidence) await db.query(`insert into profile_skills(profile_id, skill_id, level, confidence) values ($1,$2,$3,$4)
                            on conflict (profile_id, skill_id) do update set level = excluded.level, confidence = excluded.confidence`, [profileId, s.skillId, s.level, confidence]);
    else await db.query(`insert into profile_skills(profile_id, skill_id, level, confidence) values ($1,$2,$3,'self')
                        on conflict (profile_id, skill_id) do update set confidence = case when profile_skills.level = excluded.level
                          then profile_skills.confidence else 'self' end, level = excluded.level`, [profileId, s.skillId, s.level]);
  }
}

/** Profile in the shape shared/engine.js expects. */
export const engineProfile = (p: Profile) => ({ occupationId: p.occupationId, level: p.level, hours: p.hours });

export async function listProfileIds(db: Db): Promise<number[]> {
  return (await db.query<{ id: number }>("select id from profiles order by id")).rows.map(r => r.id);
}

export async function audit(db: Db, actor: string, action: string, target: string | null, detail?: unknown) {
  await db.query("insert into audit_log(actor, action, target, detail) values ($1,$2,$3,$4)", [actor, action, target, detail === undefined ? null : JSON.stringify(detail)]);
}
