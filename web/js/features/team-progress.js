// HR view: "Team progress", from GET /api/hr/:employerId/progress (advisor role). Only team members who turned
// "Share my progress with my employer" on are listed; the others are only counted. Ticks are self-reported; verified =
// passed the HalaTuju skill check or confirmed by an advisor. Shown in the HR redeployment sheet (features/views.js).
import { S, nameOf } from "../state.js";
import { get } from "../api.js";
import { t, getLang } from "../i18n.js";
import { esc, badge, loadingBox, errorBox, bindRetry, icons } from "../util.js";
import { dayMonth } from "./track-text.js";

const STATUS = { on_track: ["b-good", "track.pace.onTrack"], ahead: ["b-good", "track.hr.ahead"], behind: ["b-warn", "track.hr.behind"] };

export function teamProgressHtml(r) {
  const members = r.members || [], yr = new Date().getUTCFullYear();
  const status = m => { const s = STATUS[m.status]; return s ? badge(s[0], t(s[1])) : `<span class="rs">${esc(t("track.hr.noGoal"))}</span>`; };
  const last = m => (m.lastCheckIn ? `${esc(t("common.hours", { h: m.lastCheckIn.hours }))}<div class="rs">${esc(t("track.weekOf", { date: dayMonth(m.lastCheckIn.weekStart, getLang(), yr) }))}</div>` : `<span class="rs">${esc(t("track.hr.none"))}</span>`);
  const rows = members.map(m => `<tr><td><b>${esc(m.name)}</b><div class="rs">${esc(t("hr.hoursWk", { h: m.hoursPerWeek ?? "–" }))}</div></td>
      <td>${m.goal ? esc(m.goal.title || nameOf(m.goal.job)) : "–"}${m.match != null ? `<div class="rs">${esc(t("track.matchNow", { n: Math.round(m.match) }))}</div>` : ""}</td>
      <td class="r tn">${m.goal ? esc(t("track.hr.steps", { done: m.stepsDone, total: m.stepsTotal })) : "–"}</td>
      <td class="r tn">${m.goal ? esc(m.verified) : "–"}</td>
      <td class="r tn">${last(m)}</td>
      <td>${status(m)}</td></tr>`).join("");
  const n = r.notSharing || 0;
  return `<h3>${esc(t("track.hr.title"))}</h3>
    ${members.length ? `<div class="tbl-wrap"><table class="tbl hr-tbl gl-hr"><thead><tr><th>${esc(t("hr.col.person"))}</th><th>${esc(t("track.hr.goal"))}</th><th class="r">${esc(t("track.hr.colSteps"))}</th><th class="r">${esc(t("conf.verified"))}</th><th class="r">${esc(t("track.hr.colLast"))}</th><th>${esc(t("track.hr.colStatus"))}</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<p class="note">${esc(t("track.hr.empty"))}</p>`}
    ${n ? `<p class="note">${esc(t(n === 1 ? "track.hr.notSharing1" : "track.hr.notSharing", { n }))}</p>` : ""}
    <p class="src">${esc(t("track.hr.note"))}${r.employer?.isSample ? " " + esc(t("track.hr.sample")) : ""}</p>`;
}

/** Fill box with the team's progress for this employer. */
export async function loadTeamProgress(box, employerId) {
  if (!box) return;
  box.innerHTML = loadingBox(t("track.hr.loading"));
  let r;
  try { r = await get(`/hr/${employerId}/progress`, { year: S.year, scenario: S.scenario }); }
  catch (e) {
    if (!box.isConnected) return;
    if (e.notAvailable) { box.remove(); return; } // a server without goal progress: no empty section
    box.innerHTML = errorBox(e, "teamprog"); bindRetry(box, { teamprog: () => loadTeamProgress(box, employerId) }); icons(); return;
  }
  if (!box.isConnected) return;
  box.innerHTML = teamProgressHtml(r);
  icons();
}
