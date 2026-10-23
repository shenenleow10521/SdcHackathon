// Our self-trained AI-exposure estimator (ml/ pipeline): score = clip(bias + w · normalise(bge_m3(task))).
// Only works with bge-m3 embeddings (local Infinity or RunPod), the model it was trained on.
// It estimates how much an LLM could speed a task up (Eloundou et al. "exposure"), not whether AI replaces the person.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "../lib/db.ts";
import type { Services } from "../context.ts";
import { HttpError } from "../lib/http.ts";

interface ExposureModel {
  embeddingModel: string; dims: number; normalizeInput: boolean; clip: [number, number];
  bias: number; weights: number[]; target: string; trainedOn: any; run: any;
}

const ART = path.join(projectRoot, "ml", "artifacts");
let cached: { model: ExposureModel; evalSummary: any } | null | undefined;

/** Load the trained weights and evaluation summary once. Returns null if the model hasn't been trained. */
export function loadExposureModel(): { model: ExposureModel; evalSummary: any } | null {
  if (cached !== undefined) return cached;
  const file = path.join(ART, "exposure_model.json");
  if (!existsSync(file)) return (cached = null);
  const model = JSON.parse(readFileSync(file, "utf8")) as ExposureModel;
  if (model.weights?.length !== model.dims) throw new Error("exposure_model.json is corrupt: weights length != dims");
  let evalSummary = null;
  const ev = path.join(ART, "eval.json");
  if (existsSync(ev)) {
    const e = JSON.parse(readFileSync(ev, "utf8"));
    evalSummary = { split: e.split, perTask: e.perTask, perOccupation: e.perOccupation, run: e.run };
  }
  return (cached = { model, evalSummary });
}

export function modelInfo(svc: Services) {
  const m = loadExposureModel();
  const active = svc.embed.model;
  return {
    trained: !!m,
    available: !!m && active === m.model.embeddingModel,
    embeddingModel: m?.model.embeddingModel ?? null,
    activeEmbeddingModel: active,
    embeddingProvider: svc.embed.provider,
    target: m?.model.target ?? null,
    trainedOn: m?.model.trainedOn ?? null,
    run: m ? { where: m.model.run?.where, gpu: m.model.run?.gpu, time: m.model.run?.time } : null,
    evaluation: m?.evalSummary ?? null,
    measures: "How much a large language model could speed up the task (0-1). Not whether AI replaces the person.",
  };
}

export function scoreVector(m: ExposureModel, v: number[]): number {
  if (v.length !== m.dims) throw new Error(`Embedding has ${v.length} dims, model expects ${m.dims}`);
  let norm = 1;
  if (m.normalizeInput) norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  let s = m.bias;
  for (let i = 0; i < v.length; i++) s += m.weights[i] * (v[i] / norm);
  return Math.round(Math.min(m.clip[1], Math.max(m.clip[0], s)) * 1000) / 1000;
}

/** Score task statements. Throws 503 when bge-m3 embeddings aren't available. */
export async function scoreTasks(svc: Services, tasks: string[]): Promise<{ task: string; exposure: number }[]> {
  const m = loadExposureModel();
  if (!m) throw new HttpError(503, "exposure_model_missing", "The exposure model hasn't been trained yet (see ml/)");
  if (svc.embed.model !== m.model.embeddingModel)
    throw new HttpError(503, "exposure_model_unavailable", `The exposure model needs ${m.model.embeddingModel} embeddings (local or RunPod); the active provider is ${svc.embed.provider}`);
  const vecs = await svc.embed.embed(tasks);
  return tasks.map((task, i) => ({ task, exposure: scoreVector(m.model, vecs[i]) }));
}
