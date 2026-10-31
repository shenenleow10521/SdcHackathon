import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { SDG_INFO, normSdg, sdgForJob, sdgForSkill, JOB_BASE, SKILL_BASE } from "../shared/sdg.js";
import { createEngine } from "../shared/engine.js";
import { seedGraph, persona, knowledge } from "./helpers/seed-graph.ts";

const esco = JSON.parse(gunzipSync(readFileSync(new URL("../db/seed/esco_full.json.gz", import.meta.url))).toString("utf8"));
const valid = (list: any[]) => list.length > 0 && list.every(([g, r]: any) => SDG_INFO[g as keyof typeof SDG_INFO] && r.trim().length > 0);

describe("SDG mapping covers every role and skill", () => {
  it("all 17 goals have a name and colour", () => {
    for (let g = 1; g <= 17; g++) expect(SDG_INFO[g as keyof typeof SDG_INFO]?.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("every catalogue job and skill has a hand-written goal", () => {
    for (const x of [...knowledge.occupations, ...knowledge.skills]) expect(valid(normSdg(x.sdg)), x.id).toBe(true);
  });

  it("every ESCO occupation gets a goal and reason, always including SDG 8", () => {
    const occs = Object.values<any>(esco.occupations);
    expect(occs.length).toBeGreaterThan(3000);
    for (const o of occs) {
      const list = sdgForJob(o.title, o.isco);
      expect(valid(list), o.title).toBe(true);
      expect(list.some(([g]: any) => g === JOB_BASE[0]), o.title).toBe(true);
    }
  });

  it("every ESCO skill gets a goal and reason, always including SDG 4", () => {
    const skills = Object.values<any>(esco.skills);
    expect(skills.length).toBeGreaterThan(13000);
    for (const s of skills) {
      const list = sdgForSkill(s.title);
      expect(valid(list), s.title).toBe(true);
      expect(list.some(([g]: any) => g === SKILL_BASE[0]), s.title).toBe(true);
    }
  });

  it("the rule picks specific goals from topic words and ISCO groups", () => {
    expect(sdgForJob("environmental engineer", "2143")[0][0]).toBe(13);
    expect(sdgForJob("nurse", "2221")[0][0]).toBe(3);
    expect(sdgForJob("taxi driver", "8322")[0][0]).toBe(11); // "taxi" is not "tax"
    expect(sdgForSkill("apply AI tools")[0][0]).toBe(9);
    expect(sdgForSkill("lawn care")[0][0]).toBe(4); // "lawn" is not "law"
  });
});

describe("futures compared: the recommendation can shift between scenarios", () => {
  it("2030 Steady and Fast give different exposure for the persona's own job", () => {
    const g = seedGraph();
    const steady = createEngine(g, persona, { year: 2030, scenario: "moderate" });
    const fast = createEngine(g, persona, { year: 2030, scenario: "fast" });
    expect(fast.exposure(persona.occupationId)).toBeGreaterThan(steady.exposure(persona.occupationId));
  });
});
