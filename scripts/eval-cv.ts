// CV-reading benchmark: runs every case in eval/cv/labels.json through the real intake pipeline
// (the same extractDraft() the app uses) and scores it against the annotator's answer key.
//
//   npx tsx scripts/eval-cv.ts                 # full system: Gemini + the configured embeddings (RunPod / local / Gemini)
//   npx tsx scripts/eval-cv.ts --mode basic    # baseline: no AI at all (keyword matching only)
//   npx tsx scripts/eval-cv.ts --only c03      # one case
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

const args = process.argv.slice(2);
const mode = (args.includes("--mode") ? args[args.indexOf("--mode") + 1] : "full") as "full" | "basic";
if (mode !== "full" && mode !== "basic") throw new Error("--mode must be full or basic");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;

const EVAL = path.join(projectRoot, "eval", "cv");
// Answer keys: labels.json (first 14 messy cases), labels-v2.json (more cases, with tiers), esco-labels.json (ESCO facts).
const readKey = (f: string) => { const p = path.join(EVAL, f); return existsSync(p) ? readFileSync(p, "utf8") : null; };
const keyFiles = ["labels.json", "labels-v2.json", "esco-labels.json"].map(f => ({ f, raw: readKey(f) })).filter(k => k.raw);
const labels = { annotator: "", createdAt: "", cases: [] as any[] };
for (const k of keyFiles.filter(k => k.f !== "esco-labels.json")) {
  const j = JSON.parse(k.raw!);
  labels.annotator ||= j.annotator; labels.createdAt ||= j.createdAt;
  labels.cases.push(...j.cases.map((c: any) => ({ tier: "messy", ...c })));
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
const embed = mode === "basic" ? noEmbedder : createEmbedder(process.env, db);
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

// ---- run ----
const rows: any[] = [];
const tiers: Record<string, { tp: number; fn: number; fp: number; occ: number; n: number }> = {};
let escoFound = 0, escoFactsTotal = 0;
const escoSuggestions: any[] = [];
let overrated = 0, acceptableIncluded = 0, TP = 0, FN = 0, FP = 0, occOk = 0, lvlIn = 0, lvlNear = 0, lvlN = 0, piiTotal = 0, piiLeaked = 0, piiInEvidence = 0, errors = 0;
for (const c of labels.cases) {
  if (only && !c.id.startsWith(only)) continue;
  const text = readFileSync(path.join(EVAL, c.file), "utf8");
  const before = sentToAi.length;
  const t0 = Date.now();
  let result: any = null, error: string | null = null;
  try { result = await extractDraft(svc, text); } catch (e: any) { error = e?.message || String(e); errors++; }
  const ms = Date.now() - t0;

  const predicted = new Map<string, any>((result?.draft.skills || []).map((s: any) => [s.skillId, s]));
  const required = new Map<string, any>(c.required.map((r: any) => [r.skill, r]));
  const acceptable = new Set<string>(c.acceptable.map((a: any) => a.skill));
  // Keyword stuffing: a skill that is only listed is fine to include, but not at a level above the annotator's cap.
  const stuffing = c.acceptable.filter((a: any) => predicted.has(a.skill)).map((a: any) => ({ skill: a.skill, level: predicted.get(a.skill).level, cap: a.levelMax ?? 5 }));
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
  const factHits = facts.map((f: any) => ({ fact: f.fact, found: f.escoIds.some((id: string) => escoPred.has(id)) }));
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
    levels, tier: c.tier,
    esco: { suggested: [...escoPred].length, facts: factHits },
    pii: pii.filter((p: any) => p.toAi || p.inEvidence),
    piiPlanted: pii.length,
  });
  console.log(`${c.id.padEnd(28)} [${c.tier}] ESCO ${factHits.filter((f: any) => f.found).length}/${facts.length} · skills TP ${tp.length} · missed ${fn.length}${fn.length ? ` (${fn.join(",")})` : ""} · FP ${fp.length}${fp.length ? ` (${fp.join(",")})` : ""} · job ${occCorrect ? "✓" : `✗ ${occ}≠${c.expectedOccupation}`} · PII leaks ${pii.filter((p: any) => p.toAi).length}/${pii.length} · ${(ms / 1000).toFixed(1)}s${error ? " · ERROR " + error : ""}`);
}

const n = rows.length;
const summary = {
  benchmark: "HalaTuju CV reading", mode, ranAt: new Date().toISOString(), cases: n,
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
  keywordStuffing: { listedSkillsIncluded: acceptableIncluded, ratedAboveCap: overrated },
  privacy: { planted: piiTotal, reachedAi: piiLeaked, inStoredEvidence: piiInEvidence },
  errors,
  medianSeconds: n ? Math.round(rows.map(r => r.ms).sort((a, b) => a - b)[Math.floor(n / 2)] / 100) / 10 : null,
};

const outDir = path.join(projectRoot, "eval", "results");
mkdirSync(outDir, { recursive: true });
const stamp = summary.ranAt.slice(0, 16).replace(/[:T]/g, "-");
writeFileSync(path.join(outDir, `cv-${mode}-${stamp}.json`), JSON.stringify({ summary, cases: rows }, null, 2) + "\n");
writeFileSync(path.join(outDir, `esco-suggestions-${mode}-latest.json`), JSON.stringify(escoSuggestions, null, 1) + "\n");
writeFileSync(path.join(outDir, `cv-${mode}-latest.json`), JSON.stringify({ summary, cases: rows }, null, 2) + "\n");
console.log("\n" + JSON.stringify(summary, null, 2));
await db.close();
