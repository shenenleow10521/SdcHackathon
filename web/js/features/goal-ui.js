// My goal tab: what to do this week, then the two tracks ("Stay AI-ready in your job", "Your move") as step cards.
// Each step is a compact row (name, planned dates and hours, status, one Mark as done toggle); tapping it opens the shared skill view.
// Also here: the printable skills record and "Share my progress with my employer". The drawer reuses the Prove block.
// Storage (server for your own profile, this browser for the sample persona) lives in features/goal.js.
import { S, UI, N, nameOf, actions, currentJobTitle, when } from "../state.js";
import { get } from "../api.js";
import { t, getLang } from "../i18n.js";
import { esc, badge, toast, safeUrl, loadingBox, errorBox, bindRetry } from "../util.js";
import { startCheck } from "../drawer.js";
import { stayTrack } from "./stay.js";
import { goal, goalView, onServer, loadGoal, goalError, goalLoading, toggleDone, checkPassed, addCredential, removeCredential, logHours, thisWeek,
  weeksLeftOf, setShare, toggleStay } from "./goal.js";
import { scheduleSteps, dateRange, dayMonth, changeText, paceText, weekHours, progressLine, okCredentialUrl, isoDay, mondayOf } from "./track-text.js";

const SHOWN = 5;                         // step cards before "Show more"
const MAX_CREDENTIALS = 5;               // the server's limit per skill
const ALL = { move: false, stay: false }; // "Show more" pressed

const lang = () => getLang();
const cap = s => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : s); // ESCO titles are lowercase
const year = () => new Date().getUTCFullYear();
const today = () => isoDay(Date.now());
const day = d => (d ? dayMonth(String(d).slice(0, 10), lang(), year()) : "");
const hoursText = h => t("common.hours", { h: Math.max(1, Math.round(h)) });
const courseOf = id => (S.graph?.courses?.[id] || [])[0] || null;
const canCheck = id => N(id)?.type === "skill" && !S.profileFallback;
const stepName = s => (s.kind === "upskill" && s.levelFrom != null && s.levelTo != null ? t("path.upTitle", { name: s.name || nameOf(s.skillId), from: s.levelFrom, to: s.levelTo }) : s.name || nameOf(s.skillId));
/** Key steps are numbered in route order, like the map; other skills ("also needed") are not. */
const numbered = steps => { let n = 0; return steps.map(s => ({ ...s, n: s.key ? ++n : 0 })); };

// ---------- the step row ----------
function proofLine(p, id) {
  if (p.kind === "check") return `<li><i data-lucide="badge-check"></i><span>${esc(t("track.proof.check", { date: day(p.at) }))}</span></li>`;
  if (p.kind === "advisor") return `<li><i data-lucide="user-check"></i><span>${esc(t("track.proof.advisor", { name: p.by, date: day(p.at) }))}</span></li>`;
  const url = p.url ? safeUrl(p.url) : null;
  return `<li><i data-lucide="award"></i><span><b>${esc(p.title || t("track.proof.cred"))}</b> <span class="ms-meta">${esc(t("track.proof.credMeta", { by: p.by, date: day(p.at) }))}</span>
    ${url ? `<a class="gl-cred" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(t("track.proof.show"))}</a>` : ""}
    <button class="link-btn gl-rm" type="button" data-gl-rm="${esc(id)}" data-proof="${esc(p.id)}">${esc(t("track.proof.remove"))}</button></span></li>`;
}

