import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.ts";
import { loadEsco } from "../server/services/esco.ts";
import { nextJobs } from "../server/services/esco-network.ts";
import { testServices } from "./helpers/services.ts";
import type { Services } from "../server/context.ts";

const ACCOUNTING_ASSISTANT = "bfe142b9-a049-4d41-89c4-fd2f34ac56b6";
const BOOKKEEPER = "c3aae59e-1441-4b3e-bdd1-6da50dc7cf42";
const has = !!loadEsco();

describe.skipIf(!has)("career network over all ESCO jobs", () => {
  let svc: Services;
  beforeAll(async () => { svc = await testServices(); });

  it("closest jobs come from shared skills: accounting assistant -> bookkeeper first", () => {
    const r = nextJobs(ACCOUNTING_ASSISTANT, 10)!;
    expect(r.jobs[0].id).toBe(BOOKKEEPER);
    expect(r.jobs.map(j => j.title)).toContain("accountant");
    expect(r.jobs.some(j => j.id === ACCOUNTING_ASSISTANT)).toBe(false); // never itself
    for (let i = 1; i < r.jobs.length; i++) expect(r.jobs[i - 1].similarity).toBeGreaterThanOrEqual(r.jobs[i].similarity);
    for (const j of r.jobs) {
      expect(j.similarity).toBeGreaterThan(0); expect(j.similarity).toBeLessThanOrEqual(1);
      expect(j.keep + j.need).toBe(j.essential);
    }
  });

  it("is symmetric: if A is close to B, B is equally close to A", () => {
    const ab = nextJobs(ACCOUNTING_ASSISTANT, 25)!.jobs.find(j => j.id === BOOKKEEPER)!;
    const ba = nextJobs(BOOKKEEPER, 25)!.jobs.find(j => j.id === ACCOUNTING_ASSISTANT)!;
    expect(ab.similarity).toBeCloseTo(ba.similarity, 6);
  });

  it("GET /api/esco/occupations/:id/next validates and returns the network", async () => {
    const app = createApp(svc);
    const ok = await request(app).get(`/api/esco/occupations/${ACCOUNTING_ASSISTANT}/next?limit=5`);
    expect(ok.status).toBe(200);
    expect(ok.body.jobs).toHaveLength(5);
    expect(ok.body.method).toMatch(/cosine/);
    expect((await request(app).get(`/api/esco/occupations/not-an-id/next`)).status).toBe(400);
    expect((await request(app).get(`/api/esco/occupations/00000000-0000-0000-0000-000000000000/next`)).status).toBe(404);
  });

  it("GET /api/esco/profile/:id/best-jobs ranks all ESCO jobs by your coverage", async () => {
    const app = createApp(svc);
    const res = await request(app).get("/api/esco/profile/1/best-jobs?limit=8");
    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(8);
    for (let i = 1; i < res.body.jobs.length; i++) expect(res.body.jobs[i - 1].match).toBeGreaterThanOrEqual(res.body.jobs[i].match);
    expect((await request(app).get("/api/esco/profile/9999/best-jobs")).status).toBe(404);
  });
});
