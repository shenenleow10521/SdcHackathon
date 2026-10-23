// CV intake pipeline: extraction, matching, AI guardrails and fallbacks, PDF handling, embedding providers.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { testServices } from "./helpers/services.ts";
import { extractDraft, verifyEvidence } from "../server/agents/cv.ts";
import { buildQuestions } from "../server/agents/interviewer.ts";
import { candidates, loadSkillCatalog, matchOccupation, basicCandidates } from "../server/services/matching.ts";
import { extractPdfText } from "../server/lib/pdf.ts";
import { createEmbedder, GEMINI_MODEL_LABEL } from "../server/lib/embedder.ts";
import { createMockEmbedder, type Embedder } from "../server/lib/embed.ts";
import { createGeminiLlm, createMockLlm, LlmUnavailableError } from "../server/lib/llm.ts";
import { makePdf } from "./fixtures/cv/make-pdf.ts";
import { cvLlmHandler } from "./fixtures/cv/mock-llm.ts";

const cv = (name: string) => readFileSync(new URL(`./fixtures/cv/${name}.txt`, import.meta.url), "utf8");
const PRIYA = cv("priya-nair");

describe("CV extractor (mocked AI model, bag-of-words embeddings)", () => {
  it("happy path: scrubbed text goes to the model, skills come back with checked evidence", async () => {
    const llm = createMockLlm(cvLlmHandler());
    const svc = await testServices({ llm, embed: createMockEmbedder(512) });
    const r = await extractDraft(svc, PRIYA);

    // The model never sees personal details.
    for (const call of llm.calls) for (const pii of ["Priya", "345 6789", "880412", "Jalan Bunga", "Hindu", "Female"]) expect(call.user).not.toContain(pii);
    expect(r.providers).toEqual({ llm: "mock-main", embed: "mock", matching: "semantic" });
    expect(r.scrubbed.removed).toEqual(expect.arrayContaining(["name", "phone", "email", "id", "address", "protected_attribute"]));

    const ids = r.draft.skills.map(s => s.skillId);
    expect(ids).toEqual(expect.arrayContaining(["three", "pay", "recon"]));
    for (const s of r.draft.skills) {
      expect(s.confidence).toBe("cv");
      expect(s.level).toBeGreaterThanOrEqual(1);
      expect(s.level).toBeLessThanOrEqual(5);
      expect(s.evidence && PRIYA.toLowerCase().includes(s.evidence.toLowerCase().replace(/…$/, ""))).toBeTruthy();
      expect(s.evidence!.length).toBeLessThanOrEqual(200);
    }
    expect(r.draft.skills.find(s => s.skillId === "three")!.level).toBe(5);
    expect(r.draft.occupation).toEqual({ id: "ap", title: "Accounts Payable Clerk", confidence: "high", matchedFrom: "Senior Accounts Payable Executive" });
  });

  it("each phrase may only pick from its own candidates: the enum given to the model rejects anything else", async () => {
    const llm = createMockLlm(cvLlmHandler());
    const svc = await testServices({ llm, embed: createMockEmbedder(512) });
    await extractDraft(svc, PRIYA);
    const pick = llm.calls[1];
    const p0 = (pick.schema as any).shape.p0;
    const offered = /p0: ".*"\n((?: {2}- .*\n?)+)/.exec(pick.user)![1].match(/- ([\w-]+):/g)!.map(s => s.slice(2, -1));
    expect(p0.safeParse({ skillId: offered[0], level: 3, evidence: "x", sure: true, shownInUse: true }).success).toBe(true);
    expect(p0.safeParse({ skillId: "none", level: 1, evidence: "", sure: false, shownInUse: true }).success).toBe(true);
    expect(p0.safeParse({ skillId: "invented_skill", level: 3, evidence: "x", sure: true, shownInUse: true }).success).toBe(false);
    expect(p0.safeParse({ skillId: offered[0], level: 9, evidence: "x", sure: true, shownInUse: true }).success).toBe(false);
    expect((pick.schema as any).shape.occupationId.safeParse("ceo").success).toBe(false);
  });

  it("a model that invents an id is rejected by the real wrapper, and intake falls back to basic matching", async () => {
    const base = await testServices({ embed: createMockEmbedder(512) });
    let calls = 0;
    const fakeGemini = (async (_url: any, init: any) => {
      calls++;
      const body = JSON.parse(init.body);
      const isSplit = /list the person's work experience/.test(body.systemInstruction.parts[0].text);
      const data = isSplit ? { jobTitle: "AP Executive", phrases: ["Perform three-way matching of purchase orders"] }
                           : { occupationId: "ap", p0: { skillId: "invented_skill", level: 5, evidence: "x", sure: true } };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const svc = { ...base, llm: createGeminiLlm({ db: base.db, keys: ["test-key"], fetch: fakeGemini }) };
    const r = await extractDraft(svc, PRIYA);
    expect(calls).toBeGreaterThan(2); // retried, then gave up on the bad output
    expect(r.providers.llm).toBe("unavailable");
    expect(r.providers.matching).toBe("basic");
    const known = new Set((await loadSkillCatalog(svc.db)).map(s => s.id));
    expect(r.draft.skills.every(s => known.has(s.skillId))).toBe(true);
  });

  it("evidence that is not in the CV is dropped and the skill is marked unsure", async () => {
    const llm = createMockLlm(cvLlmHandler({ evidence: () => "Led a team of 50 auditors at a Big Four firm" }));
    const svc = await testServices({ llm, embed: createMockEmbedder(512) });
    const r = await extractDraft(svc, PRIYA);
    expect(r.draft.skills.length).toBeGreaterThan(0);
    for (const s of r.draft.skills) {
      expect(s.evidence).toBeNull();
      expect(s.evidenceDropped).toBe(true);
      expect(s.sure).toBe(false);
    }
  });

  it("AI model down: basic keyword matching still produces a draft, clearly labelled", async () => {
    const svc = await testServices({ llmHandler: () => new LlmUnavailableError("down"), embed: createMockEmbedder(512) });
    const r = await extractDraft(svc, PRIYA);
    expect(r.providers).toEqual({ llm: "unavailable", embed: "mock", matching: "basic" });
    const ids = r.draft.skills.map(s => s.skillId);
    expect(ids).toEqual(expect.arrayContaining(["inv", "three", "pay", "recon", "erp"]));
    expect(r.draft.skills.every(s => s.level === 2 && !s.sure)).toBe(true);
    expect(r.draft.occupation.id).toBe("ap");
  });

  it("other errors are not hidden by the fallback", async () => {
    const svc = await testServices({ llmHandler: () => new Error("bug"), embed: createMockEmbedder(512) });
    await expect(extractDraft(svc, PRIYA)).rejects.toThrow("bug");
  });

  it("evidence check ignores case, quotes, dashes and spacing, and caps length", () => {
    const text = "Prepare weekly payment runs and check cash before release.\nUsed SAP – daily";
    expect(verifyEvidence(text, "prepare  weekly payment runs")).toBe("Prepare weekly payment runs");
    expect(verifyEvidence(text, "Used SAP - daily")).toBe("Used SAP - daily");
    expect(verifyEvidence(text, "Approved budgets")).toBeNull();
    expect(verifyEvidence(text, "SAP")).toBeNull(); // too short to count as evidence
    expect(verifyEvidence("x ".repeat(10) + "a".repeat(300), "a".repeat(250))!.length).toBe(200);
  });
});

describe("matching", () => {
  it("semantic candidates: top 5 per phrase, skill vectors made with the active model only", async () => {
    const svc = await testServices({ embed: createMockEmbedder(512) });
    await svc.db.query("update skills set embedding='[1,0,0]', embedding_model='some-other-model'");
    const r = await candidates(svc, ["Perform three-way matching of purchase orders, invoices and goods receipts"]);
    expect(r.matching).toBe("semantic");
    expect(r.phrases[0].candidates).toHaveLength(5);
    // The bag-of-words mock is crude (seed aliases shift its ranking), so only require "three" among the candidates.
    expect(r.phrases[0].candidates.map((c: any) => c.skillId)).toContain("three");
    const models = (await svc.db.query("select distinct embedding_model from skills")).rows.map((x: any) => x.embedding_model);
    expect(models).toEqual(["mock-bow"]); // old vectors from another model were replaced, never compared
  });

  it("embedding failure falls back to keyword matching, reported as basic", async () => {
    const broken: Embedder = { ...createMockEmbedder(), embed: async () => { throw new Error("RunPod HTTP 503"); } };
    const svc = await testServices({ embed: broken });
    const r = await candidates(svc, ["Prepare weekly payment runs"]);
    expect(r.matching).toBe("basic");
    expect(r.embedError).toContain("503");
    expect(r.phrases[0].candidates[0].skillId).toBe("pay");
  });

  it("basic matching uses labels, aliases (incl. the bracketed part of a label) and task words", async () => {
    const svc = await testServices();
    const skills = await loadSkillCatalog(svc.db);
    expect(basicCandidates(skills, "Daily postings in SAP")[0].skillId).toBe("erp");
    expect(basicCandidates(skills, "Reconcile vendor statements to the ledger")[0].skillId).toBe("recon");
    expect(basicCandidates(skills, "Wrote SQL queries for routine reports")[0].skillId).toBe("sql");
    expect(basicCandidates(skills, "Sang in the office choir")).toEqual([]);
  });

  it("occupation matching by title words, else 'other'", async () => {
    const svc = await testServices();
    expect((await matchOccupation(svc, "Senior Accounts Payable Executive")).id).toBe("ap");
    expect((await matchOccupation(svc, "Data Analyst")).confidence).toBe("high");
    expect(await matchOccupation(svc, "Store Supervisor")).toMatchObject({ id: "other", confidence: "low" });
  });
});

describe("interviewer", () => {
  const draft = (skills: any[], occupation = "ap") => ({
    occupation: { id: occupation, title: "", confidence: "high" as const, matchedFrom: null }, skills, unmatched: [], nearMisses: ["aiinv"],
  });
  const s = (skillId: string, level: number, sure: boolean) => ({ skillId, label: skillId, level, confidence: "cv" as const, evidence: null, sure });

  it("asks at most 3 questions: hours first if missing, then unsure skills (highest level first)", async () => {
    const svc = await testServices();
    const qs = await buildQuestions(svc, draft([s("pay", 2, false), s("recon", 4, false), s("three", 5, true), s("inv", 3, false)]), { hoursGiven: false });
    expect(qs.map(q => q.id)).toEqual(["hours", "skill:recon", "skill:inv"]);
    expect(qs[0].options.map(o => o.value)).toContain(6);
    expect(qs[1].options.map(o => o.value)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("no questions about skills the CV made clear; gaps come from the job's requirements, then near-misses", async () => {
    const svc = await testServices();
    expect(await buildQuestions(svc, draft([s("three", 5, true)]), { hoursGiven: true })).toEqual([
      expect.objectContaining({ id: "skill:aiinv", skillId: "aiinv" }),
    ]);
    const stay = await buildQuestions(svc, draft([s("three", 5, true)], "stayRole"), { hoursGiven: true });
    expect(stay.map(q => q.id)).toEqual(["skill:aiinv", "skill:dispute", "skill:erp"]);
  });

  it("speaks Bahasa Melayu when asked", async () => {
    const svc = await testServices();
    const qs = await buildQuestions(svc, draft([s("pay", 2, false)]), { hoursGiven: false, lang: "ms" });
    expect(qs[0].text).toMatch(/jam seminggu/);
    expect(qs[1].text).toMatch(/CV anda/);
  });
});

describe("PDF extraction", () => {
  it("reads text from a real PDF (the synthetic Priya CV)", async () => {
    const buf = readFileSync(new URL("./fixtures/cv/priya-nair.pdf", import.meta.url));
    const r = await extractPdfText(buf);
    expect(r.pages).toBe(1);
    expect(r.text).toContain("three-way matching");
  });
  it("rejects non-PDFs, oversize files, PDFs without text and damaged PDFs with friendly messages", async () => {
    await expect(extractPdfText(Buffer.from("hello, this is not a pdf"))).rejects.toMatchObject({ status: 400, code: "not_pdf" });
    await expect(extractPdfText(Buffer.alloc(5 * 1024 * 1024 + 1, 0x25))).rejects.toMatchObject({ status: 413, code: "too_large" });
    await expect(extractPdfText(makePdf([]))).rejects.toMatchObject({ status: 400, code: "pdf_no_text", message: expect.stringMatching(/paste your CV text/) });
    await expect(extractPdfText(Buffer.from("%PDF-1.4\nthis is garbage"))).rejects.toMatchObject({ status: 400, code: "pdf_unreadable" });
  });
});

describe("embedding providers", () => {
  const vec = (n: number, x: number) => Array.from({ length: n }, (_, i) => (i === 0 ? x : 0.01));

  it("Gemini: batches, rotates keys on 429, caches by model + text hash", async () => {
    const { db } = await testServices();
    const seen: { key: string; n: number }[] = [];
    const f = (async (url: any, init: any) => {
      expect(String(url)).toContain("gemini-embedding-001:batchEmbedContents");
      const key = init.headers["x-goog-api-key"], body = JSON.parse(init.body);
      seen.push({ key, n: body.requests.length });
      expect(body.requests[0].outputDimensionality).toBe(768);
      if (key === "k1") return new Response("{}", { status: 429 });
      return new Response(JSON.stringify({ embeddings: body.requests.map((_: any, i: number) => ({ values: vec(768, i + 1) })) }), { status: 200 });
    }) as unknown as typeof fetch;
    const e = createEmbedder({ GEMINI_API_KEY: "k1", GEMINI_API_KEY_2: "k2" } as any, db, { fetch: f });
    expect(e.provider).toBe("gemini");
    expect(e.model).toBe(GEMINI_MODEL_LABEL);
    const a = await e.embed(["alpha", "beta", "alpha"]);
    expect(a[0]).toEqual(a[2]);
    expect(seen).toEqual([{ key: "k1", n: 2 }, { key: "k2", n: 2 }]); // de-duplicated, then rotated
    await e.embed(["beta", "alpha"]);
    expect(seen).toHaveLength(2); // served from the cache
    expect(e.status()).toMatchObject({ provider: "gemini", configured: true, lastError: null });
  });

  it("local Infinity bge-m3: OpenAI-compatible URL, no auth header, vectors re-ordered by index", async () => {
    let req: any;
    const f = (async (url: any, init: any) => {
      req = { url: String(url), headers: init.headers, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ data: [{ index: 1, embedding: vec(1024, 2) }, { index: 0, embedding: vec(1024, 1) }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const e = createEmbedder({ LOCAL_EMBED_URL: "http://127.0.0.1:7997/", GEMINI_API_KEY: "k" } as any, undefined, { fetch: f });
    expect(e.provider).toBe("local-bge-m3");
    expect(e.model).toBe("BAAI/bge-m3");
    const out = await e.embed(["first", "second"]);
    expect(req.url).toBe("http://127.0.0.1:7997/embeddings");
    expect(req.headers.Authorization).toBeUndefined();
    expect(req.body).toEqual({ model: "BAAI/bge-m3", input: ["first", "second"] });
    expect(out[0][0]).toBe(1);
    expect(out[1][0]).toBe(2);
  });

  it("RunPod bge-m3 wins when configured: endpoint URL + bearer key, same model name as local", async () => {
    let req: any;
    const f = (async (url: any, init: any) => {
      req = { url: String(url), headers: init.headers };
      return new Response(JSON.stringify({ data: [{ index: 0, embedding: vec(1024, 1) }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const e = createEmbedder({ RUNPOD_API_KEY: "rp-key", RUNPOD_EMBED_ENDPOINT_ID: "abc123", LOCAL_EMBED_URL: "http://127.0.0.1:7997" } as any, undefined, { fetch: f });
    expect(e.provider).toBe("runpod-bge-m3");
    expect(e.model).toBe("BAAI/bge-m3");
    await e.embed(["x"]);
    expect(req.url).toBe("https://api.runpod.ai/v2/abc123/openai/v1/embeddings");
    expect(req.headers.Authorization).toBe("Bearer rp-key");
  });

  it("errors are reported in status() and make matching fall back to basic", async () => {
    const f = (async () => new Response("down", { status: 502 })) as unknown as typeof fetch;
    const e = createEmbedder({ LOCAL_EMBED_URL: "http://127.0.0.1:7997" } as any, undefined, { fetch: f });
    await expect(e.embed(["x"])).rejects.toThrow("HTTP 502");
    expect(e.status().lastError).toContain("502");
    const svc = await testServices({ embed: e });
    expect((await candidates(svc, ["Prepare weekly payment runs"])).matching).toBe("basic");
  });

  it("nothing configured: no embedder (basic matching)", () => {
    expect(createEmbedder({} as any).provider).toBe("none");
  });
});

describe("embedding provider choice", () => {
  const ok = (dims: number) => new Response(JSON.stringify({ data: [{ index: 0, embedding: new Array(dims).fill(0.1) }] }), { status: 200 });
  it("EMBED_PROVIDER forces a provider, and RunPod fails over to local bge-m3", async () => {
    const { createEmbedder } = await import("../server/lib/embedder.ts");
    const seen: string[] = [];
    const fetchFn = (async (url: string) => {
      seen.push(new URL(url).host);
      if (url.includes("runpod")) throw new Error("cold worker");
      return ok(1024);
    }) as any;
    const env = { run_pod_key: "rpa_x", RUNPOD_EMBED_ENDPOINT_ID: "ep", LOCAL_EMBED_URL: "http://127.0.0.1:7997", gemini_key: "g" } as any;
    const auto = createEmbedder(env, undefined, { fetch: fetchFn });
    expect(auto.provider).toBe("runpod-bge-m3");
    expect((await auto.embed(["vendor reconciliation"]))[0]).toHaveLength(1024);
    expect(seen).toEqual(["api.runpod.ai", "127.0.0.1:7997"]);
    expect(createEmbedder({ ...env, EMBED_PROVIDER: "gemini" }, undefined, { fetch: fetchFn }).provider).toBe("gemini");
    expect(createEmbedder({ ...env, EMBED_PROVIDER: "local" }, undefined, { fetch: fetchFn }).provider).toBe("local-bge-m3");
    expect(createEmbedder({ ...env, EMBED_PROVIDER: "none" }, undefined, { fetch: fetchFn }).provider).toBe("none");
  });
});

describe("skills that are only listed", () => {
  it("are capped at level 2 and marked not sure, even if the model rates them higher", async () => {
    const { extractDraft } = await import("../server/agents/cv.ts");
    const svc = await testServices({
      embed: createMockEmbedder(512),
      llmHandler: (req: any) => {
        if (req.user.includes("Phrases and their candidate skills")) {
          const out: any = { occupationId: "dataRole" };
          for (const m of req.user.matchAll(/^(p\d+): "(.*)"\n {2}- ([\w-]+):/gm))
            out[m[1]] = { skillId: m[3], level: 5, evidence: "", sure: true, shownInUse: false };
          return out;
        }
        return { jobTitle: "Data Analyst", phrases: ["Top skills: Python, SQL, Tableau"] };
      },
    });
    const r = await extractDraft(svc, "Data Analyst\nTop skills: Python, SQL, Tableau");
    expect(r.draft.skills.length).toBeGreaterThan(0);
    for (const s of r.draft.skills) { expect(s.level).toBeLessThanOrEqual(2); expect(s.sure).toBe(false); }
  });
});

describe("skills only claimed in a skills list, summary or headline (benchmark fix)", () => {
  it("finds quotes under a summary or a skills list, but not duty bullets", async () => {
    const { inListedSection } = await import("../server/agents/cv.ts");
    const text = "SUMMARY\nAnalyst with 5 years in AP, strong in SAP.\nSKILLS\nPython, SQL, Tableau, Excel\n• Reconciled 40 vendor statements every month for the regional team\nEXPERIENCE\n- Built SQL reports for finance every month";
    expect(inListedSection(text, "strong in SAP")).toBe(true);
    expect(inListedSection(text, "Python, SQL, Tableau")).toBe(true);
    expect(inListedSection(text, "Reconciled 40 vendor statements every month")).toBe(false); // long duty line (two-column PDF text)
    expect(inListedSection(text, "Built SQL reports for finance")).toBe(false);
    expect(inListedSection("Clerk\nSkills: SAP, AutoCount", "SAP, AutoCount")).toBe(true);
    expect(inListedSection(text, null)).toBe(false);
    // Any other heading ends the section, even when worded differently ("WORKING EXPERIENCE").
    const priya = "CAREER SUMMARY\n11 yrs in accounts payable.\n\nWORKING EXPERIENCE\n - Monthly vendor statement reconciliation to the ledger\nSKILLS\n - Power BI dashboards (basic)\n - Python for data analysis (beginner, online course)";
    expect(inListedSection(priya, "Monthly vendor statement reconciliation")).toBe(false);
    expect(inListedSection(priya, "Power BI dashboards (basic)")).toBe(true);
    expect(inListedSection(priya, "Python for data analysis")).toBe(true);
    expect(inListedSection(priya, "11 yrs in accounts payable")).toBe(true);
  });

  it("caps a skill at level 2 when the quote comes from a skills list, even if the model says it was shown in use", async () => {
    const { extractDraft } = await import("../server/agents/cv.ts");
    const svc = await testServices({
      embed: createMockEmbedder(512),
      llmHandler: (req: any) => {
        if (req.user.includes("Phrases and their candidate skills")) {
          const out: any = { occupationId: "dataRole" };
          for (const m of req.user.matchAll(/^(p\d+): "(.*)"\n {2}- ([\w-]+):/gm))
            out[m[1]] = { skillId: m[3], level: 4, evidence: m[2], sure: true, shownInUse: true };
          return out;
        }
        return { jobTitle: "Data Analyst", phrases: ["Python, SQL, Tableau, Power BI dashboards"] };
      },
    });
    const r = await extractDraft(svc, "Data Analyst\nTOP SKILLS\nPython, SQL, Tableau, Power BI dashboards\nEXPERIENCE\nData Analyst, 2021 - now");
    expect(r.draft.skills.length).toBeGreaterThan(0);
    for (const s of r.draft.skills) { expect(s.level).toBeLessThanOrEqual(2); expect(s.sure).toBe(false); }
  });
});

describe("ESCO skills per phrase", () => {
  it("the model may pick up to MAX_ESCO_PER_PHRASE (3) ESCO skills for one phrase, and no more", async () => {
    const { extractDraft, MAX_ESCO_PER_PHRASE } = await import("../server/agents/cv.ts");
    expect(MAX_ESCO_PER_PHRASE).toBe(3);
    // A stand-in with the same model name as the stored ESCO vectors, so ESCO retrieval runs (no network).
    const fakeBge: Embedder = {
      provider: "runpod-bge-m3", model: "BAAI/bge-m3",
      embed: async ts => ts.map(t => Array.from({ length: 1024 }, (_, d) => Math.sin(d * 0.37 + t.length))),
      status: () => ({ provider: "runpod-bge-m3", model: "BAAI/bge-m3", configured: true, lastError: null }),
    };
    let schema: any = null;
    const svc = await testServices({
      embed: fakeBge,
      llmHandler: (req: any) => {
        if (req.user.includes("Phrases and their candidate skills")) {
          schema = req.schema;
          return { occupationId: "ap", p0: { skillId: "none", level: 3, evidence: "", sure: true, shownInUse: true, escoIds: ["e0_0", "e0_1", "e0_2"] } };
        }
        return { jobTitle: "AP Clerk", phrases: ["Matched supplier invoices to purchase orders and goods received notes"] };
      },
    });
    const r = await extractDraft(svc, "AP Clerk\nEXPERIENCE\n- Matched supplier invoices to purchase orders and goods received notes");
    expect(r.draft.escoSkills).toHaveLength(3);
    const p0 = schema.shape.p0;
    const base = { skillId: "none", level: 3, evidence: "", sure: true, shownInUse: true };
    expect(p0.safeParse({ ...base, escoIds: ["e0_0", "e0_1", "e0_2"] }).success).toBe(true);
    expect(p0.safeParse({ ...base, escoIds: ["e0_0", "e0_1", "e0_2", "e0_3"] }).success).toBe(false);
  }, 30000);
});

describe("long CVs", () => {
  it("send the skill picks in chunks of 20 phrases (one large schema is rejected by Gemini) and merge them", async () => {
    const { extractDraft } = await import("../server/agents/cv.ts");
    const phrases = Array.from({ length: 25 }, (_, i) => `Reconciled vendor statements batch ${i} against the ledger`);
    let pickCalls = 0;
    const svc = await testServices({
      embed: createMockEmbedder(512),
      llmHandler: (req: any) => {
        if (req.user.includes("Phrases and their candidate skills")) {
          pickCalls++;
          const out: any = { occupationId: "ap" };
          for (const m of req.user.matchAll(/^(p\d+): "(.*)"\n {2}- ([\w-]+):/gm))
            out[m[1]] = { skillId: m[3], level: m[1] === "p22" ? 5 : 2, evidence: m[2], sure: true, shownInUse: true };
          return out;
        }
        return { jobTitle: "AP Clerk", phrases };
      },
    });
    const r = await extractDraft(svc, "AP Clerk\nEXPERIENCE\n" + phrases.map(p => `- ${p}`).join("\n"));
    expect(pickCalls).toBe(2);
    expect(Math.max(...r.draft.skills.map(s => s.level))).toBe(5); // p22 came from the second chunk
    expect(r.draft.occupation.id).toBe("ap");
  });
});
