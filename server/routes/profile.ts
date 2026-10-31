// Profile & intake routes (OWNER: intake agent). Contract: docs/API.md, "Profile & intake".
//   POST /profile/intake          CV (PDF, scan or photo upload, or pasted text) -> new profile + draft + up to 3 questions
//                                 (a scan read with low OCR confidence returns { needsReview, text } for the user to check first)
//   GET  /profile/quiz/sectors    no-CV path: the sectors and how many jobs / tasks each has
//   POST /profile/quiz/next       no-CV path: the next round of task chips (or done), from the answers so far
//   POST /profile/quiz/finish     no-CV path: answers -> new profile (same shape as CV intake) + draft + questions
//   POST /profile/:id/answers     interviewer answers -> levels become 'self'
//   GET  /profile/:id             the profile
//   PUT  /profile/:id             edit settings (hours, budget, target date, SDG priority, language, current job, current ESCO job,
//                                 share goal progress with HR)
//   PUT  /profile/:id/skills      set skill levels (0 removes)
//   GET  /skills/:skillId/check   start a "Prove" check (questions only, no answers)
//   POST /skills/:skillId/check   submit it; pass (>= 70%) -> 'verified' (and, on a goal step, a 'check' proof + the tick)
//   Goal progress routes: server/routes/goal.ts
import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { z } from "zod";
import type { Services } from "../context.ts";
import { parse, badRequest, notFound, rateLimit, HttpError } from "../lib/http.ts";
import { loadProfile, audit, setSkillLevels } from "../repo.ts";
import { MAX_PDF_BYTES } from "../lib/pdf.ts";
import { extractCvText, type OcrInfo } from "../lib/extract.ts";
import { OCR_MAX_PAGES } from "../lib/ocr.ts";
import { extractDraft, MAX_CV_CHARS } from "../agents/cv.ts";
import { buildQuestions, applyAnswers } from "../agents/interviewer.ts";
import { createCheck, submitCheck } from "../agents/checks.ts";
import { SECTORS, SECTOR_IDS, MIN_ROUNDS, MAX_ROUNDS, CHIPS_PER_ROUND, sectorModel, pickTasks, isDone, posterior, quizDraft,
  chipFor, warmChips, catalogueOccupation, type SectorModel, type Rounds } from "../services/quiz.ts";
import type { Db } from "../lib/db.ts";
import { currentEscoFor, loadEsco } from "../services/esco.ts";
import { recordCheckProof, tickStayByProof } from "../services/goal.ts";
import { loadGraph } from "../kb.ts";

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
  currentEscoId: z.string().regex(/^[0-9a-f-]{36}$/).nullable(),
  shareProgress: z.boolean(),
}).partial().strict().refine(o => Object.keys(o).length > 0, "Give at least one field to change");

const skillsBody = z.object({
  skills: z.array(z.object({ skillId: z.string().min(1).max(60), level: z.number().int().min(0).max(5) })).min(1).max(100),
});
const quizBody = z.object({
  sector: z.enum(SECTOR_IDS),
  seed: z.number().int().min(0).max(2 ** 31 - 1).default(1),
  lang: z.enum(["en", "ms"]).optional(),
  rounds: z.array(z.array(z.object({ taskId: z.string().regex(/^\d{2}-\d{4}\.\d{2}#\d{1,3}$/, "Unknown task"), ticked: z.boolean() }))
    .min(1).max(CHIPS_PER_ROUND + 2)).max(MAX_ROUNDS).default([]),
});
const quizFinishBody = quizBody.extend({ hours: z.number().int().min(1).max(40).optional() });

const answersBody = z.object({ answers: z.record(z.string().max(80), z.union([z.number(), z.string().max(10)])) });
const checkQuery = z.object({ profile: z.coerce.number().int().positive().default(1) });
const checkBody = z.object({
  profileId: z.number().int().positive(),
  checkId: z.string().min(1).max(64),
  answers: z.record(z.string().max(10), z.number().int().min(0).max(10)),
});

/** One PDF, or up to 3 photos (one per page), in memory (never written to disk). Multer errors become friendly JSON errors. */
function uploadCv() {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PDF_BYTES, files: OCR_MAX_PAGES, fields: 10 } }).array("cv", OCR_MAX_PAGES);
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.is("multipart/form-data")) return next();
    upload(req, res, (err: any) => {
      if (!err) return next();
      if (err.code === "LIMIT_FILE_SIZE") return next(new HttpError(413, "too_large", "The file is larger than 5 MB. You can paste your CV text instead."));
      if (err.code === "LIMIT_FILE_COUNT" || (err.code === "LIMIT_UNEXPECTED_FILE" && err.field === "cv"))
        return next(new HttpError(400, "too_many_files", `Send one PDF, or up to ${OCR_MAX_PAGES} photos (one per page).`));
      next(badRequest(`Upload problem: ${err.message}. Send one PDF, JPG or PNG in the field "cv".`));
    });
  };
}

