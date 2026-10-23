// Knowledge pipeline routes (docs/API.md "Knowledge pipeline").
// People decide: every approve / reject / confirm / spot-check / undo is a human action, recorded in the
// audit log with the actor, and every change to the knowledge base is a new, undoable version.
import { Router } from "express";
import { z } from "zod";
import type { Services } from "../context.ts";
import { loadGraph, createVersion, latestVersion } from "../kb.ts";
import { audit } from "../repo.ts";
import { parse, requireAdmin, actorOf, rateLimit, HttpError, notFound } from "../lib/http.ts";
import { TRUSTED, LINK_ONLY, POLICY, API_TERMS } from "../sources/policy.ts";
import { FEEDS } from "../sources/rss.ts";
import { SOURCE_NAMES } from "../sources/types.ts";
import { websearchProviders } from "../sources/websearch.ts";
import { runScout, SIGNAL_SELECT, signalJson, getSignal } from "../agents/scout.ts";
import { runCommittee, candidateJson } from "../agents/committee.ts";
import { applyRescore, type Reroute } from "../services/rescore.ts";
import { TRIAGE } from "../triage.ts";

const intId = z.coerce.number().int().positive();
const noteBody = z.object({ note: z.string().max(500).optional() }).passthrough();

async function nodeNames(svc: Services) {
  const g = await loadGraph(svc.db);
  return Object.fromEntries(Object.entries(g.nodes).map(([id, n]) => [id, n.name as string]));
}

/** Undo specific changes as a new version, then re-score. Used by undo, failed spot checks and emerging rejections. */
export async function revertChanges(svc: Services, changeIds: number[], note: string, actor: string, ctx: { signalId?: number | null } = {}) {
  const before = await latestVersion(svc.db);
  const v = await createVersion(svc.db, note.slice(0, 300), actor, [{ kind: "revert", payload: { change_ids: changeIds } }]);
  let rerouted: Reroute[] = [];
  try { rerouted = await applyRescore(svc, before, v, { reason: note.slice(0, 300), signalId: ctx.signalId ?? null }); } catch { /* the version stands; snapshots can be rebuilt */ }
  return { kbVersion: v, rerouted };
}

/** A run's summary without the bulky recording (for error details). */
async function runSummary(svc: Services, runId: number) {
  return ((await svc.db.query(`select summary - 'recording' as summary from runs where id=$1`, [runId])).rows[0] as any)?.summary ?? null;
}

/** Change ids still in force (not already undone). */
async function activeChanges(svc: Services, where: string, params: unknown[]) {
  const rows = (await svc.db.query(`select id, kind, node_id, signal_id, payload from kb_changes where ${where} order by id`, params)).rows as any[];
  const reverted = new Set<number>();
  for (const r of (await svc.db.query(`select payload from kb_changes where kind='revert'`)).rows as any[]) for (const id of r.payload?.change_ids || []) reverted.add(Number(id));
  return rows.filter(r => r.kind !== "revert" && !reverted.has(r.id));
}

