// Demo safety (DEMO_MODE): every successful scout/committee run records what it found (source item
// metadata + the verified extractions + reviewer verdicts) in runs.summary.recording. If a live source or
// the AI fails during a demo (or {replay:true} is asked for), the last recording is replayed through the
// same deterministic triage, and the run is marked 'replayed' - never passed off as live.
// A fresh install has one recorded real run from the seed (db/seed/replay_run.json, trigger 'seed').
import type { Services } from "../context.ts";

export interface Recording { recordedAt: string; runId: number | null; [k: string]: any }

/** The most recent successful run of this kind that has a recording. */
export async function lastRecording(svc: Services, kind: "scout" | "committee"): Promise<{ runId: number; recording: Recording; from: "live" | "seed" } | null> {
  const r = await svc.db.query(`select id, trigger, summary from runs where kind=$1 and status='ok' and summary ? 'recording' order by id desc limit 1`, [kind]);
  const row = r.rows[0] as any;
  return row ? { runId: row.id, recording: row.summary.recording, from: row.trigger === "seed" ? "seed" : "live" } : null;
}

/** Should this failure fall back to a replay? Only in demo mode (or when explicitly asked). */
export const shouldReplay = (svc: Services, asked?: boolean) => !!asked || svc.config.demoMode;
