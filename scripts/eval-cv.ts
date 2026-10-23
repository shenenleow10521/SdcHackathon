// CV-reading benchmark: runs every case in eval/cv/labels.json through the real intake pipeline
// (the same extractDraft() the app uses) and scores it against the annotator's answer key.
//
//   npx tsx scripts/eval-cv.ts                 # full system: Gemini + the configured embeddings (RunPod / local / Gemini)
//   npx tsx scripts/eval-cv.ts --mode basic    # baseline: no AI at all (keyword matching only)
//   npx tsx scripts/eval-cv.ts --only c03      # one case
//   npx tsx scripts/eval-cv.ts --split tuning  # only the tuning set (c01-c14), for checking a fix
//
// Scoring (per case, then summed over all cases):
//   required  = skills the annotator says the CV clearly shows   -> missing one = false negative
//   acceptable= arguable skills                                   -> never counted either way
//   anything else the system outputs                              -> false positive
// Also: occupation accuracy, level-in-range rate, and how many planted personal details reached the AI.
// The answer key's sha256 is written into the results, so the key can't silently change after a run.
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { openDb, migrate, projectRoot } from "../server/lib/db.ts";
import { seed } from "../server/lib/seed.ts";
import { createGeminiLlm, geminiKeysFromEnv, LlmUnavailableError, type Llm, type LlmRequest } from "../server/lib/llm.ts";
import { createEmbedder } from "../server/lib/embedder.ts";
import { noEmbedder } from "../server/lib/embed.ts";
import { configFromEnv, type Services } from "../server/context.ts";
import { extractDraft } from "../server/agents/cv.ts";
import { loadEscoVectors } from "../server/services/esco-match.ts";

const args = process.argv.slice(2);
const mode = (args.includes("--mode") ? args[args.indexOf("--mode") + 1] : "full") as "full" | "basic";
if (mode !== "full" && mode !== "basic") throw new Error("--mode must be full or basic");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const onlySplit = args.includes("--split") ? args[args.indexOf("--split") + 1] : null; // tuning | heldout

const EVAL = path.join(projectRoot, "eval", "cv");
// Answer keys: labels.json (first 14 messy cases), labels-v2.json (more cases, with tiers), esco-labels.json (ESCO facts).
const readKey = (f: string) => { const p = path.join(EVAL, f); return existsSync(p) ? readFileSync(p, "utf8") : null; };
const keyFiles = ["labels.json", "labels-v2.json", "esco-labels.json"].map(f => ({ f, raw: readKey(f) })).filter(k => k.raw);
const labels = { annotator: "", createdAt: "", cases: [] as any[] };
for (const k of keyFiles.filter(k => k.f !== "esco-labels.json")) {
  const j = JSON.parse(k.raw!);
  labels.annotator ||= j.annotator; labels.createdAt ||= j.createdAt;
  // labels.json (c01-c14) is the tuning set: prompts and the scrubber were adjusted after its first run.
  // labels-v2.json (c15-c50) is held out: those CVs were first run on 23 Oct, after the tuning.
  const split = k.f === "labels.json" ? "tuning" : "heldout";
  labels.cases.push(...j.cases.map((c: any) => ({ tier: "messy", ...c, split })));
}
const escoKey = keyFiles.find(k => k.f === "esco-labels.json");
const escoFacts = new Map<string, any[]>(escoKey ? JSON.parse(escoKey.raw!).cases.map((c: any) => [c.id, c.facts]) : []);
const labelsSha = Object.fromEntries(keyFiles.map(k => [k.f, createHash("sha256").update(k.raw!).digest("hex")]));

