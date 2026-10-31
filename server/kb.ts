// Knowledge-base snapshots. The graph at version V = seed tables + every kb_change with kb_version <= V
// (minus changes undone by a 'revert' change at or before V). Versions are immutable, so snapshots are cached.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Db } from "./lib/db.ts";
import { projectRoot } from "./lib/db.ts";
import { HAVE_LEVEL } from "../shared/engine.js";
import { escoReq, ESCO_REQ_WEIGHT, catalogueIsco, mycolFor, dosmFor, type EscoReq } from "./lib/esco-labels.ts";

export interface KbChange {
  kind: "delta" | "emerging_status" | "add_skill" | "revert";
  nodeId?: string | null;
  deltaE?: number;
  deltaD?: number;
  payload?: any;
  signalId?: number | null;
  sourceUrl?: string | null;
}

export interface FullGraph {
  kbVersion: number;
  kbNote: string;
  kbCreatedAt: string;
  nodes: Record<string, any>;
  edges: { from: string; to: string; weeks: number; why: string; kind: string }[];
  req: Record<string, { skill: string; weight: number; need: number; share: number | null; status: string; source: string; esco?: EscoReq | null }[]>;
  sectors: { id: string; name: string; icon: string | null; note: string | null; jobs: string[] | null }[];
  courses: Record<string, any[]>;
  deltas: { e: Record<string, number>; d: Record<string, number> };
  appliedChanges: { id: number; kbVersion: number; kind: string; nodeId: string | null; deltaE: number; deltaD: number; signalId: number | null; sourceUrl: string | null }[];
}

const cache = new WeakMap<Db, Map<number, FullGraph>>();

export async function latestVersion(db: Db): Promise<number> {
  const r = await db.query<{ v: number }>("select coalesce(max(id),0)::int as v from kb_versions");
  return Number(r.rows[0].v);
}

export async function listVersions(db: Db) {
  const r = await db.query(`select v.id, v.created_at as "createdAt", v.note, v.actor, count(c.id)::int as changes
                            from kb_versions v left join kb_changes c on c.kb_version = v.id group by v.id order by v.id desc`);
  return r.rows;
}

/** Load the graph at a version (default: latest). */
export async function loadGraph(db: Db, version?: number | "latest"): Promise<FullGraph> {
  const latest = await latestVersion(db);
  const v = version === undefined || version === "latest" ? latest : Math.min(Number(version), latest);
  if (!Number.isInteger(v) || v < 1) throw Object.assign(new Error("Unknown knowledge-base version"), { status: 404, code: "kb_version" });
  let byVersion = cache.get(db);
  if (!byVersion) { byVersion = new Map(); cache.set(db, byVersion); }
  const hit = byVersion.get(v);
  if (hit) return hit;
  const g = await buildGraph(db, v);
  byVersion.set(v, g);
  return g;
}

export function clearGraphCache(db: Db) { cache.delete(db); }

// SDG tags from the seed file, for databases seeded before every catalogue job and skill had one: a missing tag in the
// database falls back to the seed's hand-written one, so the map never shows an untagged catalogue job or skill.
let seedSdgCache: Record<string, any> | null = null;
function seedSdg(): Record<string, any> {
  if (!seedSdgCache) {
    try {
      const k = JSON.parse(readFileSync(path.join(projectRoot, "db", "seed", "knowledge.json"), "utf8"));
      seedSdgCache = Object.fromEntries([...(k.occupations || []), ...(k.skills || [])].filter((x: any) => x.sdg?.length).map((x: any) => [x.id, x.sdg]));
    } catch { seedSdgCache = {}; }
  }
  return seedSdgCache!;
}

