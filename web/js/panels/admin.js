// Admin view: the knowledge pipeline under human control.
// Queue (GET /api/review): approve / reject flagged signals, confirm / reject emerging skills, spot-check automatic changes, handled log.
// Scout (POST /api/scout/run), run history (GET /api/scout/runs), knowledge-base versions with Undo, trusted-source policy.
import { S, UI, actions, nameOf } from "../state.js";
import { get, post, setAdminToken, hasAdminToken } from "../api.js";
import { t, tOr } from "../i18n.js";
import { $, esc, icons, badge, errorBox, loadingBox, extLink, fmtDate, ago, toast, bindRetry, enter } from "../util.js";
import { adminModelHtml, bindAdminModel } from "../features/exposure.js";

export const A = {
  sub: "queue",
  review: null, reviewErr: null, reviewLoading: false,
  runs: null, runsErr: null,
  versions: null, versionsErr: null,
  sources: null, sourcesErr: null,
  scout: { running: false, result: null, err: null, startedAt: 0, replay: false },
  busy: new Set(),
  needsToken: false,
};

const SUBS = ["queue", "runs", "versions", "sources", "model"];

export function pendingCount() {
  const r = A.review;
  if (!r) return null;
  return (r.pending?.length || 0) + (r.emerging?.length || 0);
}

// ---------- loading ----------
export async function loadReview() {
  A.reviewLoading = true;
  try { A.review = await get("/review"); A.reviewErr = null; A.needsToken = false; }
  catch (e) { A.reviewErr = e; if (e.needsAuth) A.needsToken = true; }
  A.reviewLoading = false;
  actions.updateAdminCount?.();
}
async function loadRuns() { try { A.runs = (await get("/scout/runs")).runs || []; A.runsErr = null; } catch (e) { A.runsErr = e; } }
async function loadVersions() { try { A.versions = (await get("/kb/versions")).versions || []; A.versionsErr = null; } catch (e) { A.versionsErr = e; } }
async function loadSources() { try { A.sources = await get("/sources"); A.sourcesErr = null; } catch (e) { A.sourcesErr = e; } }

async function fillModel() {
  const box = document.getElementById("xp-admin"); if (!box) return;
  box.innerHTML = await adminModelHtml();
  if (!document.getElementById("xp-admin")) return;
  bindAdminModel(box); bindRetry(box, { xpmodel: fillModel }); icons();
}

export async function loadSub(sub = A.sub) {
  if (sub === "queue") await loadReview();
  if (sub === "runs") await loadRuns();
  if (sub === "versions") await loadVersions();
  if (sub === "sources") await loadSources();
  repaint();
  if (sub === "model") fillModel();
}

// ---------- rendering ----------
export function render() {
  return `<div class="stack">
    <div class="admin-banner"><div><div class="ob-kicker">${esc(t("admin.kicker"))}</div><h2>${esc(t("admin.title"))}</h2>
      <p class="note">${esc(t("admin.intro"))}</p></div>
      <button class="ghost" type="button" id="admin-exit"><i data-lucide="arrow-left"></i>${esc(t("admin.exit"))}</button></div>
    ${A.needsToken || hasAdminToken() ? tokenBox() : ""}
    <div class="seg seg-wide" role="tablist" aria-label="${esc(t("admin.sectionsAria"))}">${SUBS.map(s => `<button type="button" role="tab" data-sub="${s}" aria-selected="${A.sub === s}" aria-pressed="${A.sub === s}">${esc(t("admin.sub." + s))}</button>`).join("")}</div>
    <div id="admin-body">${body()}</div>
  </div>`;
}

function tokenBox() {
  return `<form class="token-box" id="token-form"><label for="admin-token">${esc(t("admin.token"))}</label>
    <div class="row"><input id="admin-token" type="password" autocomplete="off" placeholder="${esc(hasAdminToken() ? t("admin.tokenSet") : t("admin.tokenPh"))}">
    <button class="btn btn-soft" type="submit">${esc(t("admin.tokenSave"))}</button></div></form>`;
}

