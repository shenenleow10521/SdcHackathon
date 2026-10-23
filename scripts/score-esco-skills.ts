// Score every ESCO skill with the self-trained exposure model, and link it to its nearest catalogue skill.
//   npx tsx --env-file=.env scripts/score-esco-skills.ts      (needs EMBED_PROVIDER=runpod or local: bge-m3)
// Reads db/seed/esco_full.json.gz, writes db/seed/esco_skill_scores.json.gz:
//   scores[escoSkillId] = [modelExposure, nearestCatalogueSkillId, cosine]
// Text embedded per skill: its ESCO title (a short verb phrase, the closest thing ESCO has to the task statements the
// model was trained on). Also reports how well the model's scores, averaged over each occupation's essential skills,
// agree with ILO WP140's exposure for that occupation's ISCO group (an independent source the model never saw).
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import path from "node:path";
import { createEmbedder } from "../server/lib/embedder.ts";
import { cosine } from "../server/lib/embed.ts";
import { loadExposureModel, scoreVector } from "../server/services/exposure.ts";
import { projectRoot } from "../server/lib/db.ts";

const seed = (f: string) => path.join(projectRoot, "db", "seed", f);
const esco = JSON.parse(gunzipSync(readFileSync(seed("esco_full.json.gz"))).toString("utf8"));
const K = JSON.parse(readFileSync(seed("knowledge.json"), "utf8"));
const m = loadExposureModel();
if (!m) throw new Error("No trained exposure model (ml/artifacts/exposure_model.json)");
const embed = createEmbedder(process.env);
if (embed.model !== m.model.embeddingModel) throw new Error(`Need ${m.model.embeddingModel} embeddings; active provider is ${embed.provider} (${embed.model})`);

const ids = Object.keys(esco.skills);
const t0 = Date.now();
const cat = K.skills.map((s: any) => s.id as string);
const catVec = await embed.embed(K.skills.map((s: any) => s.label));
const scores: Record<string, [number, string, number]> = {};
const STEP = 500;
for (let i = 0; i < ids.length; i += STEP) {
  const part = ids.slice(i, i + STEP);
  const vecs = await embed.embed(part.map(id => esco.skills[id].title));
  part.forEach((id, j) => {
    let best = 0, bestCos = -1;
    catVec.forEach((cv: number[], k: number) => { const c = cosine(vecs[j], cv); if (c > bestCos) { bestCos = c; best = k; } });
    scores[id] = [scoreVector(m.model, vecs[j]), cat[best], Math.round(bestCos * 1000) / 1000];
  });
  process.stderr.write(`\r  ${Math.min(i + STEP, ids.length)}/${ids.length}`);
}
process.stderr.write("\n");

// Independent check: occupation mean of essential-skill scores vs ILO WP140 group mean.
const pairs: [number, number][] = [];
for (const o of Object.values<any>(esco.occupations)) {
  if (!o.ilo || !o.essential.length) continue;
  const xs = o.essential.map((s: string) => scores[s]?.[0]).filter((x: any) => typeof x === "number");
  if (xs.length) pairs.push([xs.reduce((a: number, b: number) => a + b, 0) / xs.length, o.ilo.mean]);
}
const pearson = (p: [number, number][]) => {
  const n = p.length, mx = p.reduce((s, x) => s + x[0], 0) / n, my = p.reduce((s, x) => s + x[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of p) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
};
const rank = (v: number[]) => { const o = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = new Array(v.length); o.forEach(([, i], k) => (r[i] = k)); return r; };
const rx = rank(pairs.map(p => p[0])), ry = rank(pairs.map(p => p[1]));
const check = { n: pairs.length, pearson: Math.round(pearson(pairs) * 1000) / 1000, spearman: Math.round(pearson(rx.map((x, i) => [x, ry[i]])) * 1000) / 1000 };

const out = {
  _meta: {
    generatedBy: "scripts/score-esco-skills.ts", generated: new Date().toISOString(),
    model: "ml/artifacts/exposure_model.json (ridge on bge-m3; labels: GPTs are GPTs human task ratings)",
    embeddingModel: embed.model, embeddingProvider: embed.provider, seconds: Math.round((Date.now() - t0) / 1000),
    text: "ESCO skill title", nearest: "nearest catalogue skill by cosine of bge-m3 title embeddings",
    note: "Model estimates, not measurements. The model was trained on O*NET task statements; ESCO skill titles are similar short verb phrases, but knowledge items (nouns) are further from its training data.",
    iloAgreement: { ...check, what: "occupation mean of essential-skill model scores vs ILO WP140 mean exposure of its ISCO-08 unit group" },
    counts: { skills: ids.length },
  },
  scores,
};
writeFileSync(seed("esco_skill_scores.json.gz"), gzipSync(JSON.stringify(out)));
console.log(JSON.stringify(out._meta, null, 1));
