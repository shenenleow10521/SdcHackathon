// Links the curated AI-era skills (db/seed/ai_skills.json) to ESCO v1.2.1, by computation only:
//   neighbours:  the 10 ESCO skills closest to each AI skill (bge-m3 cosine, the same vectors CV intake uses)
//   occupations: ESCO occupations that should list the AI skill as an "emerging" requirement. An occupation qualifies
//                when its O*NET tasks are highly LLM-exposed ("GPTs are GPTs" human_rating_beta >= MIN_BETA, via the
//                ESCO-O*NET crosswalk in db/seed/esco_onet.json.gz) AND its own ESCO skills are close to the AI skill.
// Writes db/seed/ai_skills_links.json and prints a sample for a human to sanity-check.
// Embedding cost: one batch of ~27 short texts (the AI skills); ESCO skill vectors are precomputed.
// Usage: npx tsx scripts/link-ai-skills.ts            (uses EMBED_PROVIDER / RunPod / LOCAL_EMBED_URL from .env)
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "../server/lib/db.ts";
import { createEmbedder } from "../server/lib/embedder.ts";
import { loadEsco } from "../server/services/esco.ts";
import { loadEscoVectors } from "../server/services/esco-match.ts";

const K_NEIGHBOURS = 10, K_OCCUPATIONS = 15;
const MIN_BETA = 0.4;        // ~top 40% of the 2,471 ESCO occupations with O*NET task ratings
const MIN_FIT = 0.4;         // needs at least 2 anchor skills (3 anchors at ~0.6 give 0.6)
const seed = (f: string) => path.join(projectRoot, "db", "seed", f);

const ai = JSON.parse(readFileSync(seed("ai_skills.json"), "utf8"));
const esco = loadEsco(), v = loadEscoVectors();
if (!esco || !v) throw new Error("ESCO data or ESCO skill vectors missing (db/seed)");
const embed = createEmbedder(process.env, undefined, { timeoutMs: 240000 }); // a cold RunPod worker needs a while
if (embed.model !== v.model) throw new Error(`ESCO vectors are ${v.model}; the active embedder is ${embed.model}. Set EMBED_PROVIDER=runpod or local.`);

// One embedding call for all AI skills, two texts each:
//   "label. description" (mirrors escoSkillText) -> ESCO neighbours
//   workContext (the existing work the AI skill changes, e.g. "reconcile accounts ...") -> occupation anchors.
//   Without it, every AI skill lands near generic "use X software/tools" skills and the occupations it finds are noise.
const skills: any[] = ai.skills;
const n = skills.length;
const raw = await embed.embed([...skills.map(s => `${s.label}. ${s.description}`), ...skills.map(s => s.workContext || s.label)]);
const unit = (x: number[]) => { const len = Math.sqrt(x.reduce((a, b) => a + b * b, 0)) || 1; return Float32Array.from(x, y => y / len); };
const aiVecs = raw.slice(0, n).map(unit), ctxVecs = raw.slice(n).map(unit);

// Cosine of one AI skill against every ESCO skill (int8 vectors x per-vector scale).
const row = new Map(v.ids.map((id, i) => [id, i]));
function simsTo(u: Float32Array) {
  const out = new Float32Array(v!.ids.length);
  for (let i = 0, off = 0; i < v!.ids.length; i++, off += v!.dims) {
    let dot = 0;
    for (let d = 0; d < v!.dims; d++) dot += u[d] * v!.q[off + d];
    out[i] = dot * v!.scales[i];
  }
  return out;
}

