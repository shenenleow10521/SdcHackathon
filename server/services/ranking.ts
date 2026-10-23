// Job ranking for the map, plus SDG-aware ranking.
// Base rank score = engine.rankScore = 0.6 x match + 0.4 x outlook (docs/ARCHITECTURE.md §7).
// SDG-aware: a job whose SDG list contains the SDG the user picked gets a fixed, visible bonus.
import { displayWeeks, PARAMS } from "../../shared/engine.js";
import type { FullGraph } from "../kb.ts";
import type { Profile } from "../repo.ts";
import { engineFor, type Engine, type Mode } from "./planning.ts";

/** Points added to the 0-100 rank score when a job serves the chosen SDG. */
export const SDG_BONUS = 10;
export const SDG_RULE = `Rank score = 0.6 × match + 0.4 × outlook; +${SDG_BONUS} points if the job's SDG list contains the SDG you chose.`;

const r1 = (x: number) => Math.round(x * 10) / 10;

/** The SDG reason for a job, if its sdg list contains the goal. */
export function sdgFit(graph: FullGraph, job: string, sdg: number | null | undefined): { goal: number; reason: string } | null {
  if (!sdg) return null;
  const hit = (graph.nodes[job]?.sdg || []).find((s: any) => Number(s[0]) === Number(sdg));
  return hit ? { goal: Number(hit[0]), reason: String(hit[1]) } : null;
}

export const scoreWithSdg = (E: Engine, graph: FullGraph, job: string, sdg?: number | null) =>
  E.rankScore(job) + (sdgFit(graph, job, sdg) ? SDG_BONUS : 0);

/** Job ids ordered best first (stable sort: ties keep catalogue order, like engine.sectorJobs). */
function order(jobs: string[], score: (j: string) => number) {
  return [...jobs].sort((a, b) => score(b) - score(a));
}

/** SDG-aware ranking with the trade-off against the top job without the SDG. */
export function rankBySdg(graph: FullGraph, profile: Profile, opts: { sdg: number; year: number; scenario: "moderate" | "fast"; mode?: Mode }) {
  const E = engineFor(graph, profile, opts.year, opts.scenario);
  const mode = opts.mode ?? "fastest";
  const hours = profile.hours || PARAMS.referenceHours;
  const jobs = E.allJobs();
  const info = Object.fromEntries(jobs.map(j => {
    const p = E.planFor(j, mode);
    return [j, { match: E.match(j), weeks: p.route ? displayWeeks(p.ready, hours) : null, base: E.rankScore(j), fit: sdgFit(graph, j, opts.sdg) }];
  }));
  const without = order(jobs, j => info[j].base);
  const withSdg = order(jobs, j => info[j].base + (info[j].fit ? SDG_BONUS : 0));
  const top = info[without[0]];
  return {
    sdg: opts.sdg, bonus: SDG_BONUS, rule: SDG_RULE, topWithoutSdg: without[0],
    jobs: withSdg.map((j, i) => ({
      job: j, title: graph.nodes[j].name, match: info[j].match, weeks: info[j].weeks,
      rank: i + 1, rankWithoutSdg: without.indexOf(j) + 1,
      score: r1(info[j].base + (info[j].fit ? SDG_BONUS : 0)), scoreWithoutSdg: r1(info[j].base),
      sdgFit: !!info[j].fit, sdgReason: info[j].fit?.reason ?? null,
      // Compared with the job that ranks first without the SDG: negative matchDelta = lower match, positive weeksDelta = longer.
      tradeoff: { matchDelta: info[j].match - top.match, weeksDelta: info[j].weeks == null || top.weeks == null ? null : info[j].weeks - top.weeks },
    })),
  };
}

/** Jobs for the map. sector 'best' = top 4 by rank (with the SDG bonus if one is chosen), always keeping a stay-and-adapt option. */
export function mapJobs(graph: FullGraph, profile: Profile, opts: { sector: string; sdg?: number | null; year: number; scenario: "moderate" | "fast"; mode: Mode }) {
  const E = engineFor(graph, profile, opts.year, opts.scenario);
  const hours = profile.hours || PARAMS.referenceHours;
  const score = (j: string) => scoreWithSdg(E, graph, j, opts.sdg);
  const all = order(E.allJobs(), score);
  let ids: string[];
  const sector = graph.sectors.find(s => s.id === opts.sector);
  if (!sector) throw Object.assign(new Error(`Unknown sector: ${opts.sector}`), { status: 400, code: "bad_request" });
  if (sector.jobs) ids = sector.jobs.filter(j => E.isJob(j));
  else {
    // Same rule as engine.sectorJobs("best"), with the SDG-adjusted score.
    ids = all.slice(0, 4);
    const stay = all.find(j => graph.nodes[j].stay);
    if (stay && !ids.includes(stay)) ids[Math.min(3, ids.length - 1)] = stay;
  }
  return {
    kbVersion: graph.kbVersion, futureScore: E.futureScore(), sector: sector.id, sdg: opts.sdg ?? null,
    jobs: ids.map(j => {
      const route = E.shortestPath(j, opts.mode);
      return {
        job: j, title: graph.nodes[j].name, match: E.match(j), rank: all.indexOf(j) + 1, rankScore: r1(score(j)),
        outlook: Math.round(E.outlook(j)), weeks: route ? displayWeeks(route.weeks, hours) : null, weeksRef: route ? route.weeks : null,
        risk: route ? route.risk : null, routeKey: route ? route.key : null,
        sdg: graph.nodes[j].sdg || [], sdgFit: !!sdgFit(graph, j, opts.sdg), stay: !!graph.nodes[j].stay,
      };
    }),
  };
}