function body() {
  if (A.sub === "queue") return queueHtml();
  if (A.sub === "runs") return runsHtml();
  if (A.sub === "versions") return versionsHtml();
  if (A.sub === "model") return `<div id="xp-admin">${loadingBox()}</div>`;
  return sourcesHtml();
}

function scoutCard() {
  const sc = A.scout;
  let res = "";
  if (sc.running) res = `<div class="scout-live" role="status">${loadingBox(t("scout.running", { s: Math.max(1, Math.round((Date.now() - sc.startedAt) / 1000)) }))}<ul class="log">${scoutSteps()}</ul></div>`;
  else if (sc.err) res = sc.err.result ? scoutResult(sc.err.result) : errorBox(sc.err, "scout");
  else if (sc.result) res = scoutResult(sc.result);
  return `<div class="card"><h3><i data-lucide="radar"></i>${esc(t("scout.title"))}</h3>
    <p>${esc(t("scout.body"))}</p>
    <div class="scout-actions"><button class="btn btn-primary" type="button" id="scout-run" ${sc.running ? "disabled" : ""}><i data-lucide="radar"></i>${esc(sc.running ? t("scout.runningBtn") : t("scout.run"))}</button>
      <label class="check"><input type="checkbox" id="scout-replay" ${sc.replay ? "checked" : ""}> ${esc(t("scout.replay"))}</label></div>
    ${res}</div>`;
}
function scoutSteps() {
  const s = (Date.now() - A.scout.startedAt) / 1000;
  return ["scout.step1", "scout.step2", "scout.step3", "scout.step4"].filter((_, i) => s >= i * 2.5).map(k => `<li>${esc(t(k))}</li>`).join("");
}
export function scoutResult(r) {
  const c = r.counts || {};
  const st = r.replayed || r.status === "replayed" ? badge("b-violet", t("src.replayed"), "history") : r.status === "failed" ? badge("b-crit", t("scout.failed")) : badge("b-good", t("scout.ok"), "check");
  const cells = [["fetched", "download"], ["candidates", "filter"], ["rejected", "x"], ["duplicates", "copy"], ["auto", "check"], ["flagged", "flag"]];
  return `<div class="scout-res">${st}<span class="rs">${esc(t("scout.runId", { id: r.runId ?? "–" }))}</span></div>
    <div class="tiles tiles-3">${cells.map(([k, ic]) => `<div class="tile"><div class="k"><i data-lucide="${ic}"></i>${esc(t("scout.c." + k))}</div><div class="v num">${esc(c[k] ?? 0)}</div></div>`).join("")}</div>
    ${r.error ? `<div class="state-box err" role="alert"><i data-lucide="circle-alert"></i><span>${esc(r.error)}</span></div>` : ""}
    ${r.replayed || r.status === "replayed" ? `<p class="note">${esc(t("scout.replayedNote"))}</p>` : ""}`;
}