export default function knowledgeRoutes(svc: Services) {
  const r = Router();
  const admin = requireAdmin(svc);
  const runLimit = rateLimit(6, 60_000);

  // ---------- Sources and policy ----------
  r.get("/sources", (_req, res) => {
    res.json({
      trusted: TRUSTED.map(t => ({ domain: t.domain, kind: t.kind, why: t.why })),
      linkOnly: LINK_ONLY.map(l => ({ name: l.name, url: l.url, why: l.why })),
      policy: POLICY,
      apis: Object.entries(API_TERMS).map(([host, t]) => ({ host, termsUrl: t.termsUrl, minIntervalSeconds: t.minIntervalMs / 1000 })),
      feeds: FEEDS, sources: SOURCE_NAMES, websearch: websearchProviders(),
    });
  });

  r.get("/sources/log", async (_req, res) => {
    const rows = (await svc.db.query(`select id, url, host, status, ok, reason, sha256, excerpt, fetched_at as "fetchedAt" from fetch_log order by id desc limit 100`)).rows;
    res.json({ fetches: rows });
  });

  // ---------- Scout ----------
  r.post("/scout/run", admin, runLimit, async (req, res) => {
    const b = parse(z.object({
      sources: z.array(z.enum(SOURCE_NAMES as [string, ...string[]])).max(6).optional(),
      nodes: z.array(z.string().max(60)).max(30).optional(),
      replay: z.boolean().optional(),
    }), req.body || {});
    if (b.nodes?.length) {
      const g = await loadGraph(svc.db);
      const bad = b.nodes.filter(n => g.nodes[n]?.type !== "skill");
      if (bad.length) throw new HttpError(400, "unknown_node", `Unknown skill id(s): ${bad.join(", ")}`);
    }
    const out = await runScout(svc, { sources: b.sources as any, nodes: b.nodes, replay: b.replay, trigger: "manual" });
    await audit(svc.db, actorOf(req), "scout.run", `run:${out.runId}`, { status: out.status, counts: out.counts });
    // A run that failed outright is an error (502, run summary in details); partial source failures stay 200.
    if (out.status === "failed") return void res.status(502).json({ error: { code: "scout_failed", message: out.error || "Road Watch run failed", details: { runId: out.runId, summary: await runSummary(svc, out.runId) } } });
    res.json(out);
  });

  r.get("/scout/runs", async (req, res) => {
    const q = parse(z.object({ kind: z.enum(["scout", "committee", "rescore", "all"]).default("all"), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
    const rows = (await svc.db.query(`select id, kind, status, trigger, started_at as "startedAt", finished_at as "finishedAt", summary - 'recording' - 'items' as summary
       from runs where ($1 = 'all' or kind = $1) order by id desc limit $2`, [q.kind, q.limit])).rows as any[];
    res.json({ runs: rows.map(x => ({ ...x, replayed: x.status === "replayed" })) });
  });

  r.get("/scout/runs/:id", async (req, res) => {
    const id = parse(intId, req.params.id);
    const run = (await svc.db.query(`select id, kind, status, trigger, started_at as "startedAt", finished_at as "finishedAt", summary from runs where id=$1`, [id])).rows[0];
    if (!run) throw notFound("Run");
    const signals = (await svc.db.query(`${SIGNAL_SELECT} where s.run_id=$1 order by s.id`, [id])).rows.map(x => signalJson(x));
    res.json({ run: { ...run, replayed: run.status === "replayed" }, signals });
  });

  // ---------- Committee ----------
  r.post("/committee/run", admin, runLimit, async (req, res) => {
    const b = parse(z.object({ replay: z.boolean().optional() }), req.body || {});
    const out = await runCommittee(svc, { replay: b.replay, trigger: "manual" });
    await audit(svc.db, actorOf(req), "committee.run", `run:${out.runId}`, { status: out.status, counts: out.counts });
    if (out.status === "failed") return void res.status(502).json({ error: { code: "committee_failed", message: out.error || "Committee run failed", details: { runId: out.runId, summary: await runSummary(svc, out.runId) } } });
    res.json(out);
  });

  // ---------- Applied signals ("Why this number?") ----------
  r.get("/signals", async (req, res) => {
    const q = parse(z.object({ node: z.string().max(60).optional() }), req.query);
    const rows = (await svc.db.query(`${SIGNAL_SELECT} where s.status='applied' and ($1::text is null or s.node_id=$1) order by s.decided_at desc nulls last, s.id desc limit 200`, [q.node ?? null])).rows;
    res.json({ signals: rows.map(x => signalJson(x)) });
  });

  // ---------- Review queue ----------
  r.get("/review", admin, async (_req, res) => {
    const names = await nodeNames(svc);
    const sig = async (where: string, limit = 100) => (await svc.db.query(`${SIGNAL_SELECT} where ${where} order by coalesce(s.decided_at, s.created_at) desc, s.id desc limit ${limit}`)).rows.map(x => signalJson(x, names));
    const pending = await sig("s.status='pending'");
    const spotcheck = await sig("s.status='applied' and s.needs_spotcheck and s.spotcheck is null");
    const handledSignals = await sig("s.status <> 'pending'", 50);
    const cands = (await svc.db.query(`select * from emerging_candidates order by id`)).rows as any[];
    const emerging = cands.filter(c => c.status === "pending" || c.status === "provisional").map(c => candidateJson(c, names));
    const handledCands = cands.filter(c => !["pending", "provisional"].includes(c.status)).map(c => ({ type: "emerging", ...candidateJson(c, names) }));
    const handled = [...handledSignals.map(s => ({ type: "signal", ...s })), ...handledCands]
      .sort((a: any, b: any) => String(b.decidedAt || b.createdAt || "").localeCompare(String(a.decidedAt || a.createdAt || ""))).slice(0, 60);
    const count = async (where: string) => Number((await svc.db.query(`select count(*)::int as n from signals s where ${where}`)).rows[0].n);
    res.json({
      pending, emerging, handled, spotcheck,
      counts: {
        pending: pending.length, emerging: emerging.length, spotcheck: spotcheck.length,
        autoApplied: await count("s.status='applied' and s.decided_by like 'auto%'"),
        approved: await count("s.status='applied' and s.decided_by not like 'auto%'"),
        rejectedByRules: await count("s.triage='rejected'"), rejectedByPeople: await count("s.status='rejected' and s.triage <> 'rejected'"),
        reverted: await count("s.status='reverted'"),
      },
      rules: TRIAGE,
    });
  });

  // Approve a flagged signal: new KB version -> re-score everyone -> offer new routes.
  r.post("/review/signals/:id/approve", admin, async (req, res) => {
    const id = parse(intId, req.params.id);
    const { note } = parse(noteBody, req.body || {});
    const actor = actorOf(req);
    // Claim it atomically so a double click can't apply it twice.
    const claimed = (await svc.db.query(`update signals set status='approving' where id=$1 and status='pending' returning *`, [id])).rows[0] as any;
    if (!claimed) {
      const cur = await getSignal(svc, id);
      if (!cur) throw notFound("Signal");
      throw new HttpError(409, "invalid_state", `Signal is '${cur.status}'; only pending signals can be approved`);
    }
    let v: number, before: number;
    try {
      before = await latestVersion(svc.db);
      v = await createVersion(svc.db, `Approved signal #${id}: ${claimed.title}`.slice(0, 300), `admin:${actor}`,
        [{ kind: "delta", nodeId: claimed.node_id, deltaE: Number(claimed.delta_e), deltaD: Number(claimed.delta_d), signalId: id, sourceUrl: claimed.source_url }]);
    } catch (e) {
      await svc.db.query(`update signals set status='pending' where id=$1`, [id]);
      throw e;
    }
    await svc.db.query(`update signals set status='applied', decided_by=$2, decided_at=$3, kb_version=$4, decision_note=$5 where id=$1`, [id, actor, svc.now().toISOString(), v, note ?? null]);
    const source = claimed.source_title || (claimed.is_sample ? "sample source" : claimed.source_url);
    let rerouted: Reroute[] = [];
    try { rerouted = await applyRescore(svc, before, v, { reason: `${claimed.title} (${source})`.slice(0, 300), signalId: id }); }
    catch (e: any) { await audit(svc.db, "system", "rescore.failed", `kb:${v}`, { error: String(e?.message || e) }); }
    await svc.db.query(`update signals set users_rerouted=$2 where id=$1`, [id, new Set(rerouted.map(x => x.profileId)).size]);
    await audit(svc.db, actor, "signal.approve", `signal:${id}`, { kbVersion: v, note: note ?? null, rerouted: rerouted.length });
    res.json({ kbVersion: v, rerouted, signal: await getSignal(svc, id) });
  });

  r.post("/review/signals/:id/reject", admin, async (req, res) => {
    const id = parse(intId, req.params.id);
    const { note } = parse(noteBody, req.body || {});
    const actor = actorOf(req);
    const upd = await svc.db.query(`update signals set status='rejected', decided_by=$2, decided_at=$3, decision_note=$4 where id=$1 and status='pending' returning id`,
      [id, actor, svc.now().toISOString(), note ?? null]);
    if (!upd.rows.length) {
      const cur = await getSignal(svc, id);
      if (!cur) throw notFound("Signal");
      throw new HttpError(409, "invalid_state", `Signal is '${cur.status}'; only pending signals can be rejected`);
    }
    await audit(svc.db, actor, "signal.reject", `signal:${id}`, { note: note ?? null });
    res.json({ signal: await getSignal(svc, id) });
  });

  // Spot check of an automatically applied signal. "Wrong" undoes it.
  r.post("/review/spotcheck/:id", admin, async (req, res) => {
    const id = parse(intId, req.params.id);
    const b = parse(z.object({ ok: z.boolean(), note: z.string().max(500).optional() }), req.body || {});
    const actor = actorOf(req);
    const cur = (await svc.db.query(`select * from signals where id=$1`, [id])).rows[0] as any;
    if (!cur) throw notFound("Signal");
    if (cur.status !== "applied" || cur.spotcheck) throw new HttpError(409, "invalid_state", "Only applied signals that haven't been spot-checked can be checked");
    await svc.db.query(`update signals set spotcheck=$2, spotcheck_by=$3, spotcheck_at=$4, decision_note=coalesce($5, decision_note) where id=$1`,
      [id, b.ok ? "ok" : "wrong", actor, svc.now().toISOString(), b.note ?? null]);
    let kbVersion: number | null = null;
    if (!b.ok) {
      const ids = (await activeChanges(svc, "signal_id=$1", [id])).map(c => c.id);
      if (ids.length) kbVersion = (await revertChanges(svc, ids, `Spot check failed for signal #${id}: undone`, `admin:${actor}`, { signalId: id })).kbVersion;
      await svc.db.query(`update signals set status='reverted' where id=$1`, [id]);
    }
    await audit(svc.db, actor, "signal.spotcheck", `signal:${id}`, { ok: b.ok, note: b.note ?? null, kbVersion });
    res.json({ signal: await getSignal(svc, id), kbVersion });
  });

  // ---------- Emerging skills ----------
  r.post("/review/emerging/:id/confirm", admin, async (req, res) => {
    const id = parse(intId, req.params.id);
    const actor = actorOf(req);
    const c = (await svc.db.query(`select * from emerging_candidates where id=$1`, [id])).rows[0] as any;
    if (!c) throw notFound("Emerging-skill candidate");
    if (!["pending", "provisional"].includes(c.status)) throw new HttpError(409, "invalid_state", `Candidate is '${c.status}'`);
    const g = await loadGraph(svc.db);
    if (!c.skill_id || !g.nodes[c.skill_id]) throw new HttpError(409, "not_enough_evidence", "This candidate hasn't passed the evidence thresholds, so there is no provisional skill to confirm yet");
    const before = g.kbVersion;
    const v = await createVersion(svc.db, `Confirmed emerging skill: ${c.label}`, `admin:${actor}`, [{ kind: "emerging_status", nodeId: c.skill_id, payload: { status: "confirmed", candidateId: id } }]);
    await svc.db.query(`update emerging_candidates set status='confirmed', decided_by=$2, decided_at=$3, kb_version=$4 where id=$1`, [id, actor, svc.now().toISOString(), v]);
    try { await applyRescore(svc, before, v, { reason: `Confirmed emerging skill: ${c.label}` }); } catch { /* version stands */ }
    await audit(svc.db, actor, "emerging.confirm", `candidate:${id}`, { skillId: c.skill_id, kbVersion: v });
    const row = (await svc.db.query(`select * from emerging_candidates where id=$1`, [id])).rows[0];
    res.json({ kbVersion: v, candidate: candidateJson(row, await nodeNames(svc)) });
  });

  r.post("/review/emerging/:id/reject", admin, async (req, res) => {
    const id = parse(intId, req.params.id);
    const actor = actorOf(req);
    const c = (await svc.db.query(`select * from emerging_candidates where id=$1`, [id])).rows[0] as any;
    if (!c) throw notFound("Emerging-skill candidate");
    if (!["pending", "provisional", "merged"].includes(c.status)) throw new HttpError(409, "invalid_state", `Candidate is '${c.status}'`);
    // A provisional skill the committee added is taken out again (as a new version). Seeded skills stay as they were.
    const added = (await activeChanges(svc, "kind='add_skill'", [])).filter(ch => Number(ch.payload?.candidateId) === id).map(ch => ch.id);
    const kbVersion = added.length ? (await revertChanges(svc, added, `Rejected emerging skill: ${c.label}`, `admin:${actor}`)).kbVersion : null;
    await svc.db.query(`update emerging_candidates set status='rejected', decided_by=$2, decided_at=$3 where id=$1`, [id, actor, svc.now().toISOString()]);
    await audit(svc.db, actor, "emerging.reject", `candidate:${id}`, { kbVersion });
    const row = (await svc.db.query(`select * from emerging_candidates where id=$1`, [id])).rows[0];
    res.json({ candidate: candidateJson(row, await nodeNames(svc)), kbVersion });
  });

  // ---------- Undo a knowledge-base version ----------
  r.post("/kb/versions/:id/undo", admin, async (req, res) => {
    const id = parse(intId, req.params.id);
    const actor = actorOf(req);
    const ver = (await svc.db.query(`select id, note from kb_versions where id=$1`, [id])).rows[0] as any;
    if (!ver) throw notFound("Knowledge-base version");
    if (id === 1) throw new HttpError(400, "cannot_undo_seed", "The seed knowledge base can't be undone");
    const all = (await svc.db.query(`select id, kind from kb_changes where kb_version=$1`, [id])).rows as any[];
    if (all.length && all.every(c => c.kind === "revert")) throw new HttpError(400, "cannot_undo_undo", "This version is itself an undo. To redo the change, approve the signal again");
    const changes = await activeChanges(svc, "kb_version=$1", [id]);
    if (!changes.length) throw new HttpError(409, "already_undone", "This version has no changes still in force");
    const out = await revertChanges(svc, changes.map(c => c.id), `Undo version ${id}: ${ver.note}`, `admin:${actor}`);
    // Signals whose change was undone are marked 'reverted'; emerging candidates go back to their earlier state.
    const signalIds = changes.map(c => c.signal_id).filter(Boolean);
    if (signalIds.length) await svc.db.query(`update signals set status='reverted', decision_note=$2 where id = any($1::int[])`, [signalIds, `Undone in version ${out.kbVersion} by ${actor}`]);
    for (const ch of changes) {
      const cid = Number(ch.payload?.candidateId);
      if (!cid) continue;
      if (ch.kind === "add_skill") await svc.db.query(`update emerging_candidates set status='rejected', decided_by=$2, decided_at=$3 where id=$1`, [cid, actor, svc.now().toISOString()]);
      if (ch.kind === "emerging_status") await svc.db.query(`update emerging_candidates set status=case when is_sample then 'pending' else 'provisional' end, decided_by=null, decided_at=null where id=$1`, [cid]);
    }
    await audit(svc.db, actor, "kb.undo", `kb:${id}`, { newVersion: out.kbVersion, changes: changes.map(c => c.id), signals: signalIds });
    res.json({ kbVersion: out.kbVersion, undid: id, rerouted: out.rerouted });
  });

  return r;
}
