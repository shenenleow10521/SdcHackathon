// HalaTuju web app: boot, the refresh loop, and app-level actions.
// Data: GET /api/graph + GET /api/profile/:id; the shared engine recomputes in the browser on every change.
// One failed call never blanks the page: each feature shows its own "not available yet" or "retry" state.
import { S, UI, D, actions, rebuild, computeRing, computePlans, N, nameOf, W, matchOf, profileId, setProfileId, normaliseProfile, FALLBACK_PROFILE, isSampleProfile, escoRow, bestEscoPick, ESCO_BEST_LIMIT, mapJobs, currentJobTitle, isEsco, isAiEra, escoRowWeeks, jobWeeks, SHOW_STEP } from "./state.js";
import { get, put, post, hasAdminToken } from "./api.js";
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
import { goal, loadGoal } from "./features/goal.js";
import { initSearch, renderFrom, renderTo } from "./features/search.js";
import { stayJob } from "./features/stay.js";

// ---------- header ----------
function initials(name) { return (name || "?").replace(/\(.*?\)/g, "").trim().split(/\s+/).slice(0, 2).map(s => s[0] || "").join("").toUpperCase() || "?"; }

function renderHead() {
  const p = S.profile;
  $("avatar").textContent = initials(p.displayName);
  // the server names an unnamed CV profile "My profile" or "Profil saya"; show that in the interface language
  $("me-name").textContent = ["My profile", "Profil saya"].includes(p.displayName) ? t("me.myProfile") : p.displayName || t("me.you");
  const job = currentJobTitle();
  $("me-meta").textContent = job ? t("me.meta", { job, h: p.hours }) : t("me.metaNoJob", { h: p.hours });
  $("sample-badge").hidden = !isSampleProfile();
  renderFrom(job);
  // the To box names the job on the map (picked from a star, a row, the search box, or your goal)
  renderTo(UI.escoJob ? nameOf(UI.escoJob) : UI.picked && UI.job ? nameOf(UI.job) : null);
  $("map-sum").textContent = t(S.escoJobs ? "map.sum" : "map.sumShort", { j: mapJobs().length, total: (S.escoJobs || 0).toLocaleString("en-MY") });
  const nb = $("notice");
  if (S.profileFallback) { nb.hidden = false; nb.innerHTML = `${badge("b-warn", t("src.sample"))}<span>${esc(t("notice.fallback"))}</span><button class="ghost sm" type="button" id="notice-retry"><i data-lucide="refresh-cw"></i>${esc(t("state.retry"))}</button>`; $("notice-retry").onclick = () => actions.loadProfile(profileId()); }
  else if (S.localOnly) { nb.hidden = false; nb.innerHTML = `${badge("b-warn", t("notice.localBadge"))}<span>${esc(t("notice.local"))}</span>`; }
  else nb.hidden = true;
  G.setRingNames(["", t("ring.skills"), t("ring.learn"), UI.sector === "best" ? t("ring.best") : t("ring.sector", { name: (S.graph.sectors || []).find(s => s.id === UI.sector)?.name || "" })]);
}

