// Goal progress (docs/API.md "Goal progress"): goal, ticks that raise the profile and recompute the plan, proofs
// (check / advisor / credential), weekly check-ins and the on-track maths, the skills record, and the HR view of
// team members who chose to share. Every number is computed in code: no AI model is called (the mock LLM throws).
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.ts";
import { testServices } from "./helpers/services.ts";
import { paceOf, weekStartOf, practiseFor, nearWork, GOAL_PACE } from "../server/services/goal.ts";
import { searchOccupations, loadEsco } from "../server/services/esco.ts";
import { HR_SAMPLE_EMPLOYER } from "../server/seed/hr.ts";
import type { AuthVerifier } from "../server/lib/auth.ts";
import type { Services } from "../server/context.ts";

const JOB = "stayRole"; // AI-Assisted AP Specialist: for the sample persona's skills, two new skills to learn

let clock = new Date("2026-10-23T10:00:00Z");
let svc: Services;
let app: ReturnType<typeof createApp>;
beforeAll(async () => {
  svc = await testServices({ now: () => clock });
  app = createApp(svc);
});

/** A fresh non-demo profile with the sample persona's skills. */
async function newProfile(opts: { employerId?: number; hours?: number } = {}) {
  const id = (await svc.db.query<{ id: number }>("insert into profiles(display_name, current_occupation_id, hours_per_week, employer_id, is_demo) values ('Test person','ap',$1,$2,false) returning id",
    [opts.hours ?? 6, opts.employerId ?? null])).rows[0].id;
  await svc.db.query("insert into profile_skills select $1, skill_id, level, confidence, evidence from profile_skills where profile_id=1", [id]);
  return id;
}
const level = async (id: number, skill: string) => (await svc.db.query("select level, confidence from profile_skills where profile_id=$1 and skill_id=$2", [id, skill])).rows[0] ?? null;

describe("on-track maths (paceOf)", () => {
  const base = { setAt: "2026-10-01", hoursPerWeek: 6 };
  it("no check-ins: on track in the first week, behind once more than a week of study is missing", () => {
    expect(paceOf({ ...base, today: "2026-10-01", checkIns: [] })).toMatchObject({ status: "on_track", daysElapsed: 0, expectedHours: 0, studiedHours: 0, lastCheckIn: null });
    expect(paceOf({ ...base, today: "2026-10-08", checkIns: [] })).toMatchObject({ status: "on_track", expectedHours: 6, differenceHours: -6 }); // exactly one week short
    expect(paceOf({ ...base, today: "2026-10-09", checkIns: [] })).toMatchObject({ status: "behind", expectedHours: 6.9, differenceHours: -6.9, toleranceHours: 6 * GOAL_PACE.toleranceWeeks });
  });
  it("counts check-ins from the week the goal was set; ahead when more than a week of study over", () => {
    const checkIns = [{ weekStart: "2026-09-21", hours: 40 }, { weekStart: "2026-09-28", hours: 10 }, { weekStart: "2026-10-05", hours: 10 }, { weekStart: "2026-10-12", hours: 10 }];
    // 2026-10-01 is a Thursday: its week starts Monday 2026-09-28; the 40 h before that don't count.
    const p = paceOf({ ...base, today: "2026-10-15", checkIns });
    expect(p).toMatchObject({ status: "ahead", daysElapsed: 14, weeksElapsed: 2, expectedHours: 12, studiedHours: 30, differenceHours: 18, checkInsCounted: 3 });
    expect(p.lastCheckIn).toEqual({ weekStart: "2026-10-12", hours: 10 });
    expect(paceOf({ ...base, today: "2026-10-15", checkIns: [{ weekStart: "2026-09-28", hours: 10 }, { weekStart: "2026-10-05", hours: 6 }] }))
      .toMatchObject({ status: "on_track", studiedHours: 16, differenceHours: 4 }); // within a week (6 h) of the 12 h expected
  });
  it("weeks start on Monday", () => {
    expect(weekStartOf("2026-10-01")).toBe("2026-09-28");
    expect(weekStartOf("2026-09-28")).toBe("2026-09-28");
    expect(weekStartOf("2026-10-04")).toBe("2026-09-28"); // Sunday
  });
});

