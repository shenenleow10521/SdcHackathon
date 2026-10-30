// The "To" box at the top of the planner: search any job (catalogue jobs, low-confidence unknown titles and all ESCO
// jobs), shown as a dropdown. Picking a result opens that job's plan, like choosing a destination in a map app.
// While nothing is typed, the box names the job on the map, with an × to clear it (back to the list).
import { S, UI, N, nameOf, matchOf, actions } from "../state.js";
import { get } from "../api.js";
import { t } from "../i18n.js";
import { $, esc, icons, badge, errorBox, loadingBox, debounce, extLink, bindRetry } from "../util.js";

const search = { q: "", res: null, err: null, loading: false, seq: 0, esco: [] };
let dest = null; // the job on the map, shown in the box while nothing is typed

function localMatches(q) {
  const s = q.toLowerCase();
  return Object.entries(S.graph.nodes).filter(([, n]) => n.type === "job" && (n.name.toLowerCase().includes(s) || (n.aliases || []).some(a => a.toLowerCase().includes(s)) || s.split(/\s+/).some(w => w.length > 3 && n.name.toLowerCase().includes(w))))
    .slice(0, 4).map(([job, n]) => ({ job, title: n.name, via: "name" }));
}

function resultRow(r) {
  if (!S.E.isJob(r.job)) return "";
  return `<button class="result" type="button" data-pick="${esc(r.job)}"><span class="ic"><i data-lucide="briefcase"></i></span>
    <span><div class="rn">${esc(nameOf(r.job))}</div><div class="rm">${esc(t("dir.openPlan"))}${N(r.job).conf ? ", " + esc(t("jobs.confShort", { conf: t("conf." + N(r.job).conf) })) : ""}</div></span><span class="rp num">${matchOf(r.job)}%</span></button>`;
}

function escoHtml() {
  return search.esco.length ? `<div class="sub-h">${esc(t("esco.searchHead"))}</div>${search.esco.map(e => `<button class="result" type="button" data-esco="${esc(e.id)}"><span class="ic"><i data-lucide="search-check"></i></span>
      <span><div class="rn">${esc(e.title)}${e.critical ? " " + badge("b-good", t("esco.critical"), "star") : ""}</div><div class="rm">${esc(t("esco.searchRow", { n: e.essential }))}${e.iloExposure !== null && e.iloExposure !== undefined ? ". " + esc(t("esco.ai", { n: Math.round(e.iloExposure * 100) })) : ""}</div></span></button>`).join("")}` : "";
}

function resultsHtml() {
  const q = UI.search.trim();
  if (!q) return "";
  const local = localMatches(q);
  if (search.q !== q || search.loading) return local.map(resultRow).join("") + loadingBox(t("search.searching")) + escoHtml();
  if (search.err) return local.map(resultRow).join("") + (search.err.notAvailable ? (local.length ? "" : `<div class="found"><p>${esc(t("search.noneLocal"))}</p></div>`) : errorBox(search.err, "search")) + escoHtml();
  const res = search.res || {};
  const seen = new Set();
  const rows = [...local, ...(res.results || [])].filter(r => !seen.has(r.job) && seen.add(r.job)).map(resultRow).join("");
  const u = res.unknown;
  const unk = u ? `<div class="found">
      <div class="fn"><b>${esc(u.title || q)}</b>${badge("b-warn", t("search.lowConf"), "triangle-alert")}</div>
      <p>${esc(t("search.unknownBody"))}</p>
      ${(u.nearest || []).filter(x => S.E.isJob(x.job)).length ? `<div class="sub-h">${esc(t("search.nearest"))}</div>${u.nearest.filter(x => S.E.isJob(x.job)).map(resultRow).join("")}` : ""}
      ${(u.esco || []).length ? `<div class="sub-h">${esc(t("search.esco"))} ${badge("b-info", "ESCO", "database")}</div><ul class="esco-list">${u.esco.slice(0, 5).map(e => `<li>${extLink(e.uri, e.title)}</li>`).join("")}</ul>` : ""}
    </div>` : "";
  const escoRows = escoHtml();
  if (!rows && !unk && !escoRows) return `<div class="found"><p>${esc(t("search.noResults"))}</p></div>`;
  return rows + unk + escoRows;
}

