// HalaTuju web app: boot, the refresh loop, and app-level actions.
// Data: GET /api/graph + GET /api/profile/:id; the shared engine recomputes in the browser on every change.
// One failed call never blanks the page: each feature shows its own "not available yet" or "retry" state.
import { S, UI, D, actions, rebuild, computeRing, computePlans, N, nameOf, W, matchOf, profileId, setProfileId, normaliseProfile, FALLBACK_PROFILE, isSampleProfile } from "./state.js";
import { get, put, post } from "./api.js";
import { initI18n, t, setLang, getLang, applyStatic, onLangChange } from "./i18n.js";
import { $, esc, icons, reduce, toast, badge, extLink, fmtDate, store, enter, errorBox, bindRetry } from "./util.js";
import * as G from "./graph3d.js";
import * as Jobs from "./panels/jobs.js";
import * as Path from "./panels/path.js";
import * as Skills from "./panels/skills.js";
import * as Admin from "./panels/admin.js";
import { openDrawer, closeDrawer, refreshDrawer, forgetEmployers } from "./drawer.js";
import { initWhy, close as closeWhy } from "./features/why.js";
import { openOnboarding, initOnboarding } from "./features/onboarding.js";
import { openSheet, initSheets } from "./features/views.js";
import { loadHealth, renderStatus, renderAgents, initAgents } from "./features/status.js";
import { loadPlans, pendingPlans, routeUpdate, routeText, planJob, pendingOf } from "./features/plans.js";
import { AUTH, initAuth, initAuthScreen, openAuth, closeAuth, openDeleteData, signOut, hasRole } from "./features/auth.js";
import * as Guide from "./features/guide.js";
import { goal, progress } from "./features/goal.js";

// ---------- header ----------
function initials(name) { return (name || "?").replace(/\(.*?\)/g, "").trim().split(/\s+/).slice(0, 2).map(s => s[0] || "").join("").toUpperCase() || "?"; }

function renderHead() {
  const E = S.E, p = S.profile;
  $("avatar").textContent = initials(p.displayName);
  $("me-name").textContent = p.displayName || t("me.you");
  $("me-meta").textContent = t("me.meta", { job: nameOf(E.root), h: p.hours });
  $("sample-badge").hidden = !isSampleProfile();
  // Goal line: the job you committed to and how far along you are (or a nudge to set one).
  const g = goal();
  if (g && E.isJob(g.job)) {
    let gp = null; try { gp = E.planFor(g.job, g.mode || UI.mode); } catch { gp = null; }
    const pr = progress(gp);
    $("scorebar").innerHTML = `<button class="goal-line" type="button" id="goal-line"><i data-lucide="flag"></i><span><b>${esc(nameOf(g.job))}</b>${pr ? `<small>${esc(t("goal.headProg", { done: pr.done, total: pr.total, w: W(pr.left) }))}</small>` : ""}</span><i data-lucide="chevron-right"></i></button>`;
    $("goal-line").onclick = () => { closeJobDrawer(); if (!UI.ring.includes(g.job)) UI.pinned = g.job; UI.job = g.job; UI.mode = g.mode || UI.mode; UI.tab = "path"; UI.view = "user"; UI.picked = true; refresh({ animate: true }); };
  } else $("scorebar").innerHTML = `<p class="goal-none">${esc(t("goal.none"))}</p>`;
  $("map-sum").textContent = t(S.escoJobs ? "map.sum" : "map.sumShort", { j: UI.ring.length, total: (S.escoJobs || 0).toLocaleString("en-MY") });
  const nb = $("notice");
  if (S.profileFallback) { nb.hidden = false; nb.innerHTML = `${badge("b-warn", t("src.sample"))}<span>${esc(t("notice.fallback"))}</span><button class="ghost sm" type="button" id="notice-retry"><i data-lucide="refresh-cw"></i>${esc(t("state.retry"))}</button>`; $("notice-retry").onclick = () => actions.loadProfile(profileId()); }
  else if (S.localOnly) { nb.hidden = false; nb.innerHTML = `${badge("b-warn", t("notice.localBadge"))}<span>${esc(t("notice.local"))}</span>`; }
  else nb.hidden = true;
  G.setRingNames(["", t("ring.skills"), t("ring.learn"), UI.sector === "best" ? t("ring.best") : t("ring.sector", { name: (S.graph.sectors || []).find(s => s.id === UI.sector)?.name || "" })]);
}