/** Prove: who vouches for this skill so far, the 5-minute check and "+ Add certificate". Shared with the drawer. */
export function proveHtml(s) {
  const id = s.skillId, proofs = s.proofs || [];
  const creds = proofs.filter(p => p.kind === "credential").length, checked = proofs.some(p => p.kind === "check");
  const check = canCheck(id) && !checked && !s.verified ? `<button class="ms-btn" type="button" data-gl-check="${esc(id)}">${esc(t("check.take"))}</button>` : "";
  const add = creds < MAX_CREDENTIALS ? `<button class="gl-add" type="button" data-gl-add="${esc(id)}"><i data-lucide="plus"></i>${esc(t("track.addCert"))}</button>` : "";
  return `${proofs.length ? `<ul class="gl-proofs">${proofs.map(p => proofLine(p, id)).join("")}</ul>` : `<p class="ms-meta">${esc(t("track.noProof"))}</p>`}
    ${check ? `<div class="gl-btns">${check}</div>` : ""}
    <div class="gl-checkbox" data-gl-checkbox="${esc(id)}"></div>
    ${add}<div class="gl-formbox" data-gl-form="${esc(id)}"></div>`;
}

/** The id the skill view uses: catalogue skills as they are, ESCO skills with "xs:" (the same rule as the map). */
const drawerId = id => (N(id) || String(id).startsWith("xs:") ? id : "xs:" + id);

function stepRow(s, when, { track, nextId, hidden }) {
  const attr = track === "stay" ? "data-gl-stay" : "data-gl-done";
  const dates = !s.done && when ? dateRange(when.start, when.end, t, lang(), year()) : "";
  const meta = [dates, s.hours != null ? hoursText(s.hours) : ""].filter(Boolean).join(", ");
  const mark = s.done ? `<i data-lucide="check"></i>` : s.n ? `<b>${s.n}</b>` : "";
  const did = drawerId(s.skillId), name = stepName(s);
  const status = s.done ? `<span class="gl-done"><i data-lucide="circle-check"></i>${esc(s.doneAt ? t("track.doneOn", { date: day(s.doneAt) }) : t("track.done"))}</span>${s.verified ? badge("b-good", t("conf.verified"), "badge-check") : ""}` : "";
  return `<li class="gl-step${s.done ? " done" : ""}"${hidden ? " hidden data-gl-extra" : ""} id="gl-step-${esc(track)}-${esc(s.skillId)}">
    <div class="gl-main" role="button" tabindex="0" data-gl-open="${esc(did)}" data-gl-name="${esc(name)}"><span class="gl-num${s.n || s.done ? "" : " gl-num-o"}" aria-hidden="true">${mark}</span>
      <span class="gl-st"><span class="gl-name">${esc(name)}</span>${meta ? `<span class="ms-meta">${esc(meta)}</span>` : ""}</span></div>
    <div class="gl-side">${status}<button class="link-btn gl-tg" type="button" ${attr}="${esc(s.skillId)}">${esc(t(s.done ? "track.undo" : "track.markDone"))}</button></div></li>`;
}

function stepList(steps, dates, track, autoOpen = true) {
  const nextId = autoOpen ? steps.find(s => !s.done)?.skillId : null;
  const more = steps.length - SHOWN;
  return `<ol class="gl-steps">${steps.map((s, i) => stepRow(s, dates[i], { track, nextId, hidden: i >= SHOWN && !ALL[track] && s.skillId !== nextId })).join("")}</ol>
    ${more > 0 && !ALL[track] ? `<button class="ms-more" type="button" data-gl-more="${track}">${esc(t("track.showMore", { n: more }))}</button>` : ""}`;
}

const bar = (done, total) => { const p = total ? Math.round(100 * done / total) : 100; return `<div class="gl-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}"><i style="width:${p}%"></i></div>`; };

/** The goal header's big figures, like a map app's "25 min, 12 km": weeks left and steps done. */
const figs = (weeksLeft, done, total) => `<div class="gl-figs">
    <div class="gl-fig"><b>${esc(done >= total ? "0" : String(Math.max(1, weeksLeft || 1)))}</b><span>${esc(t("goal.figWeeks"))}</span></div>
    <div class="gl-fig"><b>${esc(t("goal.figSteps", { done, total }))}</b><span>${esc(t("goal.figStepsLbl"))}</span></div></div>`;

