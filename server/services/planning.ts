// Personal plan for one job: match, route, typed steps, cost, deadline, human edge and sources.
// All numbers come from shared/engine.js (fixed formulas) or from database records; nothing is estimated here.
import { createEngine, displayWeeks, clamp, PARAMS, normMode } from "../../shared/engine.js";
import { engineGraph, type FullGraph } from "../kb.ts";
import { engineProfile, type Profile } from "../repo.ts";
import { buildEscoPlan, escoJobId } from "./esco-plan.ts";

/** Route types: "closest" (Easiest start, default) and "safest"; "fastest"/"noregret" are old names (closest/safest). */
export type Mode = "closest" | "safest" | "fastest" | "noregret";
export type Engine = ReturnType<typeof createEngine>;
export interface ExtraReq { skill: string; weight: number; need: number; status?: string; source?: string }
export interface SignalInfo { id: number; title: string | null; sourceTitle: string | null; sourceDate: string | null; sourceUrl: string | null }
export interface PlanOptions {
  job: string; mode?: Mode; year?: number; scenario?: "moderate" | "fast";
  extraReq?: ExtraReq[];
  now: Date;
  /** Details of the signals behind applied knowledge changes (for the sources list). */
  signals?: Record<number, SignalInfo>;
  /** ESCO skills the person confirmed (profile_esco_skills); used for ESCO jobs. */
  escoSkills?: Set<string>;
}

const DAY_MS = 86_400_000;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const addWeeks = (now: Date, weeks: number) => new Date(now.getTime() + weeks * 7 * DAY_MS);

/** Deadline status thresholds: "ahead" if you need at most 75% of the weeks you have. */
export const AHEAD_SHARE = 0.75;

/** The engine for one profile + scenario on one knowledge-base snapshot. */
export function engineFor(graph: FullGraph, profile: Profile, year = 2026, scenario: "moderate" | "fast" = "moderate"): Engine {
  return createEngine(engineGraph(graph) as any, engineProfile(profile), { year, scenario });
}

/** The course we suggest for a skill: the first real (non-sample) course, else the first sample one. */
export function pickCourse(graph: FullGraph, skillId: string) {
  const list = graph.courses[skillId] || [];
  return list.find(c => c.source && c.source !== "sample") || list[0] || null;
}

/** Task split [AI does it, AI assists, still needs you] in %, interpolated exactly like the engine's exposure. */
export function taskSplit(graph: FullGraph, nodeId: string, year = 2026, scenario: "moderate" | "fast" = "moderate"): number[] | null {
  const s = graph.nodes[nodeId]?.split;
  if (!Array.isArray(s) || s.length < 3) return null;
  const f = clamp((year - PARAMS.baseYear) / (PARAMS.endYear - PARAMS.baseYear), 0, 1);
  return [0, 1, 2].map(i => Math.round(s[0][i] + ((scenario === "fast" ? s[2][i] : s[1][i]) - s[0][i]) * f));
}

/** Route with weeks at the user's pace (weeks) and at the 6 h/week reference (weeksRef). */
export function routeView(graph: FullGraph, route: any, hours: number) {
  if (!route) return null;
  return {
    key: route.key, nodes: route.nodes, risk: route.risk, mode: route.mode,
    weeks: displayWeeks(route.weeks, hours), weeksRef: route.weeks,
    legs: route.legs.map((l: any) => ({ from: l.from, to: l.to, toName: graph.nodes[l.to]?.name ?? l.to, kind: l.kind, why: l.why,
      weeks: displayWeeks(l.weeks, hours), weeksRef: l.weeks, rel: l.rel == null ? null : round2(l.rel), bridge: false })),
  };
}

export type StepType = "reuse" | "upskill" | "evolve" | "reskill";
export interface Step {
  type: StepType; skillId: string; name: string;
  /** 'route' = a stop on the core route; 'ready' = also needed to be fully job-ready. */
  part: "route" | "ready";
  weeks: number; weeksRef: number; why: string; from: string | null; levelFrom?: number; levelTo?: number;
  course: any | null;
  learn: { title: string; provider: string | null; url: string | null; hours: number | null; format: string | null } | null;
  practice: string | null; prove: string | null;
}

/**
 * Typed steps from the engine's plan:
 *  reuse   = a skill you have, used as-is on the route (0 weeks)
 *  upskill = a skill you have, but below the level the job needs
 *  evolve  = a new skill reached by an 'evolve' edge from one you have
 *  reskill = any other new skill
 * Each learning step carries Learn -> Practice -> Prove from its course.
 */