function queueHtml() {
  if (A.reviewErr && !A.review) return errorBox(A.reviewErr, "review") + scoutCard();
  if (!A.review) return loadingBox(t("admin.loadingQueue"));
  const r = A.review, c = r.counts || {};
  const pend = r.pending || [], emg = r.emerging || [], spot = r.spotcheck || [], done = r.handled || [];
  const anySample = [...pend, ...emg, ...spot, ...done].some(x => x.isSample);
  return `<div class="stack">
    ${anySample ? `<p class="note">${esc(t("admin.sampleNote"))}</p>` : ""}
    <div class="tiles tiles-4">
      <div class="tile"><div class="k">${esc(t("admin.t.waiting"))}</div><div class="v num">${pend.length + emg.length}</div></div>
      <div class="tile"><div class="k">${esc(t("admin.t.auto"))}</div><div class="v num">${esc(c.auto ?? c.applied ?? done.filter(x => x.triage === "auto" || x.status === "applied").length)}</div></div>
      <div class="tile"><div class="k">${esc(t("admin.t.spot"))}</div><div class="v num">${spot.length}</div></div>
      <div class="tile"><div class="k">${esc(t("admin.t.kb"))}</div><div class="v num">v${esc(S.graph.kbVersion)}</div></div>
    </div>
    <div class="flow">
      <div><b>1</b>${esc(t("admin.flow1"))}</div><div><b>2</b>${esc(t("admin.flow2"))}</div><div><b>3</b>${esc(t("admin.flow3"))}</div><div><b>4</b>${esc(t("admin.flow4"))}</div>
    </div>
    ${scoutCard()}
    <div><div class="h2"><h2>${esc(t("admin.needs"))}</h2><span>${esc(t("admin.nChanges", { n: pend.length }))}</span></div>
      ${pend.length ? pend.map(signalCard).join("") : `<div class="empty">${esc(t("admin.nothing"))}</div>`}</div>
    <div><div class="h2"><h2>${esc(t("admin.newSkills"))}</h2><span>${emg.length}</span></div>
      ${emg.length ? emg.map(emergingCard).join("") : `<div class="empty">${esc(t("admin.noSkills"))}</div>`}</div>
    <div><div class="h2"><h2>${esc(t("admin.spot"))}</h2><span>${esc(t("admin.spotHint"))}</span></div>
      ${spot.length ? spot.map(spotCard).join("") : `<div class="empty">${esc(t("admin.noSpot"))}</div>`}</div>
    <div><div class="h2"><h2>${esc(t("admin.handled"))}</h2><span>${done.length}</span></div>
      ${done.length ? `<ul class="handled">${done.slice(0, 30).map(handledRow).join("")}</ul>` : `<div class="empty">${esc(t("admin.noHandled"))}</div>`}</div>
  </div>`;
}

const pts = (x, isE) => (x > 0 ? "+" : "−") + Math.abs(Math.round(isE ? x * 100 : x));
export function changeText(s) {
  const parts = [];
  if (s.deltaE) parts.push(t("admin.expChange", { d: pts(s.deltaE, true) }));
  if (s.deltaD) parts.push(t("admin.demChange", { d: pts(s.deltaD) }));
  return parts.join(", ") || t("admin.noChange");
}

function reviewerLine(rv) {
  if (!rv) return "";
  const conf = rv.confidence != null ? Number(rv.confidence).toFixed(2) : "–";
  const txt = rv.supports === false ? t("admin.rvDisagrees") : (rv.confidence ?? 1) < 0.8 ? t("admin.rvUnsure") : t("admin.rvAgrees");
  return `<div class="rv-s" title="${esc(t("admin.rvConf", { c: conf }))}"><i data-lucide="bot"></i><span>${esc(txt)}${rv.issue ? ". " + esc(rv.issue) : ""}</span></div>`;
}

// Triage reasons as one plain list: "Big change, Single source" -> "big change, single source".
const reasonList = rs => rs.map((x, i) => i === 0 ? String(x) : String(x).charAt(0).toLowerCase() + String(x).slice(1)).join(", ");

// The source on its own line: link, then date (and source count, live mark) in plain text.
function sourceLine(url, title, date, { n, live } = {}) {
  const meta = [live ? t("src.live") : "", date ? fmtDate(date) : "", n ? t("admin.nSources", { n }) : ""].filter(Boolean).join(", ");
  return `<div class="rv-s"><i data-lucide="link"></i>${extLink(url, title || t("why.source"))}${meta ? `<span>${esc(meta)}</span>` : ""}</div>`;
}

