// Full-width sheets for the people around the worker: the advisor's approval queue, the HR redeployment view
// and the employer requirements form. Each loads on open and shows loading / empty / error states.
import { S, actions, nameOf, profileId } from "../state.js";
import { get, post, put } from "../api.js";
import { t } from "../i18n.js";
import { $, esc, icons, badge, errorBox, loadingBox, fmtDate, rm, toast, bindRetry, ago, extLink } from "../util.js";
import { routeNodes, statusBadge } from "./plans.js";
import { forgetEmployers } from "../drawer.js";
import { loadTeamProgress } from "./team-progress.js";

let current = null, lastFocus = null;

export function openSheet(kind, arg) {
  lastFocus = document.activeElement;
  current = kind;
  $("sheet").hidden = false;
  $("sheet-title").textContent = t("sheet." + kind);
  $("sheet-kicker").textContent = t("sheet." + kind + ".kicker");
  const body = $("sheet-body");
  body.innerHTML = loadingBox();
  icons();
  setTimeout(() => $("sheet-close").focus(), 20);
  ({ advisor: loadAdvisor, hr: loadHr, employer: renderEmployerForm, esco: () => loadEscoJob(arg), escoBest: loadEscoBest })[kind]?.();
}
export function closeSheet() {
  $("sheet").hidden = true; current = null;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}
export function initSheets() {
  $("sheet-close").addEventListener("click", closeSheet);
  $("sheet").addEventListener("click", e => { if (e.target === $("sheet")) closeSheet(); });
  $("sheet").addEventListener("keydown", e => { if (e.key === "Escape") { e.preventDefault(); closeSheet(); } });
}
const body = () => $("sheet-body");
// ESCO titles are lowercase ("tax clerk"); capitalise for display only.
const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
// One ESCO job as a list row: title left, essential skills you have right, AI exposure as a quiet second line.
const jobRow = (j, have, ilo) => `<li><span class="esco-row-main"><button class="link-btn" type="button" data-esco-go="${esc(j.id)}">${esc(cap(j.title))}</button>
    <small class="rs">${esc(ilo !== null ? t("esco.ai", { n: Math.round(ilo * 100) }) : t("esco.aiNone"))}${j.critical ? ". " + esc(t("esco.criticalShort")) : ""}</small></span>
    <span class="esco-row-end tn">${esc(t("esco.skillsOf", { have, n: j.essential }))}</span></li>`;
const still = kind => current === kind;
// When a sheet needs admin access, say what it is for instead of a dead-end token hint.
const failBox = (e, kind, retry) => (e?.needsAuth ? `<div class="empty">${esc(t("sheet." + kind + ".locked"))}</div>` : errorBox(e, retry));
// Test and smoke-test employers stay in the database but never show in pickers.
export const isTestEmployer = e => /\(test\)\s*$/i.test(e?.name || "") || /smoke test/i.test(e?.name || "");

