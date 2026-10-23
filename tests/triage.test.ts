// Triage rules (docs/ARCHITECTURE.md §3.3): every rule and its boundaries.
import { describe, it, expect } from "vitest";
import { triage, ageDays, isSpotcheck, TRIAGE, type TriageInput } from "../server/triage.ts";
import { deltasFor } from "../server/agents/scout.ts";

const now = new Date("2026-10-23T10:00:00Z");
// A signal that passes every AUTO condition.
const good: TriageInput = {
  sourceUrl: "https://www.reuters.com/technology/x", quoteFound: true, duplicate: false, sourceDate: "2026-10-20", now,
  nSources: 2, reviewer: { supports: true, confidence: 0.9 }, deltaE: 0.02, deltaD: 0, usersRerouted: 0, zoneChanges: 0, key: "viz|capability|up",
};
const t = (over: Partial<TriageInput>) => triage({ ...good, ...over });
const daysAgo = (n: number) => new Date(Date.parse("2026-10-23T00:00:00Z") - n * 86_400_000).toISOString().slice(0, 10);

describe("REJECT rules", () => {
  it.each([
    ["no source URL", { sourceUrl: null }, "No source link"],
    ["untrusted domain", { sourceUrl: "https://random-blog.example.com/post" }, "Source not on the trust list"],
    ["job board (link-only)", { sourceUrl: "https://www.jobstreet.com.my/job/123" }, "Source not on the trust list"],
    ["quote not found", { quoteFound: false }, "Quote not found on the source page"],
    ["duplicate", { duplicate: true }, "Duplicate of a recent signal"],
    ["older than 180 days", { sourceDate: daysAgo(181) }, "Source older than 180 days"],
  ] as const)("%s -> rejected", (_n, over, reason) => {
    const r = t(over as Partial<TriageInput>);
    expect(r.decision).toBe("rejected");
    expect(r.reasons).toContain(reason);
    expect(r.needsSpotcheck).toBe(false);
  });

  it("exactly 180 days old is still allowed", () => {
    expect(ageDays(daysAgo(180), now)).toBe(180);
    expect(t({ sourceDate: daysAgo(180) }).decision).toBe("auto");
  });

  it("rejection wins over everything else (even a reviewer at 1.0)", () => {
    const r = t({ quoteFound: false, reviewer: { supports: true, confidence: 1 }, nSources: 5 });
    expect(r.decision).toBe("rejected");
  });

  it("lists every rejection reason that applies", () => {
    expect(t({ sourceUrl: null, quoteFound: false, duplicate: true }).reasons).toHaveLength(3);
  });
});

describe("AUTO rules", () => {
  it("small, 2 sources, reviewer agrees >= 0.8, no reroutes -> auto", () => {
    const r = t({});
    expect(r.decision).toBe("auto");
  });

  it("boundaries are inclusive: |Δe| = 0.05, |Δd| = 5, confidence = 0.8", () => {
    expect(t({ deltaE: 0.05 }).decision).toBe("auto");
    expect(t({ deltaE: -0.05 }).decision).toBe("auto");
    expect(t({ deltaE: 0, deltaD: 5 }).decision).toBe("auto");
    expect(t({ deltaE: 0, deltaD: -5 }).decision).toBe("auto");
    expect(t({ reviewer: { supports: true, confidence: 0.8 } }).decision).toBe("auto");
  });

  it("the scout's medium step (0.05 exposure, 5 demand) is still auto-eligible; large is not", () => {
    expect(t(deltasFor("capability", "up", "medium")).decision).toBe("auto");
    expect(t(deltasFor("demand", "down", "medium")).decision).toBe("auto");
    expect(t(deltasFor("adoption", "up", "large")).decision).toBe("flagged");
    expect(t(deltasFor("demand", "up", "large")).decision).toBe("flagged");
  });
});

describe("FLAG rules", () => {
  it.each([
    ["Δe just over 0.05", { deltaE: 0.0501 }, "Big change"],
    ["Δe negative and big", { deltaE: -0.1 }, "Big change"],
    ["Δd just over 5", { deltaE: 0, deltaD: 5.01 }, "Big change"],
    ["single source", { nSources: 1 }, "Single source"],
    ["reviewer unsure (0.79)", { reviewer: { supports: true, confidence: 0.79 } }, "Reviewer unsure"],
    ["reviewer disagrees", { reviewer: { supports: false, confidence: 0.95 } }, "Reviewer disagrees"],
    ["reviewer unavailable", { reviewer: null }, "Reviewer unavailable"],
    ["reroutes users", { usersRerouted: 3 }, "Would reroute 3 users"],
    ["reroutes one user", { usersRerouted: 1 }, "Would reroute 1 user"],
    ["changes a skill zone", { zoneChanges: 2 }, "Changes a skill zone for 2 users"],
    ["new skill", { newSkill: true }, "New skill"],
    ["undated source", { sourceDate: null }, "Source date unknown"],
  ] as const)("%s -> flagged", (_n, over, reason) => {
    const r = t(over as Partial<TriageInput>);
    expect(r.decision).toBe("flagged");
    expect(r.reasons).toContain(reason);
    expect(r.needsSpotcheck).toBe(false);
  });

  it("collects several reasons at once", () => {
    const r = t({ deltaE: 0.18, nSources: 1, usersRerouted: 2 });
    expect(r.reasons).toEqual(["Big change", "Single source", "Would reroute 2 users"]);
  });
});

describe("spot check", () => {
  it("is deterministic and about 5% of AUTO items", () => {
    expect(isSpotcheck("abc")).toBe(isSpotcheck("abc"));
    const keys = Array.from({ length: 4000 }, (_, i) => `signal-${i}`);
    const share = keys.filter(k => isSpotcheck(k)).length / keys.length;
    expect(share).toBeGreaterThan(0.035);
    expect(share).toBeLessThan(0.065);
    expect(TRIAGE.spotcheckPercent).toBe(5);
  });

  it("only AUTO items are ever marked", () => {
    const k = Array.from({ length: 500 }, (_, i) => `k${i}`).find(x => isSpotcheck(x))!;
    expect(t({ key: k }).needsSpotcheck).toBe(true);
    expect(t({ key: k, nSources: 1 }).needsSpotcheck).toBe(false);
  });
});

describe("magnitude -> delta mapping (code, never the model)", () => {
  it("maps exposure and demand steps with direction", () => {
    expect(deltasFor("capability", "up", "small")).toEqual({ deltaE: 0.02, deltaD: 0 });
    expect(deltasFor("adoption", "up", "large")).toEqual({ deltaE: 0.1, deltaD: 0 });
    expect(deltasFor("capability", "down", "medium")).toEqual({ deltaE: -0.05, deltaD: 0 });
    expect(deltasFor("demand", "down", "large")).toEqual({ deltaE: 0, deltaD: -10 });
    expect(deltasFor("demand", "up", "small")).toEqual({ deltaE: 0, deltaD: 2 });
  });
});