type NewSkill = { skillId: string; level: number; confidence: string; evidence: string | null };
/** Saves a new (non-demo) profile: only ids, levels and short evidence; never CV text. Shared by CV intake and the quiz. */
async function saveNewProfile(db: Db, p: { lang?: "en" | "ms"; hours?: number; occupationId: string; currentEscoId: string | null; skills: NewSkill[]; escoSkills: string[]; escoSource: "cv" | "self" }) {
  return db.tx(async t => {
    const r = await t.query<{ id: number }>(
      `insert into profiles(display_name, current_occupation_id, current_esco_id, hours_per_week, lang, is_demo) values ($1,$2,$3,$4,$5,false) returning id`,
      [p.lang === "ms" ? "Profil saya" : "My profile", p.occupationId, p.currentEscoId, p.hours ?? 6, p.lang || "en"]);
    const id = r.rows[0].id;
    for (const s of p.skills)
      await t.query("insert into profile_skills(profile_id, skill_id, level, confidence, evidence) values ($1,$2,$3,$4,$5)", [id, s.skillId, s.level, s.confidence, s.evidence]);
    for (const e of p.escoSkills)
      await t.query("insert into profile_esco_skills(profile_id, skill_id, source) values ($1,$2,$3) on conflict do nothing", [id, e, p.escoSource]);
    return id;
  });
}

