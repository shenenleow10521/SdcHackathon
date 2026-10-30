// "Stay AI-ready in your job": the skills that keep you competitive in the job you have. One shape, two sources:
//  - catalogue mode (the sample persona, or anyone whose catalogue skills fit a hand-made "stay & adapt" job): that job's
//    missing skills, with real courses where the catalogue has them;
//  - otherwise the server's outlook (GET /api/esco/profile/:id/outlook, server/services/outlook.ts): the AI-era skills
//    that fit your job (each with published sources) and what replaces your skills that are at risk.
import { S, N, nameOf, W, currentJobTitle, CAT_KEEP } from "../state.js";
import { t } from "../i18n.js";
import { stayDone, stayDoneItems } from "./goal.js";

const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The hand-made "stay & adapt" job that fits you, if there is one (Priya: AI-Assisted AP Specialist). */
export function stayJob() {
  const E = S.E;
  return E ? E.allJobs().find(j => N(j)?.stay && E.match(j) >= CAT_KEEP) || null : null;
}

/** { mode, job, items: [{ id, name, hours, why, sources, done }], hours, weeks, done } or null when we don't know your job. */
export function stayTrack() {
  const E = S.E, done = new Set(stayDone());
  const sj = stayJob();
  let items = [], job = currentJobTitle(), mode = "catalogue";
  if (sj) {
    let p = null; try { p = E.planFor(sj, "closest"); } catch { p = null; }
    if (!p?.route) return null;
    items = (p.missing || []).map(m => ({
      id: m.id, name: m.kind === "upskill" ? t("path.upTitle", { name: nameOf(m.id), from: m.levelFrom, to: m.levelTo }) : nameOf(m.id), hours: m.hours,
      why: m.kind === "upskill" ? t("stay.why.up") : N(m.id)?.emerging || N(m.id)?.aiEra ? t("stay.why.grows") : t("stay.why.job"), sources: [],
    }));
  } else {
    const o = S.outlook;
    if (!o?.job) return null;
    mode = "esco"; job = job || cap(o.job.title);
    items = (o.stay?.items || []).map(x => ({
      id: x.id, name: x.name, hours: x.hours, sources: x.sources || [], course: x.course || null,
      why: x.replaces ? t("stay.why.replaces", { name: x.replaces, n: Math.round(100 * x.replacesExposure) }) : t(x.why === "general" ? "stay.why.general" : "stay.why.jobAi"),
    }));
  }
  items.forEach(x => { x.done = done.has(x.id); });
  // a ticked skill has been raised, so it can leave the track: keep it, ticked (your own profile, from the server)
  for (const d of stayDoneItems()) if (!items.some(x => x.id === d.skillId)) items.push({ id: d.skillId, name: N(d.skillId) ? nameOf(d.skillId) : d.name, hours: d.hours, sources: [], why: "", done: true });
  const left = items.filter(x => !x.done).reduce((s, x) => s + (x.hours || 0), 0);
  const all = items.reduce((s, x) => s + (x.hours || 0), 0);
  return { mode, job, stayJob: sj, items, hours: all, weeks: all ? W(all / 6) : 0, weeksLeft: left ? W(left / 6) : 0, done: items.filter(x => x.done).length };
}
