import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { createEngine } from "../shared/engine.js";
import { loadGraph, createVersion, engineGraph, latestVersion } from "../server/kb.ts";
import { loadProfile, engineProfile } from "../server/repo.ts";
import { createApp } from "../server/app.ts";
import { createGeminiLlm, createKrackedLlm, toGeminiSchema, LlmUnavailableError } from "../server/lib/llm.ts";
import { testServices } from "./helpers/services.ts";
import type { Services } from "../server/context.ts";

const golden = JSON.parse(readFileSync(new URL("./fixtures/golden.json", import.meta.url), "utf8"));

let svc: Services;
beforeAll(async () => { svc = await testServices(); });

describe("seeded database graph", () => {
  it("reproduces the prototype outputs for the demo persona (2026 moderate)", async () => {
    const g = await loadGraph(svc.db);
    const p = (await loadProfile(svc.db, 1))!;
    const E = createEngine(engineGraph(g), engineProfile(p), { year: 2026, scenario: "moderate" });
    const c = golden.cases[0];
    for (const [job, m] of Object.entries(c.match)) expect(E.match(job)).toBe(m);
    expect(E.planFor("esgRole", "fastest").route!.key).toBe("ap>recon>ghg>esgRole");
  });

  it("a new version with the reconciliation signal reroutes ESG, and undo restores it", async () => {
    const db = (await testServices()).db;
    const v2 = await createVersion(db, "Approve reconciliation signal", "admin:test", [{ kind: "delta", nodeId: "recon", deltaE: 0.18 }]);
    const p = engineProfile((await loadProfile(db, 1))!);
    const after = createEngine(engineGraph(await loadGraph(db, v2)), p);
    expect(after.shortestPath("esgRole", "fastest")!.key).toBe("ap>audit>disc>esgRole");
    // older version unchanged
    expect(createEngine(engineGraph(await loadGraph(db, 1)), p).shortestPath("esgRole", "fastest")!.key).toBe("ap>recon>ghg>esgRole");
    const changeId = (await loadGraph(db, v2)).appliedChanges[0].id;
    const v3 = await createVersion(db, "Undo", "admin:test", [{ kind: "revert", payload: { change_ids: [changeId] } }]);
    expect(createEngine(engineGraph(await loadGraph(db, v3)), p).shortestPath("esgRole", "fastest")!.key).toBe("ap>recon>ghg>esgRole");
    expect(await latestVersion(db)).toBe(v3);
  });

  it("confirming an emerging skill restores its full weight", async () => {
    const db = (await testServices()).db;
    const p = engineProfile((await loadProfile(db, 1))!);
    const v = await createVersion(db, "Confirm prompt", "admin:test", [{ kind: "emerging_status", nodeId: "prompt", payload: { status: "confirmed" } }]);
    const E = createEngine(engineGraph(await loadGraph(db, v)), p);
    const row = E.matchBreakdown("stayRole").find((r: any) => r.skill === "prompt")!;
    expect(row.effectiveWeight).toBe(row.weight);
  });

  it("an added emerging skill joins the graph with its edges and requirements", async () => {
    const db = (await testServices()).db;
    const v = await createVersion(db, "Add skill", "committee", [{ kind: "add_skill", payload: {
      skill: { id: "agentops", label: "AI agent operations", e: [0.2, 0.25, 0.3], d: [20, 30, 40] },
      edges: [{ from: "process", to: "agentops", weeks: 2, why: "test" }, { from: "agentops", to: "opsRole", weeks: 2, why: "test" }],
      req: [{ job: "opsRole", weight: 2, need: 3 }] } }]);
    const g = await loadGraph(db, v);
    expect(g.nodes.agentops.emerging.status).toBe("provisional");
    expect(g.req.opsRole.some(r => r.skill === "agentops")).toBe(true);
  });

  it("demo persona profile loads with skills and a deadline", async () => {
    const p = (await loadProfile(svc.db, 1))!;
    expect(p.isDemo).toBe(true);
    expect(p.occupationId).toBe("ap");
    expect(p.skills.length).toBe(10);
    expect(p.targetDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await loadProfile(svc.db, 9999)).toBeNull();
  });
});

describe("API basics", () => {
  it("GET /api/health reports DB and models", async () => {
    const res = await request(createApp(svc)).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.kbVersion).toBe(1);
    expect(res.body.llm.models.main).toBeTruthy();
  });
  it("GET /api/graph returns nodes, edges, requirements, sectors, courses", async () => {
    const res = await request(createApp(svc)).get("/api/graph");
    expect(res.status).toBe(200);
    expect(res.body.kbVersion).toBe(1);
    expect(res.body.nodes.esgRole.type).toBe("job");
    expect(res.body.edges.length).toBeGreaterThan(50);
    expect(res.body.req.esgRole.length).toBe(5);
    expect(Object.values<any[]>(res.body.req).flat().every(r => r.need === 3)).toBe(true); // one level for every job
    expect(res.body.courses.ghg[0].title).toBeTruthy();
    expect(res.body.nodes.recon.tasks.length).toBe(3);
  });
  it("unknown API route and bad JSON give clean JSON errors", async () => {
    const app = createApp(svc);
    const a = await request(app).get("/api/nope");
    expect(a.status).toBe(404);
    expect(a.body.error.code).toBe("not_found");
    const b = await request(app).post("/api/nope").set("Content-Type", "application/json").send("{bad");
    expect(b.status).toBe(400);
    expect(b.body.error.code).toBe("bad_json");
  });
  it("GET /api/graph?kb=0 is a 400, not a crash", async () => {
    const res = await request(createApp(svc)).get("/api/graph?kb=0");
    expect(res.status).toBe(400);
  });
});

