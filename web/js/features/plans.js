// Saved learning plans: save, send to an advisor, and answer "a knowledge change offers a new route: keep or switch?".
import { S, UI, profileId, nameOf } from "../state.js";
import { get, post } from "../api.js";
import { t } from "../i18n.js";
import { badge, esc } from "../util.js";

export const planJob = p => p?.job ?? p?.occupationId ?? p?.occupation_id ?? null;
export const pendingOf = p => p?.pendingRoute ?? p?.pending_route ?? null;
export const noteOf = p => p?.advisorNote ?? p?.advisor_note ?? null;
export function routeNodes(r) {
  if (r && !Array.isArray(r) && typeof r === "object" && r.route) r = r.route; // pendingRoute = { route, kbVersion, reason, signalId }
  return Array.isArray(r) ? r : Array.isArray(r?.nodes) ? r.nodes : typeof r?.key === "string" ? r.key.split(">") : typeof r === "string" ? r.split(">") : [];
}

const STATUS = {
  draft: ["b-mute", "plan.status.draft", "file-pen"],
  sent: ["b-info", "plan.status.sent", "send"],
  approved: ["b-good", "plan.status.approved", "badge-check"],
  changes_requested: ["b-warn", "plan.status.changes", "message-square-warning"],
};
export function statusBadge(status) {
  const [cls, key, icon] = STATUS[status] || ["b-mute", status || "–", "circle"];
  return badge(cls, t(key), icon);
}

export const plansState = { loaded: false, err: null };

export async function loadPlans() {
  if (S.profileFallback) { UI.plans = []; plansState.loaded = true; return UI.plans; }
  try {
    const res = await get("/plans", { profile: profileId() });
    UI.plans = Array.isArray(res.plans) ? res.plans : [];
    plansState.err = null;
  } catch (e) { plansState.err = e; UI.plans = UI.plans || []; }
  plansState.loaded = true;
  return UI.plans;
}

export const plansForJob = j => (UI.plans || []).filter(p => planJob(p) === j).sort((a, b) => (b.id || 0) - (a.id || 0));
export const pendingPlans = () => (UI.plans || []).filter(p => pendingOf(p));

export async function savePlan() {
  const body = { profileId: profileId(), job: UI.job, mode: UI.mode };
  if (UI.employer) body.employerId = UI.employer.id;
  const res = await post("/plans", body);
  upsert(res.plan);
  return res.plan;
}

export async function sendPlan(plan, note) {
  const res = await post(`/plans/${plan.id}/send`, note ? { note } : {});
  upsert(res.plan);
  return res.plan;
}

export async function routeUpdate(plan, action) {
  const res = await post(`/plans/${plan.id}/route-update`, { action });
  upsert(res.plan);
  return res.plan;
}

function upsert(p) {
  if (!p || p.id === undefined) return;
  const i = (UI.plans || []).findIndex(x => x.id === p.id);
  if (i >= 0) UI.plans[i] = p; else UI.plans = [p, ...(UI.plans || [])];
}

/** One-line description of a route (for keep/switch prompts). */
export function routeText(r) {
  const nodes = routeNodes(r).slice(1, -1);
  return nodes.length ? nodes.map(nameOf).join(" → ") : "–";
}

export const planTitle = p => esc(nameOf(planJob(p)));
