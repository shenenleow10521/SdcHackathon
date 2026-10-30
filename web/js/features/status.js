// System status (GET /api/health): a dot in the top bar with details on click, and the floating agents panel.
import { S, actions } from "../state.js";
import { get } from "../api.js";
import { t } from "../i18n.js";
import { $, esc, icons, badge, ago, fmtDate, store } from "../util.js";
import { A, runScout, pendingCount } from "../panels/admin.js";

export async function loadHealth() {
  try { S.health = await get("/health", null, { timeout: 8000 }); S.healthErr = null; }
  catch (e) { S.health = null; S.healthErr = e; }
  renderStatus(); renderAgents();
}

function level() {
  const h = S.health;
  if (!h) return "down";
  if (!h.db?.ok) return "down";
  if (!h.llm?.ok || !h.embed?.ok) return "partial";
  return "ok";
}

export function renderStatus() {
  const lv = level();
  const dot = $("status-dot");
  if (dot) {
    dot.className = "status-dot " + lv;
    dot.setAttribute("aria-label", t("status.aria." + lv));
    dot.title = t("status.aria." + lv);
  }
  const fr = $("fresh");
  if (fr && S.graph) fr.textContent = t("status.pill", { when: ago(S.graph.kbCreatedAt) });
}

export function statusPopover() {
  const h = S.health, box = $("status-pop");
  if (!box) return;
  if (!box.hidden) { box.hidden = true; $("status-dot").setAttribute("aria-expanded", "false"); return; }
  const row = (ok, label, value) => `<li><span class="sd ${ok === true ? "ok" : ok === false ? "down" : "partial"}"></span><span>${esc(label)}</span><b>${esc(value)}</b></li>`;
  const info = (label, value) => `<li><span></span><span>${esc(label)}</span><b>${esc(value)}</b></li>`;
  const ls = h?.scheduler?.lastScout, g = S.graph, nChanges = (g?.appliedChanges || []).length;
  const works = ok => t(ok ? "status.working" : "status.notWorking");
  box.innerHTML = !h ? `<p class="note">${esc(t("status.unreachable"))}</p><button class="ghost sm" type="button" id="status-retry"><i data-lucide="refresh-cw"></i>${esc(t("state.retry"))}</button>` : `<ul class="status-list">
      ${g ? info(t("status.dataRow"), ago(g.kbCreatedAt)) : ""}
      ${nChanges ? info(t("status.changesRow"), String(nChanges)) : ""}
      ${info(t("status.kbRow"), String(h.kbVersion ?? g?.kbVersion ?? "–"))}
      ${row(ls ? ls.status !== "failed" : null, t("status.scout"), ls ? t(ls.status === "failed" ? "status.scoutFailed" : "status.scoutOk", { when: ago(ls.startedAt) }) : t("time.never"))}
      ${row(h.db?.ok, t("status.db"), works(h.db?.ok))}
      ${row(h.llm?.ok, t("status.llm"), h.llm?.configured ? works(h.llm?.ok) : t("status.notConfigured"))}
      ${row(h.embed?.ok, t("status.embed"), h.embed?.configured && h.embed?.ok ? t("status.aiMatching") : t("status.basicMatching"))}
    </ul>
    <p class="rs">${h.demoMode ? badge("b-violet", t("status.demo"), "history") + " " + esc(t("status.demoNote")) : esc(t("status.liveNote"))}</p>
    <p class="rs">${esc(t("status.checked", { when: fmtDate(h.time) }))}</p>`;
  box.hidden = false; $("status-dot").setAttribute("aria-expanded", "true");
  icons();
  const r = box.querySelector("#status-retry"); if (r) r.addEventListener("click", async () => { box.hidden = true; await loadHealth(); statusPopover(); });
}

