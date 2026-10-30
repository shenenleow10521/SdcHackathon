// Your goal: the one job you commit to, the route type you chose, and which of its steps you have finished.
// Two stores behind one set of functions:
//  - your own profile: the server (docs/API.md "Goal progress": GET/PUT/DELETE /api/profile/:id/goal, ticks, proofs,
//    weekly check-ins), held in an in-memory cache so goal() stays synchronous (the map reads it for "you are here");
//  - the sample persona (read-only on the server), a local-only profile, or a server without these routes: this browser
//    (localStorage), as before. A check passed on the persona is recorded here too (its server profile can't store it).
import { S, confOf, nameOf, matchOf, W, actions } from "../state.js";
import { get, put, post, del } from "../api.js";
import { store, toast, badge } from "../util.js";
import { t } from "../i18n.js";
import { isoDay, mondayOf } from "./track-text.js";
import * as G from "../graph3d.js";

const key = () => "goal." + (S.profile?.id ?? "local");
const today = () => isoDay(Date.now());
/** Server cache for your own profile: the last GoalView (or { goal:null, ... }). off = the server has no goal routes. */
const C = { id: null, view: null, loading: null, err: null, off: false };

/** The last error loading your goal, and whether it is still loading (the My goal tab shows either). */
export const goalError = () => (C.id === S.profile?.id ? C.err : null);
export const goalLoading = () => C.id !== S.profile?.id || !!C.loading;
/** Is the goal kept on the server (your own profile), not in this browser? */
export const onServer = () => !!S.profile && !S.profile.isDemo && !S.profileFallback && !S.localOnly && !C.off;

const localGoal = () => {
  const g = store.get(key(), null);
  return g && typeof g.job === "string" ? { done: [], verified: [], proofs: {}, ...g } : null;
};
const fromView = v => {
  if (!v?.goal) return null;
  const st = Array.isArray(v.steps) ? v.steps : [];
  return { job: v.goal.job, mode: v.goal.mode, setAt: v.goal.setAt, done: st.filter(s => s.done).map(s => s.skillId), verified: st.filter(s => s.verified).map(s => s.skillId) };
};

/** { job, mode, done: string[], verified: string[], setAt } or null. Synchronous (the map calls it on every restyle). */
export function goal() {
  if (!onServer()) return localGoal();
  if (C.id !== S.profile.id) { loadGoal().then(() => changed()); return null; }
  return fromView(C.view);
}
export const isGoal = j => !!j && goal()?.job === j;

/** Load your goal from the server into the cache (app.js awaits it with the profile, before opening on your goal). */
export async function loadGoal({ force = false } = {}) {
  if (!S.profile || S.profile.isDemo || S.profileFallback || S.localOnly) return null;
  const id = S.profile.id;
  if (!force && C.id === id && (C.loading || C.view || C.off)) return C.loading || C.view;
  C.id = id; C.err = null;
  C.loading = (async () => {
    try {
      let v = await get(`/profile/${id}/goal`);
      // a goal set in this browser before goals were saved on the server: move it over once
      const old = store.get("goal." + id, null);
      if (!v.goal && old?.job && !v.readOnly) {
        try { v = await put(`/profile/${id}/goal`, { job: old.job, mode: old.mode || "closest" }); } catch (e) { console.warn("Moving the goal to the server failed", e); }
      }
      if (old) store.set("goal." + id, null);
      if (S.profile?.id === id) { C.view = v; C.off = false; }
    } catch (e) {
      if (S.profile?.id === id) { C.err = e; C.view = null; C.off = !!e.notAvailable; }
    } finally { C.loading = null; }
    return C.view;
  })();
  return C.loading;
}

/** Move the map's "you are here" marker (graph3d.js, if it has the export yet). */
export function refreshMap() {
  try { if (typeof G.refreshProgress === "function") G.refreshProgress(); } catch (e) { console.warn(e); }
}
function changed(animate = false) { actions.refresh?.({ animate }); refreshMap(); }
const failed = e => toast({ title: t("state.failed"), detail: e?.notAvailable ? t("state.notAvailable") : e?.message, badgeHtml: badge("b-crit", t("state.error")) });