// ---------- check any ESCO job ----------
async function loadEscoJob(id) {
  let o;
  try { o = await get(`/esco/occupations/${id}`, { profile: profileId() }); }
  catch (e) { if (!still("esco")) return; body().innerHTML = errorBox(e, "esco"); bindRetry(body(), { esco: () => loadEscoJob(id) }); icons(); return; }
  if (!still("esco")) return;
  $("sheet-title").textContent = cap(o.title);
  const basis = { have: ["is-have", "esco.have"], related: ["is-rel", "esco.related"], missing: ["is-miss", "esco.missing"] };
  const row = s => {
    const sub = [s.via ? t("esco.via", { name: nameOf(s.via) }) : "", s.type === "knowledge" ? t("esco.knowledge") : ""].filter(Boolean);
    return `<li><span class="esco-row-main"><span>${esc(cap(s.title))}</span>${sub.length ? `<small class="rs">${esc(sub.join(". "))}</small>` : ""}</span>
    <span class="esco-row-end"><span class="esco-state ${basis[s.basis][0]}">${esc(t(basis[s.basis][1]))}</span>${s.confirmed ? `<button class="ghost sm" type="button" data-have="${esc(s.id)}" data-on="1">${esc(t("esco.undo"))}</button>` : s.basis !== "have" ? `<button class="ghost sm" type="button" data-have="${esc(s.id)}">${esc(t("esco.iHave"))}</button>` : ""}</span></li>`;
  };
  const ilo = o.exposure.ilo, pct = v => Math.round(v * 100) + "%";
  const desc = o.description || "";
  const studies = [o.exposure.gptsBeta, o.exposure.aei].filter(v => v !== null).map(v => Math.round(v * 100));
  const studiesV = studies.length ? (Math.min(...studies) === Math.max(...studies) ? studies[0] + "%" : t("esco.range", { a: Math.min(...studies), b: Math.max(...studies) })) : null;
  const signed = v => (v > 0 ? "+" : "") + v + "%";
  const my = o.malaysia;
  const more = o.exposure.model !== null || (o.onet && studiesV) || my;
  body().innerHTML = `<div class="esco-sum">
      <p><span class="esco-big tn">${esc(t("esco.haveOf", { have: o.counts.have, n: o.counts.essential }))}</span>${o.counts.related ? `<small class="rs">${esc(t(o.counts.related === 1 ? "esco.relatedOne" : "esco.relatedMany", { n: o.counts.related }))}</small>` : ""}</p>
      <p><span class="esco-big tn">${esc(ilo ? t("esco.aiIlo", { n: Math.round(ilo.mean * 100) }) : t("esco.aiNone"))}</span><small class="rs">${esc(t("esco.aiIloSub"))}</small></p>
    </div>
    ${desc ? `<p class="esco-desc">${esc(desc.length >= 400 ? desc.replace(/\s+\S*$/, "") + "…" : desc)}</p>` : ""}
    ${o.critical ? `<p class="note"><b>${esc(t("esco.critical"))}.</b> ${esc(t("esco.criticalNote", { title: o.critical.title }))}${o.critical.new ? " " + esc(t("esco.criticalNew")) : ""}${o.critical.everyEdition ? " " + esc(t("esco.criticalEvery")) : ""} ${extLink(o.critical.url, t("esco.criticalLink"))}</p>` : ""}
    ${escoTasks(o.onet)}
    <div id="esco-next"></div>
    <div class="sub-h">${esc(t("esco.essential", { n: o.essential.length }))}</div>
    <ul class="alt-list esco-rows">${o.essential.map(row).join("")}</ul>
    ${o.optional.length ? `<details><summary class="sub-h">${esc(t("esco.optional", { n: o.optional.length }))}</summary><ul class="alt-list esco-rows">${o.optional.map(row).join("")}</ul></details>` : ""}
    ${more ? `<details class="esco-more"><summary class="sub-h">${esc(t("esco.moreHead"))}</summary>
      <dl class="sheet-kv tn">
        ${o.exposure.model !== null ? `<dt>${esc(t("esco.modelExposure"))}</dt><dd>${pct(o.exposure.model)}</dd>` : ""}
        ${o.onet && studiesV ? `<dt>${esc(t("esco.otherStudies"))}</dt><dd>${esc(studiesV)}</dd>` : ""}
      </dl>
      ${ilo ? `<p class="src">${esc(t("esco.iloNote", { group: ilo.group, gradient: ilo.gradient }))}</p>` : `<p class="src">${esc(t("esco.noIlo"))}</p>`}
      ${o.onet && studiesV ? `<p class="src">${esc(t("esco.studies", { gpts: o.exposure.gptsBeta !== null ? pct(o.exposure.gptsBeta) : "–", aei: o.exposure.aei !== null ? pct(o.exposure.aei) : "–", onet: o.onet.title }))}</p>` : ""}
      ${my ? `<p class="note esco-my-h">${esc(t("esco.my.head", { group: t("esco.my.g." + my.group) }))}</p>
      <dl class="sheet-kv tn">
        <dt>${esc(t("esco.my.median", { year: my.year }))}</dt><dd>${esc(rm(my.medianWageRm))}</dd>
        <dt>${esc(t("esco.my.wageChange", { since: my.since }))}</dt><dd>${signed(my.medianWageChangePct)}</dd>
        <dt>${esc(t("esco.my.earners", { year: my.year }))}</dt><dd>${esc(my.wageEarnersK >= 1000 ? t("esco.my.earnersM", { n: (my.wageEarnersK / 1000).toFixed(1) }) : t("esco.my.earnersV", { n: Math.round(my.wageEarnersK) }))}</dd>
        <dt>${esc(t("esco.my.earnersChange", { since: my.since }))}</dt><dd>${signed(my.wageEarnersChangePct)}</dd>
      </dl>
      <p class="src">${esc(t("esco.my.note"))} ${extLink(my.url, "OpenDOSM")}</p>` : ""}
    </details>` : ""}
    <p class="src">${esc(t("esco.method"))}</p>
    <p class="src">${esc(t("esco.code", { code: o.code, isco: o.isco || "–" }))} ${extLink(o.uri, t("esco.open"))}</p>`;
  body().querySelectorAll("[data-have]").forEach(b => b.addEventListener("click", async () => {
    b.disabled = true;
    const sid = b.dataset.have, change = b.dataset.on ? { remove: [sid] } : { add: [sid] };
    try { await put(`/esco/profile/${profileId()}/skills`, change); await loadEscoJob(id); }
    catch (e) { b.disabled = false; toast({ title: t("state.failed"), detail: e.message, badgeHtml: badge("b-crit", t("state.error")) }); }
  }));
  icons();
  loadEscoNext(id);
}

