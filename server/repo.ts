// Shared data access for profiles.
import type { Db } from "./lib/db.ts";

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
  skills: { skillId: string; level: number; confidence: "cv" | "self" | "verified"; evidence: string | null }[];
  /** skillId -> level, for the engine */
  level: Record<string, number>;
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
    lang: p.lang, employerId: p.employer_id, isDemo: p.is_demo,
    skills: s.map(r => ({ skillId: r.skill_id, level: r.level, confidence: r.confidence, evidence: r.evidence })),
    level: Object.fromEntries(s.filter(r => r.level > 0).map(r => [r.skill_id, r.level])),
  };
}

/** Profile in the shape shared/engine.js expects. */
export const engineProfile = (p: Profile) => ({ occupationId: p.occupationId, level: p.level, hours: p.hours });

export async function listProfileIds(db: Db): Promise<number[]> {
  return (await db.query<{ id: number }>("select id from profiles order by id")).rows.map(r => r.id);
}

export async function audit(db: Db, actor: string, action: string, target: string | null, detail?: unknown) {
  await db.query("insert into audit_log(actor, action, target, detail) values ($1,$2,$3,$4)", [actor, action, target, detail === undefined ? null : JSON.stringify(detail)]);
}
