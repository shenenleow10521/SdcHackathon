// The full ESCO taxonomy ("check any job").
// GET /api/esco/stats                     counts, sources, model-score provenance
// GET /api/esco/occupations?q=&limit=     search all ESCO occupations
// GET /api/esco/occupations/:id?profile=  one occupation: match %, essential/optional skills with your coverage, ILO exposure
// GET /api/esco/skills?q=&limit=          search all ESCO skills
// GET /api/esco/profile/:id/skills        ESCO skills the person confirmed
// PUT /api/esco/profile/:id/skills        { add?: [id], remove?: [id] } confirm / un-confirm ESCO skills
import { Router } from "express";
import { z } from "zod";
import type { Services } from "../context.ts";
import { parse, notFound, HttpError } from "../lib/http.ts";
import { loadProfile } from "../repo.ts";
import { escoStats, searchOccupations, searchSkills, occupationDetail, loadEsco, isEscoSkill } from "../services/esco.ts";
import { aiSkillsReport, aiSkillsFor, aiSkill, aiSkillJson } from "../services/ai-skills.ts";

const skillId = z.string().regex(/^[0-9a-f-]{36}$/);
const confirmedOf = async (svc: Services, profileId: number) =>
  new Set((await svc.db.query("select skill_id from profile_esco_skills where profile_id=$1", [profileId])).rows.map((r: any) => r.skill_id as string));

const search = z.object({ q: z.string().trim().min(2).max(100), limit: z.coerce.number().int().min(1).max(30).default(8) });

export default function escoRoutes(svc: Services) {
  const r = Router();
  const need = () => { if (!loadEsco()) throw new HttpError(503, "esco_missing", "ESCO data isn't loaded (run scripts/data/build_esco_full.py)"); };

  r.get("/esco/stats", (_req, res) => { res.json(escoStats()); });

  r.get("/esco/occupations", (req, res) => {
    need();
    const q = parse(search, req.query);
    res.json({ results: searchOccupations(q.q, q.limit) });
  });

  r.get("/esco/occupations/:id", async (req, res) => {
    need();
    const id = parse(z.string().regex(/^[0-9a-f-]{36}$/), req.params.id);
    const { profile } = parse(z.object({ profile: z.coerce.number().int().positive().optional() }), req.query);
    const p = profile ? await loadProfile(svc.db, profile) : null;
    if (profile && !p) throw notFound("Profile");
    const out = occupationDetail(id, p?.level || {}, p ? await confirmedOf(svc, p.id) : new Set());
    if (!out) throw notFound("ESCO occupation");
    // AI-era skills this job now asks for (not in ESCO 2022; not part of the match), with their sources
    res.json({ ...out, emerging: aiSkillsFor(id).map(aiSkillJson) });
  });

  // AI-era skills (server/services/ai-skills.ts): all 27 with sources, the jobs they are attached to, their nearest ESCO
  // skills, and the computed links we left out and why.
  r.get("/ai-skills", (_req, res) => {
    const out = aiSkillsReport();
    if (!out) throw new HttpError(503, "ai_skills_missing", "AI-era skills aren't loaded");
    res.json(out);
  });
  r.get("/ai-skills/:id", (req, res) => {
    const s = aiSkill(String(req.params.id).slice(0, 60));
    if (!s) throw notFound("AI-era skill");
    const d = loadEsco()!;
    res.json({ ...aiSkillJson(s), occupations: s.occupations.map(o => ({ id: o.id, title: d.occupations[o.id].title, score: o.score })),
      neighbours: s.neighbours.map(([id, rel]) => ({ id, title: d.skills[id].title, rel })) });
  });

  r.get("/esco/profile/:id/skills", async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    if (!(await loadProfile(svc.db, id))) throw notFound("Profile");
    res.json({ skills: [...(await confirmedOf(svc, id))] });
  });

  r.put("/esco/profile/:id/skills", async (req, res) => {
    need();
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const b = parse(z.object({ add: z.array(skillId).max(200).default([]), remove: z.array(skillId).max(200).default([]) }).strict(), req.body || {});
    if (!(await loadProfile(svc.db, id))) throw notFound("Profile");
    const bad = b.add.filter(s => !isEscoSkill(s));
    if (bad.length) throw new HttpError(400, "unknown_skill", `Not ESCO skill id(s): ${bad.join(", ")}`);
    await svc.db.tx(async t => {
      for (const s of b.add) await t.query("insert into profile_esco_skills(profile_id, skill_id, source) values ($1,$2,'self') on conflict do nothing", [id, s]);
      if (b.remove.length) await t.query("delete from profile_esco_skills where profile_id=$1 and skill_id = any($2::text[])", [id, b.remove]);
    });
    res.json({ skills: [...(await confirmedOf(svc, id))] });
  });

  r.get("/esco/skills", (req, res) => {
    need();
    const q = parse(search, req.query);
    res.json({ results: searchSkills(q.q, q.limit) });
  });
  return r;
}
