// My goal tab. Like map directions: the destination, route options as rows (Fastest / Balanced / Safest),
// then the steps. Once a job is set as your goal: progress and the next skill to learn (why, learn, practice, prove).
// Below: the future stress test, and (collapsed) facts about the job, then cost, deadline and sending the plan to an advisor.
import { S, UI, D, N, nameOf, W, actions, profileId, kindOf, matchOf } from "../state.js";
import { MODES, stressTest, yearOf } from "/shared/engine.js";
import { get } from "../api.js";
import { t } from "../i18n.js";
import { $, esc, icons, badge, srcBadge, errorBox, loadingBox, rm, fmtDate, extLink, toast, bindRetry, debounce, sign } from "../util.js";
import { whyBtn } from "../features/why.js";
import { plansForJob, statusBadge, savePlan, sendPlan, noteOf, pendingOf, routeUpdate, routeText, plansState } from "../features/plans.js";
import { goal, isGoal, setGoal, setGoalMode, toggleDone, markDone, isVerified, progress } from "../features/goal.js";
import { jobAsks, startCheck, courseMeta, isSample, openingsHtml } from "../drawer.js";
import { splitBar } from "./skills.js";
import { previewRoute } from "../graph3d.js";

const server = { key: "", data: null, err: null, loading: false, seq: 0 };
const ICON = { start: "user-round", reuse: "check", upskill: "arrow-up", evolve: "refresh-cw", reskill: "plus", arrive: "flag" };

function stepRow({ kind, title, sub, weeks = null, node, n = 0, done = false, verified = false }) {
  return `<li class="step${done ? " done" : ""}" data-node="${esc(node)}" tabindex="0" role="button" aria-label="${esc(t("path.stepAria", { type: t("step." + kind), name: title }))}">
    <span class="sico k-${kind}">${done ? `<i data-lucide="check"></i>` : n ? `<b class="num">${n}</b>` : `<i data-lucide="${ICON[kind]}"></i>`}</span>
    <div><div class="t">${esc(title)}${verified ? " " + badge("b-good", t("conf.verified"), "badge-check") : ""}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ""}</div>
    <span class="w">${weeks === null ? "" : `${W(weeks)} ${esc(t("common.wk"))}`}</span></li>`;
}

function planFor(j, m) {
  if (j === UI.job && m === UI.mode) return D.plan;
  try { return S.E.planFor(j, m, j === UI.job ? UI.employerReq : []); } catch { return null; }
}

// One row per distinct route: modes that give the same road share a row, named by what it is best at
// (a row holding Fastest is "Fastest", else one holding Safest is "Safest", else "Balanced"). Null when there is only one road.
function routeOptions(j) {
  const groups = [];
  MODES.forEach(m => {
    const p = planFor(j, m), key = p?.route?.key ?? "none", g = groups.find(x => x.key === key);
    if (g) g.modes.push(m); else groups.push({ key, p, modes: [m] });
  });
  if (groups.length < 2) return null;
  return groups.map(({ p, modes }) => {
    const on = modes.includes(UI.mode), m = on ? UI.mode : modes[0];
    const name = modes.includes("fastest") ? "fastest" : modes.includes("safest") ? "safest" : "noregret";
    const first = p?.route?.nodes.find(k => kindOf(k) === "learn");
    const line = !p?.route ? t("mode.note." + name) : first ? t("path.startsWith", { name: nameOf(first) }) : t("path.noNewSkill");
    return `<button class="ropt" type="button" data-mode="${m}" aria-pressed="${on}">
      <span class="ropt-l"><b>${esc(t("mode." + name))}</b><span>${esc(line)}</span>${p?.route && first ? `<span>${esc(t("path.coreWk", { w: W(p.core) }))}</span>` : ""}</span>
      <span class="ropt-r">${p?.route ? `<span class="risk r-${p.route.risk}">${esc(t("jobs.risk." + p.route.risk))}</span>` : `<span class="risk">${esc(t("path.noRouteShort"))}</span>`}</span>
    </button>`;
  }).join("");
}

