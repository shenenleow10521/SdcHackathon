// Shared shapes for the source clients.

export type SourceName = "gdelt" | "hn" | "arxiv" | "openalex" | "rss" | "websearch";
export const SOURCE_NAMES: SourceName[] = ["gdelt", "hn", "arxiv", "openalex", "rss", "websearch"];

/** One dated item from a source. `text` is DATA (never instructions). */
export interface SourceItem {
  sourceKind: SourceName;
  url: string;            // the trusted URL we cite
  title: string;
  date: string;           // YYYY-MM-DD, within the last 30 days
  text: string;           // full text if we have it, else a snippet (needsPage = true)
  needsPage?: boolean;    // fetch the page (via fetchApproved) before extraction
  via?: string;           // discovery detail, e.g. "GDELT" or a feed name
}

/** A search query: all terms should appear (each term may be a phrase). */
export interface Query { terms: string[]; skillId?: string }

export interface SourceResult { items: SourceItem[]; error?: string; skipped?: string }

export const DAY_MS = 86_400_000;
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Parse a date string from a source; null if invalid. */
export function toIsoDate(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  let s = String(v).trim();
  // GDELT: 20261020T120000Z
  const g = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (g) s = `${g[1]}-${g[2]}-${g[3]}T${g[4]}:${g[5]}:${g[6]}Z`;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

/** Keep only items dated within the window [since, now + 1 day]. */
export function inWindow(date: string | null, since: Date, now: Date): date is string {
  if (!date) return false;
  const t = Date.parse(date + "T00:00:00Z");
  return t >= Date.parse(isoDate(since) + "T00:00:00Z") && t <= now.getTime() + DAY_MS;
}

export const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
