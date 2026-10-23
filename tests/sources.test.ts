// Source policy and fetcher: job boards never fetched, untrusted refused, robots.txt obeyed,
// redirects re-checked, logins skipped, size capped; parsers tested on recorded API responses.
import { describe, it, expect } from "vitest";
import { testServices } from "./helpers/services.ts";
import { mockFetch, fixture, page } from "./fixtures/sources/mock-net.ts";
import { fetchApproved, fetchApi, parseRobots, htmlToText, fetchSettings, USER_AGENT } from "../server/sources/fetch.ts";
import { isApproved, isLinkOnly, trustedEntry, domainKey } from "../server/sources/policy.ts";
import { parseGdelt, searchGdelt } from "../server/sources/gdelt.ts";
import { parseHn, searchHn } from "../server/sources/hn.ts";
import { parseArxiv, searchArxiv, arxivQuery } from "../server/sources/arxiv.ts";
import { parseOpenAlex, abstractFromIndex, searchOpenAlex } from "../server/sources/openalex.ts";
import { parseFeed, collectRss } from "../server/sources/rss.ts";
import { hydrate } from "../server/sources/index.ts";

const since = new Date("2026-09-23T10:00:00Z");

describe("trust list and link-only sites", () => {
  it("approves trusted domains and their subdomains only", () => {
    expect(isApproved("https://www.reuters.com/technology/x")).toBe(true);
    expect(isApproved("https://feeds.bbci.co.uk/news/rss.xml")).toBe(true);
    expect(isApproved("https://export.arxiv.org/api/query")).toBe(true);
    expect(isApproved("https://notreuters.com/x")).toBe(false);
    expect(isApproved("https://reuters.com.evil.example/x")).toBe(false);
    expect(isApproved("ftp://reuters.com/x")).toBe(false);
    expect(trustedEntry("https://news.sap.com/2026/x")!.domain).toBe("news.sap.com");
    expect(isApproved("https://careers.maybank.com/jobs", "careers")).toBe(true);
    expect(isApproved("https://www.reuters.com/x", "careers")).toBe(false);
  });

  it("job boards are link-only", () => {
    for (const u of ["https://www.jobstreet.com.my/job/1", "https://www.linkedin.com/jobs/view/1", "https://malaysia.indeed.com/viewjob", "https://www.glassdoor.com/x", "https://my.hiredly.com/jobs/x", "https://www.maukerja.my/job/1"]) {
      expect(isLinkOnly(u)).toBe(true);
      expect(isApproved(u)).toBe(false);
    }
  });

  it("job boards and untrusted sites are never fetched", async () => {
    const net = mockFetch([]);
    const svc = await testServices({ fetch: net });
    for (const u of ["https://www.jobstreet.com.my/job/1", "https://www.linkedin.com/jobs/view/1", "https://example.com/page"]) {
      const r = await fetchApproved(svc, u);
      expect(r.ok).toBe(false);
    }
    expect((await fetchApproved(svc, "https://www.linkedin.com/jobs")).ok === false && net.calls.length).toBe(0);
    const r = await fetchApproved(svc, "https://www.jobstreet.com.my/job/1");
    expect(!r.ok && r.reason).toMatch(/link-only/i);
  });

  it("independent sources are counted per organisation", () => {
    expect(domainKey("https://www.bbc.com/news/1")).toBe(domainKey("https://feeds.bbci.co.uk/x"));
    expect(domainKey("https://www.thestar.com.my/x")).toBe("thestar.com.my");
    expect(domainKey("https://www.reuters.com/x")).not.toBe(domainKey("https://apnews.com/x"));
  });
});

