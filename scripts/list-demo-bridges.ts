// Prints the 10 strongest, most explainable PROPOSED cross-field bridges, as candidates for a person to review in the
// admin queue (POST /api/review/bridges/:id/approve). It approves nothing.
//
// A good candidate tells the product's story: a skill AI is changing carries over to a skill Malaysia needs.
//   - discovered by the data (not a team bridge) and still proposed (this reads the built file only; it does not see
//     decisions already made in a database);
//   - concrete evidence: at least two different shared O*NET work activities, and task statements on both sides;
//   - the source skill is one AI does a lot of (our model's exposure >= 0.45) and the target is at least 0.1 less exposed;
//   - the target is specific (essential in at most MAX_TARGET_JOBS ESCO jobs, so not "supervise staff") and Malaysia
//     needs it: essential in jobs from at least one 4-digit group on the Critical Occupations List (MyCOL).
// Ranked by bridge score x (1 + log of the number of distinct MyCOL groups), at most one bridge per source skill and
// per target skill so the list is varied.
//
// Run: npx tsx scripts/list-demo-bridges.ts [count]
import { loadBridges } from "../server/services/bridges.ts";
import { loadEsco } from "../server/services/esco.ts";

const n = Number(process.argv[2]) || 10;
const MIN_FROM_EXPOSURE = 0.45, MIN_EXPOSURE_DROP = 0.1, MAX_TARGET_JOBS = 40;
const d = loadEsco(), L = loadBridges();
if (!d || !L) { console.error("ESCO data or db/seed/esco_bridges.json.gz is missing"); process.exit(1); }

// ESCO skill -> MyCOL-critical occupations that list it as essential, the distinct MyCOL groups, and how many jobs need it
const critical = new Map<string, string[]>(), groups = new Map<string, Set<string>>(), jobs = new Map<string, number>();
for (const o of Object.values<any>(d.occupations)) {
  for (const s of o.essential) jobs.set(s, (jobs.get(s) || 0) + 1);
  if (!o.isco || !d.mycol?.byCode.has(o.isco)) continue;
  for (const s of o.essential) {
    critical.set(s, [...(critical.get(s) || []), o.title]);
    if (!groups.has(s)) groups.set(s, new Set());
    groups.get(s)!.add(o.isco);
  }
}
const exp = (s: string) => d.scores[s]?.[0] ?? null;

const cands = L.bridges
  .filter(b => b.source === "discovered" && b.status === "proposed")
  .filter(b => new Set(b.evidence.sharedActivities).size >= 2 && b.evidence.tasksFrom.length && b.evidence.tasksTo.length)
  .filter(b => (exp(b.from) ?? 0) >= MIN_FROM_EXPOSURE && (exp(b.from) ?? 0) - (exp(b.to) ?? 1) >= MIN_EXPOSURE_DROP && (jobs.get(b.to) || 0) <= MAX_TARGET_JOBS)
  .map(b => ({ b, crit: critical.get(b.to) || [], g: groups.get(b.to)?.size || 0 }))
  .filter(x => x.g > 0)
  .map(x => ({ ...x, rank: x.b.score * (1 + Math.log(x.g)) }))
  .sort((a, b) => b.rank - a.rank || a.b.id - b.b.id);

const usedFrom = new Set<string>(), usedTo = new Set<string>();
const picked: typeof cands = [];
for (const c of cands) {
  if (picked.length >= n) break;
  if (usedFrom.has(c.b.from) || usedTo.has(c.b.to)) continue;
  usedFrom.add(c.b.from); usedTo.add(c.b.to); picked.push(c);
}

console.log(`${cands.length} proposed bridges pass the filters; top ${picked.length} (nothing is approved by this script):\n`);
for (const { b, crit } of picked) {
  console.log(`#${b.id}  ${b.fromTitle}  ->  ${b.toTitle}   (score ${b.score.toFixed(2)})`);
  console.log(`   fields: ${b.families[0]} -> ${b.families[1]};  AI exposure ${exp(b.from)?.toFixed(2)} -> ${exp(b.to)?.toFixed(2)};  target essential in ${crit.length} MyCOL job(s), e.g. ${crit.slice(0, 3).join(", ")}`);
  console.log(`   shared work: ${[...new Set(b.evidence.sharedActivities)].slice(0, 2).join(" | ")}`);
  console.log(`   from jobs: ${b.evidence.occFrom.join(", ")}  |  to jobs: ${b.evidence.occTo.join(", ")}`);
  console.log(`   approve: POST /api/review/bridges/${b.id}/approve\n`);
}
