// Triage (docs/ARCHITECTURE.md §3.3). Fixed rules plus a three-agent vote; a person decides every split vote.
//
//   GATE (not a vote; failing it REJECTS with no vote)
//           source URL on the trust list | quote found word for word on the fetched page
//           | not a duplicate of a recent signal | source not older than 180 days
//   VOTE    three agents (evidence checker, skill matcher, sceptic) each say include or exclude
//             3/3 or 2/3 include -> AUTO   applied now, labelled "approved by agent vote (n of 3)", undoable
//             1/3 include        -> FLAG   a person decides, with the three reasons attached
//             0/3 include        -> REJECT logged with the reasons
//   FLAG    also when the vote could not happen (AI unavailable): never auto-apply without votes
//           and when the source has no date (a person should confirm it is recent)
//   No size limit on the change: people whose saved plan would change are asked "keep my route or switch".
//   Spot check: a deterministic 5% of AUTO items (by hash) are marked for a person to check.
import { createHash } from "node:crypto";
import { isApproved } from "./sources/policy.ts";
import type { VoteSet } from "./agents/voters.ts";

export const TRIAGE = {
  voters: 3,
  approveAt: 2,        // include votes needed to apply automatically
  maxAgeDays: 180,
  spotcheckPercent: 5,
} as const;

export interface TriageInput {
  sourceUrl: string | null;
  quoteFound: boolean;
  duplicate: boolean;
  sourceDate: string | null;          // YYYY-MM-DD
  now: Date;
  votes?: VoteSet | null;             // null/undefined = no vote was held
  /** Stable text identifying the signal, for the spot-check hash. */
  key: string;
}
export type Decision = "auto" | "flagged" | "rejected";
export interface TriageResult { decision: Decision; reasons: string[]; needsSpotcheck: boolean }

/** Whole calendar days between a YYYY-MM-DD date and now (UTC). */
export function ageDays(date: string, now: Date): number {
  const d = Date.parse(date.slice(0, 10) + "T00:00:00Z");
  const today = Date.parse(now.toISOString().slice(0, 10) + "T00:00:00Z");
  return Math.round((today - d) / 86_400_000);
}

/** Deterministic 5% sample: the same signal always gets the same answer. */
export function isSpotcheck(key: string, percent: number = TRIAGE.spotcheckPercent): boolean {
  const h = parseInt(createHash("sha256").update(key).digest("hex").slice(0, 8), 16);
  return h % 100 < percent;
}

/** The fixed gate. Empty list = passed. Run it before asking anyone to vote. */
export function gateReasons(i: Pick<TriageInput, "sourceUrl" | "quoteFound" | "duplicate" | "sourceDate" | "now">): string[] {
  const reject: string[] = [];
  if (!i.sourceUrl) reject.push("No source link");
  else if (!isApproved(i.sourceUrl)) reject.push("Source not on the trust list");
  if (!i.quoteFound) reject.push("Quote not found on the source page");
  if (i.duplicate) reject.push("Duplicate of a recent signal");
  if (i.sourceDate && ageDays(i.sourceDate, i.now) > TRIAGE.maxAgeDays) reject.push(`Source older than ${TRIAGE.maxAgeDays} days`);
  return reject;
}

const ROLE_LABEL = { evidence: "Evidence checker", skill: "Skill matcher", sceptic: "Sceptic" } as const;
export const voteReasons = (v: VoteSet) => v.votes.map(x => `${ROLE_LABEL[x.role]}${x.model ? `, ${x.model}` : ""} (${x.vote}):${x.reason || "no reason given"}`);
/** "approved by agent vote (2 of 3)" etc. */
export const tallyText = (n: number) => `${n} of ${TRIAGE.voters}`;

export function triage(i: TriageInput): TriageResult {
  // 1. The gate: no vote can overrule it.
  const reject = gateReasons(i);
  if (reject.length) return { decision: "rejected", reasons: reject, needsSpotcheck: false };

  // 2. No complete vote (AI down, quota, timeout, or a recording made before votes existed): a person decides.
  const v = i.votes;
  if (!v || v.error || v.votes.length < TRIAGE.voters)
    return { decision: "flagged", reasons: [`Agent vote could not happen: ${v?.error || "no vote was recorded"}`, ...(v ? voteReasons(v) : [])], needsSpotcheck: false };

  // 3. The vote.
  const include = v.votes.filter(x => x.vote === "include").length;
  const why = voteReasons(v);
  if (include === 0) return { decision: "rejected", reasons: [`Rejected by agent vote (0 of ${TRIAGE.voters} include)`, ...why], needsSpotcheck: false };
  if (include < TRIAGE.approveAt) return { decision: "flagged", reasons: [`Split vote (${tallyText(include)} include): a person decides`, ...why], needsSpotcheck: false };
  if (!i.sourceDate) return { decision: "flagged", reasons: [`Source date unknown (vote was ${tallyText(include)} include)`, ...why], needsSpotcheck: false };
  return { decision: "auto", reasons: [`Approved by agent vote (${tallyText(include)})`, ...why], needsSpotcheck: isSpotcheck(i.key) };
}