function safeLine() {
  const E = S.E, p = D.plan;
  const now = E.futureScore();
  const learned = p?.route ? p.route.nodes.filter(k => E.isSkill(k) && !E.owned(k)) : [];
  const after = E.futureScore([...learned, ...(p ? p.extras.map(x => x.id) : [])]);
  return t("path.safe", { year: S.year, now, after });
}

function progressHtml(p) {
  const pr = progress(p);
  if (!pr) return "";
  const pct = pr.total ? Math.round(100 * pr.done / pr.total) : 100;
  const nx = pr.next;
  return `<section class="progress" aria-label="${esc(t("goal.progressAria"))}">
    <div class="pg-row"><b>${esc(t("goal.progress", { done: pr.done, total: pr.total }))}</b><span>${esc(pr.left ? t("goal.left", { w: W(pr.left) }) : t("goal.leftNone"))}</span></div>
    <div class="pg-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
    ${nx ? nextHtml(nx, p) : `<p class="note">${esc(t("goal.allDone"))}</p>`}
    ${pr.done ? `<p class="src">${esc(t("goal.selfNote"))} <button class="link-btn" type="button" data-done="${esc(goal().done.at(-1))}">${esc(t("goal.undo"))}</button></p>` : ""}
  </section>`;
}

// Next up, compact: the skill, its weeks, the check (or tick it yourself). "How to do it" opens why, learn and practice.
function nextHtml(nx, p) {
  const k = nx.id, co = (S.graph.courses?.[k] || [])[0];
  const leg = p.route.legs.find(l => l.to === k), up = p.ups.find(u => u.id === k);
  const rq = (S.graph.req[UI.job] || []).find(r => r.skill === k), share = rq && !isSample(rq.source) ? rq.share : null; // no sample shares
  const why = [(leg?.why || "").replace(/\.\s*$/, "") || (up ? t("path.upTitle", { name: nameOf(k), from: up.from, to: up.to }) : ""), share != null ? t("next.share", { n: share, job: nameOf(UI.job) }) : ""].filter(Boolean).join(". ");
  const meta = co ? [courseMeta(co), co.provider ? t("next.by", { provider: co.provider }) : ""].filter(Boolean).join(" ") : "";
  const ver = isVerified(k), noServer = S.profileFallback;
  // real provider listings are not sample; their practice tasks still are
  const sample = co && isSample(co.source) ? t(co.practice ? "next.sample" : "next.sampleCourse") : co?.practice ? t("next.samplePractice") : "";
  const item = (key, body) => `<li><span class="todo-k">${esc(t(key))}</span><div>${body}</div></li>`;
  return `<div class="next">
      <div class="next-k">${esc(t("goal.next"))}</div>
      <div class="next-t">${esc(nameOf(k))}</div>
      <div class="next-s">${esc(t("goal.nextSub", { w: W(nx.weeks), h: S.profile.hours }))}</div>
      <div class="next-a">${ver ? badge("b-good", t("conf.verified"), "badge-check")
        : `<button class="btn btn-primary sm" type="button" data-check="${esc(k)}" title="${esc(t("next.checkSub"))}" ${noServer ? "disabled" : ""}><i data-lucide="badge-check"></i>${esc(t("next.check"))}</button>`}
        <button class="link-btn" type="button" data-done="${esc(k)}">${esc(t("goal.markSelf"))}</button></div>
      ${!ver && noServer ? `<p class="src">${esc(t("next.checkOff"))}</p>` : ""}
      <div class="next-check" id="next-check"></div>
      <details class="next-how" id="next-how"${UI.nextHow ? " open" : ""}>
        <summary><span>${esc(t("next.how"))}</span><i class="chev" data-lucide="chevron-down"></i></summary>
        <ul class="todo">
          ${why ? item("next.why", esc(why)) : ""}
          ${item("lpp.learn", co ? `${co.url ? extLink(co.url, co.title) : `<b>${esc(co.title)}</b>`}${meta ? `<small>${esc(meta)}</small>` : ""}` : `<span class="muted">${esc(t("next.noCourse"))}</span>`)}
          ${co?.practice ? item("lpp.practice", esc(co.practice)) : ""}
        </ul>
        <button class="link-btn next-open" type="button" data-open="${esc(k)}">${esc(t("goal.details"))}</button>
        ${sample ? `<p class="src">${esc(sample)}</p>` : ""}
      </details>
    </div>`;
}