// ---------- the two tracks ----------
// hero: this track is the goal, shown first with big figures.
function moveCard(v, hero = false) {
  const steps = numbered(v.steps || []);
  const head = `<div class="gl-kick">${esc(t(hero ? "goal.heroKicker" : "goal.moveKicker"))}</div>
    <div class="ms-gh"><h2>${esc(v.goal.title || nameOf(v.goal.job))}</h2><span class="ms-meta">${esc(t("goal.setOn", { date: day(v.goal.setAt) }))}</span></div>`;
  if (v.noRoute || !steps.length) return `<section class="ms-card gl-track${hero ? " gl-hero" : ""}">${head}<p class="ms-line">${esc(v.noRoute ? t("path.noRouteBody", { year: when() }) : t("track.nothingLeft"))}</p>${links(v)}</section>`;
  const done = steps.filter(s => s.done).length, left = weeksLeftOf(steps);
  const dates = scheduleSteps(steps, v.hoursPerWeek || S.profile.hours, today());
  const match = v.match != null ? t("track.matchNow", { n: Math.round(v.match) }) + " " : "";
  return `<section class="ms-card gl-track${hero ? " gl-hero" : ""}" id="gl-move">${head}
    ${hero ? figs(left, done, steps.length) : `<p class="ms-line">${esc(match + progressLine(done, steps.length, left, t))}</p>`}${bar(done, steps.length)}
    ${hero && match ? `<p class="ms-meta">${esc(match.trim())}</p>` : ""}
    ${hero ? `<div class="gl-sub">${esc(t("goal.stepsHead"))}<span class="ms-meta">${esc(t("goal.mapHint"))}</span></div>` : ""}
    ${stepList(steps, dates, "move")}
    ${links(v)}</section>`;
}
const links = v => `<div class="ms-links"><button class="link-btn" type="button" data-open-route="${esc(v.goal.job)}">${esc(t("goal.openPlan"))}</button></div>`;

function stayCard(st, withDates, hero = false) {
  const cls = `ms-card gl-track${hero ? " gl-hero" : ""}`;
  const head = `<div class="gl-kick">${esc(t(hero ? "goal.heroKicker" : "stay.kicker"))}</div><div class="ms-gh"><h2>${esc(t("stay.title", { job: st.job }))}</h2></div>
    ${hero ? `<p class="ms-meta">${esc(t("stay.kicker"))}</p>` : ""}`;
  if (!st.items.length) return `<section class="${cls}">${head}<p class="ms-line">${esc(t("outlook.stayNone", { job: st.job }))}</p></section>`;
  const steps = st.items.map((x, i) => ({ skillId: x.id, name: cap(x.name), hours: x.hours, done: x.done, key: false, n: hero ? i + 1 : 0, course: x.course || null }));
  const dates = withDates ? scheduleSteps(steps, S.profile.hours, today()) : steps.map(() => null);
  return `<section class="${cls}" id="gl-stay">${head}
    ${hero ? figs(st.weeksLeft, st.done, st.items.length) : `<p class="ms-line">${esc(progressLine(st.done, st.items.length, st.weeksLeft, t))}</p>`}${bar(st.done, st.items.length)}
    ${hero ? `<div class="gl-sub">${esc(t("goal.stepsHead"))}</div>` : ""}
    ${stepList(steps, dates, "stay", withDates)}</section>`;
}

