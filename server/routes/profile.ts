// Profile & intake routes (OWNER: intake agent). Contract: docs/API.md, "Profile & intake".
//   POST /profile/intake          CV (PDF upload or pasted text) -> new profile + draft + up to 3 questions
//   POST /profile/:id/answers     interviewer answers -> levels become 'self'
//   GET  /profile/:id             the profile
//   PUT  /profile/:id             edit settings (hours, budget, target date, SDG priority, language, current job)
//   PUT  /profile/:id/skills      set skill levels (0 removes)
//   GET  /skills/:skillId/check   start a "Prove" check (questions only, no answers)
//   POST /skills/:skillId/check   submit it; pass (>= 70%) -> 'verified'
import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { z } from "zod";
import type { Services } from "../context.ts";
import { parse, badRequest, notFound, rateLimit, HttpError } from "../lib/http.ts";
import { loadProfile, audit } from "../repo.ts";
import { extractPdfText, MAX_PDF_BYTES } from "../lib/pdf.ts";
import { extractDraft, MAX_CV_CHARS } from "../agents/cv.ts";
import { buildQuestions, applyAnswers } from "../agents/interviewer.ts";
import { createCheck, submitCheck } from "../agents/checks.ts";

const idParam = z.object({ id: z.coerce.number().int().positive() });
// Multipart fields arrive as strings; "" means "not given".
const optionalInt = (min: number, max: number) =>
  z.preprocess(v => (v === "" || v === null ? undefined : v), z.coerce.number().int().min(min).max(max).optional());

const intakeFields = z.object({
  hours: optionalInt(1, 40),
  lang: z.enum(["en", "ms"]).optional(),
});
const pasteBody = intakeFields.extend({
  text: z.string().trim().min(50, "Please paste at least a few lines of your CV").max(MAX_CV_CHARS, `CV text is limited to ${MAX_CV_CHARS} characters`),
});

const profileUpdate = z.object({
  displayName: z.string().trim().min(1).max(80),
  hours: z.number().int().min(1).max(40),
  budgetRm: z.number().min(0).max(1_000_000).nullable(),
  targetDate: z.iso.date().nullable(),
  sdgPriority: z.number().int().min(1).max(17).nullable(),
  lang: z.enum(["en", "ms"]),
  occupationId: z.string().min(1).max(60),
}).partial().strict().refine(o => Object.keys(o).length > 0, "Give at least one field to change");

const skillsBody = z.object({
  skills: z.array(z.object({ skillId: z.string().min(1).max(60), level: z.number().int().min(0).max(5) })).min(1).max(100),
});
const answersBody = z.object({ answers: z.record(z.string().max(80), z.union([z.number(), z.string().max(10)])) });
const checkQuery = z.object({ profile: z.coerce.number().int().positive().default(1) });
const checkBody = z.object({
  profileId: z.number().int().positive(),
  checkId: z.string().min(1).max(64),
  answers: z.record(z.string().max(10), z.number().int().min(0).max(10)),
});

/** One PDF in memory (never written to disk). Multer errors become friendly JSON errors. */
function uploadCv() {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PDF_BYTES, files: 1, fields: 10 } }).single("cv");
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.is("multipart/form-data")) return next();
    upload(req, res, (err: any) => {
      if (!err) return next();
      if (err.code === "LIMIT_FILE_SIZE") return next(new HttpError(413, "too_large", "The PDF is larger than 5 MB. You can paste your CV text instead."));
      next(badRequest(`Upload problem: ${err.message}. Send one PDF in the field "cv".`));
    });
  };
}

