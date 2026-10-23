// Demo guide: walks a first-time viewer through the loop that matters most — pick a job, compare route types,
// look ahead to 2030, run the market scout, then approve a change and watch the route reroute.
// It never blocks the app: the spotlight ignores clicks, any click elsewhere puts it away, and the tour can be
// skipped or minimised. "Tour done" and "minimised" are remembered in localStorage (store() wraps it in try/catch).
import { S, UI, actions, nameOf, W, matchOf } from "../state.js";
import { MODES } from "/shared/engine.js";
import { t } from "../i18n.js";
import { $, esc, icons, reduce, store } from "../util.js";
import { setAgentsOpen } from "./status.js";
import { hasRole } from "./auth.js";
import { A, pendingCount } from "../panels/admin.js";

const done = { job: false, mode: false, future: false, scout: false, signal: false };
let skipped = store.get("tourDone", false);
let min = store.get("guideMin", false);
let last = null, okMsg = "", timer = 0, reroute = null, autoShown = false;

const blocked = () => !$("ob")?.hidden || !$("auth")?.hidden;
const routeKey = (j, m) => { try { return S.E.planFor(j, m)?.route?.key || null; } catch { return null; } };
/** The job to demo: the one whose route types differ most (so step 2 visibly changes something), then the best match. */
const best = () => {
  if (!S.E || !UI.ring.length) return UI.ring[0];
  const kinds = j => new Set(MODES.map(m => routeKey(j, m)).filter(Boolean)).size;
  return [...UI.ring].sort((a, b) => kinds(b) - kinds(a) || matchOf(b) - matchOf(a))[0];
};
/** The route type whose road differs most from the current one for this job (most steps not shared). */
const otherMode = () => {
  const nodes = m => { try { return S.E.planFor(UI.job, m)?.route?.nodes || []; } catch { return []; } };
  const now = new Set(nodes(UI.mode)), diff = m => nodes(m).filter(k => !now.has(k)).length;
  const alt = MODES.filter(m => m !== UI.mode).sort((a, b) => diff(b) - diff(a))[0];
  return alt || (UI.mode === "noregret" ? "fastest" : "noregret");
};
const panel = sel => $("panel")?.querySelector(sel);
const toUser = () => { if (UI.view === "admin") actions.setView("user"); };
const closeDr = () => { if (UI.drawer) actions.closeDrawer?.(); };

