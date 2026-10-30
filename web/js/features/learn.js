// "Ways to learn" a skill, ranked for you: one pick at the top with the reason, then one option per other format.
// Options: hand-picked videos, articles, books and practice (GET /api/learning, every link checked by hand), the
// catalogue's courses, and, where we hold nothing for a format, a plain search link (labelled as a search).
// Ranking, all on this device: the format you said you prefer, the formats you keep opening (each open adds weight,
// capped), free if you asked for free only, Malay when the app is in Malay, and whether it fits in one week of your hours.
import { S, profileId } from "../state.js";
import { get } from "../api.js";
import { t } from "../i18n.js";
import { esc, store, safeUrl, logoOf, icons } from "../util.js";

let LIB = null, loading = null;
/** Load the hand-picked list once; re-render open blocks when it arrives. */
export function loadLearning() {
  if (!loading) loading = get("/learning").then(r => { LIB = r.resources || {}; }, () => { LIB = {}; }).then(rerenderAll);
  return loading;
}

const STYLES = ["video", "article", "course", "book"];
const ICON = { video: "circle-play", article: "file-text", course: "graduation-cap", book: "book-open", practice: "hammer" };
export const RANK = { style: 2, perOpen: 0.6, maxOpens: 4, free: 0.3, freeOnly: 1.5, paidWhenFreeOnly: -3, search: -1.5, lang: 1, fits: 0.3, plan: 1.5 };

const keyOf = id => String(id).replace(/^xs:/, "").replace(/^ai:/, "ai-");
const pkey = () => "learnPrefs." + profileId();
export const prefs = () => ({ style: null, free: false, opens: {}, ...store.get(pkey(), {}) });
const save = p => store.set(pkey(), p);

/** Every option we have for a skill, before ranking. `extra` = courses from elsewhere (e.g. the ESCO outlook). */
function optionsFor(id, name, extra = []) {
  const hand = (LIB?.[keyOf(id)] || []).map(r => ({ ...r }));
  // the catalogue's first course is the one your plan and My goal count, so it leads unless you prefer another format
  const courses = [...(S.graph?.courses?.[id] || []), ...extra].filter(c => c?.url).map((c, i) => ({
    planCourse: i === 0 && !!S.graph?.courses?.[id]?.length, format: "course", title: c.title, provider: c.provider, url: c.url, minutes: c.hours ? c.hours * 60 : null,
    cost: c.costRm === 0 || /\bfree\b/i.test(c.formatText || "") ? "free" : "paid", lang: "en",
  }));
  const all = [...hand, ...courses];
  const q = encodeURIComponent(name);
  const search = {
    video: { url: `https://www.youtube.com/results?search_query=${q}`, provider: "YouTube" },
    course: { url: `https://www.coursera.org/search?query=${q}`, provider: "Coursera" },
    book: { url: `https://openlibrary.org/search?q=${q}`, provider: "Open Library" },
  };
  for (const [format, s] of Object.entries(search)) if (!all.some(r => r.format === format)) all.push({ format, search: true, title: t("learn.search." + format, { name }), ...s, cost: "free", lang: "en" });
  return all;
}

function score(r, p) {
  const hours = S.profile?.hours || 6;
  let s = 1;
  if (p.style === r.format) s += RANK.style;
  s += Math.min(p.opens[r.format] || 0, RANK.maxOpens) * RANK.perOpen;
  if (r.cost === "free") s += p.free ? RANK.freeOnly : RANK.free; else if (p.free) s += RANK.paidWhenFreeOnly;
  if (r.search) s += RANK.search;
  if (r.planCourse) s += RANK.plan;
  if (r.lang === "ms" && document.documentElement.lang === "ms") s += RANK.lang;
  if (r.minutes && r.minutes <= hours * 60) s += RANK.fits;
  return s;
}

/** Ranked: the best option of each format, best first. */
export function ranked(id, name, extra) {
  const p = prefs(), best = new Map();
  for (const r of optionsFor(id, name, extra)) { const sc = score(r, p); if (!best.has(r.format) || sc > best.get(r.format).sc) best.set(r.format, { ...r, sc }); }
  // a real, checked resource always comes before a plain search link, whatever you prefer
  return [...best.values()].sort((a, b) => (a.search ? 1 : 0) - (b.search ? 1 : 0) || b.sc - a.sc);
}

