// Prints the "Practise at work" tasks (server/services/goal.ts practiseFor) for the sample persona's goals and a few
// ESCO jobs, so a person can read them for relevance. Run: npx tsx scripts/practise-report.ts
import { openDb, migrate } from "../server/lib/db.ts";
import { seed } from "../server/lib/seed.ts";
import { loadGraph } from "../server/kb.ts";
import { loadProfile } from "../server/repo.ts";
import { buildJobPlan } from "../server/services/planning.ts";
import { searchOccupations, loadEsco } from "../server/services/esco.ts";
import { practiseFor, goalOnet, PRACTISE, resetGoalCache } from "../server/services/goal.ts";
// PRACTISE overrides for experiments, e.g. PRACTISE='{"escoRank":3}'
if (process.env.PRACTISE) { Object.assign(PRACTISE, JSON.parse(process.env.PRACTISE)); resetGoalCache(); }

const db = await openDb({ memory: true });
await migrate(db); await seed(db);
const g = await loadGraph(db), p = (await loadProfile(db, 1))!, d = loadEsco()!;
const jobs: string[] = ["faRole", "stayRole", "opsRole", "esgRole"];
for (const q of process.argv.slice(2).length ? process.argv.slice(2) : ["nurse responsible for general care", "software developer", "call centre agent", "accountant", "bus driver", "sustainability manager"]) {
  const o = searchOccupations(q, 1)[0];
  if (o) jobs.push(`esco:${o.id}`);
}
let shown = 0, steps = 0;
for (const job of jobs) {
  const plan: any = buildJobPlan(g, p, { job, mode: "closest", year: 2026, scenario: "moderate", now: new Date("2026-10-23"), escoSkills: new Set() });
  const onet = goalOnet(job);
  console.log(`\n## ${plan.title} (${job}; O*NET ${onet ?? "none"} ${onet ? d.onetTasks[onet]?.title ?? "" : ""})`);
  for (const m of plan.missing) {
    const pr = practiseFor(m.id, job);
    steps++; shown += pr.length;
    console.log(`- ${m.name}`);
    for (const x of pr) console.log(`    * ${x.text}  [${x.occupation}]`);
    if (!pr.length) console.log("    (none)");
  }
}
console.log(`\n${shown} tasks over ${steps} steps`);
await db.close();
