// AI futures, the way planning tools show an uncertain future: one headline with the expected value and its range,
// then what would change the plan, with the full numbers folded away. Time is measured from the person (when they're
// job-ready, and N years from now), never as a calendar year; the AI speed (Slow / Expected / Fast) is the scenario.
// Runs the shared engine a few times in the browser (milliseconds). Every figure is an estimate and is labelled so.
import { createEngine, displayWeeks, PARAMS } from "/shared/engine.js";
import { S, UI, nameOf, isLater } from "../state.js";
import { t, getLang } from "../i18n.js";
import { esc, badge } from "../util.js";

const PACES = ["slow", "moderate", "fast"];
const cache = new Map();

/** The plan at each AI speed: when you're job-ready, and at the end of the forecast (N years from now). */
export function compareFutures(job, mode, extraReq = []) {
  const p = S.profile, root = S.E.root;
  const key = JSON.stringify([job, mode, extraReq, root, p.hours, p.level, S.graph.kbVersion, S.graph.deltas || null]);
  if (cache.has(key)) return cache.get(key);
  const eng = (year, scenario) => createEngine(S.graph, { occupationId: root, level: p.level, hours: p.hours }, { year, scenario });
  const topOf = E => E.allJobs().filter(j => j !== root).sort((a, b) => E.rankScore(b) - E.rankScore(a))[0] || null;
  const now = eng(PARAMS.baseYear, "moderate");
  let weeksNow = null;
  if (job) { try { const pl = now.planFor(job, mode, extraReq); weeksNow = pl?.route ? displayWeeks(pl.ready, p.hours) : null; } catch { weeksNow = null; } }
  // the forecast's start year is today, so "job-ready" is that many weeks after it (never past the end of the data)
  const readyYear = weeksNow == null ? null : Math.min(PARAMS.endYear, PARAMS.baseYear + weeksNow / 52);
  const paces = PACES.map(s => {
    const out = { scenario: s, ready: null };
    const later = eng(PARAMS.endYear, s);
    Object.assign(out, { top: topOf(later), safe: later.futureScore(), aiLater: job ? Math.round(100 * later.exposure(job)) : null });
    if (job && readyYear != null) {
      const E = eng(readyYear, s);
      let pl = null; try { pl = E.planFor(job, mode, extraReq); } catch { pl = null; }
      out.ready = { weeks: pl?.route ? displayWeeks(pl.ready, p.hours) : null, risk: pl?.route?.risk || null, ai: Math.round(100 * E.exposure(job)),
        skills: pl?.route ? pl.route.nodes.filter(E.isSkill).filter(k => !E.owned(k)) : [] };
    }
    return out;
  });
  const r = { job, weeksNow, topNow: topOf(now), paces, by: Object.fromEntries(paces.map(x => [x.scenario, x])) };
  if (cache.size > 40) cache.clear();
  cache.set(key, r);
  return r;
}

const join = list => (list.length > 1 ? list.slice(0, -1).join(", ") + t("stress.and") + list[list.length - 1] : list[0]);
const readyDate = weeks => new Date(Date.now() + weeks * 7 * 864e5).toLocaleDateString(getLang() === "ms" ? "ms-MY" : "en-GB", { month: "short", year: "numeric" });

/** One line for the plan header: the expected value in N years, its slow-to-fast range, and a top-pick change. */
export function futuresLine(job, mode, extraReq = []) {
  let c; try { c = compareFutures(job, mode, extraReq); } catch { return ""; }
  const { slow, moderate: exp, fast } = c.by;
  let text;
  if (job) {
    const lo = Math.min(slow.aiLater, fast.aiLater), hi = Math.max(slow.aiLater, fast.aiLater);
    text = hi - lo <= 2 ? t("fut.headSame", { e: exp.aiLater }) : t("fut.head", { e: exp.aiLater, lo, hi });
  } else text = t("fut.headEsco", { e: exp.safe, lo: Math.min(slow.safe, fast.safe), hi: Math.max(slow.safe, fast.safe) });
  if (fast.top && exp.top && fast.top !== exp.top) text += " " + t("fut.headTop", { job: nameOf(fast.top) });
  return `<p class="fut-line"><i data-lucide="git-compare-arrows"></i><span>${esc(text)} <button class="link-btn" type="button" data-jump-fut>${esc(t("fut.compare"))}</button></span></p>`;
}

