// Explore tab: your best matches as one list (catalogue and ESCO jobs, best first; the map shows the same jobs), "Show 10
// more", and other ways to explore (sectors, SDG priority, the full ESCO list). Searching any job is the "To" box above.
// Tapping a row selects the job (its route shows on the map) and keeps you here; "Open plan" opens it in the Plan tab.
import { S, UI, D, N, nameOf, W, matchOf, actions, profileId, escoRow, escoRowWeeks, SHOW_STEP, MAP_STARS_MAX, isEsco } from "../state.js";
import { get, put } from "../api.js";
import { t } from "../i18n.js";
import { $, esc, icons, errorBox, loadingBox, bindRetry } from "../util.js";
import { openSheet } from "../features/views.js";
import { isGoal } from "../features/goal.js";
import { stayTrack } from "../features/stay.js";

export function render() {
  const sec = (S.graph.sectors || []).find(s => s.id === UI.sector) || { name: t("jobs.best"), note: "" };
  const sdgs = S.graph.sdgs || {};
  const open = UI.explore || UI.sector !== "best" || !!UI.sdg;
  const list = listJobs();
  const total = (S.escoJobs || 3039).toLocaleString("en-MY");
  const best = UI.sector === "best" && !UI.sdg;
  // Staying comes first: your own job, AI-ready (features/stay.js), then the jobs you could move to.
  const st = best ? stayTrack() : null, move = list;
  const card = j => (isEsco(j) ? escoCard(j) : jobCard(j));
  return `<div class="stack">
    ${st ? `<div><div class="h2"><h2>${esc(t("jobs.stayH"))}</h2></div><div class="jobs stay-list">${stayCard(st)}</div></div>` : ""}
    <div>
      <div class="h2"><h2>${esc(st ? t("jobs.moveH") : best ? t("jobs.bestTitle") : t("jobs.sectorTitle", { name: sectorName(sec) }))}</h2>${move.length && best ? `<span>${esc(t("jobs.topOf", { n: list.length, total }))}</span>` : ""}</div>
      ${move.length ? `<div class="jobs">${move.map(j => card(j)).join("")}</div>` : `<div class="jobs"><div class="empty">${esc(t("jobs.none"))}</div></div>`}
      ${showMore(list.length)}
      ${demandNote()}
    </div>
    <details class="explore" id="explore"${open ? " open" : ""}>
      <summary><i data-lucide="compass"></i><span><b>${esc(t("jobs.explore"))}</b><small>${esc(t("jobs.exploreSub"))}</small></span><i class="chev" data-lucide="chevron-down"></i></summary>
      <div class="explore-in">
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
        <button class="btn btn-ghost sm esco-best-btn" type="button" id="esco-best"><i data-lucide="network"></i>${esc(t("esco.bestBtn"))}</button>
      </div>
    </details>
  </div>`;
}

export const sectorName = s => s.id === "best" ? t("jobs.best") : s.name;

/** The jobs in the list, best match first: the same jobs the map shows (your own job is listed above them, separately). */
function listJobs() {
  const all = [...UI.ring, ...UI.escoRing.filter(j => !escoRow(j)?.isCurrent)];
  if (UI.sdg || UI.sector !== "best") return all;
  return all.sort((a, b) => matchOf(b) - matchOf(a) || (a < b ? -1 : 1));
}

// ---------- "Show 10 more" ----------
function showMore(n) {
  if (UI.sector !== "best" || UI.sdg || !UI.poolSize) return "";
  const cap = Math.min(UI.poolSize, MAP_STARS_MAX);
  if (n < cap) return `<button class="btn btn-soft more-btn" type="button" id="show-more"><i data-lucide="chevron-down"></i>${esc(t("jobs.showMore", { n: Math.min(SHOW_STEP, cap - n) }))}</button>`;
  return `<p class="src more-end">${esc(t("jobs.showEnd", { n }))}</p>`;
}

/** Your own job, AI-ready: what to add to stay competitive in it. Opens the My goal tab, where the track lives. */
function stayCard(st) {
  const line = st.items.length ? t("jobs.stayCardLine", { k: st.items.length, w: st.weeks }) : t("outlook.stayNone", { job: st.job });
  return `<div class="job stay-card" data-card="stay">
    <button class="job-hit" type="button" data-stay-open aria-label="${esc(t("stay.title", { job: st.job }))}"></button>
    <div class="job-top"><div class="job-name">${esc(t("stay.title", { job: st.job }))}</div><span class="stay-ic"><i data-lucide="shield-check"></i></span></div>
    <div class="job-row"><span>${esc(line)}</span></div>
  </div>`;
}

/** Under the selected row: "Open plan" (the plan itself lives in the Plan tab, never twice). */
function openRow(id) {
  return `<div class="job-open"><button class="btn btn-primary sm" type="button" data-open-plan="${esc(id)}"><i data-lucide="route"></i>${esc(t("jobs.openPlan"))}</button></div>`;
}

