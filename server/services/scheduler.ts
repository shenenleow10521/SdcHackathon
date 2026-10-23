// Scheduled market scout: first run ~2 minutes after boot, then every SCOUT_INTERVAL_HOURS.
// Runs never overlap; a failed run is recorded in `runs` (by the scout itself) and the schedule carries on.
// The emerging-skill committee runs after a scout when its last run is over a week old.
// Disabled with SCOUT_SCHEDULE=off (and always in tests).
import type { Services } from "../context.ts";
import { runScout, isScoutRunning } from "../agents/scout.ts";
import { runCommittee } from "../agents/committee.ts";

export const FIRST_RUN_DELAY_MS = 2 * 60_000;

export function startScheduler(svc: Services, opts: { firstDelayMs?: number; log?: (msg: string) => void } = {}): () => void {
  if (!svc.config.schedulerEnabled) return () => {};
  const log = opts.log || ((m: string) => console.log(`[scheduler] ${m}`));
  const everyMs = Math.max(1, svc.config.scoutIntervalHours) * 3600_000;
  let busy = false, stopped = false;

  async function tick() {
    if (busy || stopped || isScoutRunning(svc)) return; // never overlap
    busy = true;
    try {
      const r = await runScout(svc, { trigger: "schedule" });
      log(`scout run ${r.runId}: ${r.status} ${JSON.stringify(r.counts)}${r.error ? ` (${r.error})` : ""}`);
      const last = (await svc.db.query(`select started_at from runs where kind='committee' and status in ('ok','replayed') order by id desc limit 1`)).rows[0] as any;
      if (!last || svc.now().getTime() - new Date(last.started_at).getTime() > 7 * 86_400_000) {
        const c = await runCommittee(svc, { trigger: "schedule" });
        log(`committee run ${c.runId}: ${c.status} ${JSON.stringify(c.counts)}`);
      }
    } catch (e: any) {
      log(`run failed: ${e?.message || e}`); // already recorded in runs by the agent
    } finally { busy = false; }
  }

  const first = setTimeout(tick, opts.firstDelayMs ?? FIRST_RUN_DELAY_MS);
  const every = setInterval(tick, everyMs);
  first.unref?.(); every.unref?.();
  return () => { stopped = true; clearTimeout(first); clearInterval(every); };
}