/** Why the top option is first, in plain words. */
function reason(r, p) {
  const bits = [];
  if (r.planCourse && p.style !== r.format && !(p.opens[r.format] >= 2)) bits.push(t("learn.why.plan"));
  if ((p.opens[r.format] || 0) >= 2) bits.push(t("learn.why.opens", { f: t("learn.fl." + r.format) }));
  else if (p.style === r.format) bits.push(t("learn.why.style", { f: t("learn.fl." + r.format) }));
  if (r.cost === "free") bits.push(t("learn.why.free"));
  if (r.minutes && r.minutes <= (S.profile?.hours || 6) * 60) bits.push(t("learn.why.fits"));
  return bits.length ? t("learn.picked", { why: bits.join(", ") }) : "";
}

const len = m => !m ? "" : m < 60 ? t("learn.min", { n: Math.round(m) }) : t(Math.round(m / 60) === 1 ? "learn.h1" : "learn.h", { n: Math.round(m / 60) });
const meta = r => [t("learn.f." + r.format), r.by && r.by !== r.provider ? r.by : r.provider, r.year, len(r.minutes), r.search ? "" : t("learn." + (r.cost === "paid" ? "paid" : "free")), r.lang === "ms" ? "Bahasa Melayu" : ""].filter(Boolean).join(", ");
const mark = r => logoOf(r.url) || `<i class="lr-ic" data-lucide="${ICON[r.format] || "link"}"></i>`;

function item(r, top, p) {
  const u = safeUrl(r.url); if (!u) return "";
  const why = top && !r.search ? reason(r, p) : "";
  return `<a class="lr-item${top ? " lr-top" : ""}${r.search ? " lr-search" : ""}" href="${esc(u)}" target="_blank" rel="noopener noreferrer" data-lr-fmt="${esc(r.format)}">
    <span class="lr-mark">${mark(r)}</span>
    <span class="lr-txt"><span class="lr-t">${esc(r.title)}</span><span class="lr-m">${esc(meta(r))}</span>${why ? `<span class="lr-why">${esc(why)}</span>` : ""}</span>
    <i class="lr-go" data-lucide="external-link"></i></a>`;
}

const EXTRA = new Map();
function inner(id, name, title = "") {
  const p = prefs(), list = ranked(id, name, EXTRA.get(id));
  const chips = STYLES.map(f => `<button class="lr-chip" type="button" data-lr-style="${f}" aria-pressed="${p.style === f}">${esc(t("learn.fp." + f))}</button>`).join("")
    + `<button class="lr-chip" type="button" data-lr-free aria-pressed="${p.free}">${esc(t("learn.freeOnly"))}</button>`;
  return `<div class="lr-h"><h3>${esc(title || t("learn.title"))}</h3></div>
    <div class="lr-style" role="group" aria-label="${esc(t("learn.styleQ"))}"><span class="lr-q">${esc(t("learn.styleQ"))}</span>${chips}</div>
    ${list.length ? item(list[0], true, p) : ""}
    ${list.length > 1 ? `<div class="lr-more">${esc(t("learn.other"))}</div>${list.slice(1, 4).map(r => item(r, false, p)).join("")}` : ""}`;
}

/** The "Ways to learn" block for a skill. `extra`: courses held elsewhere for it. */
export function learnBlock(id, name, extra = [], title = "") {
  if (extra.length) EXTRA.set(id, extra);
  if (!LIB) loadLearning();
  return `<section class="lr sec" data-lr-id="${esc(id)}" data-lr-name="${esc(name)}" data-lr-title="${esc(title)}">${inner(id, name, title)}</section>`;
}

function rerenderAll() {
  document.querySelectorAll(".lr[data-lr-id]").forEach(el => { el.innerHTML = inner(el.dataset.lrId, el.dataset.lrName, el.dataset.lrTitle); });
  icons();
}

// one listener for every block: the style chips, "free only", and counting what you open
document.addEventListener("click", e => {
  const el = e.target.closest?.(".lr"); if (!el) return;
  const p = prefs(), chip = e.target.closest("[data-lr-style]"), free = e.target.closest("[data-lr-free]"), link = e.target.closest("[data-lr-fmt]");
  if (chip) { p.style = p.style === chip.dataset.lrStyle ? null : chip.dataset.lrStyle; save(p); rerenderAll(); }
  else if (free) { p.free = !p.free; save(p); rerenderAll(); }
  else if (link) { p.opens[link.dataset.lrFmt] = (p.opens[link.dataset.lrFmt] || 0) + 1; save(p); setTimeout(rerenderAll, 400); }
});
