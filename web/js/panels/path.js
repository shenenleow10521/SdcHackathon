// Plan tab. Like map directions: the destination, ONE weeks figure (every skill you still need, at your hours a week),
// your route (Easiest start: it starts from what you know) with a "Safer route available" card only when the safest
// route differs (what it skips, why, the time difference), and every skill still to build: the numbered key steps,
// then "Also needed". Catalogue jobs and ESCO jobs (from the map, the list or the search box) share this layout.
// Steps show hours (they add up exactly); only the total is in weeks, with its hours shown. Progress on your goal lives
// in the My goal tab (renderGoal below).
// Right under the header: how the path supports the UN goals (features/sdg.js). Below the route: the same plan in four
// futures side by side (features/futures.js), then the future stress test, and (collapsed) facts about the job, then cost, deadline and sending the plan to an advisor.
import { S, UI, D, N, when, isLater, nameOf, cap, W, actions, profileId, kindOf, matchOf, currentJobTitle, escoRow, escoPlanWeeks, isAiEra } from "../state.js";
import { normMode, stressTest, yearOf } from "/shared/engine.js";
import { get } from "../api.js";
import { t } from "../i18n.js";
import { $, esc, icons, badge, srcBadge, errorBox, loadingBox, rm, fmtDate, extLink, toast, bindRetry, debounce, sign } from "../util.js";
import { whyBtn } from "../features/why.js";
import { plansForJob, statusBadge, savePlan, sendPlan, noteOf, pendingOf, routeUpdate, routeText, plansState } from "../features/plans.js";
import { goal, isGoal, setGoal, setGoalMode, isVerified } from "../features/goal.js";
import { renderGoal as renderGoalTab, bindGoal as bindGoalTab } from "../features/goal-ui.js";
import { jobAsks, openingsHtml } from "../drawer.js";
import { splitBar } from "./skills.js";
import { previewRoute } from "../graph3d.js";
import { saferLine, saferWeeks, aiEraBadge } from "../features/safer.js";
import { openSheet } from "../features/views.js";
import { pathSdgHtml, escoSkill } from "../features/sdg.js";
import { futuresHtml, futuresLine, bindFutures } from "../features/futures.js";

const server = { key: "", data: null, err: null, loading: false, seq: 0 };
const ICON = { start: "user-round", reuse: "check", upskill: "arrow-up", evolve: "refresh-cw", reskill: "plus", arrive: "flag" };

export function stepRow({ kind, title, sub, hours = null, node, n = 0, done = false, verified = false }) {
  return `<li class="step${done ? " done" : ""}" data-node="${esc(node)}" tabindex="0" role="button" aria-label="${esc(t("path.stepAria", { type: t("step." + kind), name: title }))}">
    <span class="sico k-${kind}">${done ? `<i data-lucide="check"></i>` : n ? `<b class="num">${n}</b>` : `<i data-lucide="${ICON[kind]}"></i>`}</span>
    <div><div class="t">${esc(title)}${verified ? " " + badge("b-good", t("conf.verified"), "badge-check") : ""}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ""}</div>
    <span class="w">${hours == null ? "" : esc(t("common.hours", { h: Math.max(1, Math.round(hours)) }))}</span></li>`;
}

function planFor(j, m) {
  if (j === UI.job && normMode(m) === normMode(UI.mode)) return D.plan;
  try { return S.E.planFor(j, m, j === UI.job ? UI.employerReq : []); } catch { return null; }
}

const weeksDiff = saferWeeks;

// The route choice, as a card that only appears when there is a real choice:
//  on the default route (Easiest start): "Safer route available: skips X (why), +N wk" when the safest route differs;
//  on the safest route: a way back to the easiest start when that differs.
const card = (mode, title, line, side) => `<div class="ropts mode-seg" role="group" aria-label="${esc(t("path.modeAria"))}">
      <button class="ropt" type="button" data-mode="${mode}" aria-pressed="false">
        <span class="ropt-ic" aria-hidden="true"><i data-lucide="${mode === "safest" ? "shield-check" : "undo-2"}"></i></span>
        <span class="ropt-l"><b>${esc(title)}</b><span>${esc(line)}</span></span>
        <span class="ropt-r">${side}</span></button></div>`;

