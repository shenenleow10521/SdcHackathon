// Source policy: which sites our agents may read, and which are link-only.
// Pure data + pure functions (no I/O), so triage and tests can use them directly.

export type SourceKind = "news" | "vendor" | "research" | "government" | "careers" | "api";
export interface TrustedSource { domain: string; kind: SourceKind; why: string }

/** Approved domains. A URL is approved if its host is the domain or a subdomain of it. */
export const TRUSTED: TrustedSource[] = [
  // Reputable news (international and Malaysian)
  { domain: "reuters.com", kind: "news", why: "International news agency with editorial standards" },
  { domain: "apnews.com", kind: "news", why: "International news agency with editorial standards" },
  { domain: "bbc.com", kind: "news", why: "Public broadcaster" },
  { domain: "bbc.co.uk", kind: "news", why: "Public broadcaster" },
  { domain: "bbci.co.uk", kind: "news", why: "BBC feeds host" },
  { domain: "theedgemalaysia.com", kind: "news", why: "Malaysian business news" },
  { domain: "thestar.com.my", kind: "news", why: "Malaysian national news" },
  { domain: "nst.com.my", kind: "news", why: "Malaysian national news" },
  { domain: "malaymail.com", kind: "news", why: "Malaysian national news" },
  { domain: "freemalaysiatoday.com", kind: "news", why: "Malaysian national news" },
  { domain: "techcrunch.com", kind: "news", why: "Technology industry news" },
  { domain: "theverge.com", kind: "news", why: "Technology news" },
  { domain: "arstechnica.com", kind: "news", why: "Technology news" },
  { domain: "venturebeat.com", kind: "news", why: "Enterprise technology news" },
  { domain: "zdnet.com", kind: "news", why: "Enterprise technology news" },
  // AI labs and enterprise software vendors (first-hand capability announcements)
  { domain: "openai.com", kind: "vendor", why: "AI lab: first-hand capability announcements" },
  { domain: "anthropic.com", kind: "vendor", why: "AI lab: first-hand capability announcements" },
  { domain: "blog.google", kind: "vendor", why: "Google's official blog" },
  { domain: "deepmind.google", kind: "vendor", why: "AI lab: first-hand capability announcements" },
  { domain: "microsoft.com", kind: "vendor", why: "Enterprise software vendor (Copilot, Dynamics)" },
  { domain: "news.sap.com", kind: "vendor", why: "ERP vendor news (finance automation)" },
  { domain: "sap.com", kind: "vendor", why: "ERP vendor (finance automation)" },
  { domain: "oracle.com", kind: "vendor", why: "ERP vendor (finance automation)" },
  { domain: "workday.com", kind: "vendor", why: "Finance and HR software vendor" },
  { domain: "uipath.com", kind: "vendor", why: "Automation software vendor" },
  // Research
  { domain: "arxiv.org", kind: "research", why: "Preprint server for AI research" },
  { domain: "openalex.org", kind: "research", why: "Open catalogue of scholarly works" },
  // Government and international organisations
  { domain: "dosm.gov.my", kind: "government", why: "Department of Statistics Malaysia" },
  { domain: "data.gov.my", kind: "government", why: "Malaysian open government data" },
  { domain: "ilo.org", kind: "government", why: "International Labour Organization" },
  { domain: "oecd.org", kind: "government", why: "OECD employment and AI research" },
  { domain: "weforum.org", kind: "government", why: "World Economic Forum (Future of Jobs)" },
  { domain: "mdec.my", kind: "government", why: "Malaysia Digital Economy Corporation" },
  { domain: "hrdcorp.gov.my", kind: "government", why: "HRD Corp (training funding)" },
  // Added for the prelim-round scale-up (Job Market Researcher): Malaysian institutions and news
  { domain: "bernama.com", kind: "news", why: "Malaysia's national news agency" },
  { domain: "mida.gov.my", kind: "government", why: "Malaysian Investment Development Authority" },
  { domain: "talentcorp.com.my", kind: "government", why: "TalentCorp (Critical Occupations List, workforce studies)" },
  { domain: "mohr.gov.my", kind: "government", why: "Ministry of Human Resources Malaysia" },
  { domain: "bnm.gov.my", kind: "government", why: "Bank Negara Malaysia (central bank)" },
  { domain: "sc.com.my", kind: "government", why: "Securities Commission Malaysia (sustainability disclosure)" },
  { domain: "mia.org.my", kind: "research", why: "Malaysian Institute of Accountants" },
  { domain: "channelnewsasia.com", kind: "news", why: "Regional news broadcaster (CNA)" },
  // International institutions and research
  { domain: "imf.org", kind: "government", why: "International Monetary Fund (AI and jobs research)" },
  { domain: "worldbank.org", kind: "government", why: "World Bank (labour market research)" },
  { domain: "nber.org", kind: "research", why: "National Bureau of Economic Research working papers" },
  { domain: "hai.stanford.edu", kind: "research", why: "Stanford HAI (AI Index)" },
  { domain: "brookings.edu", kind: "research", why: "Brookings Institution (AI and work research)" },
  { domain: "ifac.org", kind: "research", why: "International Federation of Accountants" },
  { domain: "accaglobal.com", kind: "research", why: "ACCA (accountancy profession research)" },
  { domain: "ifrs.org", kind: "research", why: "IFRS Foundation / ISSB sustainability standards" },
  { domain: "ghgprotocol.org", kind: "research", why: "GHG Protocol (emissions accounting standard)" },
  { domain: "cdp.net", kind: "research", why: "CDP (environmental disclosure)" },
  // Technology and finance trade news
  { domain: "technologyreview.com", kind: "news", why: "MIT Technology Review" },
  { domain: "wired.com", kind: "news", why: "Technology news" },
  { domain: "cnbc.com", kind: "news", why: "Business news" },
  { domain: "accountingtoday.com", kind: "news", why: "Accounting industry trade news" },
  { domain: "cfo.com", kind: "news", why: "Finance leadership trade news" },
  // Software vendors announcing finance and HR AI features (first-hand capability claims)
  { domain: "salesforce.com", kind: "vendor", why: "CRM and AI agent vendor" },
  { domain: "servicenow.com", kind: "vendor", why: "Workflow automation vendor" },
  { domain: "xero.com", kind: "vendor", why: "Accounting software vendor (widely used in Malaysia)" },
  { domain: "intuit.com", kind: "vendor", why: "Accounting and tax software vendor" },
  { domain: "netsuite.com", kind: "vendor", why: "ERP vendor (finance automation)" },
  { domain: "ibm.com", kind: "vendor", why: "Enterprise AI vendor" },
  { domain: "aws.amazon.com", kind: "vendor", why: "Cloud and AI vendor (official blog)" },
  // Professional services research (published reports)
  { domain: "pwc.com", kind: "research", why: "PwC published research" },
  { domain: "kpmg.com", kind: "research", why: "KPMG published research" },
  { domain: "ey.com", kind: "research", why: "EY published research" },
  { domain: "mckinsey.com", kind: "research", why: "McKinsey Global Institute research" },
  // Documented public APIs, used under their published API terms
  { domain: "api.gdeltproject.org", kind: "api", why: "GDELT DOC 2.0 news search API" },
  { domain: "hn.algolia.com", kind: "api", why: "Hacker News search API (discovery only; we use the linked article)" },
  // Employer careers pages (company-specific requirements; facts + short quote + link only)
  { domain: "careers.maybank.com", kind: "careers", why: "Employer careers page" },
  { domain: "cimb.com", kind: "careers", why: "Employer site with careers section" },
  { domain: "petronas.com", kind: "careers", why: "Employer site with careers section" },
  { domain: "careers.pwc.com", kind: "careers", why: "Employer careers page" },
  { domain: "deloitte.com", kind: "careers", why: "Employer site with careers section" },
  { domain: "jobs.sap.com", kind: "careers", why: "Employer careers page" },
];

