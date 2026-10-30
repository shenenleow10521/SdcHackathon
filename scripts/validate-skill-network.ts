// Checks the computed ESCO skill network (scripts/build-skill-network.ts) against the hand-made route graph in
// db/seed/knowledge.json, and writes a report plus a CSV of links for teammates to rate by hand.
//   npx tsx scripts/validate-skill-network.ts [outDir]
// Ranks are measured on an in-memory build with k = 50 (same parameters) so "rank 30" is visible; hits at 10 are
// what the shipped artefact (k = 10) would return.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "../server/lib/db.ts";
import { loadEsco } from "../server/services/esco.ts";
import { buildSkillNetwork, escoNetworkInput, npmi, neighbours, relatedness, loadSkillNetwork, NETWORK_PARAMS, type Neighbour } from "../server/services/skill-network.ts";

const OUT = process.argv[2] || "C:\\Users\\user\\AppData\\Local\\Temp\\claude\\c--Documents-sdc-hack\\f3ca550b-8580-4eed-ad85-a0f58b7b236b\\scratchpad";
mkdirSync(OUT, { recursive: true });
const seed = (f: string) => JSON.parse(readFileSync(path.join(projectRoot, "db", "seed", f), "utf8"));
const esco = loadEsco()!, input = escoNetworkInput()!;
if (!loadSkillNetwork()) throw new Error("run scripts/build-skill-network.ts first");
const kn = seed("knowledge.json"), map = seed("esco_map.json"), personaEsco = seed("persona_esco.json");
const title = (id: string) => esco.skills[id]?.title ?? id;
const lines: string[] = [];
const say = (s = "") => { lines.push(s); console.log(s); };
const r3 = (x: number) => x.toFixed(3);