function routeChoice(j) {
  const E = S.E, p = D.plan;
  if (!p?.route) return "";
  if (normMode(UI.mode) === "safest") {
    const a = planFor(j, "closest");
    if (!a?.route || a.route.key === p.route.key) return "";
    return card("closest", t("path.backEasiest"), t("mode.note.closest"), `<span class="risk">${esc(weeksDiff(W(a.ready) - W(p.ready)))}</span>`);
  }
  let alt = null;
  try { alt = E.saferAlternative(j, j === UI.job ? UI.employerReq : []); } catch { alt = null; }
  if (!alt) return "";
  const line = saferLine(alt.avoids || [], nameOf);
  return card("safest", t("path.saferH"), line,
    `<span class="risk r-${alt.route.risk}">${esc(t("jobs.risk." + alt.route.risk))}</span><span class="risk">${esc(weeksDiff(W(alt.ready) - W(p.ready)))}</span>`);
}

// "Also needed": the skills still to build that aren't numbered key steps (level-ups, and skills learned alongside a key
// step), in the route list itself so the route and the total agree. Long lists show ALSO_SHOWN rows and "Show N more".
const ALSO_SHOWN = 4;
function alsoRows(items) {
  if (!items.length) return [];
  const rows = items.map((x, i) => x.html.replace('<li class="step', `<li class="step also${i >= ALSO_SHOWN && !UI.alsoAll ? " also-more" : ""}`));
  const more = items.length - ALSO_SHOWN;
  return [`<li class="step-sub">${esc(t("path.alsoH", { n: items.length }))}</li>`, ...rows,
    ...(more > 0 && !UI.alsoAll ? [`<li class="step-more"><button class="link-btn" type="button" id="also-all">${esc(t("path.alsoMore", { n: more }))}</button></li>`] : [])];
}

// "+N more skills with this step": collapsed under a key step, the same skills as that step's cluster on the map
function groupRows(node, items) {
  if (!items.length) return [];
  const open = !!UI.grpOpen?.has(node), h = items.reduce((a, x) => a + (x.hours || 0), 0);
  return [`<li class="step-grp"><button class="grp-tg" type="button" data-grp="${esc(node)}" aria-expanded="${open}"><i data-lucide="chevron-right"></i><span>${esc(t(items.length === 1 ? "path.grp1" : "path.grpN", { n: items.length }))}</span>${h ? `<span class="grp-h">${esc(t("common.hours", { h: Math.round(h) }))}</span>` : ""}</button></li>`,
    ...items.map(x => x.html.replace('<li class="step', `<li data-grp-of="${esc(node)}"${open ? "" : " hidden"} class="step also grp-item`))];
}

/** Match explained: skills you have, and those you have partly (a lower level or a close skill), which count part-way. */
function haveLine(a, c, b, match) {
  return `<p class="goal-have">${esc(c ? t("jobs.haveSkillsPart", { a, b, c }) : t("jobs.haveSkills", { a, b }))}</p>`;
}

/** The one weeks figure, with the hours a week as a picker: every weeks figure in the app follows it. */
const HOURS = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20];
/** The two big figures, like a map app's "25 min, 12 km": the match and the weeks to job-ready (at your hours a week). */
function figs(match, weeks, matchWhy = "", weeksWhy = "") {
  return `<div class="figs">
      <div class="fig"><span class="fig-v num">${esc(String(match))}%</span><span class="fig-k"><span class="nw">${esc(isLater() ? t("path.figMatchLater") : t("path.figMatch"))}${matchWhy}</span></span></div>
      ${weeks != null ? `<div class="fig"><span class="fig-v num">${esc(t("path.readyBig", { w: weeks }))}</span><span class="fig-k">${esc(t("path.figReady"))} ${esc(t("path.readyPre"))} ${hoursPick()} <span class="nw">${esc(t("path.hWeek"))}${weeksWhy}</span></span></div>` : ""}
    </div>`;
}

function hoursPick() {
  const h = S.profile.hours, opts = [...new Set([...HOURS, h])].sort((x, y) => x - y);
  return `<label class="hours-pick"><span class="sr">${esc(t("path.hoursLabel"))}</span><select id="hours-sel">${opts.map(x => `<option value="${x}"${x === h ? " selected" : ""}>${x}</option>`).join("")}</select></label>`;
}

