// OpenAlex works search (free; optional OPENALEX_API_KEY / OPENALEX_MAILTO). Abstracts come as an
// inverted index (word -> positions), which we turn back into text. We cite the openalex.org work page.
import type { Services } from "../context.ts";
import { fetchApi } from "./fetch.ts";
import { type Query, type SourceResult, type SourceItem, toIsoDate, inWindow, clean, isoDate } from "./types.ts";

export function abstractFromIndex(idx: Record<string, number[]> | null | undefined): string {
  if (!idx) return "";
  const words: string[] = [];
  for (const [w, positions] of Object.entries(idx)) for (const p of positions) words[p] = w;
  return words.filter(w => w !== undefined).join(" ");
}

export function parseOpenAlex(body: string): { url: string; title: string; date: string | null; abstract: string; landing: string | null }[] {
  const j = JSON.parse(body);
  return (j.results || []).map((w: any) => ({
    url: String(w.id || ""), title: clean(w.display_name || w.title), date: toIsoDate(w.publication_date),
    abstract: clean(abstractFromIndex(w.abstract_inverted_index)), landing: w.primary_location?.landing_page_url || w.doi || null,
  }));
}

/** OpenAlex boolean search: every term (phrases quoted) AND an AI term. */
export function openAlexQuery(q: Query): string {
  const terms = q.terms.filter(t => !/^(ai|artificial intelligence)$/i.test(t)).map(t => (/\s/.test(t) ? `"${t.replace(/"/g, "")}"` : t));
  return [...terms, `("artificial intelligence" OR "language model" OR "generative AI" OR agent)`].join(" AND ");
}

export async function searchOpenAlex(svc: Services, q: Query, since: Date): Promise<SourceResult> {
  const params = new URLSearchParams({
    search: openAlexQuery(q),
    filter: `from_publication_date:${isoDate(since)},to_publication_date:${isoDate(svc.now())}`,
    sort: "publication_date:desc", "per-page": "15",
  });
  if (process.env.OPENALEX_MAILTO) params.set("mailto", process.env.OPENALEX_MAILTO);
  if (process.env.OPENALEX_API_KEY) params.set("api_key", process.env.OPENALEX_API_KEY);
  const r = await fetchApi(svc, `https://api.openalex.org/works?${params}`);
  if (!r.ok) return { items: [], error: `OpenAlex: ${r.reason}` };
  let works;
  try { works = parseOpenAlex(r.body); } catch { return { items: [], error: "OpenAlex returned invalid JSON" }; }
  const now = svc.now();
  const items: SourceItem[] = works
    .filter(w => /^https:\/\/openalex\.org\/W\d+$/.test(w.url) && w.abstract.length > 80 && inWindow(w.date, since, now))
    .map(w => ({ sourceKind: "openalex", url: w.url, title: w.title, date: w.date!, text: `${w.title}\n${w.abstract}`, via: w.landing ? `OpenAlex (${w.landing})` : "OpenAlex" }));
  return { items };
}
