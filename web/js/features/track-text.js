// My goal: the pure maths and wording behind the steps and the tracking (no DOM, no app state), so it can be unit-tested.
// Every number here is computed from the plan, the hours a week and the server's pace figures; nothing is estimated by AI.
// Functions that produce words take the translation function `t` (web/js/i18n.js) as a parameter.

const DAY = 86_400_000;
const LOCALE = { en: "en-GB", ms: "ms-MY" };
export const isoDay = d => new Date(d).toISOString().slice(0, 10);
const at = s => Date.parse(String(s).slice(0, 10) + "T00:00:00Z");
const addDays = (s, n) => isoDay(at(s) + n * DAY);

/** The Monday (UTC) of the week a day falls in, as the server stores check-ins. */
export function mondayOf(day) {
  const d = new Date(at(day));
  return isoDay(at(day) - ((d.getUTCDay() + 6) % 7) * DAY);
}

/**
 * Planned dates for the steps still to do: one after another from `today`, at `hoursPerWeek`.
 * A step of h hours takes ceil(h / hoursPerWeek × 7) days (at least 1). Done steps, and steps without hours, get null.
 * @returns {({ start: string, end: string, days: number } | null)[]} in the order of `steps`
 */
export function scheduleSteps(steps, hoursPerWeek, today) {
  const hpw = Math.max(1, Number(hoursPerWeek) || 6);
  let next = String(today).slice(0, 10);
  return steps.map(s => {
    if (s.done || s.hours == null || !(s.hours >= 0)) return null;
    const days = Math.max(1, Math.ceil((s.hours / hpw) * 7 - 1e-9));
    const out = { start: next, end: addDays(next, days - 1), days };
    next = addDays(next, days);
    return out;
  });
}

/** "5 Oct", with the year when it isn't `thisYear`. */
export function dayMonth(day, lang = "en", thisYear = null) {
  const d = new Date(at(day));
  const year = thisYear != null && d.getUTCFullYear() !== thisYear;
  return d.toLocaleDateString(LOCALE[lang] || "en-GB", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
}

/** "4 to 15 Nov", "28 Oct to 3 Nov", "28 Dec 2026 to 5 Jan 2027" (years only when the range leaves `thisYear`). */
export function dateRange(start, end, t, lang = "en", thisYear = null) {
  if (start === end) return dayMonth(start, lang, thisYear);
  const a = new Date(at(start)), b = new Date(at(end));
  const years = a.getUTCFullYear() !== b.getUTCFullYear() || (thisYear != null && b.getUTCFullYear() !== thisYear);
  const fmt = s => new Date(at(s)).toLocaleDateString(LOCALE[lang] || "en-GB", { day: "numeric", month: "short", ...(years ? { year: "numeric" } : {}), timeZone: "UTC" });
  const sameMonth = !years && a.getUTCMonth() === b.getUTCMonth();
  return t("track.dates", { from: sameMonth ? String(a.getUTCDate()) : fmt(start), to: fmt(end) });
}

/** The toast after a tick, from the server's change.before / change.after: "Match 48% → 56%. 8 weeks left." */
export function changeText(change, t) {
  const b = change?.before || {}, a = change?.after || {};
  const m = b.match == null || a.match == null ? ""
    : Math.round(b.match) === Math.round(a.match) ? t("track.toast.matchSame", { m: Math.round(a.match) })
    : t("track.toast.match", { a: Math.round(b.match), b: Math.round(a.match) });
  const w = a.weeks == null ? "" : a.weeks <= 0 ? t("track.toast.ready") : t(a.weeks === 1 ? "track.toast.week1" : "track.toast.weeks", { w: a.weeks });
  return [m, w].filter(Boolean).join(" ");
}

/**
 * The server's pace in plain words, with its numbers.
 * on_track → "On track", "12 of 13 hours studied since 5 Oct"; behind → "Behind by 9 hours", ...; ahead → "Ahead by 4 hours", ...
 * Hours are rounded to whole hours for reading. Set today: no "of 0 hours".
 * @returns {{ status: string, head: string, line: string } | null}
 */
export function paceText(pace, t, lang = "en", thisYear = null) {
  if (!pace || !pace.status) return null;
  const gap = Math.round(Math.abs(pace.differenceHours || 0));
  const head = pace.status === "behind" ? t(gap === 1 ? "track.pace.behind1" : "track.pace.behind", { h: gap })
    : pace.status === "ahead" ? t(gap === 1 ? "track.pace.ahead1" : "track.pace.ahead", { h: gap })
    : t("track.pace.onTrack");
  const line = !pace.daysElapsed && !pace.studiedHours ? t("track.pace.today")
    : t("track.pace.studied", { a: Math.round(pace.studiedHours || 0), b: Math.round(pace.expectedHours || 0), date: dayMonth(pace.setAt, lang, thisYear) });
  return { status: pace.status, head, line };
}

/** Hours of a step to plan this week: the step's hours, at most your hours a week. */
export const weekHours = (stepHours, hoursPerWeek) => Math.max(1, Math.min(Math.round(Number(hoursPerWeek) || 6), Math.ceil(Number(stepHours) || 0)));

/** A track's progress line: "1 of 3 skills done, about 4 weeks left" / "All 3 skills done". */
export function progressLine(done, total, weeksLeft, t) {
  if (!total) return t("track.progressNone");
  if (done >= total) return t(total === 1 ? "track.progressAll1" : "track.progressAll", { n: total });
  return t(weeksLeft === 1 ? "track.progress1" : "track.progress", { done, total, w: Math.max(1, weeksLeft || 1) });
}

/** Is this a link a credential may use (https only, like the server)? */
export function okCredentialUrl(u) {
  try { const x = new URL(String(u).trim()); return x.protocol === "https:" && !!x.hostname && String(u).length <= 500; } catch { return false; }
}
