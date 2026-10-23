// Curated RSS/Atom feeds from trusted publishers (checked working on 23 Oct 2026).
// Feeds are fetched through fetchApproved (robots.txt obeyed). The feed's own summary is the text;
// short summaries are topped up from the article page (also via fetchApproved) before extraction.
import { XMLParser } from "fast-xml-parser";
import type { Services } from "../context.ts";
import { fetchApproved, decodeEntities, htmlToText } from "./fetch.ts";
import { isApproved } from "./policy.ts";
import { type SourceResult, type SourceItem, toIsoDate, inWindow, clean } from "./types.ts";

export const FEEDS = [
  { name: "OpenAI News", url: "https://openai.com/news/rss.xml" },
  { name: "Google AI blog", url: "https://blog.google/technology/ai/rss/" },
  { name: "Google DeepMind blog", url: "https://deepmind.google/blog/rss.xml" },
  { name: "Microsoft Research", url: "https://www.microsoft.com/en-us/research/feed/" },
  { name: "Microsoft Dynamics 365 blog (finance & operations)", url: "https://www.microsoft.com/en-us/dynamics-365/blog/feed/" },
  { name: "Official Microsoft Blog", url: "https://blogs.microsoft.com/feed/" },
  { name: "TechCrunch AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
  { name: "The Verge AI", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/technology-lab" },
  { name: "BBC Technology", url: "https://feeds.bbci.co.uk/news/technology/rss.xml" },
  { name: "Free Malaysia Today business", url: "https://www.freemalaysiatoday.com/category/business/feed/" },
  { name: "Malay Mail money", url: "https://www.malaymail.com/feed/rss/money" },
];

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", cdataPropName: "__cdata" });
const arr = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
const txt = (x: any): string => {
  if (x == null) return "";
  if (typeof x !== "object") return String(x);
  if (x.__cdata !== undefined) return arr(x.__cdata).join(" ");
  return String(x["#text"] ?? "");
};
const stripHtml = (s: string) => clean(decodeEntities(s.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")));
/** Feed HTML -> text that keeps paragraph breaks (so the scout can pick the relevant paragraphs). */
const bodyText = (s: string) => htmlToText(`<body>${s}</body>`).text;

/** Parse RSS 2.0 or Atom into items. */
export function parseFeed(body: string): { url: string; title: string; date: string | null; text: string }[] {
  const doc = xml.parse(body);
  if (doc?.rss?.channel) {
    return arr(doc.rss.channel.item).map((i: any) => ({
      url: clean(txt(i.link)), title: stripHtml(txt(i.title)), date: toIsoDate(txt(i.pubDate) || txt(i["dc:date"])),
      text: bodyText([txt(i.description), txt(i["content:encoded"])].join("\n")),
    }));
  }
  if (doc?.feed) {
    return arr(doc.feed.entry).map((e: any) => {
      const links = arr(e.link);
      const alt = links.find((l: any) => !l["@_rel"] || l["@_rel"] === "alternate") || links[0];
      return {
        url: clean(typeof alt === "object" ? alt?.["@_href"] : alt), title: stripHtml(txt(e.title)),
        date: toIsoDate(txt(e.published) || txt(e.updated)), text: bodyText([txt(e.summary), txt(e.content)].join("\n")),
      };
    });
  }
  return [];
}

/** Recent items from every feed. Feeds are not query-based: the scout matches items to skills itself. */
export async function collectRss(svc: Services, since: Date, feeds = FEEDS): Promise<SourceResult & { perFeed: Record<string, string> }> {
  const items: SourceItem[] = [], perFeed: Record<string, string> = {};
  const now = svc.now();
  let failures = 0;
  for (const f of feeds) {
    const r = await fetchApproved(svc, f.url, { raw: true });
    if (!r.ok) { perFeed[f.name] = r.reason; failures++; continue; }
    let parsed;
    try { parsed = parseFeed(r.text); } catch { perFeed[f.name] = "invalid feed XML"; failures++; continue; }
    const recent = parsed.filter(p => p.url && isApproved(p.url) && inWindow(p.date, since, now));
    perFeed[f.name] = `${recent.length} recent items`;
    for (const p of recent)
      items.push({ sourceKind: "rss", url: p.url, title: p.title, date: p.date!, text: [p.title, p.text].filter(Boolean).join("\n"), needsPage: p.text.length < 600, via: f.name });
  }
  return { items, perFeed, error: failures === feeds.length ? "RSS: every feed failed" : undefined };
}