// About this job: the facts the job's details hold that the route doesn't (who does the work, what employers ask, sources).
function aboutHtml(j) {
  const E = S.E, n = N(j);
  return `<details class="more" id="job-more"${UI.jobMore ? " open" : ""}>
      <summary><span>${esc(t("path.about"))}</span><i class="chev" data-lucide="chevron-down"></i></summary>
      <div class="more-in">
        ${n.blurb ? `<p class="note">${esc(n.blurb)}</p>` : ""}
        ${openingsHtml(n.name)}
        <div class="msec"><h4>${esc(t("drawer.whoWork", { year: S.year }))}</h4>${splitBar(j, "job")}
          <p class="note">${esc(t("drawer.expLine", { e: Math.round(E.exposure(j) * 100), d: sign(E.demand(j)), year: S.year }))} ${srcBadge(n.outlookSource)}</p></div>
        <div class="msec"><h4>${esc(t("drawer.asks"))}</h4>${jobAsks(j)}</div>
        ${n.malaysia ? `<p class="note">${esc(t("path.dosm", { group: t("esco.my.g." + n.malaysia.group), rm: rm(n.malaysia.medianWageRm), year: n.malaysia.year }))} ${extLink(n.malaysia.url, "OpenDOSM")}</p>` : ""}
        <button class="btn btn-soft" type="button" data-open="${esc(j)}"><i data-lucide="briefcase"></i>${esc(t("path.aboutAll"))}</button>
      </div>
    </details>`;
}