// Seeded random numbers, so the baseline and the CSV sample are reproducible.
let s0 = 20261030;
const rand = () => ((s0 = (s0 * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];

// ---- 1. Hand-made skills -> ESCO ----------------------------------------------------------------------------
// esco_map.json where it has a concept. Where it says "none", a keyword pick (no bge-m3 query vectors without a
// RunPod key), flagged so a human can judge it; skills with no honest ESCO equivalent stay unmapped.
const FALLBACK: Record<string, string> = {
  three: "39d92981-7b68-47de-bfc0-5374c067dba9", // control trade commercial documentation (invoices, orders, receipts)
  ghg: "c8b4b02c-d9ce-4e24-ab43-5dd52c6dff48",   // advise on carbon emissions reduction (ESCO has no GHG accounting)
};
const cat = new Map<string, { id: string; how: string }>();
for (const s of kn.skills) {
  const m = map.skills[s.id];
  if (m?.uri) cat.set(s.id, { id: m.uri.split("/").pop(), how: `esco_map (${m.match})` });
  else if (FALLBACK[s.id]) cat.set(s.id, { id: FALLBACK[s.id], how: "keyword pick (map says none)" });
}
say("# ESCO skill network: validation report");
say();
say(`Generated ${new Date().toISOString()} by scripts/validate-skill-network.ts. Network params: ${JSON.stringify(NETWORK_PARAMS)}.`);
say(`Artefact: ${loadSkillNetwork()!.meta?.counts?.skillsWithNeighbours} of ${Object.keys(esco.skills).length} ESCO skills have neighbours, ${loadSkillNetwork()!.meta?.counts?.links} links.`);
say();
say("## 1. Hand-made skills mapped to ESCO (please check)");
say();
say("| catalogue skill | ESCO skill | type | how |");
say("|---|---|---|---|");
for (const s of kn.skills) {
  const c = cat.get(s.id);
  say(`| ${s.id}: ${s.label} | ${c ? title(c.id) : "(unmapped: no ESCO equivalent)"} | ${c ? esco.skills[c.id].type : ""} | ${c?.how ?? ""} |`);
}

// ---- 2. Hand-made skill -> skill edges -----------------------------------------------------------------------
const net50 = buildSkillNetwork(input, { k: 50 });
const rankIn = (list: Neighbour[] | undefined, id: string) => { const i = (list || []).findIndex(([b]) => b === id); return i < 0 ? Infinity : i + 1; };
// Single-signal ablations over ALL skills: what each signal alone would rank (no gates, no type rule).
const allIds = Object.keys(esco.skills);
const jobsBySkill = new Map<string, Map<number, number>>();
Object.values<any>(esco.occupations).forEach((o, j) => {
  for (const s of o.optional) { if (!jobsBySkill.has(s)) jobsBySkill.set(s, new Map()); jobsBySkill.get(s)!.set(j, 0.5); }
  for (const s of o.essential) { if (!jobsBySkill.has(s)) jobsBySkill.set(s, new Map()); jobsBySkill.get(s)!.set(j, 1); }
});
const mass = (s: string) => [...(jobsBySkill.get(s)?.values() || [])].reduce((a, b) => a + b, 0);
const N = Object.keys(esco.occupations).length;
const coocScore = (a: string, b: string) => {
  const ja = jobsBySkill.get(a), jb = jobsBySkill.get(b);
  if (!ja || !jb) return -1;
  let ab = 0; for (const [j, w] of ja) if (jb.has(j)) ab += w * jb.get(j)!;
  return ab ? npmi(ab, mass(a), mass(b), N) * ab / (ab + 1) : -1;
};
const ablationRank = (a: string, b: string, f: (x: string, y: string) => number) => {
  const t = f(a, b); let r = 1;
  for (const x of allIds) if (x !== a && x !== b && f(a, x) > t) r++;
  return r;
};
const embRank = (a: string, b: string) => ablationRank(a, b, (x, y) => input.cosine(x, y) ?? -1);
const coRank = (a: string, b: string) => ablationRank(a, b, coocScore);

const skillIds = new Set(kn.skills.map((s: any) => s.id));
const ssEdges = kn.edges.filter((e: any) => skillIds.has(e.to));
const evalRows: { e: any; a: string; b: string; rank: number; rel: number; emb: number; co: number }[] = [];
say();
say(`## 2. The hand-made skill -> skill edges`);
say();
say(`knowledge.json has ${kn.edges.length} edges: ${ssEdges.length} skill -> skill and ${kn.edges.length - ssEdges.length} skill -> job (job edges are not about skill relatedness and are left out).`);
say();
say("Relatedness here is from the k = 50 build, so links beyond the shipped top 10 still show a value.");
say();
say("| edge | ESCO source -> target | rank (network) | relatedness | rank (embedding only) | rank (co-occurrence only) |");
say("|---|---|---|---|---|---|");
const skipped: string[] = [];
for (const e of ssEdges) {
  const a = cat.get(e.from)?.id, b = cat.get(e.to)?.id;
  if (!a || !b) { skipped.push(`${e.from}->${e.to}`); continue; }
  if (a === b) { skipped.push(`${e.from}->${e.to} (same ESCO skill)`); continue; }
  const rel50 = (x: string, y: string) => net50.get(x)?.find(([id]) => id === y)?.[1];
  const row = { e, a, b, rank: rankIn(net50.get(a), b), rel: rel50(a, b) ?? rel50(b, a) ?? 0, emb: embRank(a, b), co: coRank(a, b) };
  evalRows.push(row);
  const fmt = (r: number) => (r === Infinity ? ">50" : String(r));
  say(`| ${e.from} -> ${e.to} | ${title(a)} -> ${title(b)} | ${fmt(row.rank)} | ${r3(row.rel)} | ${row.emb} | ${row.co} |`);
}
say();
say(`Not evaluated (an end is unmapped): ${skipped.join(", ") || "none"}.`);
const hit = (ranks: number[], k: number) => ranks.filter(r => r <= k).length;
const median = (xs: number[]) => { const s = [...xs].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const n = evalRows.length;
const pct = (h: number, of = n) => `${h}/${of} (${Math.round((100 * h) / of)}%)`;
const ranks = evalRows.map(r => r.rank), med = median(ranks);
// Baseline: the same sources with random ESCO targets, 200 draws each.
let bTotal = 0, b10 = 0, b25 = 0;
for (const r of evalRows) for (let t = 0; t < 200; t++) {
  const rk = rankIn(net50.get(r.a), pick(allIds)); bTotal++; if (rk <= 10) b10++; if (rk <= 25) b25++;
}
say();
say("| metric | network | random targets (baseline) | embedding only | co-occurrence only |");
say("|---|---|---|---|---|");
say(`| hit@10 | ${pct(hit(ranks, 10))} | ${(100 * b10 / bTotal).toFixed(2)}% | ${pct(hit(evalRows.map(r => r.emb), 10))} | ${pct(hit(evalRows.map(r => r.co), 10))} |`);
say(`| hit@25 | ${pct(hit(ranks, 25))} | ${(100 * b25 / bTotal).toFixed(2)}% | ${pct(hit(evalRows.map(r => r.emb), 25))} | ${pct(hit(evalRows.map(r => r.co), 25))} |`);
say(`| hit@50 / linked at all | ${pct(hit(ranks, 50))} | | | |`);
say(`| median rank | ${med === Infinity ? ">50" : med} (of ${allIds.length}) | ~${Math.round(allIds.length / 2)} | ${median(evalRows.map(r => r.emb))} | ${median(evalRows.map(r => r.co))} |`);
const knowledgeCross = evalRows.filter(r => esco.skills[r.a].type !== esco.skills[r.b].type).length;
say();
say(`${knowledgeCross} of the ${n} evaluated edges join a knowledge item to a practical skill, which the network never links by design.`);

// ---- 3. Priya ---------------------------------------------------------------------------------------------
const TARGET = map.occupations.esgRole.uri.split("/").pop();
const target = esco.occupations[TARGET];
const have = new Map<string, string>(); // ESCO id -> where it came from
for (const k of Object.keys(kn.persona.level)) { const c = cat.get(k); if (c) have.set(c.id, `catalogue ${k}`); }
for (const s of personaEsco.skills) if (!have.has(s.escoId)) have.set(s.escoId, "CV");
say();
say(`## 3. Priya's route to "ESG & Carbon Reporting Analyst"`);
say();
say(`Target ESCO occupation: **${target.title}** (${TARGET}, ISCO ${target.isco}); esco_map.json maps esgRole to it ("close"). It lists ${target.essential.length} essential skills (${target.essential.filter((s: string) => esco.skills[s].type === "knowledge").length} knowledge items).`);
say(`Hand-made route: Vendor reconciliation -> GHG emissions accounting -> job.`);
say();
say(`She starts with ${have.size} ESCO skills: ${[...have.keys()].map(title).join("; ")}.`);
say();
say("Greedy relatedness-ordered path over the shipped artefact (k = 10): at each step take the target's missing essential skill most related to anything she has or has gained.");
say();
const missing = new Set<string>(target.essential.filter((s: string) => !have.has(s)));
const gained = new Set<string>(have.keys());
say("| step | skill to learn | type | relatedness | reached from |");
say("|---|---|---|---|---|");
for (let step = 1; step <= 8 && missing.size; step++) {
  let best: { s: string; r: number; from: string } | null = null;
  for (const s of missing) for (const g of gained) { const r = relatedness(g, s); if (r > (best?.r ?? 0)) best = { s, r, from: g }; }
  if (!best) { say(`| ${step} | (no remaining essential skill is linked to anything she has) | | | |`); break; }
  say(`| ${step} | ${title(best.s)} | ${esco.skills[best.s].type} | ${r3(best.r)} | ${title(best.from)}${have.has(best.from) ? ` (${have.get(best.from)})` : " (gained)"} |`);
  missing.delete(best.s); gained.add(best.s);
}
const unreachable = [...missing].filter(s => ![...gained].some(g => relatedness(g, s) > 0));
say();
say(`After these steps, ${unreachable.length} of the ${missing.size} remaining essential skills have no link to anything she has or gained (${unreachable.filter(s => esco.skills[s].type === "knowledge").length} of them knowledge items).`);

// Direct links alone rarely reach a job in another field, so also route through stepping-stone skills: the best
// path (highest product of relatedness, links used both ways) from anything she has to each missing essential.
const adj = new Map<string, Neighbour[]>();
for (const [a, list] of loadSkillNetwork()!.byId) for (const [b, r] of list) {
  if (!adj.has(a)) adj.set(a, []); if (!adj.has(b)) adj.set(b, []);
  adj.get(a)!.push([b, r]); adj.get(b)!.push([a, r]);
}
const bestPaths = (from: Set<string>, maxHops = 4) => {
  const best = new Map<string, { p: number; prev: string | null }>();
  for (const s of from) best.set(s, { p: 1, prev: null });
  let frontier = [...from];
  for (let h = 0; h < maxHops; h++) {
    const next = new Set<string>();
    for (const a of frontier) for (const [b, r] of adj.get(a) || []) {
      const p = best.get(a)!.p * r;
      if (p > (best.get(b)?.p ?? 0)) { best.set(b, { p, prev: a }); next.add(b); }
    }
    frontier = [...next];
  }
  return best;
};
say();
say("Multi-hop version (up to 4 links, path strength = product of relatedness): each step adds the target's missing essential skill with the strongest path; the stepping stones on the way count as gained.");
say();
say("| step | skill to learn | type | path strength | path |");
say("|---|---|---|---|---|");
const missing2 = new Set<string>(target.essential.filter((s: string) => !have.has(s)));
const gained2 = new Set<string>(have.keys());
for (let step = 1; step <= 8 && missing2.size; step++) {
  const best = bestPaths(gained2);
  const s = [...missing2].filter(x => best.has(x)).sort((x, y) => best.get(y)!.p - best.get(x)!.p)[0];
  if (!s) { say(`| ${step} | (nothing else reachable within 4 links) | | | |`); break; }
  const path: string[] = [];
  for (let x: string | null = s; x; x = best.get(x)!.prev) path.unshift(x);
  say(`| ${step} | ${title(s)} | ${esco.skills[s].type} | ${r3(best.get(s)!.p)} | ${path.map(title).join(" -> ")} |`);
  path.forEach(x => gained2.add(x)); missing2.delete(s);
}
const reach = bestPaths(new Set(have.keys()));
say();
say(`Within 4 links of her starting skills: ${target.essential.filter((x: string) => reach.has(x)).length} of ${target.essential.length} essential skills of ${target.title} (${target.essential.filter((x: string) => reach.has(x) && esco.skills[x].type === "knowledge").length} knowledge items).`);
const ghgId = FALLBACK.ghg, reconId = cat.get("recon")!.id;
say(`Hand-made edge check: relatedness(${title(reconId)}, ${title(ghgId)}) = ${r3(relatedness(reconId, ghgId))}; bge-m3 cosine ${r3(input.cosine(reconId, ghgId)!)}; co-occurrence NPMI (shrunk) ${r3(coocScore(reconId, ghgId))}.`);
say(`Neighbours of "${title(ghgId)}": ${neighbours(ghgId).map(([b, r]) => `${title(b)} (${r3(r)})`).join("; ")}.`);

// ---- 4. Probes for failure modes --------------------------------------------------------------------------
say();
say("## 4. Probes: generic skills, false friends, knowledge items");
say();
const probe = (id: string) => say(`- **${title(id)}** [${esco.skills[id].type}, in ${jobsBySkill.get(id)?.size ?? 0} jobs]: ${neighbours(id, 6).map(([b, r]) => `${title(b)} (${r3(r)})`).join("; ") || "(no neighbours)"}`);
const byTitle = (t: string) => allIds.find(id => esco.skills[id].title === t)!;
for (const t of ["use spreadsheets software", "communication", "use Microsoft Office", "prompt performers", "principles of artificial intelligence", "utilise machine learning",
  "check accounting records", "generate reconciliation reports", "lead the sustainability reporting process", "advise on carbon emissions reduction", "emission standards", "assess the life cycle of resources"]) {
  const id = byTitle(t); if (id) probe(id);
}
const generic = allIds.filter(id => (jobsBySkill.get(id)?.size ?? 0) >= 300);
const inDegree = new Map<string, number>();
for (const list of loadSkillNetwork()!.byId.values()) for (const [b] of list) inDegree.set(b, (inDegree.get(b) || 0) + 1);
const hubs = [...inDegree.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8);
say();
say(`Hubs (skills in the most neighbour lists): ${hubs.map(([id, c]) => `${title(id)} (${c}, in ${jobsBySkill.get(id)?.size ?? 0} jobs)`).join("; ")}.`);
say(`Generic skills (needed by >= 300 jobs): ${generic.length}; mean neighbour-list appearances ${(generic.reduce((a, id) => a + (inDegree.get(id) || 0), 0) / Math.max(1, generic.length)).toFixed(1)} vs ${(129539 / allIds.length).toFixed(1)} overall.`);
const noLinks = allIds.filter(id => !loadSkillNetwork()!.byId.has(id));
say(`Skills with no neighbours: ${noLinks.length} (${noLinks.filter(id => !jobsBySkill.has(id)).length} are in no ESCO occupation at all, so co-occurrence can't speak for them).`);

// ---- 5. Pairs for the team to rate ------------------------------------------------------------------------
const all: [string, string, number][] = [];
for (const [a, list] of loadSkillNetwork()!.byId) for (const [b, r] of list) all.push([a, b, r]);
const band = (lo: number, hi: number) => all.filter(([, , r]) => r >= lo && r < hi);
const qs = all.map(x => x[2]).sort((x, y) => x - y);
const q = (p: number) => qs[Math.floor(p * (qs.length - 1))];
const sample = [...Array.from({ length: 10 }, () => pick(band(q(0.75), 2))), ...Array.from({ length: 10 }, () => pick(band(q(0.35), q(0.65)))), ...Array.from({ length: 10 }, () => pick(band(0, q(0.2))))]
  .sort(() => rand() - 0.5);
const csv = (s: string) => `"${s.replace(/"/g, '""')}"`;
writeFileSync(path.join(OUT, "skill-pairs-for-team.csv"), ["skillA,skillB,relatedness,related(y/n)", ...sample.map(([a, b, r]) => `${csv(title(a))},${csv(title(b))},${r3(r)},`)].join("\n") + "\n");
say();
say(`## 5. Pairs for the team`);
say();
say(`30 links (10 strong >= ${r3(q(0.75))}, 10 middling, 10 weak < ${r3(q(0.2))}; relatedness quartiles ${r3(q(0.25))} / ${r3(q(0.5))} / ${r3(q(0.75))}) written to ${path.join(OUT, "skill-pairs-for-team.csv")}.`);
say();
for (const [a, b, r] of sample) say(`- ${r3(r)}  ${title(a)} ~ ${title(b)}`);

say();
say("## 6. Verdict");
say();
say(`Hand-made edges: hit@10 ${pct(hit(ranks, 10))}, hit@25 ${pct(hit(ranks, 25))}, against ${(100 * b25 / bTotal).toFixed(2)}% at 25 for random targets. The signal is real (co-occurrence alone ranks the hand-made targets around ${median(evalRows.map(r => r.co))} of ${allIds.length}, random would be ~${Math.round(allIds.length / 2)}), but the network does NOT reproduce the hand-made graph, and isn't meant to:`);
say("- Most hand-made edges are deliberate cross-field transfers (reconciliation -> GHG, spreadsheets -> ESG data). ESCO has no job that needs both ends, so co-occurrence is 0 and the 'both signals' rule drops them. Loosening the gates or adding second-order co-occurrence (tried while building: hit@25 stayed at 3-6 of 28) does not change this; it's the data.");
say(`- ${knowledgeCross} of ${n} evaluated edges join a knowledge item to a practical skill (e.g. -> internal auditing, sustainable finance, statistics), which the type rule forbids.`);
say("- Several mappings are loose (esco_map 'nearest', and the two keyword picks), so some misses are mapping misses.");
say();
say("Failure modes seen:");
say("- **Single-job skills inherit that job's context.** 'generate reconciliation reports' is listed by one ESCO occupation (mining), so its neighbours are mine planning skills. Any skill in 1-2 jobs is at risk; shrinkage softens but does not fix it.");
say("- **Hubs.** Machine-operation and teaching skills ('monitor automated machines', 'apply teaching strategies') sit in ~100 neighbour lists each: big clusters of near-identical ESCO occupations inflate co-occurrence. Truly generic skills (in >= 300 jobs) are well contained by NPMI.");
say("- **False friends are blocked.** 'prompt performers' links only to stage-management skills, never to AI skills; ESCO has no prompting-AI skill, so modern AI skills (prompting, supervising AI) simply have no node.");
say("- **Knowledge items** form their own sub-network; a route can't currently step from a practical skill to a knowledge requirement, and about half of many jobs' essential items are knowledge.");
say("- **Coverage gaps**: 464 ESCO skills are in no occupation and get no neighbours.");
say();
say("**Good enough to drive routes? Yes for within-field and multi-hop routing over all ESCO jobs, no as a drop-in replacement for the curated cross-field bridges.** Within a field the links read well (check accounting records -> explain accounting records / identify accounting errors; lead the sustainability reporting process -> measure company's sustainability performance), and 4-link paths reach nearly every essential skill of sustainability manager from Priya's profile. But Priya's computed route goes through trade risk, supply chain and life-cycle skills; it never uses reconciliation or carbon accounting, which is the story the product tells. Recommendation for phase 2: route on this network, keep the curated bridge edges (mapped to ESCO ids) as an overlay with their own relatedness, and add an explicit knowledge-requirement step (a knowledge item is reachable from the practical skills of the jobs that need it) instead of linking knowledge into the skill graph.");

writeFileSync(path.join(OUT, "skill-network-validation.md"), lines.join("\n") + "\n");
console.log(`\nwrote ${path.join(OUT, "skill-network-validation.md")}`);
