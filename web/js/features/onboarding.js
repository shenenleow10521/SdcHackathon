// First-use onboarding, wired to the intake agent:
// 1. Upload a CV / LinkedIn PDF, a scan, or up to 3 photos (POST /api/profile/intake, field "cv") or paste text (JSON { text }) → detected skills, scrubbed details, matching used.
//    Scans and photos are read by OCR on our server. If the server is unsure of the text ({ needsReview }), it lands in the paste box to check first.
// 2. The interviewer's follow-up questions (POST /api/profile/:id/answers).
// 3. Confirm levels on the 1–5 scale (PUT /api/profile/:id/skills) and set hours, target date and budget (PUT /api/profile/:id).
// "Use the sample persona" is always one click away. The shared sample persona is never changed on the server:
// edits to it stay in this browser.
import { S, actions, setProfileId, normaliseProfile, nameOf } from "../state.js";
import { upload, post, put } from "../api.js";
import { t, tOr } from "../i18n.js";
import { $, esc, icons, badge, store, reduce, toast, errorBox } from "../util.js";
import { intro as guideIntro } from "./guide.js";
import { intro as mapIntro } from "../graph3d.js";

const OB = { step: 0, mode: "upload", files: [], review: null, text: "", busy: false, stage: 0, err: null, intake: null, answers: {}, levels: {}, goals: {}, add: "" };
let stageTimer = null, lastFocus = null;
const STAGES = ["ob.stage1", "ob.stage2", "ob.stage3", "ob.stage4"];
const MAX_FILE = 5 * 1024 * 1024, MAX_PHOTOS = 3;
const isPdf = f => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name);
const isPhoto = f => /^image\/(jpeg|png)$/i.test(f.type) || /\.(jpe?g|png)$/i.test(f.name);
// The first stage reads "on our server" for photos, which go through OCR.
const stageText = i => t(i === 0 && OB.mode === "upload" && OB.files.some(isPhoto) ? "ob.stageOcr" : STAGES[i]);

export function openOnboarding(step = 0) {
  lastFocus = document.activeElement;
  if (step === 0) Object.assign(OB, { step: 0, files: [], review: null, text: "", busy: false, err: null, intake: null, answers: {} });
  else OB.step = step;
  seedLevels();
  $("ob").hidden = false;
  render();
  setTimeout(() => $("ob-card").querySelector("button, input, textarea, select")?.focus(), 30);
}

export function closeOnboarding() {
  $("ob").hidden = true;
  store.set("onboarded", true);
  clearInterval(stageTimer);
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  mapIntro();
  guideIntro();
}

function seedLevels() {
  const p = S.profile;
  OB.levels = Object.fromEntries((p?.skills || []).filter(s => s.level > 0).map(s => [s.skillId, s.level]));
  OB.conf = Object.fromEntries((p?.skills || []).map(s => [s.skillId, s.confidence]));
  OB.goals = { occupationId: p?.occupationId || "", hours: p?.hours || 6, targetDate: p?.targetDate || "", budgetRm: p?.budgetRm ?? "", displayName: p?.displayName || "" };
}

const confNote = c => `<span class="rn-src">${esc(t(c === "verified" ? "conf.verified" : c === "cv" ? "conf.cv" : "conf.self"))}</span>`;