function signalCard(s) {
  const reasons = Array.isArray(s.triageReasons) ? s.triageReasons : [];
  const busy = A.busy.has("s" + s.id);
  return `<div class="rv" data-sig="${esc(s.id)}"><div class="rv-top">${badge("b-warn", t("admin.flagged"), "flag")}</div>
    <div class="rv-t">${esc(s.title)}</div><div class="rv-m">${esc(s.nodeName || nameOf(s.nodeId))}: ${esc(changeText(s))}</div>
    ${reasons.length ? `<div class="rv-m">${esc(t("admin.whyFlagged", { list: reasonList(reasons) }))}</div>` : ""}
    ${s.quote ? `<blockquote class="rv-q">“${esc(s.quote)}”</blockquote>` : ""}
    ${sourceLine(s.sourceUrl, s.sourceTitle, s.sourceDate, { n: s.nSources, live: !s.isSample })}
    ${reviewerLine(s.reviewer)}
    <label class="sr" for="note-${esc(s.id)}">${esc(t("admin.note"))}</label><input class="note-in" id="note-${esc(s.id)}" type="text" maxlength="300" placeholder="${esc(t("admin.notePh"))}">
    <div class="rv-actions"><button class="btn btn-primary" type="button" data-approve="${esc(s.id)}" ${busy ? "disabled" : ""}>${busy ? '<span class="spin"></span>' : '<i data-lucide="check"></i>'}${esc(t("admin.approve"))}</button>
      <button class="btn btn-soft" type="button" data-reject="${esc(s.id)}" ${busy ? "disabled" : ""}>${esc(t("admin.reject"))}</button></div></div>`;
}

function emergingCard(c) {
  const th = S.graph.thresholds || { postings: 15, employers: 5, weeks: 4 };
  const live = c.evidenceBasis === "trusted_source_mentions"; // counted from trusted-source mentions, not job postings
  const watching = c.state === "watching";
  const rows = [[live ? "admin.th.mentions" : "skill.th.postings", c.postings, th.postings], [live ? "admin.th.orgs" : "skill.th.employers", c.employers, th.employers], ["skill.th.weeks", c.weeks, th.weeks]]
    .map(([l, v, tv]) => `<li><i data-lucide="${v >= tv ? "circle-check" : "circle-x"}" style="color:${v >= tv ? "var(--good)" : "var(--crit)"}"></i><span>${esc(t(l))}</span><b class="num">${esc(v ?? "–")}</b><span class="rs">${esc(t("skill.th.need", { n: tv }))}</span></li>`).join("");
  const linked = c.linkedSkill || c.linked_skill;
  const cm = c.committee || {};
  const syn = Array.isArray(c.synonyms) ? c.synonyms : [];
  const ev = Array.isArray(c.evidence) ? c.evidence : [];
  const busy = A.busy.has("e" + c.id);
  const verdict = v => typeof v === "string" ? v : v && typeof v === "object" ? (v.verdict || v.reason || v.note || (v.ok === false ? "✗" : "✓")) : "✓";
  const p = c.progress || {};
  const status = watching
    ? t("admin.watchingLine", { m: p.mentions?.have ?? c.postings ?? 0, mn: th.postings, o: p.organisations?.have ?? c.employers ?? 0, on: th.employers, w: p.weeks?.have ?? c.weeks ?? 0, wn: th.weeks })
    : t("admin.halfWeight") + ".";
  return `<div class="rv"><div class="rv-top">${watching ? badge("b-info", t("admin.watching"), "eye") : badge("b-violet", t("admin.emerging"), "sparkles")}</div>
    <div class="rv-t">${esc(c.label || nameOf(c.skillId))}</div><div class="rv-m">${esc(status)}${syn.length ? " " + esc(t("skill.merged", { list: syn.join(", ") })) : ""}</div>
    <ul class="checks">${rows}${linked ? `<li><i data-lucide="circle-check" style="color:var(--good)"></i><span>${esc(t("admin.linked"))}</span><b>${esc(nameOf(linked))}</b><span></span></li>` : ""}</ul>
    ${cm && Object.keys(cm).length ? `<div class="rv-s"><i data-lucide="bot"></i>${esc(t("admin.committee", { p: verdict(cm.proposer), s: verdict(cm.skeptic), d: verdict(cm.duplicate) }))}</div>` : ""}
    ${ev.slice(0, 2).map(e => sourceLine(e.url, e.quote ? "“" + String(e.quote).slice(0, 90) + "”" : "", e.date)).join("")}
    ${watching ? `<div class="rv-m">${esc(t("admin.watchingHint"))}</div>` : ""}
    <div class="rv-actions">${watching ? "" : `<button class="btn btn-primary" type="button" data-confirm="${esc(c.id)}" ${busy ? "disabled" : ""}><i data-lucide="badge-check"></i>${esc(t("admin.confirm"))}</button>`}
      <button class="btn btn-soft" type="button" data-ereject="${esc(c.id)}" ${busy ? "disabled" : ""}>${esc(t("admin.rejectSkill"))}</button></div></div>`;
}

