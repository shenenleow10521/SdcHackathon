// "Why this number?" — every match %, weeks and exposure figure has a small (i) button that opens this popover:
// the formula in plain words, the inputs behind it, where each record comes from, the knowledge-base version,
// applied signals (GET /api/signals?node=) and, when available, an AI-written, fact-checked explanation (GET /api/explain).
import { S, UI, D, N, nameOf, W, profileId, kindOf } from "../state.js";
import { PARAMS } from "/shared/engine.js";
import { get } from "../api.js";
import { t } from "../i18n.js";
import { esc, icons, srcBadge, errorBox, loadingBox, extLink, fmtDate, sign } from "../util.js";

let pop = null, lastFocus = null;

export const whyBtn = (kind, id, labelKey = "why.label") =>
  `<button class="why" type="button" data-why="${esc(kind)}" data-id="${esc(id)}" aria-label="${esc(t(labelKey))}" title="${esc(t("why.label"))}"><i data-lucide="info"></i></button>`;

/** The one text link per section that opens the same popover ("How is this worked out?"). */
export const howLink = (kind, id) =>
  `<button class="how-link" type="button" data-why="${esc(kind)}" data-id="${esc(id)}">${esc(t("why.how"))}</button>`;

const isSample = s => !s || ["sample", "seed"].includes(String(s).toLowerCase());
const f1 = x => String(Math.round(x * 10) / 10);
const pc = x => Math.round(x * 100) + "%";

export function initWhy() {
  document.addEventListener("click", e => {
    const b = e.target.closest?.("[data-why]");
    if (b) { e.preventDefault(); e.stopPropagation(); open(b.dataset.why, b.dataset.id, b); return; }
    if (pop && !pop.contains(e.target)) close();
  }, true);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && pop) { e.stopPropagation(); close(); } }, true);
}

export function close() {
  if (!pop) return;
  pop.remove(); pop = null;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}

/** A popover with any content (e.g. "How good is it?"), same look and behaviour as "Why this number?". */
export function openCustom(anchor, kicker, title, html) {
  close();
  lastFocus = anchor;
  pop = document.createElement("div");
  pop.className = "pop glass";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-labelledby", "pop-title");
  pop.tabIndex = -1;
  pop.innerHTML = `<div class="pop-head"><div><div class="dr-kind"><i data-lucide="gauge"></i>${esc(kicker)}</div><h3 id="pop-title">${esc(title)}</h3></div>
      <button class="icon-btn sm" type="button" data-pop-close aria-label="${esc(t("common.close"))}"><i data-lucide="x"></i></button></div><div class="pop-body">${html}</div>`;
  document.body.appendChild(pop);
  pop.querySelector("[data-pop-close]").addEventListener("click", close);
  icons(); place(anchor); pop.focus();
}

function open(kind, id, anchor) {
  close();
  if (!S.E || !N(id)) return;
  lastFocus = anchor;
  pop = document.createElement("div");
  pop.className = "pop glass";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-modal", "false");
  pop.setAttribute("aria-labelledby", "pop-title");
  pop.tabIndex = -1;
  const body = kind === "match" ? matchBody(id) : kind === "weeks" ? weeksBody(id) : exposureBody(id);
  pop.innerHTML = `<div class="pop-head"><div><div class="dr-kind"><i data-lucide="calculator"></i>${esc(t("why.kicker"))}</div>
      <h3 id="pop-title">${esc(body.title)}</h3></div>
      <button class="icon-btn sm" type="button" data-pop-close aria-label="${esc(t("common.close"))}"><i data-lucide="x"></i></button></div>
    <div class="pop-body">${body.html}
      <div class="pop-sec" data-signals-sec><h4>${esc(t("why.signals"))}</h4><div data-signals>${loadingBox()}</div></div>
      ${body.explain ? `<div class="pop-sec" data-explain-sec><h4>${esc(t("why.inWords"))}</h4><div data-explain>${loadingBox(t("why.explaining"))}</div></div>` : ""}
      <p class="src">${esc(t("why.scenarioLine", { year: S.year, scenario: t("scn." + S.scenario), date: fmtDate(S.graph.kbCreatedAt) }))}</p>
    </div>`;
  document.body.appendChild(pop);
  pop.querySelector("[data-pop-close]").addEventListener("click", close);
  icons();
  place(anchor);
  pop.focus();
  loadSignals(id);
  if (body.explain) loadExplain(id);
}

