// Self-trained AI-exposure estimator.
// GET  /api/exposure/model        provenance, evaluation, availability
// POST /api/exposure/score        { tasks: string[] } -> scores for any task text
// GET  /api/exposure/skill/:id    scores for a catalogue skill's tasks, next to the knowledge-base value
import { Router } from "express";
import { z } from "zod";
import type { Services } from "../context.ts";
import { parse, notFound, rateLimit } from "../lib/http.ts";
import { loadGraph } from "../kb.ts";
import { modelInfo, scoreTasks } from "../services/exposure.ts";

export default function exposureRoutes(svc: Services) {
  const r = Router();
  r.get("/exposure/model", (_req, res) => { res.json(modelInfo(svc)); });

  r.post("/exposure/score", rateLimit(30, 60_000), async (req, res) => {
    const { tasks } = parse(z.object({ tasks: z.array(z.string().trim().min(3).max(300)).min(1).max(50) }).strict(), req.body);
    res.json({ scores: await scoreTasks(svc, tasks), model: modelInfo(svc) });
  });

  r.get("/exposure/skill/:id", async (req, res) => {
    const g = await loadGraph(svc.db);
    const node = g.nodes[req.params.id];
    if (!node || node.type !== "skill") throw notFound("Skill");
    const scores = node.tasks.length ? await scoreTasks(svc, node.tasks.map((t: any) => t.text)) : [];
    const mean = scores.length ? Math.round(1000 * scores.reduce((s, x) => s + x.exposure, 0) / scores.length) / 1000 : null;
    res.json({
      skillId: req.params.id, name: node.name,
      tasks: scores.map((s, i) => ({ ...s, sampleMode: node.tasks[i].mode })),
      modelMean: mean,
      knowledgeBase: { exposure2026: node.e[0], source: node.outlookSource },
      model: modelInfo(svc),
    });
  });
  return r;
}