// ---------- panel ----------
let lastPanelKey = "";
function renderPanel(animate) {
  const el = $("panel");
  const key = UI.view + ":" + UI.tab;
  if (key !== lastPanelKey) { lastPanelKey = key; const sb = document.querySelector(".side-body"); if (sb) sb.scrollTop = 0; }
  $("tabs").hidden = UI.view === "admin";
  const mod = UI.view === "admin" ? Admin : UI.tab === "jobs" ? Jobs : UI.tab === "path" ? Path : Skills;
  try { el.innerHTML = mod.render(); }
  catch (e) { console.error(e); el.innerHTML = errorBox({ message: t("state.renderFailed") }); }
  ["jobs", "path", "skills"].forEach(tb => { const b = $("tab-" + tb); b.setAttribute("aria-selected", String(UI.tab === tb)); b.tabIndex = UI.tab === tb ? 0 : -1; });
  $("admin-btn").setAttribute("aria-pressed", String(UI.view === "admin"));
  try { mod.bind(el); } catch (e) { console.error(e); }
  icons();
  if (animate) enter(el.querySelectorAll(".job, .step, .skill, .card, .result, .rv"));
}

function updateAdminCount() {
  const n = Admin.pendingCount(), c = $("admin-count");
  c.textContent = n ?? ""; c.hidden = !n;
  renderAgents();
}

// ---------- refresh ----------
function refresh({ reroute = false, animate = false } = {}) {
  if (!S.graph || !S.profile) return false;
  const prev = D.plan?.route?.key;
  try { rebuild(); } catch (e) { console.error(e); return false; }
  computeRing(); computePlans();
  const relaid = G.applyLayout(true);
  renderHead(); renderPanel(animate); renderAgents(); renderStatus(); Guide.render();
  $("year-out").textContent = S.year; $("year").value = S.year;
  $("year").setAttribute("aria-valuetext", String(S.year));
  refreshDrawer();
  const changed = reroute && prev !== D.plan?.route?.key;
  if (changed) G.wave(S.E.root, "#f08a5d", 1.6, 620);
  if (changed && G.isReady() && !relaid) {
    $("rerouting").classList.add("show");
    setTimeout(() => { $("rerouting").classList.remove("show"); G.restyle(); }, reduce ? 200 : 1000);
  } else G.restyle();
  return changed;
}

// ---------- data loading ----------
/** How many jobs the full ESCO list has, for the map's coverage line. Optional: the line drops "of N" without it. */
function loadEscoCount() {
  get("/esco/stats").then(r => { const n = r?.counts?.occupations; if (n) { S.escoJobs = n; if (S.E) renderHead(); } }).catch(() => {});
}

async function loadGraph() {
  S.graph = await get("/graph", null, { timeout: 20000 });
  if (!S.graph?.nodes || !S.graph.edges || !S.graph.req) throw new Error(t("boot.badGraph"));
}

async function loadProfile(id) {
  try {
    S.profile = normaliseProfile(await get(`/profile/${id}`));
    S.profileFallback = false;
  } catch (e) {
    // Gone, or not this visitor's profile (signed out, or another account): fall back to the sample persona.
    if ((e.status === 404 && !e.notAvailable || e.status === 401 || e.status === 403) && id !== 1) { setProfileId(1); return loadProfile(1); }
    console.warn("Profile unavailable, using the built-in sample persona", e);
    S.profile = normaliseProfile(FALLBACK_PROFILE);
    S.profileFallback = true;
  }
  S.localOnly = false;
  UI.sdg = S.profile.sdgPriority || null; UI.rank = null; UI.rankErr = null;
}

function bootError(err) {
  const msg = `<div class="boot-err">${errorBox(err, "boot")}<p class="note">${esc(t("boot.failed"))}</p></div>`;
  $("panel").innerHTML = msg;
  $("graph").innerHTML = `<div class="nograph">${esc(t("boot.failedMap"))}</div>`;
  bindRetry($("panel"), { boot: () => location.reload() });
  icons();
}