/** Job boards: we only ever link to them. Their terms forbid automated access, so we never fetch them. */
export const LINK_ONLY = [
  { name: "JobStreet", domain: "jobstreet.com", url: "https://www.jobstreet.com.my", why: "Terms forbid automated access" },
  { name: "LinkedIn", domain: "linkedin.com", url: "https://www.linkedin.com/jobs", why: "Terms forbid scraping" },
  { name: "Indeed", domain: "indeed.com", url: "https://malaysia.indeed.com", why: "Terms forbid automated access" },
  { name: "Glassdoor", domain: "glassdoor.com", url: "https://www.glassdoor.com", why: "Terms forbid scraping" },
  { name: "Hiredly", domain: "hiredly.com", url: "https://my.hiredly.com", why: "Terms forbid automated access" },
  { name: "Maukerja", domain: "maukerja.my", url: "https://www.maukerja.my", why: "Terms forbid automated access" },
];

/**
 * Documented APIs and their published terms. These endpoints are called under the API's own terms of use
 * (rate limits below). robots.txt governs crawling of pages: every page fetch obeys it.
 * Note: arXiv's robots.txt disallows /api for crawlers, while its API Terms of Use explicitly invite
 * programmatic access at no more than one request every 3 seconds, which is what we do.
 */
export const API_TERMS: Record<string, { termsUrl: string; minIntervalMs: number }> = {
  "export.arxiv.org": { termsUrl: "https://info.arxiv.org/help/api/tou.html", minIntervalMs: 3500 },
  "api.openalex.org": { termsUrl: "https://docs.openalex.org/how-to-use-the-api/rate-limits-and-authentication", minIntervalMs: 1100 },
  "api.gdeltproject.org": { termsUrl: "https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/", minIntervalMs: 10000 },
  "hn.algolia.com": { termsUrl: "https://hn.algolia.com/api", minIntervalMs: 1000 },
  "api.search.brave.com": { termsUrl: "https://brave.com/search/api/", minIntervalMs: 1100 },
  "api.tavily.com": { termsUrl: "https://docs.tavily.com/", minIntervalMs: 1100 },
  "generativelanguage.googleapis.com": { termsUrl: "https://ai.google.dev/gemini-api/terms", minIntervalMs: 1000 },
};

