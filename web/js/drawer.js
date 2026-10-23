// Detail drawer for a job, a skill or you. Jobs add: employer picker with per-employer match and extra stops,
// "Studies disagree" (GET /api/studies), requirements, SDG links. Skills add: tasks (human edge), Learn → Practice → Prove,
// emerging-skill evidence and the 5-minute check (GET/POST /api/skills/:id/check).
import { S, UI, D, N, nameOf, W, matchOf, humanSplit, kindOf, confOf, actions, profileId } from "./state.js";
import { get, post } from "./api.js";
import { t } from "./i18n.js";
import { $, esc, icons, badge, srcBadge, errorBox, loadingBox, extLink, sign, toast, bindRetry, pct, rm } from "./util.js";
import { howLink } from "./features/why.js";
import { skillBlock, loadSkillExposure } from "./features/exposure.js";
import { splitBar } from "./panels/skills.js";
import * as G from "./graph3d.js";
import { HAVE_LEVEL } from "/shared/engine.js";

let lastFocus = null;
const cache = { employers: null, employersErr: null, studies: {}, empMatch: {} };

export function openDrawer(id, quiet) {
  if (!N(id)) return;
  if (!quiet) lastFocus = document.activeElement;
  UI.drawer = id;
  const d = $("drawer"), k = kindOf(id);
  d.innerHTML = k === "job" ? jobDetail(id) : k === "you" ? youDetail(id) : skillDetail(id);
  d.classList.add("open");
  d.setAttribute("aria-label", t("drawer.aria", { name: nameOf(id) }));
  if (!quiet) d.scrollTop = 0;
  d.querySelector("#dr-close").addEventListener("click", closeDrawer);
  d.querySelectorAll("[data-skill]").forEach(b => b.addEventListener("click", () => openDrawer(b.dataset.skill)));
  d.querySelectorAll("[role=button][data-skill]").forEach(b => b.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDrawer(b.dataset.skill); } }));
  const sp = d.querySelector("#show-path"); if (sp) sp.addEventListener("click", () => { actions.showPath(id); closeDrawer(); });
  const pv = d.querySelector("#prove"); if (pv) pv.addEventListener("click", () => startCheck(id));
  const ed = d.querySelector("#edit-profile"); if (ed) ed.addEventListener("click", () => actions.openOnboarding?.(2));
  icons();
  if (k === "job") { loadEmployers(id); loadStudies(id); }
  else if (k === "have" || k === "learn") loadSkillExposure(id);
  if (!quiet) { G.focusNode(id); d.querySelector("#dr-close").focus({ preventScroll: true }); }
}

export function closeDrawer() {
  if (!UI.drawer) return;
  UI.drawer = null;
  $("drawer").classList.remove("open");
  G.resetView(true);
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
}

/** Re-render the open drawer in place (after a data change), keeping scroll. */
export function refreshDrawer() {
  const d = $("drawer");
  if (!UI.drawer || !d.classList.contains("open")) return;
  if (!N(UI.drawer)) { closeDrawer(); return; }
  if (d.querySelector(".check-form")) return; // don't wipe a check in progress
  const st = d.scrollTop; openDrawer(UI.drawer, true); d.scrollTop = st;
}

function drHead(kind, icon, title, sub = "") {
  return `<div class="dr-head"><div><div class="dr-kind"><i data-lucide="${icon}"></i>${esc(kind)}</div><h2>${esc(title)}</h2>${sub}</div>
    <button class="icon-btn" id="dr-close" type="button" aria-label="${esc(t("drawer.close"))}"><i data-lucide="x"></i></button></div>`;
}

/** Who does the work, then exposure and demand in one line with the section's single "How is this worked out?" link. */
function splitBlock(id) {
  const E = S.E;
  return `<div class="sec"><h3><i data-lucide="pie-chart"></i>${esc(t("drawer.whoWork", { year: S.year }))}</h3>${splitBar(id, "job")}
    <p class="note" style="margin-top:8px">${esc(t("drawer.expLine", { e: Math.round(E.exposure(id) * 100), d: sign(E.demand(id)), year: S.year }))}</p>
    <div class="dr-meta">${howLink("exposure", id)}</div></div>`;
}