function place(anchor) {
  if (window.innerWidth < 640) { pop.classList.add("sheet-pop"); return; }
  const r = anchor.getBoundingClientRect(), w = Math.min(380, window.innerWidth - 24);
  pop.style.width = w + "px";
  let left = Math.min(window.innerWidth - w - 12, Math.max(12, r.left - w / 2 + r.width / 2));
  const h = pop.offsetHeight;
  let top = r.bottom + 8;
  if (top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 8);
  pop.style.left = left + "px"; pop.style.top = top + "px";
}

async function loadSignals(id) {
  const box = pop?.querySelector("[data-signals]"); if (!box) return;
  try {
    const res = await get("/signals", { node: id });
    if (!pop || !box.isConnected) return;
    const list = (res.signals || []).filter(s => !s.nodeId || s.nodeId === id);
    const applied = (S.graph.appliedChanges || []).filter(c => c.nodeId === id && !c.signalId);
    if (!list.length && !applied.length) { pop.querySelector("[data-signals-sec]")?.remove(); return; } // nothing changed this record
    box.innerHTML = `<ul class="sig-list">${list.map(sigRow).join("")}${applied.map(c => `<li>${esc(t("why.changeRow", { e: fmtDelta(c.deltaE, true), d: fmtDelta(c.deltaD) }))}</li>`).join("")}</ul>
      ${list.some(x => x.isSample) ? `<p class="src">${esc(t("why.sigSample"))}</p>` : ""}`;
  } catch (err) {
    if (!pop || !box.isConnected) return;
    box.innerHTML = errorBox(err);
  }
  icons();
}
const fmtDelta = (x, isE) => !x ? "0" : isE ? (x > 0 ? "+" : "−") + Math.abs(Math.round(x * 100)) + " pts" : (x > 0 ? "+" : "−") + Math.abs(Math.round(x)) + " pts";

export function sigRow(s) {
  const change = [s.deltaE ? t("why.expDelta", { d: fmtDelta(s.deltaE, true) }) : "", s.deltaD ? t("why.demDelta", { d: fmtDelta(s.deltaD) }) : ""].filter(Boolean).join(", ");
  return `<li><div class="sig-t">${esc(s.title)}</div>${change ? `<div class="rs">${esc(change)}</div>` : ""}
    <div class="rs sig-meta"><span>${extLink(s.sourceUrl, s.sourceTitle || t("why.source"))}</span>${s.sourceDate ? `<span>${esc(fmtDate(s.sourceDate))}</span>` : ""}</div></li>`;
}

async function loadExplain(id) {
  const sec = pop?.querySelector("[data-explain-sec]"), box = pop?.querySelector("[data-explain]"); if (!box) return;
  const isJob = N(id)?.type === "job";
  try {
    const res = await get("/explain", { profile: profileId(), [isJob ? "job" : "node"]: id, year: S.year, scenario: S.scenario, mode: UI.mode }, { timeout: 30000 });
    if (!pop || !box.isConnected) return;
    if (!res.text) { sec.remove(); return; }
    // Turn inline [nodeId] citation markers into numbered references that match the chips below.
    const order = [...(res.citations || [])];
    const text = esc(res.text).replace(/\s*\[([A-Za-z0-9_-]+)\]/g, (m, id) => {
      if (!N(id) && !order.includes(id)) return m;
      if (!order.includes(id)) order.push(id);
      return `<sup class="cite" title="${esc(nameOf(id))}">${order.indexOf(id) + 1}</sup>`;
    });
    const cites = order.map(c => `<li>${esc(N(c) ? nameOf(c) : c)}</li>`).join("");
    box.innerHTML = `<p class="explain">${text}</p>
      ${cites ? `<ol class="cites" aria-label="${esc(t("why.citations"))}">${cites}</ol>` : ""}
      <p class="src">${esc(t("why.aiNote"))}${res.removed ? " " + esc(t("why.removedNote", { n: res.removed })) : ""}</p>`;
  } catch (err) {
    if (!pop || !box.isConnected) return;
    if (err.notAvailable || err.status === 503) sec.remove(); // hide gracefully: the numbers stand without it
    else box.innerHTML = errorBox(err);
  }
  icons();
}