/** "Your goal now: X", as a way back to it while looking at another job. */
function goalNote(g) {
  return g ? `<button class="link-btn goal-back" type="button" id="goto-goal"><i data-lucide="flag"></i>${esc(t("goal.current", { job: nameOf(g.job) }))}</button>` : "";
}

// About this job: the facts the job's details hold that the route doesn't (who does the work, what employers ask, sources).
function aboutHtml(j) {
  const E = S.E, n = N(j);
  return `<details class="more" id="job-more"${UI.jobMore ? " open" : ""}>
      <summary><span>${esc(t("path.about"))}</span><i class="chev" data-lucide="chevron-down"></i></summary>
      <div class="more-in">
        ${n.blurb ? `<p class="note">${esc(n.blurb)}</p>` : ""}
        ${openingsHtml(n.name)}
        <div class="msec"><h4>${esc(t("drawer.whoWork", { year: when() }))}</h4>${splitBar(j, "job")}
          <p class="note">${esc(t("drawer.expLine", { e: Math.round(E.exposure(j) * 100), d: sign(E.demand(j)), year: when() }))} ${srcBadge(n.outlookSource)}</p></div>
        <div class="msec"><h4>${esc(t("drawer.asks"))}</h4>${jobAsks(j)}</div>
        ${n.malaysia ? `<p class="note">${esc(t("path.dosm", { group: t("esco.my.g." + n.malaysia.group), rm: rm(n.malaysia.medianWageRm), year: n.malaysia.year }))} ${extLink(n.malaysia.url, "OpenDOSM")}</p>` : ""}
        <button class="btn btn-soft" type="button" data-open="${esc(j)}"><i data-lucide="briefcase"></i>${esc(t("path.aboutAll"))}</button>
      </div>
    </details>`;
}

// Back to the job list: the route page lives under Explore, like a map app's directions
// ...or back to My goal, when the route was opened from there ("See route on map")
const backRow = () => UI.backTo === "goal"
  ? `<button class="link-btn path-back" type="button" data-tab-goal><i data-lucide="arrow-left"></i>${esc(t("tabs.goal"))}</button>`
  : `<button class="link-btn path-back" type="button" data-tab-jobs><i data-lucide="arrow-left"></i>${esc(t("path.back"))}</button>`;

