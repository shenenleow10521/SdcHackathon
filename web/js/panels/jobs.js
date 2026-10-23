// Jobs tab: job search (catalogue + low-confidence unknowns), SDG priority, sectors, and the job cards on the map.
import { S, UI, D, N, nameOf, W, matchOf, actions, profileId } from "../state.js";
import { get, put } from "../api.js";
import { t } from "../i18n.js";
import { $, esc, icons, badge, srcBadge, errorBox, loadingBox, debounce, extLink, bindRetry } from "../util.js";
import { openSheet } from "../features/views.js";
import { isGoal } from "../features/goal.js";

const search = { q: "", res: null, err: null, loading: false, seq: 0, esco: [] };

export function render() {
  const E = S.E;
  const sec = (S.graph.sectors || []).find(s => s.id === UI.sector) || { name: t("jobs.best"), note: "" };
  const sdgs = S.graph.sdgs || {};
  const open = UI.explore || !!UI.search || UI.sector !== "best" || !!UI.sdg;
  return `<div class="stack">
    <div>
      <div class="h2"><h2>${esc(UI.sector === "best" ? t("jobs.bestTitle") : t("jobs.sectorTitle", { name: sectorName(sec) }))}</h2>${UI.ring.length ? `<span>${esc(t("jobs.summary", { n: UI.ring.length, m: Math.max(...UI.ring.map(matchOf)) }))}</span>` : ""}</div>
      <div class="jobs">${UI.ring.length ? UI.ring.map(jobCard).join("") : `<div class="empty">${esc(t("jobs.none"))}</div>`}</div>
      ${demandNote()}
    </div>
    <details class="explore" id="explore"${open ? " open" : ""}>
      <summary><i data-lucide="compass"></i><span><b>${esc(t("jobs.explore"))}</b><small>${esc(t("jobs.exploreSub"))}</small></span><i class="chev" data-lucide="chevron-down"></i></summary>
      <div class="explore-in">
        <div>
          <div class="search"><i data-lucide="search"></i><label class="sr" for="q">${esc(t("jobs.searchLabel"))}</label>
            <input id="q" type="search" placeholder="${esc(t("jobs.searchPh"))}" value="${esc(UI.search)}" autocomplete="off"></div>
          <div class="try">${esc(t("jobs.try"))} ${["Data Analyst", "Procurement", "Green finance"].map(x => `<button type="button" data-try="${esc(x)}">${esc(x)}</button>`).join("")}</div>
          <div class="results" id="results" aria-live="polite">${resultsHtml()}</div>
          <button class="btn btn-ghost sm esco-best-btn" type="button" id="esco-best"><i data-lucide="network"></i>${esc(t("esco.bestBtn"))}</button>
        </div>
        <div>
          <div class="sectors" role="group" aria-label="${esc(t("jobs.sectorsAria"))}">${(S.graph.sectors || []).map(s => `<button class="sector" type="button" data-sector="${esc(s.id)}" aria-pressed="${UI.sector === s.id}"><i data-lucide="${esc(s.icon || "circle")}"></i>${esc(sectorName(s))}</button>`).join("")}</div>
          ${sec.note ? `<p class="sector-note">${esc(sec.note)}</p>` : ""}
        </div>
        <div class="sdg-pick">
          <label for="sdg-sel"><i data-lucide="globe"></i>${esc(t("sdg.label"))}</label>
          <select id="sdg-sel" class="select">
            <option value="">${esc(t("sdg.none"))}</option>
            ${Object.entries(sdgs).map(([k, v]) => `<option value="${esc(k)}" ${String(UI.sdg) === k ? "selected" : ""}>SDG ${esc(k)}: ${esc(v.name)}</option>`).join("")}
          </select>
          <div id="sdg-note">${sdgNote()}</div>
        </div>
      </div>
    </details>
  </div>`;
}

export const sectorName = s => s.id === "best" ? t("jobs.best") : s.name;

