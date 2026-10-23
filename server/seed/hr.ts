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
  }
}