function render() {
  const c = $("ob-card"), s = OB.step;
  const bars = `<div class="ob-steps" aria-hidden="true">${[0, 1, 2].map(i => `<i class="${i <= s ? "on" : ""}"></i>`).join("")}</div>`;
  let head = "", body = "", foot = "";
  if (s === 0) {
    head = `<div class="ob-kicker">${esc(t("ob.k1"))}</div><h2 id="ob-title">${esc(t("ob.h1"))}</h2><p>${esc(t("ob.p1"))}</p>`;
    body = OB.intake ? intakeSummary() : `
      <div class="seg" role="group" aria-label="${esc(t("ob.modeAria"))}"><button type="button" data-obmode="upload" aria-pressed="${OB.mode === "upload"}"><i data-lucide="upload"></i>${esc(t("ob.upload"))}</button><button type="button" data-obmode="paste" aria-pressed="${OB.mode === "paste"}"><i data-lucide="clipboard-paste"></i>${esc(t("ob.paste"))}</button></div>
      ${OB.mode === "upload" ? `<label class="drop" id="drop" for="cv-file"><span class="ic"><i data-lucide="upload"></i></span>
          <span><b>${esc(t("ob.dropTitle"))}</b><br><span class="note">${esc(t("ob.dropHint"))}</span></span>
          <input id="cv-file" type="file" accept="application/pdf,.pdf,image/jpeg,image/png,.jpg,.jpeg,.png" multiple class="sr">
          ${OB.files.length > 1 ? `<span class="fm">${esc(t("ob.filesN", { n: OB.files.length }))}</span>` : ""}
          ${OB.files.map(f => `<span class="file"><span class="fi"><i data-lucide="${isPhoto(f) ? "image" : "file-text"}"></i></span><span><span style="font-weight:600;font-size:13.5px">${esc(f.name)}</span><br><span class="fm">${Math.round(f.size / 1024)} KB</span></span><i data-lucide="check" style="color:var(--good)"></i></span>`).join("")}
        </label>
        <p class="note ob-scan-note"><i data-lucide="shield-check"></i>${esc(t("ob.scanPrivacy"))}</p>`
      : `${OB.review ? `<div class="ob-review" role="status"><b>${esc(t("ob.reviewTitle"))}</b><p class="note">${esc(t("ob.reviewNote", { n: OB.review.confidence }))}</p></div>` : ""}
         <label class="sr" for="cv-text">${esc(t("ob.pasteLabel"))}</label><textarea id="cv-text" class="textarea" rows="8" maxlength="30000" placeholder="${esc(t("ob.pastePh"))}">${esc(OB.text)}</textarea>
         <div class="rs">${esc(t("ob.chars", { n: OB.text.length }))}</div>`}
      ${OB.busy ? `<ul class="stages" role="status">${STAGES.map((k, i) => `<li class="${i < OB.stage ? "done" : i === OB.stage ? "on" : ""}">${i === OB.stage ? '<span class="spin"></span>' : `<i data-lucide="${i < OB.stage ? "circle-check" : "circle"}"></i>`}${esc(stageText(i))}</li>`).join("")}</ul>` : ""}
      ${OB.err ? errorBox(OB.err) : ""}`;
    const ready = OB.mode === "upload" ? OB.files.length > 0 : OB.text.trim().length >= 40;
    foot = `<span class="left"><i data-lucide="lock"></i>${esc(t("ob.private"))}</span>
      <div class="right">${OB.intake ? "" : `<button class="ghost" id="ob-sample" type="button">${esc(t("ob.skip"))}</button>`}
      ${OB.intake ? `<button class="btn btn-primary" id="ob-next" type="button">${esc(t("ob.continue"))}<i data-lucide="arrow-right"></i></button>`
        : `<button class="btn btn-primary" id="ob-read" type="button" ${!ready || OB.busy ? "disabled" : ""}><i data-lucide="sparkles"></i>${esc(OB.busy ? t("ob.reading") : t("ob.read"))}</button>`}</div>`;
  } else if (s === 1) {
    const qs = OB.intake?.questions || [];
    head = `<div class="ob-kicker">${esc(t("ob.k2"))}</div><h2 id="ob-title">${esc(qs.length ? t("ob.h2", { n: qs.length }) : t("ob.h2none"))}</h2><p>${esc(t("ob.p2"))}</p>`;
    body = qs.length ? qs.map(q => `<div class="q"><div class="q-msg"><span class="bot"><i data-lucide="bot"></i></span><div class="bubble">${esc(q.text)}</div></div>
      <div class="q-ans" role="group" aria-label="${esc(q.text)}">${(q.options || []).map(o => `<button type="button" data-q="${esc(q.id)}" data-a="${esc(o.value)}" aria-pressed="${String(OB.answers[q.id]) === String(o.value)}">${esc(o.label)}</button>`).join("")}</div></div>`).join("")
      : `<div class="empty">${esc(t("ob.noQuestions"))}</div>`;
    foot = `<button class="ghost" id="ob-back" type="button"><i data-lucide="arrow-left"></i>${esc(t("ob.back"))}</button>
      <button class="btn btn-primary" id="ob-next" type="button" ${OB.busy ? "disabled" : ""}>${OB.busy ? '<span class="spin"></span>' : ""}${esc(t("ob.continue"))}<i data-lucide="arrow-right"></i></button>`;
  } else {
    const ids = Object.keys(OB.levels);
    const options = Object.entries(S.graph.nodes).filter(([k, n]) => n.type === "skill" && !OB.levels[k]).sort((a, b) => a[1].name.localeCompare(b[1].name));
    const demo = !!S.profile?.isDemo || S.profileFallback;
    const jobs = Object.entries(S.graph.nodes).filter(([, n]) => n.type === "job").sort((a, b) => a[1].name.localeCompare(b[1].name));
    head = `<div class="ob-kicker">${esc(t("ob.k3"))}</div><h2 id="ob-title">${esc(t("ob.h3"))}</h2><p>${esc(t("ob.p3"))}</p>`;
    body = `${demo ? `<p class="note">${badge("b-warn", t("src.sample"))} ${esc(t("ob.demoLocal"))}</p>` : ""}
      <div class="rate">${ids.length ? ids.map(k => `<div class="rate-row"><div class="rn">${esc(nameOf(k))} ${confNote(OB.conf[k])}</div>
        <div class="lv" role="group" aria-label="${esc(t("ob.levelAria", { name: nameOf(k) }))}">${[1, 2, 3, 4, 5].map(i => `<button type="button" data-k="${esc(k)}" data-l="${i}" aria-pressed="${OB.levels[k] === i}" aria-label="${esc(t("ob.levelN", { n: i, d: t("level." + i) }))}">${i}</button>`).join("")}
        <button type="button" class="lv-x" data-k="${esc(k)}" data-l="0" aria-label="${esc(t("ob.remove", { name: nameOf(k) }))}"><i data-lucide="x"></i></button></div>
        <div class="rd">${esc(t("ob.levelLine", { n: OB.levels[k], d: t("level." + OB.levels[k]) }))}</div></div>`).join("") : `<div class="empty">${esc(t("ob.noSkills"))}</div>`}</div>
      <div class="add-skill"><label for="add-skill">${esc(t("ob.addSkill"))}</label><div class="row"><select id="add-skill" class="select"><option value="">${esc(t("ob.pickSkill"))}</option>${options.map(([k, n]) => `<option value="${esc(k)}">${esc(n.name)}</option>`).join("")}</select>
        <button class="btn btn-soft" type="button" id="add-skill-btn"><i data-lucide="plus"></i>${esc(t("ob.add"))}</button></div></div>
      <fieldset class="goals"><legend>${esc(t("ob.goals"))}</legend>
        <label class="goals-wide">${esc(t("ob.currentJob"))}<select id="g-job" class="select">${jobs.map(([k, n]) => `<option value="${esc(k)}" ${k === OB.goals.occupationId ? "selected" : ""}>${esc(n.name)}</option>`).join("")}</select></label>
        <label>${esc(t("ob.hours"))}<input id="g-hours" type="number" min="1" max="40" step="1" value="${esc(OB.goals.hours)}" inputmode="numeric"></label>
        <label>${esc(t("ob.target"))}<input id="g-target" type="date" value="${esc(OB.goals.targetDate || "")}"></label>
        <label>${esc(t("ob.budget"))}<input id="g-budget" type="number" min="0" step="50" value="${esc(OB.goals.budgetRm ?? "")}" inputmode="numeric" placeholder="${esc(t("ob.budgetPh"))}"></label>
        <p class="rs">${esc(t("ob.goalsHint"))}</p></fieldset>`;
    foot = `<button class="ghost" id="ob-back" type="button"><i data-lucide="arrow-left"></i>${esc(OB.intake ? t("ob.back") : t("common.cancel"))}</button>
      <button class="btn btn-primary" id="ob-finish" type="button" ${OB.busy ? "disabled" : ""}>${OB.busy ? '<span class="spin"></span>' : '<i data-lucide="sparkles"></i>'}${esc(t("ob.build"))}</button>`;
  }
  c.innerHTML = `<div class="ob-top">${bars}<button class="icon-btn ob-x" type="button" id="ob-close" aria-label="${esc(t("common.close"))}"><i data-lucide="x"></i></button><div>${head}</div></div><div class="ob-body">${body}</div><div class="ob-foot">${foot}</div>`;
  icons();
  bind(c);
}