// ---------- the key moment: an approved change reroutes the map ----------
async function knowledgeChanged({ reason = "change", signal = null, rerouted = null } = {}) {
  const job = UI.job, oldRoute = D.plan?.route || null, oldMatch = job ? matchOf(job) : null;
  try { await loadGraph(); }
  catch (e) { toast({ title: t("reroute.reloadFailed"), detail: e.message, badgeHtml: badge("b-crit", t("state.error")) }); return; }
  Path.invalidate(); forgetEmployers();
  // Keep following the same job: if the change drops its match out of the job list, pin it so its reroute shows.
  if (job) { rebuild(); computeRing(); if (UI.job !== job && N(job)) { UI.pinned = job; UI.job = job; } }
  if (signal?.nodeId) S.signalNode = signal.nodeId;
  if (UI.sdg) await Jobs.loadRank();
  refresh();
  const newRoute = D.plan?.route || null;
  if (reason === "approve") Guide.rerouted({ job, oldRoute, newRoute, signal });
  const routeChanged = !!(oldRoute && job === UI.job && (!newRoute || newRoute.key !== oldRoute.key));
  if (window.innerWidth < 980 && routeChanged) $("stage").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  if (routeChanged) {
    $("rerouting").classList.add("show");
    setTimeout(() => $("rerouting").classList.remove("show"), reduce ? 200 : 900);
    // Fly to the skill the change hit while the old route fades, then back out to show the new route.
    const flyTo = signal?.nodeId && N(signal.nodeId) ? signal.nodeId : null;
    if (flyTo) { G.focusNode(flyTo); G.wave(flyTo, "#f2b33d", 1.9, 560); }
    G.fadeOldRoute(oldRoute, flyTo ? () => G.resetView(true) : undefined);
  } else G.restyle();
  const src = signal ? `${signal.title ? `<b>${esc(signal.title)}</b><br>` : ""}${extLink(signal.sourceUrl, signal.sourceTitle || t("why.source"))}${signal.sourceDate ? ", " + esc(fmtDate(signal.sourceDate)) : ""}${signal.isSample ? " " + badge("b-warn", t("src.sample")) : ""}` : "";
  const others = Array.isArray(rerouted) && rerouted.length ? `<br>${esc(t("reroute.others", { n: rerouted.length }))}` : "";
  const newMatch = job && N(job) ? matchOf(job) : null;
  if (routeChanged) {
    toast({
      title: t("reroute.title", { job: nameOf(job) }),
      detailHtml: `${esc(t("reroute.fromTo", { from: G_routeStops(oldRoute), to: newRoute ? G_routeStops(newRoute) : t("reroute.noRoute"), weeks: newRoute ? W(newRoute.weeks) : "–" }))}${src ? "<br>" + src : ""}${others}`,
      badgeHtml: badge("b-info", t("reroute.badgeNew"), "route"), ms: 11000,
    });
  } else {
    toast({
      title: t(reason === "undo" ? "reroute.undone" : "reroute.applied"),
      detailHtml: `${job ? esc(t("reroute.same", { job: nameOf(job), a: oldMatch, b: newMatch })) : ""}${src ? "<br>" + src : ""}${others}`,
      badgeHtml: badge("b-good", t("reroute.appliedBadge")), ms: 8000,
    });
  }
  await reloadPlans();
  showPendingPrompt();
}
const G_routeStops = r => r.nodes.slice(1, -1).map(nameOf).join(" → ") || "–";

async function approveSignal(sig, note) {
  $("rerouting").classList.add("show");
  let res;
  try { res = await post(`/review/signals/${sig.id}/approve`, note ? { note } : {}, { timeout: 30000 }); }
  finally { $("rerouting").classList.remove("show"); }
  const s = { ...sig, ...(res.signal || {}) };
  await knowledgeChanged({ reason: "approve", signal: s, rerouted: res.rerouted });
}

function showPendingPrompt() {
  const box = $("prompt");
  const p = pendingPlans()[0];
  if (!p) { box.hidden = true; return; }
  box.hidden = false;
  const pr = pendingOf(p);
  box.innerHTML = `<div class="tt">${badge("b-warn", t("reroute.badge"), "route")}<span>${esc(t("reroute.promptTitle", { job: nameOf(planJob(p)) }))}</span></div>
    <p class="td">${esc(t("reroute.offer", { route: routeText(pr) }))}${pr?.reason ? " " + esc(pr.reason) : ""}</p>
    <div class="rv-actions"><button class="btn btn-primary" type="button" data-pr="switch"><i data-lucide="shuffle"></i>${esc(t("reroute.switch"))}</button><button class="btn btn-soft" type="button" data-pr="keep">${esc(t("reroute.keep"))}</button></div>`;
  icons();
  box.querySelectorAll("[data-pr]").forEach(b => b.addEventListener("click", async () => {
    box.querySelectorAll("button").forEach(x => x.disabled = true);
    try { await routeUpdate(p, b.dataset.pr); toast({ title: t(b.dataset.pr === "switch" ? "reroute.switched" : "reroute.kept"), badgeHtml: badge("b-good", t("reroute.badge")) }); }
    catch (e) { toast({ title: t("state.failed"), detail: e.message, badgeHtml: badge("b-crit", t("state.error")) }); }
    showPendingPrompt();
    if (UI.tab === "path" && UI.view === "user") Path.repaintSave();
  }));
}

