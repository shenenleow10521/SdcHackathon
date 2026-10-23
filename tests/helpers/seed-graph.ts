// Builds an engine graph straight from db/seed/knowledge.json (no database), for pure engine tests.
import { readFileSync } from "node:fs";

export const knowledge = JSON.parse(readFileSync(new URL("../../db/seed/knowledge.json", import.meta.url), "utf8"));

export function seedGraph(deltas: { e?: Record<string, number>; d?: Record<string, number> } = {}) {
  const nodes: Record<string, any> = {};
  for (const o of knowledge.occupations) nodes[o.id] = { name: o.title, type: o.isDestination ? "job" : "occupation", e: o.e, d: o.d, stay: o.stay };
  for (const s of knowledge.skills) nodes[s.id] = { name: s.label, type: "skill", e: s.e, d: s.d, emerging: s.emerging ? { status: s.emerging.status } : null };
  return { kbVersion: 1, nodes, edges: knowledge.edges, req: knowledge.requirements, sectors: knowledge.sectors.map((s: any) => ({ id: s.id, jobs: s.jobs })), deltas };
}

export const persona = { occupationId: "ap", level: knowledge.persona.level as Record<string, number>, hours: 6 };
