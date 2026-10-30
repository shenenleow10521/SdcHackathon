// Human review of the discovered cross-field bridges (server/services/bridges.ts). The data proposes; a person decides.
// Only approved bridges (the team's hand-made ones, plus any a person approves here) reach routes and the match.
// Decisions are stored in bridge_decisions (db/migrations/70_bridge_decisions.sql) and mirrored in memory, because the
// match and route code is synchronous. ensureBridgeDecisions() loads them once per database (the app calls it on every
// API request, which is a no-op after the first); decideBridge() writes one and refreshes the copy straight away.
import type { Db } from "../lib/db.ts";
import { loadBridges, setBridgeDecisions, effectiveStatus, bridgeDecision, FIELD_FAMILY, type Bridge, type BridgeDecision } from "./bridges.ts";

let loadedFor: Db | null = null;

async function readDecisions(db: Db) {
  const rows = (await db.query(`select from_skill, to_skill, status, actor, decided_at, note from bridge_decisions`)).rows as any[];
  setBridgeDecisions(rows.map(r => ({
    from: r.from_skill, to: r.to_skill,
    decision: { status: r.status, actor: r.actor, decidedAt: new Date(r.decided_at).toISOString(), note: r.note ?? null } as BridgeDecision,
  })));
  loadedFor = db;
}

/** Load people's bridge decisions from this database into memory, once (again when the database changes). */
export async function ensureBridgeDecisions(db: Db) {
  if (loadedFor === db) return;
  await readDecisions(db);
}

/** Record a person's decision on one bridge (by its id in the built file) and use it from now on. */
export async function decideBridge(db: Db, id: number, status: "approved" | "rejected", actor: string, note: string | null, now: Date) {
  const b = loadBridges()?.bridges[id];
  if (!b) return null;
  await db.query(
    `insert into bridge_decisions(from_skill, to_skill, status, actor, decided_at, note) values ($1,$2,$3,$4,$5,$6)
     on conflict (from_skill, to_skill) do update set status=excluded.status, actor=excluded.actor, decided_at=excluded.decided_at, note=excluded.note`,
    [b.from, b.to, status, actor, now.toISOString(), note]);
  await readDecisions(db);
  return bridgeJson(b);
}

/** A bridge for the review queue: both skills, their fields, the score and the evidence, and any decision. */
export function bridgeJson(b: Bridge) {
  return {
    id: b.id, from: { id: b.from, title: b.fromTitle, field: b.fields[0], family: b.families[0] },
    to: { id: b.to, title: b.toTitle, field: b.fields[1], family: b.families[1] },
    score: b.score, source: b.source, status: effectiveStatus(b), why: b.why ?? null,
    evidence: b.evidence, decision: bridgeDecision(b),
  };
}

export const BRIDGE_FAMILIES = [...new Set(Object.values(FIELD_FAMILY))].sort();

export interface BridgeQuery { status?: "proposed" | "approved" | "rejected"; skill?: string; family?: string; offset?: number; limit?: number }

/** Bridges by status (default: proposed, waiting for a person), strongest first, optionally only those touching a skill
 *  (ESCO id, or words in either title) or a field family (either side). */
export function listBridges(q: BridgeQuery = {}) {
  const all = loadBridges()?.bridges || [];
  const status = q.status ?? "proposed";
  const words = (q.skill || "").toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (b: Bridge) => {
    if (effectiveStatus(b) !== status) return false;
    if (q.family && b.families[0] !== q.family && b.families[1] !== q.family) return false;
    if (words.length) {
      if (q.skill === b.from || q.skill === b.to) return true;
      const t = `${b.fromTitle} | ${b.toTitle}`.toLowerCase();
      return words.every(w => t.includes(w));
    }
    return true;
  };
  const rows = all.filter(hit).sort((a, b) => b.score - a.score || a.id - b.id);
  const offset = q.offset ?? 0, limit = q.limit ?? 20;
  return { status, total: rows.length, offset, limit, bridges: rows.slice(offset, offset + limit).map(bridgeJson) };
}

/** Counts for the review page. */
export function bridgeCounts() {
  const c = { proposed: 0, approved: 0, rejected: 0, team: 0, approvedByPeople: 0 };
  for (const b of loadBridges()?.bridges || []) {
    const s = effectiveStatus(b);
    c[s]++;
    if (b.source === "team") c.team++;
    else if (s === "approved") c.approvedByPeople++;
  }
  return c;
}