async function reloadPlans() { await loadPlans(); if (UI.tab === "path" && UI.view === "user") Path.repaintSave(); }

// ---------- accounts (only when the server has Supabase Auth switched on) ----------
function renderAccount() {
  const on = AUTH.enabled, inn = !!AUTH.user;
  $("signin-btn").hidden = !on || inn;
  document.querySelectorAll("#menu [data-account]").forEach(el => { const v = el.dataset.account; el.hidden = !on || (v === "in" && !inn) || (v === "out" && inn); });
  $("menu-who").textContent = inn ? t("menu.account", { email: AUTH.user.email || "" }) : "";
  document.querySelectorAll("#menu [data-staff]").forEach(el => { el.hidden = !hasRole(el.dataset.staff); });
  // Without accounts the Review button is where an admin enters the admin token, so it stays.
  $("admin-btn").hidden = AUTH.enabled && !hasRole("admin");
  document.querySelector("#agents .ag-actions").hidden = !hasRole("admin");
  if (UI.view === "admin" && !hasRole("admin")) actions.setView("user");
}

/** The signed-in user changed (signed in, signed out, or deleted their data). */
async function authChanged(info = {}) {
  renderAccount();
  if (AUTH.user && info.deleted !== undefined) {
    setProfileId(1); await actions.loadProfile(1);
    toast({ title: t(info.deleted ? "del.done" : "del.none"), badgeHtml: badge("b-good", t("reroute.appliedBadge")) });
    return;
  }
  if (AUTH.user) {
    closeAuth();
    toast({ title: t("auth.signedIn", { email: AUTH.user.email || "" }), badgeHtml: badge("b-good", t("auth.kicker"), "user-round") });
    setProfileId(AUTH.profileId || 1);
    await actions.loadProfile(AUTH.profileId || 1);
    if (!AUTH.profileId) openOnboarding(0);
    if (hasRole("admin")) Admin.loadReview().then(updateAdminCount);
  } else {
    setProfileId(1); await actions.loadProfile(1);
    toast({ title: t("auth.signedOut"), badgeHtml: badge("b-warn", t("src.sample")) });
  }
}

async function demoChosen() {
  if (S.profile?.id !== 1 || S.profileFallback) { setProfileId(1); await actions.loadProfile(1); }
  toast({ title: t("ob.sampleToast"), detail: t("ob.sampleBody"), badgeHtml: badge("b-warn", t("src.sample")) });
  Guide.intro();
}

/** "Set up my profile" needs an account when accounts are on. */
function startOnboarding() {
  if (AUTH.enabled && !AUTH.user) openAuth(t("auth.needAccount"));
  else openOnboarding(0);
}

/** A job's details would repeat the My goal panel once that job is chosen there. */
function closeJobDrawer() { if (UI.drawer && N(UI.drawer)?.type === "job") closeDrawer(); }

/** Open on the goal you set last time: its job, route type and the My goal tab. */
function applyGoal() {
  const g = goal();
  if (!g || !N(g.job) || N(g.job).type !== "job") return;
  UI.job = g.job; UI.mode = g.mode || UI.mode; UI.picked = true; UI.tab = "path";
  UI.pinned = g.job;
}

