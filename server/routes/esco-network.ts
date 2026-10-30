// Career network over all 3,039 ESCO jobs (server/services/esco-network.ts).
// GET /api/esco/occupations/:id/next?limit=   closest jobs to this one, by shared skills, with AI exposure
// GET /api/esco/profile/:id/outlook          your skills' outlook and the "Stay AI-ready" track
// GET /api/esco/profile/:id/best-jobs?limit=  your best matches across ALL ESCO jobs (limit <= 60), from your profile's
//                                             skills, and the ESCO skills you have that matter most for them
import { Router } from "express";
import { z } from "zod";
import type { Services } from "../context.ts";
import { parse, notFound, HttpError } from "../lib/http.ts";
import { loadProfile } from "../repo.ts";
import { loadEsco } from "../services/esco.ts";
import { nextJobs, bestJobsForProfile, mySkillsFor } from "../services/esco-network.ts";
import { skillOutlook } from "../services/outlook.ts";
import { loadGraph } from "../kb.ts";

const limitQ = z.object({ limit: z.coerce.number().int().min(1).max(25).default(10) });
const bestQ = z.object({ limit: z.coerce.number().int().min(1).max(60).default(10) });

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
    const { limit } = parse(bestQ, req.query);
    const p = await loadProfile(svc.db, id);
    if (!p) throw notFound("Profile");
    const confirmed = new Set((await svc.db.query("select skill_id from profile_esco_skills where profile_id=$1", [id])).rows.map((x: any) => x.skill_id as string));
    const { jobs, defaultPick } = bestJobsForProfile(p.level, confirmed, limit, { current: p.currentEsco?.id ?? null, hours: p.hours }) || { jobs: [], defaultPick: null };
    res.json({
      profileId: id, jobs, defaultPick, current: p.currentEsco ?? null,
      skills: mySkillsFor(p.level, confirmed, jobs.slice(0, 25)),
      pickMethod: "Default pick = the best match you can reach soonest: match x 52 / (52 + rough weeks to job-ready at 6 h a week), leaving out your current job and moves to a lower ISCO skill level.",
      method: "Match = how much of what the job needs you already have: the share of its essential skills you have, with part credit for a close skill you have; knowledge items count half. Same rule as the catalogue jobs.",
    });
  });
  // GET /api/esco/profile/:id/outlook  each of your skills: how much AI can do, how it changes in your job's tasks, what to
  // learn; and the "Stay AI-ready in your job" track (server/services/outlook.ts)
  r.get("/esco/profile/:id/outlook", async (req, res) => {
    need();
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const [p, g] = await Promise.all([loadProfile(svc.db, id), loadGraph(svc.db)]);
    if (!p) throw notFound("Profile");
    const confirmed = new Set((await svc.db.query("select skill_id from profile_esco_skills where profile_id=$1", [id])).rows.map((x: any) => x.skill_id as string));
    const occ = g.nodes[p.occupationId];
    res.json({ profileId: id, ...skillOutlook({ level: p.level, confirmed, currentEscoId: p.currentEsco?.id ?? null, jobTitle: occ && p.occupationId !== "other" ? occ.name : null, courses: g.courses }) });
  });
  return r;
}
