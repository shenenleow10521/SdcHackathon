// arXiv API (Atom feed of preprints; free, no key; <= 1 request / 3 s per the API terms).
// The abstract is the text we extract from; the abs page is the link we cite.
import { XMLParser } from "fast-xml-parser";
import type { Services } from "../context.ts";
import { fetchApi } from "./fetch.ts";
import { type Query, type SourceResult, type SourceItem, toIsoDate, inWindow, clean } from "./types.ts";

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
const arr = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
const txt = (x: any): string => (x == null ? "" : typeof x === "object" ? String(x["#text"] ?? "") : String(x));

export function arxivQuery(q: Query): string {
  const terms = q.terms.filter(t => !/^(ai|artificial intelligence)$/i.test(t)).map(t => `all:"${t.replace(/"/g, "")}"`);
  // Restrict to AI papers: language models, agents or automation.
  return [...terms, `(abs:"language model" OR abs:LLM OR abs:agent OR abs:"generative AI")`].join(" AND ");
}

export function parseArxiv(body: string): { url: string; title: string; date: string | null; abstract: string }[] {
  const doc = xml.parse(body);
  return arr(doc?.feed?.entry).map((e: any) => ({
    url: txt(e.id).replace(/^http:/, "https:"),
    title: clean(txt(e.title)),
    date: toIsoDate(txt(e.published) || txt(e.updated)),
    abstract: clean(txt(e.summary)),
  }));
}

export async function searchArxiv(svc: Services, q: Query, since: Date): Promise<SourceResult> {
  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(arxivQuery(q))}&sortBy=submittedDate&sortOrder=descending&max_results=15`;
  const r = await fetchApi(svc, url);
  if (!r.ok) return { items: [], error: `arXiv: ${r.reason}` };
  let entries;
  try { entries = parseArxiv(r.body); } catch { return { items: [], error: "arXiv returned invalid XML" }; }
  const now = svc.now();
  const items: SourceItem[] = entries
    .filter(e => /^https:\/\/arxiv\.org\/abs\//.test(e.url) && e.abstract && inWindow(e.date, since, now))
    .map(e => ({ sourceKind: "arxiv", url: e.url, title: e.title, date: e.date!, text: `${e.title}\n${e.abstract}`, via: "arXiv" }));
  return { items };
}