// ---------- actions used by panels ----------
Object.assign(actions, {
  refresh: o => refresh(o),
  renderPanel: () => renderPanel(false),
  renderAgents, updateAdminCount, openDrawer, closeDrawer, knowledgeChanged, approveSignal, reloadPlans,
  play: () => { if (!playT) $("play").click(); },
  setForecast(year, scenario) {
    stopPlay(); S.year = year; S.scenario = scenario;
    document.querySelectorAll("[data-scn]").forEach(o => o.setAttribute("aria-pressed", String(o.dataset.scn === scenario)));
    refresh();
  },
  openOnboarding: step => openOnboarding(step),
  setView(v) {
    UI.view = v;
    if (v === "admin") { Admin.loadSub(Admin.A.sub); closeDrawer(); }
    renderPanel(true);
    if (window.innerWidth < 980 && v === "admin") $("side").scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
  },
  // Choosing a job fills the My goal panel; its full details open only from "See all about this job".
  selectJob(j) {
    if (UI.job !== j) { UI.employer = null; UI.employerReq = []; }
    closeJobDrawer();
    UI.job = j; UI.tab = "path"; UI.picked = true; refresh({ animate: true }); Guide.mark("job"); G.wave(j, "#f08a5d", 1.2, 240);
  },
  showPath(j) {
    if (!UI.ring.includes(j)) UI.pinned = j;
    if (UI.job !== j) { UI.employer = null; UI.employerReq = []; }
    UI.job = j; UI.tab = "path"; UI.view = "user"; UI.picked = true; refresh({ animate: true }); Guide.mark("job");
  },
  pinJob(j) {
    if (!S.E.isJob(j)) return;
    const added = !UI.ring.includes(j);
    if (added) UI.pinned = j;
    if (UI.job !== j) { UI.employer = null; UI.employerReq = []; }
    UI.job = j; UI.search = ""; UI.picked = true;
    refresh({ animate: true });
    if (added) toast({ title: t("search.addedToast", { job: nameOf(j) }), detail: t("search.addedBody", { n: matchOf(j), w: D.plans[j]?.route ? W(D.plans[j].ready) : "–" }), badgeHtml: badge("b-info", t("search.added")) });
    openDrawer(j);
  },
  setSector(s) {
    UI.sector = s; UI.pinned = null;
    refresh({ animate: true });
    const sec = (S.graph.sectors || []).find(x => x.id === s);
    if (UI.ring[0]) toast({ title: t("sector.toast", { name: s === "best" ? t("jobs.best") : sec?.name || s, n: UI.ring.length }), detail: t("sector.toastBody", { job: nameOf(UI.ring[0]), n: matchOf(UI.ring[0]) }), badgeHtml: badge("b-info", t("sector.updated")) });
  },
  setMode(m) { UI.mode = m; refresh(); Guide.mark("mode"); },
  async setEmployer(e, j) {
    if (!e) { UI.employer = null; UI.employerReq = []; refresh(); return; }
    if (j && j !== UI.job) { if (!UI.ring.includes(j)) UI.pinned = j; UI.job = j; }
    UI.picked = true;
    try {
      const res = await get(`/employers/${e.id}`);
      UI.employerReq = (res.requirements || []).filter(r => r.occupationId === UI.job && S.E.isSkill(r.skillId))
        .map(r => ({ skill: r.skillId, weight: r.weight, need: r.levelNeeded, status: "employer" }));
      UI.employer = e;
      refresh();
      const extra = UI.employerReq.filter(r => !(S.graph.req[UI.job] || []).some(q => q.skill === r.skill)).length;
      toast({ title: t("emp.toast", { job: nameOf(UI.job), name: e.name }), detail: t("emp.toastBody", { n: matchOf(UI.job), x: extra }), badgeHtml: badge("b-info", t("emp.badge"), "building-2") });
    } catch (err) {
      toast({ title: t("emp.failed"), detail: err.notAvailable ? t("state.notAvailable") : err.message, badgeHtml: badge("b-crit", t("state.error")) });
      refresh();
    }
  },
  async profileUpdated(p, { localOnly = false } = {}) {
    const prevId = S.profile?.id;
    S.profile = normaliseProfile(p); S.localOnly = localOnly;
    if (prevId !== S.profile.id || !localOnly) { UI.sdg = S.profile.sdgPriority || null; UI.rank = null; UI.rankErr = null; }
    Path.invalidate();
    refresh({ animate: true });
    if (UI.sdg) { await Jobs.loadRank(); refresh(); }
    if (prevId !== S.profile.id) reloadPlans();
  },
  async loadProfile(id) {
    await loadProfile(id);
    UI.pinned = null; UI.employer = null; UI.employerReq = [];
    applyGoal();
    Path.invalidate();
    refresh({ animate: true });
    if (UI.sdg) { await Jobs.loadRank(); refresh(); }
    reloadPlans();
  },
  topJob() { const j = UI.ring[0]; return j ? { job: j, match: matchOf(j), count: UI.ring.length } : null; },
});