describe("GET/PUT/DELETE /api/profile/:id/goal", () => {
  it("no goal yet: goal null; the sample persona can be read but not changed", async () => {
    const id = await newProfile();
    expect((await request(app).get(`/api/profile/${id}/goal`)).body).toMatchObject({ profileId: id, readOnly: false, goal: null, steps: [], pace: null });
    const demo = await request(app).get("/api/profile/1/goal");
    expect(demo.body).toMatchObject({ profileId: 1, readOnly: true, goal: null });
    const put = await request(app).put("/api/profile/1/goal").send({ job: JOB });
    expect(put.status).toBe(403);
    expect(put.body.error.code).toBe("demo_profile_read_only");
    expect((await request(app).post("/api/profile/1/checkins").send({ weekStart: "2026-10-19", hours: 3 })).status).toBe(403);
    expect((await request(app).get("/api/profile/99999/goal")).status).toBe(404);
  });

  it("sets a catalogue goal: steps from the plan with hours, weeks and practise tasks; validates the job", async () => {
    const id = await newProfile();
    expect((await request(app).put(`/api/profile/${id}/goal`).send({ job: "nope" })).status).toBe(400);
    expect((await request(app).put(`/api/profile/${id}/goal`).send({ job: JOB, mode: "sideways" })).status).toBe(400);
    const res = await request(app).put(`/api/profile/${id}/goal`).send({ job: JOB });
    expect(res.status).toBe(200);
    const plan = (await request(app).get(`/api/plan?profile=${id}&job=${JOB}`)).body;
    expect(res.body).toMatchObject({ goal: { job: JOB, title: plan.title, source: "catalogue", mode: "closest", setAt: "2026-10-23" },
      match: plan.match, weeksLeft: plan.weeks, progress: { done: 0, total: plan.missing.length, verified: 0 }, pace: { status: "on_track" } });
    expect(res.body.steps.map((s: any) => s.skillId)).toEqual(plan.missing.map((m: any) => m.id));
    for (const s of res.body.steps) {
      expect(s).toMatchObject({ name: expect.any(String), hours: expect.any(Number), weeks: expect.any(Number), done: false, doneAt: null, verified: false, proofs: [] });
      expect(s.practise.length).toBeLessThanOrEqual(2);
    }
    expect((await request(app).get(`/api/profile/${id}/goal`)).body.goal.job).toBe(JOB);
  });

  it("same job: changing the mode keeps the date and ticks; a new job resets the ticks and the date", async () => {
    const id = await newProfile();
    await request(app).put(`/api/profile/${id}/goal`).send({ job: JOB });
    const sid = (await request(app).get(`/api/profile/${id}/goal`)).body.steps[0].skillId;
    await request(app).post(`/api/profile/${id}/goal/steps/${sid}`).send({ done: true });
    clock = new Date("2026-11-02T10:00:00Z");
    try {
      let res = await request(app).put(`/api/profile/${id}/goal`).send({ job: JOB, mode: "safest" });
      expect(res.body.goal).toMatchObject({ mode: "safest", setAt: "2026-10-23" });
      expect(res.body.progress.done).toBe(1);
      res = await request(app).put(`/api/profile/${id}/goal`).send({ job: "opsRole" });
      expect(res.body.goal).toMatchObject({ job: "opsRole", mode: "closest", setAt: "2026-11-02" });
      expect(res.body.progress.done).toBe(0);
      expect(res.body.steps.every((s: any) => !s.done)).toBe(true);
      expect(await level(id, sid)).not.toBeNull(); // what you learned stays learned
    } finally { clock = new Date("2026-10-23T10:00:00Z"); }
  });

  it("DELETE clears the goal", async () => {
    const id = await newProfile();
    await request(app).put(`/api/profile/${id}/goal`).send({ job: JOB });
    expect((await request(app).delete(`/api/profile/${id}/goal`)).body).toEqual({ profileId: id, goal: null });
    expect((await request(app).get(`/api/profile/${id}/goal`)).body.goal).toBeNull();
  });
});