function sdgRows(list) {
  const sd = S.graph.sdgs || {};
  return list.filter(x => Array.isArray(x)).map(([n, r]) => `<div class="sdg"><b style="background:${esc(sd[n]?.color || "#687284")}">${esc(n)}</b><span><strong>${esc(sd[n]?.name || "SDG " + n)}.</strong> ${esc(r)}</span></div>`).join("");
}

// ---------- job ----------
/** What employers ask for: requirement rows with your coverage, then where the list comes from. */
export function jobAsks(j) {
  const E = S.E, n = N(j), extra = j === UI.job ? UI.employerReq : [];
  const reqSrc = [...new Set((S.graph.req[j] || []).map(r => r.source || "sample"))];
  const sample = reqSrc.includes("sample");
  // A skill counts as yours at level 3 for every job, so rows say how much the job leans on it, not a level.
  // Requirements an employer entered keep that employer's own level.
  // Catalogue rows say what ESCO lists for the job (r.esco, computed on the server); README explains the labels and weights.
  const label = r => r.status === "employer" ? (r.need ? t("req.employerLvl", { n: r.need }) : t("req.employerAsks"))
    : r.esco ? t("req.esco." + r.esco) : t({ essential: "req.essential", emerging: "req.new" }[r.status] || "req.optional");
  const rows = [...(S.graph.req[j] || []), ...extra.map(r => ({ ...r, status: "employer" }))].map(r => {
    const cov = E.coverage(r.skill, r.need);
    const ci = cov >= 1 ? ["full", "check", t("cov.full")] : cov > 0 ? ["part", "minus", t("cov.part")] : ["none", "plus", t("cov.none")];
    // Share of postings only when it comes from real postings; sample shares are not shown.
    const share = r.share == null || isSample(r.source) ? "" : `<span class="num">${esc(r.share)}%</span><div class="rs">${esc(t("req.ofPostings"))}</div>`;
    return `<div class="req-row" data-skill="${esc(r.skill)}" role="button" tabindex="0"><div><div class="rn">${esc(nameOf(r.skill))}</div><div class="rs">${esc(label(r))}</div></div>
      <div class="share">${share}</div><span class="cov ${ci[0]}" role="img" aria-label="${esc(ci[2])}"><i data-lucide="${ci[1]}"></i></span></div>`;
  }).join("");
  return `<div class="req">${rows || `<div class="empty">${esc(t("drawer.noReq"))}</div>`}</div>
      <p class="src" style="margin-top:8px">${sample ? esc(t("drawer.reqSample")) : `${esc(t("drawer.reqSrc", { n: n.postings ?? "–" }))} ${reqSrc.map(s => srcBadge(s)).join(" ")}`}</p>`;
}

const hasReq = j => (S.graph.req[j] || []).length > 0 || (j === UI.job && (UI.employerReq || []).length > 0);
/** Live job searches for a job title on Malaysia's official portal (PERKESO MYFutureJobs) and JobStreet. */
export function openingsHtml(title) {
  const q = String(title || "").trim(); if (!q) return "";
  const slug = q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `<p class="openings"><span>${esc(t("jobs.findOpenings"))}</span>${extLink(`https://candidates.myfuturejobs.gov.my/search-jobs?what=${encodeURIComponent(q)}`, "MYFutureJobs")}${extLink(`https://my.jobstreet.com/${slug}-jobs`, "JobStreet")}</p>`;
}

export const isSample = s => !s || ["sample", "seed"].includes(String(s).toLowerCase());

/** A course's format, length and price as plain sentences, e.g. "Online course, 18 hours. Paid; may be claimable from HRD Corp." */
const FMT = { "online course": "online", workshop: "workshop", "self-paced module": "module", "instructor-led": "led", "video course": "video" };
export function courseMeta(co) {
  const f = FMT[String(co.format || "").toLowerCase()], fmt = f ? t("course.fmt." + f) : co.format || "";
  const txt = co.formatText || "";
  const len = !fmt ? "" : co.hours ? t(co.hours === 1 ? "course.fmtH1" : "course.fmtH", { format: fmt, h: co.hours }) : t("course.fmtOnly", { format: fmt });
  const price = co.costRm === 0 ? t("course.free") : co.costRm > 0 ? t("course.cost", { rm: rm(co.costRm) })
    : /\bfree\b/i.test(txt) ? t("course.free") : /\bpaid\b/i.test(txt) ? t("course.paid") : "";
  const cost = price ? t(co.hrdClaimable ? "course.priceHrd" : "course.price", { price }) : co.hrdClaimable ? t("course.hrd") : "";
  return [len, cost].filter(Boolean).join(" ");
}