function spotCard(s) {
  const busy = A.busy.has("p" + s.id);
  return `<div class="rv"><div class="rv-top">${badge("b-good", t("admin.autoApplied"), "check")}</div>
    <div class="rv-t">${esc(s.title)}</div><div class="rv-m">${esc(s.nodeName || nameOf(s.nodeId))}: ${esc(changeText(s))}</div>
    ${sourceLine(s.sourceUrl, s.sourceTitle, s.sourceDate, { live: !s.isSample })}
    <div class="rv-actions"><button class="btn btn-soft" type="button" data-spot="${esc(s.id)}" data-ok="1" ${busy ? "disabled" : ""}><i data-lucide="thumbs-up"></i>${esc(t("admin.spotOk"))}</button>
      <button class="btn btn-soft" type="button" data-spot="${esc(s.id)}" data-ok="0" ${busy ? "disabled" : ""}><i data-lucide="thumbs-down"></i>${esc(t("admin.spotBad"))}</button></div></div>`;
}

function handledRow(x) {
  const st = x.status || "";
  const ok = /approv|applied|confirm|auto|provisional/i.test(st) || x.triage === "auto";
  const label = { approved: "admin.h.approved", rejected: "admin.h.rejected", applied: "admin.h.applied", auto: "admin.h.applied", confirmed: "admin.h.confirmed", provisional: "admin.h.provisional", merged: "admin.h.merged", reverted: "admin.h.reverted" }[st] || null;
  const title = x.title || (x.label ? t("admin.newSkillName", { name: x.label }) : "–");
  const who = x.decidedBy ? " " + t("admin.byName", { name: x.decidedBy }) : x.triage === "auto" ? " " + t("admin.byRules") : "";
  return `<li><i data-lucide="${ok ? "check" : "x"}" style="color:${ok ? "var(--good)" : "var(--crit)"}"></i><div><b>${esc(label ? t(label) : st)}${esc(who)}</b>${esc(title)}${x.deltaE || x.deltaD ? ": " + esc(changeText(x)) : ""}${x.triageReasons?.length && !ok ? `<div class="rs">${esc(reasonList(x.triageReasons))}</div>` : ""}</div></li>`;
}