// ---- services: a fresh in-memory database, so nothing is served from an earlier run's cache ----
const db = await openDb({ memory: true });
await migrate(db);
await seed(db);
const sentToAi: string[] = [];
function recording(inner: Llm): Llm {
  return {
    status: inner.status,
    complete: <T>(req: LlmRequest<T>) => { sentToAi.push(req.user); return inner.complete(req); },
  };
}
const offline: Llm = {
  status: () => ({ configured: false, models: { main: "none", reviewer: "none" }, keys: 0, lastError: null }),
  complete: async () => { throw new LlmUnavailableError("baseline run: no AI"); },
};
const llm = recording(mode === "basic" ? offline : createGeminiLlm({ db, keys: geminiKeysFromEnv() }));
const baseEmbed = mode === "basic" ? noEmbedder : createEmbedder(process.env, db);
// ESCO matching only works with bge-m3 query vectors (the stored ESCO vectors are bge-m3). Refuse to run the full
// benchmark with another embedder, and count embedding failures, which the pipeline otherwise absorbs silently.
const escoModel = loadEscoVectors()?.model;
if (mode === "full" && baseEmbed.model !== escoModel)
  throw new Error(`full mode needs the ${escoModel} embedder for ESCO matching (got ${baseEmbed.provider} / ${baseEmbed.model}); set EMBED_PROVIDER=runpod`);
const embedStats = { calls: 0, texts: 0, failures: 0, ms: 0, lastError: null as string | null };
const embed: typeof baseEmbed = {
  ...baseEmbed,
  embed: async (ts: string[]) => {
    const t0 = Date.now(); embedStats.calls++; embedStats.texts += ts.length;
    try { return await baseEmbed.embed(ts); }
    catch (e: any) { embedStats.failures++; embedStats.lastError = e?.message || String(e); throw e; }
    finally { embedStats.ms += Date.now() - t0; }
  },
};
const svc: Services = { db, llm, embed, fetch: globalThis.fetch, now: () => new Date(), config: { ...configFromEnv(), schedulerEnabled: false } };

// ---- helpers ----
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const digits = (s: string) => s.replace(/\D/g, "");
/** Did a planted personal detail survive into text sent to the AI? Long digit strings are matched digits-only. */
function leaked(item: string, texts: string[]) {
  const d = digits(item);
  return texts.some(t => norm(t).includes(norm(item)) || (d.length >= 8 && digits(t).includes(d)));
}
function wilson(k: number, n: number) {
  if (!n) return null;
  const z = 1.96, p = k / n, den = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / den, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / den;
  return [Math.max(0, c - h), Math.min(1, c + h)].map(x => Math.round(x * 1000) / 1000);
}
const pct = (k: number, n: number) => (n ? Math.round((1000 * k) / n) / 10 : null);
const rate = (k: number, n: number) => ({ k, n, pct: pct(k, n), ci95: wilson(k, n) });

// ESCO recall, strict and lenient. Both rules were fixed before the 24 Oct rerun and before looking at its output.
//   strict : a fact is found if one of the annotator's accepted ESCO ids for it was suggested (as in the first run).
//   lenient: also found if a suggestion that matched no fact strictly is a close ESCO neighbour of one of the fact's
//            accepted ids: bge-m3 cosine >= 0.80 between the two ESCO skills' stored vectors. Each such suggestion can
//            count for at most one fact (greedy, closest pairs first). 0.80 is the app's existing "related skill"
//            threshold (RELATED_COSINE); on the tuning-set answer key (c01-c14) 16% of pairs of ids the annotator put
//            under the SAME fact reach it, and 1.3% of pairs from DIFFERENT facts do.
const LENIENT_COSINE = 0.8;
const escoVectors = loadEscoVectors();
const escoIndex = new Map((escoVectors?.ids || []).map((id, i) => [id, i]));
function escoCos(a: string, b: string) {
  const v = escoVectors, i = escoIndex.get(a), j = escoIndex.get(b);
  if (!v || i === undefined || j === undefined) return 0;
  let dot = 0;
  for (let d = 0, oi = i * v.dims, oj = j * v.dims; d < v.dims; d++) dot += v.q[oi + d] * v.q[oj + d];
  return dot * v.scales[i] * v.scales[j]; // stored vectors are L2-normalised before int8 quantisation
}
function escoRecall(facts: { escoIds: string[] }[], suggested: string[]) {
  const strict = facts.map(f => f.escoIds.some(id => suggested.includes(id)));
  const usedStrict = new Set(suggested.filter(s => facts.some(f => f.escoIds.includes(s))));
  const pairs: { f: number; s: string; sim: number }[] = [];
  facts.forEach((f, fi) => {
    if (strict[fi]) return;
    for (const s of suggested) if (!usedStrict.has(s)) {
      const sim = Math.max(...f.escoIds.map(id => escoCos(s, id)));
      if (sim >= LENIENT_COSINE) pairs.push({ f: fi, s, sim });
    }
  });
  const lenientVia: (string | null)[] = facts.map(() => null), usedS = new Set<string>();
  for (const p of pairs.sort((a, b) => b.sim - a.sim)) if (!lenientVia[p.f] && !usedS.has(p.s)) { lenientVia[p.f] = p.s; usedS.add(p.s); }
  return { strict, lenient: strict.map((x, i) => x || !!lenientVia[i]), lenientVia };
}
// Annotator's notes that say an "acceptable" skill is only listed or claimed (not shown in use).
const LISTED_NOTE = /listed|skills list|top skill|skills section|only claimed|claimed|headline|summary/i;