function jobDetail(j) {
  const E = S.E, n = N(j), m = matchOf(j), p = D.plans[j] || E.planFor(j, UI.mode, j === UI.job ? UI.employerReq : []);
  return `${drHead(t("drawer.job"), "briefcase", n.name, `<p class="dr-sub">${esc(n.stay ? t("jobs.stay") : t("jobs.change"))}</p>`)}
    <div class="sec"><div class="big-row"><div><div class="big-pct num">${m}%</div><div class="note">${esc(UI.employer && j === UI.job ? t("drawer.matchAt", { name: UI.employer.name }) : t("drawer.matchToday"))}</div></div>
      <div style="text-align:right"><div class="num big-wk">${p.route ? W(p.ready) : "–"} ${esc(t("common.wk"))}</div><div class="note">${esc(t("drawer.toReady"))}</div></div></div>
      <div class="dr-meta">${howLink("match", j)}${isSample(n.outlookSource) ? `<span class="src">${esc(t("drawer.sampleNote"))}</span>` : ""}</div></div>
    ${n.blurb ? `<p class="note">${esc(n.blurb)}</p>` : ""}
    ${openingsHtml(n.name)}
    ${splitBlock(j)}
    <div class="sec" id="emp-sec"><h3><i data-lucide="building-2"></i>${esc(t("emp.title"))}</h3><div id="emp-box">${loadingBox()}</div></div>
    ${hasReq(j) ? `<div class="sec"><h3><i data-lucide="list-checks"></i>${esc(t("drawer.asks"))}</h3>${jobAsks(j)}</div>` : ""}
    <div class="sec" id="studies-sec"><h3><i data-lucide="scale"></i>${esc(t("studies.title"))}</h3><div id="studies-box">${loadingBox()}</div></div>
    ${Array.isArray(n.sdg) && n.sdg.length ? `<div class="sec"><h3><i data-lucide="globe"></i>${esc(t("drawer.sdg"))}</h3><div style="display:grid;gap:8px">${sdgRows(n.sdg)}</div></div>` : ""}
    <button class="btn btn-primary" id="show-path" type="button"><i data-lucide="route"></i>${esc(t("drawer.showPath"))}</button>`;
}

// employers for this job
async function loadEmployers(j) {
  if (!cache.employers && !cache.employersErr) {
    // hide test rows left by smoke tests (same rule as isTestEmployer in features/views.js, which imports this file)
    try { cache.employers = ((await get("/employers")).employers || []).filter(e => !/\(test\)\s*$|smoke test/i.test(e?.name || "")); }
    catch (e) { cache.employersErr = e; }
  }
  renderEmployers(j);
}
export function forgetEmployers() { cache.employers = null; cache.employersErr = null; cache.empMatch = {}; }

function renderEmployers(j) {
  const box = document.getElementById("emp-box"); if (!box || UI.drawer !== j) return;
  if (cache.employersErr) { box.innerHTML = errorBox(cache.employersErr, "emp"); bindRetry(box, { emp: () => { cache.employersErr = null; box.innerHTML = loadingBox(); loadEmployers(j); } }); icons(); return; }
  const list = (cache.employers || []).filter(e => !Array.isArray(e.jobs) || !e.jobs.length || e.jobs.includes(j));
  if (!list.length) { document.getElementById("emp-sec")?.remove(); return; } // nothing to pick: no empty section
  const cur = UI.job === j && UI.employer ? String(UI.employer.id) : "";
  box.innerHTML = `<label class="sr" for="emp-sel">${esc(t("emp.pick"))}</label>
    <select id="emp-sel" class="select"><option value="">${esc(t("emp.catalogue"))}</option>${list.map(e => `<option value="${esc(e.id)}" ${cur === String(e.id) ? "selected" : ""}>${esc(e.isSample || e.source === "sample" ? t("emp.sampleOpt", { name: e.name }) : e.name)}</option>`).join("")}</select>
    <div id="emp-match"></div>`;
  box.querySelector("#emp-sel").addEventListener("change", async ev => {
    const id = ev.target.value;
    const e = list.find(x => String(x.id) === id) || null;
    await actions.setEmployer(e ? { id: e.id, name: e.name, source: e.source } : null, j);
  });
  if (cur) renderEmpMatch(j, list.find(e => String(e.id) === cur));
}

