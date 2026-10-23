// GET /api/health — DB, AI model, embeddings and scheduler status, for the demo and uptime checks.
import { Router } from "express";
import type { Services } from "../context.ts";
import { latestVersion } from "../kb.ts";

export default function healthRoutes(svc: Services) {
  const r = Router();
  r.get("/health", async (_req, res) => {
    let db: any = { ok: false, kind: svc.db.kind }, kbVersion = null;
    try { kbVersion = await latestVersion(svc.db); db = { ok: true, kind: svc.db.kind }; } catch (e: any) { db.error = e.message; }
    let lastScout = null;
    try {
      lastScout = (await svc.db.query(`select id, status, trigger, started_at as "startedAt", finished_at as "finishedAt"
                                       from runs where kind='scout' order by id desc limit 1`)).rows[0] || null;
    } catch { /* table may be missing on a broken DB; db.ok already says so */ }
    const llm = svc.llm.status(), embed = svc.embed.status();
    res.status(db.ok ? 200 : 503).json({
      ok: db.ok, kbVersion, demoMode: svc.config.demoMode,
      db, llm: { ok: llm.configured && !llm.lastError, ...llm }, embed: { ok: embed.configured && !embed.lastError, ...embed },
      scheduler: { enabled: svc.config.schedulerEnabled, intervalHours: svc.config.scoutIntervalHours, lastScout },
      time: svc.now().toISOString(),
    });
  });
  return r;
}