// ESCO skills (of 13,939) found in the CV. Skills shown in use are saved to the profile; skills only listed are not.
function escoSummary(list) {
  if (!list.length) return "";
  const used = list.filter(e => e.shownInUse), listed = list.filter(e => !e.shownInUse);
  const chip = (e, note) => `<span class="chip" title="${esc(e.phrase || "")}">${esc(e.title)}${note ? `<span class="chip-note">${esc(note)}</span>` : ""}</span>`;
  return `<p class="ob-esco-h">${esc(t("ob.escoTitle", { n: used.length }))}</p>
    <div class="chips">${used.slice(0, 16).map(e => chip(e)).join("")}${listed.slice(0, 6).map(e => chip(e, t("ob.escoListed"))).join("")}</div>`;
}

function intakeSummary() {
  const r = OB.intake, d = r.draft || {}, occ = d.occupation, skills = d.skills || [], un = d.unmatched || [], pr = r.providers || {};
  const removed = r.scrubbed?.removed || [];
  const llmOk = pr.llm === true || (typeof pr.llm === "string" && !/^(unavailable|none|off|false)$/i.test(pr.llm));
  return `<ul class="found-list">
      ${occ ? `<li><i data-lucide="circle-check"></i><span>${esc(t("ob.occ", { title: occ.title || nameOf(occ.id) }))}${occ.confidence == null ? "" : ` <span class="found-sub">(${esc(typeof occ.confidence === "number" ? t("ob.conf", { n: Math.round(occ.confidence * (occ.confidence <= 1 ? 100 : 1)) }) : tOr("ob.confLevel." + occ.confidence, occ.confidence))})</span>`}</span></li>` : ""}
      ${r.ocr ? `<li><i data-lucide="scan-text"></i><span>${esc(t("ob.ocrRead", { n: r.ocr.confidence }))}${r.ocr.pagesTotal > r.ocr.pagesRead ? ` ${esc(t("ob.ocrPages", { n: r.ocr.pagesRead, m: r.ocr.pagesTotal }))}` : ""}</span></li>` : ""}
      <li><i data-lucide="circle-check"></i><span>${esc(un.length ? t("ob.skillsFound", { n: skills.length, m: un.length }) : t("ob.skillsFoundAll", { n: skills.length }))}</span></li>
      ${removed.length ? `<li><i data-lucide="shield-check"></i><span>${esc(t("ob.scrubbed", { list: [...new Set(removed)].map(k => tOr("pii." + k, k)).join(", ") }))}</span></li>` : `<li><i data-lucide="shield-check"></i><span>${esc(t("ob.scrubbedNone"))}</span></li>`}
      ${(r.questions || []).length ? `<li class="warn"><i data-lucide="circle-help"></i><span>${esc(t("ob.unclear", { n: r.questions.length }))}</span></li>` : ""}
    </ul>
    ${skills.length ? `<p class="ob-esco-h">${esc(t("ob.cvFound"))}</p>` : ""}
    <div class="chips">${skills.slice(0, 14).map(s => `<span class="chip">${esc(s.label || nameOf(s.skillId))}</span>`).join("")}</div>
    ${escoSummary(d.escoSkills || [])}
    ${un.length ? `<p class="note">${esc(t("ob.unmatched", { list: un.slice(0, 6).join(", ") }))}</p>` : ""}
    ${!llmOk ? `<p class="note">${esc(t("ob.aiOff"))}</p>` : pr.matching !== "semantic" ? `<p class="note">${esc(t("ob.basic"))}</p>` : ""}`;
}