describe("POST /api/profile/:id/goal/steps/:skillId", () => {
  it("a tick raises the skill and returns match and weeks before and after (from the plan code); an untick undoes it", async () => {
    const id = await newProfile();
    const set = (await request(app).put(`/api/profile/${id}/goal`).send({ job: JOB })).body;
    const step = set.steps[0];
    expect(await level(id, step.skillId)).toBeNull();
    const res = await request(app).post(`/api/profile/${id}/goal/steps/${step.skillId}`).send({ done: true });
    expect(res.status).toBe(200);
    const plan = (await request(app).get(`/api/plan?profile=${id}&job=${JOB}`)).body;
    expect(res.body.change).toEqual({ skillId: step.skillId, done: true, levelChanged: true,
      before: { match: set.match, weeks: set.weeksLeft }, after: { match: plan.match, weeks: plan.weeks } });
    expect(res.body.change.after.match).toBeGreaterThan(res.body.change.before.match);
    expect(res.body.change.after.weeks).toBeLessThan(res.body.change.before.weeks);
    expect((await level(id, step.skillId)).level).toBeGreaterThanOrEqual(1);
    // the done step has left the plan's gap list but is still a step (last), with its hours
    const done = res.body.steps.find((s: any) => s.skillId === step.skillId);
    expect(done).toMatchObject({ done: true, doneAt: "2026-10-23T10:00:00.000Z", hours: step.hours, verified: false });
    expect(res.body.progress).toMatchObject({ done: 1, total: set.progress.total });

    const undo = await request(app).post(`/api/profile/${id}/goal/steps/${step.skillId}`).send({ done: false });
    expect(undo.body.change).toMatchObject({ done: false, levelChanged: true, after: { match: set.match, weeks: set.weeksLeft } });
    expect(await level(id, step.skillId)).toBeNull();
    expect(undo.body.progress.done).toBe(0);
  });

  it("errors: unknown skill or not a step (404), no goal (409), bad body (400)", async () => {
    const id = await newProfile();
    let res = await request(app).post(`/api/profile/${id}/goal/steps/prompt`).send({ done: true });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("no_goal");
    await request(app).put(`/api/profile/${id}/goal`).send({ job: JOB });
    res = await request(app).post(`/api/profile/${id}/goal/steps/not-a-skill`).send({ done: true });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_a_step");
    expect((await request(app).post(`/api/profile/${id}/goal/steps/inv`).send({ done: true })).status).toBe(404); // a skill you have: not a step
    expect((await request(app).post(`/api/profile/${id}/goal/steps/prompt`).send({ done: "yes" })).status).toBe(400);
    expect((await request(app).post(`/api/profile/${id}/goal/steps/prompt`).send({})).status).toBe(400);
  });

  it("ESCO goal: a tick adds the ESCO skill; practise tasks are real O*NET statements", async () => {
    const id = await newProfile();
    const occ = searchOccupations("data analyst")[0];
    const set = (await request(app).put(`/api/profile/${id}/goal`).send({ job: occ.id })).body; // a bare uuid works too
    expect(set.goal).toMatchObject({ job: `esco:${occ.id}`, source: "esco" });
    const d = loadEsco()!;
    const all = new Set(Object.values(d.onetTasks).flatMap(o => o.tasks.map(t => t[0])));
    const withTasks = set.steps.filter((s: any) => s.practise.length);
    expect(withTasks.length).toBeGreaterThan(0);
    for (const s of withTasks) for (const p of s.practise) {
      expect(all.has(p.text)).toBe(true);
      expect(d.onetTasks[p.onet].title).toBe(p.occupation);
    }
    const key = set.steps.find((s: any) => s.key && !s.skillId.startsWith("ai:"));
    const res = await request(app).post(`/api/profile/${id}/goal/steps/${key.skillId}`).send({ done: true });
    expect(res.body.change.levelChanged).toBe(true);
    expect(res.body.change.after.match).toBeGreaterThanOrEqual(res.body.change.before.match);
    expect((await svc.db.query("select source from profile_esco_skills where profile_id=$1 and skill_id=$2", [id, key.skillId])).rows).toEqual([{ source: "self" }]);
    await request(app).post(`/api/profile/${id}/goal/steps/${key.skillId}`).send({ done: false });
    expect((await svc.db.query("select 1 from profile_esco_skills where profile_id=$1 and skill_id=$2", [id, key.skillId])).rows).toEqual([]);
  });

  it("practiseFor: at most 2, none for a skill with no linked task or without a goal job", () => {
    const occ = searchOccupations("data analyst")[0];
    expect(practiseFor("no-such-skill", `esco:${occ.id}`)).toEqual([]);
    const ess = loadEsco()!.occupations[occ.id].essential as string[];
    const some = ess.map(s => practiseFor(s, `esco:${occ.id}`)).find(x => x.length);
    expect(some!.length).toBeLessThanOrEqual(2);
    expect(ess.flatMap(s => practiseFor(s, null))).toEqual([]);
  });

  it("practiseFor: off-topic tasks a reviewer found are excluded; tasks come only from work like the goal job's", () => {
    const esco = (q: string) => `esco:${searchOccupations(q)[0].id}`;
    const occupationsOf = (skill: string, job: string) => practiseFor(skill, job).map(p => p.occupation);
    const catalogueJobs = ["stayRole", "opsRole", "faRole", "esgRole", "intAudit", "dataRole", "biRole", "aiQaRole", "procRole", "scmRole", "invRole"];
    for (const job of catalogueJobs) {
      // "Supervising AI workflows" and "Workflow automation" used to get machine operators' tasks (catalogue link 0.69)
      for (const s of ["aisup", "auto"]) expect(occupationsOf(s, job).join("|")).not.toMatch(/Machine|Textile|Grinding/);
      // ERP used to get a mechatronics technician's and a power plant operator's record keeping
      expect(occupationsOf("erp", job).join("|")).not.toMatch(/Mechatronics|Power Plant/);
    }
    const nurse = esco("nurse responsible for general care"), bus = esco("bus driver");
    const near = (job: string) => new Set([...nearWork(job).near]);
    for (const [job, skills] of [[nurse, loadEsco()!.occupations[nurse.slice(5)].essential], [bus, loadEsco()!.occupations[bus.slice(5)].essential]] as [string, string[]][]) {
      for (const s of skills) for (const p of practiseFor(s, job)) expect(near(job).has(p.onet)).toBe(true);
    }
    const busAll = loadEsco()!.occupations[bus.slice(5)];
    const busTasks = [...busAll.essential, ...busAll.optional].flatMap((s: string) => practiseFor(s, bus).map(p => p.occupation)).join("|");
    expect(busTasks).not.toMatch(/Flight Attendants|Airline Pilots|Switchboard|Pharmacy/);
    const nurseAll = loadEsco()!.occupations[nurse.slice(5)];
    expect([...nurseAll.essential, ...nurseAll.optional].flatMap((s: string) => practiseFor(s, nurse).map(p => p.occupation)).join("|")).not.toMatch(/Audiologists|Veterinarians|Radiation Therapists/);
    // the finance analyst's "Financial analysis" step keeps its own job's task
    expect(practiseFor("fin", "faRole")[0]).toMatchObject({ occupation: "Financial and Investment Analysts" });
  });
});