// ---------- this week ----------
function weekCard(v, st) {
  const hpw = v?.hoursPerWeek || S.profile.hours;
  let nx = null;
  if (v) nx = numbered(v.steps || []).find(s => !s.done) || null;
  if (!nx && st && !v) { const x = st.items.find(i => !i.done); if (x) { nx = { skillId: x.id, name: x.name, hours: x.hours, n: 0, course: x.course || null }; } }
  if (!v && !nx) return "";
  let next;
  if (nx) {
    const co = nx.course || courseOf(nx.skillId), url = co?.url ? safeUrl(co.url) : null;
    const total = Math.max(1, Math.round(nx.hours || 0)), h = weekHours(nx.hours, hpw);
    const line = nx.hours == null ? t("track.weekNoHours") : co ? t(h >= total ? "track.weekLearnAll" : "track.weekLearn", { course: co.title, h, total }) : t(h >= total ? "track.weekStudyAll" : "track.weekStudy", { h, total });
    next = `<div class="gl-next"><div class="ms-name">${esc(nx.n ? t("track.stepN", { n: nx.n, name: stepName(nx) }) : stepName(nx))}</div><p class="ms-line">${esc(line)}</p>
      <div class="ms-act">${url ? `<a class="ms-btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(t("track.openCourse"))}</a>` : ""}<button class="link-btn" type="button" data-gl-goto="${esc(drawerId(nx.skillId))}" data-gl-name="${esc(stepName(nx))}">${esc(t("track.seeStep"))}</button></div></div>`;
  } else next = `<p class="ms-line">${esc(t("track.allDone"))}</p>`;
  const pace = paceBlock(v);
  return `<section class="ms-card gl-week">
    <div class="ms-gh"><h2>${esc(t("track.week"))}</h2><span class="ms-meta">${esc(t("track.weekOf", { date: day(mondayOf(today())) }))}</span></div>
    ${next}${pace ? `<hr class="ms-hr">${pace}` : ""}</section>`;
}

function paceBlock(v) {
  if (!v) return ""; // no goal job: the week card shows only the next step, so it never asks for a goal it already shows above
  if (v.local) return `<p class="ms-meta">${esc(t("track.paceSample"))}</p>`;
  const p = paceText(v.pace, t, lang(), year()), tw = thisWeek();
  return `${p ? `<div class="gl-pace s-${esc(p.status)}"><b>${esc(p.head)}</b><span class="ms-line">${esc(p.line)}</span></div>` : ""}
    <div class="gl-log" id="gl-log">
      <div class="gl-log-row">${tw ? `<span class="ms-meta">${esc(t("track.logged", { h: tw.hours }))}</span>` : ""}<button class="ms-btn" type="button" data-gl-log>${esc(t(tw ? "track.logChange" : "track.log"))}</button></div>
      <form class="gl-logf" hidden><label for="gl-hours">${esc(t("track.logLabel"))}</label>
        <input id="gl-hours" type="number" min="0" max="80" step="0.5" inputmode="decimal" value="${esc(tw ? tw.hours : v.hoursPerWeek || S.profile.hours)}">
        <button class="ms-btn gl-pri" type="submit">${esc(t("track.logSave"))}</button><button class="link-btn" type="button" data-gl-logx>${esc(t("common.cancel"))}</button></form>
    </div>`;
}

// ---------- record and sharing ----------
export function shareHtml() {
  if (!onServer()) return "";
  return `<label class="gl-share"><input type="checkbox" role="switch" data-gl-share${S.profile.shareProgress ? " checked" : ""}>
    <span><b>${esc(t("track.share"))}</b><span class="ms-meta">${esc(t("track.shareLine"))}</span></span></label>`;
}
function recordCard() {
  const share = shareHtml();
  return `<section class="ms-card gl-rec">
    <div class="ms-gh"><h3>${esc(t("track.rec.title"))}</h3><span class="ms-meta">${esc(t("myskills.private"))}</span></div>
    <p class="ms-line">${esc(t("track.rec.line"))}</p>
    <div class="ms-act"><button class="ms-btn" type="button" data-gl-record>${esc(t("track.rec.btn"))}</button></div>
    ${share ? `<hr class="ms-hr">${share}` : ""}</section>`;
}

