// Evaluates the discovered bridges (scripts/discover-bridges.ts, server/services/bridges.ts):
//   (a) recall on the team's hand-made skill -> skill routes (knowledge.json) mapped to ESCO, vs random and embedding-only
//   (b) a stratified sample of 40 bridges for teammates to judge (CSV with a blank verdict column)
//   (c) breadth: bridges out of care, customer service, retail, manufacturing QC, teaching and logistics skills
//   (d) Priya's skills (the demo persona): bridges into sustainability, data and audit
//   (e) headline numbers
//   npx tsx scripts/validate-bridges.ts [outDir]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "../server/lib/db.ts";
import { loadBridgeInput, catalogueToEsco } from "./bridge-input.ts";
import { buildContext, checkPair, evidence, activityTitle, confidence, mainField, ISCO_SUBMAJOR, loadBridges, type Bridge } from "../server/services/bridges.ts";

const OUT = process.argv[2] || "C:\\Users\\user\\AppData\\Local\\Temp\\claude\\c--Documents-sdc-hack\\f3ca550b-8580-4eed-ad85-a0f58b7b236b\\scratchpad";
mkdirSync(OUT, { recursive: true });
const lines: string[] = [];
const say = (s = "") => { lines.push(s); console.log(s); };
const r3 = (x: number | null | undefined) => (x === null || x === undefined ? "-" : x.toFixed(3));
let s0 = 20261030;
const rand = () => ((s0 = (s0 * 1103515245 + 12345) % 2147483648) / 2147483648);

const { input, esco } = loadBridgeInput();
const ctx = buildContext(input);
const art = loadBridges();
if (!art) throw new Error("run scripts/discover-bridges.ts build first");
const title = (id: string) => esco.skills[id]?.title ?? id;
const P = ctx.params;
const practical = [...ctx.profiles.keys()];
const allSkills = Object.keys(esco.skills);
const field = (s: string) => { const f = mainField(s, ctx); return f ? `${f} ${ISCO_SUBMAJOR[f]}` : "-"; };

// Score (work similarity x confidence) of a to every practical skill (via the activity inverted index), sorted.
const postings = new Map<string, [string, number][]>();
for (const [s, prof] of ctx.profiles) for (const [d, w] of prof.keys) { if (!postings.has(d)) postings.set(d, []); postings.get(d)!.push([s, w]); }
function workRow(a: string) {
  const dot = new Map<string, number>();
  const pa = ctx.profiles.get(a);
  if (pa) for (const [d, w] of pa.keys) for (const [b, wb] of postings.get(d)!) if (b !== a) dot.set(b, (dot.get(b) || 0) + w * wb);
  const ca = confidence(pa, P);
  return [...dot].map(([b, w]) => [b, w * Math.sqrt(ca * confidence(ctx.profiles.get(b), P))] as [string, number]).sort((x, y) => y[1] - x[1]);
}
/** Rank of b in a's bridge list = position among skills passing every gate, by work similarity (Infinity if absent). */
function bridgeRank(a: string, b: string, row = workRow(a)) {
  let r = 0;
  for (const [x, w] of row) {
    if (checkPair(a, x, ctx).gate !== "ok") continue;
    r++;
    if (x === b) return { rank: r, work: w };
  }
  return { rank: Infinity, work: 0 };
}
const fmtR = (r: number) => (r === Infinity ? "-" : String(r));

say("# Bridges: validation report");
say();
say(`Generated ${new Date().toISOString()} by scripts/validate-bridges.ts. Params: ${JSON.stringify(P)}.`);
const m = art.meta.counts;
say(`Artefact: ${m.discovered} discovered bridges (${m.distinctPairs} distinct skill pairs) out of ${m.sourceSkillsWithBridges} of ${m.practicalSkillsWithProfile} practical ESCO skills with a work profile; ${m.team} team routes (approved).`);
say();