describe("proofs", () => {
  it("credential: https only, length limits; ticks the step but never verifies it; removing the last proof unticks it", async () => {
    const id = await newProfile();
    const sid = (await request(app).put(`/api/profile/${id}/goal`).send({ job: JOB })).body.steps[0].skillId;
    const post = (body: any) => request(app).post(`/api/profile/${id}/goal/steps/${sid}/proof`).send(body);
    for (const bad of [
      { kind: "credential", url: "http://example.com/cert", title: "Certificate" },
      { kind: "credential", url: "javascript:alert(1)", title: "Certificate" },
      { kind: "credential", url: "not a url", title: "Certificate" },
      { kind: "credential", url: `https://example.com/${"x".repeat(500)}`, title: "Certificate" },
      { kind: "credential", url: "https://example.com/cert", title: "x".repeat(121) },
      { kind: "credential", url: "https://example.com/cert", title: "" },
      { kind: "check", url: "https://example.com/cert", title: "Certificate" },
    ]) expect((await post(bad)).status).toBe(400);
    expect((await request(app).post(`/api/profile/${id}/goal/steps/inv/proof`).send({ kind: "credential", url: "https://example.com/c", title: "Cert" })).status).toBe(404);
    const res = await post({ kind: "credential", url: "https://learn.example.org/cert/123", title: "Prompting for finance" });
    expect(res.status).toBe(201);
    const step = res.body.steps.find((s: any) => s.skillId === sid);
    expect(step).toMatchObject({ verified: false, done: true });
    expect(res.body.change).toEqual({ skillId: sid, goal: true, stay: expect.any(Boolean) });
    expect(step.proofs).toEqual([{ id: expect.any(Number), kind: "credential", by: "learn.example.org", at: "2026-10-23T10:00:00.000Z", url: "https://learn.example.org/cert/123", title: "Prompting for finance" }]);
    const withProvider = await post({ kind: "credential", url: "https://x.example/c", title: "Another", provider: "Coursera" });
    const second = withProvider.body.steps.find((s: any) => s.skillId === sid).proofs[1];
    expect(second.by).toBe("Coursera");
    const del = await request(app).delete(`/api/profile/${id}/goal/steps/${sid}/proof/${step.proofs[0].id}`);
    expect(del.status).toBe(200);
    const after1 = del.body.steps.find((s: any) => s.skillId === sid);
    expect(after1.proofs).toHaveLength(1);
    expect(after1.done).toBe(true); // another certificate still backs it
    expect((await request(app).delete(`/api/profile/${id}/goal/steps/${sid}/proof/${step.proofs[0].id}`)).status).toBe(404);
    const del2 = await request(app).delete(`/api/profile/${id}/goal/steps/${sid}/proof/${second.id}`);
    expect(del2.body.change).toEqual({ skillId: sid, undone: true });
    expect(del2.body.steps.find((s: any) => s.skillId === sid)).toMatchObject({ done: false, proofs: [] });
  });

  it("a certificate or a passed check ticks a skill on the stay track, with no goal set", async () => {
    const id = await newProfile();
    const stay = (await request(app).get(`/api/profile/${id}/stay`)).body;
    expect(stay.done).toEqual([]);
    // the stay track the server computes for this profile (the same one the app shows)
    const { stayItems } = await import("../server/services/goal.ts");
    const { loadGraph } = await import("../server/kb.ts");
    const { loadProfile } = await import("../server/repo.ts");
    const items = (await stayItems(svc, await loadGraph(svc.db), (await loadProfile(svc.db, id))!)).items;
    expect(items.length).toBeGreaterThan(1);
    const [a, b] = items;
    const res = await request(app).post(`/api/profile/${id}/goal/steps/${encodeURIComponent(a.id)}/proof`).send({ kind: "credential", url: "https://learn.example.org/c/9", title: "Cert" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ goal: null, change: { skillId: a.id, goal: false, stay: true } });
    expect((await request(app).get(`/api/profile/${id}/stay`)).body.done.map((d: any) => d.skillId)).toContain(a.id);
    // not on the stay track and no goal: still refused
    expect((await request(app).post(`/api/profile/${id}/goal/steps/zzz/proof`).send({ kind: "credential", url: "https://x.example/c", title: "Cert" })).status).toBe(409);
    if (b) {
      const check = await request(app).get(`/api/skills/${encodeURIComponent(b.id)}/check?profile=${id}`);
      expect(check.status).toBe(200); {
        const answers = (await svc.db.query("select answer_key from skill_checks where id=$1", [check.body.checkId])).rows[0].answer_key;
        const out = await request(app).post(`/api/skills/${encodeURIComponent(b.id)}/check`).send({ profileId: id, checkId: check.body.checkId, answers });
        expect(out.body).toMatchObject({ passed: true, stay: true });
        expect((await request(app).get(`/api/profile/${id}/stay`)).body.done.map((d: any) => d.skillId)).toContain(b.id);
      }
    }
  });

  it("passing the skill check on a goal step records { kind:'check' } and ticks the step, verified", async () => {
    const id = await newProfile();
    const set = (await request(app).put(`/api/profile/${id}/goal`).send({ job: JOB })).body;
    expect(set.steps.map((s: any) => s.skillId)).toContain("prompt");
    const check = (await request(app).get(`/api/skills/prompt/check?profile=${id}`)).body;
    const answers = (await svc.db.query("select answer_key from skill_checks where id=$1", [check.checkId])).rows[0].answer_key;
    const res = await request(app).post("/api/skills/prompt/check").send({ profileId: id, checkId: check.checkId, answers });
    expect(res.body).toMatchObject({ passed: true, goalSteps: ["prompt"] });
    const goal = (await request(app).get(`/api/profile/${id}/goal`)).body;
    const step = goal.steps.find((s: any) => s.skillId === "prompt");
    expect(step).toMatchObject({ done: true, verified: true });
    expect(step.proofs).toEqual([expect.objectContaining({ kind: "check", by: "HalaTuju skill check", at: "2026-10-23T10:00:00.000Z" })]);
    expect(await level(id, "prompt")).toMatchObject({ confidence: "verified" });
    expect(goal.progress.verified).toBe(1);
  });

  it("a check on a skill that is not a goal step records nothing", async () => {
    const id = await newProfile();
    await request(app).put(`/api/profile/${id}/goal`).send({ job: JOB });
    const check = (await request(app).get(`/api/skills/recon/check?profile=${id}`)).body;
    const answers = (await svc.db.query("select answer_key from skill_checks where id=$1", [check.checkId])).rows[0].answer_key;
    const res = await request(app).post("/api/skills/recon/check").send({ profileId: id, checkId: check.checkId, answers });
    expect(res.body).toMatchObject({ passed: true, goalSteps: [] });
    expect((await svc.db.query("select count(*)::int as n from skill_proofs where profile_id=$1", [id])).rows[0].n).toBe(0);
  });
});