export const POLICY: string[] = [
  "Approved domains only: our agents read only the sites on the trust list (also after any redirect).",
  "Job boards (JobStreet, LinkedIn, Indeed, Glassdoor, Hiredly, Maukerja) are link-only: their terms forbid automated access, so we never fetch them.",
  "robots.txt is obeyed for every page we fetch, including Crawl-delay, and the bot identifies itself as HalaTujuBot.",
  "Documented public APIs (GDELT, Hacker News Algolia, arXiv, OpenAlex) are called under their published API terms and rate limits.",
  "No logins, paywalls or workarounds: a page that needs one is skipped.",
  "Requests are rate-limited per site, time out, and have a size cap; results are cached in memory.",
  "We store extracted facts, a short evidence quote (max 300 characters in the fetch log) and the link, never full copies of pages.",
  "Page text is treated as data, never as instructions to our AI agents.",
  "Every signal needs a quote that appears word-for-word on the source page; otherwise it is rejected.",
];

export function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.hostname.toLowerCase().replace(/\.$/, "");
  } catch { return null; }
}

const matches = (host: string, domain: string) => host === domain || host.endsWith("." + domain);

/** The trust-list entry for a URL, or null. Link-only sites never match, even if listed by mistake. */
export function trustedEntry(url: string): TrustedSource | null {
  const host = hostOf(url);
  if (!host || isLinkOnly(url)) return null;
  // Most specific domain wins (e.g. news.sap.com before sap.com)
  return TRUSTED.filter(t => matches(host, t.domain)).sort((a, b) => b.domain.length - a.domain.length)[0] || null;
}

/** May our agents fetch or cite this URL? Optionally require a kind (e.g. 'careers'). */
export function isApproved(url: string, kind?: SourceKind): boolean {
  const t = trustedEntry(url);
  return !!t && (!kind || t.kind === kind);
}

export function isLinkOnly(url: string): boolean {
  const host = hostOf(url);
  return !!host && LINK_ONLY.some(l => matches(host, l.domain) || host.split(".").includes(l.domain.split(".")[0]));
}

/** A documented API endpoint we may call under its own terms. */
export function apiTerms(url: string) {
  const host = hostOf(url);
  return host ? API_TERMS[host] || null : null;
}

/** The same page under small URL variations (www., trailing slash, #fragment, utm_ tracking) gets one key. */
export function urlKey(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k)) u.searchParams.delete(k);
    const q = u.searchParams.toString();
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${q ? "?" + q : ""}`;
  } catch { return url; }
}

/** Organisation key for "independent sources": the registrable-ish domain (last two labels, three for .com.my etc.). */
export function domainKey(url: string): string {
  const host = hostOf(url) || url;
  const parts = host.replace(/^www\./, "").split(".");
  const n = /^(com|co|gov|org|net|edu)$/.test(parts[parts.length - 2] || "") && (parts[parts.length - 1] || "").length === 2 ? 3 : 2;
  const key = parts.slice(-n).join(".");
  // Same organisation under different hosts
  return ({ "bbci.co.uk": "bbc", "bbc.co.uk": "bbc", "bbc.com": "bbc", "deepmind.google": "google", "blog.google": "google" } as Record<string, string>)[key] || key;
}
