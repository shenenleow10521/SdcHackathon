// The 3D map's distance scale: a job star's radius is its time to job-ready (log scale, fixed anchors).
import { describe, it, expect } from "vitest";
// @ts-ignore — plain ES module shared with the browser
import { NEAR, FAR, TIME_RINGS, weeksRadius, matchRadius, jobRadius, jitter, spreadRadii } from "../web/js/map-scale.js";

describe("map scale", () => {
  it("pins the anchors: 4 weeks at the inner edge, 104 weeks at the outer edge", () => {
    expect(NEAR).toBe(260); expect(FAR).toBe(420);
    expect(weeksRadius(4)).toBeCloseTo(260, 6);
    expect(weeksRadius(104)).toBeCloseTo(420, 6);
    // the midpoint of the log scale: sqrt(4 * 104) weeks
    expect(weeksRadius(Math.sqrt(4 * 104))).toBeCloseTo(340, 6);
  });

  it("clamps outside the anchors", () => {
    expect(weeksRadius(0)).toBe(260);
    expect(weeksRadius(1)).toBe(260);
    expect(weeksRadius(300)).toBe(420);
  });

  it("is monotonic in weeks", () => {
    let prev = -Infinity;
    for (let w = 0; w <= 150; w++) { const r = weeksRadius(w); expect(r).toBeGreaterThanOrEqual(prev); prev = r; }
    expect(weeksRadius(13)).toBeLessThan(weeksRadius(26));
    expect(weeksRadius(52)).toBeLessThan(weeksRadius(104));
  });

  it("falls back to match inside the same band when weeks are unknown", () => {
    expect(jobRadius(null, 100)).toBe(260);
    expect(jobRadius(undefined, 0)).toBe(420);
    expect(jobRadius(NaN, 50)).toBe(340);
    expect(matchRadius(80)).toBeLessThan(matchRadius(20));
    expect(jobRadius(26, 5)).toBeCloseTo(weeksRadius(26), 6); // known weeks win over match
    for (const m of [-10, 0, 37, 100, 140, undefined]) { const r = matchRadius(m); expect(r).toBeGreaterThanOrEqual(260); expect(r).toBeLessThanOrEqual(420); }
  });

  it("has one time ring per anchor label, inside the band", () => {
    expect(TIME_RINGS.map((x: any[]) => x[0])).toEqual([13, 26, 52, 104]);
    TIME_RINGS.forEach((x: any[]) => { const r = weeksRadius(x[0]); expect(r).toBeGreaterThan(260); expect(r).toBeLessThanOrEqual(420); });
  });

  it("nudges only stars that overlap, by a stable amount within ±8", () => {
    expect(jitter("esco:abc")).toBe(jitter("esco:abc"));
    for (const id of ["a", "b", "esco:1", "job-nurse"]) expect(Math.abs(jitter(id))).toBeLessThanOrEqual(8);
    const out: Record<string, number> = spreadRadii([{ id: "a", r: 300, a: 10 }, { id: "b", r: 302, a: 14 }, { id: "c", r: 300, a: 120 }]);
    expect(out.c).toBe(300);
    expect(out.a).not.toBe(300);
    expect(out.a).not.toBe(out.b);
    expect(Math.abs(out.a - 300)).toBeLessThanOrEqual(8);
    // angles wrap round the circle
    const w: Record<string, number> = spreadRadii([{ id: "x", r: 300, a: 358 }, { id: "y", r: 300, a: 2 }]);
    expect(w.x).not.toBe(300);
  });
});
