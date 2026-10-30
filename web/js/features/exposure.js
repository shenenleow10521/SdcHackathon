// Our self-trained AI-exposure model (bge-m3 embeddings + ridge regression on human-rated task labels,
// Eloundou et al., "GPTs are GPTs", Science 2024). Shown next to the knowledge-base value, never replacing it.
// GET /api/exposure/skill/:id, GET /api/exposure/model, POST /api/exposure/score.
// The endpoints answer 503 exposure_model_unavailable when the server isn't on bge-m3 embeddings: the block then hides.
import { UI } from "../state.js";
import { get, post } from "../api.js";
import { t } from "../i18n.js";
import { esc, icons, badge, srcBadge, errorBox, loadingBox, fmtDate, bindRetry } from "../util.js";
import { openCustom } from "./why.js";

const cache = { skill: {}, model: null };
const unavailable = e => e?.code === "exposure_model_unavailable" || e?.notAvailable || e?.status === 503 || e?.status === 404;

/** Placeholder in the skill drawer, folded so the drawer leads with one exposure figure; filled (or removed) by loadSkillExposure. */
export const skillBlock = k => `<details class="sec dsec" id="xp-sec" data-skill-xp="${esc(k)}"><summary><span><i data-lucide="brain-circuit"></i>${esc(t("xp.title"))}</span><i class="chev" data-lucide="chevron-down"></i></summary><div id="xp-box">${loadingBox(t("xp.loading"))}</div></details>`;

export function modelLabel(m) {
  const run = m?.run || {};
  return t("xp.label", { where: run.where === "runpod" ? "RunPod" : run.where === "local" ? t("xp.local") : (run.where || "–"), gpu: run.gpu || "" }).trim();
}

const pctBar = (x, cls = "") => `<span class="xp-bar ${cls}" aria-hidden="true"><i style="width:${Math.round(Math.max(0, Math.min(1, x)) * 100)}%"></i></span>`;

export async function loadSkillExposure(k) {
  const sec = () => (UI.drawer === k ? document.getElementById("xp-sec") : null);
  let res = cache.skill[k];
  if (!res) {
    try { res = await get(`/exposure/skill/${encodeURIComponent(k)}`, null, { timeout: 20000 }); cache.skill[k] = res; }
    catch (e) {
      const s = sec(); if (!s) return;
      if (unavailable(e)) { s.remove(); return; } // hide gracefully: the knowledge-base value stands on its own
      const b = s.querySelector("#xp-box"); b.innerHTML = errorBox(e, "xp"); bindRetry(b, { xp: () => { b.innerHTML = loadingBox(t("xp.loading")); loadSkillExposure(k); } }); icons();
      return;
    }
  }
  const s = sec(); if (!s) return;
  if (!res.tasks?.length && res.modelMean == null) { s.remove(); return; }
  cache.model = res.model || cache.model;
  const kb = res.knowledgeBase || {};
  s.querySelector("#xp-box").innerHTML = `
    <p class="rs"><button class="link-btn" type="button" id="xp-how">${esc(t("xp.how"))}</button></p>
    <div class="xp-cmp">
      <div><div class="k">${esc(t("xp.kb"))}${(kb.source || "sample") === "sample" ? ` <span class="rs">(${esc(t("src.sample").toLowerCase())})</span>` : ""}</div><div class="v num">${kb.exposure2026 == null ? "–" : Math.round(kb.exposure2026 * 100) + "%"}</div>${kb.exposure2026 == null ? "" : pctBar(kb.exposure2026, "kb")}</div>
      <div><div class="k">${esc(t("xp.modelMean"))}</div><div class="v num">${res.modelMean == null ? "–" : Math.round(res.modelMean * 100) + "%"}</div>${res.modelMean == null ? "" : pctBar(res.modelMean, "m")}</div>
    </div>
    <ul class="xp-tasks">${(res.tasks || []).map(x => `<li><div class="xp-t"><span>${esc(x.task)}</span></div>
      <div class="xp-v">${pctBar(x.exposure, "m")}<b class="num">${Math.round(x.exposure * 100)}%</b></div></li>`).join("")}</ul>
    <p class="src">${esc(res.model?.measures || t("xp.measures"))}</p>`;
  s.querySelector("#xp-how").addEventListener("click", ev => howGood(ev.currentTarget, res.model));
  icons();
}

function metricsTable(rows, labelKey) {
  if (!rows) return "";
  const r = (key, label) => rows[key] ? `<tr><td>${esc(label)}</td><td class="num">${fmt(rows[key].pearson)}</td><td class="num">${fmt(rows[key].spearman)}</td><td class="num">${fmt(rows[key].mae)}</td></tr>` : "";
  const n = rows.model?.n;
  return `<h4>${esc(t(labelKey, { n: n ?? "–" }))}</h4><div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>Pearson ↑</th><th>Spearman ↑</th><th>MAE ↓</th></tr></thead><tbody>
    ${r("model", t("xp.m.model"))}${r("baselineNearestNeighbour", t("xp.m.nn"))}${r("baselineMean", t("xp.m.mean"))}${r("referenceGpt4Labels", t("xp.m.gpt4"))}</tbody></table></div>`;
}
const fmt = v => v == null ? "–" : Number(v).toFixed(3);