// ---------- setting the goal ----------
export async function setGoal(job, mode) {
  if (!onServer()) {
    const g = localGoal(), same = g?.job === job;
    store.set(key(), { job, mode, done: same ? g.done : [], verified: same ? g.verified : [], proofs: g?.proofs || {}, setAt: same ? g.setAt : today() });
    return;
  }
  const v = C.view, same = v?.goal?.job === job;
  // show it at once; the server's answer replaces it
  C.view = { ...(v || {}), goal: { job, title: nameOf(job), mode, setAt: same ? v.goal.setAt : today() }, steps: same ? v.steps : [], progress: same ? v.progress : null, pace: same ? v.pace : null };
  try { C.view = await put(`/profile/${S.profile.id}/goal`, { job, mode }); }
  catch (e) { failed(e); await loadGoal({ force: true }); }
  changed();
}
export async function clearGoal() {
  if (!onServer()) { store.set(key(), null); return; }
  C.view = { ...(C.view || {}), goal: null, steps: [], progress: null, pace: null };
  try { await del(`/profile/${S.profile.id}/goal`); } catch (e) { failed(e); }
  await loadGoal({ force: true }); changed();
}
export async function setGoalMode(mode) {
  const g = goal(); if (!g) return;
  if (!onServer()) { store.set(key(), { ...localGoal(), mode }); return; }
  await setGoal(g.job, mode);
}

// ---------- steps ----------
/**
 * Tick a step done, or untick it. Your own profile: the server raises (or restores) the skill, so the plan and the map
 * recompute; returns the server's change { before:{match,weeks}, after:{match,weeks} }. The persona: ticked here only.
 */
export async function toggleDone(skill) {
  if (!onServer()) {
    const g = localGoal(); if (!g) return null;
    const s = new Set(g.done), done = !s.has(skill);
    if (done) s.add(skill); else s.delete(skill);
    store.set(key(), { ...g, done: [...s], verified: g.verified.filter(k => s.has(k)), doneAt: { ...(g.doneAt || {}), [skill]: done ? new Date().toISOString() : undefined } });
    changed(true);
    return { skillId: skill, done, local: true };
  }
  const id = S.profile.id, step = (C.view?.steps || []).find(x => x.skillId === skill);
  try {
    const res = await post(`/profile/${id}/goal/steps/${encodeURIComponent(skill)}`, { done: !step?.done });
    const { change, ...view } = res;
    C.view = view;
    // the tick changed your skills: reload the profile so every match, plan and the map follow
    if (change?.levelChanged !== false) {
      try { const p = await get(`/profile/${id}`); if (S.profile?.id === id) { await actions.profileUpdated?.(p); refreshMap(); return change; } }
      catch (e) { console.warn("Reloading the profile failed", e); }
    }
    changed(true);
    return change;
  } catch (e) { failed(e); return null; }
}
/** The persona's check was passed: tick the step and record who vouches, in this browser. */
export function markDone(skill, verified = false) {
  const g = localGoal(); if (!g) return;
  const proofs = { ...g.proofs };
  if (verified) proofs[skill] = [...(proofs[skill] || []).filter(p => p.kind !== "check"), { id: "c" + Date.now(), kind: "check", by: "HalaTuju skill check", at: new Date().toISOString(), url: null, title: null }];
  store.set(key(), { ...g, done: [...new Set([...g.done, skill])], verified: verified ? [...new Set([...g.verified, skill])] : g.verified, proofs, doneAt: { ...(g.doneAt || {}), [skill]: (g.doneAt || {})[skill] || new Date().toISOString() } });
}
/** After a passed skill check: the server already recorded the proof and the tick on your profile; the persona's goes here. */
export async function checkPassed(skill) {
  if (onServer()) { await loadGoal({ force: true }); changed(true); return; }
  markDone(skill, true); changed(true);
}
export const isVerified = k => confOf(k) === "verified" || !!goal()?.verified.includes(k);

