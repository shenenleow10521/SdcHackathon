// Career network over all 3,039 ESCO jobs (server/services/esco-network.ts).
// GET /api/esco/occupations/:id/next?limit=   closest jobs to this one, by shared skills, with AI exposure
// GET /api/esco/profile/:id/best-jobs?limit=  your best matches across ALL ESCO jobs, from your profile's skills
import { Router } from "express";
import { z } from "zod";
import type { Services } from "../context.ts";
import { parse, notFound, HttpError } from "../lib/http.ts";
import { loadProfile } from "../repo.ts";
import { loadEsco } from "../services/esco.ts";
import { nextJobs, bestJobsForProfile } from "../services/esco-network.ts";

const limitQ = z.object({ limit: z.coerce.number().int().min(1).max(25).default(10) });

export default function escoNetworkRoutes(svc: Services) {
  const r = Router();
  const need = () => { if (!loadEsco()) throw new HttpError(503, "esco_missing", "ESCO data isn't loaded"); };

  r.get("/esco/occupations/:id/next", (req, res) => {
    need();
    const id = parse(z.string().regex(/^[0-9a-f-]{36}$/), req.params.id);
    const { limit } = parse(limitQ, req.query);
    const out = nextJobs(id, limit);
    if (!out) throw notFound("ESCO occupation");
    res.json(out);
  });

  r.get("/esco/profile/:id/best-jobs", async (req, res) => {
    need();
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const { limit } = parse(limitQ, req.query);
    const p = await loadProfile(svc.db, id);
    if (!p) throw notFound("Profile");
    const confirmed = new Set((await svc.db.query("select skill_id from profile_esco_skills where profile_id=$1", [id])).rows.map((x: any) => x.skill_id as string));
    res.json({ profileId: id, jobs: bestJobsForProfile(p.level, confirmed, limit), method: "Share of each ESCO job's essential skills you have (confirmed, from your CV, or mapped from the career-path map)." });
  });
  return r;
}