export function render() {
  if (UI.escoJob && escoRow(UI.escoJob)) return escoRender();
  const E = S.E, j = UI.job, g = goal();
  if (!j || !UI.picked) return `<div class="empty pick"><span class="em-ic"><i data-lucide="flag"></i></span><h3>${esc(t("path.pickTitle"))}</h3><p>${esc(t("path.pickJob"))}</p>
    <div class="quick">${UI.ring.slice(0, 3).map(x => `<button type="button" data-quick="${esc(x)}"><span>${esc(nameOf(x))}</span><span class="num">${matchOf(x)}%</span></button>`).join("")}</div></div>`;
  const p = D.plan, n = N(j), mine = isGoal(j);
  // the one weeks figure, big, like a map app's travel time; it sits above "Set as my goal". The match ⓘ lists each skill.
  const head = `<header class="goal-head">
      ${mine ? `<div class="goal-k"><span><i data-lucide="flag"></i>${esc(t("goal.yours"))}</span></div>` : ""}
      <h2>${esc(n.name)}</h2>
      ${figs(matchOf(j), p?.route ? W(p.ready) : null, whyBtn("match", j), p?.route ? whyBtn("weeks", j) : "")}
      ${UI.employer ? `<div class="emp-chip">${badge("b-info", t("emp.at", { name: UI.employer.name }), "building-2")}<button class="ghost sm" type="button" id="emp-clear"><i data-lucide="x"></i>${esc(t("emp.clear"))}</button></div>` : ""}
      ${stressLine(j)}
      ${futuresLine(j, UI.mode, UI.employerReq)}
      ${mine ? `<button class="link-btn goal-back" type="button" data-tab-goal><i data-lucide="list-checks"></i>${esc(t("goal.seeProgress"))}</button>` : `<button class="btn btn-primary goal-set" id="goal-set" type="button" ${p?.route ? "" : "disabled"}><i data-lucide="flag"></i>${esc(t(g ? "goal.switch" : "goal.set"))}</button>
        ${goalNote(g)}`}
    </header>`;
  const options = routeChoice(j);
  const sdgBox = pathSdgHtml(j, (p?.missing || []).map(m => ({ id: m.id })));
  if (!p?.route) return `<div class="stack">${backRow()}${head}${sdgBox}<p class="note">${esc(t("path.noRouteBody", { year: when() }))}</p>${futuresHtml(j, UI.mode, UI.employerReq)}${aboutHtml(j)}</div>`;

  const done = new Set(mine ? g.done : []);
  const hoursOf = id => (p.missing || []).find(m => m.id === id)?.hours ?? null;
  let k = 0;
  const root = E.root;
  const rows = [stepRow({ kind: "start", title: currentJobTitle() ? t("path.youToday", { job: currentJobTitle() }) : t("path.youTodayNoJob"), sub: E.taken(root) ? t("path.youTakenShort", { year: when() }) : "", node: root })];
  p.route.legs.forEach(l => {
    const kind = kindOf(l.to);
    if (kind === "have") rows.push(stepRow({ kind: "reuse", title: nameOf(l.to), sub: t("path.have", { n: E.lvl(l.to) }), node: l.to }));
    else if (kind === "learn") {
      const sk = l.kind === "evolve" ? "evolve" : "reskill";
      rows.push(stepRow({ kind: sk, title: nameOf(l.to), sub: l.why || t("step." + sk), hours: hoursOf(l.to) ?? l.weeks * 6, node: l.to, n: ++k, done: done.has(l.to), verified: done.has(l.to) && isVerified(l.to) }));
    } else {
      const also = (p.missing || []).filter(m => !m.key).map(m => ({ html: stepRow({
        kind: m.kind, node: m.id, hours: m.hours, done: done.has(m.id),
        title: m.kind === "upskill" ? t("path.upTitle", { name: nameOf(m.id), from: m.levelFrom, to: m.levelTo }) : nameOf(m.id),
        sub: UI.employerReq.some(r => r.skill === m.id) ? t("emp.extraStop", { name: UI.employer?.name || "" }) : "",
      }) }));
      rows.push(...alsoRows(also));
      rows.push(stepRow({ kind: "arrive", title: nameOf(l.to), sub: t("path.arrive"), node: l.to }));
    }
  });
  return `<div class="stack">
    ${backRow()}${head}
    ${sdgBox}
    <section><h3 class="sec-h">${esc(t("path.routeYours"))}<span class="sec-meta">${esc(t("mode." + normMode(UI.mode)))}</span></h3>
      ${options}
      <ol class="steps">${rows.join("")}</ol>
    </section>
    ${futuresHtml(j, UI.mode, UI.employerReq)}
    ${stressHtml(j)}
    ${aboutHtml(j)}
    <details class="more" id="plan-more"${UI.planMore ? " open" : ""}>
      <summary><span>${esc(t(onTeam() ? "path.more" : "path.moreSolo"))}</span><i class="chev" data-lucide="chevron-down"></i></summary>
      <div class="more-in">
        <div id="plan-server">${serverHtml()}</div>
        <div id="plan-save">${saveHtml()}</div>
      </div>
    </details>
  </div>`;
}