async function renderEmpMatch(j, e) {
  const box = document.getElementById("emp-match"); if (!box || !e) return;
  const key = [e.id, j, UI.mode, S.year, S.scenario, S.graph.kbVersion].join("|");
  box.innerHTML = loadingBox(t("emp.matching"));
  let res = cache.empMatch[key];
  if (!res) {
    try { res = await get(`/employers/${e.id}/match`, { profile: profileId(), job: j, mode: UI.mode, year: S.year, scenario: S.scenario }); cache.empMatch[key] = res; }
    catch (err) { if (document.getElementById("emp-match") === box) { box.innerHTML = errorBox(err); icons(); } return; }
  }
  if (document.getElementById("emp-match") !== box) return;
  const stops = res.extraStops || [];
  box.innerHTML = `<div class="emp-cmp">
      <div><div class="k">${esc(t("emp.atLabel", { name: e.name }))}</div><div class="v num">${esc(res.match)}%</div></div>
      <div><div class="k">${esc(t("emp.catLabel"))}</div><div class="v num">${esc(res.matchCatalogue)}%</div></div></div>
    ${stops.length ? `<div class="sub-h"><i data-lucide="map-pin-plus"></i>${esc(t("emp.stops"))}</div><div class="chips">${stops.map(s => `<button class="chip" type="button" data-skill="${esc(s)}"><i data-lucide="plus"></i>${esc(nameOf(s))}</button>`).join("")}</div>` : `<p class="note">${esc(t("emp.noStops"))}</p>`}
    <p class="src">${esc(t(e.verified ? "emp.provVerified" : "emp.provUnverified"))}${isSample(e.source) ? " " + esc(t("emp.provSample")) : ""}</p>`;
  box.querySelectorAll("[data-skill]").forEach(b => b.addEventListener("click", () => openDrawer(b.dataset.skill)));
  icons();
}

// studies disagree
async function loadStudies(j) {
  const box = () => (UI.drawer === j ? document.getElementById("studies-box") : null);
  let res = cache.studies[j];
  if (!res) {
    try { res = await get("/studies", { job: j }); cache.studies[j] = res; }
    catch (e) {
      const b = box(); if (!b) return;
      b.innerHTML = errorBox(e, "studies"); bindRetry(b, { studies: () => { b.innerHTML = loadingBox(); loadStudies(j); } }); icons(); return;
    }
  }
  const b = box(); if (!b) return;
  const studies = res.studies || [];
  if (!studies.length) { document.getElementById("studies-sec")?.remove(); return; } // no studies: no empty section
  // One row per study: name and estimate up front, method notes and the source one click away.
  b.innerHTML = `<p class="note">${esc(res.disagree ? t("studies.disagreeLine", { n: Math.round((res.spread || 0) * 100) }) : t("studies.agreeLine"))}</p>
    <div class="studies">${studies.map(s => {
      const raw = s.rawValue != null && String(s.rawValue) !== String(s.value) ? `<div class="rs">${esc(t("studies.raw", { v: s.rawValue }))}</div>` : "";
      const more = raw || s.note || s.sourceUrl;
      const head = `<span class="k">${esc(s.study)}</span><span class="v num">${s.value == null ? "–" : pct(s.value)}</span>`;
      return more ? `<details class="study"><summary>${head}</summary><div class="study-more">${raw}${s.note ? `<div class="rs">${esc(s.note)}</div>` : ""}${s.sourceUrl ? `<div class="rs">${extLink(s.sourceUrl, t("studies.source"))}</div>` : ""}</div></details>`
        : `<div class="study"><div class="study-row">${head}</div></div>`;
    }).join("")}</div>
    <p class="src">${esc(t("studies.note"))}${studies.some(s => isSample(s.source)) ? " " + esc(t("studies.sampleNote")) : ""}</p>`;
  icons();
}