describe("robots.txt", () => {
  it("parses groups: our bot's group wins over *, longest rule wins, Allow wins ties", () => {
    const r = parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/ok\n\nUser-agent: GPTBot\nDisallow: /");
    expect(r.allowed("/public/a")).toBe(true);
    expect(r.allowed("/private/x")).toBe(false);
    expect(r.allowed("/private/ok/1")).toBe(true);
    const ours = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: HalaTujuBot\nDisallow: /admin\nCrawl-delay: 3");
    expect(ours.allowed("/news/1")).toBe(true);
    expect(ours.allowed("/admin/x")).toBe(false);
    expect(ours.crawlDelayMs).toBe(3000);
    const wild = parseRobots("User-agent: *\nDisallow: /*?s=\nDisallow: /*.php$");
    expect(wild.allowed("/search?s=ai")).toBe(false);
    expect(wild.allowed("/a.php")).toBe(false);
    expect(wild.allowed("/a.php?x=1")).toBe(true);
    expect(parseRobots("User-agent: *\nDisallow:").allowed("/x")).toBe(true);
  });

  it("a Disallow is respected by the fetcher (the page is never requested)", async () => {
    const net = mockFetch([
      ["https://www.reuters.com/robots.txt", { body: "User-agent: *\nDisallow: /private/", headers: { "content-type": "text/plain" } }],
      ["https://www.reuters.com/public/a", { body: page("Public", ["x".repeat(300)]) }],
    ]);
    const svc = await testServices({ fetch: net });
    const blocked = await fetchApproved(svc, "https://www.reuters.com/private/a");
    expect(blocked.ok).toBe(false);
    expect(!blocked.ok && blocked.reason).toMatch(/robots\.txt disallows/);
    expect(net.calls.some(c => c.url.endsWith("/private/a"))).toBe(false);
    expect((await fetchApproved(svc, "https://www.reuters.com/public/a")).ok).toBe(true);
    // robots.txt was fetched once and cached
    expect(net.calls.filter(c => c.url.endsWith("robots.txt")).length).toBe(1);
  });

  it("robots.txt server error means don't fetch (RFC 9309)", async () => {
    const net = mockFetch([["https://apnews.com/robots.txt", { status: 503, body: "down" }]]);
    const svc = await testServices({ fetch: net });
    const r = await fetchApproved(svc, "https://apnews.com/article/1");
    expect(r.ok).toBe(false);
    expect(net.calls.length).toBe(1);
  });
});

