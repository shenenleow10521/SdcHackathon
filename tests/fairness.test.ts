// Fairness: the same CV with a different name, gender, age, religion, race, marital status or nationality must give
// exactly the same text to the AI model, and the same skills, levels, job matches and routes.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { testServices } from "./helpers/services.ts";
import { extractDraft } from "../server/agents/cv.ts";
import { createMockLlm, LlmUnavailableError } from "../server/lib/llm.ts";
import { createMockEmbedder } from "../server/lib/embed.ts";
import { loadGraph, engineGraph } from "../server/kb.ts";
import { createEngine } from "../shared/engine.js";
import { cvLlmHandler } from "./fixtures/cv/mock-llm.ts";

const BASE = readFileSync(new URL("./fixtures/cv/priya-nair.txt", import.meta.url), "utf8");
const body = "PROFESSIONAL SUMMARY" + BASE.split("\nPROFESSIONAL SUMMARY")[1];
const SYNTH = "SYNTHETIC SAMPLE CV - fictional person created for testing HalaTuju. Not real personal data.";

// The same layout as the original CV; only the personal details differ (all synthetic).
const make = (name: string | null, phone: string, email: string, link: string, details: string[]) =>
  [name, "Accounts Payable Executive", SYNTH, `Phone: ${phone} | Email: ${email}`, link, ...details, "", body].filter(l => l !== null).join("\n");

const VARIANTS: Record<string, string> = {
  original: BASE,
  "different name, male, Malay, Muslim, single": make("Ahmad Faizal bin Rahman", "019-876 5432", "faizal.sample@example.com", "linkedin.com/in/faizal-sample",
    ["No. 8, Lorong Melati 2, Taman Melati, 53100 Kuala Lumpur", "IC No: 790101-10-1234", "Date of Birth: 1 January 1979",
     "Gender: Male", "Race: Malay", "Religion: Islam", "Marital Status: Single"]),
  "Chinese, Buddhist, attributes on one line": make("TAN WEI MING", "+60 16-555 0101", "wm.tan.sample@example.com", "https://www.linkedin.com/in/tan-sample",
    ["Male | Chinese | Buddhist | Married | Malaysian"]),
  "Malay-language labels": make("Nur Aisyah binti Ahmad", "012-111 2222", "aisyah.sample@example.com", "linkedin.com/in/aisyah-sample",
    ["Alamat: Lot 5, Kampung Baru, 06000 Jitra, Kedah", "Umur: 52 tahun", "Jantina: Perempuan", "Bangsa: Melayu", "Agama: Islam",
     "Status Perkahwinan: Janda", "Warganegara: Malaysia"]),
  "no personal details at all": make(null, "04-222 3333", "ap.sample@example.com", "linkedin.com/in/ap-sample", []),
  "age stated inline, photo line": make("Priya Nair", "+60 12-345 6789", "priya.nair.sample@example.com", "linkedin.com/in/priya-nair-sample",
    ["[Photo]", "Female, 61 years old", "Nationality: Malaysian", "No. of children: 2"]),
};

async function run(text: string, llmDown = false) {
  const llm = createMockLlm(llmDown ? () => new LlmUnavailableError("down") : cvLlmHandler());
  const svc = await testServices({ llm, embed: createMockEmbedder(512) });
  const r = await extractDraft(svc, text);
  return { svc, sent: llm.calls.map(c => c.user), draft: r.draft };
}

describe("fairness: personal details never change the result", () => {
  it("the AI model receives identical text for every variant", async () => {
    const results = await Promise.all(Object.values(VARIANTS).map(v => run(v)));
    // The variant without a name line has no "[name]" placeholder; compare after removing that one marker.
    const norm = (s: string) => s.replace(/^\[name\]\n/m, "");
    for (const r of results.slice(1)) expect(r.sent.map(norm)).toEqual(results[0].sent.map(norm));
  });

  it("identical skills, levels, evidence and occupation (AI path)", async () => {
    const results = await Promise.all(Object.values(VARIANTS).map(v => run(v)));
    expect(results[0].draft.skills.length).toBeGreaterThan(3);
    for (const r of results.slice(1)) {
      expect(r.draft.skills).toEqual(results[0].draft.skills);
      expect(r.draft.occupation.id).toBe(results[0].draft.occupation.id);
    }
  });

  it("identical skills and levels when the AI model is down (basic path)", async () => {
    const results = await Promise.all(Object.values(VARIANTS).map(v => run(v, true)));
    for (const r of results.slice(1)) expect(r.draft.skills).toEqual(results[0].draft.skills);
  });

  it("identical job matches and routes from the scoring engine", async () => {
    const [a, b] = await Promise.all([run(VARIANTS.original), run(VARIANTS["different name, male, Malay, Muslim, single"])]);
    const g = engineGraph(await loadGraph(a.svc.db));
    const engineFor = (d: typeof a.draft) => createEngine(g, { occupationId: d.occupation.id, level: Object.fromEntries(d.skills.map(s => [s.skillId, s.level])), hours: 6 });
    const ea = engineFor(a.draft), eb = engineFor(b.draft);
    for (const job of ["stayRole", "esgRole", "faRole", "intAudit", "dataRole"]) {
      expect(eb.match(job)).toBe(ea.match(job));
      expect(eb.shortestPath(job, "fastest")?.key).toBe(ea.shortestPath(job, "fastest")?.key);
    }
  });
});