/** Every answered task must be one of this sector's chips, asked once. */
function checkRounds(m: SectorModel, rounds: Rounds) {
  const seen = new Set<string>();
  const bad = rounds.flat().filter(a => { const dup = seen.has(a.taskId); seen.add(a.taskId); return dup || !m.support.has(a.taskId); });
  if (bad.length) throw badRequest("Invalid answers", bad.slice(0, 5).map(a => ({ path: "rounds", message: `Unknown or repeated task: ${a.taskId}` })));
}
const mustSector = (id: string) => {
  const m = sectorModel(id);
  if (!m) throw new HttpError(503, "quiz_unavailable", "The questions aren't available right now. Please upload or paste a CV instead.");
  return m;
};

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
    let text: string, fields: z.infer<typeof intakeFields>, source: "pdf" | "ocr" | "paste", ocr: OcrInfo | undefined;
    const files = (req.files as Express.Multer.File[] | undefined) || [];
    if (files.length) {
      fields = parse(intakeFields, req.body || {});
      ({ text, source, ocr } = await extractCvText(files));
      // A shaky scan: send the text back for the user to check and fix. Nothing is saved and no AI has seen it.
      if (ocr?.lowConfidence) { res.json({ needsReview: true, text: text.slice(0, MAX_CV_CHARS), ocr }); return; }
    } else if (req.is("multipart/form-data")) {
      throw badRequest('No file received. Send a PDF, JPG or PNG in the field "cv", or paste your CV text.');
    } else {
      const b = parse(pasteBody, req.body || {});
      fields = b; text = b.text; source = "paste";
    }

    const { draft, scrubbed, providers } = await extractDraft(svc, text);
    // Save the new profile: only ids, levels and short evidence quotes; never the CV text.
    // ESCO skills the CV shows in use are saved as "from your CV" (the user can remove them in "Check any job").
    // Skills that are only listed are returned as suggestions but not saved.
    const escoInUse = (draft.escoSkills || []).filter(e => e.shownInUse).map(e => e.escoId);
    // The current job in ESCO terms: the best ESCO match of the CV's job title, using the ESCO skills it shows in use.
    const currentEsco = currentEscoFor(draft.occupation.matchedFrom, escoInUse);
    const profileId = await saveNewProfile(svc.db, {
      lang: fields.lang, hours: fields.hours, occupationId: draft.occupation.id, currentEscoId: currentEsco?.id ?? null,
      skills: draft.skills.map(s => ({ skillId: s.skillId, level: s.level, confidence: "cv", evidence: s.evidence })),
      escoSkills: escoInUse, escoSource: "cv",
    });
    await audit(svc.db, "user", "profile.intake", String(profileId), { source, skills: draft.skills.length, occupation: draft.occupation.id, providers, ...(ocr ? { ocrConfidence: ocr.confidence } : {}) });
    const questions = await buildQuestions(svc, draft, { hoursGiven: fields.hours !== undefined, lang: fields.lang });
    const { nearMisses: _internal, ...publicDraft } = draft;
    res.status(201).json({ profileId, profile: await loadProfile(svc.db, profileId), draft: publicDraft, questions, scrubbed, providers, ...(ocr ? { ocr } : {}) });
  });

  // ---- No CV: adaptive task questions (server/services/quiz.ts). No personal data is asked or stored. ----
  r.get("/profile/quiz/sectors", (_req, res) => {
    res.json({
      sectors: SECTORS.map(s => { const m = sectorModel(s.id); return { id: s.id, icon: s.icon, jobs: m?.occs.length ?? 0, tasks: m?.pool.length ?? 0 }; }).filter(s => s.jobs > 0),
      minRounds: MIN_ROUNDS, maxRounds: MAX_ROUNDS,
    });
  });

  r.post("/profile/quiz/next", rateLimit(60, 60_000), (req, res) => {
    const b = parse(quizBody, req.body || {});
    const m = mustSector(b.sector);
    checkRounds(m, b.rounds);
    const lang = b.lang === "ms" ? "ms" : "en";
    const picked = isDone(m, b.rounds) ? [] : pickTasks(m, b.rounds, b.seed);
    // Still in the running: at least half a uniform share, so all count at the start whatever the sector size.
    const left = posterior(m, b.rounds).filter(x => x >= Math.min(0.02, 0.5 / m.occs.length)).length;
    if (!picked.length) { res.json({ done: true, round: b.rounds.length, candidates: left, total: m.occs.length }); return; }
    warmChips(svc, picked.map(c => c.task)); // background only: this response uses the chip text that is ready now
    res.json({ done: false, round: b.rounds.length + 1, minRounds: MIN_ROUNDS, maxRounds: MAX_ROUNDS, candidates: left, total: m.occs.length,
      chips: picked.map(c => chipFor(c.task.id, c.task.text, lang)) });
  });

  r.post("/profile/quiz/finish", rateLimit(10, 60_000), async (req, res) => {
    const b = parse(quizFinishBody, req.body || {});
    const m = mustSector(b.sector);
    checkRounds(m, b.rounds);
    const label = new Map(((await svc.db.query("select id, label from skills")).rows as { id: string; label: string }[]).map(x => [x.id, x.label]));
    const q = quizDraft(m, b.rounds, new Set(label.keys()));
    if (!q.ticked.length) throw badRequest("Tick at least one task you do, or try another sector.");
    const top = q.ranking[0];
    const confidence: "high" | "medium" | "low" = top.p >= 0.6 ? "high" : top.p >= 0.3 ? "medium" : "low";
    const want = confidence === "low" ? "other" : catalogueOccupation(top.onet);
    const occ = (await svc.db.query("select id, title from occupations where id=$1", [want])).rows[0] as { id: string; title: string } | undefined;
    const occupationId = occ ? want : "other";
    const draft = {
      // Closest job: our catalogue job when the quiz lands on one, otherwise the O*NET job title (clearer than the
      // crosswalked ESCO title, e.g. "Bookkeeping, Accounting, and Auditing Clerks" rather than "tax clerk").
      occupation: { id: occupationId, title: occ && occupationId !== "other" ? occ.title : top.title, confidence, matchedFrom: top.title, escoId: top.escoId, escoTitle: top.escoTitle },
      skills: q.skills.map(s => ({ skillId: s.skillId, label: label.get(s.skillId)!, level: s.level, confidence: "quiz" as const, evidence: s.evidence, sure: s.sure })),
      escoSkills: q.escoSkills.map(e => ({ escoId: e.escoId, title: e.title, evidence: null, shownInUse: true, phrase: e.task })),
      matches: q.ranking.map(r => ({ title: r.title, onet: r.onet, escoId: r.escoId, escoTitle: r.escoTitle, p: r.p })),
      unmatched: [] as string[],
    };
    // Quiz skills are the person's own answers about their tasks: catalogue levels are marked 'quiz', ESCO skills 'self'
    // (profile_esco_skills.source only allows 'self' | 'cv').
    // The current job in ESCO terms: the quiz's top job, unless the quiz is unsure (then the person picks it later).
    const currentEscoId = confidence !== "low" && loadEsco()?.occupations[top.escoId] ? top.escoId : null;
    const profileId = await saveNewProfile(svc.db, {
      lang: b.lang, hours: b.hours, occupationId, currentEscoId,
      skills: draft.skills.map(s => ({ skillId: s.skillId, level: s.level, confidence: "quiz", evidence: s.evidence })),
      escoSkills: draft.escoSkills.map(e => e.escoId), escoSource: "self",
    });
    await audit(svc.db, "user", "profile.quiz", String(profileId), { sector: b.sector, rounds: b.rounds.length, ticked: q.ticked.length, skills: draft.skills.length, esco: draft.escoSkills.length, occupation: occupationId });
    const questions = await buildQuestions(svc, { ...draft, nearMisses: q.nearMisses }, { hoursGiven: b.hours !== undefined, lang: b.lang });
    res.status(201).json({ profileId, profile: await loadProfile(svc.db, profileId), draft, questions, source: "quiz", providers: { llm: "none", embed: "none", matching: "quiz" } });
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
    if (b.currentEscoId && !loadEsco()?.occupations[b.currentEscoId])
      throw badRequest("Invalid input", [{ path: "currentEscoId", message: "Unknown ESCO occupation" }]);
    const cols: Record<string, string> = { displayName: "display_name", hours: "hours_per_week", budgetRm: "budget_rm", targetDate: "target_date",
      sdgPriority: "sdg_priority", lang: "lang", occupationId: "current_occupation_id", currentEscoId: "current_esco_id",
      shareProgress: "share_progress" };
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
    // A changed level is the user's own rating ('self'); re-saving the same level keeps its confidence.
    await svc.db.tx(t => setSkillLevels(t, id, skills));
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
    const skillId = String(req.params.skillId).slice(0, 60);
    const out = await submitCheck(svc, skillId, b);
    // A pass on a goal step also records who vouches for it ("HalaTuju skill check") and ticks the step.
    const passed = out.passed && out.saved, g = passed ? await loadGraph(svc.db) : null;
    const goalSteps = passed ? await recordCheckProof(svc, g!, b.profileId, skillId) : [];
    // ...and on the "Stay AI-ready" track it ticks that skill the same way
    const stay = passed ? await tickStayByProof(svc, g!, b.profileId, skillId, true) : false;
    res.json(goalSteps.length || stay ? { ...out, profile: (await loadProfile(svc.db, b.profileId))!, goalSteps, stay } : { ...out, goalSteps, stay });
  });

  return r;
}