// ---------- the tab ----------
export function renderGoal() {
  if (onServer() && !goal() && goalLoading()) return `<div class="stack ms-page">${loadingBox(t("track.loading"))}</div>`;
  const v = goalView(), st = stayTrack(), err = goalError();
  const noMove = `<section class="ms-card gl-track"><div class="gl-kick">${esc(t("goal.moveKicker"))}</div><div class="ms-gh"><h2>${esc(t("goal.moveNoneTitle"))}</h2></div><p class="ms-line">${esc(t("goal.noneBody"))}</p>
      <div class="ms-act"><button class="ms-btn" type="button" data-tab-jobs>${esc(t("goal.noneBtn"))}</button></div></section>`;
  // The goal comes first: the job you're moving to, or else your own job made AI-ready. Then this week, then the other track.
  const cards = v ? [moveCard(v, true), weekCard(v, st), st ? stayCard(st, false) : ""]
    : st ? [stayCard(st, true, true), weekCard(null, st), noMove]
    : [noMove];
  return `<div class="stack ms-page gl-page">
    ${err && !err.notAvailable ? `<div id="gl-err">${errorBox(err, "goal")}</div>` : ""}
    ${cards.join("")}
    ${recordCard()}
  </div>`;
}

/** Bind every step and Prove control under root (the My goal panel, or the drawer). */
export function bindSteps(root) {
  root.querySelectorAll("[data-gl-done]").forEach(b => b.addEventListener("click", () => tick(b, b.dataset.glDone)));
  root.querySelectorAll("[data-gl-stay]").forEach(b => b.addEventListener("click", async () => {
    const id = b.dataset.glStay; b.disabled = true;
    const ch = await toggleStay(id);
    if (!ch) { b.disabled = false; return; }
    actions.refresh({ animate: false });
  }));
  root.querySelectorAll("[data-gl-check]").forEach(b => b.addEventListener("click", () => {
    const id = b.dataset.glCheck, box = [...root.querySelectorAll("[data-gl-checkbox]")].find(x => x.dataset.glCheckbox === id);
    b.disabled = true;
    startCheck(id, box, () => checkPassed(id));
  }));
  root.querySelectorAll("[data-gl-add]").forEach(b => b.addEventListener("click", () => {
    const id = b.dataset.glAdd, box = [...root.querySelectorAll("[data-gl-form]")].find(x => x.dataset.glForm === id);
    if (box) { b.hidden = true; credForm(box, id, () => { b.hidden = false; }); }
  }));
  root.querySelectorAll("[data-gl-rm]").forEach(b => b.addEventListener("click", () => { b.disabled = true; removeCredential(b.dataset.glRm, b.dataset.proof); }));
  root.querySelectorAll("[data-gl-share]").forEach(c => c.addEventListener("change", async () => {
    c.disabled = true;
    const ok = await setShare(c.checked);
    if (!ok) c.checked = !c.checked;
    else toast({ title: t(c.checked ? "track.shareOn" : "track.shareOff"), badgeHtml: badge(c.checked ? "b-info" : "b-mute", t(c.checked ? "track.shared" : "myskills.private")) });
    c.disabled = false;
  }));
}

async function tick(b, id) {
  b.disabled = true;
  const before = goalView();
  const was = before?.steps.find(s => s.skillId === id);
  const ch = await toggleDone(id);
  if (!ch) { b.disabled = false; return; }
  const name = was ? stepName(was) : nameOf(id), v = goalView();
  let detail;
  if (ch.local) { const steps = v?.steps || []; detail = progressLine(steps.filter(s => s.done).length, steps.length, weeksLeftOf(steps), t); }
  else detail = changeText(ch, t);
  toast({ title: name, detail, badgeHtml: badge(ch.done ? "b-good" : "b-mute", t(ch.done ? "track.done" : "track.notDone"), ch.done ? "check" : undefined) });
  actions.refresh({ animate: false });
}