// Occupation fit = mean of its 3 skills closest to the AI skill (essential skills count fully, optional ones at 0.9).
// Averaging three keeps one lookalike skill from carrying an occupation on its own.
const exposed = Object.entries<any>(esco.onetLinks)
  .filter(([id, l]) => esco.occupations[id] && typeof l.gptsBeta === "number" && l.gptsBeta >= MIN_BETA)
  .map(([id, l]) => ({ id, beta: l.gptsBeta as number, onet: l.onet as string, occ: esco.occupations[id] }));

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const simsAll = aiVecs.map(simsTo), ctxAll = ctxVecs.map(simsTo);
// ESCO's few generic AI skills sit close to every AI-era skill, so they say nothing about an occupation's domain:
// they are left out of the occupation fit (they still appear as neighbours).
const GENERIC_AI = new Set(["machine learning", "utilise machine learning", "principles of artificial intelligence", "deep learning", "artificial neural networks"]);
const skip = new Set(v.ids.filter(id => GENERIC_AI.has(esco.skills[id]?.title)).map(id => row.get(id)!));
// Anchors: the N_ANCHORS ESCO skills closest to the AI skill's workContext. An occupation fits when it lists several of them:
// fit = (sum of its 3 best anchor similarities) / 3, so one lookalike skill alone gives at most a third of the fit.
const N_ANCHORS = 40;
const links: Record<string, { neighbours: [string, number][]; occupations: [string, number][]; review?: string[] }> = {};
const why: Record<string, Record<string, string[]>> = {};
skills.forEach((s, k) => {
  const sims = simsAll[k];
  const order = Array.from(sims.keys()).sort((a, b) => sims[b] - sims[a]);
  const neighbours = order.slice(0, K_NEIGHBOURS).map(i => [v!.ids[i], r3(sims[i])] as [string, number]);
  const ctx = ctxAll[k];
  const ctxOrder = Array.from(ctx.keys()).sort((a, b) => ctx[b] - ctx[a]);
  const anchors = new Map(ctxOrder.filter(i => !skip.has(i)).slice(0, N_ANCHORS).map(i => [v!.ids[i], ctx[i]]));
  const occs = exposed.map(o => {
    const hits: [string, number][] = [];
    for (const id of o.occ.essential || []) if (anchors.has(id)) hits.push([id, anchors.get(id)!]);
    for (const id of o.occ.optional || []) if (anchors.has(id)) hits.push([id, anchors.get(id)! * 0.9]);
    hits.sort((a, b) => b[1] - a[1]);
    const top = hits.slice(0, 3);
    const fit = top.reduce((a, h) => a + h[1], 0) / 3;
    // score = fit x exposure nudge (beta 0.4..1 -> x0.85..1.0)
    return { id: o.id, fit, score: fit * (0.75 + 0.25 * o.beta), via: top.map(h => h[0]) };
  }).filter(o => o.fit >= MIN_FIT).sort((a, b) => b.score - a.score).slice(0, K_OCCUPATIONS);
  links[s.id] = { neighbours, occupations: occs.map(o => [o.id, r3(o.score)] as [string, number]) };
  why[s.id] = Object.fromEntries(occs.map(o => [o.id, o.via]));
});

// Flag hubs for review: an occupation proposed for HUB_MIN or more different AI skills usually has a long, generic
// skill list (e.g. "rescue centre manager") rather than a real link.
const HUB_MIN = 4;
const seen = new Map<string, number>();
for (const l of Object.values(links)) for (const [o] of l.occupations) seen.set(o, (seen.get(o) || 0) + 1);
const hubs = new Set([...seen].filter(([, c]) => c >= HUB_MIN).map(([o]) => o));
for (const l of Object.values(links)) { const r = l.occupations.map(([o]) => o).filter(o => hubs.has(o)); if (r.length) l.review = r; }

writeFileSync(seed("ai_skills_links.json"), JSON.stringify({
  _meta: {
    generatedBy: "scripts/link-ai-skills.ts", generated: new Date().toISOString(), embedder: embed.model, esco: "ESCO v1.2.1",
    neighbours: `top ${K_NEIGHBOURS} ESCO skills by bge-m3 cosine to "label. description"`,
    occupations: `ESCO occupations whose O*NET tasks have GPTs-are-GPTs beta >= ${MIN_BETA} (Eloundou et al. 2024, via the ESCO-O*NET crosswalk) and that list several of the ${N_ANCHORS} ESCO skills nearest to the AI skill's workContext (ESCO's generic AI skills excluded): fit = sum of the 3 best anchor cosines / 3 (optional skills x0.9), fit >= ${MIN_FIT}. score = fit x (0.75 + 0.25 x beta). Top ${K_OCCUPATIONS}. Computed, not curated: review before showing as fact. review = occupations proposed for ${HUB_MIN}+ AI skills (likely generic hubs, not real links).`,
  },
  links,
}, null, 1) + "\n");

// ---- human sanity check ----
const title = (id: string) => esco.skills[id]?.title ?? id;
const occTitle = (id: string) => esco.occupations[id]?.title ?? id;
const SAMPLE = (process.argv[2] || "ai-write-prompts,ai-check-output,ai-finance-close,ai-detect-deepfake-fraud,ai-esg-data").split(",");
for (const id of SAMPLE) {
  const s = skills.find(x => x.id === id), l = links[id];
  if (!s || !l) continue;
  console.log(`\n=== ${s.label} (${id}; work context: "${s.workContext}")`);
  console.log("  ESCO neighbours: " + l.neighbours.slice(0, 6).map(([e, c]) => `${title(e)} ${c}`).join(" | "));
  for (const [o, c] of l.occupations.slice(0, 6)) console.log(`  -> ${occTitle(o)} ${c}  (via ${why[id][o].map(title).join("; ")})${hubs.has(o) ? "  [REVIEW: hub]" : ""}`);
}
console.log(`\nHub occupations flagged for review: ${[...hubs].map(occTitle).join("; ")}`);
console.log(`\nWrote db/seed/ai_skills_links.json: ${skills.length} AI skills, ${exposed.length} exposed occupations considered.`);
