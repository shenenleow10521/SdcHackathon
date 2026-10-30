// The web and the AI as the scout sees them in tests (shared by scout and knowledge-api tests).
import { mockFetch, page, rss } from "./mock-net.ts";
import type { LlmRequest } from "../../../server/lib/llm.ts";

export const TC_FEED = "https://techcrunch.com/category/artificial-intelligence/feed/";
export const A = "https://www.reuters.com/technology/ai-dashboards-2026-10-21/";
export const B = "https://www.bbc.com/news/articles/ai-dashboards";
export const C = "https://techcrunch.com/2026/10/22/ai-reconciliation/";
export const D = "https://www.theverge.com/2026/10/22/ai-recon-clerks";

export const QA = "Microsoft said its new AI agent can build dashboards and refresh data feeds without an analyst.";
export const QB = "Several banks now let an AI assistant build dashboards for their managers.";
export const QC = "The startup's AI agents match statements to the ledger and post adjustments automatically.";

/** The web as the scout sees it in these tests. */
export function scoutNet() {
  return mockFetch([
    [TC_FEED, { body: rss([
      { title: "AI agents build dashboards", link: A, date: "2026-10-21T08:00:00Z" },
      { title: "Banks let AI build dashboards", link: B, date: "2026-10-20T08:00:00Z" },
      { title: "AI matches statements to the ledger", link: C, date: "2026-10-22T08:00:00Z" },
      { title: "Is AI replacing reconciliation clerks?", link: D, date: "2026-10-22T09:00:00Z" },
    ]), headers: { "content-type": "application/rss+xml" } }],
    [A, { body: page("AI agents build dashboards", [QA, "The dashboards update every morning. Analysts choose the right view for the audience.", "Filler text about dashboards. ".repeat(10)]) }],
    [B, { body: page("Banks let AI build dashboards", [QB, "Managers can refresh data feeds and dashboards on request.", "More text. ".repeat(20)]) }],
    [C, { body: page("AI matches statements to the ledger", [QC, "Reconciliation teams will now investigate unexplained differences instead.", "More text. ".repeat(20)]) }],
    [D, { body: page("Is AI replacing reconciliation clerks?", ["Vendor reconciliation tools with AI match statements to the ledger faster.", "Clerks still investigate unexplained differences.", "More text. ".repeat(20)]) }],
    [/.*/, { status: 404, body: "" }],
  ]);
}

/** One scripted vote answer. */
export const INCLUDE = { vote: "include", confidence: 0.9, reason: "Looks right" };
export const EXCLUDE = { vote: "exclude", confidence: 0.8, reason: "Not convincing" };
const isVoter = (req: LlmRequest<any>) => /three-person panel/.test(req.system);

/** Scripted AI: extraction by page. The voters include everything except the reconciliation quote QC, where only the evidence checker includes (1 of 3). */
export function scoutLlm(req: LlmRequest<any>) {
  if (isVoter(req)) return req.user.includes(QC) && !/EVIDENCE CHECKER/.test(req.system) ? EXCLUDE : INCLUDE;
  const u = req.user;
  if (u.includes(A)) return { findings: [{ nodeId: "viz", kind: "capability", direction: "up", magnitude: "small", quote: QA, claim: "AI builds dashboards" }] };
  if (u.includes(B)) return { findings: [{ nodeId: "viz", kind: "capability", direction: "up", magnitude: "small", quote: QB, claim: "AI builds dashboards" }] };
  if (u.includes(C)) return { findings: [{ nodeId: "recon", kind: "capability", direction: "up", magnitude: "large", quote: QC, claim: "AI reconciles" }] };
  if (u.includes(D)) return { findings: [{ nodeId: "recon", kind: "adoption", direction: "up", magnitude: "medium", quote: "AI has completely replaced all reconciliation clerks worldwide.", claim: "made up" }] };
  return { findings: [] };
}
