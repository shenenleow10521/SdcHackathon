// The only way our agents read the web.
//   fetchApproved(svc, url)  - a page or feed on an approved domain: robots.txt obeyed (also after redirects),
//                              identified User-Agent, per-host rate limit, timeout, size cap, HTML -> plain text,
//                              in-memory cache. Login/paywall pages are skipped, never worked around.
//   fetchApi(svc, url)       - a documented public API (see API_TERMS in policy.ts), called under its own terms.
// We persist only a fetch log (url, status, time, sha256, <= 300-char excerpt), never full pages.
import { createHash } from "node:crypto";
import type { Services } from "../context.ts";
import { isApproved, isLinkOnly, hostOf, apiTerms, trustedEntry, type SourceKind } from "./policy.ts";

export { isApproved };

export const USER_AGENT = "HalaTujuBot/0.1 (+hackathon project; contact via repo)";
const UA_TOKEN = "halatujubot";

/** Tunables. Tests set minIntervalMs to 0 so they run fast. */
export const fetchSettings = {
  minIntervalMs: Number(process.env.FETCH_MIN_INTERVAL_MS ?? (process.env.NODE_ENV === "test" ? 0 : 1500)),
  timeoutMs: 15000,
  maxBytes: 3_000_000,
  maxTextChars: 100_000,
  cacheTtlMs: 6 * 3600_000,
  failTtlMs: 10 * 60_000,
  robotsTtlMs: 12 * 3600_000,
  maxRedirects: 3,
  maxCrawlDelayMs: 20_000,
};

export type FetchResult =
  | { ok: true; url: string; finalUrl: string; title: string; text: string; fetchedAt: string; contentType: string; status: number; published: string | null }
  | { ok: false; reason: string; status?: number };

export type ApiResult = { ok: true; status: number; body: string; contentType: string } | { ok: false; reason: string; status?: number };

// Per-fetch-function state (tests inject a new fetch each time, so their caches never mix).
interface State {
  cache: Map<string, { exp: number; res: FetchResult }>;
  robots: Map<string, { exp: number; rules: Robots }>;
  nextAt: Map<string, number>;
}
const states = new WeakMap<object, State>();
function stateOf(svc: Services): State {
  let s = states.get(svc.fetch);
  if (!s) { s = { cache: new Map(), robots: new Map(), nextAt: new Map() }; states.set(svc.fetch, s); }
  return s;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Reserve the next time slot for a host so requests to it are spaced out (never overlapping). */
async function hostSlot(st: State, host: string, intervalMs: number) {
  const now = Date.now();
  const at = Math.max(now, st.nextAt.get(host) || 0);
  st.nextAt.set(host, at + intervalMs);
  if (at > now) await sleep(at - now);
}

// ---------- robots.txt (RFC 9309, simplified) ----------
export interface Robots { allowed(pathAndQuery: string): boolean; crawlDelayMs: number; unavailable?: boolean }

/** Parse robots.txt for our bot: rules from groups naming HalaTujuBot, else from the '*' groups. */
export function parseRobots(txt: string, uaToken = UA_TOKEN): Robots {
  type Group = { agents: string[]; rules: { allow: boolean; path: string }[]; delay?: number };
  const groups: Group[] = [];
  let cur: Group | null = null, lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "allow" || key === "disallow") { if (val) cur.rules.push({ allow: key === "allow", path: val }); }
    else if (key === "crawl-delay" && Number.isFinite(Number(val))) cur.delay = Number(val);
  }
  const ours = groups.filter(g => g.agents.some(a => a !== "*" && uaToken.includes(a.replace(/\/.*/, ""))));
  const chosen = ours.length ? ours : groups.filter(g => g.agents.includes("*"));
  const rules = chosen.flatMap(g => g.rules).map(r => ({ ...r, re: patternToRegex(r.path), len: r.path.length }));
  const delay = Math.max(0, ...chosen.map(g => g.delay || 0));
  return {
    crawlDelayMs: delay * 1000,
    allowed(p: string) {
      if (p === "/robots.txt") return true;
      let best: { allow: boolean; len: number } | null = null;
      for (const r of rules) {
        if (!r.re.test(p)) continue;
        // Longest matching rule wins; on a tie, Allow wins.
        if (!best || r.len > best.len || (r.len === best.len && r.allow && !best.allow)) best = r;
      }
      return best ? best.allow : true;
    },
  };
}