// ---- run ----
const rows: any[] = [];
const tiers: Record<string, { tp: number; fn: number; fp: number; occ: number; n: number }> = {};
let escoFound = 0, escoFactsTotal = 0;
const escoSuggestions: any[] = [];
let overrated = 0, acceptableIncluded = 0, TP = 0, FN = 0, FP = 0, occOk = 0, lvlIn = 0, lvlNear = 0, lvlN = 0, piiTotal = 0, piiLeaked = 0, piiInEvidence = 0, errors = 0;
for (const c of labels.cases) {
  if (only && !c.id.startsWith(only)) continue;
  if (onlySplit && c.split !== onlySplit) continue;
  const text = readFileSync(path.join(EVAL, c.file), "utf8");
  const before = sentToAi.length;
  const t0 = Date.now();
  let result: any = null, error: string | null = null;
  try { result = await extractDraft(svc, text); } catch (e: any) { error = e?.message || String(e); errors++; }
  const ms = Date.now() - t0;

  const predicted = new Map<string, any>((result?.draft.skills || []).map((s: any) => [s.skillId, s]));
  const required = new Map<string, any>(c.required.map((r: any) => [r.skill, r]));
  const acceptable = new Set<string>(c.acceptable.map((a: any) => a.skill));
  // "Acceptable" skills (arguable or only listed) may be included, but not above the annotator's level cap.
  // listedOnly: the annotator's note says the skill is only listed or claimed (the keyword-stuffing case).
  const stuffing = c.acceptable.filter((a: any) => predicted.has(a.skill)).map((a: any) => {
    const p = predicted.get(a.skill);
    return { skill: a.skill, level: p.level, cap: a.levelMax ?? 5, sure: p.sure, evidence: p.evidence, listedOnly: LISTED_NOTE.test(a.why || ""), note: a.why };
  });
  acceptableIncluded += stuffing.length;
  const over = stuffing.filter((x: any) => x.level > x.cap);
  overrated += over.length;
  const tp = [...required.keys()].filter(k => predicted.has(k));
  const fn = [...required.keys()].filter(k => !predicted.has(k));
  const fp = [...predicted.keys()].filter(k => !required.has(k) && !acceptable.has(k));
  TP += tp.length; FN += fn.length; FP += fp.length;
  const tier = (tiers[c.tier] ||= { tp: 0, fn: 0, fp: 0, occ: 0, n: 0 });
  tier.tp += tp.length; tier.fn += fn.length; tier.fp += fp.length; tier.n++;

  // ESCO recall: a fact is found if any of its accepted ESCO skills was suggested.
  const escoPred = new Set<string>((result?.draft.escoSkills || []).map((e: any) => e.escoId));
  const facts = escoFacts.get(c.id) || [];
  const rec = escoRecall(facts, [...escoPred]);
  const factHits = facts.map((f: any, i: number) => ({ fact: f.fact, found: rec.strict[i], lenient: rec.lenient[i], lenientVia: rec.lenientVia[i] }));
  escoFound += factHits.filter((f: any) => f.found).length; escoFactsTotal += facts.length;
  for (const e of result?.draft.escoSkills || []) escoSuggestions.push({ caseId: c.id, escoId: e.escoId, title: e.title, shownInUse: e.shownInUse, phrase: e.phrase });

  const levels = tp.map(k => {
    const r = required.get(k), lv = predicted.get(k).level;
    const inRange = lv >= (r.levelMin ?? 1) && lv <= (r.levelMax ?? 5);
    const near = lv >= (r.levelMin ?? 1) - 1 && lv <= (r.levelMax ?? 5) + 1;
    lvlN++; if (inRange) lvlIn++; if (near) lvlNear++;
    return { skill: k, level: lv, range: [r.levelMin, r.levelMax], inRange };
  });

  const occ = result?.draft.occupation.id ?? null;
  const occCorrect = occ === c.expectedOccupation || (c.acceptableOccupations || []).includes(occ);
  if (occCorrect) { occOk++; tier.occ++; }

  const aiTexts = sentToAi.slice(before);
  const evidence = (result?.draft.skills || []).map((s: any) => s.evidence || "");
  const pii = (c.plantedPii || []).map((item: string) => ({ item, toAi: leaked(item, aiTexts), inEvidence: leaked(item, evidence) }));
  piiTotal += pii.length; piiLeaked += pii.filter((p: any) => p.toAi).length; piiInEvidence += pii.filter((p: any) => p.inEvidence).length;

  rows.push({
    id: c.id, language: c.language, ms, error,
    providers: result?.providers ?? null,
    occupation: { expected: c.expectedOccupation, got: occ, correct: occCorrect },
    skills: { truePositives: tp, missed: fn, falsePositives: fp, acceptableIncluded: stuffing, overratedListedSkills: over },
    levels, tier: c.tier, split: c.split,
    esco: { suggested: [...escoPred].length, shownInUse: (result?.draft.escoSkills || []).filter((e: any) => e.shownInUse).length, facts: factHits },
    pii: pii.filter((p: any) => p.toAi || p.inEvidence),
    piiPlanted: pii.length, piiLeakedToAi: pii.filter((p: any) => p.toAi).length,
    aiCalls: aiTexts.length, aiChars: aiTexts.reduce((s, t) => s + t.length, 0),
  });
  console.log(`${c.id.padEnd(28)} [${c.tier}] ESCO ${factHits.filter((f: any) => f.found).length}/${facts.length} · skills TP ${tp.length} · missed ${fn.length}${fn.length ? ` (${fn.join(",")})` : ""} · FP ${fp.length}${fp.length ? ` (${fp.join(",")})` : ""} · job ${occCorrect ? "✓" : `✗ ${occ}≠${c.expectedOccupation}`} · PII leaks ${pii.filter((p: any) => p.toAi).length}/${pii.length} · ${(ms / 1000).toFixed(1)}s${error ? " · ERROR " + error : ""}`);
}

