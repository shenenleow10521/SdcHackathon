// GET /api/graph — the knowledge base at a version, for the client-side engine and UI.
// GET /api/kb/versions — version history.
import { Router } from "express";
import { z } from "zod";
import type { Services } from "../context.ts";
import { loadGraph, listVersions } from "../kb.ts";
import { parse } from "../lib/http.ts";

export const SDGS = {
  4: { name: "Quality education", color: "#c5192d" }, 8: { name: "Decent work", color: "#a21942" },
  9: { name: "Industry & innovation", color: "#fd6925" }, 10: { name: "Reduced inequalities", color: "#dd1367" },
  12: { name: "Responsible production", color: "#bf8b2e" }, 13: { name: "Climate action", color: "#3f7e44" },
  16: { name: "Strong institutions", color: "#00689d" },
};
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