function runsHtml() {
  if (A.runsErr) return errorBox(A.runsErr, "runs");
  if (!A.runs) return loadingBox();
  if (!A.runs.length) return `<div class="empty">${esc(t("runs.none"))}</div>`;
  return `<ul class="runs">${A.runs.map(r => {
    const st = r.status === "replayed" ? badge("b-violet", t("src.replayed"), "history") : r.status === "failed" ? badge("b-crit", t("scout.failed")) : r.status === "running" ? badge("b-info", t("runs.running")) : badge("b-good", t("scout.ok"));
    const sm = r.summary && typeof r.summary === "object" ? (r.summary.counts || r.summary) : null;
    const smText = sm ? [sm.reason || sm.error || "", ...Object.entries(sm).filter(([, v]) => typeof v === "number").map(([k, v]) => `${tOr("scout.c." + k, k)} ${v}`)].filter(Boolean).join(", ") : r.summary ? String(r.summary) : "";
    return `<li><div class="run-top">${st}<b>${esc(tOr("runs.kind." + (r.kind || "scout"), r.kind))}</b><span class="rs">#${esc(r.id)}${r.trigger ? ", " + esc(r.trigger) : ""}</span></div>
      <div class="rs">${esc(fmtDate(r.startedAt))} (${esc(ago(r.startedAt))})${r.finishedAt && r.startedAt ? ", " + esc(t("runs.took", { s: Math.max(0, Math.round((new Date(r.finishedAt) - new Date(r.startedAt)) / 1000)) })) : ""}</div>
      ${smText ? `<div class="rs">${esc(smText)}</div>` : ""}</li>`;
  }).join("")}</ul>`;
}

function versionsHtml() {
  if (A.versionsErr) return errorBox(A.versionsErr, "versions");
  if (!A.versions) return loadingBox();
  const undone = new Set(A.versions.map(v => /undo version (\d+)/i.exec(v.note || "")?.[1]).filter(Boolean).map(Number));
  return `<p class="note">${esc(t("ver.intro"))}</p><ul class="versions">${A.versions.map(v => {
    const cur = v.id === S.graph.kbVersion, busy = A.busy.has("v" + v.id);
    const undoable = v.id > 1 && (v.changes ?? 1) > 0 && !/^undo|revert/i.test(v.note || "") && !undone.has(v.id);
    return `<li class="${cur ? "cur" : ""}"><div class="ver-top"><b class="num">v${esc(v.id)}</b>${cur ? badge("b-info", t("ver.current")) : ""}${undone.has(v.id) ? badge("b-mute", t("admin.h.reverted")) : ""}<span class="rs">${esc(t("ver.changes", { n: v.changes ?? 0 }))}${v.actor ? " " + esc(t("admin.byName", { name: v.actor })) : ""}, ${esc(fmtDate(v.createdAt))}</span></div>
      <div class="ver-note">${esc(v.note || "")}</div>
      ${undoable ? `<button class="ghost sm" type="button" data-undo="${esc(v.id)}" ${busy ? "disabled" : ""}><i data-lucide="undo-2"></i>${esc(t("ver.undo"))}</button>` : ""}</li>`;
  }).join("")}</ul>`;
}

function sourcesHtml() {
  if (A.sourcesErr) return errorBox(A.sourcesErr, "sources");
  if (!A.sources) return loadingBox();
  const s = A.sources;
  return `<div class="stack">
    <div class="card"><h3><i data-lucide="scroll-text"></i>${esc(t("src.policy"))}</h3><ul class="policy">${(s.policy || []).map(p => `<li>${esc(p)}</li>`).join("")}</ul></div>
    <div><div class="h2"><h2>${esc(t("src.trusted"))}</h2><span>${(s.trusted || []).length}</span></div>
      <ul class="src-list">${(s.trusted || []).map(x => `<li><b>${esc(x.domain)}</b>${badge("b-mute", x.kind)}<div class="rs">${esc(x.why)}</div></li>`).join("")}</ul></div>
    <div><div class="h2"><h2>${esc(t("src.linkOnly"))}</h2><span>${esc(t("src.linkOnlyHint"))}</span></div>
      <ul class="src-list">${(s.linkOnly || []).map(x => `<li>${extLink(x.url, x.name)}<div class="rs">${esc(x.why)}</div></li>`).join("")}</ul></div>
  </div>`;
}

// ---------- actions ----------
export function repaint() {
  if (UI.view !== "admin") return;
  const b = $("admin-body"); if (!b) return;
  b.innerHTML = body(); bindBody(b); icons();
}