export function render() {
  const E = S.E, j = UI.job, g = goal();
  if (!j || !UI.picked) return `<div class="empty pick"><span class="em-ic"><i data-lucide="flag"></i></span><h3>${esc(t("path.pickTitle"))}</h3><p>${esc(t("path.pickJob"))}</p>
    <div class="quick">${UI.ring.slice(0, 3).map(x => `<button type="button" data-quick="${esc(x)}"><span>${esc(nameOf(x))}</span><span class="num">${matchOf(x)}%</span></button>`).join("")}</div></div>`;
  const p = D.plan, n = N(j), mine = isGoal(j), req = (S.graph.req[j] || []).filter(r => E.isSkill(r.skill));
  const head = `<header class="goal-head">
      <div class="goal-k"><span>${mine ? `<i data-lucide="flag"></i>${esc(t("goal.yours"))}` : esc(t("goal.preview"))}</span><span class="goal-kind">${esc(n.stay ? t("jobs.stay") : t("jobs.change"))}</span></div>
      <h2>${esc(n.name)}</h2>
      <p class="goal-sub">${esc(t("path.matchToday", { n: matchOf(j) }))}${whyBtn("match", j)}</p>
      <p class="goal-have">${esc(t("jobs.haveSkills", { a: req.filter(r => E.has(r.skill)).length, b: req.length }))}</p>
      ${UI.employer ? `<div class="emp-chip">${badge("b-info", t("emp.at", { name: UI.employer.name }), "building-2")}<button class="ghost sm" type="button" id="emp-clear"><i data-lucide="x"></i>${esc(t("emp.clear"))}</button></div>` : ""}
      ${mine ? "" : `<button class="btn btn-primary goal-set" id="goal-set" type="button" ${p?.route ? "" : "disabled"}><i data-lucide="flag"></i>${esc(t(g ? "goal.switch" : "goal.set"))}</button>
        ${g ? `<p class="note">${esc(t("goal.current", { job: nameOf(g.job) }))}</p>` : ""}`}
    </header>`;
  const ro = routeOptions(j);
  const options = ro ? `<section><h3 class="sec-h">${esc(t("path.routeH"))}</h3>
      <div class="ropts mode-seg" role="group" aria-label="${esc(t("path.modeAria"))}">${ro}</div></section>`
    : p?.route ? `<p class="note">${esc(t("path.oneRoute"))}</p>` : "";
  if (!p?.route) return `<div class="stack">${head}${options}<p class="note">${esc(t("path.noRouteBody", { year: S.year }))}</p>${aboutHtml(j)}</div>`;

  const done = new Set(mine ? g.done : []);
  let k = 0;
  const root = E.root;
  const rows = [stepRow({ kind: "start", title: t("path.youToday", { job: nameOf(root) }), sub: E.taken(root) ? t("path.youTakenShort", { year: S.year }) : "", node: root })];
  p.route.legs.forEach(l => {
    const kind = kindOf(l.to);
    if (kind === "have") rows.push(stepRow({ kind: "reuse", title: nameOf(l.to), sub: t("path.have", { n: E.lvl(l.to) }), node: l.to }));
    else if (kind === "learn") {
      const sk = l.kind === "evolve" ? "evolve" : "reskill";
      rows.push(stepRow({ kind: sk, title: nameOf(l.to), sub: l.why || t("step." + sk), weeks: l.weeks, node: l.to, n: ++k, done: done.has(l.to), verified: done.has(l.to) && isVerified(l.to) }));
    } else rows.push(stepRow({ kind: "arrive", title: nameOf(l.to), sub: t("path.arrive"), weeks: null, node: l.to }));
  });
  const more = [
    ...p.ups.map(u => stepRow({ kind: "upskill", title: t("path.upTitle", { name: nameOf(u.id), from: u.from, to: u.to }), sub: t("path.upSub", { level: t("level." + u.to) }), weeks: u.weeks, node: u.id })),
    ...p.extras.map(x => stepRow({ kind: x.kind, title: nameOf(x.id), sub: x.from ? t(x.kind === "evolve" ? "path.evolvesFrom" : "path.buildsOn", { name: nameOf(x.from) }) : (UI.employerReq.some(r => r.skill === x.id) ? t("emp.extraStop", { name: UI.employer?.name || "" }) : ""), weeks: x.weeks, node: x.id })),
  ];

  return `<div class="stack">
    ${head}
    ${mine ? progressHtml(p) : ""}
    ${options}
    <p class="route-sum">${esc(t("path.summary", { ready: W(p.ready), core: W(p.core), h: S.profile.hours }))}${whyBtn("weeks", j)}<br><span>${esc(safeLine())}</span></p>
    <section><h3 class="sec-h">${esc(t("path.stepsH"))}</h3>
      <ol class="steps">${rows.join("")}</ol>
      ${more.length ? `<h3 class="sec-h sub">${esc(t("path.alsoBuild"))}</h3><ol class="steps">${more.join("")}</ol>` : ""}
    </section>
    ${stressHtml(j)}
    ${aboutHtml(j)}
    <details class="more" id="plan-more"${UI.planMore ? " open" : ""}>
      <summary><span>${esc(t("path.more"))}</span><i class="chev" data-lucide="chevron-down"></i></summary>
      <div class="more-in">
        <div id="plan-server">${serverHtml()}</div>
        <div id="plan-save">${saveHtml()}</div>
      </div>
    </details>
  </div>`;
}

