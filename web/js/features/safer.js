// Shared wording for the "Safer route available" card (My goal tab and ESCO job rows) and the AI-era skill badge.
// The reason is plain and factual: how much of a skipped skill's work AI can do, or (only when an approved market change
// is behind it) that a recent change shows AI now does it. Never "AI is taking over".
import { t } from "../i18n.js";
import { esc } from "../util.js";

const pctOf = e => (typeof e === "number" && Number.isFinite(e) ? Math.round(e > 1 ? e : e * 100) : null);

/** One line: "Skips X, Y: AI can do 62% of this work." from saferAlternative.avoids [{ id, name?, exposure?, reason? }]. */
export function saferLine(avoids, nameOf) {
  const named = avoids.filter(a => a.reason !== "other"), shown = (named.length ? named : avoids).slice(0, 2);
  const skills = shown.map(a => a.name || nameOf(a.id)).filter(Boolean).join(", ");
  if (!skills) return t("safer.plain");
  if (shown.some(a => a.reason === "signal")) return t("safer.skipsSignal", { skills });
  const pcts = shown.map(a => (typeof a.aiSharePct === "number" ? a.aiSharePct : pctOf(a.exposure))).filter(p => p !== null);
  if (pcts.length) return t(shown.length > 1 ? "safer.skipsExpUpTo" : "safer.skipsExp", { skills, pct: Math.max(...pcts) });
  return t("safer.skips", { skills });
}

/** The time difference in weeks: "+3 wk", "2 wk less", "Same time". */
export const saferWeeks = d => (d > 0 ? t("path.saferMore", { w: d }) : d < 0 ? t("path.saferLess", { w: -d }) : t("path.saferSame"));

/** "AI-era skill that grows with AI": for skills newer than ESCO, which have no exposure score. */
export const aiEraBadge = () => `<span class="aiera-badge"><i data-lucide="trending-up" aria-hidden="true"></i>${esc(t("aiEra.badge"))}</span>`;