export function renderAgents() {
  const list = $("ag-list"); if (!list) return;
  const h = S.health, sc = A.scout, pend = pendingCount();
  const llm = h?.llm?.ok, emb = h?.embed?.ok, ls = h?.scheduler?.lastScout;
  const rows = [
    ["agent.interviewer", "message-square-text", llm ? t("agent.interviewerOn") : t("agent.aiOff"), llm ? "done" : "idle"],
    ["agent.matcher", "scan-search", emb ? t("agent.matcherOn") : t("agent.matcherBasic"), emb ? "done" : "idle"],
    ["agent.scout", "radar", sc.running ? t("agent.scoutRunning") : sc.result ? t("agent.scoutDone", { f: sc.result.counts?.flagged ?? 0, a: sc.result.counts?.auto ?? 0 }) : ls ? t("agent.scoutLast", { when: ago(ls.startedAt) }) : t("agent.scoutIdle"), sc.running ? "run" : "idle"],
    ["agent.reviewer", "shield-check", llm ? t("agent.reviewerOn") : t("agent.aiOff"), llm ? "done" : "idle"],
    ["agent.planner", "route", S.E ? t("agent.plannerOn") : "–", "done"],
  ];
  list.innerHTML = rows.map(([n, ic, d, s]) => `<li><span class="ag-ic ${s === "done" ? "" : s}"><i data-lucide="${ic}"></i></span><div><div class="an">${esc(t(n))}</div><div class="ad">${esc(d)}</div></div></li>`).join("");
  const tg = $("ag-toggle"); if (tg) tg.setAttribute("aria-label", t(tg.getAttribute("aria-expanded") === "true" ? "agent.toggle" : "agent.expand"));
  const btn = $("scout");
  if (btn) {
    if (sc.running) { btn.disabled = true; btn.innerHTML = `<span class="spin"></span>${esc(t("scout.runningBtn"))}`; }
    else if (pend) { btn.disabled = false; btn.innerHTML = `<i data-lucide="shield-check"></i>${esc(t("agent.reviewN", { n: pend }))}`; btn.dataset.next = "review"; }
    else { btn.disabled = false; btn.innerHTML = `<i data-lucide="radar"></i>${esc(t("scout.run"))}`; btn.dataset.next = "run"; }
  }
  const log = $("log");
  if (log) {
    if (sc.result && !sc.running) { log.hidden = false; log.innerHTML = `<li>${esc(t("scout.logFetched", { n: sc.result.counts?.fetched ?? 0 }))}</li><li>${esc(t("scout.logRejected", { n: sc.result.counts?.rejected ?? 0, d: sc.result.counts?.duplicates ?? 0 }))}</li><li>${esc(t("scout.logAuto", { n: sc.result.counts?.auto ?? 0 }))}</li><li>${esc(t("scout.logFlagged", { n: sc.result.counts?.flagged ?? 0 }))}</li>${sc.result.replayed || sc.result.status === "replayed" ? `<li>${esc(t("scout.logReplayed"))}</li>` : ""}`; }
    else if (sc.err && !sc.running) { log.hidden = false; log.innerHTML = `<li>${esc(sc.err.notAvailable ? t("state.notAvailable") : sc.err.message)}</li>`; }
    else log.hidden = true;
  }
  icons();
}

/** Show or hide the agents list (the tour opens it without changing the remembered choice). */
export function setAgentsOpen(open) {
  $("agents").classList.toggle("collapsed", !open);
  const b = $("ag-toggle");
  b.setAttribute("aria-expanded", String(open));
  b.setAttribute("aria-label", t(open ? "agent.toggle" : "agent.expand"));
  b.innerHTML = `<i data-lucide="${open ? "chevron-up" : "chevron-down"}"></i>`; icons();
}

export function initAgents() {
  $("scout").addEventListener("click", () => {
    if ($("scout").dataset.next === "review") { actions.setView("admin"); return; }
    runScout();
  });
  // Collapsed by default so the box doesn't cover the map; the visitor's choice is remembered.
  setAgentsOpen(store.get("agentsOpen", false));
  $("ag-toggle").addEventListener("click", () => {
    const open = $("agents").classList.contains("collapsed");
    setAgentsOpen(open); store.set("agentsOpen", open);
  });
  $("status-dot").addEventListener("click", e => { e.stopPropagation(); statusPopover(); });
  document.addEventListener("click", e => { const b = $("status-pop"); if (b && !b.hidden && !b.contains(e.target)) { b.hidden = true; $("status-dot").setAttribute("aria-expanded", "false"); } });
}