// ---------- controls ----------
function initControls() {
  ["jobs", "path", "skills"].forEach((tb, i, all) => {
    const b = $("tab-" + tb);
    b.addEventListener("click", () => { UI.tab = tb; closeWhy(); renderPanel(true); G.updateLabels(); });
    b.addEventListener("keydown", e => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const n = all[(i + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length];
      UI.tab = n; renderPanel(true); G.updateLabels(); $("tab-" + n).focus();
    });
  });
  document.querySelectorAll("[data-scn]").forEach(b => b.addEventListener("click", async () => {
    S.scenario = b.dataset.scn; Guide.mark("future");
    document.querySelectorAll("[data-scn]").forEach(o => o.setAttribute("aria-pressed", String(o === b)));
    if (refresh({ reroute: true })) toast({ title: t("scn.changedTitle"), detail: t("scn.changedBody", { scenario: t("scn." + S.scenario) }), badgeHtml: badge("b-info", t("scn.newPath")) });
    if (UI.sdg) { await Jobs.loadRank(); refresh(); }
  }));
  $("year").addEventListener("input", e => { stopPlay(); S.year = +e.target.value; refresh({ reroute: true }); Guide.mark("future"); });
  $("year").addEventListener("change", async () => { if (UI.sdg) { await Jobs.loadRank(); refresh(); } });
  $("play").addEventListener("click", () => {
    if (playT) return stopPlay();
    if (S.year >= 2030) { S.year = 2026; refresh(); }
    Guide.mark("future");
    $("play").innerHTML = '<i data-lucide="pause"></i>'; $("play").setAttribute("aria-label", t("time.pause")); icons();
    playT = setInterval(() => { if (S.year >= 2030) return stopPlay(); S.year++; refresh({ reroute: true }); }, reduce ? 500 : 1200);
  });
  $("rotate").addEventListener("click", () => G.setRotate(!UI.rotating));
  $("labels-btn").addEventListener("click", () => { UI.labelsAll = !UI.labelsAll; $("labels-btn").setAttribute("aria-pressed", String(UI.labelsAll)); G.updateLabels(); });
  $("reset-view").addEventListener("click", () => G.resetView(true));
  $("legend-more").addEventListener("click", e => {
    const open = e.currentTarget.getAttribute("aria-expanded") !== "true";
    e.currentTarget.setAttribute("aria-expanded", String(open));
    e.currentTarget.dataset.i18n = open ? "legend.less" : "legend.more";
    e.currentTarget.textContent = t(e.currentTarget.dataset.i18n);
    $("legend-extra").hidden = !open;
  });
  $("admin-btn").addEventListener("click", () => actions.setView(UI.view === "admin" ? "user" : "admin"));
  $("signin-btn").addEventListener("click", () => openAuth());
  $("lang-btn").addEventListener("click", async () => {
    const next = getLang() === "ms" ? "en" : "ms";
    await setLang(next);
    if (!S.profileFallback && S.profile && !S.profile.isDemo) put(`/profile/${profileId()}`, { lang: next }).catch(() => {});
  });
  // views menu
  const mb = $("menu-btn"), menu = $("menu");
  const closeMenu = () => { menu.hidden = true; mb.setAttribute("aria-expanded", "false"); };
  mb.addEventListener("click", e => { e.stopPropagation(); const open = menu.hidden; menu.hidden = !open; mb.setAttribute("aria-expanded", String(open)); if (open) menu.querySelector("button")?.focus(); });
  menu.addEventListener("keydown", e => {
    const items = [...menu.querySelectorAll("button")], i = items.indexOf(document.activeElement);
    if (e.key === "Escape") { closeMenu(); mb.focus(); }
    if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  });
  document.addEventListener("click", e => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); });
  menu.querySelectorAll("[data-menu]").forEach(b => b.addEventListener("click", () => {
    closeMenu();
    const k = b.dataset.menu;
    if (k === "onboard") startOnboarding();
    else if (k === "signin") openAuth();
    else if (k === "signout") signOut();
    else if (k === "delete") openDeleteData();
    else if (k === "sample") { setProfileId(1); actions.loadProfile(1); toast({ title: t("ob.sampleToast"), badgeHtml: badge("b-warn", t("src.sample")) }); }
    else if (k === "review") actions.setView("admin");
    else if (k === "tour") Guide.start();
    else if (k === "lang") { /* handled by its own listener */ }
    else openSheet(k);
  }));
  document.addEventListener("keydown", e => { if (e.key === "Escape" && UI.drawer && $("ob").hidden && $("sheet").hidden) closeDrawer(); });
}
let playT = null;
function stopPlay() { if (playT) { clearInterval(playT); playT = null; $("play").innerHTML = '<i data-lucide="play"></i>'; $("play").setAttribute("aria-label", t("time.play")); icons(); } }