function credForm(box, id, onClose) {
  box.innerHTML = `<form class="gl-form" novalidate>
    <label>${esc(t("track.cert.url"))}<input name="url" type="url" inputmode="url" placeholder="https://" maxlength="500" required></label>
    <label>${esc(t("track.cert.title"))}<input name="title" maxlength="120" placeholder="${esc(t("track.cert.titlePh"))}" required></label>
    <p class="ms-meta">${esc(t("track.cert.note"))}</p>
    <div class="gl-form-msg" aria-live="polite"></div>
    <div class="gl-btns"><button class="ms-btn gl-pri" type="submit">${esc(t("track.cert.save"))}</button><button class="link-btn" type="button" data-x>${esc(t("common.cancel"))}</button></div></form>`;
  const f = box.querySelector("form"), msg = f.querySelector(".gl-form-msg");
  f.url.focus();
  f.querySelector("[data-x]").addEventListener("click", () => { box.innerHTML = ""; onClose(); });
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const url = f.url.value.trim(), title = f.title.value.trim();
    if (!okCredentialUrl(url)) { msg.textContent = t("track.cert.badUrl"); f.url.focus(); return; }
    if (title.length < 2) { msg.textContent = t("track.cert.badTitle"); f.title.focus(); return; }
    f.querySelector("button[type=submit]").disabled = true;
    if (await addCredential(id, { url, title })) toast({ title: t("track.cert.added"), detail: title, badgeHtml: badge("b-mute", t("track.proof.cred"), "award") });
    else f.querySelector("button[type=submit]").disabled = false;
  });
}

/** Open the shared skill view for a step; an ESCO skill needs its name known to the map first. */
function openSkill(id, name) {
  if (!N(id) && name && !S.xsNames[id]) S.xsNames[id] = name;
  actions.openDrawer(id);
}

export function bindGoal(el) {
  bindSteps(el);
  el.querySelectorAll("[data-tab-jobs]").forEach(b => b.addEventListener("click", () => { UI.tab = "jobs"; actions.renderPanel(); }));
  el.querySelectorAll("[data-open-route]").forEach(b => b.addEventListener("click", () => actions.showPath(b.dataset.openRoute)));
  el.querySelectorAll("[data-gl-more]").forEach(b => b.addEventListener("click", () => {
    ALL[b.dataset.glMore] = true;
    b.closest(".gl-track").querySelectorAll("[data-gl-extra]").forEach(x => { x.hidden = false; });
    b.remove();
  }));
  el.querySelectorAll("[data-gl-goto]").forEach(b => b.addEventListener("click", () => openSkill(b.dataset.glGoto, b.dataset.glName)));
  el.querySelectorAll("[data-gl-open]").forEach(r => {
    r.addEventListener("click", () => openSkill(r.dataset.glOpen, r.dataset.glName));
    r.addEventListener("keydown", e => { if (e.target === r && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openSkill(r.dataset.glOpen, r.dataset.glName); } });
  });
  el.querySelectorAll("[data-gl-record]").forEach(b => b.addEventListener("click", openRecord));
  bindRetry(el, { goal: () => { loadGoal({ force: true }).then(() => actions.refresh()); } });
  const log = el.querySelector("#gl-log");
  if (log) {
    const f = log.querySelector("form"), open = log.querySelector("[data-gl-log]");
    open.addEventListener("click", () => { f.hidden = false; open.closest(".gl-log-row").hidden = true; f.querySelector("input").select(); });
    log.querySelector("[data-gl-logx]").addEventListener("click", () => { f.hidden = true; open.closest(".gl-log-row").hidden = false; });
    f.addEventListener("submit", async e => {
      e.preventDefault();
      const h = Number(f.querySelector("input").value);
      if (!(h >= 0 && h <= 80)) { f.querySelector("input").focus(); return; }
      f.querySelector("button[type=submit]").disabled = true;
      const r = await logHours(Math.round(h * 10) / 10);
      if (r) { const p = paceText(r.pace, t, lang(), year()); toast({ title: t("track.loggedToast", { h: r.checkIn.hours }), detail: p ? p.line : "", badgeHtml: badge(r.pace?.status === "behind" ? "b-warn" : "b-good", p?.head || t("track.done")) }); }
      else f.querySelector("button[type=submit]").disabled = false;
    });
  }
}