/** What would change the plan, in sentences; speeds that change the same thing share one sentence. */
function shifts(c) {
  const exp = c.by.moderate, out = [], groups = new Map();
  const note = (key, vars, s) => { const k = key + JSON.stringify(vars); if (!groups.has(k)) groups.set(k, { key, vars, scn: [] }); groups.get(k).scn.push(t("scn." + s)); };
  if (exp.top && c.topNow && exp.top !== c.topNow) out.push(t("fut.topShift", { when: t("fut.whenExpected"), job: nameOf(exp.top), was: nameOf(c.topNow) }));
  for (const s of ["slow", "fast"]) {
    const x = c.by[s];
    if (x.top && exp.top && x.top !== exp.top) note("later:fut.topShift", { job: nameOf(x.top), was: nameOf(exp.top) }, s);
    if (x.ready && exp.ready) {
      const drop = exp.ready.skills.filter(k => !x.ready.skills.includes(k)), add = x.ready.skills.filter(k => !exp.ready.skills.includes(k));
      if (drop.length || add.length) note("ready:" + (drop.length && add.length ? "fut.routeSwap" : drop.length ? "fut.routeDrop" : "fut.routeAdd"),
        { drop: drop.map(nameOf).join(", "), add: add.map(nameOf).join(", ") }, s);
    }
  }
  for (const g of groups.values()) {
    const [when, key] = g.key.split(":");
    out.push(t(key, { ...g.vars, when: t(when === "later" ? "fut.whenLater" : "fut.whenReady", { scn: join(g.scn) }) }));
  }
  const fw = c.by.fast.ready?.weeks, ew = exp.ready?.weeks;
  if (fw != null && ew != null && fw !== ew) out.push(t("fut.weeksShift", { a: ew, b: fw }));
  return out;
}

/** The section under the route: what shifts, then the numbers (folded). job = null for an ESCO job. */
export function futuresHtml(job, mode, extraReq = []) {
  let c; try { c = compareFutures(job, mode, extraReq); } catch (e) { console.warn("futures compare failed", e); return ""; }
  const on = s => isLater() && S.scenario === s;
  const th = c.paces.map(x => `<th scope="col"${on(x.scenario) ? ` class="now" aria-current="true"` : ""}><button class="link-btn" type="button" data-future="${x.scenario}">${esc(t("scn." + x.scenario + "Btn"))}</button></th>`).join("");
  const row = (k, cell) => `<tr><th scope="row">${esc(t(k))}</th>${c.paces.map(x => `<td class="${on(x.scenario) ? "now" : ""}">${cell(x)}</td>`).join("")}</tr>`;
  const grp = text => `<tr class="grp"><th colspan="4" scope="rowgroup">${esc(text)}</th></tr>`;
  const ready = job && c.weeksNow != null ? [
    grp(t("fut.ready", { date: readyDate(c.weeksNow) })),
    row("fut.weeks", x => (x.ready?.weeks == null ? "–" : esc(t("common.weeksN", { w: x.ready.weeks })))),
    row("fut.ai", x => esc((x.ready?.ai ?? "–") + "%")),
    row("fut.risk", x => (x.ready?.risk ? esc(t("jobs.risk." + x.ready.risk)) : "–")),
  ].join("") : "";
  const later = [
    grp(t("fut.later")),
    job ? row("fut.ai", x => esc(x.aiLater + "%")) : "",
    row("fut.safe", x => esc(x.safe + "%")),
    row("fut.top", x => (x.top ? esc(nameOf(x.top)) : "–")),
  ].join("");
  const sh = shifts(c);
  return `<section class="futures" id="futures" aria-labelledby="fut-h">
    <h3 class="sec-h" id="fut-h">${esc(t("fut.title"))}${badge("b-mute", t("fut.estimate"))}</h3>
    <ul class="fut-shifts">${(sh.length ? sh : [t(job ? "fut.holds" : "fut.holdsTop")]).map(x => `<li>${esc(x)}</li>`).join("")}</ul>
    <details class="fut-more"${UI.futOpen ? " open" : ""}>
      <summary>${esc(t("fut.numbers"))}<i class="chev" data-lucide="chevron-down"></i></summary>
      <p class="note">${esc(t("fut.lead"))}</p>
      <div class="tbl-wrap"><table class="tbl fut-tbl"><thead><tr><th></th>${th}</tr></thead><tbody>${ready}${later}</tbody></table></div>
      <p class="src">${esc(t(job ? "fut.src" : "fut.srcEsco"))}</p>
    </details>
  </section>`;
}

/** A column header switches the app to that AI speed, N years from now; the header line jumps to the section. */
export function bindFutures(el) {
  el.querySelectorAll("[data-future]").forEach(b => b.addEventListener("click", () => {
    if (!isLater()) document.querySelector('[data-year="2030"]')?.click();
    document.querySelector(`[data-scn="${b.dataset.future}"]`)?.click();
  }));
  const more = el.querySelector(".fut-more"); if (more) more.addEventListener("toggle", () => { UI.futOpen = more.open; });
  el.querySelectorAll("[data-jump-fut]").forEach(b => b.addEventListener("click", () => el.querySelector("#futures")?.scrollIntoView({ behavior: "smooth", block: "start" })));
}
