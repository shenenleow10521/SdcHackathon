// Blind precision check for ESCO suggestions.
//   npx tsx scripts/esco-judge.ts prep  <keyDir>   mixes the system's suggestions with decoys, shuffled, source hidden
//   npx tsx scripts/esco-judge.ts score <keyDir>   reads the judge's verdicts and scores them
// The judge (a separate agent) sees only eval/results/esco-judge/input.json and the CV files, never which items
// came from the system. Decoys measure the judge: random skills should all be rejected, and look-alike skills
// (sharing a word with a suggestion) mostly rejected. The key is kept outside the repo until judging is done.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "../server/lib/db.ts";
import { loadEsco } from "../server/services/esco.ts";

const [cmd, keyDir] = process.argv.slice(2);
if (!["prep", "score"].includes(cmd) || !keyDir) throw new Error("usage: esco-judge.ts prep|score <keyDir outside the repo>");
const OUT = path.join(projectRoot, "eval", "results", "esco-judge");
mkdirSync(OUT, { recursive: true }); mkdirSync(keyDir, { recursive: true });

// Small seeded random generator, so the mix is reproducible.
let seed = 20261023;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const shuffle = <T>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

if (cmd === "prep") {
  const esco = loadEsco()!;
  const allIds = Object.keys(esco.skills);
  const sugg: any[] = JSON.parse(readFileSync(path.join(projectRoot, "eval", "results", "esco-suggestions-full-latest.json"), "utf8"));
  const labels = ["labels.json", "labels-v2.json"].flatMap(f => JSON.parse(readFileSync(path.join(projectRoot, "eval", "cv", f), "utf8")).cases);
  const fileOf = new Map(labels.map((c: any) => [c.id, `eval/cv/${c.file}`]));
  const words = (t: string) => t.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 4);
  const input: any[] = [], key: Record<string, string> = {};
  let k = 0;
  for (const caseId of [...new Set(sugg.map(s => s.caseId))]) {
    const mine = sugg.filter(s => s.caseId === caseId);
    const taken = new Set(mine.map(s => s.escoId));
    const items: { id: string; escoId: string; source: string }[] = mine.map(s => ({ id: "", escoId: s.escoId, source: "system" }));
    const nDecoys = Math.max(2, Math.round(mine.length / 2));
    for (let d = 0; d < nDecoys; d++) {                       // look-alikes: share a word with one of the suggestions
      const w = shuffle(words(mine[d % mine.length]?.title || "manage"))[0] || "manage";
      const pool = allIds.filter(id => !taken.has(id) && esco.skills[id].title.toLowerCase().includes(w));
      if (pool.length) { const id = pool[Math.floor(rand() * pool.length)]; taken.add(id); items.push({ id: "", escoId: id, source: "decoy-lookalike" }); }
    }
    for (let d = 0; d < nDecoys; d++) {                       // random skills from anywhere in ESCO
      const id = allIds[Math.floor(rand() * allIds.length)];
      if (!taken.has(id)) { taken.add(id); items.push({ id: "", escoId: id, source: "decoy-random" }); }
    }
    shuffle(items).forEach(it => { it.id = `k${++k}`; key[it.id] = `${it.source}|${it.escoId}`; });
    input.push({ caseId, cv: fileOf.get(caseId), items: items.map(it => ({ item: it.id, skill: esco.skills[it.escoId].title, description: (esco.skills[it.escoId].description || "").slice(0, 200) })) });
  }
  writeFileSync(path.join(OUT, "input.json"), JSON.stringify({ instructions: "For each item, decide if the CV shows the person has this skill or knowledge (supported) or not.", cases: input }, null, 1) + "\n");
  writeFileSync(path.join(keyDir, "key.json"), JSON.stringify(key) + "\n");
  console.log(`prepared ${input.length} cases, ${Object.keys(key).length} items (${sugg.length} from the system); key in ${keyDir}`);
} else {
  const key: Record<string, string> = JSON.parse(readFileSync(path.join(keyDir, "key.json"), "utf8"));
  const verdicts: Record<string, string> = JSON.parse(readFileSync(path.join(OUT, "output.json"), "utf8")).verdicts;
  const tally: Record<string, { supported: number; total: number }> = {};
  for (const [item, v] of Object.entries(key)) {
    const source = v.split("|")[0];
    const t = (tally[source] ||= { supported: 0, total: 0 });
    t.total++; if (verdicts[item] === "supported") t.supported++;
  }
  const missing = Object.keys(key).filter(i => !(i in verdicts)).length;
  const pct = (a: number, b: number) => (b ? Math.round(1000 * a / b) / 10 : null);
  const result = {
    precision: pct(tally.system?.supported || 0, tally.system?.total || 0), systemItems: tally.system,
    judgeCheck: {
      randomDecoysRejected: pct((tally["decoy-random"]?.total || 0) - (tally["decoy-random"]?.supported || 0), tally["decoy-random"]?.total || 0),
      lookalikeDecoysRejected: pct((tally["decoy-lookalike"]?.total || 0) - (tally["decoy-lookalike"]?.supported || 0), tally["decoy-lookalike"]?.total || 0),
    },
    missingVerdicts: missing, tally,
  };
  copyFileSync(path.join(keyDir, "key.json"), path.join(OUT, "key.json")); // published after judging
  writeFileSync(path.join(OUT, "score.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
}