// ---------- the printable skills record ----------
const BASIS = { cv: "track.rec.basis.cv", self: "track.rec.basis.self", quiz: "track.rec.basis.quiz", verified: "track.rec.basis.verified" };
function localRecord() {
  const g = goal(), p = S.profile;
  const proofs = g?.proofs || {};
  const held = new Set((p.skills || []).filter(s => s.level > 0).map(s => s.skillId));
  const ids = [...new Set([...held, ...Object.keys(proofs).filter(k => (proofs[k] || []).length)])];
  const skills = ids.map(k => {
    const s = (p.skills || []).find(x => x.skillId === k), pr = proofs[k] || [];
    return { skillId: k, name: nameOf(k), source: "catalogue", level: s?.level || null, basis: s?.confidence || null, held: held.has(k),
      verified: s?.confidence === "verified" || pr.some(x => x.kind !== "credential"), proofs: pr, uri: null };
  }).sort((a, b) => Number(b.verified) - Number(a.verified) || Number(b.held) - Number(a.held) || a.name.localeCompare(b.name));
  return { name: p.displayName, isSample: true, asOf: today(), currentJob: { title: currentJobTitle() || "" }, goal: g ? { title: nameOf(g.job), setAt: g.setAt } : null,
    counts: { skills: skills.filter(s => s.held).length, verified: skills.filter(s => s.verified).length, credentials: skills.reduce((n, s) => n + s.proofs.filter(x => x.kind === "credential").length, 0) },
    skills, sources: [{ kind: "catalogue", label: "HalaTuju skills catalogue (sample data)", url: null }] };
}