const runSearch = debounce(async q => {
  const seq = ++search.seq;
  search.q = q; search.loading = true; search.err = null; search.res = null; search.esco = [];
  // All ESCO occupations, searched alongside the catalogue and shown as soon as they arrive (an error just hides them).
  get("/esco/occupations", { q, limit: 6 }).then(r => r.results || [], () => []).then(rows => {
    if (seq !== search.seq) return;
    search.esco = rows; paint();
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
  paint();
}, 280);

function setOpen(open) {
  const box = $("results"), q = $("q");
  box.hidden = !open; q.setAttribute("aria-expanded", String(open));
}

function paint() {
  const box = $("results");
  const html = resultsHtml();
  box.innerHTML = html;
  setOpen(!!html && document.activeElement === $("q") || (!!html && box.contains(document.activeElement)));
  box.querySelectorAll("[data-pick]").forEach(b => b.onclick = () => { done(); actions.showPath(b.dataset.pick); });
  box.querySelectorAll("[data-esco]").forEach(b => b.onclick = () => {
    const e = search.esco.find(x => String(x.id) === b.dataset.esco); done();
    if (e) actions.openEscoJob(e);
  });
  bindRetry(box, { search: () => { search.q = ""; runSearch(UI.search.trim()); paint(); } });
  icons();
}

/** A result was picked: close the list (the box then names the new job). */
function done() {
  UI.search = ""; search.q = ""; search.seq++;
  const q = $("q"); q.blur();
  setOpen(false);
}

/** Show the chosen job in the box (unless you're typing), and the × when there's something to clear. */
export function renderTo(name) {
  dest = name || null;
  const q = $("q");
  if (document.activeElement !== q && !UI.search) q.value = dest || "";
  $("dir-x").hidden = !q.value;
}

export function initSearch() {
  const q = $("q"), box = $("results");
  q.addEventListener("input", e => { UI.search = e.target.value; const v = UI.search.trim(); if (v) runSearch(v); else search.seq++; paint(); $("dir-x").hidden = !q.value; });
  // focusing the box selects the job's name, so typing replaces it; leaving it without typing puts the name back
  q.addEventListener("focus", () => { if (UI.search.trim()) paint(); else if (dest && q.value === dest) q.select(); });
  q.addEventListener("blur", () => { if (!UI.search.trim()) { UI.search = ""; q.value = dest || ""; $("dir-x").hidden = !q.value; } });
  $("dir-x").addEventListener("click", () => {
    if (UI.search) { UI.search = ""; search.seq++; q.value = dest || ""; setOpen(false); $("dir-x").hidden = !q.value; return; }
    actions.clearDestination();
  });
  q.addEventListener("keydown", e => {
    if (e.key === "Escape") { setOpen(false); q.blur(); }
    if (e.key === "ArrowDown") { const f = box.querySelector("button"); if (f) { e.preventDefault(); f.focus(); } }
  });
  box.addEventListener("keydown", e => {
    const items = [...box.querySelectorAll("button")], i = items.indexOf(document.activeElement);
    if (e.key === "Escape") { setOpen(false); q.focus(); }
    if (e.key === "ArrowDown" && i >= 0) { e.preventDefault(); items[Math.min(items.length - 1, i + 1)].focus(); }
    if (e.key === "ArrowUp" && i >= 0) { e.preventDefault(); if (i === 0) q.focus(); else items[i - 1].focus(); }
  });
  document.addEventListener("pointerdown", e => { if (!box.hidden && !box.contains(e.target) && e.target !== q) setOpen(false); });
}

/** The "From" line: you and your job today. */
export function renderFrom(job) {
  $("dir-from-v").innerHTML = job ? `<b>${esc(t("dir.fromYou"))}</b><span class="dir-job">${esc(t("dir.fromJob", { job }))}</span>` : esc(t("dir.fromNoJob"));
}
