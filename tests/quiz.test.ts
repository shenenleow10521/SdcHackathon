// No-CV quiz (server/services/quiz.ts, POST /api/profile/quiz/*): data-built questions, adaptive narrowing,
// determinism, and a profile in the same shape as CV intake.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.ts";
import { testServices } from "./helpers/services.ts";
import { createMockLlm } from "../server/lib/llm.ts";
import { loadEsco } from "../server/services/esco.ts";
import {
  SECTORS, MAX_ROUNDS, CHIPS_PER_ROUND, sectorModel, pickTasks, posterior, ranking, isDone, quizDraft, shortTask, chipFor,
  rewriteChips, catalogueOccupation, resetQuizCache, type SectorModel, type Rounds,
} from "../server/services/quiz.ts";
import type { Services } from "../server/context.ts";

const AP = "43-3031.00"; // Bookkeeping, Accounting, and Auditing Clerks (Priya's job in O*NET)

/** A truthful person: ticks the tasks of their own job, and tasks that are nearly the same as one of theirs. */
function simulate(m: SectorModel, onet: string, seed = 7): Rounds {
  const target = m.occs.findIndex(o => o.onet === onet);
  const rounds: Rounds = [];
  while (!isDone(m, rounds)) {
    const chips = pickTasks(m, rounds, seed);
    if (!chips.length) break;
    rounds.push(chips.map(c => ({ taskId: c.task.id, ticked: c.task.occ === target || (m.support.get(c.task.id)!.get(target) || 0) >= 0.6 })));
  }
  return rounds;
}

afterEach(() => resetQuizCache());

describe("sector models are built from real data", () => {
  it("every sector has candidates, and every chip is a real O*NET task of a candidate linked to an ESCO occupation in that sector", () => {
    const d = loadEsco()!;
    for (const s of SECTORS) {
      const m = sectorModel(s.id)!;
      expect(m.occs.length, s.id).toBeGreaterThanOrEqual(30);
      for (const t of m.pool) {
        const [onet, i] = t.id.split("#");
        expect(d.onetTasks[onet].tasks[Number(i)][0]).toBe(t.text);
        expect(m.occs[t.occ].onet).toBe(onet);
      }
      for (const o of m.occs) for (const e of o.esco) expect(d.onetLinks[e].onet).toBe(o.onet);
    }
  });

  it("unknown sectors have no model", () => {
    expect(sectorModel("astronaut")).toBeNull();
  });
});

describe("adaptive narrowing", () => {
  it("is deterministic for the same seed and answers, and never repeats a task", () => {
    const m = sectorModel("finance")!;
    const a = pickTasks(m, [], 123).map(c => c.task.id), b = pickTasks(m, [], 123).map(c => c.task.id);
    expect(a).toEqual(b);
    expect(a.length).toBe(CHIPS_PER_ROUND);
    const rounds: Rounds = [a.map((taskId, i) => ({ taskId, ticked: i === 0 }))];
    const next = pickTasks(m, rounds, 123).map(c => c.task.id);
    expect(next).toEqual(pickTasks(m, rounds, 123).map(c => c.task.id));
    expect(next.some(id => a.includes(id))).toBe(false);
    expect(simulate(m, AP, 5)).toEqual(simulate(m, AP, 5));
  });

  it("each round shows at most two tasks per occupation", () => {
    const m = sectorModel("office")!;
    const occs = pickTasks(m, [], 1).map(c => c.task.occ);
    for (const o of new Set(occs)) expect(occs.filter(x => x === o).length).toBeLessThanOrEqual(2);
  });

  it("picks informative tasks: once answers narrow the field, chips split the remaining candidates (P(tick) near 50%)", () => {
    const m = sectorModel("finance")!;
    const target = m.occs.findIndex(o => o.onet === AP);
    const own = m.pool.filter(t => t.occ === target).slice(0, 2);
    const rounds: Rounds = [own.map(t => ({ taskId: t.id, ticked: true }))];
    const chips = pickTasks(m, rounds, 9);
    // Average information of the chosen tasks beats the average task in the pool by a wide margin.
    const all = m.pool.filter(t => !own.includes(t)).map(t => {
      const p = posterior(m, rounds);
      let q = 0.03; for (const [o, g] of m.support.get(t.id)!) q += p[o] * 0.72 * g;
      return q <= 0 || q >= 1 ? 0 : -(q * Math.log2(q) + (1 - q) * Math.log2(1 - q));
    });
    const mean = all.reduce((s, x) => s + x, 0) / all.length;
    const chosen = chips.reduce((s, c) => s + c.info, 0) / chips.length;
    expect(chosen).toBeGreaterThan(2 * mean);
  });

  it("ticking a job's tasks raises it, and 'none of these' lowers the jobs of the tasks shown", () => {
    const m = sectorModel("finance")!;
    const target = m.occs.findIndex(o => o.onet === AP);
    const prior = posterior(m, [])[target];
    const t = m.pool.find(x => x.occ === target)!;
    expect(posterior(m, [[{ taskId: t.id, ticked: true }]])[target]).toBeGreaterThan(3 * prior);
    expect(posterior(m, [[{ taskId: t.id, ticked: false }]])[target]).toBeLessThan(prior);
  });

  it("a truthful bookkeeping clerk is found within the round limit (and most jobs of a sector are found)", () => {
    const m = sectorModel("finance")!;
    const rounds = simulate(m, AP);
    expect(rounds.length).toBeLessThanOrEqual(MAX_ROUNDS);
    expect(ranking(m, rounds)[0].onet).toBe(AP);
    const found = m.occs.filter(o => ranking(m, simulate(m, o.onet), 3).some(r => r.onet === o.onet)).length;
    expect(found / m.occs.length).toBeGreaterThan(0.85);
  });
});

