// Hacker News search via the Algolia API (free, no key). Used for discovery only: we keep stories that
// link to a trusted domain and read the linked article (via fetchApproved), never the HN comments.
import type { Services } from "../context.ts";
import { fetchApi } from "./fetch.ts";
import { trustedEntry } from "./policy.ts";
import { type Query, type SourceResult, type SourceItem, toIsoDate, inWindow, clean } from "./types.ts";

export function parseHn(body: string): { url: string | null; title: string; date: string | null; storyText: string }[] {
  const j = JSON.parse(body);
  return (j.hits || []).map((h: any) => ({
    url: h.url || null, title: clean(h.title), date: toIsoDate(h.created_at), storyText: clean(String(h.story_text || "").replace(/<[^>]+>/g, " ")),
  }));
}

export async function searchHn(svc: Services, q: Query, since: Date): Promise<SourceResult> {
  const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q.terms.join(" "))}&tags=story&hitsPerPage=50&numericFilters=${encodeURIComponent(`created_at_i>${Math.floor(since.getTime() / 1000)}`)}`;
  const r = await fetchApi(svc, url);
  if (!r.ok) return { items: [], error: `Hacker News: ${r.reason}` };
  let hits;
  try { hits = parseHn(r.body); } catch { return { items: [], error: "Hacker News returned invalid JSON" }; }
  const now = svc.now();
  const items: SourceItem[] = hits
    .filter(h => h.url && trustedEntry(h.url) && trustedEntry(h.url)!.kind !== "api" && inWindow(h.date, since, now))
    .map(h => ({ sourceKind: "hn", url: h.url!, title: h.title, date: h.date!, text: [h.title, h.storyText].filter(Boolean).join("\n"), needsPage: true, via: "Hacker News" }));
  return { items };
}