// ---------- future stress test: the plan replayed in 1,000 simulated futures ----------
// 1,000 runs take a few milliseconds, so they run on the main thread; results are cached per plan.
const stressCache = new Map();
function stressHtml(j) {
  let r;
  try {
    const p = S.profile;
    const profile = { occupationId: S.E.root, level: p.level, hours: p.hours };
    const opts = {
      view: { year: S.year, scenario: S.scenario }, startYear: yearOf(new Date().toISOString().slice(0, 10)),
      deadlineYear: p.targetDate ? yearOf(p.targetDate) : undefined, extraReq: UI.employerReq,
    };
    const key = JSON.stringify([profile, j, UI.mode, opts, S.graph.kbVersion, S.graph.deltas || null]);
    r = stressCache.get(key);
    if (!r) {
      r = stressTest(S.graph, profile, j, UI.mode, opts);
      if (stressCache.size > 50) stressCache.clear();
      stressCache.set(key, r);
    }
  } catch (e) { console.warn("stress test failed", e); return ""; }
  if (!r.route) return "";
  const tone = r.rate >= 90 ? "good" : r.rate >= 67 ? "warn" : "crit";
  const pctOf = share => (share < 1 ? t("stress.under1") : Math.round(share) + "%");
  const skillName = x => (x.skill ? nameOf(x.skill) : "");
  const whenText = (c, x) => t("stress.when." + c.factor + "." + c.dir + (c.factor === "hours" && c.dir === "low" && c.below === undefined ? "Any" : ""), { h: c.below, skill: skillName(x) });
  const pats = r.patterns.slice(0, 3).map(x => {
    const why = t("stress.why." + x.check, { skill: skillName(x) }), share = pctOf(x.share);
    return `<li>${esc(x.when.length ? t("stress.patternWhen", { why, share, when: x.when.map(c => whenText(c, x)).join(t("stress.and")) }) : t("stress.pattern", { why, share }))}</li>`;
  }).join("");
  const fixes = r.sturdier.map(s => `<li>${esc(s.kind === "hours" ? t("stress.fixHours", { h: s.hours, pct: s.rate + "%" }) : t("stress.fixMode", { mode: t("mode." + s.mode), pct: s.rate + "%" }))}</li>`).join("");
  const runs = r.runs.toLocaleString("en-US");
  const head = esc(t("stress.works", { pct: "%PCT%", n: runs })).replace("%PCT%", `<strong class="stress-pct">${r.rate}%</strong>`);
  const inputs = ["speed", "estimate", "hours", "weeks", "deadline"].map(k => `<li>${esc(t("stress.in." + k, { h: S.profile.hours }))}</li>`).join("");
  return `<section class="stress"><h3 class="sec-h">${esc(t("stress.title"))}</h3>
    <p class="stress-v t-${tone}">${head}</p>
    <div class="stress-bar t-${tone}" aria-hidden="true"><span style="width:${r.rate}%"></span></div>
    ${pats ? `<div class="sub-h">${esc(t("stress.patterns"))}</div><ul class="alt-list">${pats}</ul>` : ""}
    ${fixes ? `<div class="sub-h">${esc(t("stress.sturdier"))}</div><ul class="alt-list">${fixes}</ul>` : ""}
    <details class="src-details"><summary>${esc(t("stress.how"))}</summary><p class="src">${esc(t("stress.intro", { n: runs }))}</p><ul class="src stress-in">${inputs}</ul><p class="src">${esc(t("stress.method"))}</p></details></section>`;
}

// ---------- server plan: deadline + cost ----------
const keyNow = () => JSON.stringify([profileId(), UI.job, UI.mode, S.year, S.scenario, UI.employer?.id || null, S.graph.kbVersion, S.profile.hours, S.profile.targetDate]);

