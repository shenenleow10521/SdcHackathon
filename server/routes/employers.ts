// Employers & HR routes (docs/API.md "Employers & HR").
// - Employer requirements come from approved careers pages (extracted as a draft, checked by a person)
//   or from the employer form (stored as source 'employer_form', verified: false).
// - Per-employer match = the same engine formula with that employer's extra requirements added.
import { Router } from "express";
import { z } from "zod";
import type { Services } from "../context.ts";
import { loadGraph, type FullGraph } from "../kb.ts";
import { audit } from "../repo.ts";
import { parse, scenarioQuery, notFound, requireAdmin, requireRole, actorOf, rateLimit, badRequest } from "../lib/http.ts";
import { fetchApproved, isApproved } from "../sources/fetch.ts";
import { buildPlan } from "../services/planning.ts";
import { redeployment } from "../services/hr.ts";
import { extractRequirements } from "../agents/careers.ts";
import { requireProfile, employerExtraReq, signalInfo } from "./plan.ts";

const toDate = (v: any) => (v == null ? null : typeof v === "string" ? v.slice(0, 10) : new Date(v).toISOString().slice(0, 10));

function employerJson(e: any, jobs?: string[]) {
  return { id: e.id, name: e.name, sector: e.sector, careersUrl: e.careers_url, source: e.source, verified: e.verified,
    isSample: e.source === "sample", ...(jobs ? { jobs } : {}) };
}
const reqJson = (q: any) => ({ occupationId: q.occupation_id, skillId: q.skill_id, weight: q.weight, levelNeeded: q.level_needed,
  quote: q.quote, sourceUrl: q.source_url, sourceDate: toDate(q.source_date) });

async function getEmployer(svc: Services, id: number) {
  const e = (await svc.db.query("select * from employers where id=$1", [id])).rows[0];
  if (!e) throw notFound("Employer");
  return e;
}

/** The employer form. Ids are checked against the knowledge base after parsing. */
const formSchema = z.object({
  name: z.string().trim().min(2).max(120),
  sector: z.string().trim().max(80).optional(),
  careersUrl: z.url({ protocol: /^https?$/ }).max(500).optional(),
  requirements: z.array(z.object({
    occupationId: z.string().min(1).max(60),
    skillId: z.string().min(1).max(60),
    weight: z.number().int().min(1).max(3),
    levelNeeded: z.number().int().min(1).max(5),
  })).min(1).max(30),
});

function checkIds(graph: FullGraph, reqs: z.infer<typeof formSchema>["requirements"]) {
  const issues: { path: string; message: string }[] = [];
  const seen = new Set<string>();
  reqs.forEach((q, i) => {
    if (graph.nodes[q.occupationId]?.type !== "job") issues.push({ path: `requirements.${i}.occupationId`, message: `Unknown job id '${q.occupationId}'` });
    if (graph.nodes[q.skillId]?.type !== "skill") issues.push({ path: `requirements.${i}.skillId`, message: `Unknown skill id '${q.skillId}'` });
    const k = `${q.occupationId}/${q.skillId}`;
    if (seen.has(k)) issues.push({ path: `requirements.${i}`, message: `Duplicate requirement ${k}` });
    seen.add(k);
  });
  if (issues.length) throw badRequest("Invalid input", issues);
}

