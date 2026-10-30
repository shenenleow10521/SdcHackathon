// Hand-picked learning resources (videos, articles, books, practice) beside the catalogue's courses.
// db/seed/learning.json: every URL was opened and checked by hand; YouTube videos verified with YouTube's oEmbed.
// Keys are catalogue skill ids ("prompt") or AI-era skill ids ("ai-literacy"). The client ranks them for each person
// (web/js/features/learn.js); the server only serves the list.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "db", "seed", "learning.json");
const FORMATS = new Set(["video", "article", "book", "practice"]);

export interface Resource { format: string; title: string; provider?: string; by?: string; url: string; minutes?: number | null; cost?: "free" | "paid"; lang?: string; year?: number }

let cache: { checkedAt: string | null; resources: Record<string, Resource[]> } | undefined;

export function loadLearning() {
  if (cache) return cache;
  if (!existsSync(FILE)) return (cache = { checkedAt: null, resources: {} });
  const f = JSON.parse(readFileSync(FILE, "utf8"));
  const resources: Record<string, Resource[]> = {};
  for (const [k, list] of Object.entries<any[]>(f.resources || {})) {
    // only well-formed http(s) links in a known format reach the app
    resources[k] = (list || []).filter(r => r && FORMATS.has(r.format) && typeof r.title === "string" && /^https?:\/\//.test(r.url || ""))
      .map(({ format, title, provider, by, url, minutes, cost, lang, year }) => ({ format, title, provider, by, url, minutes: minutes ?? null, cost: cost === "paid" ? "paid" : "free", lang: lang || "en", year }));
  }
  return (cache = { checkedAt: f.checkedAt || null, resources });
}

/** For tests: read the file again. */
export function resetLearning() { cache = undefined; }