let tick = null;
export async function runScout() {
  if (A.scout.running) return;
  A.scout = { ...A.scout, running: true, result: null, err: null, startedAt: Date.now() };
  actions.renderAgents?.();
  repaint();
  clearInterval(tick);
  tick = setInterval(() => { if (!A.scout.running) return clearInterval(tick); const live = document.querySelector(".scout-live"); if (live) live.outerHTML = `<div class="scout-live" role="status">${loadingBox(t("scout.running", { s: Math.round((Date.now() - A.scout.startedAt) / 1000) }))}<ul class="log">${scoutSteps()}</ul></div>`; }, 1000);
  try {
    const res = await post("/scout/run", A.scout.replay ? { replay: true } : {}, { timeout: 180000 });
    A.scout.result = res;
    const c = res.counts || {};
    if (res.status === "failed") throw Object.assign(new Error(res.error || t("scout.failed")), { status: 200, code: "scout_failed", result: res });
    toast({ title: t("scout.doneToast", { flagged: c.flagged ?? 0, auto: c.auto ?? 0 }), detail: t("scout.doneBody", { fetched: c.fetched ?? 0, rejected: c.rejected ?? 0 }), badgeHtml: res.replayed || res.status === "replayed" ? badge("b-violet", t("src.replayed"), "history") : badge(c.flagged ? "b-warn" : "b-good", c.flagged ? t("admin.flagged") : t("scout.ok")) });
    if (c.auto) await actions.knowledgeChanged?.({ reason: "auto" });
  } catch (e) {
    A.scout.err = e; if (e.needsAuth) A.needsToken = true;
    toast({ title: t("scout.failedToast"), detail: e.notAvailable ? t("state.notAvailable") : e.message, badgeHtml: badge("b-crit", t("state.error")) });
  }
  A.scout.running = false; clearInterval(tick);
  await loadReview();
  if (UI.view === "admin") actions.renderPanel(); else actions.renderAgents?.();
  A.runs = null;
}

async function act(key, fn) {
  if (A.busy.has(key)) return;
  A.busy.add(key); repaint();
  try { await fn(); }
  catch (e) {
    if (e.needsAuth) { A.needsToken = true; actions.renderPanel(); }
    toast({ title: t("state.failed"), detail: e.notAvailable ? t("state.notAvailable") : e.message, badgeHtml: badge("b-crit", t("state.error")) });
  }
  A.busy.delete(key);
  await loadReview();
  repaint();
}

