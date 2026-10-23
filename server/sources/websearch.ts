// Optional web search, used only when configured. Results count only if the result URL is on the trust list;
// the page text is then read through fetchApproved like any other page.
//   - Gemini Google Search grounding (GEMINI_API_KEY; free keys usually have zero quota -> HTTP 429, then disabled for 6 h)
//   - Brave Search API (BRAVE_API_KEY)
//   - Tavily (TAVILY_API_KEY)
import type { Services } from "../context.ts";
import { fetchApi } from "./fetch.ts";
import { trustedEntry, TRUSTED } from "./policy.ts";
import { geminiKeysFromEnv } from "../lib/llm.ts";
import { type Query, type SourceResult, type SourceItem, toIsoDate, inWindow, clean } from "./types.ts";

let groundingDisabledUntil = 0;

export function websearchProviders(env = process.env) {
  return {
    brave: !!env.BRAVE_API_KEY,
    tavily: !!env.TAVILY_API_KEY,
    gemini: geminiKeysFromEnv(env).length > 0 && !/^(0|off|false|no)$/i.test(env.GEMINI_GROUNDING || "on") && Date.now() > groundingDisabledUntil,
  };
}

const keep = (url: string) => { const t = trustedEntry(url); return !!t && t.kind !== "api"; };
const TAVILY_DOMAINS = TRUSTED.filter(t => t.kind !== "api").map(t => t.domain);

async function brave(svc: Services, q: Query, since: Date): Promise<SourceResult> {
  const r = await fetchApi(svc, `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q.terms.join(" "))}&freshness=pm&count=20`,
    { headers: { Accept: "application/json", "X-Subscription-Token": process.env.BRAVE_API_KEY! } });
  if (!r.ok) return { items: [], error: `Brave: ${r.reason}` };
  const j = JSON.parse(r.body);
  const now = svc.now();
  const items: SourceItem[] = [];
  for (const x of j?.web?.results || []) {
    const date = toIsoDate(x.page_age) || null;
    if (keep(x.url) && inWindow(date, since, now))
      items.push({ sourceKind: "websearch", url: x.url, title: clean(x.title), date: date!, text: clean(String(x.description || "").replace(/<[^>]+>/g, "")), needsPage: true, via: "Brave Search" });
  }
  return { items };
}

async function tavily(svc: Services, q: Query, since: Date): Promise<SourceResult> {
  const r = await fetchApi(svc, "https://api.tavily.com/search", {
    method: "POST", headers: { "Content-Type": "application/json" },
    // Search only trusted domains (otherwise nearly every hit is dropped by keep()). Tavily counts LinkedIn
    // as part of microsoft.com, so it is excluded explicitly.
    body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query: q.terms.join(" "), topic: "news", days: 30, max_results: 10,
      include_domains: TAVILY_DOMAINS, exclude_domains: ["linkedin.com"] }),
  });
  if (!r.ok) return { items: [], error: `Tavily: ${r.reason}` };
  const j = JSON.parse(r.body);
  const now = svc.now();
  const items: SourceItem[] = [];
  for (const x of j?.results || []) {
    const date = toIsoDate(x.published_date);
    if (keep(x.url) && inWindow(date, since, now))
      items.push({ sourceKind: "websearch", url: x.url, title: clean(x.title), date: date!, text: clean(x.content), needsPage: true, via: "Tavily" });
  }
  return { items };
}

/** Gemini with Google Search grounding: we use only the cited URLs (resolved from Google's redirect links). */
async function gemini(svc: Services, q: Query): Promise<SourceResult> {
  const key = geminiKeysFromEnv()[0];
  const r = await fetchApi(svc, `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || "gemini-3.5-flash-lite"}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: `Find news from the last 30 days about: ${q.terms.join(" ")}. List the articles.` }] }], tools: [{ google_search: {} }] }),
  });
  if (!r.ok) {
    if (r.status === 429) { groundingDisabledUntil = Date.now() + 6 * 3600_000; return { items: [], skipped: "Gemini grounding: no quota (HTTP 429), disabled for 6 hours" }; }
    return { items: [], error: `Gemini grounding: ${r.reason}` };
  }
  const j = JSON.parse(r.body);
  const chunks = j?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const items: SourceItem[] = [];
  for (const c of chunks.slice(0, 10)) {
    let url: string = c?.web?.uri || "";
    // Grounding links are Google redirect URLs; read only the Location header to learn the real article URL.
    if (/vertexaisearch\.cloud\.google\.com/.test(url)) {
      try { const h = await svc.fetch(url, { method: "HEAD", redirect: "manual" }); url = h.headers.get("location") || ""; } catch { url = ""; }
    }
    // Grounding gives no publication date: date stays empty and is taken from the page's own published date
    // when we fetch it (items without a published date are dropped).
    if (url && keep(url)) items.push({ sourceKind: "websearch", url, title: clean(c?.web?.title || url), date: "", text: "", needsPage: true, via: "Gemini grounding" });
  }
  return { items };
}

export async function searchWeb(svc: Services, q: Query, since: Date): Promise<SourceResult> {
  const p = websearchProviders();
  if (!p.brave && !p.tavily && !p.gemini) return { items: [], skipped: "No web search provider configured (BRAVE_API_KEY / TAVILY_API_KEY), or Gemini grounding has no quota" };
  const out: SourceItem[] = [], errors: string[] = [], skipped: string[] = [];
  let ran = 0;
  for (const [on, fn] of [[p.brave, () => brave(svc, q, since)], [p.tavily, () => tavily(svc, q, since)], [p.gemini, () => gemini(svc, q)]] as const) {
    if (!on) continue;
    try { const r = await fn(); out.push(...r.items); if (r.error) errors.push(r.error); if (r.skipped) skipped.push(r.skipped); else ran++; }
    catch (e: any) { ran++; errors.push(String(e?.message || e)); }
  }
  // "Skipped" stops the remaining queries, so report it only if no provider ran (e.g. Gemini has no quota but Tavily works).
  return { items: out, error: errors.join("; ") || undefined, skipped: ran ? undefined : skipped.join("; ") || undefined };
}