// ---------- proofs ----------
/** Add a credential link (never counts as verified). Your profile: on the server; the persona: in this browser. */
export async function addCredential(skill, { url, title }) {
  if (!onServer()) {
    const g = localGoal(); if (!g) return false;
    let by = url; try { by = new URL(url).hostname.replace(/^www\./, ""); } catch { /* checked by the form */ }
    const list = [...(g.proofs[skill] || []), { id: "l" + Date.now(), kind: "credential", by, at: new Date().toISOString(), url, title }];
    store.set(key(), { ...g, proofs: { ...g.proofs, [skill]: list } });
    changed(); return true;
  }
  try { C.view = await post(`/profile/${S.profile.id}/goal/steps/${encodeURIComponent(skill)}/proof`, { kind: "credential", url, title }); changed(); return true; }
  catch (e) { failed(e); return false; }
}
export async function removeCredential(skill, proofId) {
  if (!onServer()) {
    const g = localGoal(); if (!g) return;
    store.set(key(), { ...g, proofs: { ...g.proofs, [skill]: (g.proofs[skill] || []).filter(p => String(p.id) !== String(proofId)) } });
    changed(); return;
  }
  try { C.view = await del(`/profile/${S.profile.id}/goal/steps/${encodeURIComponent(skill)}/proof/${encodeURIComponent(proofId)}`); changed(); }
  catch (e) { failed(e); }
}

// ---------- weekly check-ins ----------
/** Hours studied this week, saved on the server (one per week; a second one replaces it). */
export async function logHours(hours) {
  if (!onServer()) return null;
  try {
    const r = await post(`/profile/${S.profile.id}/checkins`, { weekStart: today(), hours });
    C.view = { ...C.view, checkIns: r.checkIns, pace: r.pace };
    changed(); return r;
  } catch (e) { failed(e); return null; }
}
/** This week's check-in, if any. */
export const thisWeek = () => (C.view?.checkIns || []).find(c => c.weekStart === mondayOf(today())) || null;

// ---------- one view for the My goal tab, the drawer and the record ----------
/**
 * { local, goal:{job,title,mode,setAt}, hoursPerWeek, steps:[...], progress:{done,total,verified}, checkIns, pace, error }
 * Your own profile: the server's GoalView. The persona: the same shape from the browser engine's plan and the ticks here
 * (no pace: hours are tracked for your own profile only). null without a goal.
 */
export function goalView() {
  const g = goal();
  if (!g) return null;
  if (onServer()) return C.view?.goal ? { ...C.view, local: false } : null;
  let p = null; try { p = S.E.planFor(g.job, g.mode || "closest"); } catch { p = null; }
  const done = new Set(g.done), ver = new Set(g.verified);
  const steps = (p?.route ? p.missing || [] : []).map(m => ({
    skillId: m.id, name: nameOf(m.id), key: !!m.key, kind: m.kind || null, type: "skill", hours: m.hours, levelFrom: m.levelFrom, levelTo: m.levelTo,
    done: done.has(m.id), doneAt: done.has(m.id) ? (g.doneAt || {})[m.id] || null : null,
    verified: ver.has(m.id) || confOf(m.id) === "verified", proofs: g.proofs[m.id] || [], practise: [],
  }));
  return {
    local: true, noRoute: !p?.route, goal: { job: g.job, title: nameOf(g.job), mode: g.mode, setAt: g.setAt },
    match: S.E?.isJob?.(g.job) ? matchOf(g.job) : null, hoursPerWeek: S.profile?.hours || 6, steps,
    progress: { done: steps.filter(s => s.done).length, total: steps.length, verified: steps.filter(s => s.verified).length },
    checkIns: [], pace: null,
  };
}
/** A goal step for this skill (the drawer's Prove block), or null. */
export const goalStep = k => goalView()?.steps.find(s => s.skillId === k || "xs:" + s.skillId === k) || null;
/** The O*NET task statements to practise this skill at work, from the cached goal: [{ text, occupation }] ([] when none). */
export function practiseFor(skillId) {
  const k = String(skillId).replace(/^xs:/, "");
  const st = goalView()?.steps.find(s => s.skillId === k);
  return (st?.practise || []).map(p => ({ text: p.text, occupation: p.occupation || "" }));
}
/** Weeks left at your hours: the hours of the steps not done yet. */
export const weeksLeftOf = steps => { const h = steps.filter(s => !s.done).reduce((a, s) => a + (s.hours || 0), 0); return h ? W(h / 6) : 0; };

