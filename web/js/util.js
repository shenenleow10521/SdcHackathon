// Small DOM and formatting helpers shared by every view.
import { t, getLang } from "./i18n.js";

export const $ = id => document.getElementById(id);
export const reduce = !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
export const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const icons = () => { try { globalThis.lucide?.createIcons?.(); } catch { /* icons are decoration */ } };

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Escape any value for use in HTML text or a quoted attribute. Everything from the API goes through this. */
export const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ESC[c]);

/** Only http(s) links are ever rendered. */
export function safeUrl(u) {
  if (!u || typeof u !== "string") return null;
  try { const x = new URL(u, location.origin); return x.protocol === "http:" || x.protocol === "https:" ? x.href : null; } catch { return null; }
}
// Site icons for the external sources we link to, saved once from each site's own favicon (web/assets/logos/README.md).
// They only show where a link goes. Matched by domain; other links get no icon.
const LOGOS = { "myfuturejobs.gov.my": "myfuturejobs", "jobstreet.com": "jobstreet", "coursera.org": "coursera", "microsoft.com": "microsoft",
  "ghgprotocol.org": "ghgprotocol", "ifrs.org": "ifrs", "bsigroup.com": "bsi", "wanfahprosper.com": "wanfah", "dosm.gov.my": "opendosm",
  "esco.ec.europa.eu": "esco", "ilo.org": "ilo", "onetcenter.org": "onet" };
export function logoOf(url) {
  const h = hostOf(url);
  const k = Object.keys(LOGOS).find(d => h === d || h.endsWith("." + d));
  return k ? `<img class="logo-ic" src="/assets/logos/${LOGOS[k]}.png" alt="" width="16" height="16" loading="lazy">` : "";
}
export function extLink(url, text, cls = "") {
  const u = safeUrl(url);
  if (!u) return esc(text);
  return `<a class="ext ${cls}" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${logoOf(u)}${esc(text || hostOf(u))}<i data-lucide="external-link"></i></a>`;
}
export function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } }

export const sign = d => (d > 0 ? "+" : d < 0 ? "−" : "") + Math.abs(Math.round(d)) + "%";
export const pct = x => Math.round(x * 100) + "%";
export const rm = n => "RM " + Math.round(Number(n) || 0).toLocaleString("en-MY");

export function fmtDate(d) {
  if (!d) return "";
  const x = new Date(d);
  if (isNaN(x)) return String(d);
  return x.toLocaleDateString(getLang() === "ms" ? "ms-MY" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
}
export function ago(d) {
  if (!d) return t("time.never");
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (!isFinite(s)) return String(d);
  if (s < 90) return t("time.justNow");
  if (s < 3600) return t("time.minutes", { n: Math.round(s / 60) });
  if (s < 86400) return t("time.hours", { n: Math.round(s / 3600) });
  return t("time.days", { n: Math.round(s / 86400) });
}

export const badge = (cls, text, icon) => `<span class="badge ${cls}">${icon ? `<i data-lucide="${icon}"></i>` : ""}${esc(text)}</span>`;
export const TONE = { mute: "b-mute", crit: "b-crit", warn: "b-warn", good: "b-good", info: "b-info", violet: "b-violet" };

/** Label where a value comes from: Sample / Live source / Replayed / employer-entered … */
export function srcBadge(source, { replayed = false } = {}) {
  if (replayed) return badge("b-violet", t("src.replayed"), "history");
  const s = String(source || "sample").toLowerCase();
  if (s === "sample" || s === "seed") return badge("b-warn", t("src.sample"));
  if (s === "esco") return badge("b-info", "ESCO", "database");
  if (s === "onet" || s === "o*net") return badge("b-info", "O*NET", "database");
  if (s === "ilo") return badge("b-info", "ILO", "database");
  if (s === "employer_form") return badge("b-mute", t("src.employerForm"));
  if (s === "careers_page") return badge("b-info", t("src.careersPage"), "globe");
  if (s === "committee" || s === "emerging") return badge("b-violet", t("src.committee"), "sparkles");
  return badge("b-good", t("src.live"), "radio");
}

export const loadingBox = text => `<div class="loading" role="status"><span class="spin"></span>${esc(text || t("state.loading"))}</div>`;

/** Inline error state. retry = a data-retry key the caller binds. */
export function errorBox(err, retry) {
  if (err?.notAvailable) return `<div class="state-box na">${badge("b-mute", t("state.notAvailableBadge"), "clock")}<span>${esc(t("state.notAvailable"))}</span></div>`;
  if (err?.code === "sign_in_required") return `<div class="state-box">${badge("b-warn", t("state.signIn"), "lock")}<span>${esc(t("state.signInHint"))}</span></div>`;
  if (err?.needsAuth) return `<div class="state-box">${badge("b-warn", t("state.needsAdmin"), "lock")}<span>${esc(t("state.needsAdminHint"))}</span></div>`;
  const msg = err?.offline ? t("state.offline") : (err?.message || t("state.failed"));
  return `<div class="state-box err" role="alert"><i data-lucide="cloud-off"></i><span>${esc(msg)}</span>${retry ? `<button class="ghost sm" type="button" data-retry="${esc(retry)}"><i data-lucide="refresh-cw"></i>${esc(t("state.retry"))}</button>` : ""}</div>`;
}
export const emptyBox = text => `<div class="empty">${esc(text)}</div>`;

/** Bind [data-retry] buttons under root to handlers by key. */
export function bindRetry(root, handlers) {
  root.querySelectorAll("[data-retry]").forEach(b => b.addEventListener("click", () => handlers[b.dataset.retry]?.()));
}

// ---------- persistent prefs (never required to work) ----------
export const store = {
  get(k, d = null) { try { const v = localStorage.getItem("halatuju." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("halatuju." + k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};

// ---------- toast ----------
let toastTimer = null;
/**
 * @param {{ title: string, detail?: string, detailHtml?: string, badgeHtml?: string, ms?: number }} o
 */
export function toast(o) {
  const el = $("toast");
  if (!el) return;
  el.innerHTML = `<div class="tt">${o.badgeHtml || ""}<span>${esc(o.title)}</span>
      <button class="icon-btn sm toast-x" type="button" aria-label="${esc(t("common.close"))}"><i data-lucide="x"></i></button></div>
    ${o.detailHtml ? `<div class="td">${o.detailHtml}</div>` : o.detail ? `<div class="td">${esc(o.detail)}</div>` : ""}`;
  el.classList.add("show");
  icons();
  el.querySelector(".toast-x").addEventListener("click", () => el.classList.remove("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), o.ms || 5600);
}

/** Debounce for typing and sliders. */
export function debounce(fn, ms) { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; }

/** Run fn on a GSAP-friendly entrance, skipped with reduced motion. */
export function enter(els, opts = {}) {
  if (reduce || !globalThis.gsap || !els || !els.length) return;
  globalThis.gsap.from(els, { y: 6, opacity: 0, duration: 0.28, stagger: 0.025, ease: "power3.out", clearProps: "all", ...opts });
}