function serverHtml() {
  if (S.profileFallback) return errorBox({ notAvailable: true });
  if (server.key !== keyNow() || server.loading) return loadingBox(t("plan.loading"));
  if (server.err) return errorBox(server.err, "plan");
  const d = server.data || {};
  const dl = d.deadline || {}, c = d.cost || {};
  const st = { on_track: ["b-good", "plan.onTrack", "circle-check"], ahead: ["b-good", "plan.ahead", "rocket"], behind: ["b-crit", "plan.behind", "triangle-alert"], none: ["b-mute", "plan.noDeadline", "calendar"] }[dl.status || "none"] || ["b-mute", "plan.noDeadline", "calendar"];
  const items = Array.isArray(c.items) ? c.items : [];
  const courseOf = id => (S.graph.courses?.[id] || [])[0];
  return `<div class="msec">
    <h4>${esc(t("plan.deadline"))}</h4>
    <div class="dl-row">${badge(st[0], t(st[1]), st[2])}
      ${dl.readyBy ? `<span>${esc(t("plan.readyBy", { date: fmtDate(dl.readyBy) }))}</span>` : ""}
      ${dl.targetDate ? `<span class="rs">${esc(t("plan.target", { date: fmtDate(dl.targetDate), avail: dl.weeksAvailable ?? "–", need: dl.weeksNeeded ?? "–" }))}</span>` : `<button class="ghost sm" type="button" id="set-target"><i data-lucide="calendar-plus"></i>${esc(t("plan.setTarget"))}</button>`}
    </div>
  </div>
  <div class="msec">
    <h4>${esc(t("plan.cost"))}</h4>
    <dl class="kv">
      <div><dt>${esc(t("plan.total"))}</dt><dd>${rm(c.totalRm)}</dd></div>
      <div><dt>${esc(t("plan.hrd"))}</dt><dd>${rm(c.hrdClaimableRm)}</dd></div>
      <div><dt>${esc(t("plan.oop"))}</dt><dd>${rm(c.outOfPocketRm ?? (c.totalRm || 0) - (c.hrdClaimableRm || 0))}</dd></div>
    </dl>
    ${c.unknownCount ? `<p class="note">${esc(t("plan.unknown", { n: c.unknownCount }))}</p>` : ""}
    ${S.profile.budgetRm != null && c.totalRm != null ? `<p class="note">${esc(t(c.outOfPocketRm > S.profile.budgetRm ? "plan.overBudget" : "plan.inBudget", { b: rm(S.profile.budgetRm) }))}</p>` : ""}
    ${items.length ? `<ul class="course-list">${items.map(it => { const co = courseOf(it.skillId); const url = it.url || co?.url; return `<li><div><b>${esc(it.title || co?.title || nameOf(it.skillId))}</b><div class="rs">${esc(nameOf(it.skillId))}</div>${co?.provider ? `<div class="rs">${esc(co.provider)}</div>` : ""}</div>
      <div class="ci-r"><span class="num">${it.costRm == null ? esc(t("plan.costUnknown")) : it.costRm === 0 ? esc(t("plan.free")) : rm(it.costRm)}</span>${it.hrdClaimable ? badge("b-good", "HRD Corp") : ""}${srcBadge(it.source || co?.source)}${url ? extLink(url, t("plan.open")) : ""}</div></li>`; }).join("")}</ul>` : ""}
    ${Array.isArray(d.sources) && d.sources.length ? `<details class="src-details"><summary>${esc(t("plan.sourcesN", { n: d.sources.length }))}</summary><ul>${d.sources.map(s => `<li>${s.kind ? badge(s.kind === "sample" ? "b-warn" : "b-mute", s.kind === "sample" ? t("src.sample") : s.kind) + " " : ""}${s.url ? extLink(s.url, s.label) : esc(s.label)}${s.date ? ", " + esc(fmtDate(s.date)) : ""}</li>`).join("")}</ul></details>` : ""}
    <p class="src">${esc(t("plan.serverNote", { v: d.kbVersion ?? S.graph.kbVersion }))}</p>
  </div>`;
}