function rankRow(j) { return UI.sdg && UI.rank ? (UI.rank.jobs || []).find(x => x.job === j) : null; }

function sdgNote() {
  if (!UI.sdg) return "";
  if (UI.rankErr) return errorBox(UI.rankErr, "rank");
  if (!UI.rank) return loadingBox(t("sdg.ranking"));
  const jobs = UI.rank.jobs || [];
  const top = [...jobs].sort((a, b) => a.rank - b.rank)[0], before = [...jobs].sort((a, b) => a.rankWithoutSdg - b.rankWithoutSdg)[0];
  if (!top) return "";
  const name = S.graph.sdgs?.[UI.sdg]?.name || "SDG " + UI.sdg;
  if (before && top.job === before.job) return `<p class="note">${esc(t("sdg.same", { sdg: name, job: nameOf(top.job) }))}</p>`;
  const td = top.tradeoff || {};
  return `<div class="tradeoff"><i data-lucide="scale"></i><div>${esc(t("sdg.moved", { sdg: name, job: nameOf(top.job), from: nameOf(before?.job) }))}
    <div class="num to-line">${esc(t("sdg.costs", { match: Math.abs(Math.round(td.matchDelta ?? 0)), weeks: Math.round(td.weeksDelta ?? 0) }))}</div>${top.sdgReason ? `<div class="rs">${esc(top.sdgReason)}</div>` : ""}</div></div>`;
}

// One note for the list: demand is sample data unless the job is on MyCOL (or has a real outlook).
function demandNote() {
  const sample = UI.ring.filter(j => !N(j).mycol && (N(j).outlookSource || "sample") === "sample");
  if (!sample.length) return "";
  return `<p class="src jobs-src">${esc(t(UI.ring.some(j => N(j).mycol) ? "jobs.demandSampleMycol" : "jobs.demandSample"))}</p>`;
}

// Demand direction in words and shape (not colour alone); within ±3 counts as steady.
function demandDir(d) { return d > 3 ? ["up", "trending-up", "jobs.demUp"] : d < -3 ? ["down", "trending-down", "jobs.demDown"] : ["flat", "minus", "jobs.demFlat"]; }

// Job card: fixed positions. Line 1 name + match; line 2 weeks + demand; a red line only for high AI risk; tags last.
function jobCard(j) {
  const E = S.E, n = N(j), p = D.plans[j], m = matchOf(j);
  const risk = p?.route ? p.route.risk : "High";
  const rr = rankRow(j);
  const moved = rr && rr.rankWithoutSdg !== rr.rank ? rr.rankWithoutSdg - rr.rank : 0;
  const on = UI.picked && UI.job === j, mine = isGoal(j);
  const dm = demandDir(E.demand(j));
  const tags = [
    mine ? `<span class="goal-tag"><i data-lucide="flag"></i>${esc(t("goal.yours"))}</span>` : "",
    n.stay ? `<span class="jtag">${esc(t("jobs.stay"))}</span>` : "",
    j === UI.pinned ? `<span class="jtag">${esc(t("jobs.searched"))}</span>` : "",
    rr?.sdgFit ? `<span class="jtag">${esc(t("sdg.fit", { sdg: UI.sdg }))}</span>` : "",
    moved ? `<span class="jtag">${esc(t(moved > 0 ? "jobs.movedUp" : "jobs.movedDown", { n: Math.abs(moved) }))}</span>` : "",
  ].filter(Boolean);
  return `<div class="job${mine ? " goal" : ""}" data-card="${esc(j)}" aria-current="${on}">
    <button class="job-hit" type="button" data-job="${esc(j)}" aria-pressed="${on}" aria-label="${esc(t("jobs.cardAria", { job: n.name, match: m }))}"></button>
    <div class="job-top">
      <div class="job-name">${esc(n.name)}</div>
      <div class="job-pct"><b>${m}%</b><span>${esc(t("jobs.matchWord"))}</span></div>
    </div>
    <div class="job-row"><span>${esc(p?.route ? t("jobs.readyLine", { w: W(p.ready) }) : t("path.noRouteShort"))}</span>
      ${n.mycol ? `<span class="dem d-up" title="${esc(t("jobs.mycolTip", { title: n.mycol.title, code: n.mycol.code }))}"><i data-lucide="trending-up"></i>${esc(t("jobs.mycol"))}</span>`
        : `<span class="dem d-${dm[0]}"><i data-lucide="${dm[1]}"></i>${esc(t(dm[2]))}</span>`}</div>
    ${risk === "High" ? `<div class="job-risk">${esc(t("jobs.risk.High"))}</div>` : ""}
    ${tags.length ? `<div class="job-tags">${tags.join("")}</div>` : ""}
  </div>`;
}