function patternToRegex(p: string): RegExp {
  const anchored = p.endsWith("$");
  const body = (anchored ? p.slice(0, -1) : p).split("*").map(s => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp("^" + body + (anchored ? "$" : ""));
}

const allowAll: Robots = { allowed: () => true, crawlDelayMs: 0 };
const denyAll: Robots = { allowed: () => false, crawlDelayMs: 0, unavailable: true };

async function robotsFor(svc: Services, st: State, origin: string): Promise<Robots> {
  const host = new URL(origin).hostname;
  const hit = st.robots.get(origin);
  if (hit && hit.exp > Date.now()) return hit.rules;
  let rules: Robots;
  const url = origin + "/robots.txt";
  try {
    await hostSlot(st, host, fetchSettings.minIntervalMs);
    const res = await timed(svc, url, { redirect: "follow" });
    const body = res.status < 300 ? (await readCapped(res, 500_000)).text : "";
    // RFC 9309: 4xx = no restrictions; 5xx or unreachable = assume everything is disallowed.
    rules = res.status >= 500 ? denyAll : res.status >= 400 ? allowAll : parseRobots(body);
    await logFetch(svc, url, res.status, res.status < 500, res.status >= 500 ? "robots.txt server error" : null, body);
  } catch (e: any) {
    rules = denyAll;
    await logFetch(svc, url, null, false, `robots.txt unreachable: ${errMsg(e)}`, "");
  }
  st.robots.set(origin, { exp: Date.now() + fetchSettings.robotsTtlMs, rules });
  return rules;
}

// ---------- helpers ----------
const errMsg = (e: any) => (e?.name === "AbortError" ? "timed out" : String(e?.message || e).slice(0, 200));

async function timed(svc: Services, url: string, init: RequestInit = {}, timeoutMs = fetchSettings.timeoutMs): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await svc.fetch(url, { ...init, signal: ctrl.signal, headers: { "User-Agent": USER_AGENT, ...(init.headers as any || {}) } });
  } finally { clearTimeout(timer); }
}

/** Read a response body, stopping at maxBytes. */
async function readCapped(res: Response, maxBytes: number): Promise<{ text: string; tooBig: boolean; bytes: Buffer }> {
  if (!res.body) { const b = Buffer.from(await res.arrayBuffer()); return { text: b.toString("utf8"), tooBig: b.length > maxBytes, bytes: b }; }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) { await reader.cancel().catch(() => {}); return { text: "", tooBig: true, bytes: Buffer.alloc(0) }; }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks);
  return { text: bytes.toString("utf8"), tooBig: false, bytes };
}

/** Log URL without secrets (api_key / key query parameters are redacted). */
function safeUrl(url: string) {
  try { const u = new URL(url); for (const k of ["api_key", "key", "apikey", "token"]) if (u.searchParams.has(k)) u.searchParams.set(k, "REDACTED"); return u.toString(); }
  catch { return url.slice(0, 500); }
}

async function logFetch(svc: Services, url: string, status: number | null, ok: boolean, reason: string | null, body: string, excerpt?: string) {
  try {
    await svc.db.query("insert into fetch_log(url, host, status, ok, reason, sha256, excerpt, fetched_at) values ($1,$2,$3,$4,$5,$6,$7,$8)",
      [safeUrl(url).slice(0, 1000), hostOf(url) || "?", status, ok, reason, body ? createHash("sha256").update(body).digest("hex") : null,
       (excerpt ?? body).replace(/\s+/g, " ").trim().slice(0, 300) || null, svc.now().toISOString()]);
  } catch { /* logging must never break a fetch */ }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…", copy: "©" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** HTML -> readable plain text. Uses the main <article> when it holds the story, else the whole body. */
export function htmlToText(html: string): { title: string; text: string; published: string | null } {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i)?.[1];
  const title = decodeEntities((og || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim()).slice(0, 300);
  const s = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|svg|template|iframe|head|nav|footer|form)\b[\s\S]*?<\/\1>/gi, " ");
  const toText = (h: string) => decodeEntities(h.replace(/<(br|hr)\b[^>]*>/gi, "\n").replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|pre|ul|ol|table)>/gi, "\n").replace(/<[^>]+>/g, " "))
    .split("\n").map(l => l.replace(/[ \t ]+/g, " ").trim()).filter(Boolean).join("\n");
  // Pages often have several <article>s (related-post teasers): take the longest, and only if it is substantial.
  const longest = (s.match(/<article\b[\s\S]*?<\/article>/gi) || []).map(toText).sort((a, b) => b.length - a.length)[0];
  const text = longest && longest.length >= 1200 ? longest : toText(s);
  return { title, text, published: publishedDate(html) };
}