const BASIS = { owned: "why.basis.owned", taken: "why.basis.taken", bridged: "why.basis.bridged", missing: "why.basis.missing" };

function matchBody(job) {
  const E = S.E, extra = job === UI.job ? UI.employerReq : [];
  const rows = E.matchBreakdown(job, extra);
  const num = rows.reduce((s, r) => s + r.effectiveWeight * r.coverage, 0), den = rows.reduce((s, r) => s + r.effectiveWeight, 0);
  const total = den ? Math.round(100 * num / den) : 0;
  const reqSrc = [...new Set((S.graph.req[job] || []).map(r => r.source || "sample"))];
  // Lead with the plain sentence; the formula and its rules are one click away.
  const html = `<p class="pop-lead">${esc(t("why.leadMatch", { have: f1(num), total: f1(den), pct: total }))}</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t("why.col.skill"))}</th><th>${esc(t("why.col.weight"))}</th><th>${esc(t("why.col.level"))}</th><th>${esc(t("why.col.cov"))}</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${esc(nameOf(r.skill))}<div class="rs">${esc(t(BASIS[r.basis] || r.basis))}</div>${r.status === "emerging" ? `<div class="rs">${esc(t("why.emergingRow"))}</div>` : ""}</td>
      <td class="num">${f1(r.effectiveWeight)}</td><td class="num">${Math.min(r.level, r.need)}/${r.need}</td><td class="num">${pc(r.coverage)}</td></tr>`).join("")}
    </tbody><tfoot><tr><td>${esc(t("why.total"))}</td><td class="num" colspan="2">${esc(t("why.totalOf", { num: f1(num), den: f1(den) }))}</td><td class="num"><b>${total}%</b></td></tr></tfoot></table></div>
    ${extra.length ? `<p class="note">${esc(t("why.employerIncl", { name: UI.employer?.name || "" }))}</p>` : ""}
    <details class="pop-more"><summary>${esc(t("why.howCalc"))}</summary><p class="formula">${esc(t("why.matchFormula"))}</p>
      <ul class="formula-notes"><li>${esc(t("why.matchCov1"))}</li><li>${esc(t("why.matchCov2", { b: Math.round(PARAMS.bridgeCoverage * 100) }))}</li><li>${esc(t("why.matchCov3", { c: Math.round(PARAMS.takenCoverage * 100) }))}</li><li>${esc(t("why.matchCov4", { w: PARAMS.emergingWeight }))}</li></ul></details>
    ${reqSrc.includes("sample") ? `<p class="src">${esc(t("why.reqSample"))}</p>`
      : `<div class="pop-sec"><h4>${esc(t("why.records"))}</h4><div class="chips">${reqSrc.map(s => srcBadge(s)).join("")}<span class="rs">${esc(t("why.reqFrom", { n: N(job)?.postings ?? "–" }))}</span></div></div>`}`;
  return { title: t("why.matchTitle", { job: nameOf(job) }), html, explain: true };
}

function weeksBody(job) {
  const p = D.plans[job] || S.E.planFor(job, UI.mode, job === UI.job ? UI.employerReq : []);
  const h = S.profile.hours;
  const legRows = (p.route?.legs || []).map(l => `<tr><td>${esc(nameOf(l.to))}<div class="rs">${esc(l.kind === "own" ? t("why.leg.own") : l.kind === "evolve" ? t("why.leg.evolve") : N(l.to)?.type === "job" ? t("why.leg.arrive") : t("why.leg.learn"))}</div></td><td class="num">${l.weeks}</td><td class="num">${W(l.weeks)}</td></tr>`).join("");
  const upRows = p.ups.map(u => `<tr><td>${esc(nameOf(u.id))} ${u.from}→${u.to}<div class="rs">${esc(t("why.leg.upskill"))}</div></td><td class="num">${u.weeks}</td><td class="num">${W(u.weeks)}</td></tr>`).join("");
  const exRows = p.extras.map(x => `<tr><td>${esc(nameOf(x.id))}<div class="rs">${esc(t("why.leg.extra"))}</div></td><td class="num">${x.weeks}</td><td class="num">${W(x.weeks)}</td></tr>`).join("");
  const html = `${p.route ? `<p class="pop-lead">${esc(t("why.leadWeeks", { w: W(p.ready), h }))}</p>` : ""}
    ${p.route ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t("why.col.step"))}</th><th>${esc(t("why.col.ref"))}</th><th>${esc(t("why.col.you", { h }))}</th></tr></thead><tbody>${legRows}${upRows}${exRows}</tbody>
      <tfoot><tr><td>${esc(t("why.corePath"))}</td><td class="num">${p.core}</td><td class="num">${W(p.core)}</td></tr><tr><td>${esc(t("why.jobReady"))}</td><td class="num">${p.ready}</td><td class="num"><b>${W(p.ready)}</b></td></tr></tfoot></table></div>`
      : `<p class="note">${esc(t("path.noRouteBody", { year: S.year }))}</p>`}
    <details class="pop-more"><summary>${esc(t("why.howCalc"))}</summary><p class="formula">${esc(t("why.weeksFormula", { h }))}</p>
      <ul class="formula-notes"><li>${esc(t("why.weeksMode." + UI.mode))}</li><li>${esc(t("why.weeksClosed"))}</li></ul></details>
    <p class="src">${esc(t("why.edgesSrc"))}</p>`;
  return { title: t("why.weeksTitle", { job: nameOf(job) }), html, explain: false };
}