export default function employersRoutes(svc: Services) {
  const r = Router();
  const admin = requireAdmin(svc);
  const intId = z.coerce.number().int().positive();

  r.get("/employers", async (_req, res) => {
    const rows = (await svc.db.query("select * from employers order by id")).rows as any[];
    const jobs = (await svc.db.query(`select employer_id, occupation_id from employer_requirements
                                      union select employer_id, occupation_id from open_roles order by 1, 2`)).rows as any[];
    // hasTeam: someone's profile is linked to this employer (the HR sheet opens on the first such employer)
    const teams = new Set((await svc.db.query<{ employer_id: number }>("select distinct employer_id from profiles where employer_id is not null")).rows.map(r => r.employer_id));
    res.json({ employers: rows.map(e => ({ ...employerJson(e, jobs.filter(j => j.employer_id === e.id).map(j => j.occupation_id)), hasTeam: teams.has(e.id) })) });
  });

  r.get("/employers/:id", async (req, res) => {
    const e = await getEmployer(svc, parse(intId, req.params.id));
    const reqs = (await svc.db.query("select * from employer_requirements where employer_id=$1 order by occupation_id, id", [e.id])).rows;
    const roles = (await svc.db.query("select occupation_id, openings, deadline from open_roles where employer_id=$1 order by deadline, id", [e.id])).rows as any[];
    res.json({ employer: employerJson(e), requirements: reqs.map(reqJson),
      openRoles: roles.map(o => ({ job: o.occupation_id, openings: o.openings, deadline: toDate(o.deadline) })) });
  });

  // The employer form: employers publish their own requirements (unverified until checked).
  r.post("/employers", rateLimit(10, 60_000), async (req, res) => {
    const b = parse(formSchema, req.body);
    const g = await loadGraph(svc.db);
    checkIds(g, b.requirements);
    const today = svc.now().toISOString().slice(0, 10);
    const id = await svc.db.tx(async t => {
      const e = await t.query<{ id: number }>("insert into employers(name, sector, careers_url, source, verified) values ($1,$2,$3,'employer_form',false) returning id",
        [b.name, b.sector ?? null, b.careersUrl ?? null]);
      for (const q of b.requirements)
        await t.query(`insert into employer_requirements(employer_id, occupation_id, skill_id, weight, level_needed, quote, source_url, source_date)
                       values ($1,$2,$3,$4,$5,null,null,$6)`, [e.rows[0].id, q.occupationId, q.skillId, q.weight, q.levelNeeded, today]);
      return e.rows[0].id;
    });
    await audit(svc.db, `employer_form:${b.name.slice(0, 40)}`, "employer.create", `employer:${id}`, { requirements: b.requirements.length });
    const e = await getEmployer(svc, id);
    const reqs = (await svc.db.query("select * from employer_requirements where employer_id=$1 order by id", [id])).rows;
    res.status(201).json({ employer: employerJson(e), requirements: reqs.map(reqJson) });
  });

  // Match for one job at this employer: catalogue requirements + the employer's own.
  r.get("/employers/:id/match", async (req, res) => {
    const e = await getEmployer(svc, parse(intId, req.params.id));
    const q = parse(scenarioQuery.extend({ job: z.string().min(1).max(60).optional() }), req.query);
    const [g, p] = await Promise.all([loadGraph(svc.db), requireProfile(svc, q.profile)]);
    const job = q.job ?? ((await svc.db.query("select occupation_id from employer_requirements where employer_id=$1 order by id limit 1", [e.id])).rows[0] as any)?.occupation_id;
    if (!job) throw badRequest("This employer has no requirements yet; give ?job=");
    if (g.nodes[job]?.type !== "job") throw notFound(`Job '${job}'`);
    const extra = await employerExtraReq(svc, g, e.id, job);
    const catalogueSkills = new Set((g.req[job] || []).map(x => x.skill));
    const plan = buildPlan(g, p, { job, mode: q.mode, year: q.year, scenario: q.scenario, extraReq: extra, now: svc.now(), signals: await signalInfo(svc, g) });
    const catalogue = buildPlan(g, p, { job, mode: q.mode, year: q.year, scenario: q.scenario, now: svc.now() });
    res.json({
      employer: employerJson(e), job, title: g.nodes[job].name,
      match: plan.match, matchCatalogue: catalogue.match,
      // Skills this employer asks for that the catalogue job does not: extra stops on your route.
      extraStops: [...new Set(extra.map(x => x.skill).filter(s => !catalogueSkills.has(s)))],
      plan,
    });
  });

  // 🔒 Draft requirements from an approved careers page. Not saved: a person reviews it first.
  r.post("/employers/extract", admin, rateLimit(6, 60_000), async (req, res) => {
    const b = parse(z.object({ url: z.url({ protocol: /^https?$/ }).max(500) }), req.body);
    const actor = actorOf(req);
    const reject = async (reason: string) => {
      await audit(svc.db, actor, "employer.extract_rejected", b.url, { reason });
      res.json({ employerName: null, requirements: [], rejected: reason });
    };
    if (!isApproved(b.url, "careers")) return reject("Not an approved careers page: only careers pages on the approved source list are read");
    const page = await fetchApproved(svc, b.url, { kind: "careers" });
    if (!page.ok) return reject(page.reason);
    const out = await extractRequirements(svc, await loadGraph(svc.db), page);
    await audit(svc.db, actor, "employer.extract", page.finalUrl, { kept: out.requirements.length, dropped: out.dropped.length, model: out.model });
    res.json(out);
  });

  // 🔒 HR redeployment view for an employer's team.
  r.get("/hr/:employerId/redeployment", requireRole(svc, "advisor"), async (req, res) => {
    const id = parse(intId, req.params.employerId);
    const q = parse(scenarioQuery, req.query);
    const out = await redeployment(svc, await loadGraph(svc.db), id, { year: q.year, scenario: q.scenario, mode: q.mode });
    if (!out) throw notFound("Employer");
    res.json(out);
  });

  return r;
}