function bind(c) {
  c.querySelector("#ob-close").addEventListener("click", closeOnboarding);
  c.querySelectorAll("[data-obmode]").forEach(b => b.addEventListener("click", () => { OB.mode = b.dataset.obmode; OB.err = null; if (OB.mode === "upload") OB.review = null; render(); }));
  const f = c.querySelector("#cv-file");
  if (f) f.addEventListener("change", () => pickFiles(f.files));
  const drop = c.querySelector("#drop");
  if (drop) {
    ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", e => pickFiles(e.dataTransfer?.files));
  }
  const ta = c.querySelector("#cv-text");
  if (ta) ta.addEventListener("input", () => {
    OB.text = ta.value;
    const rd = c.querySelector("#ob-read"); if (rd) rd.disabled = OB.text.trim().length < 40;
    const ch = ta.nextElementSibling; if (ch) ch.textContent = t("ob.chars", { n: OB.text.length });
  });
  const sample = c.querySelector("#ob-sample"); if (sample) sample.addEventListener("click", useSample);
  const rd = c.querySelector("#ob-read"); if (rd) rd.addEventListener("click", readProfile);
  const back = c.querySelector("#ob-back"); if (back) back.addEventListener("click", () => { if (!OB.intake && OB.step === 2) { closeOnboarding(); return; } OB.step--; render(); });
  const next = c.querySelector("#ob-next"); if (next) next.addEventListener("click", nextStep);
  c.querySelectorAll("[data-q]").forEach(b => b.addEventListener("click", () => { OB.answers[b.dataset.q] = b.dataset.a; render(); }));
  c.querySelectorAll("[data-k]").forEach(b => b.addEventListener("click", () => {
    const l = +b.dataset.l;
    if (l === 0) delete OB.levels[b.dataset.k]; else { OB.levels[b.dataset.k] = l; if (OB.conf[b.dataset.k] !== "verified") OB.conf[b.dataset.k] = "self"; }
    OB.dirty = true; keepGoals(c); render();
  }));
  const ab = c.querySelector("#add-skill-btn");
  if (ab) ab.addEventListener("click", () => { const v = c.querySelector("#add-skill").value; if (!v) return; OB.levels[v] = 2; OB.conf[v] = "self"; keepGoals(c); render(); });
  const fin = c.querySelector("#ob-finish"); if (fin) fin.addEventListener("click", () => finish(c));
}

