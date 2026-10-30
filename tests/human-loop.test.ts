// Credibility fixes before the final: people approve data bridges before they are used; AI-era skills in ESCO plans;
// a safer route only when it is really safer; the current ESCO job on every profile; a reachable default pick.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import request from "supertest";
import { createApp } from "../server/app.ts";
import { loadGraph, type FullGraph } from "../server/kb.ts";
import { loadProfile, type Profile } from "../server/repo.ts";
import { buildJobPlan, buildPlan } from "../server/services/planning.ts";
import { loadEsco, searchOccupations, occupationDetail, currentEscoFor } from "../server/services/esco.ts";
import { loadBridges, allApproved } from "../server/services/bridges.ts";
import { aiSkillsFor, aiSkillsReport } from "../server/services/ai-skills.ts";
import { createEngine, PARAMS } from "../shared/engine.js";
import { createMockLlm } from "../server/lib/llm.ts";
import { createMockEmbedder } from "../server/lib/embed.ts";
import { seedGraph, persona as seedPersona } from "./helpers/seed-graph.ts";
import { cvLlmHandler } from "./fixtures/cv/mock-llm.ts";
import { testServices } from "./helpers/services.ts";
import type { Services } from "../server/context.ts";

const NOW = new Date("2026-10-23T10:00:00Z");
const occ = (title: string) => {
  const d = loadEsco()!;
  const id = Object.keys(d.occupations).find(k => d.occupations[k].title === title);
  if (!id) throw new Error(`no ESCO occupation ${title}`);
  return id;
};
const skillByTitle = (title: string) => {
  const d = loadEsco()!;
  return Object.keys(d.skills).find(k => d.skills[k].title === title)!;
};

let svc: Services, app: ReturnType<typeof createApp>, g: FullGraph, priya: Profile;
beforeAll(async () => {
  svc = await testServices();
  app = createApp(svc);
  g = await loadGraph(svc.db);
  priya = (await loadProfile(svc.db, 1))!;
});

/** A non-demo profile with these ESCO skills confirmed (and optionally a current ESCO job). */
async function escoProfile(skills: string[], currentEsco: string | null = null) {
  const id = (await svc.db.query("insert into profiles(display_name,current_occupation_id,current_esco_id,hours_per_week,lang,is_demo) values ('t','other',$1,6,'en',false) returning id", [currentEsco])).rows[0].id as number;
  for (const s of skills) await svc.db.query("insert into profile_esco_skills(profile_id,skill_id,source) values ($1,$2,'self')", [id, s]);
  return id;
}

