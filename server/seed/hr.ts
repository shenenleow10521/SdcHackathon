// Seed for the HR redeployment view. Everything here is SYNTHETIC and labelled "(sample)":
// one fictional employer, six fictional team members and four open roles. No real people or companies.
import type { Db } from "../lib/db.ts";

export const HR_SAMPLE_EMPLOYER = "Sample Shared Services Centre (sample)";

// Varied accounts-payable / finance skill sets and weekly learning hours (levels 1-5).
const TEAM: { name: string; hours: number; skills: Record<string, number> }[] = [
  { name: "Team member A (sample)", hours: 6, skills: { inv: 5, three: 4, pay: 4, erp: 3, recon: 3, excel: 3 } },
  { name: "Team member B (sample)", hours: 8, skills: { inv: 4, three: 4, recon: 5, audit: 3, excel: 4, fin: 2 } },
  { name: "Team member C (sample)", hours: 5, skills: { inv: 3, pay: 3, erp: 5, process: 3, excel: 3 } },
  { name: "Team member D (sample)", hours: 4, skills: { inv: 4, three: 3, tax: 4, audit: 4, dispute: 3 } },
  { name: "Team member E (sample)", hours: 10, skills: { inv: 3, recon: 3, excel: 5, fin: 3, viz: 2 } },
  { name: "Team member F (sample)", hours: 6, skills: { inv: 5, three: 5, pay: 3, dispute: 4, process: 2 } },
];

// Open roles: job id, openings, months until the role must be filled.
const ROLES: { job: string; openings: number; months: number }[] = [
  { job: "stayRole", openings: 2, months: 6 },
  { job: "esgRole", openings: 1, months: 6 },
  { job: "opsRole", openings: 1, months: 6 },
  { job: "faRole", openings: 1, months: 5 },
];

export async function seedHr(t: Db) {
  const e = await t.query<{ id: number }>(
    "insert into employers(name, sector, careers_url, source, verified) values ($1, 'Finance shared services', null, 'sample', false) returning id",
    [HR_SAMPLE_EMPLOYER]);
  const employerId = e.rows[0].id;
  for (const r of ROLES)
    await t.query(
      `insert into open_roles(employer_id, occupation_id, openings, deadline, source)
       values ($1, $2, $3, (current_date + make_interval(months => $4::int))::date, 'sample')`,
      [employerId, r.job, r.openings, r.months]);
  for (const m of TEAM) {
    const p = await t.query<{ id: number }>(
      `insert into profiles(display_name, current_occupation_id, hours_per_week, employer_id, is_demo)
       values ($1, 'ap', $2, $3, false) returning id`, [m.name, m.hours, employerId]);
    for (const [skill, level] of Object.entries(m.skills))
      await t.query("insert into profile_skills(profile_id, skill_id, level, confidence, evidence) values ($1,$2,$3,'self','Synthetic sample team member')",
        [p.rows[0].id, skill, level]);
    const share = SHARING[m.name];
    if (share) await seedProgress(t, p.rows[0].id, m.skills, share);
  }
}

// Goal progress for the HR "Team progress" table: three of the six sample members chose to share it (the other three
// are only counted). Synthetic, like the team. Dates are relative to the day the database is seeded. A tick is stored the
// way the API stores one (server/services/goal.ts setStepDone): the skill is raised to the level the job needs and the
// goal_steps row remembers what it changed, so unticking in the app undoes it. A step's hours are its catalogue course's
// hours when that course is at least 6 h (the plan's rule), else left empty.
type Tick = { skill: string; level: number; daysAgo: number; proof?: { kind: "check" | "advisor"; by: string } };
const SHARING: Record<string, { job: string; setDaysAgo: number; ticks: Tick[]; checkIns: { weeksAgo: number; hours: number }[] }> = {
  "Team member A (sample)": { job: "stayRole", setDaysAgo: 24,   // on track
    ticks: [{ skill: "dispute", level: 3, daysAgo: 6, proof: { kind: "check", by: "HalaTuju skill check" } }],
    checkIns: [{ weeksAgo: 3, hours: 6 }, { weeksAgo: 2, hours: 5 }, { weeksAgo: 1, hours: 7 }, { weeksAgo: 0, hours: 4 }] },
  "Team member B (sample)": { job: "faRole", setDaysAgo: 35,     // behind
    ticks: [{ skill: "fin", level: 3, daysAgo: 10, proof: { kind: "advisor", by: "Puan Aminah (sample advisor)" } }, { skill: "viz", level: 3, daysAgo: 4 }],
    checkIns: [{ weeksAgo: 5, hours: 8 }, { weeksAgo: 3, hours: 4 }, { weeksAgo: 1, hours: 2 }] },
  "Team member E (sample)": { job: "esgRole", setDaysAgo: 13,    // ahead
    ticks: [],
    checkIns: [{ weeksAgo: 2, hours: 12 }, { weeksAgo: 1, hours: 14 }, { weeksAgo: 0, hours: 6 }] },
};

async function seedProgress(t: Db, id: number, skills: Record<string, number>, s: (typeof SHARING)[string]) {
  await t.query("update profiles set share_progress=true where id=$1", [id]);
  await t.query("insert into goals(profile_id, job, mode, set_at) values ($1,$2,'closest', current_date - $3::int)", [id, s.job, s.setDaysAgo]);
  for (const k of s.ticks) {
    const before = skills[k.skill] ?? null, verified = !!k.proof;
    await t.query(`insert into profile_skills(profile_id, skill_id, level, confidence, evidence) values ($1,$2,$3,$4,'Synthetic sample team member')
                   on conflict (profile_id, skill_id) do update set level=excluded.level, confidence=excluded.confidence`,
      [id, k.skill, k.level, verified ? "verified" : "self"]);
    const h = (await t.query<{ hours: number | null }>("select max(hours) as hours from courses where skill_id=$1", [k.skill])).rows[0]?.hours ?? null;
    await t.query(`insert into goal_steps(profile_id, skill_id, done, done_at, hours, raised_skill, level_before, level_set)
                   values ($1,$2,true, now() - make_interval(days => $3::int), $4, $2, $5, $6)`,
      [id, k.skill, k.daysAgo, h != null && h >= 6 ? h : null, before, k.level]);
    if (k.proof) await t.query("insert into skill_proofs(profile_id, skill_id, kind, vouched_by, at) values ($1,$2,$3,$4, now() - make_interval(days => $5::int))",
      [id, k.skill, k.proof.kind, k.proof.by, k.daysAgo]);
  }
  for (const c of s.checkIns)
    await t.query("insert into goal_checkins(profile_id, week_start, hours) values ($1, date_trunc('week', current_date - $2::int * 7)::date, $3)",
      [id, c.weeksAgo, c.hours]);
}