export function stepsFor(graph: FullGraph, E: Engine, plan: ReturnType<Engine["planFor"]>, hours: number): Step[] {
  const N = graph.nodes;
  const withCourse = (s: Omit<Step, "course" | "learn" | "practice" | "prove">): Step => {
    if (s.type === "reuse") return { ...s, course: null, learn: null, practice: null, prove: null };
    const c = pickCourse(graph, s.skillId);
    return {
      ...s, course: c,
      learn: c ? { title: c.title, provider: c.provider ?? null, url: c.url ?? null, hours: c.hours ?? null, format: c.formatText ?? c.format ?? null } : null,
      practice: c?.practice ?? null, prove: c?.prove ?? null,
    };
  };
  const steps: Step[] = [];
  for (const l of plan.route?.legs || []) {
    if (!E.isSkill(l.to)) continue; // the last leg arrives at the job
    const type: StepType = E.owned(l.to) ? "reuse" : l.kind === "evolve" ? "evolve" : "reskill";
    const w = type === "reuse" ? 0 : l.weeks;
    steps.push(withCourse({ type, skillId: l.to, name: N[l.to].name, part: "route", weeks: displayWeeks(w, hours), weeksRef: w,
      why: type === "reuse" ? `You already have this (level ${E.lvl(l.to)} of 5)` : l.why, from: E.isSkill(l.from) ? l.from : null }));
  }
  // Upskill: one step per skill (an employer requirement may repeat a catalogue skill; keep the highest level).
  const ups = new Map<string, { id: string; from: number; to: number; weeks: number }>();
  for (const u of plan.ups) if (!ups.has(u.id) || ups.get(u.id)!.to < u.to) ups.set(u.id, u);
  for (const u of ups.values())
    steps.push(withCourse({ type: "upskill", skillId: u.id, name: N[u.id].name, part: "ready", weeks: displayWeeks(u.weeks, hours), weeksRef: u.weeks,
      why: `The job needs level ${u.to}; you are at level ${u.from}`, from: u.id, levelFrom: u.from, levelTo: u.to }));
  for (const x of plan.extras)
    steps.push(withCourse({ type: x.kind as StepType, skillId: x.id, name: N[x.id].name, part: "ready", weeks: displayWeeks(x.weeks, hours), weeksRef: x.weeks,
      why: x.from ? `${x.kind === "evolve" ? "Evolves from" : "Builds on"} ${N[x.from]?.name ?? x.from}. ${x.why}`.trim() : "No direct bridge from your skills yet", from: x.from }));
  return steps;
}

/**
 * Costed route: one suggested course per skill to learn. Unknown prices (null) are counted, never guessed.
 * outOfPocket = total - HRD Corp-claimable share (courses flagged claimable by their provider record).
 */
export function costFor(graph: FullGraph, steps: Step[], budgetRm: number | null = null) {
  const items = steps.filter(s => s.type !== "reuse").map(s => ({
    skillId: s.skillId, title: s.course?.title ?? null, provider: s.course?.provider ?? null, url: s.course?.url ?? null,
    costRm: s.course && s.course.costRm != null ? Number(s.course.costRm) : null,
    hrdClaimable: !!s.course?.hrdClaimable, source: s.course?.source ?? null,
  }));
  const known = items.filter(i => i.costRm !== null);
  const round2 = (x: number) => Math.round(x * 100) / 100;
  const totalRm = round2(known.reduce((s, i) => s + i.costRm!, 0));
  const hrdClaimableRm = round2(known.filter(i => i.hrdClaimable).reduce((s, i) => s + i.costRm!, 0));
  const outOfPocketRm = round2(totalRm - hrdClaimableRm);
  return {
    totalRm, hrdClaimableRm, outOfPocketRm, unknownCount: items.length - known.length, items,
    budgetRm, withinBudget: budgetRm == null ? null : outOfPocketRm <= budgetRm,
  };
}

/**
 * Deadline tracking. weeksAvailable = whole weeks from now to the target date.
 * ahead: needed <= 0.75 x available; on_track: needed <= available; behind: otherwise; none: no target date.
 */
export function deadlineFor(targetDate: string | null, weeksNeeded: number | null, now: Date) {
  const readyBy = weeksNeeded == null ? null : isoDate(addWeeks(now, weeksNeeded));
  if (!targetDate) return { targetDate: null, weeksAvailable: null, weeksNeeded, status: "none" as const, readyBy };
  const weeksAvailable = Math.floor((Date.parse(targetDate + "T23:59:59Z") - now.getTime()) / (7 * DAY_MS));
  if (weeksNeeded == null) return { targetDate, weeksAvailable, weeksNeeded, status: "none" as const, readyBy, note: "No open route to this job" };
  const status = weeksNeeded <= AHEAD_SHARE * weeksAvailable ? "ahead" : weeksNeeded <= weeksAvailable ? "on_track" : "behind";
  return { targetDate, weeksAvailable, weeksNeeded, status: status as "ahead" | "on_track" | "behind", readyBy };
}