function bindBody(b) {
  bindRetry(b, { review: () => loadSub("queue"), runs: () => loadSub("runs"), versions: () => loadSub("versions"), sources: () => loadSub("sources"), scout: runScout });
  const sr = b.querySelector("#scout-run"); if (sr) sr.addEventListener("click", runScout);
  const rp = b.querySelector("#scout-replay"); if (rp) rp.addEventListener("change", () => { A.scout.replay = rp.checked; });
  b.querySelectorAll("[data-approve]").forEach(x => x.addEventListener("click", () => {
    const sig = (A.review?.pending || []).find(s => String(s.id) === x.dataset.approve);
    const note = b.querySelector(`#note-${CSS.escape(x.dataset.approve)}`)?.value || undefined;
    act("s" + x.dataset.approve, () => actions.approveSignal(sig || { id: x.dataset.approve }, note));
  }));
  b.querySelectorAll("[data-reject]").forEach(x => x.addEventListener("click", () => {
    const note = b.querySelector(`#note-${CSS.escape(x.dataset.reject)}`)?.value || undefined;
    act("s" + x.dataset.reject, async () => {
      await post(`/review/signals/${x.dataset.reject}/reject`, note ? { note } : {});
      toast({ title: t("admin.rejectedToast"), detail: t("admin.rejectedBody"), badgeHtml: badge("b-mute", t("admin.h.rejected")) });
    });
  }));
  b.querySelectorAll("[data-confirm]").forEach(x => x.addEventListener("click", () => act("e" + x.dataset.confirm, async () => {
    const c = (A.review?.emerging || []).find(e => String(e.id) === x.dataset.confirm);
    await post(`/review/emerging/${x.dataset.confirm}/confirm`, {});
    toast({ title: t("admin.confirmedToast", { name: c?.label || "" }), detail: t("admin.confirmedBody"), badgeHtml: badge("b-good", t("admin.h.confirmed")) });
    await actions.knowledgeChanged?.({ reason: "emerging" });
  })));
  b.querySelectorAll("[data-ereject]").forEach(x => x.addEventListener("click", () => act("e" + x.dataset.ereject, async () => {
    await post(`/review/emerging/${x.dataset.ereject}/reject`, {});
    toast({ title: t("admin.skillRejected"), badgeHtml: badge("b-mute", t("admin.h.rejected")) });
  })));
  b.querySelectorAll("[data-spot]").forEach(x => x.addEventListener("click", () => act("p" + x.dataset.spot, async () => {
    const ok = x.dataset.ok === "1";
    await post(`/review/spotcheck/${x.dataset.spot}`, { ok });
    toast({ title: t(ok ? "admin.spotOkToast" : "admin.spotBadToast"), badgeHtml: badge(ok ? "b-good" : "b-warn", t("admin.spot")) });
  })));
  b.querySelectorAll("[data-undo]").forEach(x => x.addEventListener("click", async () => {
    const id = x.dataset.undo;
    // Two-step confirm inline: the first click arms the button for a few seconds.
    if (x.dataset.armed !== "1") {
      x.dataset.armed = "1"; x.classList.add("armed");
      x.innerHTML = `<i data-lucide="triangle-alert"></i>${esc(t("ver.confirmBtn", { v: id }))}`; icons();
      setTimeout(() => { if (x.isConnected && x.dataset.armed === "1") { x.dataset.armed = ""; x.classList.remove("armed"); x.innerHTML = `<i data-lucide="undo-2"></i>${esc(t("ver.undo"))}`; icons(); } }, 5000);
      return;
    }
    A.busy.add("v" + id); repaint();
    try {
      const res = await post(`/kb/versions/${id}/undo`, {});
      toast({ title: t("ver.undone", { v: id }), detail: t("ver.undoneBody", { v: res.kbVersion }), badgeHtml: badge("b-info", t("ver.undo")) });
      await actions.knowledgeChanged?.({ reason: "undo" });
    } catch (e) { toast({ title: t("state.failed"), detail: e.notAvailable ? t("state.notAvailable") : e.message, badgeHtml: badge("b-crit", t("state.error")) }); }
    A.busy.delete("v" + id);
    await loadVersions(); repaint();
  }));
}

export function bind(el) {
  const ex = el.querySelector("#admin-exit"); if (ex) ex.addEventListener("click", () => actions.setView("user"));
  el.querySelectorAll("[data-sub]").forEach(b => b.addEventListener("click", () => {
    A.sub = b.dataset.sub;
    el.querySelectorAll("[data-sub]").forEach(o => { o.setAttribute("aria-selected", String(o === b)); o.setAttribute("aria-pressed", String(o === b)); });
    repaint(); loadSub(A.sub);
  }));
  const tf = el.querySelector("#token-form");
  if (tf) tf.addEventListener("submit", async ev => {
    ev.preventDefault();
    const v = tf.querySelector("#admin-token").value.trim();
    setAdminToken(v || null); A.needsToken = false;
    toast({ title: t("admin.tokenSaved") });
    await loadSub(A.sub); actions.renderPanel();
  });
  const b = $("admin-body"); if (b) { bindBody(b); enter(b.querySelectorAll(".rv")); }
  if (!A.review && !A.reviewLoading && A.sub === "queue") loadSub("queue");
  else if (A.sub === "model") fillModel();
  else if (A.sub !== "queue" && !A[A.sub] && !A[A.sub + "Err"]) loadSub(A.sub);
}

