// GDELT DOC 2.0 news search (free, no key). Returns article metadata only; we keep articles on
// trusted domains and fetch their pages later (via fetchApproved) for the text.
// API: https://api.gdeltproject.org/api/v2/doc/doc?query=...&mode=artlist&format=json  (max 1 request / 5 s)
import type { Services } from "../context.ts";
import { fetchApi } from "./fetch.ts";
import { trustedEntry } from "./policy.ts";
import { type Query, type SourceResult, type SourceItem, toIsoDate, inWindow, clean } from "./types.ts";

export function gdeltQuery(q: Query): string {
  const terms = q.terms.map(t => (/\s/.test(t) ? `"${t.replace(/"/g, "")}"` : t));
  return `${terms.join(" ")} sourcelang:english`;
}

export function parseGdelt(body: string): { url: string; title: string; date: string | null; domain: string }[] {
  let j: any;
  try { j = JSON.parse(body); } catch { throw new Error(`GDELT returned non-JSON: ${body.slice(0, 120)}`); }
  return (j.articles || []).map((a: any) => ({ url: String(a.url || ""), title: clean(a.title), date: toIsoDate(a.seendate), domain: String(a.domain || "") }));
}

export async function searchGdelt(svc: Services, q: Query, since: Date): Promise<SourceResult> {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(gdeltQuery(q))}&mode=artlist&format=json&maxrecords=50&timespan=30d&sort=datedesc`;
  const r = await fetchApi(svc, url);
  if (!r.ok) return { items: [], error: `GDELT: ${r.reason}` };
  let arts;
  try { arts = parseGdelt(r.body); } catch (e: any) { return { items: [], error: e.message }; }
  const now = svc.now();
  const items: SourceItem[] = arts
    .filter(a => a.url && trustedEntry(a.url) && trustedEntry(a.url)!.kind !== "api" && inWindow(a.date, since, now))
    .map(a => ({ sourceKind: "gdelt", url: a.url, title: a.title, date: a.date!, text: a.title, needsPage: true, via: "GDELT" }));
  return { items };
}
