// Prints the key stepping stones (the numbered route steps) for a fixed set of profile -> job cases, so a change to the
// key-step score can be judged by reading real jobs: "does this read like what the job is about?".
// Uses an in-memory database and the seeded sample persona (Priya); a nurse is built the way tests/human-loop.test.ts
// does (every practical essential skill of "nurse responsible for general care" confirmed). It never touches a real DB.
//
// Run: npx tsx scripts/check-key-steps.ts
import { testServices } from "../tests/helpers/services.ts";
import { loadGraph } from "../server/kb.ts";
import { loadProfile } from "../server/repo.ts";
import { buildJobPlan } from "../server/services/planning.ts";
import { loadEsco } from "../server/services/esco.ts";

const CASES: [who: "priya" | "nurse", jobs: string[]][] = [
  ["priya", ["bus driver", "accountant", "software developer", "financial auditor", "sustainability manager", "tax clerk"]],
  ["nurse", ["advanced nurse practitioner", "paramedic in emergency responses", "healthcare assistant"]],
];
const NOW = new Date("2026-10-23T10:00:00Z");

const d = loadEsco()!;
const occ = (title: string) => {
  const id = Object.keys(d.occupations).find(k => d.occupations[k].title.toLowerCase() === title.toLowerCase());
  if (!id) throw new Error(`no ESCO occupation "${title}"`);
  return id;
};

const svc = await testServices();
const g = await loadGraph(svc.db);
const priya = (await loadProfile(svc.db, 1))!;
const nurseJob = occ("nurse responsible for general care");
const nurseSkills = new Set<string>(d.occupations[nurseJob].essential.filter((s: string) => d.skills[s].type !== "knowledge"));
const nurse = { ...priya, level: {} as typeof priya.level };

for (const [who, jobs] of CASES) {
  for (const job of jobs) {
    const profile = who === "priya" ? priya : nurse, escoSkills = who === "priya" ? new Set<string>() : nurseSkills;
    for (const mode of ["closest", "safest"] as const) {
      if (mode === "safest" && who === "nurse") continue;
      const plan: any = buildJobPlan(g, profile, { job: `esco:${occ(job)}`, mode, now: NOW, escoSkills });
      const names = plan.keySkills.map((k: string, i: number) => `${i + 1}. ${plan.missing.find((m: any) => m.id === k)?.name ?? k}`);
      console.log(`${who} -> ${job} [${mode}] (missing ${plan.missing.length}, ${plan.weeks} wk)\n   ${names.join("\n   ")}`);
    }
  }
}
