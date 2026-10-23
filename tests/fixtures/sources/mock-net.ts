// A scripted fetch for tests: no real network. Routes match by exact URL, URL prefix, or regex.
// robots.txt answers 404 (no rules) unless a route says otherwise. Every call is recorded.
import { readFileSync } from "node:fs";

export type Reply = { status?: number; body?: string; headers?: Record<string, string> } | Response;
export type Route = [string | RegExp, Reply | ((url: string, init?: RequestInit) => Reply | Promise<Reply>)];

export const fixture = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

export function mockFetch(routes: Route[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (input: any, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    for (const [pat, reply] of routes) {
      const hit = typeof pat === "string" ? url === pat || (pat.endsWith("*") && url.startsWith(pat.slice(0, -1))) : pat.test(url);
      if (!hit) continue;
      const r = typeof reply === "function" ? await reply(url, init) : reply;
      if (r instanceof Response) return r;
      return new Response(r.body ?? "", { status: r.status ?? 200, headers: r.headers ?? { "content-type": "text/html; charset=utf-8" } });
    }
    if (/\/robots\.txt$/.test(url)) return new Response("not found", { status: 404 });
    throw new Error(`Unexpected network call in test: ${url}`);
  }) as unknown as typeof fetch;
  return Object.assign(fn, { calls });
}

/** A simple article page on a trusted site. */
export const page = (title: string, paragraphs: string[], published = "2026-10-20T08:00:00Z") =>
  `<!doctype html><html><head><title>${title}</title><meta property="article:published_time" content="${published}"><script>var x = "ignore";</script></head>
   <body><nav>Home | World | Business</nav><article><h1>${title}</h1>${paragraphs.map(p => `<p>${p}</p>`).join("\n")}</article><footer>Copyright</footer></body></html>`;

/** An RSS feed whose items link to the given URLs. */
export const rss = (items: { title: string; link: string; date: string; description?: string }[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Test feed</title>${items
    .map(i => `<item><title>${i.title}</title><link>${i.link}</link><pubDate>${new Date(i.date).toUTCString()}</pubDate><description><![CDATA[${i.description ?? i.title}]]></description></item>`)
    .join("")}</channel></rss>`;