/** Old shape kept for the Plan tab: every step, which are ticked, weeks left, what's next. */
export function progress(plan) {
  const g = goal();
  if (!g || !plan?.route) return null;
  const steps = (plan.missing || []).map(m => ({ id: m.id, weeks: m.hours / 6, done: g.done.includes(m.id) }));
  const done = steps.filter(s => s.done).length;
  const left = steps.filter(s => !s.done).reduce((a, s) => a + s.weeks, 0);
  return { steps, done, total: steps.length, left, next: steps.find(s => !s.done) || null };
}

// ---------- sharing with your employer ----------
export async function setShare(on) {
  if (!onServer()) return false;
  try { const r = await put(`/profile/${S.profile.id}`, { shareProgress: !!on }); S.profile = { ...S.profile, shareProgress: !!r.profile?.shareProgress }; return true; }
  catch (e) { failed(e); return false; }
}

// ---------- "Stay AI-ready in your job" ----------
// An always-on track next to your goal (no choosing needed), with its own ticks. Your own profile: on the server
// (GET/POST /api/profile/:id/stay; a tick raises the skill like a goal step, so My skills follows). The sample persona or a
// local-only profile: this browser, as before.
const stayKey = () => "stay." + (S.profile?.id ?? "local");
const localStay = () => { const s = store.get(stayKey(), null); return Array.isArray(s) ? s : []; };
/** Server cache of the stay ticks: [{ skillId, name, doneAt, hours }]. */
const SC = { id: null, done: [], loading: null };

async function loadStay() {
  const id = S.profile.id;
  SC.id = id; SC.done = [];
  SC.loading = (async () => {
    try {
      let r = await get(`/profile/${id}/stay`);
      // ticks made in this browser before they were saved on the server: move them over once
      const old = store.get("stay." + id, null);
      if (Array.isArray(old) && old.length && !r.readOnly) {
        for (const k of old) if (!r.done.some(d => d.skillId === k)) { try { r = await post(`/profile/${id}/stay/${encodeURIComponent(k)}`, { done: true }); } catch (e) { console.warn("Moving a stay tick to the server failed", e); } }
      }
      if (old) store.set("stay." + id, null);
      if (S.profile?.id === id) SC.done = Array.isArray(r.done) ? r.done : [];
    } catch (e) { console.warn("Loading the stay track failed", e); }
    finally { SC.loading = null; }
  })();
  return SC.loading;
}
/** Ids of the ticked stay skills. Synchronous: your own profile's load on first use, then the views redraw. */
export function stayDone() {
  if (!onServer()) return localStay();
  if (SC.id !== S.profile.id) { loadStay().then(() => changed()); return []; }
  return SC.done.map(d => d.skillId);
}
/** Your own profile's ticked stay skills with name and hours (a ticked skill can leave the track: stay.js keeps it). */
export const stayDoneItems = () => (onServer() && SC.id === S.profile.id ? SC.done : []);
/** Tick or untick a stay skill. Your own profile: the server raises (or restores) the skill, then the profile reloads. */
export async function toggleStay(id) {
  if (!onServer()) { const s = new Set(localStay()); if (s.has(id)) s.delete(id); else s.add(id); store.set(stayKey(), [...s]); return { skillId: id, done: s.has(id), local: true }; }
  const pid = S.profile.id;
  try {
    const { change, ...r } = await post(`/profile/${pid}/stay/${encodeURIComponent(id)}`, { done: !stayDone().includes(id) });
    if (S.profile?.id === pid) SC.done = r.done || [];
    if (change?.levelChanged) {
      try { const p = await get(`/profile/${pid}`); if (S.profile?.id === pid) { await actions.profileUpdated?.(p); refreshMap(); return change; } }
      catch (e) { console.warn("Reloading the profile failed", e); }
    }
    changed(true);
    return change;
  } catch (e) { failed(e); return null; }
}