describe("the profile it produces", () => {
  const catalogue = new Set(["inv", "three", "pay", "tax", "erp", "dispute", "process", "audit", "recon", "excel", "fin", "viz", "esgdata", "ghg", "disc",
    "aisup", "auto", "prompt", "aiinv", "sql", "python", "stats", "lca", "greenfin", "audit2", "treasury", "procure", "scm", "invent"]);

  for (const mode of ["links file", "keyword fallback"] as const) {
    it(`bookkeeping clerk -> catalogue skills (levels 2-3) and real ESCO skills, each traced to a ticked task (${mode})`, () => {
      if (mode === "keyword fallback") resetQuizCache({ noLinks: true });
      const m = sectorModel("finance")!;
      const rounds = simulate(m, AP);
      const q = quizDraft(m, rounds, catalogue);
      const ticked = new Set(rounds.flat().filter(a => a.ticked).map(a => m.byId.get(a.taskId)!.text));
      expect(q.ticked.length).toBeGreaterThan(0);
      expect(q.escoSkills.length).toBeGreaterThan(0);
      for (const e of q.escoSkills) { expect(loadEsco()!.skills[e.escoId]).toBeTruthy(); expect(ticked.has(e.task)).toBe(true); }
      expect(q.skills.length).toBeGreaterThan(0);
      for (const s of q.skills) {
        expect(catalogue.has(s.skillId)).toBe(true);
        expect([2, 3]).toContain(s.level);
        expect(ticked.has(s.evidence)).toBe(true);
      }
      // Follow-up candidates are catalogue skills the answers did not already give.
      for (const c of q.nearMisses) { expect(catalogue.has(c)).toBe(true); expect(q.skills.some(s => s.skillId === c)).toBe(false); }
    });
  }

  it("maps O*NET jobs to catalogue occupations (never a 'stay' variant), else 'other'", () => {
    expect(catalogueOccupation(AP)).toBe("ap");
    expect(catalogueOccupation("13-2051.00")).toBe("faRole");
    expect(catalogueOccupation("29-1141.00")).toBe("other");
  });
});

describe("chip text", () => {
  it("falls back to the shortened task statement", () => {
    expect(shortTask("Perform general office duties, such as filing, answering telephones, and handling routine correspondence."))
      .toBe("Perform general office duties");
    resetQuizCache({ noLinks: true });
    expect(chipFor("x#1", "Reconcile records of bank transactions.", "ms").text).toBe("Reconcile records of bank transactions");
  });

  it("the LLM can only reword the tasks it was given", async () => {
    const llm = createMockLlm(() => ({ chips: [{ id: "t0", en: "Reconcile bank records", ms: "Selaraskan rekod bank" }] }));
    const r = await rewriteChips({ llm }, [{ id: "43-3031.00#19", text: "Reconcile records of bank transactions." }]);
    expect(r).toEqual({ "43-3031.00#19": { en: "Reconcile bank records", ms: "Selaraskan rekod bank" } });
    const bad = createMockLlm(() => ({ chips: [{ id: "t7", en: "Fly a plane", ms: "Terbangkan kapal terbang" }] }));
    await expect(rewriteChips({ llm: bad }, [{ id: "43-3031.00#19", text: "Reconcile records of bank transactions." }])).rejects.toThrow();
  });
});

