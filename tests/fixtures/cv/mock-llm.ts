// A scripted stand-in for the two CV-extractor LLM calls, so intake tests run offline and deterministically.
// LLM #1 (split): returns each bullet line of the (already scrubbed) CV as a phrase.
// LLM #2 (pick): for each phrase, picks the candidate named in `prefer` (by regex on the phrase) if it is offered,
//                otherwise "none"; evidence = the phrase itself (a real quote from the CV).
import type { LlmRequest } from "../../../server/lib/llm.ts";

export const PRIYA_PREFER: [RegExp, string, number][] = [
  [/three-way matching/i, "three", 5],
  [/payment runs/i, "pay", 4],
  [/reconcile vendor statements/i, "recon", 4],
  [/invoice data entry/i, "inv", 5],
  [/SST/i, "tax", 3],
  [/vendor disputes/i, "dispute", 3],
  [/audit evidence/i, "audit", 4],
  [/pivot tables/i, "excel", 4],
];

export function cvLlmHandler(opts: { prefer?: [RegExp, string, number][]; jobTitle?: string; evidence?: (phrase: string) => string; occupationId?: string } = {}) {
  const prefer = opts.prefer || PRIYA_PREFER;
  return (req: LlmRequest<any>) => {
    const cv = (req.user.match(/<<<\n([\s\S]*?)\n>>>/) || [])[1] || "";
    if (/list the person's work experience/.test(req.system)) {
      const phrases = cv.split("\n").filter(l => /^\s*-\s+/.test(l)).map(l => l.replace(/^\s*-\s+/, "").trim());
      return { jobTitle: opts.jobTitle ?? "Senior Accounts Payable Executive", phrases };
    }
    // Pick call: parse "pN: "phrase"" followed by "  - id: label" lines.
    const out: Record<string, any> = { occupationId: opts.occupationId ?? "ap" };
    type Item = { key: string; phrase: string; ids: string[] };
    let cur: Item | null = null;
    const items: Item[] = [];
    for (const line of req.user.split("\n")) {
      const p = /^(p\d+): "(.*)"$/.exec(line);
      if (p) { cur = { key: p[1], phrase: p[2], ids: [] }; items.push(cur); continue; }
      const c = /^ {2}- ([\w-]+): /.exec(line);
      if (c && cur) cur.ids.push(c[1]);
    }
    for (const it of items) {
      const want = prefer.find(([re, id]) => re.test(it.phrase) && it.ids.includes(id));
      out[it.key] = want
        ? { skillId: want[1], level: want[2], evidence: opts.evidence ? opts.evidence(it.phrase) : it.phrase, sure: true,
            shownInUse: !/^(skills|tools|top skills|kemahiran)/i.test(it.phrase) }
        : { skillId: "none", level: 1, evidence: "", sure: false, shownInUse: false };
    }
    return out;
  };
}