describe("bridges: people decide before the data's bridges are used", () => {
  // "inspect taxation documents" (tax inspector) -> "attend to detail in preparation for audits" (audit supervisor):
  // a proposed bridge in the built file.
  const findBridge = () => loadBridges()!.bridges.find(b => b.fromTitle === "inspect taxation documents" && b.toTitle === "attend to detail in preparation for audits")!;

  it("a proposed bridge is in the review queue, with evidence, and is never used by the match or routes", async () => {
    const b = findBridge();
    expect(b).toBeTruthy();
    expect(b.status).toBe("proposed");
    expect(allApproved().some(x => x.id === b.id)).toBe(false);
    expect(allApproved().every(x => x.source === "team")).toBe(true); // before anyone decides: team bridges only

    const review = await request(app).get("/api/review");
    expect(review.status).toBe(200);
    expect(review.body.bridges.counts.proposed).toBeGreaterThan(1000);
    expect(review.body.bridges.counts.team).toBeGreaterThan(20);
    expect(review.body.bridges.bridges[0]).toMatchObject({ id: expect.any(Number), status: "proposed", evidence: { sharedActivities: expect.any(Array) } });

    const list = await request(app).get("/api/review/bridges").query({ skill: "inspect taxation documents" });
    expect(list.status).toBe(200);
    const row = list.body.bridges.find((x: any) => x.id === b.id);
    expect(row).toMatchObject({ from: { id: b.from, title: b.fromTitle }, to: { id: b.to }, status: "proposed", decision: null });
    expect(row.evidence.tasksFrom.length).toBeGreaterThan(0);
    // sorted by score, filterable by field family
    const scores = list.body.bridges.map((x: any) => x.score);
    expect(scores).toEqual([...scores].sort((x: number, y: number) => y - x));
    const fam = await request(app).get("/api/review/bridges").query({ family: "health & care", limit: 5 });
    expect(fam.body.bridges.every((x: any) => x.from.family === "health & care" || x.to.family === "health & care")).toBe(true);

    // Not used: someone with only the source skill gets no credit for the target from it.
    const pid = await escoProfile([b.from]);
    const cov = occupationDetail(occ("audit supervisor"), {}, new Set([b.from]))!.essential.find(s => s.id === b.to)!;
    expect(cov.via).not.toBe(b.from);
    const plan = (await request(app).get("/api/plan").query({ profile: pid, job: `esco:${occ("audit supervisor")}` })).body;
    expect(plan.route.legs.some((l: any) => l.from === b.from && l.to === b.to)).toBe(false);
  });

  it("approving puts it into the match and routes at once; rejecting takes it out; team bridges can't be re-decided", async () => {
    const b = findBridge();
    const pid = await escoProfile([b.from]);
    const job = `esco:${occ("audit supervisor")}`;
    const before = (await request(app).get("/api/plan").query({ profile: pid, job })).body;

    const ok = await request(app).post(`/api/review/bridges/${b.id}/approve`).send({ note: "tax document checks are audit preparation" });
    expect(ok.status).toBe(200);
    expect(ok.body.bridge).toMatchObject({ id: b.id, status: "approved", decision: { status: "approved", note: "tax document checks are audit preparation" } });
    expect(allApproved().some(x => x.id === b.id)).toBe(true);
    const row = (await svc.db.query("select status, actor from bridge_decisions where from_skill=$1 and to_skill=$2", [b.from, b.to])).rows[0] as any;
    expect(row.status).toBe("approved");
    expect((await svc.db.query("select 1 from audit_log where action='bridge.approve'")).rows.length).toBe(1);

    // the match now credits the target through the bridge, and the route uses it
    const after = (await request(app).get("/api/plan").query({ profile: pid, job })).body;
    expect(after.match).toBeGreaterThan(before.match);
    const cov = occupationDetail(occ("audit supervisor"), {}, new Set([b.from]))!.essential.find(s => s.id === b.to)!;
    expect(cov).toMatchObject({ basis: "related", via: b.from });
    // the bridge makes the target reachable: it is closer to what she has (key steps are picked by how core a skill is
    // to the job first, so the target is not always a numbered step any more; when it is, its leg is the bridge)
    const rel = (p: any) => p.missing.find((m: any) => m.id === b.to).rel;
    expect(rel(after)).toBeGreaterThan(rel(before));
    const leg = after.route.legs.find((l: any) => l.to === b.to);
    if (leg) { expect(leg).toMatchObject({ kind: "bridge", bridge: true }); expect(leg.why).toMatch(/reviewed bridge/); }

    const no = await request(app).post(`/api/review/bridges/${b.id}/reject`).send({});
    expect(no.body.bridge.status).toBe("rejected");
    expect(allApproved().some(x => x.id === b.id)).toBe(false);
    const again = (await request(app).get("/api/plan").query({ profile: pid, job })).body;
    expect(again.match).toBe(before.match);
    expect((await request(app).get("/api/review/bridges").query({ status: "rejected" })).body.bridges.map((x: any) => x.id)).toContain(b.id);

    const team = loadBridges()!.bridges.find(x => x.source === "team")!;
    expect((await request(app).post(`/api/review/bridges/${team.id}/approve`).send({})).status).toBe(409);
    expect((await request(app).post(`/api/review/bridges/99999999/approve`).send({})).status).toBe(404);
  });

  it("decisions survive a restart (they are read back from the database)", async () => {
    const b = findBridge();
    await request(app).post(`/api/review/bridges/${b.id}/approve`).send({});
    const fresh = createApp({ ...svc, db: svc.db });
    const other = await testServices(); // a different database: its own (empty) decisions
    await request(createApp(other)).get("/api/health");
    expect(allApproved().some(x => x.id === b.id)).toBe(false);
    await request(fresh).get("/api/health");
    expect(allApproved().some(x => x.id === b.id)).toBe(true);
    await request(app).post(`/api/review/bridges/${b.id}/reject`).send({});
  });
});