describe("LLM wrapper", () => {
  const schema = z.object({ skills: z.array(z.enum(["recon", "inv"])) });
  const ok = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });

  it("converts zod to a Gemini-compatible schema", () => {
    const js: any = toGeminiSchema(schema);
    expect(js.$schema).toBeUndefined();
    expect(js.properties.skills.items.enum).toEqual(["recon", "inv"]);
  });

  it("validates, caches, and serves the second call from cache", async () => {
    const db = (await testServices()).db;
    let calls = 0;
    const llm = createGeminiLlm({ db, keys: ["k1"], fetch: (async () => { calls++; return ok('{"skills":["recon"]}'); }) as any });
    const a = await llm.complete({ system: "s", user: "u", schema });
    const b = await llm.complete({ system: "s", user: "u", schema });
    expect(a.data.skills).toEqual(["recon"]);
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(true);
    expect(calls).toBe(1);
  });

  it("rotates keys on 429 and falls back to the second model on bad output", async () => {
    const seen: string[] = [];
    const llm = createGeminiLlm({ keys: ["k1", "k2"], fetch: (async (url: string, init: any) => {
      seen.push(`${url.split("/models/")[1].split(":")[0]}|${init.headers["x-goog-api-key"]}`);
      if (init.headers["x-goog-api-key"] === "k1") return new Response("{}", { status: 429 });
      if (url.includes("3.5")) return ok('{"skills":["not-an-id"]}');
      return ok('{"skills":["inv"]}');
    }) as any });
    const r = await llm.complete({ system: "s", user: "u", schema, cache: false });
    expect(r.data.skills).toEqual(["inv"]);
    expect(r.model).toBe("gemini-3.1-flash-lite");
    expect(seen.some(s => s.endsWith("|k2"))).toBe(true);
  });

  it("throws LlmUnavailableError when every model fails, and with no keys", async () => {
    const llm = createGeminiLlm({ keys: ["k"], fetch: (async () => new Response("{}", { status: 500 })) as any });
    await expect(llm.complete({ system: "s", user: "u", schema, cache: false })).rejects.toBeInstanceOf(LlmUnavailableError);
    await expect(createGeminiLlm({ keys: [] }).complete({ system: "s", user: "u", schema })).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it("scrubs personal details before sending", async () => {
    let body = "";
    const llm = createGeminiLlm({ keys: ["k"], fetch: (async (_u: string, init: any) => { body = init.body; return ok('{"skills":[]}'); }) as any });
    await llm.complete({ system: "s", user: "Email priya@example.com, IC 900101-07-1234, phone 012-345 6789", schema, cache: false });
    expect(body).not.toContain("priya@example.com");
    expect(body).not.toContain("900101-07-1234");
    expect(body).not.toContain("345 6789");
  });
});

describe("KrackedDevs LLM", () => {
  const schema = z.object({ ok: z.boolean() });
  const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

  it("gives each voter seat its own model and leaves temperature out for GPT", async () => {
    const bodies: any[] = [];
    const llm = createKrackedLlm({ keys: ["k"], fetch: (async (_u: string, init: any) => { bodies.push(JSON.parse(init.body)); return reply('{"ok":true}'); }) as any });
    const a = await llm.complete({ system: "s", user: "u", schema, role: "reviewer", voter: "evidence", cache: false });
    const b = await llm.complete({ system: "s", user: "u", schema, role: "reviewer", voter: "sceptic", cache: false });
    const c = await llm.complete({ system: "s", user: "u", schema, voter: "skill", cache: false });
    expect([a.model, b.model, c.model]).toEqual(["gpt-5.5", "DeepSeek-V4-Pro", "gpt-6-sol"]);
    expect(bodies[0].temperature).toBeUndefined();
    expect(bodies[0].reasoning_effort).toBe("low");
    expect(bodies[1].temperature).toBe(0);
  });

  it("does not serve one model's cached answer to another model", async () => {
    const db = (await testServices()).db;
    let calls = 0;
    const f = (async () => { calls++; return reply('{"ok":true}'); }) as any;
    await createKrackedLlm({ db, keys: ["k"], fetch: f }).complete({ system: "s", user: "u", schema });
    await createKrackedLlm({ db, keys: ["k"], fetch: f, models: { main: "gpt-5.4" } }).complete({ system: "s", user: "u", schema });
    expect(calls).toBe(2);
  });
});

describe("Gemini key discovery", () => {
  it("finds every numbered key, in order, without duplicates", async () => {
    const { geminiKeysFromEnv } = await import("../server/lib/llm.ts");
    expect(geminiKeysFromEnv({ gemini_key_3: "c", gemini_key: "a", gemini_key_2: "b", gemini_key_4: "d", GEMINI_API_KEY: "a", OTHER: "x" } as any))
      .toEqual(["a", "b", "c", "d"]);
    expect(geminiKeysFromEnv({} as any)).toEqual([]);
  });
});
