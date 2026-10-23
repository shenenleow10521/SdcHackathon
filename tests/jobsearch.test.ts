// Job search: catalogue hits, unknown titles (nearest jobs + live ESCO, here from a recorded fixture),
// and graceful behaviour when ESCO or the embedder is down.
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import { createApp } from "../server/app.ts";
import { tokens, tokenScore, parseEsco, clearSearchCaches, CONFIDENT } from "../server/services/jobsearch.ts";
import { noEmbedder } from "../server/lib/embed.ts";
import { testServices } from "./helpers/services.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/esco-search-carbon-accountant.json", import.meta.url), "utf8"));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => clearSearchCaches());

describe("token matching", () => {
  it("normalises, removes stop words and stems lightly", () => {
    expect(tokens("Carbon Accountants & the ESG")).toEqual(["carbon", "account", "esg"]);
    expect(tokens("accounting")).toEqual(["account"]);
  });
  it("scores title words 1, description/skill words 0.5", () => {
    expect(tokenScore(["data", "analyst"], ["data", "analyst"], new Set())).toBe(1);
    expect(tokenScore(["carbon", "account"], ["esg", "carbon", "report", "analyst"], new Set(["account"]))).toBe(0.75);
    expect(tokenScore([], ["x"], new Set())).toBe(0);
  });
  it("parses the recorded ESCO response shape", () => {
    const hits = parseEsco(fixture);
    expect(hits).toHaveLength(5);
    expect(hits[1]).toEqual({ uri: "http://data.europa.eu/esco/occupation/eda0d957-3c3c-4139-b89a-a18bc9e18897", title: "accountant" });
    expect(parseEsco({})).toEqual([]);
    expect(parseEsco({ _embedded: { results: [{ uri: "https://evil.example/x", title: "x" }] } })).toEqual([]);
  });
});

describe("GET /api/jobs/search", () => {
  it("catalogue hit: confident result, no ESCO call", async () => {
    let calls = 0;
    const svc = await testServices({ fetch: (async () => { calls++; return json(fixture); }) as any });
    const res = await request(createApp(svc)).get("/api/jobs/search?q=Data%20Analyst");
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ job: "dataRole", score: 1 });
    expect(res.body.results.every((r: any) => r.score >= CONFIDENT)).toBe(true);
    expect(res.body.unknown).toBeUndefined();
    expect(calls).toBe(0);
  });

  it("unknown title: nearest catalogue jobs with low confidence + live ESCO matches", async () => {
    const urls: string[] = [];
    const svc = await testServices({ fetch: (async (u: any) => { urls.push(String(u)); return json(fixture); }) as any });
    const res = await request(createApp(svc)).get("/api/jobs/search?q=carbon%20accountant");
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
    expect(res.body.unknown.confidence).toBe("low");
    expect(res.body.unknown.nearest.map((n: any) => n.job)).toContain("esgRole");
    expect(res.body.unknown.nearest.every((n: any) => n.score < CONFIDENT)).toBe(true);
    expect(res.body.unknown.esco).toHaveLength(5);
    expect(res.body.unknown.esco[1]).toEqual({ uri: expect.stringMatching(/^http:\/\/data\.europa\.eu\/esco\/occupation\//), title: "accountant" });
    expect(urls[0]).toBe("https://ec.europa.eu/esco/api/search?text=carbon%20accountant&type=occupation&language=en&limit=5");
  });

  it("ESCO down (network error or HTTP 500): still 200, ESCO omitted", async () => {
    const down = await testServices({ fetch: (async () => { throw new Error("ECONNRESET"); }) as any });
    const a = await request(createApp(down)).get("/api/jobs/search?q=carbon%20accountant");
    expect(a.status).toBe(200);
    expect(a.body.unknown.confidence).toBe("low");
    expect(a.body.unknown.esco).toBeUndefined();
    clearSearchCaches();
    const err = await testServices({ fetch: (async () => json({ error: "x" }, 500)) as any });
    const b = await request(createApp(err)).get("/api/jobs/search?q=carbon%20accountant");
    expect(b.status).toBe(200);
    expect(b.body.unknown.esco).toBeUndefined();
  });

  it("works without an embedder (basic matching)", async () => {
    const svc = await testServices({ embed: noEmbedder });
    const res = await request(createApp(svc)).get("/api/jobs/search?q=internal%20auditor");
    expect(res.body.matching).toBe("basic");
    expect(res.body.results[0].job).toBe("intAudit");
  });

  it("validates q", async () => {
    const svc = await testServices();
    expect((await request(createApp(svc)).get("/api/jobs/search")).status).toBe(400);
    expect((await request(createApp(svc)).get("/api/jobs/search?q=" + "x".repeat(200))).status).toBe(400);
  });
});