describe("AI-era skills in ESCO plans", () => {
  const ACCOUNTANT = occ("accountant");

  it("a finance ESCO job asks for the sourced AI skill: aiEra, no exposure number, sources, not in the match", () => {
    const plan: any = buildJobPlan(g, priya, { job: `esco:${ACCOUNTANT}`, mode: "closest", now: NOW, escoSkills: new Set() });
    expect(plan.emerging.map((e: any) => e.id)).toContain("ai:finance-close");
    const m = plan.missing.find((x: any) => x.id === "ai:finance-close");
    expect(m).toMatchObject({ aiEra: true, exposure: null, basis: "emerging", type: "skill", exposureNote: "AI-era skill: grows with AI" });
    expect(m.sources.length).toBeGreaterThan(0);
    for (const s of m.sources) expect(s).toMatchObject({ publisher: expect.any(String), title: expect.any(String), url: expect.stringMatching(/^https:/) });
    expect(plan.sources.some((s: any) => s.kind === "ai-skill")).toBe(true);
    expect(plan.counts.emerging).toBe(plan.emerging.length);
    // the ESCO match is over ESCO's essential skills only
    expect(plan.match).toBe(occupationDetail(ACCOUNTANT, priya.level, new Set())!.match);
  });

  it("the safer route favours the AI skill; it never counts as at risk and is never avoided", () => {
    const safe: any = buildJobPlan(g, priya, { job: `esco:${ACCOUNTANT}`, mode: "safest", now: NOW, escoSkills: new Set() });
    expect(safe.keySkills).toContain("ai:finance-close");
    expect(safe.route.nodes).toContain("ai:finance-close");
    expect(safe.route.names["ai:finance-close"]).toBe("use AI tools in reconciliation, close and reporting");
    const closest: any = buildJobPlan(g, priya, { job: `esco:${ACCOUNTANT}`, mode: "closest", now: NOW, escoSkills: new Set() });
    for (const a of closest.saferAlternative?.avoids || []) expect(a.id.startsWith("ai:")).toBe(false);
  });

  it("a catalogue skill that is the same thing counts: prompting at level 3 = 'write prompts for generative AI tools'", () => {
    const admin = occ("administrative assistant");
    expect(aiSkillsFor(admin).map(s => s.id)).toContain("ai:write-prompts");
    const p = { ...priya, level: { ...priya.level, prompt: 3 } };
    const plan: any = buildJobPlan(g, p, { job: `esco:${admin}`, mode: "closest", now: NOW, escoSkills: new Set() });
    expect(plan.emerging.find((e: any) => e.id === "ai:write-prompts")).toMatchObject({ have: true, catalogue: "prompt" });
    expect(plan.missing.some((m: any) => m.id === "ai:write-prompts")).toBe(false);
  });

  it("only links above the quality bar; generic hubs and hand-checked wrong pairs are left out (and logged)", () => {
    const r = aiSkillsReport()!;
    expect(r.skills).toHaveLength(27);
    for (const s of r.skills) for (const o of s.occupations) expect(o.score).toBeGreaterThanOrEqual(0.5);
    expect(aiSkillsFor(occ("aquaculture biologist"))).toEqual([]);
    expect(aiSkillsFor(occ("child day care centre manager"))).toEqual([]);
    expect(r.excluded.some(e => e.title === "aquaculture biologist")).toBe(true);
    expect(r.excluded.some(e => e.title === "child day care centre manager" && /hub/.test(e.why))).toBe(true);
  });

  it("GET /ai-skills lists the skills with their sources and the excluded links", async () => {
    const res = await request(app).get("/api/ai-skills");
    expect(res.status).toBe(200);
    expect(res.body.skills[0]).toMatchObject({ id: expect.stringMatching(/^ai:/), aiEra: true, exposure: null, sources: expect.any(Array) });
    expect(res.body.excluded.length).toBeGreaterThan(0);
  });
});