const STEPS = [
  { id: "job",
    target: () => UI.view === "admin" ? [$("admin-btn"), "guide.tip.back"] : UI.tab !== "jobs" ? [$("tab-jobs"), "guide.tip.jobs"]
      : [panel(`.job-hit[data-job="${CSS.escape(best() || "")}"]`) || panel(".job-hit"), "guide.tip.job"],
    act: () => { toUser(); if (best()) actions.selectJob(best()); },
    ok: () => t("guide.ok.job", { job: nameOf(UI.job) }) },
  { id: "mode",
    prep: () => { if (innerWidth < 980) closeDr(); },
    target: () => UI.view === "admin" ? [$("admin-btn"), "guide.tip.back"] : UI.tab !== "path" ? [$("tab-path"), "guide.tip.path"] : [panel(".mode-seg"), "guide.tip.mode"],
    act: () => { toUser(); if (!UI.picked && best()) actions.selectJob(best()); closeDr(); UI.tab = "path"; actions.setMode(otherMode()); },
    ok: () => t("guide.ok.mode", { mode: t("mode." + UI.mode) }) },
  { id: "future",
    prep: closeDr,
    target: () => [document.querySelector(".timeline"), "guide.tip.future"],
    act: () => { closeDr(); actions.play?.(); },
    ok: () => t("guide.ok.future") },
  { id: "scout", admin: true,
    prep: () => { closeDr(); setAgentsOpen(true); },
    target: () => [$("scout"), "guide.tip.scout"],
    act: () => { setAgentsOpen(true); if (!A.scout.running) $("scout").click(); },
    ok: () => pendingCount() ? t("guide.ok.scoutN", { n: pendingCount() }) : t("guide.ok.scout") },
  { id: "signal", admin: true,
    prep: closeDr,
    target: () => UI.view !== "admin" ? [$("admin-btn"), "guide.tip.review"] : [panel(`[data-approve="${CSS.escape(String(pickSignal()?.id ?? ""))}"]`) || panel("[data-approve]"), "guide.tip.approve"],
    act: () => {
      closeDr();
      // show the case where approving visibly matters: today's forecast, on a job whose route runs through the changed skill
      if (S.year !== 2026 || S.scenario !== "moderate") actions.setForecast(2026, "moderate");
      const sig = pickSignal(true);
      if (UI.view !== "admin") actions.setView("admin");
      // the queue loads asynchronously: approve that change once it is on screen
      let n = 0;
      const tryApprove = () => {
        const b = (sig && panel(`[data-approve="${CSS.escape(String(sig.id))}"]:not([disabled])`)) || panel("[data-approve]:not([disabled])");
        if (b) { b.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" }); b.click(); } else if (++n < 20) setTimeout(tryApprove, 300);
      };
      setTimeout(tryApprove, reduce ? 100 : 900);
    },
    ok: () => t("guide.ok.signal") },
];
/** The waiting change that lies on a route to one of the user's jobs (and, with apply, switch the planner to that route). */
function pickSignal(apply = false) {
  const sigs = (A.review?.pending || []).filter(x => x.nodeId);
  if (!sigs.length || !S.E) return sigs[0] || null;
  const jobs = [...new Set([UI.job, ...UI.ring].filter(Boolean))], modes = [UI.mode, ...MODES.filter(m => m !== UI.mode)];
  for (const sig of sigs) for (const m of modes) for (const j of jobs) {
    let r = null; try { r = S.E.planFor(j, m)?.route; } catch { r = null; }
    if (r?.nodes?.includes(sig.nodeId)) {
      if (apply && (UI.job !== j || UI.mode !== m)) { UI.job = j; UI.picked = true; UI.tab = "path"; actions.setMode(m); }
      return sig;
    }
  }
  return sigs[0];
}
const steps = () => STEPS.filter(s => !s.admin || hasRole("admin"));
const next = () => steps().find(s => !done[s.id]);

// ---------- spotlight ----------
const SPOT = { get: null, el: null, raf: 0, shown: false };
function spotOn(get) {
  const s = $("spot"); if (!s) return;
  SPOT.get = get; SPOT.el = null; SPOT.shown = false;
  cancelAnimationFrame(SPOT.raf);
  s.classList.remove("move");
  const track = () => {
    if (!SPOT.get) return;
    if (!SPOT.el || !SPOT.el.isConnected) {
      const tg = SPOT.get(); SPOT.el = tg && tg[0];
      if (SPOT.el) { $("spot-tip").innerHTML = `<i data-lucide="mouse-pointer-click"></i>${esc(t(tg[1]))}`; icons(); if (!SPOT.shown) SPOT.el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" }); }
    }
    const r = SPOT.el && SPOT.el.getBoundingClientRect();
    if (!r || !r.width || blocked()) s.classList.remove("on");
    else {
      const pad = 6;
      s.style.left = (r.left - pad) + "px"; s.style.top = (r.top - pad) + "px";
      s.style.width = (r.width + pad * 2) + "px"; s.style.height = (r.height + pad * 2) + "px";
      s.classList.toggle("above", r.bottom + 64 > innerHeight);
      if (!SPOT.shown) { SPOT.shown = true; s.classList.add("on"); requestAnimationFrame(() => s.classList.add("move")); }
    }
    SPOT.raf = requestAnimationFrame(track);
  };
  track();
}
function spotOff() { SPOT.get = null; SPOT.el = null; cancelAnimationFrame(SPOT.raf); $("spot")?.classList.remove("on", "move"); }

function showStep(step) {
  if (!step || min || skipped || blocked()) return;
  step.prep?.();
  spotOn(step.target);
}

// ---------- public ----------
/** A step was done by the user (or by "Show me"). */
export function mark(id) { if (id in done && !done[id]) { done[id] = true; render(); } }

/** An approved change reloaded the knowledge base: remember the before/after for the summary. */
export function rerouted({ job, oldRoute, newRoute, signal }) {
  const stops = r => r ? r.nodes.slice(1, -1).map(nameOf) : [];
  reroute = { job, before: oldRoute ? W(oldRoute.weeks) : null, after: newRoute ? W(newRoute.weeks) : null, from: stops(oldRoute), to: stops(newRoute), skill: signal?.nodeId ? nameOf(signal.nodeId) : null };
  mark("signal");
}

/** Start (or restart) the tour, e.g. from the menu. */
export function start() {
  Object.keys(done).forEach(k => { done[k] = false; });
  skipped = false; min = false; okMsg = ""; last = null; reroute = null;
  store.set("tourDone", false); store.set("guideMin", false);
  render();
  setTimeout(() => showStep(next()), 300);
}

/** Point at the first step once, after first-time setup is out of the way. */
export function intro() {
  if (autoShown || skipped) return;
  autoShown = true;
  if (innerWidth < 980) return; // on phones the map comes first; the guide points only when asked
  setTimeout(() => showStep(next()), reduce ? 300 : 1800);
}

function finish() { skipped = true; store.set("tourDone", true); spotOff(); clearTimeout(timer); render(); }

function summary() {
  const r = reroute;
  if (!r || r.before === null || r.after === null) return `<div class="g-why">${esc(t("guide.applied"))}</div>`;
  const same = r.before === r.after && r.from.join() === r.to.join();
  if (same) return `<div class="g-why"><b>${esc(nameOf(r.job))}</b> ${esc(t("guide.sameWeeks", { w: r.after }))}</div>`;
  return `<div class="g-ba"><span class="b">${r.before} ${esc(t("common.wk"))}</span><i data-lucide="arrow-right"></i><span class="a">${r.after} ${esc(t("common.wk"))}</span><small>${esc(nameOf(r.job))}</small></div>
    <div class="g-why">${esc(same ? t("guide.same") : t("guide.changed"))}</div>
    ${same ? "" : `<div class="g-route"><div><span>${esc(t("guide.before"))}</span><s>${esc(r.from.join(" → ") || "–")}</s></div><div><span>${esc(t("guide.now"))}</span><em>${esc(r.to.join(" → ") || "–")}</em></div></div>`}`;
}

export function render() {
  const g = $("guide"); if (!g) return;
  // the scout has run (now, or on its schedule) once there are flagged changes waiting for a person
  if (!A.scout.running && (A.scout.result || A.scout.err || pendingCount() > 0)) done.scout = true;
  g.hidden = skipped;
  if (skipped) { spotOff(); return; }
  const list = steps(), nx = next(), n = list.filter(s => done[s.id]).length;
  // a step was just completed: say so, then point at the next one
  if (last && last !== nx && done[last.id]) {
    okMsg = last.ok(); clearTimeout(timer); spotOff();
    if (nx && innerWidth >= 980) timer = setTimeout(() => { if (next() === nx) showStep(nx); }, reduce ? 200 : 1400);
  }
  if (!nx && last) spotOff();
  last = nx;
  // Tour finished and nothing left to show: get out of the way (the menu can restart it).
  if (!nx && !reroute) { g.hidden = true; return; }
  const dots = list.map(s => `<i class="${done[s.id] ? "on" : s === nx ? "now" : ""}"></i>`).join("");
  g.classList.toggle("min", min);
  g.classList.toggle("done", !nx);
  const top = `<div class="g-top"><span class="g-k"><i data-lucide="${nx ? "map" : "circle-check"}"></i>${esc(nx ? t("guide.step", { n: list.indexOf(nx) + 1, total: list.length }) : t("guide.complete"))}</span>
    <span class="g-dots" role="img" aria-label="${esc(t("guide.progress", { n, total: list.length }))}">${dots}</span>
    <button class="g-x" id="g-min" type="button" aria-expanded="${!min}" aria-label="${esc(t(min ? "guide.show" : "guide.hide"))}"><i data-lucide="${min ? "chevron-down" : "chevron-up"}"></i></button></div>`;
  const ok = okMsg && nx ? `<div class="g-ok" role="status"><i data-lucide="circle-check"></i>${esc(okMsg)}</div>` : "";
  const body = nx
    ? `${ok}<div class="g-row"><div class="g-t">${esc(t("guide.t." + nx.id))}<small>${esc(t("guide.d." + nx.id))}</small>
        <span class="g-acts"><button class="g-where" id="g-where" type="button">${esc(t("guide.where"))}</button><button class="g-skip" id="g-skip" type="button">${esc(t("guide.skip"))}</button></span></div>
        <button class="btn g-go" id="g-go" type="button">${esc(t("guide.go"))}</button></div>`
    : `${reroute ? summary() : okMsg ? `<div class="g-ok" role="status"><i data-lucide="circle-check"></i>${esc(okMsg)}</div>` : ""}<div class="g-row"><div class="g-t"><span class="g-acts"><button class="g-again" id="g-again" type="button">${esc(t("guide.again"))}</button><button class="g-skip" id="g-skip" type="button">${esc(t("guide.close"))}</button></span></div>
        ${reroute && (reroute.before !== reroute.after || reroute.from.join() !== reroute.to.join()) ? `<button class="btn g-go" id="g-see" type="button">${esc(t("guide.see"))}</button>` : ""}</div>`;
  g.innerHTML = top + `<div class="g-body">${body}</div>`;
  $("g-min").addEventListener("click", () => { min = !min; store.set("guideMin", min); if (min) spotOff(); render(); });
  $("g-skip")?.addEventListener("click", finish);
  $("g-where")?.addEventListener("click", () => showStep(nx));
  $("g-go")?.addEventListener("click", () => {
    showStep(nx); // point at the control first, then do the step
    setTimeout(() => { spotOff(); nx.act(); }, reduce || min ? 150 : 750);
  });
  $("g-see")?.addEventListener("click", () => { spotOff(); if (UI.view === "admin") actions.setView("user"); UI.tab = "path"; actions.renderPanel(); hint(panel(".steps")); });
  $("g-again")?.addEventListener("click", start);
  icons();
}

function hint(el) {
  if (!el) return;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  el.classList.remove("hint"); void el.offsetWidth; el.classList.add("hint");
  setTimeout(() => el.classList.remove("hint"), 3600);
}

export function initGuide() {
  // any click or key outside the guide puts the spotlight away; the control underneath still works
  document.addEventListener("pointerdown", e => { if (SPOT.get && !e.target.closest?.("#guide")) spotOff(); }, true);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && SPOT.get) spotOff(); });
  addEventListener("resize", () => { if (SPOT.get) SPOT.el = null; });
}