function onLang() {
  applyStatic();
  $("lang-label").textContent = getLang() === "ms" ? "English" : "Bahasa Melayu";
  $("lang-btn").setAttribute("aria-label", t(getLang() === "ms" ? "lang.toEn" : "lang.toMs"));
  if (S.E) refresh();
  renderStatus();
  if (AUTH.user) $("menu-who").textContent = t("menu.account", { email: AUTH.user.email || "" });
}

// ---------- boot ----------
async function boot() {
  await initI18n();
  applyStatic(); onLang();
  icons();
  initControls(); initWhy(); initOnboarding(); initSheets(); initAgents(); initAuthScreen(); Guide.initGuide();
  onLangChange(onLang);
  G.setRotate(UI.rotating);
  loadHealth();
  $("panel").innerHTML = `<div class="boot-load"><div class="loading" role="status"><span class="spin"></span>${esc(t("boot.loading"))}</div></div>`;
  const authReady = initAuth({ onChange: authChanged, onDemo: demoChosen }).catch(e => { console.warn(e); return AUTH; });
  try { await loadGraph(); }
  catch (e) { console.error(e); bootError(e); return; }
  loadEscoCount();
  // Which profile to show first, and what to open on top of the map.
  await authReady;
  let first = null;
  // Without accounts, staff views show only when the server leaves staff routes open (no ADMIN_TOKEN).
  if (!AUTH.enabled) AUTH.staffOpen = await get("/advisor/queue", null, { timeout: 8000 }).then(() => true, e => !e.needsAuth);
  if (AUTH.enabled) {
    if (AUTH.user) { setProfileId(AUTH.profileId || 1); if (!AUTH.profileId) first = "onboard"; }
    else { if (profileId() !== 1) setProfileId(1); if (store.get("authChoice", null) !== "demo") first = "auth"; }
  } else if (!store.get("onboarded", false)) first = "onboard";
  renderAccount();
  await loadProfile(profileId());
  try { rebuild(); } catch (e) { console.error(e); bootError({ message: t("boot.badProfile") }); return; }
  applyGoal();
  computeRing(); computePlans(); G.applyLayout(false);
  renderHead(); renderPanel(); renderAgents(); renderStatus();
  G.init({
    nodeClick(id) {
      if (N(id)?.type === "job") { UI.view = "user"; actions.selectJob(id); }
      else openDrawer(id);
    },
    altRoute(m) {
      if (m === UI.mode) return;
      UI.mode = m; UI.tab = "path"; UI.view = "user"; refresh(); Guide.mark("mode");
      toast({ title: t("route.switched", { mode: t("mode." + m) }), detail: t("route.switchedBody", { job: nameOf(UI.job), w: D.plan?.route ? W(D.plan.ready) : "–" }), badgeHtml: badge("b-info", t("route.badge")) });
    },
    scanning: () => Admin.A.scout.running,
  });
  G.drawStars();
  new ResizeObserver(() => { G.resize(); G.drawStars(); }).observe($("stage"));
  new MutationObserver(() => G.restyle()).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  globalThis.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => G.restyle());
  if (UI.sdg) { await Jobs.loadRank(); refresh(); }
  reloadPlans().then(showPendingPrompt);
  if (hasRole("admin")) Admin.loadReview().then(updateAdminCount);
  Guide.render();
  if (first === "auth") openAuth();
  else if (first === "onboard") openOnboarding(0);
  else Guide.intro();
}

window.addEventListener("error", e => console.error("Unhandled error", e.error || e.message));
window.addEventListener("unhandledrejection", e => { console.error("Unhandled promise", e.reason); e.preventDefault(); });
boot();