describe("safer route: only when it is really safer", () => {
  it("a nurse gets no 'safer' route that avoids nursing care (low exposure); any offer names a high-exposure skill", async () => {
    const d = loadEsco()!;
    const nurse = occ("nurse responsible for general care");
    const mine = d.occupations[nurse].essential.filter((s: string) => d.skills[s].type !== "knowledge");
    const pid = await escoProfile(mine, nurse);
    for (const t of ["specialist nurse", "advanced nurse practitioner", "nurse assistant", "healthcare assistant"]) {
      const plan = (await request(app).get("/api/plan").query({ profile: pid, job: `esco:${occ(t)}` })).body;
      expect(plan.route, t).toBeTruthy();
      const alt = plan.saferAlternative;
      if (!alt) continue;
      for (const a of alt.avoids) {
        expect(a.signal || a.exposure >= 0.6, `${t}: ${a.name}`).toBeTruthy();
        expect(a.aiSharePct).toBe(Math.round(a.exposure * 100));
      }
      expect(alt.avoids.some((a: any) => /nursing care/.test(a.name))).toBe(false);
    }
  });

  it("catalogue: no safer route when the skills it avoids are not exposed (opsRole, aiQaRole); Priya's recon case still works", () => {
    const E = createEngine(seedGraph() as any, seedPersona as any);
    expect(E.saferAlternative("opsRole")).toBeNull();     // only avoided ERP, exposure 0.42
    expect(E.saferAlternative("aiQaRole")).toBeNull();    // only avoided Excel 0.48 and prompting 0.35
    const alt = E.saferAlternative("esgRole")!;
    expect(alt.route.key).toBe("ap>audit>disc>esgRole");
    expect(alt.avoids).toEqual([{ id: "recon", owned: true, exposure: 0.54, aiSharePct: 54, reason: "exposure" }]);
    for (const a of alt.avoids) expect(a.exposure).toBeGreaterThanOrEqual(PARAMS.saferMinExposure);
    // after an approved signal, recon is avoided because of the signal
    const sig = createEngine(seedGraph({ e: { recon: 0.05 } }) as any, seedPersona as any).saferAlternative("esgRole")!;
    expect(sig.avoids.find((a: any) => a.id === "recon")?.reason).toBe("signal");
    // and the API plan for Priya is unchanged
    const p = buildPlan(g, priya, { job: "esgRole", now: NOW });
    expect(p.route!.key).toBe("ap>recon>ghg>esgRole");
    expect(p.saferAlternative!.avoids.map((a: any) => a.name)).toEqual(["Vendor reconciliation"]);
  });
});

