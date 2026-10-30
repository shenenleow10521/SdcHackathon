// Interface language. t(key, vars) looks up web/i18n/<lang>.json, falls back to English, then to the key itself.
// Data content (job and skill names, sources) stays in its original language.

const KEY = "halatuju.lang";
let lang = "en";
let dict = {};
let en = {};
const listeners = new Set();

export const LANGS = { en: "English", ms: "Bahasa Melayu" };

function stored() {
  try { const v = globalThis.localStorage?.getItem(KEY); return v === "ms" || v === "en" ? v : null; } catch { return null; }
}

async function fetchDict(l) {
  try {
    const r = await fetch(`/i18n/${l}.json`, { headers: { Accept: "application/json" } });
    if (!r.ok) return {};
    return await r.json();
  } catch { return {}; }
}

/** Load English (always, as the fallback) and the chosen language. */
export async function initI18n() {
  en = await fetchDict("en");
  const want = stored() || "en";
  await setLang(want, { silent: true });
}

export async function setLang(l, { silent = false } = {}) {
  lang = l === "ms" ? "ms" : "en";
  dict = lang === "en" ? en : await fetchDict(lang);
  try { globalThis.localStorage?.setItem(KEY, lang); } catch { /* storage blocked */ }
  if (globalThis.document) document.documentElement.lang = lang === "ms" ? "ms" : "en";
  if (!silent) listeners.forEach(fn => { try { fn(lang); } catch (e) { console.error(e); } });
}

export const getLang = () => lang;
export const onLangChange = fn => listeners.add(fn);

/** Plain-text translation with {var} substitution. Callers escape it before putting it in HTML when vars hold data. */
export function t(key, vars) {
  let s = dict[key] ?? en[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m))
    .replace(/(^|[^\d.,])1 (week|hour)s\b/g, "$11 $2"); // English: "1 week", not "1 weeks"
  return s;
}

/** Translation if the key exists, else the fallback (for open-ended values such as run kinds). */
export function tOr(key, fallback, vars) {
  return dict[key] !== undefined || en[key] !== undefined ? t(key, vars) : String(fallback ?? "");
}

/** Translate every [data-i18n], [data-i18n-aria], [data-i18n-title] and [data-i18n-ph] element under root. */
export function applyStatic(root = document) {
  root.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll("[data-i18n-aria]").forEach(el => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
  root.querySelectorAll("[data-i18n-title]").forEach(el => el.setAttribute("title", t(el.dataset.i18nTitle)));
  root.querySelectorAll("[data-i18n-ph]").forEach(el => el.setAttribute("placeholder", t(el.dataset.i18nPh)));
}