// ---------- an ESCO job's plan (GET /api/plan?job=esco:<id>, shaped in app.js escoPlanShape) ----------
function escoRender() {
  const id = UI.escoJob, r = escoRow(id), g = goal();
  const xp = S.escoPlan && S.escoPlan.id === id ? S.escoPlan : null;
  const mid = k => (N(k) ? k : "xs:" + k), nm = k => (N(k) ? nameOf(k) : cap(xp?.names[k]) || nameOf(mid(k)));
  const c = xp?.counts, have = c?.have ?? r.have, close = c?.related ?? r.close ?? 0, n = c?.essential ?? r.essential;
  const head = `<header class="goal-head">
      <h2>${esc(nameOf(id))}</h2>
      ${r.match != null ? `${figs(r.match, xp && !xp.none ? escoPlanWeeks(xp) : null)}${n ? haveLine(have ?? 0, close, n, r.match) : ""}` : ""}
      ${futuresLine(null)}
      ${goalNote(g)}
    </header>`;
  const details = `<button class="btn btn-ghost sm" type="button" data-esco-sheet="${esc(id.slice(5))}"><i data-lucide="info"></i>${esc(t("jobs.escoDetails"))}</button>`;
  if (!xp) return `<div class="stack">${backRow()}${head}${loadingBox(t("jobs.escoLoading"))}</div>`;
  const sdgBox = pathSdgHtml(id, (xp.missing || []).map(m => escoSkill(mid(m.id), m.name)));
  if (xp.none || !xp.route) return `<div class="stack">${backRow()}${head}${sdgBox}${details}${futuresHtml(null)}</div>`;
  // the route choice: "Safer route available" (only sent when it differs), or on the safer route a way back
  const safest = normMode(UI.mode) === "safest";
  const options = xp.safer && !safest ? card("safest", t("path.saferH"), saferLine(xp.safer.avoids || [], nm), xp.safer.addedWeeks != null ? `<span class="risk">${esc(saferWeeks(xp.safer.addedWeeks))}</span>` : "")
    : safest ? card("closest", t("path.backEasiest"), t("mode.note.closest"), "") : "";
  let k = 0;
  const rows = [stepRow({ kind: "start", title: currentJobTitle() ? t("path.youToday", { job: currentJobTitle() }) : t("path.youTodayNoJob"), node: S.E.root })];
  const onRoute = new Set(xp.route), missOf = node => (xp.missing || []).find(m => mid(m.id) === node);
  // the other skills to build sit under the key step they're learned with, like the "+N" clusters on the map
  const byStep = new Map(), loose = [];
  (xp.missing || []).filter(m => !onRoute.has(mid(m.id))).forEach(m => {
    const at = m.group && onRoute.has(mid(m.group)) ? mid(m.group) : null;
    if (at) { if (!byStep.has(at)) byStep.set(at, []); byStep.get(at).push(m); } else loose.push(m);
  });
  const subRow = m => stepRow({ kind: "reskill", title: cap(m.name) || nm(m.id), hours: m.hours, node: mid(m.id) });
  xp.route.slice(1, -1).forEach(node => {
    const ai = isAiEra(node);
    if (kindOf(node) === "have") rows.push(stepRow({ kind: "reuse", title: nameOf(node), sub: t("path.haveIt"), node }));
    else {
      rows.push(stepRow({ kind: "reskill", title: nameOf(node), sub: ai ? t("aiEra.badge") : "", hours: missOf(node)?.hours ?? (xp.legWeeks?.[node] != null ? xp.legWeeks[node] * 6 : null), node, n: ++k }));
      rows.push(...groupRows(node, (byStep.get(node) || []).map(m => ({ hours: m.hours, html: subRow(m) }))));
    }
  });
  rows.push(...alsoRows(loose.map(m => ({ html: subRow(m) }))));
  rows.push(stepRow({ kind: "arrive", title: nameOf(id), sub: t("path.arrive"), node: id }));
  const emerging = (xp.emerging || []).length ? `<div class="esco-emg"><span class="esco-emg-k">${esc(t("jobs.escoEmerging"))}</span>${xp.emerging.slice(0, 3).map(e => `<button class="link-btn" type="button" data-xs="xs:${esc(e)}">${esc(nameOf("xs:" + e))}</button>`).join("")}</div>` : "";
  return `<div class="stack">
    ${backRow()}${head}
    ${sdgBox}
    <section><h3 class="sec-h">${esc(t("path.routeYours"))}<span class="sec-meta">${esc(t("mode." + normMode(UI.mode)))}</span></h3>
      ${options}
      <ol class="steps">${rows.join("")}</ol>
      ${emerging}
    </section>
    ${futuresHtml(null)}
    ${details}
  </div>`;
}

// ---------- My goal tab: what to do this week, "Stay AI-ready in your job", your move (features/goal-ui.js) ----------
export const renderGoal = () => renderGoalTab();
export const bindGoal = el => bindGoalTab(el);