describe("fetchApproved", () => {
  it("identifies itself, converts HTML to text, finds the published date, and logs only a short excerpt", async () => {
    const net = mockFetch([["https://www.bbc.com/news/articles/1", { body: page("Barclays and AI", ["Barclays is cutting 5,000 jobs as it increases its reliance on AI.", "y ".repeat(400)]) }]]);
    const svc = await testServices({ fetch: net });
    const r = await fetchApproved(svc, "https://www.bbc.com/news/articles/1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.title).toBe("Barclays and AI");
    expect(r.text).toContain("Barclays is cutting 5,000 jobs");
    expect(r.text).not.toContain("var x");          // scripts removed
    expect(r.text).not.toContain("Home | World");   // nav removed
    expect(r.published).toBe("2026-10-20");
    const ua = (net.calls.find(c => c.url.endsWith("/articles/1"))!.init!.headers as any)["User-Agent"];
    expect(ua).toBe(USER_AGENT);
    const log = (await svc.db.query("select * from fetch_log where url=$1", ["https://www.bbc.com/news/articles/1"])).rows[0] as any;
    expect(log.ok).toBe(true);
    expect(log.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(log.excerpt.length).toBeLessThanOrEqual(300);
    // cached: a second call makes no request
    const before = net.calls.length;
    await fetchApproved(svc, "https://www.bbc.com/news/articles/1");
    expect(net.calls.length).toBe(before);
  });

  it("re-checks every redirect: to an untrusted site or a job board is refused and never fetched", async () => {
    const net = mockFetch([
      ["https://www.reuters.com/go-evil", { status: 301, headers: { location: "https://evil.example.com/landing" } }],
      ["https://www.reuters.com/go-jobs", { status: 302, headers: { location: "https://www.linkedin.com/jobs/1" } }],
      ["https://www.reuters.com/go-ok", { status: 301, headers: { location: "https://apnews.com/article/2" } }],
      ["https://apnews.com/article/2", { body: page("AP", ["z ".repeat(200)]) }],
    ]);
    const svc = await testServices({ fetch: net });
    const a = await fetchApproved(svc, "https://www.reuters.com/go-evil");
    expect(!a.ok && a.reason).toMatch(/unapproved domain/);
    const b = await fetchApproved(svc, "https://www.reuters.com/go-jobs");
    expect(!b.ok && b.reason).toMatch(/link-only/);
    expect(net.calls.some(c => /evil\.example|linkedin/.test(c.url))).toBe(false);
    const c = await fetchApproved(svc, "https://www.reuters.com/go-ok");
    expect(c.ok && c.finalUrl).toBe("https://apnews.com/article/2");
  });

  it("skips login and paywall pages, oversized pages and non-text content", async () => {
    const net = mockFetch([
      ["https://www.thestar.com.my/premium", { status: 403, body: "Subscribe" }],
      ["https://www.nst.com.my/login-wall", { body: `<html><body><form><input type="password"></form><p>Sign in to read</p>${" ".repeat(300)}</body></html>` }],
      ["https://www.malaymail.com/big", { body: "x".repeat(fetchSettings.maxBytes + 10) }],
      ["https://www.theedgemalaysia.com/report.pdf", { body: "%PDF", headers: { "content-type": "application/pdf" } }],
    ]);
    const svc = await testServices({ fetch: net });
    expect(await fetchApproved(svc, "https://www.thestar.com.my/premium")).toMatchObject({ ok: false, reason: expect.stringMatching(/paywall/i) });
    expect(await fetchApproved(svc, "https://www.nst.com.my/login-wall")).toMatchObject({ ok: false });
    expect(await fetchApproved(svc, "https://www.malaymail.com/big")).toMatchObject({ ok: false, reason: expect.stringMatching(/size cap/) });
    expect(await fetchApproved(svc, "https://www.theedgemalaysia.com/report.pdf")).toMatchObject({ ok: false, reason: expect.stringMatching(/content type/) });
  });

  it("fetchApi only calls documented APIs", async () => {
    const svc = await testServices({ fetch: mockFetch([]) });
    expect(await fetchApi(svc, "https://example.com/api")).toMatchObject({ ok: false });
  });

  it("htmlToText decodes entities and keeps paragraphs", () => {
    const r = htmlToText("<html><head><title>A &amp; B</title></head><body><p>One&nbsp;two &#8217;three&#x2019;</p><p>Four</p></body></html>");
    expect(r.title).toBe("A & B");
    expect(r.text).toBe("One two ’three’\nFour");
  });
});

describe("parsers on recorded API responses (23 Oct 2026)", () => {
  it("GDELT: parses articles; none of these domains are trusted, so nothing is kept", async () => {
    const body = fixture("gdelt-artlist.json");
    const arts = parseGdelt(body);
    expect(arts.length).toBe(20);
    expect(arts[0]).toMatchObject({ url: expect.stringMatching(/^https:/), date: "2026-10-22" });
    const svc = await testServices({ fetch: mockFetch([[/api\.gdeltproject\.org/, { body, headers: { "content-type": "application/json" } }]]) });
    expect((await searchGdelt(svc, { terms: ["artificial intelligence", "accounting"] }, since)).items).toEqual([]);
    // The same response with one article moved to a trusted domain (edited copy) keeps just that one.
    const j = JSON.parse(body); j.articles[0].url = "https://www.reuters.com/business/ai-accounting-2026-10-22/";
    const svc2 = await testServices({ fetch: mockFetch([[/api\.gdeltproject\.org/, { body: JSON.stringify(j) }]]) });
    const r = await searchGdelt(svc2, { terms: ["AI"] }, since);
    expect(r.items.map(i => i.url)).toEqual(["https://www.reuters.com/business/ai-accounting-2026-10-22/"]);
    expect(r.items[0].needsPage).toBe(true);
  });

  it("GDELT rate-limit text is reported as an error, not parsed", async () => {
    const svc = await testServices({ fetch: mockFetch([[/api\.gdeltproject\.org/, { status: 429, body: "Please limit requests to one every 5 seconds" }]]) });
    const r = await searchGdelt(svc, { terms: ["AI"] }, since);
    expect(r.items).toEqual([]);
    expect(r.error).toMatch(/429/);
  });

  it("Hacker News: keeps only stories that link to a trusted domain", async () => {
    const body = fixture("hn-search.json");
    const hits = parseHn(body);
    expect(hits.length).toBe(4);
    const svc = await testServices({ fetch: mockFetch([[/hn\.algolia\.com/, { body }]]) });
    const r = await searchHn(svc, { terms: ["AI"] }, since);
    expect(r.items.map(i => new URL(i.url).hostname).sort()).toEqual(["www.bbc.com", "www.theverge.com"]); // microsoft.github.io and the self-post are dropped
    expect(r.items.every(i => i.needsPage && i.sourceKind === "hn")).toBe(true);
  });

  it("arXiv: parses the Atom feed into abstracts with abs links and dates", async () => {
    const body = fixture("arxiv-query.xml");
    const e = parseArxiv(body);
    expect(e.length).toBe(2);
    expect(e[0].url).toMatch(/^https:\/\/arxiv\.org\/abs\//);
    expect(e[0].date).toBe("2026-09-29");
    expect(e[0].abstract.length).toBeGreaterThan(100);
    expect(arxivQuery({ terms: ["invoice", "AI"] })).toBe(`all:"invoice" AND (abs:"language model" OR abs:LLM OR abs:agent OR abs:"generative AI")`);
    const svc = await testServices({ fetch: mockFetch([[/export\.arxiv\.org/, { body, headers: { "content-type": "application/atom+xml" } }]]) });
    const r = await searchArxiv(svc, { terms: ["invoice"] }, since);
    expect(r.items.length).toBe(2);
    expect(r.items[0].needsPage).toBeFalsy();
  });

  it("OpenAlex: rebuilds abstracts from the inverted index and cites the openalex.org work", async () => {
    expect(abstractFromIndex({ world: [1], hello: [0], again: [2] })).toBe("hello world again");
    const body = fixture("openalex-works.json");
    const w = parseOpenAlex(body);
    expect(w.length).toBe(2);
    expect(w[0].url).toMatch(/^https:\/\/openalex\.org\/W\d+$/);
    expect(w[0].abstract.split(" ").length).toBeGreaterThan(30);
    const svc = await testServices({ fetch: mockFetch([[/api\.openalex\.org/, { body }]]) });
    const r = await searchOpenAlex(svc, { terms: ["invoice"] }, since);
    expect(r.items.length).toBe(2);
    expect(r.items[0].date).toBe("2026-10-14");
  });

  it("RSS and Atom: parses the recorded TechCrunch feed and an Atom feed", () => {
    const items = parseFeed(fixture("techcrunch-ai.rss.xml"));
    expect(items.length).toBe(2);
    expect(items[0].url).toMatch(/^https:\/\/techcrunch\.com\/2026\/10\/22\//);
    expect(items[0].date).toBe("2026-10-22");
    expect(items[0].text.length).toBeGreaterThan(20);
    const atom = parseFeed(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>T</title><link rel="alternate" href="https://www.zdnet.com/a/"/><published>2026-10-21T00:00:00Z</published><summary>S &amp; more</summary></entry></feed>`);
    expect(atom).toEqual([{ url: "https://www.zdnet.com/a/", title: "T", date: "2026-10-21", text: "S & more" }]);
  });

  it("collectRss keeps recent items on trusted domains and reports failing feeds", async () => {
    const body = fixture("techcrunch-ai.rss.xml");
    const svc = await testServices({ fetch: mockFetch([
      ["https://techcrunch.com/category/artificial-intelligence/feed/", { body, headers: { "content-type": "application/rss+xml" } }],
      [/.*/, { status: 404, body: "" }],
    ]) });
    const r = await collectRss(svc, since);
    expect(r.items.length).toBe(2);
    expect(r.perFeed["TechCrunch AI"]).toBe("2 recent items");
    expect(r.perFeed["OpenAI News"]).toMatch(/404/);
  });

  it("hydrate reads the page through fetchApproved and drops items it may not read", async () => {
    const net = mockFetch([
      ["https://www.theverge.com/robots.txt", { body: "User-agent: *\nDisallow: /blocked/", headers: { "content-type": "text/plain" } }],
      ["https://www.theverge.com/ok", { body: page("Page title", ["Full article text ".repeat(30)]) }],
    ]);
    const svc = await testServices({ fetch: net });
    const ok = await hydrate(svc, { sourceKind: "hn", url: "https://www.theverge.com/ok", title: "HN title", date: "2026-10-22", text: "HN title", needsPage: true }, since);
    expect(ok?.text).toMatch(/^Page title\n/);   // the page's own title, not the HN poster's
    expect(ok?.text).toContain("Full article text");
    expect(ok?.text).not.toContain("HN title");
    expect(await hydrate(svc, { sourceKind: "hn", url: "https://www.theverge.com/blocked/x", title: "t", date: "2026-10-22", text: "t", needsPage: true }, since)).toBeNull();
  });
});

describe("web search providers", () => {
  it("keeps Tavily results when Gemini grounding has no quota, and searches trusted domains only", async () => {
    const { vi } = await import("vitest");
    const { searchWeb } = await import("../server/sources/websearch.ts");
    vi.stubEnv("TAVILY_API_KEY", "test-key");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_GROUNDING", "on");
    vi.stubEnv("BRAVE_API_KEY", "");
    try {
      const net = mockFetch([
        ["https://api.tavily.com/search", { headers: { "content-type": "application/json" }, body: JSON.stringify({ results: [
          { url: "https://news.sap.com/2026/10/ai-agents-finance/", title: "AI agents for finance", content: "Agents match invoices.", published_date: "Wed, 14 Oct 2026 08:00:00 GMT" },
        ] }) }],
        [/generativelanguage\.googleapis\.com/, { status: 429, body: "{}" }],
      ]);
      const svc = await testServices({ fetch: net });
      const r = await searchWeb(svc, { terms: ["invoice", "AI"] }, since);
      expect(r.items.map(i => i.url)).toEqual(["https://news.sap.com/2026/10/ai-agents-finance/"]);
      expect(r.skipped).toBeUndefined(); // a skip here would stop the remaining queries
      const body = JSON.parse(String(net.calls.find(c => c.url.includes("tavily"))!.init!.body));
      expect(body.include_domains).toContain("reuters.com");
      expect(body.include_domains).not.toContain("api.gdeltproject.org");
      expect(body.exclude_domains).toContain("linkedin.com");
    } finally { vi.unstubAllEnvs(); }
  });
});
