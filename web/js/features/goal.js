// Your goal: the one job you commit to, the route type you chose, and which of its new skills you have finished.
// Kept in this browser per profile (the sample persona is read-only on the server). Ticks are self-reported;
// passing a step's skill check also records it as verified (the sample persona's profile can't store that).
import { S, kindOf, confOf } from "../state.js";
import { store } from "../util.js";

const key = () => "goal." + (S.profile?.id ?? "local");

/** { job, mode, done: string[], verified: string[], setAt } or null */
export const goal = () => { const g = store.get(key(), null); return g && typeof g.job === "string" ? { done: [], verified: [], ...g } : null; };
export const isGoal = j => !!j && goal()?.job === j;

export function setGoal(job, mode) { const same = goal()?.job === job; store.set(key(), { job, mode, done: same ? goal().done : [], verified: same ? goal().verified : [], setAt: new Date().toISOString().slice(0, 10) }); }
export function clearGoal() { store.set(key(), null); }
export function setGoalMode(mode) { const g = goal(); if (g) store.set(key(), { ...g, mode }); }
export function toggleDone(skill) {
  const g = goal(); if (!g) return;
  const s = new Set(g.done);
  if (s.has(skill)) s.delete(skill); else s.add(skill);
  store.set(key(), { ...g, done: [...s], verified: g.verified.filter(k => s.has(k)) });
}
/** Tick a step done; verified = the skill check was passed. */
export function markDone(skill, verified = false) {
  const g = goal(); if (!g) return;
  store.set(key(), { ...g, done: [...new Set([...g.done, skill])], verified: verified ? [...new Set([...g.verified, skill])] : g.verified });
}
export const isVerified = k => confOf(k) === "verified" || !!goal()?.verified.includes(k);

/** Every step to be job-ready (new skills on the route, then level-ups and extra skills), which are ticked,
 *  weeks left (the plan's job-ready weeks minus ticked steps), and what's next. */
export function progress(plan) {
  const g = goal();
  if (!g || !plan?.route) return null;
  const steps = [
    ...plan.route.legs.filter(l => kindOf(l.to) === "learn").map(l => ({ id: l.to, weeks: l.weeks })),
    ...plan.ups.map(u => ({ id: u.id, weeks: u.weeks })),
    ...plan.extras.map(x => ({ id: x.id, weeks: x.weeks })),
  ].map(s => ({ ...s, done: g.done.includes(s.id) }));
  const done = steps.filter(s => s.done).length;
  const doneWeeks = steps.filter(s => s.done).reduce((a, s) => a + s.weeks, 0);
  return { steps, done, total: steps.length, left: Math.max(0, plan.ready - doneWeeks), next: steps.find(s => !s.done) || null };
}