describe("current job for any profile", () => {
  it("a nurse's CV: the profile carries her ESCO job, not 'other job'", async () => {
    const llm = createMockLlm(cvLlmHandler({ prefer: [], jobTitle: "Staff Nurse", occupationId: "other" }));
    const s2 = await testServices({ llm, embed: createMockEmbedder(512) });
    const text = readFileSync(new URL("./fixtures/cv/staff-nurse.txt", import.meta.url), "utf8");
    const res = await request(createApp(s2)).post("/api/profile/intake").send({ text });
    expect(res.status).toBe(201);
    expect(res.body.profile.occupationId).toBe("other");
    expect(res.body.profile.currentEsco).toEqual({ id: occ("nurse responsible for general care"), title: "nurse responsible for general care" });
    const got = await request(createApp(s2)).get(`/api/profile/${res.body.profileId}`);
    expect(got.body.currentEsco.title).toBe("nurse responsible for general care");
  });

  it("job titles map to ESCO sensibly (rank words dropped, head noun first, skills break ties)", () => {
    expect(currentEscoFor("Registered Nurse")?.title).toBe("nurse responsible for general care");
    expect(currentEscoFor("Senior Staff Nurse (ICU)")?.title).toBe("nurse responsible for general care");
    expect(currentEscoFor("Software Engineer")?.title).toBe("software developer");
    expect(currentEscoFor("Retail Supervisor")?.title).toBe("shop supervisor");
    expect(currentEscoFor("Manager")).toBeNull(); // a lone generic word names no job
    expect(currentEscoFor("")).toBeNull();
  });

  it("the person can correct it (PUT /profile/:id currentEscoId)", async () => {
    const pid = await escoProfile([]);
    const id = searchOccupations("specialist nurse", 1)[0].id;
    const res = await request(app).put(`/api/profile/${pid}`).send({ currentEscoId: id });
    expect(res.status).toBe(200);
    expect(res.body.profile.currentEsco).toEqual({ id, title: "specialist nurse" });
    expect((await request(app).put(`/api/profile/${pid}`).send({ currentEscoId: "00000000-0000-0000-0000-000000000000" })).status).toBe(400);
  });
});

describe("best jobs: current job marked, default pick reachable", () => {
  it("a nurse: her own job is marked isCurrent, and the default pick is a reachable match, not a step down", async () => {
    const d = loadEsco()!;
    const nurse = occ("nurse responsible for general care");
    const mine = d.occupations[nurse].essential.filter((s: string) => d.skills[s].type !== "knowledge");
    const pid = await escoProfile(mine, nurse);
    const res = await request(app).get(`/api/esco/profile/${pid}/best-jobs`).query({ limit: 12 });
    expect(res.status).toBe(200);
    const b = res.body;
    expect(b.current).toEqual({ id: nurse, title: "nurse responsible for general care" });
    expect(b.jobs.find((j: any) => j.id === nurse)).toMatchObject({ isCurrent: true, pickScore: 0 });
    expect(b.defaultPick).toBeTruthy();
    expect(b.defaultPick).not.toBe(nurse);
    const pick = b.jobs.find((j: any) => j.id === b.defaultPick);
    expect(pick).toMatchObject({ isCurrent: false, stepDown: false });
    for (const j of b.jobs) expect(j).toMatchObject({ weeks: expect.any(Number), reach: expect.any(Number), gaps: expect.any(Number) });
    // no other eligible job scores higher, and the pick is not the longest road among good matches
    for (const j of b.jobs.filter((x: any) => !x.isCurrent && !x.stepDown)) expect(j.pickScore).toBeLessThanOrEqual(pick.pickScore);
    const anp = b.jobs.find((j: any) => j.title === "advanced nurse practitioner");
    if (anp) expect(pick.weeks).toBeLessThanOrEqual(anp.weeks);
    // nurse assistant is a lower ISCO skill level: listed, but marked
    const na = b.jobs.find((j: any) => j.title === "nurse assistant");
    if (na) expect(na.stepDown).toBe(true);
  });

  it("Priya's best-jobs still work (no current ESCO job on the sample persona) and her catalogue default is unchanged", async () => {
    const res = await request(app).get("/api/esco/profile/1/best-jobs");
    expect(res.status).toBe(200);
    expect(res.body.current).toBeNull();
    expect(res.body.jobs.every((j: any) => j.isCurrent === false)).toBe(true);
    const p = buildPlan(g, priya, { job: "stayRole", now: NOW });
    expect(p.route!.key).toBe("ap>excel>prompt>stayRole");
  });
});