describe("quiz API", () => {
  let svc: Services, app: ReturnType<typeof createApp>;
  beforeAll(async () => {
    svc = await testServices({ llmHandler: () => new Error("AI off") });
    app = createApp(svc);
  });

  /** Plays the quiz through the API as a truthful bookkeeping clerk. */
  async function play(sector = "finance", seed = 11) {
    const m = sectorModel(sector)!;
    const target = m.occs.findIndex(o => o.onet === AP);
    const rounds: Rounds = [];
    for (;;) {
      const res = await request(app).post("/api/profile/quiz/next").send({ sector, seed, rounds });
      expect(res.status).toBe(200);
      if (res.body.done) break;
      expect(res.body.chips.length).toBeGreaterThan(0);
      for (const c of res.body.chips) expect(typeof c.text).toBe("string");
      rounds.push(res.body.chips.map((c: any) => ({ taskId: c.taskId, ticked: m.byId.get(c.taskId)!.occ === target || (m.support.get(c.taskId)!.get(target) || 0) >= 0.6 })));
    }
    return rounds;
  }

  it("lists the sectors", async () => {
    const res = await request(app).get("/api/profile/quiz/sectors");
    expect(res.status).toBe(200);
    expect(res.body.sectors.map((s: any) => s.id)).toEqual(SECTORS.map(s => s.id));
    expect(res.body.sectors[0]).toMatchObject({ id: "finance", jobs: expect.any(Number), icon: expect.any(String) });
  });

  it("finish creates a profile in the same shape as CV intake, with quiz provenance", async () => {
    const rounds = await play();
    const res = await request(app).post("/api/profile/quiz/finish").send({ sector: "finance", seed: 11, rounds });
    expect(res.status).toBe(201);
    const b = res.body;
    expect(b.source).toBe("quiz");
    expect(b.profile).toMatchObject({ id: b.profileId, isDemo: false, occupationId: "ap", hours: 6 });
    expect(b.draft.occupation).toMatchObject({ id: "ap" });
    expect(b.draft.skills.length).toBeGreaterThan(0);
    expect(b.profile.skills.every((s: any) => s.confidence === "quiz")).toBe(true);
    expect(b.profile.skills.map((s: any) => s.skillId).sort()).toEqual(b.draft.skills.map((s: any) => s.skillId).sort());
    const esco = (await svc.db.query("select skill_id, source from profile_esco_skills where profile_id=$1", [b.profileId])).rows as any[];
    expect(esco.length).toBe(b.draft.escoSkills.length);
    expect(esco.every(r => r.source === "self")).toBe(true);
    expect(b.questions[0]).toMatchObject({ id: "hours" }); // the interviewer follows up, as after a CV
    // The engine's profile shape works for the rest of the app.
    expect((await request(app).get(`/api/profile/${b.profileId}`)).status).toBe(200);
  });

  it("round 1 counts every job as still possible", async () => {
    for (const sector of ["finance", "health", "trades"]) {
      const res = await request(app).post("/api/profile/quiz/next").send({ sector, seed: 2 });
      expect(res.body).toMatchObject({ done: false, round: 1 });
      expect(res.body.candidates).toBe(res.body.total);
    }
  });

  it("rejects bad input with friendly errors", async () => {
    let res = await request(app).post("/api/profile/quiz/next").send({ sector: "astronaut" });
    expect(res.status).toBe(400);
    res = await request(app).post("/api/profile/quiz/next").send({ sector: "finance", rounds: [[{ taskId: "29-1141.00#0", ticked: true }]] });
    expect(res.status).toBe(400); // a nurse's task is not a finance chip
    const first = (await request(app).post("/api/profile/quiz/next").send({ sector: "finance", seed: 3 })).body.chips;
    res = await request(app).post("/api/profile/quiz/finish").send({ sector: "finance", rounds: [first.map((c: any) => ({ taskId: c.taskId, ticked: false }))] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Tick at least one task/);
    res = await request(app).post("/api/profile/quiz/next").send({ sector: "finance", rounds: [[{ taskId: first[0].taskId, ticked: true }], [{ taskId: first[0].taskId, ticked: false }]] });
    expect(res.status).toBe(400); // repeated task
  });
});