// ---------- search ----------
function localMatches(q) {
  const s = q.toLowerCase();
  return Object.entries(S.graph.nodes).filter(([, n]) => n.type === "job" && (n.name.toLowerCase().includes(s) || (n.aliases || []).some(a => a.toLowerCase().includes(s)) || s.split(/\s+/).some(w => w.length > 3 && n.name.toLowerCase().includes(w))))
    .slice(0, 4).map(([job, n]) => ({ job, title: n.name, via: "name" }));
}

function resultRow(r) {
  const known = S.E.isJob(r.job), on = UI.ring.includes(r.job);
  if (!known) return "";
  return `<button class="result" type="button" data-pick="${esc(r.job)}"><span class="ic"><i data-lucide="${on ? "map-pin" : "plus"}"></i></span>
    <span><div class="rn">${esc(nameOf(r.job))}</div><div class="rm">${esc(on ? t("search.onMap") : t("search.add"))}${N(r.job).conf ? ", " + esc(t("jobs.confShort", { conf: t("conf." + N(r.job).conf) })) : ""}</div></span><span class="rp num">${matchOf(r.job)}%</span></button>`;
}

function escoHtml() {
  return search.esco.length ? `<div class="sub-h">${esc(t("esco.searchHead"))} ${badge("b-info", "ESCO", "database")}</div><div class="results">${search.esco.map(e => `<button class="result" type="button" data-esco="${esc(e.id)}"><span class="ic"><i data-lucide="search-check"></i></span>
      <span><div class="rn">${esc(e.title)}${e.critical ? " " + badge("b-good", t("esco.critical"), "star") : ""}</div><div class="rm">${esc(t("esco.searchRow", { n: e.essential }))}${e.iloExposure !== null ? ". " + esc(t("esco.ai", { n: Math.round(e.iloExposure * 100) })) : ""}</div></span></button>`).join("")}</div>` : "";
}

function resultsHtml() {
  const q = UI.search.trim();
  if (!q) return "";
  const local = localMatches(q);
  if (search.q !== q || search.loading) return local.map(resultRow).join("") + loadingBox(t("search.searching")) + escoHtml();
  if (search.err) return local.map(resultRow).join("") + (search.err.notAvailable ? (local.length ? "" : `<div class="found"><p>${esc(t("search.noneLocal"))}</p></div>`) : errorBox(search.err, "search")) + escoHtml();
  const res = search.res || {};
  const rows = (res.results || []).map(resultRow).join("");
  const u = res.unknown;
  const unk = u ? `<div class="found">
      <div class="fn"><b>${esc(u.title || q)}</b>${badge("b-warn", t("search.lowConf"), "triangle-alert")}</div>
      <p>${esc(t("search.unknownBody"))}</p>
      ${(u.nearest || []).filter(x => S.E.isJob(x.job)).length ? `<div class="sub-h">${esc(t("search.nearest"))}</div><div class="results">${u.nearest.filter(x => S.E.isJob(x.job)).map(resultRow).join("")}</div>` : ""}
      ${(u.esco || []).length ? `<div class="sub-h">${esc(t("search.esco"))} ${badge("b-info", "ESCO", "database")}</div><ul class="esco-list">${u.esco.slice(0, 5).map(e => `<li>${extLink(e.uri, e.title)}</li>`).join("")}</ul>` : ""}
    </div>` : "";
  const escoRows = escoHtml();
  if (!rows && !unk && !escoRows) return `<div class="found"><p>${esc(t("search.noResults"))}</p></div>`;
  return rows + unk + escoRows;
}