// ---------- you ----------
function youDetail(id) {
  const p = S.profile;
  return `${drHead(t("drawer.you"), "user-round", nameOf(id))}
    ${splitBlock(id)}
    <p class="note">${esc(t("drawer.youNote"))}</p>
    ${isSample(N(id).outlookSource) ? `<p class="src">${esc(t("drawer.sampleNote"))}</p>` : ""}
    <div class="sec"><h3><i data-lucide="user-cog"></i>${esc(t("drawer.profile"))}</h3>
      <dl class="kv"><dt>${esc(t("ob.name"))}</dt><dd>${esc(p.displayName)}</dd><dt>${esc(t("ob.hours"))}</dt><dd class="num">${esc(p.hours)} h</dd>
      <dt>${esc(t("ob.target"))}</dt><dd>${esc(p.targetDate || "–")}</dd><dt>${esc(t("ob.budget"))}</dt><dd class="num">${p.budgetRm != null ? "RM " + esc(p.budgetRm) : "–"}</dd></dl>
      <button class="btn btn-soft" id="edit-profile" type="button" style="width:100%;margin-top:8px"><i data-lucide="sliders-horizontal"></i>${esc(t("skills.edit"))}</button></div>`;
}

// ---------- skill ----------
function skillDetail(k) {
  const E = S.E, n = N(k), have = E.owned(k), im = E.impact(k);
  const needs = UI.ring.filter(j => (S.graph.req[j] || []).some(r => r.skill === k));
  const evoOut = S.graph.edges.filter(e => e.from === k && e.kind === "evolve"), evoIn = S.graph.edges.filter(e => e.to === k && e.kind === "evolve");
  const buildsOn = S.graph.edges.filter(e => e.to === k && e.kind === "build" && N(e.from)?.type === "skill");
  const course = (S.graph.courses?.[k] || [])[0];
  const em = n.emerging;
  const th = S.graph.thresholds || { postings: 15, employers: 5, weeks: 4 };
  const verified = confOf(k) === "verified", lvl = have ? E.lvl(k) : 0;
  // Head: what is happening to this skill, and whether you proved it. Provenance sits in the footer note.
  const sub = `<p class="dr-sub"><span class="tone-${esc(im.tone)}">${esc(t("impact." + im.label))}</span>${verified ? `<span class="dr-verified"><i data-lucide="badge-check"></i>${esc(t("conf.verified"))}</span>` : ""}</p>`;
  const thresholdRows = em ? [["skill.th.postings", em.postings, th.postings], ["skill.th.employers", em.employers, th.employers], ["skill.th.weeks", em.weeks, th.weeks]]
    .map(([l, v, tv]) => `<li><i data-lucide="${v >= tv ? "circle-check" : "circle-x"}" style="color:${v >= tv ? "var(--good)" : "var(--crit)"}"></i><span>${esc(t(l))}</span><b class="num">${esc(v ?? "–")}</b><span class="rs">${esc(t("skill.th.need", { n: tv }))}</span></li>`).join("") : "";
  const emgSec = em ? `<div class="sec"><h3><i data-lucide="sparkles"></i>${esc(t("skill.whyNew"))}</h3><ul class="checks">${thresholdRows}</ul>
    <p class="src" style="margin-top:8px">${esc(em.status === "confirmed" ? t("skill.fullWeight") : t("skill.halfWeight"))}${Array.isArray(em.synonyms) && em.synonyms.length ? " " + esc(t("skill.merged", { list: em.synonyms.join(", ") })) : ""}</p></div>` : "";
  // One 5-step scale: your level filled, a mark where a skill counts as yours (level 3); each step's meaning on hover or focus.
  const levels = `<div class="sec"><h3><i data-lucide="gauge"></i>${esc(have ? t("skill.yourLevel") : t("skill.levels"))}<span class="scale-n">${esc(lvl ? t("skill.scaleOf", { n: lvl }) : t("skill.scaleNew"))}</span></h3>
    <ol class="scale">${[1, 2, 3, 4, 5].map(i => `<li class="st${i <= lvl ? " on" : ""}${i === lvl ? " cur" : ""}${i === HAVE_LEVEL ? " own" : ""}" tabindex="0" data-tip="${esc(t("level." + i))}" aria-label="${esc(t("skill.scaleAria", { n: i, desc: t("level." + i) }))}"${i === lvl ? ` aria-current="true"` : ""}><i></i><span>${i}</span></li>`).join("")}
      <li class="scale-own" style="grid-column:${HAVE_LEVEL} / -1" aria-hidden="true">${esc(t("skill.countsAt"))}</li></ol></div>`;
  const fold = (icon, title, body) => `<details class="sec dsec"><summary><span><i data-lucide="${icon}"></i>${esc(title)}</span><i class="chev" data-lucide="chevron-down"></i></summary>${body}</details>`;
  const tasks = Array.isArray(n.tasks) && n.tasks.length ? fold("list", t("skill.tasks"), `<ul class="tasks">${n.tasks.map(x => `<li><span>${esc(x.text)}</span><span class="task-mode ${x.mode === "ai" ? "ai" : ""}">${esc(t(x.mode === "ai" ? "split.ai" : x.mode === "assist" ? "split.assist" : "split.youShort"))}</span></li>`).join("")}</ul>`) : "";
  const links = [
    ...evoOut.map(e => `<button class="chip" type="button" data-skill="${esc(e.to)}"><i data-lucide="refresh-cw" style="color:var(--violet)"></i>${esc(t("skill.evolvesInto", { name: nameOf(e.to) }))}</button>`),
    ...evoIn.map(e => `<button class="chip" type="button" data-skill="${esc(e.from)}"><i data-lucide="refresh-cw" style="color:var(--violet)"></i>${esc(t("skill.newVersionOf", { name: nameOf(e.from) }))}</button>`),
    ...buildsOn.map(e => `<button class="chip" type="button" data-skill="${esc(e.from)}"><i data-lucide="corner-down-right"></i>${esc(t("skill.buildsOn", { name: nameOf(e.from) }))}</button>`),
    ...needs.map(j => `<button class="chip" type="button" data-skill="${esc(j)}"><i data-lucide="briefcase"></i>${esc(nameOf(j))}</button>`),
  ].join("");
  const step = course && lvl < HAVE_LEVEL ? fold("footprints", have ? t("skill.nextLevel") : t("skill.howBuild"), `<div class="lpp">
      <div class="lpp-item"><span class="ic" style="background:var(--accent-wash);color:var(--accent)"><i data-lucide="book-open"></i></span><div><div class="k">${esc(t("lpp.learn"))}</div><div class="v">${course.url ? extLink(course.url, course.title) : esc(course.title)}</div>${courseMeta(course) ? `<div class="m">${esc(courseMeta(course))}</div>` : ""}${course.provider ? `<div class="m">${esc(t("next.by", { provider: course.provider }))}</div>` : ""}</div></div>
      ${course.practice ? `<div class="lpp-item"><span class="ic" style="background:var(--warn-wash);color:var(--warn)"><i data-lucide="hammer"></i></span><div><div class="k">${esc(t("lpp.practice"))}</div><div class="v">${esc(course.practice)}</div><div class="m">${esc(t("lpp.practiceSub"))}</div></div></div>` : ""}
      ${course.prove ? `<div class="lpp-item"><span class="ic" style="background:var(--good-wash);color:var(--good)"><i data-lucide="badge-check"></i></span><div><div class="k">${esc(t("lpp.prove"))}</div><div class="v">${esc(course.prove)}</div><div class="m">${esc(t("lpp.proveSub"))}</div></div></div>` : ""}
    </div>${isSample(course.source) ? `<p class="src" style="margin-top:8px">${esc(t("skill.courseSample"))}</p>` : course.practice ? `<p class="src" style="margin-top:8px">${esc(t("next.samplePractice"))}</p>` : ""}`) : "";
  const check = have ? `<div class="sec" id="check-sec"><button class="btn btn-soft" id="prove" type="button" style="width:100%" ${verified || S.profileFallback ? "disabled" : ""}><i data-lucide="badge-check"></i>${esc(verified ? t("check.already") : t("check.take"))}</button></div>` : "";
  const sdg = Array.isArray(n.sdg) && n.sdg.length === 2 && !Array.isArray(n.sdg[0]) ? `<div class="sec"><h3><i data-lucide="globe"></i>${esc(t("skill.sdg"))}</h3>${sdgRows([n.sdg])}</div>` : Array.isArray(n.sdg?.[0]) ? `<div class="sec"><h3><i data-lucide="globe"></i>${esc(t("skill.sdg"))}</h3>${sdgRows(n.sdg)}</div>` : "";
  return `${drHead(have ? t("drawer.yourSkill") : t("drawer.toLearn"), have ? "check-circle" : "plus-circle", n.name, sub)}
    <div class="sec"><p class="note">${esc(t("impact.why." + im.label, {}))}. ${esc(t("drawer.expLine", { e: Math.round(E.exposure(k) * 100), d: sign(E.demand(k)), year: S.year }))}</p>
      ${n.description ? `<p class="note" style="margin-top:6px">${esc(n.description)}</p>` : ""}
      <div class="dr-meta">${howLink("exposure", k)}</div></div>
    ${emgSec}
    ${links ? `<div class="sec"><h3><i data-lucide="git-branch"></i>${esc(t("skill.connections"))}</h3><div class="chips">${links}</div></div>` : ""}
    ${levels}${tasks}${Array.isArray(n.tasks) && n.tasks.length ? skillBlock(k) : ""}${step}${check}${sdg}
    <p class="src">${esc(t("skill.srcNote"))}${em ? "" : " " + esc(t("skill.frameworkNote"))}${isSample(n.outlookSource) ? " " + esc(t("skill.sampleNote")) : ""}</p>`;
}