export function recordHtml(r) {
  const L = lang(), dd = d => (d ? new Date(String(d).slice(0, 10) + "T00:00:00Z").toLocaleDateString(L === "ms" ? "ms-MY" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
  const link = (u, text) => { const s = u ? safeUrl(u) : null; return s ? `<a href="${esc(s)}">${esc(text)}</a>` : esc(text); };
  const who = s => {
    const lines = (s.proofs || []).map(p => p.kind === "check" ? esc(t("track.proof.check", { date: dd(p.at) }))
      : p.kind === "advisor" ? esc(t("track.proof.advisor", { name: p.by, date: dd(p.at) }))
      : `${esc(p.title || t("track.proof.cred"))} (${esc(p.by)}), ${link(p.url, t("track.proof.show"))}. <span class="m">${esc(t("track.rec.credNote"))}</span>`);
    if (s.basis && BASIS[s.basis] && !(s.basis === "verified" && lines.length)) lines.push(esc(t(BASIS[s.basis])));
    return lines.length ? lines.join("<br>") : `<span class="m">${esc(t("track.rec.none"))}</span>`;
  };
  const lvl = s => (!s.held ? esc(t("track.rec.notYet")) : s.level ? esc(t("track.rec.level", { n: s.level })) : `<span class="m">${esc(t("track.rec.noLevel"))}</span>`);
  const rows = (r.skills || []).map(s => `<tr><td><b>${s.uri ? link(s.uri, s.name) : esc(s.name)}</b>${s.verified ? ` <span class="v">${esc(t("conf.verified"))}</span>` : ""}</td><td>${lvl(s)}</td><td>${who(s)}</td></tr>`).join("");
  const c = r.counts || {};
  return `<!DOCTYPE html><html lang="${L === "ms" ? "ms" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t("track.rec.title"))}: ${esc(r.name || "")}</title>
<style>
  *{box-sizing:border-box} body{margin:0;background:#f3f4f6;color:#0c1220;font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  main{max-width:820px;margin:24px auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px 36px}
  h1{font-size:22px;margin:0 0 2px} h2{font-size:15px;margin:24px 0 8px} .m{color:#687284;font-size:12.5px}
  .tag{display:inline-block;font-size:12px;font-weight:600;color:#8a5300;background:#fdf1d8;border-radius:6px;padding:1px 8px;margin-left:8px;vertical-align:middle}
  dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:16px 0 0} dt{color:#687284} dd{margin:0}
  .counts{display:flex;gap:28px;margin-top:16px} .counts b{display:block;font-size:22px;color:#2370d2}
  table{width:100%;border-collapse:collapse;font-size:13px} th{text-align:left;font-size:12px;color:#687284;font-weight:600;border-bottom:1px solid #d9dde3;padding:6px 8px}
  td{border-bottom:1px solid #e5e7eb;padding:8px;vertical-align:top} td:first-child{width:36%} td:nth-child(2){width:16%;white-space:nowrap}
  .v{font-size:11.5px;font-weight:600;color:#0b7a2b} a{color:#2370d2} ul{padding-left:18px;margin:0}
  .bar{max-width:820px;margin:16px auto 0;display:flex;justify-content:flex-end} button{font:inherit;font-weight:600;color:#fff;background:#2370d2;border:0;border-radius:999px;padding:8px 18px;cursor:pointer}
  @media print{body{background:#fff}.bar{display:none}main{border:0;margin:0;padding:0;max-width:none}a{color:inherit}}
  @media (max-width:600px){main{margin:0;border-radius:0;padding:20px 16px}td:first-child{width:auto}}
</style></head><body>
<div class="bar"><button type="button" onclick="window.print()">${esc(t("track.rec.print"))}</button></div>
<main>
  <h1>${esc(t("track.rec.title"))}${r.isSample ? `<span class="tag">${esc(t("src.sample"))}</span>` : ""}</h1>
  <div class="m">${esc(t("track.rec.asOf", { date: dd(r.asOf) }))}</div>
  <dl><dt>${esc(t("track.rec.name"))}</dt><dd>${esc(r.name || "")}</dd>
    <dt>${esc(t("track.rec.job"))}</dt><dd>${esc(r.currentJob?.title || "")}</dd>
    <dt>${esc(t("track.rec.goal"))}</dt><dd>${r.goal ? esc(t("track.rec.goalLine", { job: r.goal.title, date: dd(r.goal.setAt) })) : esc(t("track.rec.noGoal"))}</dd></dl>
  <div class="counts"><div><b>${esc(c.skills ?? 0)}</b><span class="m">${esc(t("track.rec.cSkills"))}</span></div><div><b>${esc(c.verified ?? 0)}</b><span class="m">${esc(t("track.rec.cVerified"))}</span></div><div><b>${esc(c.credentials ?? 0)}</b><span class="m">${esc(t("track.rec.cCreds"))}</span></div></div>
  <h2>${esc(t("track.rec.skills"))}</h2>
  ${rows ? `<table><thead><tr><th>${esc(t("track.rec.colSkill"))}</th><th>${esc(t("track.rec.colLevel"))}</th><th>${esc(t("track.rec.colWho"))}</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="m">${esc(t("track.rec.empty"))}</p>`}
  <h2>${esc(t("track.rec.sources"))}</h2>
  <ul class="m">${(r.sources || []).map(s => `<li>${link(s.url, s.label)}</li>`).join("")}</ul>
  <p class="m">${esc(t("track.rec.note"))}</p>
</main></body></html>`;
}

/** Open the record in a new window: your own profile from GET /profile/:id/record, the persona from this browser. */
export async function openRecord() {
  const w = window.open("", "_blank");
  if (!w) { toast({ title: t("track.rec.blocked") }); return; }
  w.document.write(`<!DOCTYPE html><title>${esc(t("track.rec.title"))}</title><p style="font:14px system-ui;padding:24px">${esc(t("track.rec.loading"))}</p>`);
  let r;
  if (onServer()) {
    try { r = await get(`/profile/${S.profile.id}/record`); }
    catch (e) { w.document.body.innerHTML = `<p style="font:14px system-ui;padding:24px">${esc(e.message)}</p>`; return; }
  } else r = localRecord();
  w.document.open(); w.document.write(recordHtml(r)); w.document.close();
}

/** For the drawer: the Prove block of a goal step, with its own heading. */
export function drawerProve(step) {
  return `<div class="sec gl-dprove"><h3><i data-lucide="badge-check"></i>${esc(t("track.proveSkill"))}</h3>${proveHtml(step)}</div>`;
}