const fetchServer = debounce(async () => {
  const key = keyNow(), seq = ++server.seq;
  server.key = key; server.loading = true; server.err = null;
  const params = { profile: profileId(), job: UI.job, mode: UI.mode, year: S.year, scenario: S.scenario };
  if (UI.employer) params.employer = UI.employer.id;
  try { const res = await get("/plan", params, { timeout: 20000 }); if (seq === server.seq) server.data = res; }
  catch (e) { if (seq === server.seq) server.err = e; }
  if (seq !== server.seq) return;
  server.loading = false;
  const box = $("plan-server");
  if (box) { box.innerHTML = serverHtml(); bindServer(box); icons(); }
}, 220);

function bindServer(box) {
  bindRetry(box, { plan: () => { server.key = ""; ensureServer(); } });
  const st = box.querySelector("#set-target"); if (st) st.addEventListener("click", () => actions.openOnboarding?.(2));
}

function ensureServer() {
  if (!UI.job || !UI.picked || S.profileFallback) return;
  if (server.key === keyNow() && (server.data || server.loading)) return;
  server.key = keyNow(); server.loading = true;
  const box = $("plan-server"); if (box) { box.innerHTML = serverHtml(); icons(); }
  fetchServer();
}

// ---------- send to an advisor ----------
function saveHtml() {
  const mine = plansForJob(UI.job);
  const latest = mine[0];
  const pend = mine.find(p => pendingOf(p));
  const sample = S.profileFallback;
  return `<div class="msec">
    <h4>${esc(t("plan.advisorH"))}</h4>
    ${pend ? `<div class="reroute-card">${badge("b-warn", t("reroute.badge"), "route")}<p>${esc(t("reroute.offer", { route: routeText(pendingOf(pend)) }))}</p>
      <div class="rv-actions"><button class="btn btn-primary" type="button" data-route="switch" data-plan="${esc(pend.id)}"><i data-lucide="shuffle"></i>${esc(t("reroute.switch"))}</button><button class="btn btn-soft" type="button" data-route="keep" data-plan="${esc(pend.id)}">${esc(t("reroute.keep"))}</button></div></div>` : ""}
    ${latest ? `<div class="plan-status">${statusBadge(latest.status)}<span class="rs">${esc(t("plan.savedAs", { mode: t("mode." + (latest.mode || "fastest")), id: latest.id }))}</span></div>
      ${noteOf(latest) ? `<p class="advisor-note"><i data-lucide="message-square-quote"></i>${esc(noteOf(latest))}</p>` : ""}` : ""}
    <button class="btn btn-soft" id="plan-send-btn" type="button" ${sample || latest?.status === "sent" ? "disabled" : ""}><i data-lucide="send"></i>${esc(latest?.status === "sent" ? t("plan.sentBtn") : t("plan.send"))}</button>
    <p class="note">${esc(latest?.status === "sent" ? t("plan.sentNote") : t("plan.peopleDecide"))}</p>
    ${plansState.err && !plansState.err.notAvailable ? errorBox(plansState.err) : ""}
  </div>`;
}

function bindSave(box) {
  const sd = box.querySelector("#plan-send-btn");
  const busy = (b, on) => { b.disabled = on; b.classList.toggle("busy", on); };
  if (sd) sd.addEventListener("click", async () => {
    busy(sd, true);
    try {
      let p = plansForJob(UI.job).find(x => x.status === "draft" && (x.mode || "fastest") === UI.mode) || await savePlan();
      p = await sendPlan(p);
      toast({ title: t("plan.sentToast"), detail: t("plan.sentToastBody"), badgeHtml: badge("b-info", t("plan.status.sent")) });
    } catch (e) { toast({ title: t("plan.sendFailed"), detail: e.notAvailable ? t("state.notAvailable") : e.message, badgeHtml: badge("b-crit", t("state.error")) }); }
    repaintSave();
  });
  box.querySelectorAll("[data-route]").forEach(b => b.addEventListener("click", async () => {
    const plan = (UI.plans || []).find(p => String(p.id) === b.dataset.plan); if (!plan) return;
    b.disabled = true;
    try {
      await routeUpdate(plan, b.dataset.route);
      toast({ title: t(b.dataset.route === "switch" ? "reroute.switched" : "reroute.kept"), badgeHtml: badge("b-good", t("reroute.badge")) });
    } catch (e) { toast({ title: t("state.failed"), detail: e.message, badgeHtml: badge("b-crit", t("state.error")) }); }
    actions.refresh?.();
  }));
}