// ---------- 5-minute check ----------
/** Run the check inside sec (the drawer's by default); onPass runs after a pass. */
export async function startCheck(k, sec = document.getElementById("check-sec"), onPass = () => setTimeout(() => refreshDrawer(), 50)) {
  if (!sec) return;
  sec.innerHTML = loadingBox(t("check.loading"));
  let q;
  try { q = await get(`/skills/${encodeURIComponent(k)}/check`, { profile: profileId() }); }
  catch (e) { sec.innerHTML = errorBox(e, "check"); bindRetry(sec, { check: () => startCheck(k) }); icons(); return; }
  if (!sec.isConnected) return; // moved on while it loaded
  const qs = q.questions || [];
  sec.innerHTML = `<form class="check-form" novalidate><h3><i data-lucide="badge-check"></i>${esc(t("check.title", { name: nameOf(k) }))}${q.isSample ? " " + badge("b-warn", t("src.sample")) : ""}</h3>
    ${qs.map((x, i) => `<fieldset><legend>${i + 1}. ${esc(x.text)}</legend>${(x.options || []).map((o, oi) => `<label class="opt"><input type="radio" name="q${esc(x.id)}" value="${oi}" required> <span>${esc(o)}</span></label>`).join("")}</fieldset>`).join("")}
    <button class="btn btn-primary" type="submit" style="width:100%"><i data-lucide="send"></i>${esc(t("check.submit"))}</button>
    <button class="link-btn check-close" type="button">${esc(t("next.checkClose"))}</button></form>`;
  icons();
  const form = sec.querySelector("form");
  // close without answering: nothing is sent, and the check can be started again
  form.querySelector(".check-close").addEventListener("click", () => { sec.innerHTML = ""; document.querySelectorAll("[data-check], #prove").forEach(b => { b.disabled = false; }); });
  form.addEventListener("submit", async ev => {
    ev.preventDefault();
    const answers = {};
    for (const x of qs) { const v = form.querySelector(`input[name="q${CSS.escape(String(x.id))}"]:checked`); if (!v) { toast({ title: t("check.answerAll") }); return; } answers[x.id] = Number(v.value); }
    const btn = form.querySelector("button[type=submit]"); btn.disabled = true; btn.innerHTML = `<span class="spin"></span>${esc(t("check.checking"))}`;
    try {
      const res = await post(`/skills/${encodeURIComponent(k)}/check`, { profileId: profileId(), checkId: q.checkId, answers });
      if (res.profile) actions.profileUpdated(res.profile);
      toast({ title: res.passed ? t("check.passed") : t("check.failed"), detail: t("check.score", { score: res.score, total: res.total }), badgeHtml: badge(res.passed ? "b-good" : "b-warn", res.passed ? t("conf.verified") : t("check.tryAgain")) });
      sec.innerHTML = `<p class="note">${esc(t("check.score", { score: res.score, total: res.total }))}</p>`;
      if (res.passed) onPass(res);
    } catch (e) { btn.disabled = false; btn.textContent = t("check.submit"); toast({ title: t("state.failed"), detail: e.message, badgeHtml: badge("b-crit", t("state.error")) }); }
  });
}