// ---- (a) Recall ---------------------------------------------------------------------------------------------
const { cat, edges } = catalogueToEsco();
say("## (a) Recall on the team's hand-made routes");
say();
say("Rank = position of the target in the source's list. 'bridge rank' = among skills that pass every bridge gate, by score (shipped list = top 5). 'work rank' = among all practical skills by score alone (no gates). 'work sim' = raw work-profile cosine; 'score' = work sim x confidence. 'embedding rank' = among all 13,939 skills by bge-m3 cosine. Gate = the first bridge rule the pair fails (ok = it is a cross-field pair by our definition).");
say();
say("| route | ESCO source -> target | gate | work sim | score | bridge rank | work rank | embedding rank | context | team says |");
say("|---|---|---|---|---|---|---|---|---|---|");
type Row = { e: any; a: string; b: string; gate: string; work: number; bRank: number; wRank: number; eRank: number; ctxv: number };
const rows: Row[] = [];
const skipped: string[] = [];
for (const e of edges) {
  const a = cat.get(e.from)?.id, b = cat.get(e.to)?.id;
  if (!a || !b || a === b) { skipped.push(`${e.from}->${e.to}`); continue; }
  const c = checkPair(a, b, ctx);
  const row = workRow(a);
  const wi = row.findIndex(([x]) => x === b);
  const br = c.gate === "ok" ? bridgeRank(a, b, row).rank : Infinity;
  const cosAB = input.skillCos(a, b) ?? -1;
  let eRank = 1;
  for (const x of allSkills) if (x !== a && x !== b && (input.skillCos(a, x) ?? -1) > cosAB) eRank++;
  const r: Row = { e, a, b, gate: c.gate, work: c.score, bRank: br, wRank: wi < 0 ? Infinity : wi + 1, eRank, ctxv: c.context };
  rows.push(r);
  say(`| ${e.from} -> ${e.to} | ${title(a)} -> ${title(b)} | ${c.gate} | ${r3(c.work)} | ${r3(c.score)} | ${fmtR(br)} | ${fmtR(r.wRank)} | ${eRank} | ${r3(c.context)} | ${e.why} |`);
}
say();
say(`Not evaluated (an end is unmapped or both ends map to one ESCO skill): ${skipped.join(", ") || "none"}.`);
const N = rows.length;
const eligible = rows.filter(r => r.gate === "ok");
const hit = (xs: number[], k: number) => xs.filter(x => x <= k).length;
const pct = (h: number, of: number) => `${h}/${of} (${of ? Math.round((100 * h) / of) : 0}%)`;
const gates = new Map<string, number>();
for (const r of rows) gates.set(r.gate, (gates.get(r.gate) || 0) + 1);
say();
say(`Of ${N} evaluable routes, ${eligible.length} are cross-field pairs by our definition (gate ok). The rest fail a gate on purpose: ${[...gates].filter(([g]) => g !== "ok").map(([g, n]) => `${g} ${n}`).join(", ")} (knowledge = an end is an ESCO knowledge item; cooccur = some ESCO job lists both, i.e. a within-field route the skill network covers; context = same job context; noProfile = no O*NET tasks about the skill).`);
// Random baseline: a random practical skill as target.
const nPract = practical.length;
// Embedding-only bridge list: same gates, ranked by skill cosine instead of work similarity.
function embBridgeRank(a: string, b: string) {
  const cand = practical.filter(x => x !== a).map(x => [x, input.skillCos(a, x) ?? -1] as const).sort((x, y) => y[1] - x[1]);
  let r = 0;
  for (const [x] of cand) { if (checkPair(a, x, ctx).gate !== "ok") continue; r++; if (x === b) return r; if (r > 200) break; }
  return Infinity;
}
const embB = eligible.map(r => embBridgeRank(r.a, r.b));
// Random-in-gated baseline: expected hit rate of a random gated candidate = k / (number of gated candidates of a).
let randHit5 = 0, randHit20 = 0;
for (const r of eligible) {
  let n = 0;
  for (const x of practical) if (x !== r.a && checkPair(r.a, x, ctx).gate === "ok") n++;
  randHit5 += Math.min(1, 5 / n); randHit20 += Math.min(1, 20 / n);
}
say();
say("| metric (routes that are cross-field pairs) | work profile (ours) | embedding only, same gates | random gated candidate |");
say("|---|---|---|---|");
say(`| in shipped top 5 | ${pct(hit(eligible.map(r => r.bRank), 5), eligible.length)} | ${pct(hit(embB, 5), eligible.length)} | ${(randHit5).toFixed(2)} expected |`);
say(`| in top 20 | ${pct(hit(eligible.map(r => r.bRank), 20), eligible.length)} | ${pct(hit(embB, 20), eligible.length)} | ${(randHit20).toFixed(2)} expected |`);
say(`| in top 100 | ${pct(hit(eligible.map(r => r.bRank), 100), eligible.length)} | ${pct(hit(embB, 100), eligible.length)} | |`);
say();
say("| metric (all evaluable routes, no gates) | work-profile similarity | bge-m3 embedding | random target |");
say("|---|---|---|---|");
const med = (xs: number[]) => { const s = [...xs].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
say(`| target in top 20 | ${pct(hit(rows.map(r => r.wRank), 20), N)} | ${pct(hit(rows.map(r => r.eRank), 20), N)} | ${(100 * 20 / nPract).toFixed(2)}% |`);
say(`| target in top 100 | ${pct(hit(rows.map(r => r.wRank), 100), N)} | ${pct(hit(rows.map(r => r.eRank), 100), N)} | ${(100 * 100 / nPract).toFixed(2)}% |`);
say(`| median rank | ${med(rows.map(r => r.wRank))} | ${med(rows.map(r => r.eRank))} | ~${Math.round(nPract / 2)} |`);
say(`| work sim > 0 (share at least one activity) | ${pct(rows.filter(r => r.work > 0).length, N)} | | |`);
// How unusual is the routes' work similarity? Percentile vs random practical pairs.
const randWork: number[] = [];
for (let i = 0; i < 4000; i++) {
  const a = practical[Math.floor(rand() * nPract)], b = practical[Math.floor(rand() * nPract)];
  if (a !== b) randWork.push(checkPair(a, b, ctx).score);
}
randWork.sort((x, y) => x - y);
const pctile = (x: number) => Math.round(100 * randWork.filter(v => v < x).length / randWork.length);
const withProf = rows.filter(r => ctx.profiles.has(r.a) && ctx.profiles.has(r.b));
say(`| median score percentile vs random practical pairs (routes where both ends have a profile, n=${withProf.length}) | ${med(withProf.map(r => pctile(r.work)))}th | | 50th |`);
say(`Random practical pairs: ${Math.round(100 * randWork.filter(v => v > 0).length / randWork.length)}% share any activity; ${Math.round(100 * randWork.filter(v => v >= P.minScore).length / randWork.length)}% reach minScore ${P.minScore}.`);

// ---- (b) Precision sample --------------------------------------------------------------------------------------
const disc = art.bridges.filter(b => b.source === "discovered");
const scores = disc.map(b => b.score).sort((x, y) => x - y);
const q = (p: number) => scores[Math.floor(p * (scores.length - 1))];
const bands = [[q(0), q(0.25)], [q(0.25), q(0.5)], [q(0.5), q(0.75)], [q(0.75), 1.01]];
const sample: (Bridge & { band: number })[] = [];
bands.forEach(([lo, hi], bi) => {
  const pool = disc.filter(b => b.score >= lo && b.score < hi);
  const seen = new Set<string>();
  while (sample.filter(s => s.band === bi).length < 10 && seen.size < pool.length) {
    const b = pool[Math.floor(rand() * pool.length)];
    const k = `${b.from}|${b.to}`;
    if (seen.has(k)) continue;
    seen.add(k);
    // Prefer distinct source skills so the sample isn't one skill's five bridges.
    if (sample.some(s => s.from === b.from)) continue;
    sample.push({ ...b, band: bi });
  }
});
const csvq = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
const csv = ["band,score,from_skill,from_field,to_skill,to_field,shared_activities,task_from,task_to,occupations_from,occupations_to,verdict (right / plausible / wrong),note"];
for (const b of sample) csv.push([["low", "mid-low", "mid-high", "high"][b.band], b.score.toFixed(3), b.fromTitle, b.fields[0] ?? "", b.toTitle, b.fields[1] ?? "",
  b.evidence.sharedActivities.join(" | "), b.evidence.tasksFrom.join(" | "), b.evidence.tasksTo.join(" | "), b.evidence.occFrom.join(" | "), b.evidence.occTo.join(" | "), "", ""].map(csvq).join(","));
writeFileSync(path.join(OUT, "bridges-for-team.csv"), "\ufeff" + csv.join("\n"));
say();
say("## (b) Precision sample");
say();
say(`40 bridges, 10 per score quartile (cut points ${bands.map(([lo]) => lo.toFixed(3)).join(" / ")}), written to ${path.join(OUT, "bridges-for-team.csv")} with a blank verdict column.`);
say();
say("| band | score | from (field) | to (field) | shared activities |");
say("|---|---|---|---|---|");
for (const b of sample) say(`| ${["low", "mid-low", "mid-high", "high"][b.band]} | ${b.score.toFixed(3)} | ${b.fromTitle} (${b.fields[0]}) | ${b.toTitle} (${b.fields[1]}) | ${b.evidence.sharedActivities.join("; ")} |`);

// ---- (c) Breadth ----------------------------------------------------------------------------------------------
const mycol = JSON.parse(readFileSync(path.join(projectRoot, "db", "seed", "mycol.json"), "utf8"));
const critical = new Set<string>(mycol.occupations.map((o: any) => o.masco));
const exposure = (s: string) => esco.scores[s]?.[0] ?? null;
const criticalOcc = (s: string) => [...(ctx.skillOccs.get(s) || [])].filter(([o, w]) => w === 1 && critical.has(String(esco.occupations[o].isco))).map(([o]) => esco.occupations[o].title);
// Typical skills of workers in each domain (ESCO titles), so the examples are about ordinary jobs, not keyword accidents.
const domains: [string, string[]][] = [
  ["care / nursing", ["monitor patient's health condition", "administer medication in emergency", "provide basic support to patients", "assist patients with rehabilitation"]],
  ["customer service / call centre", ["keep records of customer interaction", "answer incoming calls", "handle customer complaints", "provide customer follow-up services"]],
  ["retail / sales", ["check vehicles for sale", "advise customers on building materials", "operate cash register", "guarantee customer satisfaction"]],
  ["manufacturing / quality control", ["check quality of raw materials", "inspect quality of products", "monitor quality standards"]],
  ["teaching", ["assess students", "apply teaching strategies", "prepare lesson content", "conduct background research for plays"]],
  ["logistics", ["plan procedures for cargo operations", "check deliveries on receipt", "implement cost-effective cargo handling strategies on ships", "operate forklift"]],
];
const green = /energy|environment|sustainab|renewable|solar|recycl|waste|carbon|emission|pollut|ecolog|green/i;
const byTitle = new Map(Object.entries<any>(esco.skills).map(([id, s]) => [s.title as string, id]));
say();
say("## (c) Breadth: bridges outside finance");
say();
say("Every shipped bridge out of typical skills of each worker group. Flags: [green] target is environmental/energy/waste work; [MyCOL] target is essential to an ESCO occupation whose ISCO-08 unit group is on Malaysia's Critical Occupations List 2024/25 (MASCO 4-digit = ISCO 4-digit); AI exposure is our model's estimate (lower = less exposed).");
for (const [name, titles] of domains) {
  say();
  say(`### ${name}`);
  for (const t of titles) {
    const id = byTitle.get(t);
    const list = id ? (art.byFrom.get(id) || []).filter(b => b.source === "discovered") : [];
    say(`- **${t}** (${id ? field(id) : "not in ESCO"}, exposure ${id ? r3(exposure(id)) : "-"}): ${list.length ? "" : "no bridges"}`);
    for (const b of list) say(`  - ${b.score.toFixed(2)} -> ${b.toTitle} (${b.fields[1]}; exposure ${r3(exposure(b.to))})${green.test(b.toTitle) ? " [green]" : ""}${criticalOcc(b.to).length ? ` [MyCOL: ${criticalOcc(b.to).slice(0, 2).join(", ")}]` : ""}. Both involve: ${b.evidence.sharedActivities.map(x => `"${x}"`).join("; ")}. Tasks: "${b.evidence.tasksFrom[0] ?? ""}" (${b.evidence.occFrom.join(", ")}) / "${b.evidence.tasksTo[0] ?? ""}" (${b.evidence.occTo.join(", ")})`);
  }
}
say();
say("### Bridges into green work from outside finance (top 15 by score)");
for (const b of disc.filter(b => green.test(b.toTitle) && !green.test(b.fromTitle) && !/^(24|33|41|43|44|12|11)/.test(b.fields[0] || "")).sort((x, y) => y.score - x.score).slice(0, 15))
  say(`- ${b.score.toFixed(2)} ${b.fromTitle} (${b.fields[0]}) -> **${b.toTitle}** (${b.fields[1]}): ${b.evidence.sharedActivities.join("; ")} (to-side jobs: ${b.evidence.occTo.join(", ")})`);

// ---- (d) Priya ----------------------------------------------------------------------------------------------
const personaEsco = JSON.parse(readFileSync(path.join(projectRoot, "db", "seed", "persona_esco.json"), "utf8"));
const priyaCat = Object.keys(catalogueToEsco().kn.persona.level);
const priya = [...new Set<string>([...priyaCat.map(c => cat.get(c)?.id).filter(Boolean) as string[], ...personaEsco.skills.map((s: any) => s.escoId)])];
say();
say("## (d) Priya (AP clerk) -> sustainability, data, audit");
say();
say(`Her ESCO skills (${priya.length}): ${priya.map(title).join("; ")}.`);
const target = /sustainab|carbon|emission|environment|ESG|green|climate|energy|data|statistic|audit|complian|report/i;
say();
say("Discovered bridges out of her skills (all, shipped top 5 per skill); * = target matches sustainability / data / audit / reporting:");
say();
for (const s of priya) {
  const list = art.byFrom.get(s) || [];
  if (!list.length) { say(`- ${title(s)}: no bridges (${ctx.profiles.has(s) ? "no target passes the gates" : esco.skills[s].type === "knowledge" ? "knowledge item" : "no work profile"})`); continue; }
  say(`- ${title(s)} (${field(s)}): ${list.map(b => `${target.test(b.toTitle) ? "*" : ""}${b.toTitle}${b.source === "team" ? " [team]" : ""} (${b.score.toFixed(2)}, ${b.fields[1]})`).join("; ")}`);
}
// Deeper: her best targets in the sustainability family among ALL gated candidates (not just the shipped top 5).
say();
say("Best sustainability / carbon / ESG targets among all gated candidates (beyond the shipped top 5):");
const sus = /sustainab|carbon|emission|environmental|ESG|climate|greenhouse|energy/i;
const deep: { a: string; b: string; w: number; rank: number }[] = [];
for (const a of priya) {
  if (!ctx.profiles.has(a)) continue;
  let r = 0;
  for (const [x, w] of workRow(a)) {
    if (w < 0.15) break;
    if (checkPair(a, x, ctx).gate !== "ok") continue;
    r++;
    if (sus.test(title(x))) deep.push({ a, b: x, w, rank: r });
  }
}
deep.sort((x, y) => y.w - x.w);
for (const d of deep.slice(0, 8)) {
  const ev = evidence(d.a, d.b, ctx);
  say(`- ${title(d.a)} -> **${title(d.b)}** (work ${d.w.toFixed(3)}, rank ${d.rank} in its list): both involve ${ev.keys.map(x => `"${activityTitle(x, input)}"`).join("; ")}; e.g. "${input.tasks[ev.tasksFrom[0]]?.text}" / "${input.tasks[ev.tasksTo[0]]?.text}"`);
}
const reconGhg = rows.find(r => r.e.from === "recon" && r.e.to === "ghg");
if (reconGhg) say(`\nHand-made "Vendor reconciliation -> GHG emissions accounting" (check accounting records -> advise on carbon emissions reduction): gate ${reconGhg.gate}, work sim ${r3(reconGhg.work)}, bridge rank ${fmtR(reconGhg.bRank)}, context ${r3(reconGhg.ctxv)}.`);

// ---- Hubs and coverage ----------------------------------------------------------------------------------------
const inDeg = new Map<string, number>();
for (const b of disc) inDeg.set(b.to, (inDeg.get(b.to) || 0) + 1);
const hubs = [...inDeg].sort((x, y) => y[1] - x[1]).slice(0, 10);
say();
say("## Hubs and coverage");
say();
say(`Targets that appear most often: ${hubs.map(([s, n]) => `${title(s)} (${n})`).join("; ")}.`);
say(`Distinct targets: ${inDeg.size}. Practical skills with no work profile: ${allSkills.filter(s => esco.skills[s].type !== "knowledge" && !ctx.profiles.has(s)).length} of ${allSkills.filter(s => esco.skills[s].type !== "knowledge").length}.`);
const fieldPairs = new Map<string, number>();
for (const b of disc) { const k = `${b.fields[0]} -> ${b.fields[1]}`; fieldPairs.set(k, (fieldPairs.get(k) || 0) + 1); }
say(`Same main ISCO sub-major group on both sides: ${disc.filter(b => b.fields[0] === b.fields[1]).length} of ${disc.length} (they still never share a job and have different job contexts).`);
say(`Most common field crossings: ${[...fieldPairs].filter(([k]) => k.split(" -> ")[0] !== k.split(" -> ")[1]).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, n]) => `${k} (${n})`).join("; ")}.`);

// ---- (e) Headline ---------------------------------------------------------------------------------------------
say();
say("## (e) Headline numbers");
say();
say(`- ${m.distinctPairs.toLocaleString()} cross-field skill pairs proposed (${m.discovered.toLocaleString()} directed bridges, up to ${P.perSkill} per skill) for ${m.sourceSkillsWithBridges.toLocaleString()} ESCO skills, each with the O*NET work activities and task statements behind it; all "proposed" until a person approves.`);
say(`- Every bridge joins two different fields: ${m.fieldFamiliesTouched} of 12 field families are connected, in ${m.fieldFamilyPairs} family pairs (${m.iscoSubMajorGroupsTouched} of 43 ISCO-08 sub-major groups).`);
say(`- Recall on the team's hand-checked routes that are cross-field pairs: ${pct(hit(eligible.map(r => r.bRank), 5), eligible.length)} in the shipped top 5, ${pct(hit(eligible.map(r => r.bRank), 20), eligible.length)} in the top 20 (embedding only: ${pct(hit(embB, 5), eligible.length)} / ${pct(hit(embB, 20), eligible.length)}).`);
writeFileSync(path.join(OUT, "bridges-validation.md"), lines.join("\n") + "\n");
console.log(`\nwrote ${path.join(OUT, "bridges-validation.md")}`);

