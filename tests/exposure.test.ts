import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.ts";
import { loadExposureModel, scoreVector } from "../server/services/exposure.ts";
import { testServices } from "./helpers/services.ts";
import type { Embedder } from "../server/lib/embed.ts";

const loaded = loadExposureModel();

// An embedder that pretends to be bge-m3: every text maps to the same unit vector along the weights.
function fakeBgeM3(dims: number, w: number[]): Embedder {
  const norm = Math.sqrt(w.reduce((s, x) => s + x * x, 0));
  return {
    provider: "local-bge-m3" as any, model: "BAAI/bge-m3",
    embed: async ts => ts.map(() => w.map(x => x / norm)),
    status: () => ({ provider: "local-bge-m3", model: "BAAI/bge-m3", configured: true, lastError: null }),
  };
}

describe.skipIf(!loaded)("self-trained exposure model", () => {
  const m = loaded!.model;

  it("artifact is well-formed and records where it was trained", () => {
    expect(m.embeddingModel).toBe("BAAI/bge-m3");
    expect(m.weights).toHaveLength(m.dims);
    expect(["local", "runpod"]).toContain(m.run.where);
  });

  it("scoreVector = clip(bias + w·v/|v|) and is scale-invariant", () => {
    const v = new Array(m.dims).fill(0); v[0] = 1;
    const expected = Math.min(1, Math.max(0, m.bias + m.weights[0]));
    expect(scoreVector(m as any, v)).toBeCloseTo(expected, 3);
    expect(scoreVector(m as any, v.map(x => x * 7))).toBeCloseTo(expected, 3);
    expect(() => scoreVector(m as any, [1, 2, 3])).toThrow();
  });

  it("POST /api/exposure/score works with bge-m3 and returns 0..1", async () => {
    const svc = await testServices({ embed: fakeBgeM3(m.dims, m.weights) });
    const res = await request(createApp(svc)).post("/api/exposure/score").send({ tasks: ["Match invoices to purchase orders"] });
    expect(res.status).toBe(200);
    expect(res.body.scores[0].exposure).toBeGreaterThanOrEqual(0);
    expect(res.body.scores[0].exposure).toBeLessThanOrEqual(1);
    expect(res.body.model.available).toBe(true);
  });

  it("refuses to mix in vectors from another embedding model (503, labelled)", async () => {
    const svc = await testServices(); // mock bag-of-words embedder
    const app = createApp(svc);
    const res = await request(app).post("/api/exposure/score").send({ tasks: ["Match invoices"] });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("exposure_model_unavailable");
    expect((await request(app).get("/api/exposure/model")).body.available).toBe(false);
  });

  it("validates input and unknown skills", async () => {
    const svc = await testServices({ embed: fakeBgeM3(m.dims, m.weights) });
    const app = createApp(svc);
    expect((await request(app).post("/api/exposure/score").send({ tasks: [] })).status).toBe(400);
    expect((await request(app).post("/api/exposure/score").send({ tasks: ["x".repeat(301)] })).status).toBe(400);
    expect((await request(app).get("/api/exposure/skill/nope")).status).toBe(404);
    const ok = await request(app).get("/api/exposure/skill/recon");
    expect(ok.status).toBe(200);
    expect(ok.body.tasks).toHaveLength(3);
    expect(ok.body.knowledgeBase.exposure2026).toBeCloseTo(0.54, 2);
  });
});