function exposureBody(id) {
  const E = S.E, n = N(id);
  const e = n.e || [0, 0, 0], d = n.d || [0, 0, 0];
  const dE = S.graph.deltas?.e?.[id] || 0, dD = S.graph.deltas?.d?.[id] || 0;
  const thr = PARAMS.takenBase - PARAMS.takenTideSlope * E.tide();
  const html = `<p class="pop-lead">${esc(t("why.expNow", { year: S.year, scenario: t("scn." + S.scenario), e: Math.round(E.exposure(id) * 100), d: sign(E.demand(id)) }))}</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>2026</th><th>${esc(t("why.col.mod"))}</th><th>${esc(t("why.col.fast"))}</th></tr></thead><tbody>
      <tr><td>${esc(t("common.exposure"))}</td>${e.map(v => `<td class="num">${Math.round(v * 100)}%</td>`).join("")}</tr>
      <tr><td>${esc(t("common.demand"))}</td>${d.map(v => `<td class="num">${sign(v)}</td>`).join("")}</tr></tbody></table></div>
    ${E.taken(id) && (E.isSkill(id) || kindOf(id) === "you") ? `<p class="note">${esc(t("why.tookOverNow"))}</p>` : ""}
    <details class="pop-more"><summary>${esc(t("why.howCalc"))}</summary><ul class="formula-notes">
      <li>${esc(t("why.expFormula"))}</li>
      ${dE || dD ? `<li>${esc(t("why.expDeltas", { e: fmtDelta(dE, true), d: fmtDelta(dD) }))}</li>` : ""}
      ${E.isSkill(id) || kindOf(id) === "you" ? `<li>${esc(t("why.takenRule", { thr: Math.round(thr * 100) }))}</li>` : ""}
    </ul></details>
    ${isSample(n.outlookSource) ? `<p class="src">${esc(t("why.figSample"))}${n.sourceUri ? " " + extLink(n.sourceUri, t("why.sourceRecord")) : ""}</p>`
      : `<div class="pop-sec"><h4>${esc(t("why.records"))}</h4><div class="chips">${srcBadge(n.outlookSource)}${n.source && n.source !== n.outlookSource && !isSample(n.source) ? srcBadge(n.source) : ""}${n.sourceUri ? extLink(n.sourceUri, t("why.sourceRecord")) : ""}</div></div>`}`;
  return { title: t("why.expTitle", { name: n.name }), html, explain: true };
}