describe("POST /api/profile/:id/checkins", () => {
  it("one per week (upsert, any day of the week), no future weeks, and the pace follows", async () => {
    const id = await newProfile({ hours: 5 });
    expect((await request(app).post(`/api/profile/${id}/checkins`).send({ weekStart: "2026-10-19", hours: 3 })).status).toBe(409); // no goal
    await svc.db.query("insert into goals(profile_id, job, mode, set_at) values ($1,$2,'closest','2026-10-05')", [id, JOB]);
    for (const bad of [{ weekStart: "2026-10-19", hours: -1 }, { weekStart: "2026-10-19", hours: 81 }, { weekStart: "19/10/2026", hours: 3 }, { hours: 3 }, { weekStart: "2026-10-26", hours: 3 }])
      expect((await request(app).post(`/api/profile/${id}/checkins`).send(bad)).status).toBe(400);
    let res = await request(app).post(`/api/profile/${id}/checkins`).send({ weekStart: "2026-10-21", hours: 2 });
    expect(res.body.checkIn).toEqual({ weekStart: "2026-10-19", hours: 2 });
    res = await request(app).post(`/api/profile/${id}/checkins`).send({ weekStart: "2026-10-19", hours: 4.25 });
    expect(res.body.checkIns).toEqual([{ weekStart: "2026-10-19", hours: 4.3 }]);
    // set 2026-10-05, today 2026-10-23: 18 days -> 5 x 18 / 7 = 12.9 h expected, 4.3 studied: more than a week (5 h) short
    expect(res.body.pace).toMatchObject({ status: "behind", daysElapsed: 18, expectedHours: 12.9, studiedHours: 4.3, differenceHours: -8.6, toleranceHours: 5 });
    await request(app).post(`/api/profile/${id}/checkins`).send({ weekStart: "2026-10-12", hours: 6 });
    const goal = (await request(app).get(`/api/profile/${id}/goal`)).body;
    expect(goal.pace).toMatchObject({ status: "on_track", studiedHours: 10.3, lastCheckIn: { weekStart: "2026-10-19", hours: 4.3 } });
    expect(goal.checkIns).toHaveLength(2);
  });
});

