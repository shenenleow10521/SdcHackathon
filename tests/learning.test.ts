// Learning resources (GET /api/learning) and one ESCO skill's outlook (GET /api/esco/skills/:id).
import { describe, it, expect } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import { createApp } from "../server/app.ts";
import { testServices } from "./helpers/services.ts";
import { loadEsco } from "../server/services/esco.ts";
import { OUTLOOK } from "../server/services/outlook.ts";

const raw = JSON.parse(readFileSync(new URL("../db/seed/learning.json", import.meta.url), "utf8"));

describe("learning resources", () => {
  it("the seed file has only https links in known formats, each with a title and how it was checked", () => {
    const all = Object.values<any[]>(raw.resources).flat();
    expect(all.length).toBeGreaterThan(20);
    for (const r of all) {
      expect(["video", "article", "book", "practice"]).toContain(r.format);
      expect(r.url).toMatch(/^https:\/\//);
      expect(r.title.length).toBeGreaterThan(3);
      expect(r.evidence?.length).toBeGreaterThan(5);
      if (r.format === "video") expect(r.url).toMatch(/youtube\.com|youtu\.be/);
    }
  });

  it("serves the list by skill id", async () => {
    const app = createApp(await testServices());
    const res = await request(app).get("/api/learning");
    expect(res.status).toBe(200);
    expect(res.body.resources.prompt.length).toBeGreaterThan(0);
    expect(res.body.resources["ai-literacy"].length).toBeGreaterThan(0);
  });
});

describe("ESCO skill outlook", () => {
  it("returns the model score banded by the outlook bars, and 404 for an unknown id", async () => {
    const app = createApp(await testServices());
    const d = loadEsco()!;
    const id = Object.keys(d.skills).find(k => d.skills[k].type !== "knowledge" && typeof d.scores[k]?.[0] === "number")!;
    const res = await request(app).get(`/api/esco/skills/${id}`);
    expect(res.status).toBe(200);
    const e = res.body.exposure;
    expect(res.body.band).toBe(e >= OUTLOOK.atRisk ? "risk" : e >= OUTLOOK.changing ? "changing" : "safe");
    expect((await request(app).get("/api/esco/skills/00000000-0000-0000-0000-000000000000")).status).toBe(404);
    expect((await request(app).get("/api/esco/skills/not-an-id")).status).toBe(404);
  });
});
