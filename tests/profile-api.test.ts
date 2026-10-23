// Profile & intake API (docs/API.md): shapes, validation, interviewer answers, Prove checks.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import { createApp } from "../server/app.ts";
import { testServices } from "./helpers/services.ts";
import { createMockLlm, LlmUnavailableError } from "../server/lib/llm.ts";
import { createMockEmbedder } from "../server/lib/embed.ts";
import { cvLlmHandler } from "./fixtures/cv/mock-llm.ts";
import { makePdf } from "./fixtures/cv/make-pdf.ts";
import type { Services } from "../server/context.ts";

const PRIYA = readFileSync(new URL("./fixtures/cv/priya-nair.txt", import.meta.url), "utf8");
const PRIYA_PDF = readFileSync(new URL("./fixtures/cv/priya-nair.pdf", import.meta.url));

let svc: Services;
let app: ReturnType<typeof createApp>;
beforeAll(async () => {
  svc = await testServices({ llm: createMockLlm(cvLlmHandler()), embed: createMockEmbedder(512) });
  app = createApp(svc);
});

describe("POST /api/profile/intake", () => {
  it("pasted text: creates a new non-demo profile with the documented response shape", async () => {
    const res = await request(app).post("/api/profile/intake").send({ text: PRIYA });
    expect(res.status).toBe(201);
    const b = res.body;
    expect(b.profileId).toBeGreaterThan(1);
    expect(b.profile).toMatchObject({ id: b.profileId, isDemo: false, occupationId: "ap", hours: 6 });
    expect(b.draft.occupation).toMatchObject({ id: "ap", confidence: "high" });
    expect(b.draft.skills.length).toBeGreaterThan(3);
    expect(b.draft.skills[0]).toEqual(expect.objectContaining({ skillId: expect.any(String), label: expect.any(String), level: expect.any(Number), confidence: "cv" }));
    expect(b.draft.nearMisses).toBeUndefined(); // internal only
    expect(Array.isArray(b.draft.unmatched)).toBe(true);
    expect(b.questions.length).toBeLessThanOrEqual(3);
    expect(b.questions[0]).toMatchObject({ id: "hours", field: "hours" }); // hours not given
    expect(b.scrubbed.removed).toContain("phone");
    expect(b.providers).toEqual({ llm: "mock-main", embed: "mock", matching: "semantic" });
    // Saved profile skills match the draft; no raw CV text anywhere in the database rows we wrote.
    expect(b.profile.skills.map((s: any) => s.skillId).sort()).toEqual(b.draft.skills.map((s: any) => s.skillId).sort());
    const stored = JSON.stringify((await svc.db.query("select * from profile_skills where profile_id=$1", [b.profileId])).rows);
    for (const pii of ["Priya", "345 6789", "880412", "Hindu"]) expect(stored).not.toContain(pii);
  });

  it("PDF upload works the same, with hours and language from form fields", async () => {
    const res = await request(app).post("/api/profile/intake").attach("cv", PRIYA_PDF, "cv.pdf").field("hours", "8").field("lang", "ms");
    expect(res.status).toBe(201);
    expect(res.body.profile).toMatchObject({ hours: 8, lang: "ms", displayName: "Profil saya" });
    expect(res.body.draft.skills.length).toBeGreaterThan(3);
    expect(res.body.questions.find((q: any) => q.id === "hours")).toBeUndefined();
  });

  it("rejects bad uploads and input with friendly errors", async () => {
    let res = await request(app).post("/api/profile/intake").attach("cv", Buffer.from("not a pdf at all"), "cv.pdf");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("not_pdf");
    expect(res.body.error.message).toMatch(/paste your CV text/);
    res = await request(app).post("/api/profile/intake").attach("cv", makePdf([]), "scan.pdf");
    expect(res.body.error.code).toBe("pdf_no_text");
    res = await request(app).post("/api/profile/intake").attach("cv", Buffer.alloc(5 * 1024 * 1024 + 10, 0x25), "big.pdf");
    expect(res.status).toBe(413);
    res = await request(app).post("/api/profile/intake").attach("other", PRIYA_PDF, "cv.pdf");
    expect(res.status).toBe(400);
    res = await request(app).post("/api/profile/intake").field("hours", "6");
    expect(res.status).toBe(400);
    res = await request(app).post("/api/profile/intake").send({ text: "too short" });
    expect(res.status).toBe(400);
    res = await request(app).post("/api/profile/intake").send({ text: "x".repeat(30001) });
    expect(res.status).toBe(400);
    res = await request(app).post("/api/profile/intake").send({ text: PRIYA, hours: 99 });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("hours");
  });

  it("still works when the AI model is down (basic matching, labelled)", async () => {
    const down = await testServices({ llmHandler: () => new LlmUnavailableError("down") });
    const res = await request(createApp(down)).post("/api/profile/intake").send({ text: PRIYA, hours: 6 });
    expect(res.status).toBe(201);
    expect(res.body.providers).toMatchObject({ llm: "unavailable", matching: "basic" });
    expect(res.body.draft.skills.length).toBeGreaterThan(0);
    expect(res.body.questions.length).toBeGreaterThan(0); // basic matches are always confirmed with the user
  });
});