describe("the Stay AI-ready track: GET /api/profile/:id/stay, POST /api/profile/:id/stay/:skillId", () => {
  it("catalogue track: a tick raises the skill like a goal step and is kept; an untick undoes it; only the track's skills", async () => {
    const id = await newProfile();
    expect((await request(app).get(`/api/profile/${id}/stay`)).body).toEqual({ profileId: id, readOnly: false, done: [] });
    // the persona's skills fit the "stay & adapt" job: its missing skills are the track (as web/js/features/stay.js shows)
    const plan = (await request(app).get(`/api/plan?profile=${id}&job=${JOB}`)).body;
    const item = plan.missing[0];
    expect(await level(id, item.id)).toBeNull();
    const res = await request(app).post(`/api/profile/${id}/stay/${item.id}`).send({ done: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ change: { skillId: item.id, done: true, levelChanged: true }, profileId: id,
      done: [{ skillId: item.id, name: item.name, doneAt: "2026-10-23T10:00:00.000Z", hours: item.hours }] });
    expect((await level(id, item.id)).level).toBe(item.levelTo ?? 3);
    // My skills and every match follow: the job's plan no longer lists it
    expect((await request(app).get(`/api/plan?profile=${id}&job=${JOB}`)).body.missing.map((m: any) => m.id)).not.toContain(item.id);
    // still listed after it left the track, and can be unticked
    expect((await request(app).get(`/api/profile/${id}/stay`)).body.done.map((d: any) => d.skillId)).toEqual([item.id]);
    const undo = await request(app).post(`/api/profile/${id}/stay/${item.id}`).send({ done: false });
    expect(undo.body).toMatchObject({ change: { done: false, levelChanged: true }, done: [] });
    expect(await level(id, item.id)).toBeNull();
    // a goal change never clears the stay ticks
    await request(app).post(`/api/profile/${id}/stay/${item.id}`).send({ done: true });
    await request(app).put(`/api/profile/${id}/goal`).send({ job: "faRole" });
    await request(app).put(`/api/profile/${id}/goal`).send({ job: "esgRole" });
    expect((await request(app).get(`/api/profile/${id}/stay`)).body.done.length).toBe(1);

    const bad = await request(app).post(`/api/profile/${id}/stay/ghg`).send({ done: true });
    expect(bad.status).toBe(404);
    expect(bad.body.error.code).toBe("not_on_stay_track");
    expect((await request(app).post(`/api/profile/${id}/stay/${item.id}`).send({ done: "yes" })).status).toBe(400);
    expect((await request(app).get("/api/profile/99999/stay")).status).toBe(404);
  });

  it("the sample persona can read it but not tick (its ticks stay in the browser)", async () => {
    expect((await request(app).get("/api/profile/1/stay")).body).toEqual({ profileId: 1, readOnly: true, done: [] });
    const r = await request(app).post("/api/profile/1/stay/prompt").send({ done: true });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("demo_profile_read_only");
  });

  it("ESCO track (from the skill outlook): a tick on an ESCO skill adds it to your ESCO skills", async () => {
    const occ = searchOccupations("accountant")[0];
    const id = (await svc.db.query<{ id: number }>("insert into profiles(display_name, current_occupation_id, current_esco_id, hours_per_week, is_demo) values ('Accountant','other',$1,6,false) returning id", [occ.id])).rows[0].id;
    for (const s of loadEsco()!.occupations[occ.id].essential.slice(0, 12)) await svc.db.query("insert into profile_esco_skills(profile_id, skill_id, source) values ($1,$2,'cv')", [id, s]);
    const o = (await request(app).get(`/api/esco/profile/${id}/outlook`)).body;
    expect(o.stay.items.length).toBeGreaterThan(0);
    const esco = o.stay.items.find((x: any) => !x.id.startsWith("ai:"));
    const ai = o.stay.items.find((x: any) => x.id.startsWith("ai:"));
    if (esco) {
      const r = await request(app).post(`/api/profile/${id}/stay/${esco.id}`).send({ done: true });
      expect(r.body.change).toMatchObject({ done: true, levelChanged: true });
      expect((await svc.db.query("select source from profile_esco_skills where profile_id=$1 and skill_id=$2", [id, esco.id])).rows).toEqual([{ source: "self" }]);
    }
    if (ai) {
      const r = await request(app).post(`/api/profile/${id}/stay/${encodeURIComponent(ai.id)}`).send({ done: true });
      expect(r.status).toBe(200);
      expect(r.body.done.map((d: any) => d.skillId)).toContain(ai.id);
    }
    expect(esco || ai).toBeTruthy();
  });
});