export default function profileRoutes(svc: Services) {
  const r = Router();

  const unknownSkills = async (ids: string[]) => {
    const rows = (await svc.db.query("select id from skills")).rows as any[];
    const all = new Set(rows.map(x => x.id));
    return ids.filter(id => !all.has(id));
  };
  const mustLoad = async (id: number) => {
    const p = await loadProfile(svc.db, id);
    if (!p) throw notFound("Profile");
    return p;
  };
  // The sample persona is shared by every visitor, so nobody can change it on the server.
  const mustEdit = async (id: number) => {
    const p = await mustLoad(id);
    if (p.isDemo) throw new HttpError(403, "demo_profile_read_only", "The sample persona can't be changed. Start your own profile to edit it.");
    return p;
  };

  r.post("/profile/intake", rateLimit(10, 60_000), uploadCv(), async (req, res) => {
    let text: string, fields: z.infer<typeof intakeFields>, source: "pdf" | "paste";
    if (req.file) {
      fields = parse(intakeFields, req.body || {});
      text = (await extractPdfText(req.file.buffer)).text;
      source = "pdf";
    } else if (req.is("multipart/form-data")) {
      throw badRequest('No file received. Send a PDF in the field "cv", or paste your CV text.');
    } else {
      const b = parse(pasteBody, req.body || {});
      fields = b; text = b.text; source = "paste";
    }

    const { draft, scrubbed, providers } = await extractDraft(svc, text);
    // Save the new profile: only ids, levels and short evidence quotes; never the CV text.
    const profileId = await svc.db.tx(async t => {
      const p = await t.query<{ id: number }>(
        `insert into profiles(display_name, current_occupation_id, hours_per_week, lang, is_demo) values ($1,$2,$3,$4,false) returning id`,
        [fields.lang === "ms" ? "Profil saya" : "My profile", draft.occupation.id, fields.hours ?? 6, fields.lang || "en"]);
      const id = p.rows[0].id;
      for (const s of draft.skills)
        await t.query("insert into profile_skills(profile_id, skill_id, level, confidence, evidence) values ($1,$2,$3,'cv',$4)", [id, s.skillId, s.level, s.evidence]);
      // ESCO skills the CV shows in use are saved as "from your CV" (the user can remove them in "Check any job").
      // Skills that are only listed are returned as suggestions but not saved.
      for (const e of draft.escoSkills || [])
        if (e.shownInUse) await t.query("insert into profile_esco_skills(profile_id, skill_id, source) values ($1,$2,'cv') on conflict do nothing", [id, e.escoId]);
      return id;
    });
    await audit(svc.db, "user", "profile.intake", String(profileId), { source, skills: draft.skills.length, occupation: draft.occupation.id, providers });
    const questions = await buildQuestions(svc, draft, { hoursGiven: fields.hours !== undefined, lang: fields.lang });
    const { nearMisses: _internal, ...publicDraft } = draft;
    res.status(201).json({ profileId, profile: await loadProfile(svc.db, profileId), draft: publicDraft, questions, scrubbed, providers });
  });

  r.post("/profile/:id/answers", async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { answers } = parse(answersBody, req.body || {});
    await mustEdit(id);
    res.json({ profile: await applyAnswers(svc, id, answers) });
  });

  r.get("/profile/:id", async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json(await mustLoad(id));
  });

  r.put("/profile/:id", async (req, res) => {
    const { id } = parse(idParam, req.params);
    const b = parse(profileUpdate, req.body || {});
    await mustEdit(id);
    if (b.occupationId !== undefined && !(await svc.db.query("select 1 from occupations where id=$1", [b.occupationId])).rows.length)
      throw badRequest("Invalid input", [{ path: "occupationId", message: "Unknown occupation" }]);
    const cols: Record<string, string> = { displayName: "display_name", hours: "hours_per_week", budgetRm: "budget_rm", targetDate: "target_date",
      sdgPriority: "sdg_priority", lang: "lang", occupationId: "current_occupation_id" };
    const keys = Object.keys(b) as (keyof typeof b)[];
    await svc.db.query(`update profiles set ${keys.map((k, i) => `${cols[k]}=$${i + 2}`).join(", ")} where id=$1`, [id, ...keys.map(k => b[k])]);
    await audit(svc.db, "user", "profile.update", String(id), { fields: keys });
    res.json({ profile: await loadProfile(svc.db, id) });
  });

  r.put("/profile/:id/skills", async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { skills } = parse(skillsBody, req.body || {});
    await mustEdit(id);
    const unknown = await unknownSkills(skills.map(s => s.skillId));
    if (unknown.length) throw badRequest("Invalid input", unknown.map(s => ({ path: "skills", message: `Unknown skill: ${s}` })));
    await svc.db.tx(async t => {
      for (const s of skills) {
        if (s.level === 0) await t.query("delete from profile_skills where profile_id=$1 and skill_id=$2", [id, s.skillId]);
        // A changed level is the user's own rating ('self'); re-saving the same level keeps its confidence.
        else await t.query(`insert into profile_skills(profile_id, skill_id, level, confidence) values ($1,$2,$3,'self')
                            on conflict (profile_id, skill_id) do update set confidence = case when profile_skills.level = excluded.level
                              then profile_skills.confidence else 'self' end, level = excluded.level`, [id, s.skillId, s.level]);
      }
    });
    await audit(svc.db, "user", "profile.skills", String(id), { changed: skills.length });
    res.json({ profile: await loadProfile(svc.db, id) });
  });

  r.get("/skills/:skillId/check", async (req, res) => {
    const { profile } = parse(checkQuery, req.query);
    res.json(await createCheck(svc, profile, String(req.params.skillId).slice(0, 60)));
  });

  r.post("/skills/:skillId/check", async (req, res) => {
    const b = parse(checkBody, req.body || {});
    await mustLoad(b.profileId);
    res.json(await submitCheck(svc, String(req.params.skillId).slice(0, 60), b));
  });

  return r;
}