// ---------- future stress test: the plan replayed in 1,000 simulated futures ----------
// 1,000 runs take a few milliseconds, so they run on the main thread; results are cached per plan.
const stressCache = new Map();
function stressRun(j) {
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
  } catch (e) { console.warn("stress test failed", e); return null; }
  return r;
}
/** One line under the weeks figure: the stress-test result, linking down to its chart. */
function stressLine(j) {
  const r = stressRun(j);
  if (!r?.route) return "";
  const tone = r.rate >= 90 ? "good" : r.rate >= 67 ? "warn" : "crit";
  return `<button class="link-btn stress-jump t-${tone}" type="button" data-jump-stress><i data-lucide="${tone === "good" ? "shield-check" : "shield-alert"}"></i>${esc(t("stress.short", { pct: r.rate + "%", n: r.runs.toLocaleString("en-US") }))}</button>`;
}
function stressHtml(j) {
  const r = stressRun(j);
  if (!r?.route) return "";
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
    ${futuresChart(r)}
    ${pats ? `<div class="sub-h">${esc(t("stress.patterns"))}</div><ul class="alt-list">${pats}</ul>` : ""}
    ${fixes ? `<div class="sub-h">${esc(t("stress.sturdier"))}</div><ul class="alt-list">${fixes}</ul>` : ""}
    <details class="src-details"><summary>${esc(t("stress.how"))}</summary><p class="src">${esc(t("stress.intro", { n: runs }))}</p><ul class="src stress-in">${inputs}</ul><p class="src">${esc(t("stress.method"))}</p></details></section>`;
}

// When you're job-ready across the futures: one column per week, the part where the plan holds in green, where it
// fails in red, and the range that 8 in 10 futures fall in.
function futuresChart(r) {
  const f = r.futures || [];
  if (!f.length) return "";
  const ws = f.map(x => x.weeks).sort((a, b) => a - b);
  const q = p => ws[Math.floor(p * (ws.length - 1))];
  const lo = ws[0], hi = ws[ws.length - 1], step = Math.max(1, Math.ceil((hi - lo + 1) / 28));
  const bins = Array.from({ length: Math.floor((hi - lo) / step) + 1 }, (_, i) => ({ from: lo + i * step, ok: 0, bad: 0 }));
  f.forEach(x => { const b = bins[Math.floor((x.weeks - lo) / step)]; if (x.ok) b.ok++; else b.bad++; });
  const max = Math.max(...bins.map(b => b.ok + b.bad));
  const a = q(0.1), b = q(0.9), bad = f.length - f.filter(x => x.ok).length;
  const wk = b0 => (step === 1 ? String(b0.from) : `${b0.from}–${b0.from + step - 1}`);
  const cols = bins.map(c => `<div class="fc-col" title="${esc(t("stress.binTip", { n: c.ok + c.bad, w: wk(c), bad: c.bad }))}">
      ${c.bad ? `<span class="fc-bad" style="height:${(100 * c.bad / max).toFixed(1)}%"></span>` : ""}${c.ok ? `<span class="fc-ok" style="height:${(100 * c.ok / max).toFixed(1)}%"></span>` : ""}</div>`).join("");
  return `<figure class="fc" aria-label="${esc(t("stress.range", { a, b }))}">
    <p class="fc-range">${esc(a === b ? t("stress.rangeOne", { a }) : t("stress.range", { a, b }))}</p>
    <div class="fc-bars">${cols}</div>
    <div class="fc-axis"><span>${esc(t("stress.wk", { n: lo }))}</span><span>${esc(t("stress.wk", { n: hi }))}</span></div>
    <figcaption class="fc-key"><span><i class="fc-ok"></i>${esc(t("stress.kOk", { n: (f.length - bad).toLocaleString("en-US") }))}</span>${bad ? `<span><i class="fc-bad"></i>${esc(t("stress.kBad", { n: bad.toLocaleString("en-US") }))}</span>` : ""}</figcaption>
  </figure>`;
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
const onTeam = () => S.profile?.employerId != null;
function saveHtml() {
  const mine = plansForJob(UI.job);
  const latest = mine[0];
  const pend = mine.find(p => pendingOf(p));
  const sample = S.profileFallback;
  // a keep-or-switch offer from a knowledge change shows for everyone (setting a goal saves the plan)
  const offer = pend ? `<div class="reroute-card">${badge("b-warn", t("reroute.badge"), "route")}<p>${esc(t("reroute.offer", { route: routeText(pendingOf(pend)) }))}</p>
      <div class="rv-actions"><button class="btn btn-primary" type="button" data-route="switch" data-plan="${esc(pend.id)}"><i data-lucide="shuffle"></i>${esc(t("reroute.switch"))}</button><button class="btn btn-soft" type="button" data-route="keep" data-plan="${esc(pend.id)}">${esc(t("reroute.keep"))}</button></div></div>` : "";
  // Sign-off is only for people on an employer's team (HR approves before the company pays or moves them);
  // someone planning on their own decides by setting the goal.
  if (!onTeam()) return offer ? `<div class="msec">${offer}</div>` : "";
  return `<div class="msec">
    <h4>${esc(t("plan.advisorH"))}</h4>
    ${offer}
    ${latest ? `<div class="plan-status">${statusBadge(latest.status)}<span class="rs">${esc(t("plan.savedAs", { mode: t("mode." + normMode(latest.mode)), id: latest.id }))}</span></div>
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
      let p = plansForJob(UI.job).find(x => x.status === "draft" && normMode(x.mode) === normMode(UI.mode)) || await savePlan();
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
    b.addEventListener("click", () => {
      previewRoute(null);
      // an ESCO job's other route comes from the server
      if (UI.escoJob) { actions.setMode(b.dataset.mode); actions.selectEsco(UI.escoJob, { tab: "path", animate: false, quiet: true }); return; }
      if (isGoal(UI.job)) setGoalMode(b.dataset.mode); actions.setMode(b.dataset.mode);
    });
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
    if (!S.profile?.isDemo && !S.profileFallback && !plansForJob(UI.job).some(x => normMode(x.mode) === normMode(UI.mode)))
      savePlan().then(() => repaintSave(), e => console.warn("Saving the goal as a plan failed", e));
  });
  el.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", () => actions.openDrawer(b.dataset.open)));
  el.querySelectorAll(".req-row[data-skill]").forEach(b => {
    b.addEventListener("click", () => actions.openDrawer(b.dataset.skill));
    b.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); actions.openDrawer(b.dataset.skill); } });
  });
  const more = el.querySelector("#plan-more"); if (more) more.addEventListener("toggle", () => { UI.planMore = more.open; });
  const aa = el.querySelector("#also-all"); if (aa) aa.addEventListener("click", () => { UI.alsoAll = true; el.querySelectorAll(".also-more").forEach(x => x.classList.remove("also-more")); aa.closest("li").remove(); });
  const hs = el.querySelector("#hours-sel"); if (hs) hs.addEventListener("change", () => { actions.setHours(hs.value); $("hours-sel")?.focus({ preventScroll: true }); });
  el.querySelectorAll("[data-jump-stress]").forEach(b => b.addEventListener("click", () => el.querySelector(".stress")?.scrollIntoView({ behavior: "smooth", block: "start" })));
  el.querySelectorAll("[data-grp]").forEach(b => b.addEventListener("click", () => {
    const node = b.dataset.grp, open = b.getAttribute("aria-expanded") !== "true";
    UI.grpOpen ||= new Set(); if (open) UI.grpOpen.add(node); else UI.grpOpen.delete(node);
    b.setAttribute("aria-expanded", String(open));
    el.querySelectorAll(`[data-grp-of="${CSS.escape(node)}"]`).forEach(r => { r.hidden = !open; });
  }));
  el.querySelectorAll("[data-tab-jobs]").forEach(b => b.addEventListener("click", () => document.getElementById("tab-jobs").click()));
  el.querySelectorAll("[data-tab-goal]").forEach(b => b.addEventListener("click", () => actions.openGoalTab()));
  const gg = el.querySelector("#goto-goal"); if (gg) gg.addEventListener("click", () => { const g = goal(); if (g) { UI.mode = g.mode || UI.mode; actions.showPath(g.job); } });
  el.querySelectorAll("[data-esco-sheet]").forEach(b => b.addEventListener("click", () => openSheet("esco", b.dataset.escoSheet)));
  el.querySelectorAll("[data-xs]").forEach(b => b.addEventListener("click", () => actions.openDrawer(b.dataset.xs)));
  bindFutures(el);
  const jm = el.querySelector("#job-more"); if (jm) jm.addEventListener("toggle", () => { UI.jobMore = jm.open; });
  const ec = el.querySelector("#emp-clear"); if (ec) ec.addEventListener("click", () => actions.setEmployer(null));
  const box = $("plan-server"); if (box) bindServer(box);
  const sb = $("plan-save"); if (sb) bindSave(sb);
  if (!UI.escoJob) ensureServer();
}

/** Forget the cached server plan (after a knowledge change). */
export function invalidate() { server.key = ""; server.data = null; }