export function repaintSave() {
  const box = $("plan-save"); if (!box) return;
  box.innerHTML = saveHtml(); bindSave(box); icons();
}

export function bind(el) {
  // a re-render drops the rows without a mouseleave, so start with no preview
  previewRoute(null);
  el.querySelectorAll("[data-mode]").forEach(b => {
    b.addEventListener("click", () => { previewRoute(null); if (isGoal(UI.job)) setGoalMode(b.dataset.mode); actions.setMode(b.dataset.mode); });
    // hovering or focusing a route row previews that route on the map, like a map app's route options
    b.addEventListener("mouseenter", () => previewRoute(b.dataset.mode));
    b.addEventListener("focus", () => previewRoute(b.dataset.mode));
    b.addEventListener("mouseleave", () => { if (document.activeElement !== b) previewRoute(null); });
    b.addEventListener("blur", () => previewRoute(null));
  });
  el.querySelectorAll("[data-quick]").forEach(b => b.addEventListener("click", () => actions.selectJob(b.dataset.quick)));
  el.querySelectorAll(".step[data-node]").forEach(b => {
    b.addEventListener("click", () => actions.openDrawer(b.dataset.node));
    b.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); actions.openDrawer(b.dataset.node); } });
  });
  const gs = el.querySelector("#goal-set");
  if (gs) gs.addEventListener("click", () => {
    setGoal(UI.job, UI.mode);
    toast({ title: t("goal.setToast", { job: nameOf(UI.job) }), detail: t("goal.setBody"), badgeHtml: badge("b-good", t("goal.yours"), "flag") });
    actions.refresh({ animate: true });
    // Real profiles also save the goal as a plan on the server, so a later market change can offer "keep or switch".
    if (!S.profile?.isDemo && !S.profileFallback && !plansForJob(UI.job).some(x => (x.mode || "fastest") === UI.mode))
      savePlan().then(() => repaintSave(), e => console.warn("Saving the goal as a plan failed", e));
  });
  el.querySelectorAll("[data-done]").forEach(b => b.addEventListener("click", () => { toggleDone(b.dataset.done); actions.refresh({ animate: true }); }));
  el.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", () => actions.openDrawer(b.dataset.open)));
  el.querySelectorAll(".req-row[data-skill]").forEach(b => {
    b.addEventListener("click", () => actions.openDrawer(b.dataset.skill));
    b.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); actions.openDrawer(b.dataset.skill); } });
  });
  // the skill check, run in place; a pass ticks the step and marks it verified
  el.querySelectorAll("[data-check]").forEach(b => b.addEventListener("click", () => {
    const k = b.dataset.check; b.disabled = true;
    startCheck(k, $("next-check"), () => { markDone(k, true); actions.refresh({ animate: true }); });
  }));
  const more = el.querySelector("#plan-more"); if (more) more.addEventListener("toggle", () => { UI.planMore = more.open; });
  const nh = el.querySelector("#next-how"); if (nh) nh.addEventListener("toggle", () => { UI.nextHow = nh.open; });
  const jm = el.querySelector("#job-more"); if (jm) jm.addEventListener("toggle", () => { UI.jobMore = jm.open; });
  const ec = el.querySelector("#emp-clear"); if (ec) ec.addEventListener("click", () => actions.setEmployer(null));
  const box = $("plan-server"); if (box) bindServer(box);
  const sb = $("plan-save"); if (sb) bindSave(sb);
  ensureServer();
}

/** Forget the cached server plan (after a knowledge change). */
export function invalidate() { server.key = ""; server.data = null; }