function keepGoals(c) {
  const h = c.querySelector("#g-hours"); if (!h) return;
  OB.goals.hours = h.value; OB.goals.occupationId = c.querySelector("#g-job")?.value || OB.goals.occupationId; OB.goals.targetDate = c.querySelector("#g-target").value; OB.goals.budgetRm = c.querySelector("#g-budget").value;
}

// One PDF, or up to 3 photos (one per page, in the order chosen).
function pickFiles(list) {
  const files = [...(list || [])];
  if (!files.length) return;
  OB.err = null; OB.files = [];
  if (!files.every(f => isPdf(f) || isPhoto(f))) OB.err = { message: t("ob.notPdf") };
  else if (files.some(f => f.size > MAX_FILE)) OB.err = { message: t("ob.tooBig") };
  else if ((files.some(isPdf) && files.length > 1) || files.length > MAX_PHOTOS) OB.err = { message: t("ob.tooMany") };
  else OB.files = files;
  render();
}

async function readProfile() {
  if (OB.busy) return;
  OB.busy = true; OB.err = null; OB.stage = 0; render();
  clearInterval(stageTimer);
  stageTimer = setInterval(() => { if (OB.stage < STAGES.length - 1) { OB.stage++; if (OB.step === 0 && OB.busy) render(); } }, reduce ? 1500 : 2200);
  try {
    let res;
    if (OB.mode === "upload") { const fd = new FormData(); OB.files.forEach(f => fd.append("cv", f)); res = await upload("/profile/intake", fd, { timeout: 120000 }); }
    else res = await post("/profile/intake", { text: OB.text.trim() }, { timeout: 120000 });
    if (res.needsReview) {
      // The server wasn't sure of the scan's text: show it in the paste box to check. Nothing was saved or sent to an AI.
      Object.assign(OB, { mode: "paste", text: res.text || "", review: res.ocr || { confidence: 0 }, files: [] });
      clearInterval(stageTimer); OB.busy = false; render();
      setTimeout(() => $("ob-card").querySelector("#cv-text")?.focus(), 30);
      return;
    }
    OB.review = null;
    OB.intake = res;
    if (res.profileId) setProfileId(res.profileId);
    if (res.profile) { S.profile = normaliseProfile(res.profile); S.profileFallback = false; }
    seedLevels();
    const draft = res.draft?.skills || [];
    draft.forEach(s => { if (!OB.conf[s.skillId]) OB.conf[s.skillId] = "cv"; });
    OB.answers = {};
  } catch (e) {
    OB.err = e.notAvailable ? { message: t("ob.intakeNA") } : e;
  }
  clearInterval(stageTimer);
  OB.busy = false; render();
  if (OB.intake && !reduce && globalThis.gsap) globalThis.gsap.from(".found-list li", { opacity: 0, x: -6, stagger: 0.12, duration: 0.3, ease: "power3.out" });
}

