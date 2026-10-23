// Source registry: query every selected source, keep dated items on trusted domains, and read
// pages on demand (hydrate) through fetchApproved.
import type { Services } from "../context.ts";
import { fetchApproved } from "./fetch.ts";
import { isApproved } from "./policy.ts";
import { searchGdelt } from "./gdelt.ts";
import { searchHn } from "./hn.ts";
import { searchArxiv } from "./arxiv.ts";
import { searchOpenAlex } from "./openalex.ts";
import { collectRss } from "./rss.ts";
import { searchWeb } from "./websearch.ts";
import { type SourceName, type SourceItem, type Query, SOURCE_NAMES, DAY_MS, inWindow } from "./types.ts";

export * from "./types.ts";
export { fetchApproved, isApproved };

const SEARCHERS: Record<Exclude<SourceName, "rss">, (svc: Services, q: Query, since: Date) => Promise<{ items: SourceItem[]; error?: string; skipped?: string }>> = {
  gdelt: searchGdelt, hn: searchHn, arxiv: searchArxiv, openalex: searchOpenAlex, websearch: searchWeb,
};

export interface SourceStatus { ok: boolean; items: number; queries: number; errors: string[]; skipped?: string; detail?: Record<string, string> }

/**
 * Run the queries against each selected source (sources run in parallel, queries within a source in order,
 * so each site's rate limit holds). Returns unique items, newest first, plus a status per source.
 */
export async function collectItems(svc: Services, opts: { sources?: SourceName[]; queries: Query[]; gdeltQueries?: Query[]; days?: number }) {
  const sources = (opts.sources?.length ? opts.sources : SOURCE_NAMES).filter(s => SOURCE_NAMES.includes(s));
  const since = new Date(svc.now().getTime() - (opts.days ?? 30) * DAY_MS);
  const status: Record<string, SourceStatus> = {};
  const all: SourceItem[][] = await Promise.all(sources.map(async name => {
    const st: SourceStatus = (status[name] = { ok: true, items: 0, queries: 0, errors: [] });
    const items: SourceItem[] = [];
    try {
      if (name === "rss") {
        const r = await collectRss(svc, since);
        items.push(...r.items); st.detail = r.perFeed; st.queries = 1;
        if (r.error) st.errors.push(r.error);
      } else {
        // GDELT allows one request every 5 s, so it gets fewer queries.
        const qs = name === "gdelt" && opts.gdeltQueries ? opts.gdeltQueries : opts.queries;
        for (const q of qs) {
          const r = await SEARCHERS[name](svc, q, since);
          st.queries++;
          items.push(...r.items);
          // Stop only if nothing came back: one web-search provider can be skipped (no quota) while another works.
          if (r.skipped && !r.items.length) { st.skipped = r.skipped; break; }
          if (r.error) st.errors.push(r.error);
        }
      }
    } catch (e: any) { st.errors.push(String(e?.message || e)); }
    st.items = items.length;
    st.ok = !st.skipped && (items.length > 0 || st.errors.length < Math.max(1, st.queries));
    return items;
  }));
  const seen = new Set<string>();
  const items = all.flat().filter(i => isApproved(i.url) && !seen.has(i.url) && (seen.add(i.url), true))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return { items, status, since };
}

/** Make sure an item has its page text (and a date). Returns null if the page can't be read under our policy. */
export async function hydrate(svc: Services, item: SourceItem, since: Date): Promise<(SourceItem & { fetchNote?: string }) | null> {
  if (!item.needsPage && item.date) return item;
  const page = await fetchApproved(svc, item.url);
  if (!page.ok) return item.needsPage ? null : item;
  const date = item.date || page.published || "";
  if (!inWindow(date || null, since, svc.now())) return null;
  // Feed summary + page text: the quote must appear in this text.
  // (For search hits we use only what the page itself says, not the search engine's or HN poster's title.)
  const text = item.sourceKind === "rss" ? `${item.text}\n${page.text}` : `${page.title}\n${page.text}`;
  return { ...item, date, title: item.title || page.title, text, needsPage: false };
}
