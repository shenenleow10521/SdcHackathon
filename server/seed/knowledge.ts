// Seed step (knowledge pipeline): store a real recorded scout run so DEMO_MODE / {replay:true} works on any
// fresh install. db/seed/replay_run.json was exported from a live run (real URLs, dates, verified quotes,
// reviewer verdicts). It is stored as a run with trigger 'seed'; its signals are NOT applied here.
// Replaying it goes through the normal triage and is labelled "replayed" with the original dates.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { Db } from "../lib/db.ts";
import { projectRoot } from "../lib/db.ts";

export const REPLAY_FILE = path.join(projectRoot, "db", "seed", "replay_run.json");

export async function seedKnowledge(t: Db) {
  if (!existsSync(REPLAY_FILE)) return;
  const recording = JSON.parse(readFileSync(REPLAY_FILE, "utf8"));
  const recordedAt = recording.recordedAt || null;
  await t.query(`insert into runs(kind, status, trigger, started_at, finished_at, summary) values ('scout','ok','seed',coalesce($1::timestamptz, now()),coalesce($1::timestamptz, now()),$2)`,
    [recordedAt, JSON.stringify({ note: "Recorded live run shipped with the code, for offline demo replay", counts: recording.counts || null, items: recording.items || [], recording })]);
}
