// Triage: deterministic rules (docs/ARCHITECTURE.md §3.3). No AI model decides whether a change is applied.
//
//   REJECT  no source URL | source not on trust list | quote not found in fetched text
//           | duplicate of a recent signal | source older than 180 days
//   AUTO    >= 2 independent sources AND reviewer supports AND reviewer confidence >= 0.8
//           AND |Δexposure| <= 0.05 AND |Δdemand| <= 5 AND changes no user's route or skill zone
//   FLAG    otherwise, with human-readable reasons
//   Spot check: a deterministic 5% of AUTO items (by hash) are marked for a person to check.
import { createHash } from "node:crypto";
import { isApproved } from "./sources/policy.ts";

export const TRIAGE = {
  minSources: 2,
  minConfidence: 0.8,
  maxAutoDeltaE: 0.05,
  maxAutoDeltaD: 5,
  maxAgeDays: 180,
  spotcheckPercent: 5,
} as const;

export interface TriageInput {
  sourceUrl: string | null;
  quoteFound: boolean;
  duplicate: boolean;
  sourceDate: string | null;          // YYYY-MM-DD
  now: Date;
  nSources: number;                   // independent sources (distinct organisations)
  reviewer: { supports: boolean; confidence: number } | null;  // null = review unavailable
  deltaE: number;
  deltaD: number;
  usersRerouted: number;              // profiles whose route would change
  zoneChanges?: number;               // profiles whose skill zone would change
  newSkill?: boolean;
  /** Stable text identifying the signal, for the spot-check hash. */
  key: string;
}
export type Decision = "auto" | "flagged" | "rejected";
export interface TriageResult { decision: Decision; reasons: string[]; needsSpotcheck: boolean }

const EPS = 1e-9; // so 0.05 counts as "<= 0.05" despite floating point

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

export function triage(i: TriageInput): TriageResult {
  // 1. Hard rejections
  const reject: string[] = [];
  if (!i.sourceUrl) reject.push("No source link");
  else if (!isApproved(i.sourceUrl)) reject.push("Source not on the trust list");
  if (!i.quoteFound) reject.push("Quote not found on the source page");
  if (i.duplicate) reject.push("Duplicate of a recent signal");
  if (i.sourceDate && ageDays(i.sourceDate, i.now) > TRIAGE.maxAgeDays) reject.push(`Source older than ${TRIAGE.maxAgeDays} days`);
  if (reject.length) return { decision: "rejected", reasons: reject, needsSpotcheck: false };

  // 2. Anything that needs a person
  const flag: string[] = [];
  if (Math.abs(i.deltaE) > TRIAGE.maxAutoDeltaE + EPS || Math.abs(i.deltaD) > TRIAGE.maxAutoDeltaD + EPS) flag.push("Big change");
  if (i.nSources < TRIAGE.minSources) flag.push("Single source");
  if (!i.reviewer) flag.push("Reviewer unavailable");
  else if (!i.reviewer.supports) flag.push("Reviewer disagrees");
  else if (i.reviewer.confidence < TRIAGE.minConfidence - EPS) flag.push("Reviewer unsure");
  if (i.usersRerouted > 0) flag.push(`Would reroute ${i.usersRerouted} user${i.usersRerouted === 1 ? "" : "s"}`);
  if ((i.zoneChanges || 0) > 0) flag.push(`Changes a skill zone for ${i.zoneChanges} user${i.zoneChanges === 1 ? "" : "s"}`);
  if (i.newSkill) flag.push("New skill");
  if (!i.sourceDate) flag.push("Source date unknown");
  if (flag.length) return { decision: "flagged", reasons: flag, needsSpotcheck: false };

  // 3. Small, corroborated, reviewed, and harmless to everyone's route: apply automatically.
  return { decision: "auto", reasons: ["Small change, 2+ sources, reviewer agrees, no routes change"], needsSpotcheck: isSpotcheck(i.key) };
}
