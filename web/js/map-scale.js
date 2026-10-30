// Map scale: a job star's distance from "You" is its time to job-ready. Log scale with fixed anchors (not stretched per
// map), so the same distance always means the same wait: 4 weeks or less sits at the inner edge, 2 years or more at the
// outer edge, and the step from 3 to 6 months looks as big as the step from 1 to 2 years.
export const NEAR = 260, FAR = 420, W_NEAR = 4, W_FAR = 104;

/** The time rings drawn on the map: weeks and the i18n key of their label. */
export const TIME_RINGS = [[13, "map.ring3m"], [26, "map.ring6m"], [52, "map.ring1y"], [104, "map.ring2y"]];

const clamp01 = v => Math.max(0, Math.min(1, v));

/** Radius for a time to job-ready in weeks (0 = ready now). */
export const weeksRadius = w => NEAR + (FAR - NEAR) * (w > W_NEAR ? clamp01(Math.log(w / W_NEAR) / Math.log(W_FAR / W_NEAR)) : 0);

/** Radius when the weeks are unknown: by match % (0..100) inside the same band, better matches nearer. */
export const matchRadius = m => NEAR + (FAR - NEAR) * (1 - clamp01((Number(m) || 0) / 100));

/** A job star's radius: by weeks when known, else by match. */
export const jobRadius = (weeks, match) => (weeks != null && Number.isFinite(weeks) && weeks >= 0 ? weeksRadius(weeks) : matchRadius(match));

/** A stable offset in [-amp, amp] for an id (FNV-1a), so a nudged star sits in the same place on every render. */
export function jitter(id, amp = 8) {
  let h = 2166136261;
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) / 4294967295 * 2 - 1) * amp;
}

/** Stars that land at nearly the same radius and angle get a small radial nudge each, so they don't sit on top of one
 *  another. stars = [{ id, r, a }] (a in degrees); returns { id: radius }. */
export function spreadRadii(stars, { dr = 6, da = 10, amp = 8 } = {}) {
  const out = {};
  stars.forEach(s => {
    const near = stars.some(o => o !== s && Math.abs(o.r - s.r) < dr && Math.abs(((o.a - s.a + 540) % 360) - 180) < da);
    out[s.id] = near ? s.r + jitter(s.id, amp) : s.r;
  });
  return out;
}