export function modelCardHtml(m) {
  if (!m) return "";
  const ev = m.evaluation || {};
  return `<div class="pop-sec">${metricsTable(ev.perTask, "xp.perTask")}</div>
    <div class="pop-sec">${metricsTable(ev.perOccupation, "xp.perOcc")}</div>
    <ul class="formula-notes">
      ${ev.split ? `<li>${esc(t("xp.split", { split: ev.split }))}</li>` : ""}
      ${m.trainedOn ? `<li>${esc(t("xp.trainedOn", { tasks: m.trainedOn.tasks ?? "–", occ: m.trainedOn.occupations ?? "–" }))}</li>` : ""}
      ${m.target ? `<li>${esc(t("xp.target", { target: m.target }))}</li>` : ""}
      <li>${esc(modelLabel(m))}${m.run?.time ? ", " + esc(fmtDate(m.run.time)) : ""}</li>
    </ul>
    <p class="formula">${esc(t("xp.caveat"))} ${m.measures ? esc(m.measures) : ""}</p>`;
}

async function howGood(anchor, model) {
  let m = model || cache.model;
  if (!m?.evaluation) { try { m = cache.model = await get("/exposure/model"); } catch { m = model; } }
  openCustom(anchor, t("xp.howKicker"), t("xp.howTitle"), modelCardHtml(m) || `<p class="note">${esc(t("state.notAvailable"))}</p>`);
}

// ---------- admin: model card + score a task ----------
export async function adminModelHtml() {
  let m;
  try { m = cache.model = await get("/exposure/model"); }
  catch (e) { return errorBox(e, "xpmodel"); }
  return `<div class="stack">
    <div class="card"><h3><i data-lucide="brain-circuit"></i>${esc(t("xp.adminTitle"))} ${m.available ? badge("b-good", t("xp.available"), "check") : badge("b-mute", t("xp.unavailable"))}</h3>
      <p>${esc(t("xp.adminIntro"))}</p>
      ${!m.available ? `<p class="note">${esc(t("xp.unavailableWhy", { active: m.activeEmbeddingModel || m.embeddingProvider || "–", need: m.embeddingModel || "BAAI/bge-m3" }))}</p>` : ""}
      ${modelCardHtml(m)}</div>
    <form class="card" id="xp-score-form"><h3><i data-lucide="pencil-line"></i>${esc(t("xp.scoreTitle"))}</h3>
      <label class="sr" for="xp-tasks">${esc(t("xp.scoreLabel"))}</label>
      <textarea id="xp-tasks" class="textarea" rows="4" placeholder="${esc(t("xp.scorePh"))}" ${m.available ? "" : "disabled"}></textarea>
      <p class="rs">${esc(t("xp.scoreHint"))}</p>
      <button class="btn btn-primary" type="submit" ${m.available ? "" : "disabled"}><i data-lucide="gauge"></i>${esc(t("xp.scoreBtn"))}</button>
      <div id="xp-score-out" aria-live="polite"></div></form>
  </div>`;
}

export function bindAdminModel(root) {
  const f = root.querySelector("#xp-score-form"); if (!f) return;
  f.addEventListener("submit", async ev => {
    ev.preventDefault();
    const out = f.querySelector("#xp-score-out");
    const tasks = f.querySelector("#xp-tasks").value.split(/\n+/).map(s => s.trim()).filter(s => s.length >= 3).map(s => s.slice(0, 300)).slice(0, 50);
    if (!tasks.length) { out.innerHTML = `<div class="state-box err">${esc(t("xp.scoreEmpty"))}</div>`; return; }
    const btn = f.querySelector("button[type=submit]"); btn.disabled = true; out.innerHTML = loadingBox(t("xp.scoring"));
    try {
      const res = await post("/exposure/score", { tasks }, { timeout: 30000 });
      out.innerHTML = `<ul class="xp-tasks">${(res.scores || []).map(x => `<li><div class="xp-t"><span>${esc(x.task)}</span></div><div class="xp-v">${pctBar(x.exposure, "m")}<b class="num">${Math.round(x.exposure * 100)}%</b></div></li>`).join("")}</ul>
        <p class="src">${esc(res.model?.measures || t("xp.measures"))}</p>`;
    } catch (e) { out.innerHTML = unavailable(e) ? `<div class="state-box na">${esc(e.message)}</div>` : errorBox(e); }
    btn.disabled = false; icons();
  });
}