const n = rows.length;
// The headline numbers for any group of cases (ESCO precision comes from the blind judge: scripts/esco-judge.ts).
function headline(rs: any[]) {
  const sum = (f: (r: any) => number) => rs.reduce((s, r) => s + f(r), 0);
  const facts = sum(r => r.esco.facts.length), tp = sum(r => r.skills.truePositives.length);
  return {
    cases: rs.length,
    currentJob: rate(sum(r => (r.occupation.correct ? 1 : 0)), rs.length),
    escoRecallStrict: rate(sum(r => r.esco.facts.filter((f: any) => f.found).length), facts),
    escoRecallLenient: rate(sum(r => r.esco.facts.filter((f: any) => f.lenient).length), facts),
    personalDetailsRemoved: rate(sum(r => r.piiPlanted - r.piiLeakedToAi), sum(r => r.piiPlanted)),
    escoSuggested: sum(r => r.esco.suggested), escoShownInUse: sum(r => r.esco.shownInUse),
    coreSkills: {
      recall: rate(tp, tp + sum(r => r.skills.missed.length)), precision: rate(tp, tp + sum(r => r.skills.falsePositives.length)),
      levelInRange: rate(sum(r => r.levels.filter((l: any) => l.inRange).length), sum(r => r.levels.length)),
    },
  };
}
const groups: Record<string, any> = { all: headline(rows) };
for (const sp of ["heldout", "tuning"]) groups[sp] = headline(rows.filter(r => r.split === sp));
for (const t of [...new Set(rows.map(r => r.tier))]) {
  groups[`all:${t}`] = headline(rows.filter(r => r.tier === t));
  const h = rows.filter(r => r.tier === t && r.split === "heldout");
  if (h.length) groups[`heldout:${t}`] = headline(h);
}
const stuffRows = rows.flatMap(r => r.skills.acceptableIncluded);
const listedRows = stuffRows.filter((x: any) => x.listedOnly);
const summary = {
  benchmark: "HalaTuju CV reading", mode, ranAt: new Date().toISOString(), cases: n,
  headline: groups,
  embeddingCalls: embedStats,
  aiCalls: rows.reduce((s, r) => s + r.aiCalls, 0), aiInputChars: rows.reduce((s, r) => s + r.aiChars, 0),
  totalSeconds: Math.round(rows.reduce((s, r) => s + r.ms, 0) / 1000),
  answerKey: { sha256: labelsSha, annotator: labels.annotator, createdAt: labels.createdAt },
  byTier: Object.fromEntries(Object.entries(tiers).map(([t, x]) => [t, { cases: x.n, recall: pct(x.tp, x.tp + x.fn), precision: pct(x.tp, x.tp + x.fp), occupation: pct(x.occ, x.n) }])),
  esco: { factsFound: escoFound, facts: escoFactsTotal, recall: pct(escoFound, escoFactsTotal), recall95: wilson(escoFound, escoFactsTotal), suggestions: escoSuggestions.length,
          precision: "judged separately: scripts/eval-esco-judge (blind judge with decoys)" },
  system: { llm: llm.status().models, embeddings: embed.provider, embeddingModel: embed.model },
  skills: {
    truePositives: TP, missed: FN, falsePositives: FP,
    recall: pct(TP, TP + FN), recall95: wilson(TP, TP + FN),
    precision: pct(TP, TP + FP), precision95: wilson(TP, TP + FP),
    f1: TP ? Math.round((2000 * TP) / (2 * TP + FP + FN)) / 10 : 0,
  },
  occupation: { correct: occOk, of: n, accuracy: pct(occOk, n) },
  levels: { inRange: pct(lvlIn, lvlN), withinOne: pct(lvlNear, lvlN), n: lvlN },
  keywordStuffing: {
    // All "acceptable" skills (arguable near-neighbours, weak evidence, or only listed) that the system included.
    acceptableIncluded, acceptableAboveCap: overrated,
    // The subset the annotator's note calls only listed or claimed: these should be at most level 2 and "not sure".
    listedOnlyIncluded: listedRows.length, listedOnlyAboveCap: listedRows.filter((x: any) => x.level > x.cap).length,
    listedOnlyAboveLevel2: listedRows.filter((x: any) => x.level > 2).length, listedOnlyMarkedSure: listedRows.filter((x: any) => x.sure).length,
  },
  privacy: { planted: piiTotal, reachedAi: piiLeaked, inStoredEvidence: piiInEvidence },
  errors,
  // Cases where the AI call failed and the keyword fallback ran instead (these count as the system's result).
  aiUnavailable: rows.filter(r => r.providers?.llm === "unavailable").map(r => r.id),
  medianSeconds: n ? Math.round(rows.map(r => r.ms).sort((a, b) => a - b)[Math.floor(n / 2)] / 100) / 10 : null,
};

const outDir = path.join(projectRoot, "eval", "results");
mkdirSync(outDir, { recursive: true });
const stamp = summary.ranAt.slice(0, 16).replace(/[:T]/g, "-");
writeFileSync(path.join(outDir, `cv-${mode}-${stamp}.json`), JSON.stringify({ summary, cases: rows }, null, 2) + "\n");
writeFileSync(path.join(outDir, `esco-suggestions-${mode}-${stamp}.json`), JSON.stringify(escoSuggestions, null, 1) + "\n");
writeFileSync(path.join(outDir, `esco-suggestions-${mode}-latest.json`), JSON.stringify(escoSuggestions, null, 1) + "\n");
writeFileSync(path.join(outDir, `cv-${mode}-latest.json`), JSON.stringify({ summary, cases: rows }, null, 2) + "\n");
console.log("\n" + JSON.stringify(summary, null, 2));
await db.close();
