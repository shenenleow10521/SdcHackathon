// Key stepping stones: attitudes and transversal items are never numbered steps, and the core of a job leads.
import { describe, it, expect, beforeAll } from "vitest";
import { loadGraph, type FullGraph } from "../server/kb.ts";
import { loadProfile, type Profile } from "../server/repo.ts";
import { buildJobPlan } from "../server/services/planning.ts";
import { loadEsco } from "../server/services/esco.ts";
import { isAttitude, attitudeCount } from "../server/services/esco-attitude.ts";
import { testServices } from "./helpers/services.ts";

const NOW = new Date("2026-10-23T10:00:00Z");
let g: FullGraph, priya: Profile;
beforeAll(async () => {
  const svc = await testServices();
  g = await loadGraph(svc.db);
  priya = (await loadProfile(svc.db, 1))!;
});
const idOf = (title: string) => {
  const d = loadEsco()!;
  return Object.keys(d.skills).find(k => d.skills[k].title === title)!;
};
const plan = (occ: string, mode: any = "closest"): any => buildJobPlan(g, priya, { job: `esco:${occ}`, mode, now: NOW, escoSkills: new Set() });

describe("attitude and transversal skills", () => {
  it("are flagged from ESCO's transversal level plus checked title openings, and real skills are not", () => {
    for (const t of ["tolerate sitting for long periods", "work in a multicultural environment in health care", "accept own accountability", "listen actively", "show initiative", "demonstrate willingness to learn", "work in teams"])
      expect(isAttitude(idOf(t)), t).toBe(true);
    for (const t of ["perform defensive driving", "manoeuvre bus", "drive in urban areas", "show sample garments", "maintain physical condition of warehouse", "speak Spanish", "use spreadsheets software"].filter(t => idOf(t)))
      expect(isAttitude(idOf(t)), t).toBe(false);
    expect(attitudeCount()).toBeGreaterThan(100);
    expect(attitudeCount()).toBeLessThan(200);
  });

  it("are never key steps, across a sample of jobs and both modes, but still count in the gap list", () => {
    const d = loadEsco()!;
    const occs = Object.keys(d.occupations).filter((_, i) => i % 60 === 0);
    expect(occs.length).toBeGreaterThan(40);
    let attitudesStillListed = 0;
    for (const occ of occs) for (const mode of ["closest", "safest"]) {
      const p = plan(occ, mode);
      for (const k of p.keySkills) expect(isAttitude(k), `${d.occupations[occ].title}: ${k}`).toBe(false);
      for (const m of p.missing) if (isAttitude(m.id)) { attitudesStillListed++; expect(m.key).toBe(false); }
    }
    expect(attitudesStillListed).toBeGreaterThan(0);
  });

  it("bus driver: the key steps are about driving, not sitting", () => {
    const d = loadEsco()!;
    const bus = Object.keys(d.occupations).find(k => d.occupations[k].title === "bus driver")!;
    const p = plan(bus);
    const titles = p.keySkills.map((k: string) => d.skills[k].title);
    expect(titles.some((t: string) => /driv|vehicle|bus|traffic/.test(t)), titles.join(", ")).toBe(true);
    expect(titles).not.toContain("tolerate sitting for long periods");
    // it is still a needed skill: in the gap list, grouped under a key step
    const sit = p.missing.find((m: any) => m.name === "tolerate sitting for long periods");
    if (sit) expect(sit.key).toBe(false);
  });
});