// Closest jobs to this one across all 3,039 ESCO jobs (shared skills), each one click away.
async function loadEscoNext(id) {
  const box = $("esco-next");
  if (!box) return;
  let r;
  try { r = await get(`/esco/occupations/${id}/next`, { limit: 6 }); } catch { box.innerHTML = ""; return; }
  if (!still("esco") || !$("esco-next")) return;
  if (!r.jobs?.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<div class="sub-h">${esc(t("esco.next"))}</div>
    <p class="src">${esc(t("esco.nextLead"))}</p>
    <ul class="alt-list esco-rows">${r.jobs.map(j => jobRow(j, j.keep, j.exposure.ilo)).join("")}</ul>
    <p class="src">${esc(t("esco.nextMethod"))}</p>`;
  box.querySelectorAll("[data-esco-go]").forEach(b => b.addEventListener("click", () => { body().innerHTML = loadingBox(); icons(); loadEscoJob(b.dataset.escoGo); }));
  icons();
}

// Your best matches across ALL ESCO jobs.
async function loadEscoBest() {
  let r;
  try { r = await get(`/esco/profile/${profileId()}/best-jobs`, { limit: 12 }); }
  catch (e) { if (!still("escoBest")) return; body().innerHTML = errorBox(e, "escoBest"); bindRetry(body(), { escoBest: loadEscoBest }); icons(); return; }
  if (!still("escoBest")) return;
  body().innerHTML = r.jobs.length ? `<p class="note">${esc(t("esco.bestLead"))}</p>
    <ul class="alt-list esco-rows">${r.jobs.map(j => jobRow(j, j.have, j.iloExposure)).join("")}</ul>
    <p class="src">${esc(t("esco.bestMethod"))}</p>` : `<div class="empty">${esc(t("esco.bestEmpty"))}</div>`;
  body().querySelectorAll("[data-esco-go]").forEach(b => b.addEventListener("click", () => openSheet("esco", b.dataset.escoGo)));
  icons();
}

function escoTasks(on) {
  if (!on?.split) return "";
  const { ai, tools, human } = on.split;
  const li = x => `<li${x.rating === "ai" ? ' class="t-ai"' : ""}><span>${esc(x.text)}</span><span class="esco-row-end t-rate">${x.rating === "ai" ? '<i class="t-sw" aria-hidden="true"></i>' : ""}${esc(t("esco.task." + x.rating))}</span></li>`;
  return `<div class="sub-h">${esc(t("esco.tasks", { n: on.tasks.length }))}</div>
    <div class="split"><div class="split-bar" role="img" aria-label="${esc(t("split.aria", { a: ai, b: tools, c: human }))}"><i style="flex-basis:${ai}%;background:var(--split-ai)"></i><i style="flex-basis:${tools}%;background:var(--split-assist)"></i><i style="flex-basis:${human}%;background:var(--split-you)"></i></div>
    <div class="split-key"><span><i style="background:var(--split-ai)"></i>${esc(t("esco.task.ai"))} <b class="tn">${ai}%</b></span><span><i style="background:var(--split-assist)"></i>${esc(t("esco.task.tools"))} <b class="tn">${tools}%</b></span><span><i style="background:var(--split-you)"></i>${esc(t("esco.task.human"))} <b class="tn">${human}%</b></span></div></div>
    <ul class="alt-list esco-rows">${on.tasks.slice(0, 8).map(li).join("")}</ul>
    ${on.tasks.length > 8 ? `<details><summary class="sub-h">${esc(t("esco.moreTasks", { n: on.tasks.length - 8 }))}</summary><ul class="alt-list esco-rows">${on.tasks.slice(8).map(li).join("")}</ul></details>` : ""}
    <p class="src">${esc(t("esco.tasksSrc", { title: on.title, match: t("esco.match." + on.match) }))}</p>`;
}

// ---------- advisor ----------
async function loadAdvisor() {
  let res;
  try { res = await get("/advisor/queue"); }
  catch (e) { if (!still("advisor")) return; body().innerHTML = failBox(e, "advisor", "adv"); bindRetry(body(), { adv: loadAdvisor }); icons(); return; }
  if (!still("advisor")) return;
  const plans = res.plans || [];
  body().innerHTML = `<p class="note">${esc(t("adv.intro"))}</p>
    ${plans.some(p => p.profile?.isDemo) ? `<p class="src">${esc(t("adv.sampleNote"))}</p>` : ""}
    ${plans.length ? `<div class="adv-list">${plans.map(advCard).join("")}</div>` : `<div class="empty">${esc(t("adv.empty"))}</div>`}`;
  icons();
  body().querySelectorAll("[data-decide]").forEach(b => b.addEventListener("click", () => decide(b.dataset.plan, b.dataset.decide)));
}

function advCard(p) {
  const pr = p.profile || {};
  const stops = routeNodes(p.route).slice(1, -1);
  return `<article class="adv-card" data-plan-card="${esc(p.id)}">
    <div class="adv-top"><div><div class="rv-t">${esc(pr.displayName || t("adv.someone"))}</div>
      <div class="rs">${esc(pr.occupationTitle || nameOf(pr.occupationId))} → <b>${esc(p.title || nameOf(p.job))}</b></div>
      <div class="rs">${esc(t("adv.route", { mode: t("mode." + (p.mode || "fastest")) }))}</div></div>
      <div class="adv-when">${statusBadge(p.status)}<span class="rs">${esc(t("adv.sent", { when: ago(p.sentAt || p.updatedAt) }))}</span></div></div>
    <dl class="sheet-kv tn"><dt>${esc(t("adv.match"))}</dt><dd>${esc(pr.matchNow ?? "–")}%</dd><dt>${esc(t("adv.weeks"))}</dt><dd>${esc(p.weeks ?? "–")}</dd><dt>${esc(t("adv.hours"))}</dt><dd>${esc(pr.hours ?? "–")}</dd>${pr.targetDate ? `<dt>${esc(t("adv.target"))}</dt><dd>${esc(fmtDate(pr.targetDate))}</dd>` : ""}</dl>
    ${stops.length ? `<ol class="adv-route">${stops.map(s => `<li>${esc(nameOf(s))}</li>`).join("")}</ol>` : ""}
    ${p.userNote ? `<p class="advisor-note"><i data-lucide="message-square-quote"></i>${esc(p.userNote)}</p>` : ""}
    <label class="sr" for="adv-note-${esc(p.id)}">${esc(t("adv.note"))}</label>
    <textarea class="textarea" id="adv-note-${esc(p.id)}" rows="2" maxlength="2000" placeholder="${esc(t("adv.notePh"))}"></textarea>
    <div class="rv-actions"><button class="btn btn-primary" type="button" data-decide="approve" data-plan="${esc(p.id)}"><i data-lucide="badge-check"></i>${esc(t("adv.approve"))}</button>
      <button class="btn btn-soft" type="button" data-decide="changes" data-plan="${esc(p.id)}"><i data-lucide="message-square-warning"></i>${esc(t("adv.changes"))}</button></div>
  </article>`;
}

async function decide(id, decision) {
  const note = (body().querySelector(`#adv-note-${CSS.escape(id)}`)?.value || "").trim();
  if (decision === "changes" && !note) { toast({ title: t("adv.needNote") }); body().querySelector(`#adv-note-${CSS.escape(id)}`)?.focus(); return; }
  const btns = body().querySelectorAll(`[data-plan="${CSS.escape(id)}"]`); btns.forEach(b => b.disabled = true);
  try {
    await post(`/plans/${id}/decision`, note ? { decision, note } : { decision });
    toast({ title: t(decision === "approve" ? "adv.approvedToast" : "adv.changesToast"), badgeHtml: badge(decision === "approve" ? "b-good" : "b-warn", t(decision === "approve" ? "plan.status.approved" : "plan.status.changes")) });
    await actions.reloadPlans?.();
    loadAdvisor();
  } catch (e) {
    btns.forEach(b => b.disabled = false);
    toast({ title: t("state.failed"), detail: e.notAvailable ? t("state.notAvailable") : e.message, badgeHtml: badge("b-crit", t("state.error")) });
  }
}

// ---------- HR redeployment ----------
let hrEmployer = null;
async function loadHr() {
  let emps;
  try { emps = ((await get("/employers")).employers || []).filter(e => !isTestEmployer(e)); }
  catch (e) { if (!still("hr")) return; body().innerHTML = failBox(e, "hr", "hr"); bindRetry(body(), { hr: loadHr }); icons(); return; }
  if (!still("hr")) return;
  if (!emps.length) { body().innerHTML = `<div class="empty">${esc(t("hr.noEmployers"))}</div>`; return; }
  // open on the first employer that has a team (the sample shared services centre), not an empty one
  if (!hrEmployer || !emps.some(e => e.id === hrEmployer)) hrEmployer = (emps.find(e => e.hasTeam) || emps.find(e => e.source === "sample") || emps[0]).id;
  body().innerHTML = `<div class="hr-pick"><label for="hr-emp">${esc(t("hr.employer"))}</label><select id="hr-emp" class="select">${emps.map(e => `<option value="${esc(e.id)}" ${e.id === hrEmployer ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select>
    <span class="rs">${esc(t("hr.scenario", { year: S.year, scenario: t("scn." + S.scenario) }))}</span></div><div id="hr-out">${loadingBox(t("hr.loading"))}</div>`;
  body().querySelector("#hr-emp").addEventListener("change", e => { hrEmployer = Number(e.target.value); loadTeam(); });
  icons();
  loadTeam();
}

async function loadTeam() {
  const out = () => (still("hr") ? $("hr-out") : null);
  if (out()) out().innerHTML = loadingBox(t("hr.loading"));
  let r;
  try { r = await get(`/hr/${hrEmployer}/redeployment`, { year: S.year, scenario: S.scenario }); }
  catch (e) { const o = out(); if (!o) return; o.innerHTML = failBox(e, "hr", "team"); bindRetry(o, { team: loadTeam }); icons(); return; }
  const o = out(); if (!o) return;
  const tot = r.totals || {}, team = r.team || [], roles = r.openRoles || [], asg = r.assignment || [];
  const byPerson = Object.fromEntries(asg.map(a => [a.profileId, a]));
  o.innerHTML = `${r.employer?.isSample || r.note ? `<p class="src">${esc(r.note || t("hr.sampleNote"))}</p>` : ""}
    <div class="hr-sum"><p class="esco-big tn">${esc(t("hr.placedOf", { n: tot.assigned ?? asg.length, total: tot.people ?? team.length }))}</p>
      <dl class="sheet-kv tn"><dt>${esc(t("hr.openingsTotal"))}</dt><dd>${esc(tot.openings ?? "–")}</dd><dt>${esc(t("hr.onTime"))}</dt><dd>${esc(tot.onTime ?? "–")}</dd><dt>${esc(t("hr.cost"))}</dt><dd>${rm(tot.costRm)}</dd><dt>${esc(t("hr.hrdLabel"))}</dt><dd>${rm(tot.hrdClaimableRm)}</dd></dl></div>
    <div class="sec" id="hr-progress"></div>
    <div class="sec"><h3>${esc(t("hr.roles"))}</h3>${roles.length ? `<ul class="alt-list esco-rows">${roles.map(x => `<li><span class="esco-row-main"><span>${esc(x.title || nameOf(x.job))}</span><small class="rs">${esc(t("hr.by", { date: fmtDate(x.deadline) }))}</small></span><span class="esco-row-end tn">${esc(t("hr.openingsN", { n: x.openings }))}${x.openingsLeft ? `<small class="rs">${esc(t("hr.left", { n: x.openingsLeft }))}</small>` : ""}</span></li>`).join("")}</ul>` : `<p class="note">${esc(t("hr.noRoles"))}</p>`}</div>
    <div class="sec"><h3>${esc(t("hr.team"))}</h3>
    ${team.length ? `<div class="tbl-wrap"><table class="tbl hr-tbl"><thead><tr><th>${esc(t("hr.col.person"))}</th><th>${esc(t("hr.col.move"))}</th><th>${esc(t("hr.col.match"))}</th><th>${esc(t("hr.col.weeks"))}</th><th>${esc(t("hr.col.cost"))}</th><th>${esc(t("hr.col.ontime"))}</th></tr></thead><tbody>
      ${team.map(m => { const a = byPerson[m.profileId]; const best = a || [...(m.options || [])].sort((x, y) => y.match - x.match)[0];
        return `<tr><td><b>${esc(m.name)}</b><div class="rs">${esc(m.current?.title || "")}</div><div class="rs">${esc(t("hr.hoursWk", { h: m.hours ?? "–" }))}</div></td>
          <td>${best ? esc(nameOf(best.job)) : "–"}${a ? "" : best ? `<div class="rs">${esc(t("hr.notAssigned"))}</div>` : ""}</td>
          <td class="r tn">${best ? esc(best.match) + "%" : "–"}</td><td class="r tn">${best?.weeks ?? "–"}</td><td class="r tn">${best ? rm(best.costRm) : "–"}</td>
          <td class="r">${best ? ((a ? true : best.onTime) ? esc(t("hr.yes")) : `<span class="hr-late">${esc(t("hr.no"))}</span>`) : "–"}${best?.readyBy ? `<div class="rs">${esc(fmtDate(best.readyBy))}</div>` : ""}</td></tr>
          ${(m.options || []).length > 1 ? `<tr class="opt-row"><td colspan="6"><details><summary>${esc(t("hr.allOptions", { n: m.options.length }))}</summary><table class="tbl hr-opts"><tbody>${m.options.map(op => `<tr><td>${esc(op.title || nameOf(op.job))}</td><td class="r tn">${esc(op.match)}%</td><td class="r tn">${op.weeks != null ? esc(t("common.weeksN", { w: op.weeks })) : "–"}</td><td class="r tn">${rm(op.costRm)}</td><td class="r">${op.onTime ? esc(t("hr.onTimeShort")) : `<span class="hr-late">${esc(t("hr.late"))}</span>`}</td></tr>`).join("")}</tbody></table></details></td></tr>` : ""}`;
      }).join("")}</tbody></table></div>` : `<div class="empty">${esc(t("hr.noTeam"))}</div>`}</div>
    ${(r.unassigned || []).length ? `<div class="sec"><h3>${esc(t("hr.unassigned"))}</h3><ul class="handled">${r.unassigned.map(u => `<li><i data-lucide="minus"></i><div><b>${esc(u.name)}</b>${esc(u.reason)}</div></li>`).join("")}</ul></div>` : ""}
    ${r.rule ? `<p class="src">${esc(r.rule)}</p>` : ""}`;
  icons();
  loadTeamProgress($("hr-progress"), hrEmployer);
}

// ---------- employer requirements form ----------
let rows = [{ occupationId: "", skillId: "", weight: 2, levelNeeded: 3 }];
function renderEmployerForm() {
  const jobs = Object.entries(S.graph.nodes).filter(([, n]) => n.type === "job").sort((a, b) => a[1].name.localeCompare(b[1].name));
  const skills = Object.entries(S.graph.nodes).filter(([, n]) => n.type === "skill").sort((a, b) => a[1].name.localeCompare(b[1].name));
  const opt = (list, v) => list.map(([k, n]) => `<option value="${esc(k)}" ${k === v ? "selected" : ""}>${esc(n.name)}</option>`).join("");
  body().innerHTML = `<p class="note">${esc(t("empf.intro"))}</p>
    <form id="emp-form" class="emp-form" novalidate>
      <div class="grid2"><label>${esc(t("empf.name"))}<input name="name" required minlength="2" maxlength="120" autocomplete="organization"></label>
      <label>${esc(t("empf.sector"))}<input name="sector" maxlength="80"></label></div>
      <label>${esc(t("empf.url"))}<input name="careersUrl" type="url" maxlength="500" placeholder="https://"></label>
      <fieldset><legend>${esc(t("empf.reqs"))}</legend>
        <div class="req-rows">${rows.map((r, i) => `<div class="req-edit" data-row="${i}">
          <label><span class="sr">${esc(t("empf.job"))}</span><select class="select" data-f="occupationId" required><option value="">${esc(t("empf.job"))}</option>${opt(jobs, r.occupationId)}</select></label>
          <label><span class="sr">${esc(t("empf.skill"))}</span><select class="select" data-f="skillId" required><option value="">${esc(t("empf.skill"))}</option>${opt(skills, r.skillId)}</select></label>
          <label class="sm-in">${esc(t("empf.weight"))}<select class="select" data-f="weight">${["empf.w1", "empf.w2", "empf.w3"].map((k, i) => `<option value="${i + 1}" ${Number(r.weight) === i + 1 ? "selected" : ""}>${esc(t(k))}</option>`).join("")}</select></label>
          <label class="sm-in">${esc(t("empf.level"))}<input type="number" data-f="levelNeeded" min="1" max="5" value="${esc(r.levelNeeded)}"></label>
          <button class="icon-btn" type="button" data-del="${i}" aria-label="${esc(t("empf.remove"))}" ${rows.length < 2 ? "disabled" : ""}><i data-lucide="trash-2"></i></button></div>`).join("")}</div>
        <button class="ghost" type="button" id="emp-add"><i data-lucide="plus"></i>${esc(t("empf.addRow"))}</button>
      </fieldset>
      <p class="rs">${esc(t("empf.note"))}</p>
      <div id="emp-msg" aria-live="polite"></div>
      <button class="btn btn-primary" type="submit"><i data-lucide="send"></i>${esc(t("empf.submit"))}</button>
    </form>`;
  icons();
  const f = body().querySelector("#emp-form");
  const sync = () => f.querySelectorAll(".req-edit").forEach(el => { const i = +el.dataset.row; el.querySelectorAll("[data-f]").forEach(x => { rows[i][x.dataset.f] = x.type === "number" || x.dataset.f === "weight" ? Number(x.value) : x.value; }); });
  f.querySelector("#emp-add").addEventListener("click", () => { sync(); rows.push({ occupationId: rows[rows.length - 1]?.occupationId || "", skillId: "", weight: 2, levelNeeded: 3 }); keep(f, renderEmployerForm); });
  f.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => { sync(); rows.splice(+b.dataset.del, 1); keep(f, renderEmployerForm); }));
  f.addEventListener("submit", async ev => {
    ev.preventDefault(); sync();
    const fd = new FormData(f);
    const msg = f.querySelector("#emp-msg");
    const reqs = rows.filter(r => r.occupationId && r.skillId).map(r => ({ ...r, weight: Math.min(3, Math.max(1, r.weight || 2)), levelNeeded: Math.min(5, Math.max(1, r.levelNeeded || 3)) }));
    const name = String(fd.get("name") || "").trim();
    if (name.length < 2 || !reqs.length) { msg.innerHTML = `<div class="state-box err" role="alert">${esc(t("empf.invalid"))}</div>`; return; }
    const payload = { name, requirements: reqs };
    const sector = String(fd.get("sector") || "").trim(); if (sector) payload.sector = sector;
    const url = String(fd.get("careersUrl") || "").trim(); if (url) payload.careersUrl = url;
    const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
    try {
      const res = await post("/employers", payload);
      forgetEmployers();
      rows = [{ occupationId: "", skillId: "", weight: 2, levelNeeded: 3 }];
      body().innerHTML = `<div class="card"><h3><i data-lucide="circle-check" style="color:var(--good)"></i>${esc(t("empf.saved", { name: res.employer?.name || name }))}</h3>
        <p>${esc(t("empf.savedBody"))}</p>
        <ul class="alt-list esco-rows">${(res.requirements || []).map(q => `<li><span class="esco-row-main"><b>${esc(nameOf(q.occupationId))}</b><small class="rs">${esc(nameOf(q.skillId))}</small></span><span class="esco-row-end tn">${esc(t("req.level", { n: q.levelNeeded }))}</span></li>`).join("")}</ul>
        <button class="btn btn-soft" type="button" id="emp-again">${esc(t("empf.another"))}</button></div>`;
      icons();
      body().querySelector("#emp-again").addEventListener("click", renderEmployerForm);
    } catch (e) {
      btn.disabled = false;
      const details = Array.isArray(e.details) ? `<ul>${e.details.map(d => `<li>${esc(d.path ? d.path + ": " : "")}${esc(d.message)}</li>`).join("")}</ul>` : "";
      msg.innerHTML = e.notAvailable ? errorBox(e) : `<div class="state-box err" role="alert"><span>${esc(e.message)}</span>${details}</div>`;
      icons();
    }
  });
}
function keep(f, fn) { const name = f.querySelector("[name=name]").value, sector = f.querySelector("[name=sector]").value, url = f.querySelector("[name=careersUrl]").value; fn(); const g = body().querySelector("#emp-form"); g.querySelector("[name=name]").value = name; g.querySelector("[name=sector]").value = sector; g.querySelector("[name=careersUrl]").value = url; }

