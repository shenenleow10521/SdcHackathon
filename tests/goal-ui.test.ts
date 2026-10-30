// My goal: the pure date maths and wording (web/js/features/track-text.js), and the sample team's shared progress
// (server/seed/hr.ts) that the HR "Team progress" table shows.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
// @ts-ignore — plain ES module shared with the browser
import * as TT from "../web/js/features/track-text.js";
import { createApp } from "../server/app.ts";
import { testServices } from "./helpers/services.ts";
import { HR_SAMPLE_EMPLOYER } from "../server/seed/hr.ts";

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web");
const dict = (l: string) => JSON.parse(readFileSync(path.join(web, `i18n/${l}.json`), "utf8")) as Record<string, string>;
const tFor = (d: Record<string, string>) => (k: string, v: Record<string, unknown> = {}) => (d[k] ?? k).replace(/\{(\w+)\}/g, (m, x) => (v[x] != null ? String(v[x]) : m));
const t = tFor(dict("en")), tMs = tFor(dict("ms"));
const { scheduleSteps, dateRange, dayMonth, changeText, paceText, weekHours, progressLine, okCredentialUrl, mondayOf } = TT as any;

describe("planned dates", () => {
  it("schedules the steps still to do one after another at your hours a week", () => {
    const steps = [{ hours: 12, done: false }, { hours: 6, done: true }, { hours: 3, done: false }, { hours: null, done: false }, { hours: 18, done: false }];
    const s = scheduleSteps(steps, 6, "2026-11-04");
    expect(s[0]).toEqual({ start: "2026-11-04", end: "2026-11-17", days: 14 });   // 12 h at 6 h/week = 2 weeks
    expect(s[1]).toBeNull();                                                      // done
    expect(s[2]).toEqual({ start: "2026-11-18", end: "2026-11-21", days: 4 });    // 3 h = half a week, rounded up to whole days
    expect(s[3]).toBeNull();                                                      // no hours: no dates, nothing moves
    expect(s[4].start).toBe("2026-11-22");
    expect(scheduleSteps([{ hours: 0.1, done: false }], 40, "2026-01-01")[0].days).toBe(1);
  });

  it("reads like a calendar: '4 to 15 Nov', across months and years", () => {
    expect(dateRange("2026-11-04", "2026-11-15", t, "en", 2026)).toBe("4 to 15 Nov");
    expect(dateRange("2026-10-28", "2026-11-03", t, "en", 2026)).toBe("28 Oct to 3 Nov");
    expect(dateRange("2026-12-28", "2027-01-05", t, "en", 2026)).toBe("28 Dec 2026 to 5 Jan 2027");
    expect(dateRange("2026-11-04", "2026-11-04", t, "en", 2026)).toBe("4 Nov");
    expect(dateRange("2026-11-04", "2026-11-15", tMs, "ms", 2026)).toBe("4 hingga 15 Nov");
    expect(dayMonth("2026-10-05", "en", 2026)).toBe("5 Oct");
    expect(mondayOf("2026-10-30")).toBe("2026-10-26");
    expect(mondayOf("2026-10-26")).toBe("2026-10-26");
  });
});