/** Human edge: the job's task split and the skills (yours or on this plan) the engine labels "Rising human skill". */
export function humanEdgeFor(graph: FullGraph, E: Engine, job: string, planSkills: string[], year: number, scenario: "moderate" | "fast") {
  const ids = [...new Set([...E.ownedSkills(), ...planSkills])].filter(k => E.isSkill(k));
  const risingSkills = ids.filter(k => E.impact(k).label === "Rising human skill").map(k => ({
    skillId: k, name: graph.nodes[k].name, owned: E.owned(k), why: E.impact(k).why,
    exposure: round2(E.exposure(k)), demand: round2(E.demand(k)),
  }));
  return { split: taskSplit(graph, job, year, scenario), currentSplit: taskSplit(graph, E.root, year, scenario), splitKey: ["ai", "assist", "human"], risingSkills };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Sources behind the numbers ("Why this number?"): node records, courses and approved signals that changed them. */
export function sourcesFor(graph: FullGraph, nodeIds: string[], costItems: { title: string | null; url: string | null; source: string | null }[], signals: Record<number, SignalInfo> = {}) {
  const out: { kind: string; label: string; url: string | null; date: string | null }[] = [];
  const add = (s: (typeof out)[number]) => { if (!out.some(o => o.kind === s.kind && o.label === s.label && o.url === s.url)) out.push(s); };
  const ids = [...new Set(nodeIds)].filter(id => graph.nodes[id]);
  let sample = false;
  for (const id of ids) {
    const n = graph.nodes[id];
    if (n.source === "esco" && n.sourceUri) add({ kind: "esco", label: `ESCO: ${n.name}`, url: n.sourceUri, date: null });
    if (n.onetCode) add({ kind: "onet", label: `O*NET ${n.onetCode}: ${n.name}`, url: `https://www.onetonline.org/link/summary/${n.onetCode}`, date: null });
    if (n.source === "sample" || n.outlookSource === "sample") sample = true;
    for (const r of graph.req[id] || []) if (r.source === "sample") sample = true;
  }
  if (sample) add({ kind: "sample", label: "Sample values (outlook, requirements, posting shares) from the prototype, labelled Sample", url: null, date: null });
  for (const c of costItems) if (c.title) add({ kind: c.source === "sample" || !c.source ? "sample" : "course", label: `Course: ${c.title}`, url: c.url, date: null });
  const idSet = new Set(ids);
  for (const ch of graph.appliedChanges) {
    if (!ch.nodeId || !idSet.has(ch.nodeId)) continue;
    const sig = ch.signalId != null ? signals[ch.signalId] : undefined;
    const parts = [ch.deltaE ? `exposure ${ch.deltaE > 0 ? "+" : ""}${ch.deltaE}` : "", ch.deltaD ? `demand ${ch.deltaD > 0 ? "+" : ""}${ch.deltaD}` : ""].filter(Boolean).join(", ");
    add({ kind: "signal", label: `${sig?.title || "Approved change"} (${graph.nodes[ch.nodeId].name}${parts ? `: ${parts}` : ""}; knowledge base v${ch.kbVersion})`,
      url: ch.sourceUrl || sig?.sourceUrl || null, date: sig?.sourceDate || null });
  }
  add({ kind: "formula", label: "Fixed formulas: docs/ARCHITECTURE.md §7 (match, routes, outlook, weeks at your pace)", url: null, date: null });
  return out;
}

/** The full gap list of a catalogue plan: every missing skill with its hours and the key skill it belongs to. */
export function missingView(graph: FullGraph, E: Engine, p: ReturnType<Engine["planFor"]>, hours: number) {
  const N = graph.nodes;
  return p.missing.map((m: any) => ({
    id: m.id, name: N[m.id]?.name ?? m.id, type: "skill", key: m.key, kind: m.kind,
    group: m.group, groupName: m.group ? N[m.group]?.name ?? m.group : null,
    estimated: m.estimated, hours: m.hours, weeks: displayWeeks(m.hours / PARAMS.referenceHours, hours), rel: m.rel,
    exposure: round2(E.exposure(m.id)), from: m.from, ...(m.kind === "upskill" ? { levelFrom: m.levelFrom, levelTo: m.levelTo } : {}),
  }));
}

/** The approved signal that raised a skill's AI exposure (for "why the safer route avoids it"), or null. */
export function signalFor(graph: FullGraph, nodeId: string, signals: Record<number, SignalInfo> = {}) {
  if (!((graph.deltas.e[nodeId] || 0) > 0)) return null;
  const ch = [...graph.appliedChanges].reverse().find(c => c.nodeId === nodeId && c.deltaE > 0);
  const sig = ch?.signalId != null ? signals[ch.signalId] : undefined;
  return { title: sig?.title ?? "Approved market change", sourceUrl: ch?.sourceUrl || sig?.sourceUrl || null, kbVersion: ch?.kbVersion ?? null };
}

/** The safest route as a concrete diff from the default one, or null when it is the same road. */
export function saferView(graph: FullGraph, E: Engine, job: string, extraReq: any[], hours: number, weeksDefault: number | null, signals?: Record<number, SignalInfo>) {
  const alt = E.saferAlternative(job, extraReq);
  if (!alt) return null;
  const N = graph.nodes, weeks = displayWeeks(alt.ready, hours);
  return {
    mode: "safest", route: routeView(graph, alt.route, hours), keySkills: alt.keySkills,
    avoids: alt.avoids.map((a: any) => ({ ...a, name: N[a.id]?.name ?? a.id, signal: a.reason === "signal" ? signalFor(graph, a.id, signals) : null })),
    adds: alt.adds.map((id: string) => ({ id, name: N[id]?.name ?? id })),
    weeks, addedWeeks: weeksDefault == null ? null : weeks - weeksDefault,
  };
}

/** GET /plan for any job: a catalogue job (buildPlan) or an ESCO occupation, "esco:<uuid>" (same plan shape, ESCO data). */
export function buildJobPlan(graph: FullGraph, profile: Profile, opts: PlanOptions) {
  if (graph.nodes[opts.job]?.type === "job") return buildPlan(graph, profile, opts);
  const occ = escoJobId(opts.job);
  if (!occ) throw Object.assign(new Error(`Unknown job: ${opts.job}`), { status: 404, code: "not_found" });
  const year = opts.year ?? 2026, scenario = opts.scenario ?? "moderate";
  const plan = buildEscoPlan(graph, engineFor(graph, profile, year, scenario), profile, occ,
    { mode: normMode(opts.mode), year, scenario, now: opts.now, escoSkills: opts.escoSkills || new Set(), signals: opts.signals });
  return { ...plan, deadline: deadlineFor(profile.targetDate, plan.weeks, opts.now) };
}

/** The full plan for a catalogue job (GET /plan and the employer match). */
export function buildPlan(graph: FullGraph, profile: Profile, opts: PlanOptions) {
  const mode = normMode(opts.mode), year = opts.year ?? 2026, scenario = opts.scenario ?? "moderate";
  const extraReq = (opts.extraReq || []) as any[];
  const E = engineFor(graph, profile, year, scenario);
  if (!E.isJob(opts.job)) throw Object.assign(new Error(`Unknown job: ${opts.job}`), { status: 404, code: "not_found" });
  const hours = profile.hours || PARAMS.referenceHours;
  const p = E.planFor(opts.job, mode, extraReq);
  const steps = stepsFor(graph, E, p, hours);
  const cost = costFor(graph, steps, profile.budgetRm);
  const weeksReady = p.route ? displayWeeks(p.ready, hours) : null;
  const N = graph.nodes;
  const breakdown = E.matchBreakdown(opts.job, extraReq).map((b: any, i: number) => ({
    ...b, name: N[b.skill]?.name ?? b.skill, from: i < (graph.req[opts.job] || []).length ? "catalogue" : "employer",
  }));
  const planSkills = steps.map(s => s.skillId);
  const missing = missingView(graph, E, p, hours);
  return {
    kbVersion: graph.kbVersion, job: opts.job, source: "catalogue", title: N[opts.job].name, mode, year, scenario, hours,
    match: E.match(opts.job, extraReq), breakdown,
    route: routeView(graph, p.route, hours),
    keySkills: p.keySkills, missing,
    weeks: weeksReady, weeksReady, weeksReadyRef: p.route ? p.ready : null,
    weeksEstimated: missing.some(m => m.estimated), totalHours: p.hours,
    saferAlternative: mode === "closest" && p.route ? saferView(graph, E, opts.job, extraReq, hours, weeksReady, opts.signals) : null,
    alternatives: E.alternatives(opts.job, mode).map((a: any) => routeView(graph, a, hours)),
    steps,
    cost,
    deadline: deadlineFor(profile.targetDate, weeksReady, opts.now),
    humanEdge: humanEdgeFor(graph, E, opts.job, planSkills, year, scenario),
    sources: sourcesFor(graph, [opts.job, ...(p.route?.nodes || []), ...(graph.req[opts.job] || []).map(r => r.skill), ...planSkills], cost.items, opts.signals),
  };
}