describe("profile CRUD", () => {
  it("GET returns the profile; unknown ids give 404, bad ids 400", async () => {
    expect((await request(app).get("/api/profile/1")).body).toMatchObject({ id: 1, isDemo: true });
    expect((await request(app).get("/api/profile/9999")).status).toBe(404);
    expect((await request(app).get("/api/profile/abc")).status).toBe(400);
  });

  it("PUT updates settings and validates every field", async () => {
    const id = (await request(app).post("/api/profile/intake").send({ text: PRIYA })).body.profileId;
    const ok = await request(app).put(`/api/profile/${id}`).send({ hours: 10, budgetRm: 2000, targetDate: "2027-04-30", sdgPriority: 13, lang: "ms", occupationId: "faRole", displayName: "Me" });
    expect(ok.status).toBe(200);
    expect(ok.body.profile).toMatchObject({ hours: 10, budgetRm: 2000, targetDate: "2027-04-30", sdgPriority: 13, lang: "ms", occupationId: "faRole", displayName: "Me" });
    expect((await request(app).put(`/api/profile/${id}`).send({ targetDate: null, budgetRm: null })).body.profile).toMatchObject({ targetDate: null, budgetRm: null });
    for (const bad of [{ hours: 0 }, { hours: 41 }, { hours: 2.5 }, { targetDate: "next week" }, { targetDate: "2027-02-30" }, { lang: "fr" },
                       { occupationId: "astronaut" }, { sdgPriority: 18 }, {}, { colour: "blue" }])
      expect((await request(app).put(`/api/profile/${id}`).send(bad)).status, JSON.stringify(bad)).toBe(400);
    expect((await request(app).put("/api/profile/9999").send({ hours: 5 })).status).toBe(404);
  });

  it("PUT skills sets levels as self-rated, level 0 removes, re-saving the same level keeps confidence", async () => {
    const id = (await request(app).post("/api/profile/intake").send({ text: PRIYA })).body.profileId;
    const res = await request(app).put(`/api/profile/${id}/skills`).send({ skills: [{ skillId: "sql", level: 2 }, { skillId: "three", level: 0 }, { skillId: "recon", level: 4 }] });
    expect(res.status).toBe(200);
    const by = Object.fromEntries(res.body.profile.skills.map((s: any) => [s.skillId, s]));
    expect(by.sql).toMatchObject({ level: 2, confidence: "self" });
    expect(by.three).toBeUndefined();
    expect(by.recon).toMatchObject({ level: 4, confidence: "cv" }); // same level as the CV draft: unchanged
    expect(res.body.profile.level.sql).toBe(2);
    for (const bad of [{ skills: [{ skillId: "made_up", level: 3 }] }, { skills: [{ skillId: "sql", level: 6 }] }, { skills: [] }, {}])
      expect((await request(app).put(`/api/profile/${id}/skills`).send(bad)).status).toBe(400);
  });

  it("POST answers: levels become self-rated, hours update, bad answers change nothing", async () => {
    const intake = (await request(app).post("/api/profile/intake").send({ text: PRIYA })).body;
    const id = intake.profileId;
    const res = await request(app).post(`/api/profile/${id}/answers`).send({ answers: { hours: 10, "skill:pay": 5, "skill:prompt": "2", "skill:three": 0 } });
    expect(res.status).toBe(200);
    const by = Object.fromEntries(res.body.profile.skills.map((s: any) => [s.skillId, s]));
    expect(res.body.profile.hours).toBe(10);
    expect(by.pay).toMatchObject({ level: 5, confidence: "self" });
    expect(by.prompt).toMatchObject({ level: 2, confidence: "self" });
    expect(by.three).toBeUndefined();
    for (const bad of [{ answers: { hours: 0 } }, { answers: { "skill:nope": 3 } }, { answers: { "skill:pay": 7 } }, { answers: { favourite: 1 } }, { answers: {} }]) {
      const r = await request(app).post(`/api/profile/${id}/answers`).send(bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
    // A mixed batch with one bad answer is rejected as a whole.
    await request(app).post(`/api/profile/${id}/answers`).send({ answers: { hours: 3, "skill:nope": 1 } });
    expect((await request(app).get(`/api/profile/${id}`)).body.hours).toBe(10);
    expect((await request(app).post("/api/profile/9999/answers").send({ answers: { hours: 5 } })).status).toBe(404);
  });
});

describe("Prove checks", () => {
  const key = async (checkId: string) => (await svc.db.query("select answer_key from skill_checks where id=$1", [checkId])).rows[0].answer_key as Record<string, number>;

  it("GET gives questions without answers; a pass marks the skill verified", async () => {
    const id = (await request(app).post("/api/profile/intake").send({ text: PRIYA })).body.profileId;
    const res = await request(app).get(`/api/skills/recon/check?profile=${id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ checkId: expect.any(String), skillId: "recon", isSample: true });
    expect(res.body.questions.length).toBe(4);
    // No answer-key fields anywhere in the response (task text itself may contain words like "corrections").
    const keys: string[] = [];
    JSON.stringify(res.body, (k, v) => { keys.push(k); return v; });
    expect(keys.filter(k => /answer|correct|key/i.test(k))).toEqual([]);
    for (const q of res.body.questions) expect(q).toEqual({ id: expect.any(String), text: expect.any(String), options: expect.any(Array) });
    expect(res.body.proveNext).toBeNull(); // no course with a practical check for this skill yet

    const answers = await key(res.body.checkId);
    const done = await request(app).post("/api/skills/recon/check").send({ profileId: id, checkId: res.body.checkId, answers });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ passed: true, score: 4, total: 4, confidence: "verified" });
    expect(done.body.profile.skills.find((s: any) => s.skillId === "recon")).toMatchObject({ level: 4, confidence: "verified" });
    // Single use.
    expect((await request(app).post("/api/skills/recon/check").send({ profileId: id, checkId: res.body.checkId, answers })).status).toBe(409);
  });

  it("a fail (below 70%) changes nothing", async () => {
    const id = (await request(app).post("/api/profile/intake").send({ text: PRIYA })).body.profileId;
    const check = (await request(app).get(`/api/skills/pay/check?profile=${id}`)).body;
    expect(check.proveNext).toMatchObject({ check: expect.any(String) }); // the course's practical check, shown as the next step
    const checkId = check.checkId;
    const right = await key(checkId);
    const answers = Object.fromEntries(Object.entries(right).map(([q, a], i) => [q, i < 2 ? (a + 1) % 3 : a])); // 2 of 4 wrong
    const done = await request(app).post("/api/skills/pay/check").send({ profileId: id, checkId, answers });
    expect(done.body).toMatchObject({ passed: false, score: 2, total: 4, confidence: "cv" });
  });

  it("validation: unknown skill/profile/check, wrong skill for the check, expired checks", async () => {
    expect((await request(app).get("/api/skills/nope/check?profile=1")).status).toBe(404);
    expect((await request(app).get("/api/skills/recon/check?profile=9999")).status).toBe(404);
    const { checkId } = (await request(app).get("/api/skills/recon/check?profile=1")).body;
    expect((await request(app).post("/api/skills/pay/check").send({ profileId: 1, checkId, answers: {} })).status).toBe(404);
    expect((await request(app).post("/api/skills/recon/check").send({ profileId: 1, checkId: "nope", answers: {} })).status).toBe(404);
    expect((await request(app).post("/api/skills/recon/check").send({ profileId: 1, answers: {} })).status).toBe(400);
    const later = createApp({ ...svc, now: () => new Date(svc.now().getTime() + 3 * 3600_000) });
    expect((await request(later).post("/api/skills/recon/check").send({ profileId: 1, checkId, answers: {} })).status).toBe(410);
  });
});

describe("sample persona is read-only on the server", () => {
  it("rejects edits to profile 1 with 403, but still scores a check without saving it", async () => {
    expect((await request(app).put("/api/profile/1").send({ hours: 10 })).status).toBe(403);
    expect((await request(app).put("/api/profile/1/skills").send({ skills: [{ skillId: "ghg", level: 3 }] })).status).toBe(403);
    expect((await request(app).post("/api/profile/1/answers").send({ answers: { hours: 8 } })).status).toBe(403);
    const check = (await request(app).get("/api/skills/recon/check?profile=1")).body;
    const answers = (await svc.db.query("select answer_key from skill_checks where id=$1", [check.checkId])).rows[0].answer_key;
    const done = await request(app).post("/api/skills/recon/check").send({ profileId: 1, checkId: check.checkId, answers });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ passed: true, saved: false, confidence: "verified" });
    expect(done.body.profile.skills.find((s: any) => s.skillId === "recon").confidence).toBe("cv"); // unchanged
  });
});