const runSearch = debounce(async q => {
  const seq = ++search.seq;
  search.q = q; search.loading = true; search.err = null; search.res = null; search.esco = [];
  // All ESCO occupations, searched locally alongside the catalogue and shown as soon as they arrive
  // (an error just hides the section).
  get("/esco/occupations", { q, limit: 6 }).then(r => r.results || [], () => []).then(rows => {
    if (seq !== search.seq) return;
    search.esco = rows; repaintResults();
  });
  try {
    const res = await get("/jobs/search", { q });
    if (seq !== search.seq) return;
    search.res = res;
  } catch (e) {
    if (seq !== search.seq) return;
    search.err = e;
  }
  search.loading = false;
  repaintResults();
}, 280);

function repaintResults() {
  const box = $("results"); if (!box) return;
  box.innerHTML = resultsHtml();
  bindResults(); icons();
}

function bindResults() {
  const box = $("results"); if (!box) return;
  box.querySelectorAll("[data-pick]").forEach(b => b.onclick = () => { UI.search = ""; search.q = ""; actions.pinJob(b.dataset.pick); });
  box.querySelectorAll("[data-esco]").forEach(b => b.onclick = () => openSheet("esco", b.dataset.esco));
  bindRetry(box, { search: () => { search.q = ""; runSearch(UI.search.trim()); repaintResults(); } });
}

// ---------- SDG ranking ----------
export async function loadRank() {
  if (!UI.sdg) { UI.rank = null; UI.rankErr = null; return; }
  const want = UI.sdg;
  UI.rank = null; UI.rankErr = null;
  try {
    const res = await get("/rank", { profile: profileId(), sdg: want, year: S.year, scenario: S.scenario });
    if (UI.sdg !== want) return;
    UI.rank = res;
  } catch (e) { if (UI.sdg === want) UI.rankErr = e; }
}

export function bind(el) {
  el.querySelectorAll("[data-job]").forEach(b => b.addEventListener("click", () => actions.selectJob(b.dataset.job)));
  el.querySelectorAll("[data-sector]").forEach(b => b.addEventListener("click", () => { UI.explore = true; actions.setSector(b.dataset.sector); }));
  const exp = $("explore"); if (exp) exp.addEventListener("toggle", () => { UI.explore = exp.open; });
  const best = $("esco-best"); if (best) best.addEventListener("click", () => openSheet("escoBest"));
  el.querySelectorAll("[data-try]").forEach(b => b.addEventListener("click", () => {
    UI.search = b.dataset.try; const q = $("q"); q.value = UI.search; q.focus();
    runSearch(UI.search.trim()); repaintResults();
  }));
  const q = $("q");
  if (q) q.addEventListener("input", e => { UI.search = e.target.value; const v = UI.search.trim(); if (v) runSearch(v); else search.seq++; repaintResults(); });
  const sel = $("sdg-sel");
  if (sel) sel.addEventListener("change", async () => {
    UI.sdg = sel.value ? Number(sel.value) : null;
    if (!S.profileFallback && !S.profile?.isDemo) put(`/profile/${profileId()}`, { sdgPriority: UI.sdg }).catch(() => {});
    UI.rank = null;
    actions.refresh({ animate: true });
    await loadRank();
    actions.refresh({ animate: false });
  });
  bindRetry(el, { rank: async () => { await loadRank(); actions.refresh(); } });
  bindResults();
}
