// Learning resources and one ESCO skill's outlook (for the skill panel opened from the map).
// GET /api/learning            hand-picked resources by skill id (server/services/learning.ts)
// GET /api/esco/skills/:id     one ESCO skill: title, description, our model's score and its band (server/services/outlook.ts)
import { Router } from "express";
import { z } from "zod";
import type { Services } from "../context.ts";
import { notFound, HttpError } from "../lib/http.ts";
import { loadLearning } from "../services/learning.ts";
import { loadEsco } from "../services/esco.ts";
import { OUTLOOK } from "../services/outlook.ts";

const skillId = z.string().regex(/^[0-9a-f-]{36}$/);

export default function learningRoutes(_svc: Services) {
  const r = Router();
  r.get("/learning", (_req, res) => { res.json(loadLearning()); });

  r.get("/esco/skills/:id", (req, res) => {
    const d = loadEsco();
    if (!d) throw new HttpError(503, "esco_missing", "ESCO data isn't loaded");
    const p = skillId.safeParse(req.params.id);
    const sid = p.success ? p.data : "";
    const s = sid ? d.skills[sid] : null;
    if (!s) throw notFound("Skill");
    const e = typeof d.scores[sid]?.[0] === "number" ? d.scores[sid][0] : null;
    res.json({
      id: sid, title: s.title, description: s.description || "", type: s.type || null,
      exposure: e == null ? null : Math.round(100 * e) / 100,
      band: e == null || s.type === "knowledge" ? null : e >= OUTLOOK.atRisk ? "risk" : e >= OUTLOOK.changing ? "changing" : "safe",
    });
  });
  return r;
}