async function buildGraph(db: Db, v: number): Promise<FullGraph> {
  const [ver, occs, skills, outlook, edges, req, sectors, courses, tasks, aliases, changes] = await Promise.all([
    db.query("select note, created_at from kb_versions where id=$1", [v]),
    db.query("select * from occupations"),
    db.query("select id,label,description,source,source_uri,emerging,sdg,angle from skills"),
    db.query("select * from outlook"),
    db.query("select * from edges"),
    db.query("select * from occupation_skills order by occupation_id, weight desc, skill_id"),
    db.query("select * from sectors order by ord"),
    db.query("select * from courses order by skill_id, id"),
    db.query("select skill_id, text, mode, source from tasks order by id"),
    db.query("select skill_id, alias from skill_aliases order by alias"),
    db.query("select * from kb_changes where kb_version <= $1 order by id", [v]),
  ]);
  const ol: Record<string, any> = Object.fromEntries(outlook.rows.map((o: any) => [o.node_id, o]));
  const eArr = (id: string) => { const o = ol[id]; return o ? [o.e2026, o.e2030m, o.e2030f].map(Number) : [0.5, 0.5, 0.5]; };
  const dArr = (id: string) => { const o = ol[id]; return o ? [o.d2026, o.d2030m, o.d2030f].map(Number) : [0, 0, 0]; };

  const nodes: Record<string, any> = {};
  for (const o of occs.rows as any[]) {
    const isco = o.isco_code || catalogueIsco(o.id);
    nodes[o.id] = { name: o.title, type: o.is_destination ? "job" : "occupation", e: eArr(o.id), d: dArr(o.id), stay: o.stay,
      blurb: o.blurb, postings: o.postings, conf: o.conf, split: o.split, sdg: o.sdg?.length ? o.sdg : seedSdg()[o.id] || [], source: o.source, sourceUri: o.source_uri,
      iscoCode: isco, onetCode: o.onet_code, outlookSource: ol[o.id]?.source || "sample",
      mycol: mycolFor(isco), malaysia: dosmFor(isco) }; // MyCOL (4-digit group) and DOSM wages (major group), from the ISCO code
  }
  for (const s of skills.rows as any[])
    nodes[s.id] = { name: s.label, type: "skill", e: eArr(s.id), d: dArr(s.id), description: s.description,
      emerging: s.emerging ? { ...s.emerging } : null, sdg: s.sdg?.length ? s.sdg : seedSdg()[s.id] ?? null, angle: s.angle, source: s.source, sourceUri: s.source_uri,
      tasks: [], aliases: [], outlookSource: ol[s.id]?.source || "sample" };
  for (const t of tasks.rows as any[]) nodes[t.skill_id]?.tasks.push({ text: t.text, mode: t.mode, source: t.source });
  for (const a of aliases.rows as any[]) nodes[a.skill_id]?.aliases.push(a.alias);

  const graph: FullGraph = {
    kbVersion: v,
    kbNote: (ver.rows[0] as any)?.note || "",
    kbCreatedAt: (ver.rows[0] as any)?.created_at ? new Date((ver.rows[0] as any).created_at).toISOString() : "",
    nodes,
    edges: (edges.rows as any[]).map(e => ({ from: e.from_id, to: e.to_id, weeks: e.weeks, why: e.reason, kind: e.kind })),
    req: {},
    sectors: (sectors.rows as any[]).map(s => ({ id: s.id, name: s.name, icon: s.icon, note: s.note, jobs: s.jobs })),
    courses: {},
    deltas: { e: {}, d: {} },
    appliedChanges: [],
  };
  // Catalogue requirements: ESCO status and weight computed from ESCO (server/lib/esco-labels.ts), so existing
  // databases follow the rule too; the stored weight is used only when the job has no ESCO mapping.
  for (const r of req.rows as any[]) {
    const esco = escoReq(r.occupation_id, r.skill_id);
    (graph.req[r.occupation_id] ||= []).push({ skill: r.skill_id, weight: esco ? ESCO_REQ_WEIGHT[esco] : r.weight, need: r.level_needed, share: r.evidence_share,
      status: r.status, source: r.evidence_source, esco });
  }
  for (const rs of Object.values(graph.req)) rs.sort((a, b) => b.weight - a.weight || a.skill.localeCompare(b.skill));
  for (const c of courses.rows as any[])
    (graph.courses[c.skill_id] ||= []).push({ id: c.id, title: c.title, provider: c.provider, url: c.url, format: c.format, formatText: c.format_text,
      hours: c.hours, costRm: c.cost_rm === null ? null : Number(c.cost_rm), hrdClaimable: c.hrd_claimable, practice: c.practice_task, prove: c.prove_check, source: c.source });

  // Apply changes in order, skipping any that a later (<= v) revert has undone.
  const reverted = new Set<number>();
  for (const c of changes.rows as any[]) if (c.kind === "revert") for (const id of c.payload?.change_ids || []) reverted.add(Number(id));
  for (const c of changes.rows as any[]) {
    if (c.kind === "revert" || reverted.has(c.id)) continue;
    if (c.kind === "delta" && nodes[c.node_id]) {
      if (c.delta_e) graph.deltas.e[c.node_id] = round4((graph.deltas.e[c.node_id] || 0) + Number(c.delta_e));
      if (c.delta_d) graph.deltas.d[c.node_id] = round4((graph.deltas.d[c.node_id] || 0) + Number(c.delta_d));
    } else if (c.kind === "emerging_status" && nodes[c.node_id]) {
      nodes[c.node_id].emerging = { ...(nodes[c.node_id].emerging || {}), status: c.payload?.status };
    } else if (c.kind === "add_skill" && c.payload?.skill) {
      const s = c.payload.skill;
      nodes[s.id] = { name: s.label, type: "skill", e: s.e, d: s.d, emerging: s.emerging || { status: "provisional" }, source: "emerging",
        description: s.description || null, tasks: s.tasks || [], aliases: s.aliases || [], sdg: s.sdg || null, angle: null, outlookSource: "sample" };
      for (const e of c.payload.edges || []) graph.edges.push({ from: e.from, to: e.to, weeks: e.weeks, why: e.why, kind: e.kind || "build" });
      for (const r of c.payload.req || []) (graph.req[r.job] ||= []).push({ skill: s.id, weight: r.weight, need: HAVE_LEVEL, share: r.share ?? null, status: "emerging", source: "committee" }); // one level for every job, also for older payloads
    }
    graph.appliedChanges.push({ id: c.id, kbVersion: c.kb_version, kind: c.kind, nodeId: c.node_id, deltaE: Number(c.delta_e), deltaD: Number(c.delta_d), signalId: c.signal_id, sourceUrl: c.source_url });
  }
  return graph;
}

const round4 = (x: number) => Math.round(x * 10000) / 10000;

/** Create a new knowledge-base version holding the given changes. Returns the new version id. */
export async function createVersion(db: Db, note: string, actor: string, changes: KbChange[]): Promise<number> {
  return db.tx(async t => {
    const r = await t.query<{ id: number }>("insert into kb_versions(note, actor) values ($1,$2) returning id", [note, actor]);
    const id = r.rows[0].id;
    for (const c of changes)
      await t.query(`insert into kb_changes(kb_version,kind,node_id,delta_e,delta_d,payload,signal_id,source_url) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, c.kind, c.nodeId ?? null, c.deltaE ?? 0, c.deltaD ?? 0, c.payload ? JSON.stringify(c.payload) : null, c.signalId ?? null, c.sourceUrl ?? null]);
    return id;
  });
}

/** The plain engine graph (what shared/engine.js needs), from a full graph. */
export function engineGraph(g: FullGraph) {
  return { kbVersion: g.kbVersion, nodes: g.nodes, edges: g.edges, req: g.req, sectors: g.sectors, deltas: g.deltas, courses: g.courses };
}
