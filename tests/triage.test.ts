// Triage (docs/ARCHITECTURE.md §3.3): the fixed gate, then the three-agent vote.
import { describe, it, expect } from "vitest";
import { triage, gateReasons, ageDays, isSpotcheck, TRIAGE, type TriageInput } from "../server/triage.ts";
import { deltasFor } from "../server/agents/scout.ts";
import type { Vote, VoteSet } from "../server/agents/voters.ts";

const now = new Date("2026-10-23T10:00:00Z");
const ROLES = ["evidence", "skill", "sceptic"] as const;
/** A vote set with the given include/exclude pattern, e.g. voteSet("include", "exclude", "include"). */
const voteSet = (...v: ("include" | "exclude")[]): VoteSet => ({
  error: null,
  votes: v.map((x, i): Vote => ({ role: ROLES[i], vote: x, confidence: 0.9, reason: `${ROLES[i]} says ${x}`, model: i === 1 ? "m-main" : "m-reviewer" })),
});
const good: TriageInput = {
  sourceUrl: "https://www.reuters.com/technology/x", quoteFound: true, duplicate: false, sourceDate: "2026-10-20", now,
  votes: voteSet("include", "include", "include"), key: "viz|capability|up",
};
const t = (over: Partial<TriageInput>) => triage({ ...good, ...over });
const daysAgo = (n: number) => new Date(Date.parse("2026-10-23T00:00:00Z") - n * 86_400_000).toISOString().slice(0, 10);

describe("the gate (not a vote)", () => {
  it.each([
    ["no source URL", { sourceUrl: null }, "No source link"],
    ["untrusted domain", { sourceUrl: "https://random-blog.example.com/post" }, "Source not on the trust list"],
    ["job board (link-only)", { sourceUrl: "https://www.jobstreet.com.my/job/123" }, "Source not on the trust list"],
    ["quote not found", { quoteFound: false }, "Quote not found on the source page"],
    ["duplicate", { duplicate: true }, "Duplicate of a recent signal"],
    ["older than 180 days", { sourceDate: daysAgo(181) }, "Source older than 180 days"],
  ] as const)("%s -> rejected, even when all three voters say include", (_n, over, reason) => {
    const r = t(over as Partial<TriageInput>);
    expect(r.decision).toBe("rejected");
    expect(r.reasons).toContain(reason);
    expect(r.needsSpotcheck).toBe(false);
  });

  it("exactly 180 days old is still allowed", () => {
    expect(ageDays(daysAgo(180), now)).toBe(180);
    expect(t({ sourceDate: daysAgo(180) }).decision).toBe("auto");
  });

  it("lists every gate reason that applies, and gateReasons is empty for a good signal", () => {
    expect(t({ sourceUrl: null, quoteFound: false, duplicate: true }).reasons).toHaveLength(3);
    expect(gateReasons(good)).toEqual([]);
  });
});

describe("the vote", () => {
  it("3 of 3 include -> auto", () => {
    const r = t({});
    expect(r.decision).toBe("auto");
    expect(r.reasons[0]).toBe("Approved by agent vote (3 of 3)");
  });

  it("2 of 3 include -> auto, whichever voter dissents", () => {
    for (const pattern of [["include", "include", "exclude"], ["include", "exclude", "include"], ["exclude", "include", "include"]] as const) {
      const r = t({ votes: voteSet(...pattern) });
      expect(r.decision).toBe("auto");
      expect(r.reasons[0]).toBe("Approved by agent vote (2 of 3)");
    }
  });

  it("1 of 3 include -> flagged for a person, with all three reasons", () => {
    const r = t({ votes: voteSet("exclude", "include", "exclude") });
    expect(r.decision).toBe("flagged");
    expect(r.reasons[0]).toMatch(/Split vote \(1 of 3 include\)/);
    expect(r.reasons).toHaveLength(4);
    expect(r.reasons.join("|")).toMatch(/Evidence checker \(exclude\).*Skill matcher \(include\).*Sceptic \(exclude\)/);
  });

  it("0 of 3 include -> rejected, with the reasons", () => {
    const r = t({ votes: voteSet("exclude", "exclude", "exclude") });
    expect(r.decision).toBe("rejected");
    expect(r.reasons[0]).toBe("Rejected by agent vote (0 of 3 include)");
    expect(r.reasons).toHaveLength(4);
  });

  it("no size limit: a large change and a single source still auto-apply on a 2 of 3 vote", () => {
    // triage no longer sees the size of the change at all; the people affected are asked keep-or-switch instead
    expect(deltasFor("adoption", "up", "large")).toEqual({ deltaE: 0.1, deltaD: 0 });
    expect(t({ votes: voteSet("include", "include", "exclude") }).decision).toBe("auto");
  });

  it.each([
    ["no vote held", undefined],
    ["vote not recorded", null],
    ["AI unavailable", { votes: [], error: "evidence voter unavailable: quota" } as VoteSet],
    ["only two voters answered", { votes: voteSet("include", "include").votes, error: null } as VoteSet],
  ])("%s -> flagged, never auto", (_n, votes) => {
    const r = t({ votes: votes as any });
    expect(r.decision).toBe("flagged");
    expect(r.reasons[0]).toMatch(/^Agent vote could not happen/);
  });

  it("an undated source is flagged even if the vote passes", () => {
    const r = t({ sourceDate: null });
    expect(r.decision).toBe("flagged");
    expect(r.reasons[0]).toMatch(/Source date unknown/);
  });

  it("the gate wins over the vote", () => {
    expect(t({ quoteFound: false, votes: voteSet("include", "include", "include") }).decision).toBe("rejected");
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
    expect(t({ key: k, votes: voteSet("exclude", "include", "exclude") }).needsSpotcheck).toBe(false);
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