// An ESCO job: the same card shape as a catalogue job (name and match, then weeks and the counts behind the match).
function escoCard(id) {
  const r = escoRow(id); if (!r) return "";
  // your own job has no "weeks to job-ready": you already do it
  const on = UI.escoJob === id, wk = r.isCurrent ? null : escoRowWeeks(r);
  const counts = r.close != null ? t("esco.haveClose", { have: r.have, close: r.close, n: r.essential }) : t("esco.skillsOf", { have: r.have, n: r.essential });
  return `<div class="job${on ? " on" : ""}${r.isCurrent ? " current" : ""}" data-card="${esc(id)}" aria-current="${on}">
    <button class="job-hit" type="button" data-esco-job="${esc(id)}" aria-pressed="${on}" aria-label="${esc(t("jobs.cardAria", { job: nameOf(id), match: r.match }))}"></button>
    ${r.isCurrent ? `<div class="cur-tag"><i data-lucide="house"></i>${esc(t("jobs.currentStay"))}</div>` : ""}
    <div class="job-top"><div class="job-name">${esc(nameOf(id))}</div><div class="job-pct"><b>${esc(String(r.match))}%</b><span>${esc(t("jobs.matchWord"))}</span></div></div>
    <div class="job-row"><span>${wk ? esc(t("jobs.readyLine", { w: wk })) : ""}</span>${r.critical ? `<span class="dem d-up"><i data-lucide="trending-up"></i>${esc(t("esco.criticalShort"))}</span>` : ""}</div>
    <div class="job-counts">${esc(counts)}</div>
    ${on ? openRow(id) : ""}
  </div>`;
}

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
  const on = UI.picked && UI.job === j && !UI.escoJob, mine = isGoal(j);
  const dm = demandDir(E.demand(j));
  const tags = [
    mine ? `<span class="goal-tag"><i data-lucide="flag"></i>${esc(t("goal.yours"))}</span>` : "",
    j === UI.pinned ? `<span class="jtag">${esc(t("jobs.searched"))}</span>` : "",
    rr?.sdgFit ? `<span class="jtag">${esc(t("sdg.fit", { sdg: UI.sdg }))}</span>` : "",
    moved ? `<span class="jtag">${esc(t(moved > 0 ? "jobs.movedUp" : "jobs.movedDown", { n: Math.abs(moved) }))}</span>` : "",
  ].filter(Boolean);
  return `<div class="job${mine ? " goal" : ""}${on ? " on" : ""}" data-card="${esc(j)}" aria-current="${on}">
    <button class="job-hit" type="button" data-job="${esc(j)}" aria-pressed="${on}" aria-label="${esc(t("jobs.cardAria", { job: n.name, match: m }))}"></button>
    <div class="job-top">
      <div class="job-name">${esc(n.name)}</div>
      <div class="job-pct"><b>${m}%</b><span>${esc(t("jobs.matchWord"))}</span></div>
    </div>
    <div class="job-row"><span>${esc(p?.route ? t("jobs.readyLine", { w: W(p.ready) }) : t("path.noRouteShort"))}${n.stay ? `<span class="jtag">, ${esc(t("jobs.stay"))}</span>` : ""}</span>
      ${n.mycol ? `<span class="dem d-up" title="${esc(t("jobs.mycolTip", { title: n.mycol.title, code: n.mycol.code }))}"><i data-lucide="trending-up"></i>${esc(t("jobs.mycol"))}</span>`
        : `<span class="dem d-${dm[0]}"><i data-lucide="${dm[1]}"></i>${esc(t(dm[2]))}</span>`}</div>
    ${risk === "High" ? `<div class="job-risk">${esc(t("jobs.risk.High"))}</div>` : ""}
    ${tags.length ? `<div class="job-tags">${tags.join("")}</div>` : ""}
    ${on ? openRow(j) : ""}
  </div>`;
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
  el.querySelectorAll("[data-job]").forEach(b => b.addEventListener("click", () => actions.previewJob(b.dataset.job)));
  el.querySelectorAll("[data-esco-job]").forEach(b => b.addEventListener("click", () => actions.previewJob(b.dataset.escoJob)));
  el.querySelectorAll("[data-stay-open]").forEach(b => b.addEventListener("click", () => actions.openGoalTab()));
  el.querySelectorAll("[data-open-plan]").forEach(b => b.addEventListener("click", () => actions.openPlan(b.dataset.openPlan)));
  const more = $("show-more");
  if (more) more.addEventListener("click", () => {
    const n = el.querySelectorAll(".jobs:not(.stay-list) > .job").length;
    UI.shown = Math.min(MAP_STARS_MAX, Math.max(UI.shown, n) + SHOW_STEP);
    actions.refresh({ animate: false });
    // keep your place: the first new row comes into view, and focus stays on the button (or the first new row)
    const rows = document.querySelectorAll("#panel .jobs:not(.stay-list) > .job");
    rows[n]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    ($("show-more") || rows[n]?.querySelector(".job-hit"))?.focus({ preventScroll: true });
  });
  el.querySelectorAll("[data-sector]").forEach(b => b.addEventListener("click", () => { UI.explore = true; actions.setSector(b.dataset.sector); }));
  const exp = $("explore"); if (exp) exp.addEventListener("toggle", () => { UI.explore = exp.open; });
  const best = $("esco-best"); if (best) best.addEventListener("click", () => openSheet("escoBest"));
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
}