describe("GET /api/profile/:id/record", () => {
  it("skills with level, who vouches and when, credential links, and sources", async () => {
    const id = await newProfile();
    const sid = (await request(app).put(`/api/profile/${id}/goal`).send({ job: JOB })).body.steps[0].skillId;
    await request(app).post(`/api/profile/${id}/goal/steps/${sid}/proof`).send({ kind: "credential", url: "https://learn.example.org/c/1", title: "Course certificate" });
    const res = await request(app).get(`/api/profile/${id}/record`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ profileId: id, name: "Test person", isSample: false, asOf: "2026-10-23", goal: { job: JOB, setAt: "2026-10-23" } });
    const inv = res.body.skills.find((s: any) => s.skillId === "inv");
    expect(inv).toMatchObject({ source: "catalogue", level: expect.any(Number), basis: expect.any(String), held: true, proofs: [] });
    const cred = res.body.skills.find((s: any) => s.skillId === sid);
    // the certificate ticked the step, so the skill is held, but a certificate alone never makes it verified
    expect(cred).toMatchObject({ verified: false, proofs: [expect.objectContaining({ kind: "credential", by: "learn.example.org", url: "https://learn.example.org/c/1" })] });
    expect(res.body.sources).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "credential", url: "https://learn.example.org/c/1" }), expect.objectContaining({ kind: "catalogue" })]));
    expect(res.body.counts.credentials).toBe(1);
    expect((await request(app).get("/api/profile/1/record")).body).toMatchObject({ profileId: 1, isSample: true });
  });
});

describe("share_progress and GET /api/hr/:employerId/progress", () => {
  it("lists only team members who turned sharing on", async () => {
    const emp = (await svc.db.query<{ id: number }>("select id from employers where name=$1", [HR_SAMPLE_EMPLOYER])).rows[0].id;
    const a = await newProfile({ employerId: emp }), b = await newProfile({ employerId: emp });
    for (const id of [a, b]) await request(app).put(`/api/profile/${id}/goal`).send({ job: JOB });
    await request(app).post(`/api/profile/${a}/checkins`).send({ weekStart: "2026-10-19", hours: 3 });
    // the seed's sample team has three members who share (server/seed/hr.ts); look only at the two made here
    const ours = (r: any) => r.body.members.filter((m: any) => [a, b].includes(m.profileId));
    let res = await request(app).get(`/api/hr/${emp}/progress`);
    expect(res.status).toBe(200);
    expect(ours(res)).toEqual([]); // nobody shares by default
    expect(res.body.notSharing).toBeGreaterThanOrEqual(2);
    const put = await request(app).put(`/api/profile/${a}`).send({ shareProgress: true });
    expect(put.body.profile.shareProgress).toBe(true);
    expect((await request(app).put(`/api/profile/${a}`).send({ shareProgress: "yes" })).status).toBe(400);
    const sid = (await request(app).get(`/api/profile/${a}/goal`)).body.steps[0].skillId;
    await request(app).post(`/api/profile/${a}/goal/steps/${sid}`).send({ done: true });
    res = await request(app).get(`/api/hr/${emp}/progress`);
    expect(ours(res).map((m: any) => m.profileId)).toEqual([a]);
    expect(ours(res)[0]).toMatchObject({ name: "Test person", goal: { job: JOB }, stepsDone: 1, stepsTotal: expect.any(Number), verified: 0,
      lastCheckIn: { weekStart: "2026-10-19", hours: 3 }, status: "on_track" });
    await request(app).put(`/api/profile/${a}`).send({ shareProgress: false });
    expect(ours(await request(app).get(`/api/hr/${emp}/progress`))).toEqual([]);
    expect((await request(app).get("/api/hr/99999/progress")).status).toBe(404);
  });
});