/** The page's own publication date (meta tags, JSON-LD or <time>), as YYYY-MM-DD. */
export function publishedDate(html: string): string | null {
  const m = html.match(/<meta[^>]+(?:property|name|itemprop)=["'](?:article:published_time|datePublished|pubdate|publish-date|date)["'][^>]*content=["']([^"']+)["']/i)?.[1]
    || html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1]
    || html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1];
  const t = m ? Date.parse(m) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

const TEXTY = /^(text\/|application\/(xhtml\+xml|xml|rss\+xml|atom\+xml|json|ld\+json))/i;

/**
 * Fetch a page (or feed, with raw: true) from an approved domain.
 * The planning agent uses this for careers pages: fetchApproved(svc, url, { kind: 'careers' }).
 */
export async function fetchApproved(svc: Services, url: string, opts: { kind?: SourceKind; raw?: boolean; maxBytes?: number; timeoutMs?: number } = {}): Promise<FetchResult> {
  const st = stateOf(svc);
  if (isLinkOnly(url)) return { ok: false, reason: "Link-only site (job board): its terms forbid automated access, so we never fetch it" };
  if (!hostOf(url)) return { ok: false, reason: "Not a valid http(s) URL" };
  if (!isApproved(url, opts.kind)) return { ok: false, reason: opts.kind && trustedEntry(url) ? `Domain is approved, but not as a ${opts.kind} source` : "Domain is not on the approved source list" };
  const cacheKey = (opts.raw ? "raw:" : "") + url;
  const hit = st.cache.get(cacheKey);
  if (hit && hit.exp > Date.now()) return hit.res;
  const res = await fetchPage(svc, st, url, opts);
  st.cache.set(cacheKey, { exp: Date.now() + (res.ok ? fetchSettings.cacheTtlMs : fetchSettings.failTtlMs), res });
  return res;
}

async function fetchPage(svc: Services, st: State, url: string, opts: { kind?: SourceKind; raw?: boolean; maxBytes?: number; timeoutMs?: number }): Promise<FetchResult> {
  let current = url;
  for (let hop = 0; hop <= fetchSettings.maxRedirects; hop++) {
    // Every hop must be approved and allowed by robots.txt.
    if (isLinkOnly(current)) return { ok: false, reason: `Redirected to a link-only site (${hostOf(current)}); not fetched` };
    if (!isApproved(current, opts.kind)) return { ok: false, reason: hop ? `Redirected to an unapproved domain (${hostOf(current)}); not fetched` : "Domain is not on the approved source list" };
    const u = new URL(current);
    const robots = await robotsFor(svc, st, u.origin);
    if (robots.unavailable) return { ok: false, reason: `robots.txt for ${u.hostname} is unavailable, so we don't fetch (RFC 9309)` };
    if (!robots.allowed(u.pathname + u.search)) return { ok: false, reason: `robots.txt disallows ${u.pathname} for our bot` };
    await hostSlot(st, u.hostname, Math.max(fetchSettings.minIntervalMs, Math.min(robots.crawlDelayMs, fetchSettings.maxCrawlDelayMs)));
    let res: Response;
    try {
      res = await timed(svc, current, { redirect: "manual", headers: { Accept: opts.raw ? "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.5" : "text/html, application/xhtml+xml, text/plain;q=0.8" } }, opts.timeoutMs);
    } catch (e: any) {
      await logFetch(svc, current, null, false, errMsg(e), "");
      return { ok: false, reason: `Fetch failed: ${errMsg(e)}` };
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await logFetch(svc, current, res.status, true, loc ? `redirect -> ${loc}` : "redirect without location", "");
      if (!loc) return { ok: false, reason: "Redirect without a location", status: res.status };
      current = new URL(loc, current).toString();
      continue;
    }
    if (res.status === 401 || res.status === 402 || res.status === 403 || res.status === 407) {
      await logFetch(svc, current, res.status, false, "login or paywall", "");
      return { ok: false, reason: `Login or paywall (HTTP ${res.status}): skipped, never worked around`, status: res.status };
    }
    if (!res.ok) {
      await logFetch(svc, current, res.status, false, `HTTP ${res.status}`, "");
      return { ok: false, reason: `HTTP ${res.status}`, status: res.status };
    }
    const contentType = res.headers.get("content-type") || "text/html";
    if (!TEXTY.test(contentType)) {
      await logFetch(svc, current, res.status, false, `unsupported content type ${contentType}`, "");
      return { ok: false, reason: `Unsupported content type (${contentType})`, status: res.status };
    }
    let body: { text: string; tooBig: boolean };
    try { body = await readCapped(res, opts.maxBytes ?? fetchSettings.maxBytes); }
    catch (e: any) { await logFetch(svc, current, res.status, false, errMsg(e), ""); return { ok: false, reason: `Fetch failed: ${errMsg(e)}` }; }
    if (body.tooBig) {
      await logFetch(svc, current, res.status, false, "too large", "");
      return { ok: false, reason: "Page is larger than our size cap", status: res.status };
    }
    const isHtml = /html/i.test(contentType) || /^\s*<(!doctype html|html)/i.test(body.text);
    const parsed = opts.raw || !isHtml ? { title: "", text: body.text, published: null } : htmlToText(body.text);
    if (!opts.raw && isHtml && /type=["']password["']/i.test(body.text) && parsed.text.length < 1500) {
      await logFetch(svc, current, res.status, false, "login form", body.text);
      return { ok: false, reason: "Page asks for a login: skipped", status: res.status };
    }
    if (!opts.raw && parsed.text.length < 200) {
      await logFetch(svc, current, res.status, false, "no readable text", body.text, parsed.text);
      return { ok: false, reason: "No readable text on the page (script-only, login or paywall)", status: res.status };
    }
    await logFetch(svc, current, res.status, true, null, body.text, parsed.text);
    // Feeds (raw) are returned whole so they parse (the size cap above still applies); page text is trimmed.
    const text = opts.raw ? parsed.text : parsed.text.slice(0, fetchSettings.maxTextChars);
    return { ok: true, url, finalUrl: current, title: parsed.title, text, fetchedAt: svc.now().toISOString(), contentType, status: res.status, published: parsed.published };
  }
  return { ok: false, reason: "Too many redirects" };
}

/** Call a documented public API (GDELT, HN Algolia, arXiv, OpenAlex, optional search providers). */
export async function fetchApi(svc: Services, url: string, init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number; maxBytes?: number } = {}): Promise<ApiResult> {
  const terms = apiTerms(url);
  if (!terms) return { ok: false, reason: "Not a documented API on our list" };
  const st = stateOf(svc);
  const host = hostOf(url)!;
  await hostSlot(st, host, Math.max(fetchSettings.minIntervalMs ? terms.minIntervalMs : 0, fetchSettings.minIntervalMs));
  let res: Response;
  try {
    res = await timed(svc, url, { method: init.method || "GET", headers: init.headers, body: init.body, redirect: "follow" }, init.timeoutMs);
  } catch (e: any) {
    await logFetch(svc, url, null, false, errMsg(e), "");
    return { ok: false, reason: `Request failed: ${errMsg(e)}` };
  }
  const final = res.url || url;
  if (res.url && !apiTerms(final)) { await logFetch(svc, url, res.status, false, "redirected off the API", ""); return { ok: false, reason: "API redirected to another host" }; }
  let body: { text: string; tooBig: boolean };
  try { body = await readCapped(res, init.maxBytes ?? fetchSettings.maxBytes); }
  catch (e: any) { await logFetch(svc, url, res.status, false, errMsg(e), ""); return { ok: false, reason: `Request failed: ${errMsg(e)}` }; }
  if (!res.ok || body.tooBig) {
    const reason = body.tooBig ? "response too large" : res.status === 429 ? "rate limited (HTTP 429)" : `HTTP ${res.status}`;
    await logFetch(svc, url, res.status, false, reason, body.text.slice(0, 2000));
    return { ok: false, reason, status: res.status };
  }
  await logFetch(svc, url, res.status, true, null, body.text);
  return { ok: true, status: res.status, body: body.text, contentType: res.headers.get("content-type") || "" };
}
