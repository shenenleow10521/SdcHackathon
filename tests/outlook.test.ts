// Skill outlook and the "Stay AI-ready" track (server/services/outlook.ts), on the real ESCO data.
import { describe, it, expect } from "vitest";
import { skillOutlook, OUTLOOK } from "../server/services/outlook.ts";
import { loadEsco } from "../server/services/esco.ts";

const d = loadEsco()!;
const occ = (title: string) => Object.keys(d.occupations).find(k => d.occupations[k].title === title)!;
const priya = { inv: 5, three: 5, pay: 4, tax: 3, erp: 4, dispute: 3, process: 2, audit: 4, recon: 4, excel: 4 };
const asWorker = (title: string, n = 14) => { const id = occ(title); return skillOutlook({ level: {}, confirmed: new Set(d.occupations[id].essential.slice(0, n)), currentEscoId: id })!; };

describe("skill outlook", () => {
  const p = skillOutlook({ level: priya, confirmed: new Set(), jobTitle: "Accounts Payable Clerk" })!;

  it("finds Priya's job and scores her skills, riskiest first, banded by the fixed bars", () => {
    expect(p.job).not.toBeNull();
    expect(p.skills.length).toBeGreaterThan(3);
    for (let i = 1; i < p.skills.length; i++) expect(p.skills[i - 1].exposure).toBeGreaterThanOrEqual(p.skills[i].exposure);
    for (const s of p.skills) {
      expect(s.band).toBe(s.exposure >= OUTLOOK.atRisk ? "risk" : s.exposure >= OUTLOOK.changing ? "changing" : "safe");
      expect(d.skills[s.id].type).not.toBe("knowledge"); // the model is weakest on knowledge items: left out
    }
    expect(p.counts.risk + p.counts.changing + p.counts.safe).toBe(p.skills.length);
  });

  it("suggests what to learn only for skills at risk or changing, and AI-era suggestions carry sources", () => {
    for (const s of p.skills) {
      if (s.band === "safe") expect(s.learn).toBeNull();
      if (s.learn?.kind === "ai") expect(s.learn.sources.length).toBeGreaterThan(0);
      if (s.learn?.kind === "skill") expect(s.learn.exposure).toBeLessThanOrEqual(s.exposure - OUTLOOK.saferGain + 1e-9);
    }
  });

  it("the stay track has a few items, none of them a skill you already have, all with estimated hours", () => {
    const mine = new Set(p.skills.map(s => s.id));
    expect(p.stay.items.length).toBeGreaterThan(0);
    expect(p.stay.items.length).toBeLessThanOrEqual(OUTLOOK.stayMax);
    for (const x of p.stay.items) { expect(mine.has(x.id)).toBe(false); expect(x.hours).toBeGreaterThan(0); expect(x.estimated).toBe(true); }
    expect(p.stay.hours).toBe(p.stay.items.reduce((s, x) => s + x.hours, 0));
  });

  it("a hands-on job gets no general AI skills; a nurse's skills aren't called at risk on a middling score", () => {
    const bus = asWorker("bus driver");
    expect(bus.stay.items.every(x => x.why !== "general")).toBe(true);
    const nurse = asWorker("nurse responsible for general care", 30);
    expect(nurse.skills.filter(s => s.band === "risk").every(s => s.exposure >= 0.7)).toBe(true);
  });

  it("shows your job's core tasks as rated by people, not per-skill guesses", () => {
    const t = p.job!.tasks;
    expect(t.ai.length + t.yours.length).toBeGreaterThan(0);
    expect(t.share).toBeGreaterThanOrEqual(0);
  });
});