describe("advisor confirmation and permissions (accounts on)", () => {
  const USERS: Record<string, { id: string; email: string }> = {
    "tok-a": { id: "user_a", email: "a@example.com" },
    "tok-adv": { id: "user_advisor", email: "advisor@example.com" },
  };
  const mockAuth: AuthVerifier = async token => USERS[token] ?? null;
  let asvc: Services, aapp: ReturnType<typeof createApp>, worker: number, sid: string;
  beforeAll(async () => {
    asvc = await testServices({ auth: mockAuth, config: { clerkEnabled: true, clerkPublishableKey: "pk_test_mock", advisorEmails: ["advisor@example.com"], adminToken: "script-token" } });
    aapp = createApp(asvc);
    worker = (await asvc.db.query<{ id: number }>("insert into profiles(display_name, current_occupation_id, hours_per_week, auth_user_id, is_demo) values ('Worker','ap',6,'user_worker',false) returning id")).rows[0].id;
    await asvc.db.query("insert into profile_skills select $1, skill_id, level, confidence, evidence from profile_skills where profile_id=1", [worker]);
    const set = await request(aapp).put(`/api/profile/${worker}/goal`).set("x-admin-token", "script-token").send({ job: JOB });
    sid = set.body.steps[0].skillId;
  });
  const confirm = (tok?: string) => {
    const r = request(aapp).post(`/api/advisor/profiles/${worker}/goal/steps/${sid}/confirm`);
    if (tok) r.set("Authorization", `Bearer ${tok}`);
    return r.send({ name: "Puan Aminah (advisor)" });
  };

  it("someone else can't change a worker's goal; signed out 401, no advisor role 403", async () => {
    expect((await request(aapp).put(`/api/profile/${worker}/goal`).set("Authorization", "Bearer tok-a").send({ job: JOB })).status).toBe(403);
    expect((await request(aapp).post(`/api/profile/${worker}/goal/steps/${sid}`).set("Authorization", "Bearer tok-adv").send({ done: true })).status).toBe(403); // staff read, never write
    expect((await confirm()).status).toBe(401);
    const denied = await confirm("tok-a");
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("forbidden");
    expect((await request(aapp).get(`/api/hr/1/progress`).set("Authorization", "Bearer tok-a")).status).toBe(403);
  });

  it("an advisor confirms: proof { kind:'advisor', by:<name> }, the step is ticked and verified", async () => {
    const res = await confirm("tok-adv");
    expect(res.status).toBe(200);
    expect(res.body.change).toMatchObject({ skillId: sid, done: true });
    expect(res.body.change.after.match).toBeGreaterThan(res.body.change.before.match);
    const step = res.body.steps.find((s: any) => s.skillId === sid);
    expect(step).toMatchObject({ done: true, verified: true });
    expect(step.proofs).toEqual([expect.objectContaining({ kind: "advisor", by: "Puan Aminah (advisor)" })]);
    expect((await asvc.db.query("select confidence from profile_skills where profile_id=$1 and skill_id=$2", [worker, sid])).rows[0].confidence).toBe("verified");
    expect((await request(aapp).post(`/api/advisor/profiles/${worker}/goal/steps/inv/confirm`).set("Authorization", "Bearer tok-adv").send({})).status).toBe(404);
    expect((await request(aapp).post(`/api/advisor/profiles/1/goal/steps/${sid}/confirm`).set("Authorization", "Bearer tok-adv").send({})).status).toBe(403); // sample persona
  });
});