describe("wording", () => {
  it("the tick toast from the server's change, without a middle dot", () => {
    expect(changeText({ before: { match: 48, weeks: 10 }, after: { match: 56, weeks: 8 } }, t)).toBe("Match 48% → 56%. 8 weeks left.");
    expect(changeText({ before: { match: 56, weeks: 8 }, after: { match: 56, weeks: 1 } }, t)).toBe("Match stays at 56%. 1 week left.");
    expect(changeText({ before: { match: 90, weeks: 1 }, after: { match: 100, weeks: 0 } }, t)).toBe("Match 90% → 100%. Job-ready.");
    expect(changeText({ before: { match: 48, weeks: 10 }, after: { match: 56, weeks: 8 } }, tMs)).toBe("Padanan 48% → 56%. 8 minggu lagi.");
  });

  it("pace in plain words with its numbers", () => {
    const base = { setAt: "2026-10-05", daysElapsed: 15, hoursPerWeek: 6, toleranceHours: 6 };
    expect(paceText({ ...base, status: "on_track", expectedHours: 12.9, studiedHours: 12, differenceHours: -0.9 }, t, "en", 2026))
      .toEqual({ status: "on_track", head: "On track", line: "12 of 13 hours studied since 5 Oct" });
    expect(paceText({ ...base, status: "behind", expectedHours: 13, studiedHours: 4, differenceHours: -9 }, t, "en", 2026).head).toBe("Behind by 9 hours");
    expect(paceText({ ...base, status: "ahead", expectedHours: 13, studiedHours: 21, differenceHours: 8 }, t, "en", 2026).head).toBe("Ahead by 8 hours");
    expect(paceText({ ...base, status: "on_track", daysElapsed: 0, expectedHours: 0, studiedHours: 0, differenceHours: 0 }, t).line).toMatch(/Goal set today/);
    expect(paceText(null, t)).toBeNull();
  });

  it("this week's hours, track progress and credential links", () => {
    expect(weekHours(12, 6)).toBe(6);
    expect(weekHours(3, 6)).toBe(3);
    expect(weekHours(2.2, 6)).toBe(3);
    expect(progressLine(1, 3, 4, t)).toBe("1 of 3 skills done, about 4 weeks left");
    expect(progressLine(3, 3, 0, t)).toBe("All 3 skills done");
    expect(progressLine(0, 2, 1, t)).toBe("0 of 2 skills done, about 1 week left");
    expect(okCredentialUrl("https://coursera.org/verify/ABC")).toBe(true);
    expect(okCredentialUrl("http://coursera.org/verify/ABC")).toBe(false);
    expect(okCredentialUrl("javascript:alert(1)")).toBe(false);
    expect(okCredentialUrl("not a link")).toBe(false);
  });

  it("no middle dot in any new My goal string", () => {
    for (const l of ["en", "ms"]) for (const [k, v] of Object.entries(dict(l))) if (k.startsWith("track.")) expect(v, k).not.toContain("·");
  });
});

describe("step rows", () => {
  const src = (f: string) => readFileSync(path.join(web, "js/features", f), "utf8");
  it("steps are compact rows that open the skill view, with no in-card Learn / Practise / Prove block", () => {
    const ui = src("goal-ui.js");
    expect(ui).toContain("actions.openDrawer(id)");
    expect(ui).toContain('role="button"');
    expect(ui).not.toContain("<details");
    expect(ui).not.toContain("learnRow");
    expect(ui).not.toContain("practiseRow");
  });
  it("goal.js exports practiseFor(skillId)", () => {
    expect(src("goal.js")).toMatch(/export function practiseFor\(skillId\)/);
  });
});

describe("the sample team's shared progress (HR Team progress)", () => {
  let app: ReturnType<typeof createApp>, emp: number;
  beforeAll(async () => {
    const svc = await testServices();
    app = createApp(svc);
    emp = (await svc.db.query<{ id: number }>("select id from employers where name=$1", [HR_SAMPLE_EMPLOYER])).rows[0].id;
  });

  it("lists the three sample members who share, with goals, ticks, a verified step and check-ins; counts the rest", async () => {
    const res = await request(app).get(`/api/hr/${emp}/progress`);
    expect(res.status).toBe(200);
    expect(res.body.members.map((m: any) => m.name)).toEqual(["Team member A (sample)", "Team member B (sample)", "Team member E (sample)"]);
    expect(res.body.notSharing).toBe(3);
    const [a, b, e] = res.body.members;
    expect(a).toMatchObject({ goal: { job: "stayRole" }, stepsDone: 1, verified: 1, lastCheckIn: { hours: 4 } });
    expect(b).toMatchObject({ goal: { job: "faRole" }, stepsDone: 2, verified: 1, status: "behind" });
    expect(e).toMatchObject({ goal: { job: "esgRole" }, stepsDone: 0, verified: 0 });
    for (const m of res.body.members) expect(m.stepsTotal).toBeGreaterThan(m.stepsDone);
  });

  it("an advisor's confirmation names the advisor; the record lists who vouches", async () => {
    const id = (await request(app).get(`/api/hr/${emp}/progress`)).body.members[1].profileId;
    const goal = (await request(app).get(`/api/profile/${id}/goal`)).body;
    const fin = goal.steps.find((s: any) => s.skillId === "fin");
    expect(fin).toMatchObject({ done: true, verified: true, proofs: [expect.objectContaining({ kind: "advisor", by: "Puan Aminah (sample advisor)" })] });
    const rec = (await request(app).get(`/api/profile/${id}/record`)).body;
    expect(rec.skills.find((s: any) => s.skillId === "fin")).toMatchObject({ level: 3, verified: true });
  });
});
