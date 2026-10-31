// GET /api/graph — the knowledge base at a version, for the client-side engine and UI.
// GET /api/kb/versions — version history.
import { Router } from "express";
import { z } from "zod";
import type { Services } from "../context.ts";
import { loadGraph, listVersions } from "../kb.ts";
import { parse } from "../lib/http.ts";
import { SDG_INFO } from "../../shared/sdg.js";

// All 17 goals (shared/sdg.js), so rule-based tags on ESCO jobs and skills have a name and colour too.
export const SDGS = SDG_INFO;
export const EMERGING_THRESHOLDS = { postings: 15, employers: 5, weeks: 4 };

export default function graphRoutes(svc: Services) {
  const r = Router();
  r.get("/graph", async (req, res) => {
    const q = parse(z.object({ kb: z.union([z.literal("latest"), z.coerce.number().int().positive()]).default("latest") }), req.query);
    const g = await loadGraph(svc.db, q.kb);
    res.json({ ...g, sdgs: SDGS, thresholds: EMERGING_THRESHOLDS });
  });
  r.get("/kb/versions", async (_req, res) => { res.json({ versions: await listVersions(svc.db) }); });
  return r;
}