// ---------- panel ----------
const GoalTab = { render: () => Path.renderGoal(), bind: el => Path.bindGoal(el) };
let lastPanelKey = "";
function renderPanel(animate) {
  const el = $("panel");
  const key = UI.view + ":" + UI.tab;
  if (key !== lastPanelKey) {
    lastPanelKey = key;
    // the tabs stick to the top of the sidebar: on a tab change, scroll back only as far as the tabs
    const sb = document.querySelector(".side-body"), tb = $("tabs");
    // (the tabs are sticky, so their own offsetTop moves with the scroll: measure from the panel under them instead)
    if (sb && tb && sb.scrollHeight > sb.clientHeight) sb.scrollTop = Math.min(sb.scrollTop, Math.max(0, el.offsetTop - tb.offsetHeight - sb.offsetTop));
  }
  $("tabs").hidden = UI.view === "admin";
  const mod = UI.view === "admin" ? Admin : UI.tab === "jobs" ? Jobs : UI.tab === "path" ? Path : UI.tab === "goal" ? GoalTab : Skills;
  try { el.innerHTML = mod.render(); }
  catch (e) { console.error(e); el.innerHTML = errorBox({ message: t("state.renderFailed") }); }
  ["jobs", "path", "goal", "skills"].forEach(tb => { const b = $("tab-" + tb); b.setAttribute("aria-selected", String(UI.tab === tb)); b.tabIndex = UI.tab === tb ? 0 : -1; });
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
/** Route view (Plan and My goal): the map shows just your route; the chip switches to all jobs and back. */
function syncRouteChip() {
  const chip = $("route-chip"), planTab = (UI.tab === "path" || UI.tab === "goal") && UI.view === "user";
  const on = G.routeView(), back = planTab && UI.routeAll && !!(UI.escoJob || (UI.picked && D.plan?.route));
  chip.hidden = !on && !back;
  chip.innerHTML = on ? `<i data-lucide="orbit"></i>${esc(t("map.allJobs"))}` : `<i data-lucide="route"></i>${esc(t("map.backRoute"))}`;
  icons();
}
/** The open tab changed: route view comes and goes with it. */
function tabChanged() { G.applyLayout(true); G.restyle(); syncRouteChip(); }

function refresh({ reroute = false, animate = false } = {}) {
  if (!S.graph || !S.profile) return false;
  const prev = D.plan?.route?.key;
  try { rebuild(); } catch (e) { console.error(e); return false; }
  computeRing(); computePlans();
  const relaid = G.applyLayout(true);
  renderHead(); renderPanel(animate); renderAgents(); renderStatus(); Guide.render(); syncRouteChip();
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
  const prevId = S.profile?.id;
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
  if (S.profile.id !== prevId) forgetEscoBest(); // another person's ESCO matches must never show on this map
  await loadGoal({ force: true }); // your goal is on the server (the persona's stays in this browser): load it before opening on it
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
  const src = signal ? `${signal.title && signal.title !== signal.sourceTitle ? `<b>${esc(signal.title)}</b><br>` : ""}${extLink(signal.sourceUrl, signal.sourceTitle || t("why.source"))}${signal.sourceDate ? ", " + esc(fmtDate(signal.sourceDate)) : ""}${signal.isSample ? " " + badge("b-warn", t("src.sample")) : ""}` : "";
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

// ---------- accounts (only when Replit-managed Clerk is switched on) ----------
function renderAccount() {
  const on = AUTH.enabled, inn = !!AUTH.user;
  $("signin-btn").hidden = !on || inn;
  document.querySelectorAll("#menu [data-account]").forEach(el => {
    const v = el.dataset.account;
    el.hidden = !on || (v === "in" && !inn) || (v === "out" && inn);
  });
  $("menu-who").textContent = inn ? t("menu.account", { email: AUTH.user.email || "" }) : "";
  document.querySelectorAll("#menu [data-staff]").forEach(el => { el.hidden = !hasRole(el.dataset.staff); });
  // The Review button is for staff only: a signed-in admin, an admin token in this browser, or ?admin=1 (where an
  // admin enters the token when accounts are off). Everyone else gets the user view without a dead end.
  $("admin-btn").hidden = !(AUTH.enabled ? hasRole("admin") : hasAdminToken() || new URLSearchParams(location.search).has("admin"));
  document.querySelector("#agents .ag-actions").hidden = !hasRole("admin");
  if (UI.view === "admin" && !hasRole("admin")) actions.setView("user");
}

/** The signed-in user changed (signed in, signed out, or deleted their data). */
async function authChanged(info = {}) {
  renderAccount();
  if (AUTH.user && info.deleted !== undefined) {
    setProfileId(AUTH.guestProfileId || 1); await actions.loadProfile(AUTH.guestProfileId || 1);
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
    setProfileId(AUTH.guestProfileId || 1); await actions.loadProfile(AUTH.guestProfileId || 1);
    toast({ title: t("auth.signedOut"), badgeHtml: badge("b-warn", t("src.sample")) });
  }
}

async function demoChosen() {
  if (S.profile?.id !== 1 || S.profileFallback) { setProfileId(1); await actions.loadProfile(1); }
  toast({ title: t("ob.sampleToast"), detail: t("ob.sampleBody"), badgeHtml: badge("b-warn", t("src.sample")) });
  Guide.intro();
}

/** Guests can build a profile with their CV without creating an account. */
function startOnboarding() {
  openOnboarding(0);
}

/** A job's details would repeat the My goal panel once that job is chosen there. */
// Details open inside the left panel; going to another job or tab replaces them, like a map app.
function closeJobDrawer() { if (UI.drawer) closeDrawer(); }

/** Open on the goal you set last time: its job, route type and the My goal tab. */
function applyGoal() {
  const g = goal();
  if (!g || !N(g.job) || N(g.job).type !== "job") return;
  UI.job = g.job; UI.mode = g.mode || UI.mode; UI.picked = true; UI.tab = "goal";
  UI.pinned = g.job;
}

// ---------- ESCO jobs on the map ----------
/** Your best matches across all ESCO jobs (top picks, the threshold slider) and the ESCO skills you have (the map's inner
 *  ring when your catalogue skills are few). Optional: without it the map shows catalogue jobs only. */
function forgetEscoBest() { S.escoBest = []; S.escoMine = []; S.xsOwned = new Set(); S.escoDefault = null; S.escoExtra = []; S.outlook = null; UI.escoPinned = null; UI.shown = SHOW_STEP; }
async function loadEscoBest() {
  const id = S.profile?.id;
  if (!id || S.profileFallback) { forgetEscoBest(); S.escoPending = false; return; }
  S.escoPending = !S.escoBest.length;
  // your skills' outlook loads alongside (optional: My skills and the stay track fall back to the catalogue without it)
  get(`/esco/profile/${id}/outlook`).then(o => { if (S.profile?.id === id) { S.outlook = o; if (S.E) refresh(); } }, () => {});
  try {
    const r = await get(`/esco/profile/${id}/best-jobs`, { limit: ESCO_BEST_LIMIT });
    if (S.profile?.id !== id) return;
    S.escoBest = Array.isArray(r?.jobs) ? r.jobs : [];
    S.escoMine = Array.isArray(r?.skills) ? r.skills : [];
    S.escoDefault = r?.defaultPick ? "esco:" + r.defaultPick : null; // the job to open on (not just the top match)
    S.escoMine.forEach(k => { S.xsNames["xs:" + k.id] = k.title; S.xsOwned.add("xs:" + k.id); });
  } catch { if (S.profile?.id === id) forgetEscoBest(); }
  finally { if (S.profile?.id === id) S.escoPending = false; }
}
/** After the ESCO matches arrive: redraw, and if nothing is chosen yet and your best match is an ESCO job (a nurse, a
 *  call-centre agent), open on it so its route shows straight away. Priya's catalogue picks win, so her map is unchanged. */
async function escoBestLoaded() {
  refresh();
  if (UI.picked || UI.escoJob || goal() || UI.view !== "user") return;
  const top = bestEscoPick();
  if (top) await selectEsco(top, { quiet: true, tab: null });
}

/** GET /api/plan?job=esco:<id> (docs/API.md "The plan"): route.nodes [you, ..., job] with route.names, keySkills [id],
 *  missing [{id,name,group,...}] (every skill still needed), weeks (already at your hours), saferAlternative. */
function escoPlanShape(id, r) {
  const E = S.E, idOf = k => String(typeof k === "string" ? k : k?.id || k?.skill || "");
  const missing = (Array.isArray(r.missing) ? r.missing : []).map(m => ({ id: idOf(m), name: m.name || m.title || idOf(m), group: m.group || "", hours: m.hours ?? null, estimated: !!m.estimated, aiEra: !!m.aiEra, sources: Array.isArray(m.sources) ? m.sources : [], description: m.description || "" })).filter(m => m.id);
  const nodes = Array.isArray(r.route?.nodes) ? r.route.nodes.map(idOf).filter(Boolean) : [];
  let keys = (Array.isArray(r.keySkills) ? r.keySkills : []).map(idOf).filter(Boolean);
  if (!keys.length) keys = nodes.slice(1, -1).filter(k => missing.some(m => m.id === k));
  keys = keys.slice(0, 5);
  const names = { ...(r.route?.names || {}) };
  missing.forEach(m => { names[m.id] = m.name; });
  (r.keySkills || []).forEach(k => { if (k && typeof k === "object" && k.name) names[idOf(k)] = k.name; });
  Object.entries(names).forEach(([k, v]) => { if (!N(k)) S.xsNames["xs:" + k] = v; });
  // AI-era skills (not in ESCO, which predates generative AI): no exposure score, a badge and their sources instead
  const aiEra = [...missing, ...(Array.isArray(r.route?.nodes) ? r.route.nodes : []).filter(k => k && typeof k === "object")].filter(m => m.aiEra);
  // AI-era skills the job is picking up that this route doesn't need yet (not the ones you already have)
  const emerging = (Array.isArray(r.emerging) ? r.emerging : []).filter(e => e && e.id && !e.have && !missing.some(m => m.id === e.id));
  emerging.forEach(e => { S.xsNames["xs:" + e.id] = e.name || e.id; aiEra.push(e); });
  aiEra.forEach(m => { const k = idOf(m); S.xsMeta[N(k) ? k : "xs:" + k] = { aiEra: true, sources: Array.isArray(m.sources) ? m.sources : [], description: m.description || "" }; });
  keys.forEach(k => { if (!N(k) && !S.xsNames["xs:" + k]) S.xsNames["xs:" + k] = k; });
  // the route as map nodes: you, the skills it starts from and passes through, the job
  const miss = new Set(missing.map(m => m.id));
  const route = nodes.length >= 2 ? nodes.map((k, i) => i === 0 ? E.root : i === nodes.length - 1 ? id : N(k) ? k : "xs:" + k) : null;
  nodes.slice(1, -1).forEach(k => { if (!N(k) && !miss.has(k)) S.xsOwned.add("xs:" + k); }); // ESCO skills you already have
  const weeks = r.weeks ?? r.route?.weeks ?? null;
  // each key step's own weeks (route legs), by map id
  const legWeeks = {};
  (Array.isArray(r.route?.legs) ? r.route.legs : []).forEach(l => { const k = idOf(l.to); if (k) legWeeks[N(k) ? k : "xs:" + k] = l.weeksRef ?? null; });
  return { id, keys, missing, route, weeks: typeof weeks === "number" ? weeks : null, totalHours: typeof r.totalHours === "number" ? r.totalHours : null,
    match: r.match ?? null, counts: r.counts || null, safer: r.saferAlternative || null, names, emerging: emerging.map(e => e.id), legWeeks };
}

let escoSeq = 0;
/** Select an ESCO job: draw its plan on the map and (tab "path") show it in the Plan tab; tab null keeps the open tab.
 *  If /api/plan doesn't know ESCO jobs, open its ESCO sheet instead. */
async function selectEsco(id, { quiet = false, tab = "path", animate = true } = {}) {
  if (!escoRow(id)) return;
  const seq = ++escoSeq;
  closeJobDrawer();
  UI.escoJob = id; S.escoPlan = null; UI.view = "user";
  if (tab) UI.tab = tab;
  if (tab === "path") UI.routeAll = false;
  refresh({ animate }); G.wave(id, "#f2b33d", 1.2, 240);
  if (!quiet) Guide.mark("job");
  if (tab === "path" && !quiet) revealPlan();
  try {
    const r = await get("/plan", { profile: profileId(), job: id, mode: UI.mode, year: S.year, scenario: S.scenario }, { timeout: 20000 });
    if (seq !== escoSeq || UI.escoJob !== id) return;
    S.escoPlan = escoPlanShape(id, r || {});
    // a job opened from the search box has no best-match row yet: its plan gives the match and the counts
    const row = escoRow(id);
    if (row && row.match == null) Object.assign(row, { match: r.match ?? 0, have: r.counts?.have ?? 0, close: r.counts?.related ?? null, essential: r.counts?.essential ?? 0 });
    // the list's weeks are a quick estimate; once the full plan is in, the row shows the plan's figure (they must agree)
    if (row && S.escoPlan.totalHours != null) row.weeksRef = S.escoPlan.totalHours / 6;
    refresh({ animate: false });
  } catch {
    if (seq !== escoSeq || UI.escoJob !== id) return;
    // no ESCO plans on this server yet: keep the star selected and show the job's ESCO page
    S.escoPlan = { id, keys: [], missing: [], weeks: null, match: null, safer: null, names: {}, none: true, legWeeks: {} };
    refresh();
    openSheet("esco", id.slice(5));
  }
}
const clearEsco = () => { UI.escoJob = null; S.escoPlan = null; escoSeq++; };

/** Phones: the map sits above the panel, so a tap on a job in the list would change a map the person can't see. Bring
 *  the map back into view (when it is mostly scrolled away) and pulse the chosen star, so every tap visibly lands. */
function peekMap(id) {
  if (window.innerWidth >= 980) return;
  const st = $("stage"), r = st?.getBoundingClientRect();
  if (r && r.bottom < r.height * 0.6) st.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  setTimeout(() => G.wave(id, "#f2b33d", 1.6, 420), reduce ? 0 : 450);
}

/** Bring the chosen job's plan into view: the Plan tab scrolled to its top (it can be scrolled far down from the last
 *  job), with a short highlight so the eye finds it. On phones the panel sits under the map, so scroll down to it. */
function revealPlan() {
  const sb = document.querySelector(".side-body"), el = $("panel"), tb = $("tabs");
  if (window.innerWidth >= 980) { if (sb) sb.scrollTop = Math.min(sb.scrollTop, Math.max(0, el.offsetTop - tb.offsetHeight - sb.offsetTop)); }
  else tb.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  flash(el.querySelector(".goal-head"));
}
const flash = node => { if (!node) return; node.classList.remove("flash"); void node.offsetWidth; node.classList.add("flash"); };

/** Phones: tapping a job (on the map, or in the list while the map is in view) shows a small card on the map, like a
 *  map app's place card: name, match, weeks and "See plan", which scrolls down to the plan. */
function showMapCard(id) {
  const card = $("map-card");
  if (window.innerWidth >= 980 || !id) { card.hidden = true; return; }
  const r = escoRow(id), quick = isEsco(id) ? escoRowWeeks(r) : D.plans[id]?.route ? W(D.plans[id].ready) : null, wk = jobWeeks(id) ?? quick;
  card.innerHTML = `<div class="mc-t"><b>${esc(nameOf(id))}</b><span>${esc(t("map.jobMatch", { match: matchOf(id) }))}${wk ? ", " + esc(t("jobs.readyLine", { w: wk })) : ""}</span></div>
    <button class="btn btn-primary sm" type="button" id="mc-plan"><i data-lucide="flag"></i>${esc(t("jobs.openPlan"))}</button>
    <button class="icon-btn" type="button" id="mc-x" aria-label="${esc(t("common.close"))}"><i data-lucide="x"></i></button>`;
  card.hidden = false; icons();
  $("mc-plan").onclick = () => { card.hidden = true; actions.openPlan(id); };
  $("mc-x").onclick = () => { card.hidden = true; };
}
/** Keep the tapped row in view and highlight it (the list re-renders under your finger). */
function keepRow(id) {
  requestAnimationFrame(() => {
    const row = document.querySelector(`#panel [data-card="${CSS.escape(id)}"]`);
    if (!row) return;
    if (window.innerWidth >= 980) row.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    flash(row);
  });
}

// ---------- actions used by panels ----------
Object.assign(actions, {
  refresh: o => refresh(o),
  renderPanel: () => renderPanel(false),
  renderAgents, updateAdminCount, openDrawer, closeDrawer, knowledgeChanged, approveSignal, reloadPlans, selectEsco,
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
    if (window.innerWidth < 980 && v === "admin") document.querySelector(".side-body").scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
  },
  // Choosing a job fills the My goal panel; its full details open only from "See all about this job".
  selectJob(j) {
    clearEsco();
    if (UI.job !== j) { UI.employer = null; UI.employerReq = []; }
    closeJobDrawer();
    UI.job = j; UI.tab = "path"; UI.picked = true; UI.routeAll = false; refresh({ animate: true }); Guide.mark("job"); G.wave(j, "#f08a5d", 1.2, 240);
    revealPlan();
  },
  // A row in the Explore list: select the job (its route shows on the map) and stay in the list, with "Open plan" on it.
  previewJob(id) {
    if (isEsco(id)) selectEsco(id, { tab: null, animate: false });
    else {
      clearEsco();
      if (UI.job !== id) { UI.employer = null; UI.employerReq = []; }
      closeJobDrawer();
      UI.job = id; UI.picked = true; refresh({ animate: false }); Guide.mark("job"); G.wave(id, "#f08a5d", 1.2, 240);
    }
    keepRow(id);
    if (window.innerWidth < 980) { peekMap(id); showMapCard(id); }
  },
  /** The My goal tab: the map shows your goal's route while it's open. */
  openGoalTab() {
    // the map shows your move's route, or with no move set, the hand-made AI-ready version of your job when there is one
    const g = goal(), j = g && N(g.job)?.type === "job" ? g.job : stayJob();
    UI.tab = "goal"; UI.view = "user"; $("map-card").hidden = true;
    if (j) {
      clearEsco(); closeJobDrawer();
      if (!UI.ring.includes(j)) UI.pinned = j;
      if (UI.job !== j) { UI.employer = null; UI.employerReq = []; }
      UI.job = j; UI.mode = (g?.job === j && g.mode) || UI.mode; UI.picked = true;
      UI.routeAll = false; refresh({ animate: true }); revealPlan();
    } else { renderPanel(true); tabChanged(); }
  },
  /** The × in the To box: no job chosen, back to the list. */
  clearDestination() {
    clearEsco(); closeJobDrawer(); UI.escoPinned = null; UI.pinned = null; UI.picked = false; UI.tab = "jobs"; UI.view = "user";
    $("map-card").hidden = true; refresh({ animate: true });
  },
  openPlan(id) {
    $("map-card").hidden = true;
    if (isEsco(id)) { if (UI.escoJob !== id) selectEsco(id, { tab: "path" }); else { UI.tab = "path"; UI.view = "user"; UI.routeAll = false; renderPanel(true); tabChanged(); revealPlan(); } }
    else actions.selectJob(id);
  },
  /** A job from the search box that isn't among your best matches: add it (match and counts come with its plan). */
  openEscoJob(e) {
    const id = "esco:" + e.id;
    if (!escoRow(id)) S.escoExtra = [...S.escoExtra, { id: e.id, title: e.title, essential: e.essential ?? 0, match: null, have: null, close: null, iloExposure: e.iloExposure ?? null, critical: !!e.critical, weeksRef: null }];
    UI.escoPinned = id;
    selectEsco(id, { tab: "path" });
  },
  /** Hours a week to learn: every weeks figure follows. Saved for your own profile; the sample persona changes here only. */
  setHours(h) {
    h = Number(h);
    if (!h || !S.profile || h === S.profile.hours) return;
    S.profile = { ...S.profile, hours: h }; Path.invalidate(); refresh();
    if (!S.profile.isDemo && !S.profileFallback) put(`/profile/${profileId()}`, { hours: h }).catch(e => toast({ title: t("state.failed"), detail: e.message, badgeHtml: badge("b-crit", t("state.error")) }));
  },
  showPath(j) {
    clearEsco();
    if (!UI.ring.includes(j)) UI.pinned = j;
    if (UI.job !== j) { UI.employer = null; UI.employerReq = []; }
    UI.job = j; UI.tab = "path"; UI.view = "user"; UI.picked = true; refresh({ animate: true }); Guide.mark("job");
  },
  setSector(s) {
    UI.sector = s; UI.pinned = null; clearEsco();
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
    if (prevId !== S.profile.id) { forgetEscoBest(); UI.picked = false; } // a new person: their own best match opens
    Path.invalidate(); clearEsco();
    refresh({ animate: true });
    if (UI.sdg) { await Jobs.loadRank(); refresh(); }
    if (prevId !== S.profile.id) reloadPlans();
    if (!localOnly) loadEscoBest().then(escoBestLoaded);
  },
  async loadProfile(id) {
    await loadProfile(id);
    UI.pinned = null; UI.employer = null; UI.employerReq = [];
    applyGoal();
    Path.invalidate(); clearEsco();
    refresh({ animate: true });
    if (UI.sdg) { await Jobs.loadRank(); refresh(); }
    reloadPlans();
    loadEscoBest().then(escoBestLoaded);
  },
  topJob() { const j = [...UI.base].sort((a, b) => matchOf(b) - matchOf(a))[0]; return j ? { job: j, match: matchOf(j), count: UI.base.length } : null; },
});

// ---------- controls ----------
function initControls() {
  ["jobs", "path", "goal", "skills"].forEach((tb, i, all) => {
    const b = $("tab-" + tb);
    b.addEventListener("click", () => { closeWhy(); if (tb === "goal") return actions.openGoalTab(); UI.tab = tb; $("map-card").hidden = true; renderPanel(true); tabChanged(); });
    b.addEventListener("keydown", e => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const n = all[(i + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length];
      if (n === "goal") actions.openGoalTab(); else { UI.tab = n; renderPanel(true); tabChanged(); } $("tab-" + n).focus();
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
  $("route-chip").addEventListener("click", () => { UI.routeAll = !UI.routeAll; tabChanged(); });
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
  initControls(); initSearch(); initWhy(); initOnboarding(); initSheets(); initAgents(); initAuthScreen(); Guide.initGuide();
  onLangChange(onLang);
  G.setRotate(UI.rotating);
  loadHealth();
  $("panel").innerHTML = `<div class="boot-load"><div class="loading" role="status"><span class="spin"></span>${esc(t("boot.loading"))}</div></div>`;
  const authReady = initAuth({ onChange: authChanged, onDemo: demoChosen, onGuest: () => openOnboarding(0) }).catch(e => { console.warn(e); return AUTH; });
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
    else if (AUTH.guestProfileId) setProfileId(AUTH.guestProfileId);
    else { if (profileId() !== 1) setProfileId(1); const choice = store.get("authChoice", null); if (!choice) first = "auth"; else if (choice === "guest") first = "onboard"; }
  } else if (!store.get("onboarded", false)) first = "onboard";
  renderAccount();
  await loadProfile(profileId());
  try { rebuild(); } catch (e) { console.error(e); bootError({ message: t("boot.badProfile") }); return; }
  applyGoal();
  computeRing(); computePlans(); G.applyLayout(false);
  renderHead(); renderPanel(); renderAgents(); renderStatus();
  G.init({
    nodeClick(id) {
      const phone = window.innerWidth < 980;
      if (escoRow(id)) { selectEsco(id, { tab: "path", quiet: phone }); if (phone) showMapCard(id); }
      else if (N(id)?.type === "job") { UI.view = "user"; if (phone) { actions.previewJob(id); UI.tab = "path"; renderPanel(false); } else actions.selectJob(id); }
      // a skill on a route to an ESCO job opens its panel too (drawer.js escoSkillDetail); other unknown dots just show the tip
      else if (!N(id) && !isAiEra(id) && !(String(id).startsWith("xs:") && S.xsNames[id])) G.showTipFor(id);
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
  loadEscoBest().then(escoBestLoaded);
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