async function nextStep() {
  if (OB.step === 0) { OB.step = (OB.intake?.questions || []).length ? 1 : 2; render(); return; }
  if (OB.step === 1) {
    // Send each answer with the option's original value type (number, boolean or string).
    const qs = OB.intake?.questions || [];
    const answers = Object.fromEntries(Object.entries(OB.answers).map(([k, v]) => {
      const opt = qs.find(q => String(q.id) === k)?.options?.find(o => String(o.value) === v);
      return [k, opt ? opt.value : v];
    }));
    if (Object.keys(answers).length && OB.intake?.profileId) {
      OB.busy = true; render();
      try {
        const res = await post(`/profile/${OB.intake.profileId}/answers`, { answers });
        if (res.profile) { S.profile = normaliseProfile(res.profile); seedLevels(); }
      } catch (e) { toast({ title: t("ob.answersFailed"), detail: e.notAvailable ? t("state.notAvailable") : e.message, badgeHtml: badge("b-warn", t("state.error")) }); }
      OB.busy = false;
    }
    OB.step = 2; render();
  }
}

async function useSample() {
  setProfileId(1);
  closeOnboarding();
  await actions.loadProfile?.(1);
  toast({ title: t("ob.sampleToast"), detail: t("ob.sampleBody"), badgeHtml: badge("b-warn", t("src.sample")) });
}

async function finish(c) {
  keepGoals(c);
  const hours = Math.max(1, Math.min(40, Math.round(Number(OB.goals.hours) || 6)));
  const budget = OB.goals.budgetRm === "" || OB.goals.budgetRm == null ? null : Math.max(0, Number(OB.goals.budgetRm) || 0);
  const target = OB.goals.targetDate || null;
  const occupationId = OB.goals.occupationId || null;
  const p = S.profile;
  const before = Object.fromEntries((p.skills || []).map(s => [s.skillId, s.level]));
  const changes = [...new Set([...Object.keys(before), ...Object.keys(OB.levels)])]
    .map(k => ({ skillId: k, level: OB.levels[k] || 0 })).filter(x => (before[x.skillId] || 0) !== x.level);
  const demo = !!p.isDemo || S.profileFallback;
  const local = () => {
    const skills = Object.entries(OB.levels).map(([skillId, level]) => ({ skillId, level, confidence: OB.conf[skillId] || "self", evidence: null }));
    return normaliseProfile({ ...p, skills, level: undefined, hours, budgetRm: budget, targetDate: target, ...(occupationId ? { occupationId } : {}) });
  };
  if (demo) {
    actions.profileUpdated(local(), { localOnly: true });
    closeOnboarding(); done(); return;
  }
  OB.busy = true; render();
  let prof = null;
  try {
    if (changes.length) prof = (await put(`/profile/${p.id}/skills`, { skills: changes })).profile;
    prof = (await put(`/profile/${p.id}`, { hours, budgetRm: budget, targetDate: target, ...(occupationId && occupationId !== p.occupationId ? { occupationId } : {}) })).profile || prof;
  } catch (e) {
    toast({ title: t("ob.saveFailed"), detail: e.notAvailable ? t("ob.savedLocal") : e.message, badgeHtml: badge("b-warn", t("state.error")) });
    prof = null;
  }
  OB.busy = false;
  actions.profileUpdated(prof ? normaliseProfile(prof) : local(), { localOnly: !prof });
  closeOnboarding(); done();
}

function done() {
  const top = actions.topJob?.();
  toast({ title: t("ob.readyToast"), detail: top ? t("ob.readyBody", { job: nameOf(top.job), n: top.match, count: top.count }) : "", badgeHtml: badge("b-good", t("ob.ready")) });
}

export function initOnboarding() {
  $("ob").addEventListener("keydown", e => {
    if (e.key === "Escape") { e.preventDefault(); closeOnboarding(); return; }
    if (e.key !== "Tab") return;
    const f = [...$("ob-card").querySelectorAll("button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter(x => x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });
}

