// CV intake from scans and photos: file routing (text PDF, scanned PDF, image), local OCR, the low-confidence review step.
// Unit tests mock the OCR engine (vi.mock replaces tesseractOcr for the whole file); the last block runs the real
// tesseract.js engine via vi.importActual on small fixtures, and is skipped if the vendored tessdata is missing.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { readFileSync, existsSync } from "node:fs";
import { extractCvText } from "../server/lib/extract.ts";
import { imageInfo, tidyOcrText, type OcrEngine } from "../server/lib/ocr.ts";
import { makePdf } from "./fixtures/cv/make-pdf.ts";
import { makeScanPdf, scanJpeg } from "./fixtures/cv/make-scan-pdf.ts";

// The route's OCR engine, replaced for this file; ocrMock sets what it "reads".
const ocrMock = vi.hoisted(() => ({ text: "", confidence: 90 }));
vi.mock("../server/lib/ocr.ts", async orig => ({
  ...(await orig<typeof import("../server/lib/ocr.ts")>()),
  tesseractOcr: async () => ({ text: ocrMock.text, confidence: ocrMock.confidence }),
}));

const fx = (name: string) => readFileSync(new URL(`./fixtures/cv/${name}`, import.meta.url));
const PRIYA = fx("priya-nair.txt").toString("utf8");
const PRIYA_PDF = fx("priya-nair.pdf");
const SCAN_PNG = fx("priya-scan.png");
const SCAN_JPG = scanJpeg();

/** A fake OCR engine that records what it was given. */
function fakeOcr(text = PRIYA, confidence = 91) {
  const calls: Buffer[][] = [];
  const engine: OcrEngine = async images => { calls.push(images); return { text, confidence }; };
  return Object.assign(engine, { calls });
}

describe("CV file routing (OCR mocked)", () => {
  it("a PDF with a text layer uses the text layer, not OCR", async () => {
    const ocr = fakeOcr();
    const r = await extractCvText([{ buffer: PRIYA_PDF }], ocr);
    expect(r.source).toBe("pdf");
    expect(r.ocr).toBeUndefined();
    expect(r.text).toContain("Accounts Payable");
    expect(ocr.calls).toHaveLength(0);
  });

  it("a scanned PDF: the page images go to OCR (first 3 pages only)", async () => {
    const ocr = fakeOcr();
    const r = await extractCvText([{ buffer: makeScanPdf([SCAN_JPG, SCAN_JPG, SCAN_JPG, SCAN_JPG]) }], ocr);
    expect(r.source).toBe("ocr");
    expect(r.ocr).toEqual({ kind: "pdf", confidence: 91, lowConfidence: false, pagesRead: 3, pagesTotal: 4 });
    expect(ocr.calls[0]).toHaveLength(3);
    const img = ocr.calls[0][0];
    expect(img.subarray(0, 2).toString("latin1")).toBe("P5"); // grey PGM made from the page image
    expect(img.toString("latin1", 0, 20)).toMatch(/^P5\n1240 778\n255\n/);
  });

  it("a PDF with neither text nor a page image gets a clear message", async () => {
    const ocr = fakeOcr();
    await expect(extractCvText([{ buffer: makePdf([]) }], ocr)).rejects.toMatchObject({ status: 400, code: "pdf_scan_unreadable", message: expect.stringMatching(/photo \(JPG or PNG\) of each page, or paste/) });
    expect(ocr.calls).toHaveLength(0);
  });

  it("photos (PNG, JPG) go to OCR in order, up to 3", async () => {
    const ocr = fakeOcr();
    const r = await extractCvText([{ buffer: SCAN_PNG }, { buffer: SCAN_JPG }], ocr);
    expect(r).toMatchObject({ source: "ocr", ocr: { kind: "image", pagesRead: 2, pagesTotal: 2 } });
    expect(ocr.calls[0]).toEqual([SCAN_PNG, SCAN_JPG]);
    await expect(extractCvText([1, 2, 3, 4].map(() => ({ buffer: SCAN_PNG })), ocr)).rejects.toMatchObject({ code: "too_many_files" });
    await expect(extractCvText([{ buffer: SCAN_PNG }, { buffer: PRIYA_PDF }], ocr)).rejects.toMatchObject({ code: "too_many_files" });
  });

  it("low OCR confidence is flagged; too little text and odd files are rejected with friendly messages", async () => {
    expect((await extractCvText([{ buffer: SCAN_PNG }], fakeOcr(PRIYA, 62))).ocr).toMatchObject({ confidence: 62, lowConfidence: true });
    await expect(extractCvText([{ buffer: SCAN_PNG }], fakeOcr("Priya", 90))).rejects.toMatchObject({ code: "ocr_no_text" });
    await expect(extractCvText([{ buffer: SCAN_PNG }], fakeOcr(PRIYA, 25))).rejects.toMatchObject({ code: "ocr_unreadable" }); // mostly noise
    await expect(extractCvText([{ buffer: Buffer.from("PK\x03\x04 a word file"), originalname: "cv.docx" }], fakeOcr())).rejects.toMatchObject({ code: "unsupported_file", message: expect.stringMatching(/PDF, JPG and PNG/) });
    await expect(extractCvText([{ buffer: Buffer.from("not a pdf"), originalname: "cv.pdf" }], fakeOcr())).rejects.toMatchObject({ code: "not_pdf" });
    // A PNG header claiming 10000 x 10000 pixels is refused before anything decodes it.
    const huge = Buffer.from(SCAN_PNG); huge.writeUInt32BE(10000, 16); huge.writeUInt32BE(10000, 20);
    await expect(extractCvText([{ buffer: huge }], fakeOcr())).rejects.toMatchObject({ code: "image_too_large" });
  });

  it("reads image sizes from headers and tidies OCR text", () => {
    expect(imageInfo(SCAN_PNG)).toEqual({ type: "png", width: 1240, height: 778 });
    expect(imageInfo(SCAN_JPG)).toEqual({ type: "jpeg", width: 1240, height: 778 });
    expect(imageInfo(Buffer.from("%PDF-1.4"))).toBeNull();
    expect(tidyOcrText("Priya  Nair \r\n\n\n\nSKILLS\t\t SAP \n")).toBe("Priya Nair\n\nSKILLS SAP");
  });
});

describe("POST /api/profile/intake with scans (OCR mocked)", () => {
  let app: any, svc: any;
  beforeAll(async () => {
    const { createApp } = await import("../server/app.ts");
    const { testServices } = await import("./helpers/services.ts");
    const { createMockLlm } = await import("../server/lib/llm.ts");
    const { createMockEmbedder } = await import("../server/lib/embed.ts");
    const { cvLlmHandler } = await import("./fixtures/cv/mock-llm.ts");
    svc = await testServices({ llm: createMockLlm(cvLlmHandler()), embed: createMockEmbedder(512) });
    app = createApp(svc);
  });

  it("a clear photo goes through the same scrub and pipeline as pasted text", async () => {
    Object.assign(ocrMock, { text: PRIYA, confidence: 91 });
    const res = await request(app).post("/api/profile/intake").attach("cv", SCAN_PNG, "cv.png").field("hours", "6");
    expect(res.status).toBe(201);
    expect(res.body.ocr).toMatchObject({ kind: "image", confidence: 91, lowConfidence: false });
    expect(res.body.scrubbed.removed).toEqual(expect.arrayContaining(["name", "phone", "email"]));
    expect(res.body.draft.skills.length).toBeGreaterThan(3);
    for (const call of svc.llm.calls) for (const pii of ["Priya", "345 6789", "880412", "Hindu"]) expect(call.user).not.toContain(pii);
  });

  it("a shaky scan comes back for review: no profile saved, no AI call", async () => {
    Object.assign(ocrMock, { text: PRIYA, confidence: 55 });
    const before = svc.llm.calls.length;
    const count = async () => Number((await svc.db.query("select count(*)::int as n from profiles")).rows[0].n);
    const profiles = await count();
    const res = await request(app).post("/api/profile/intake").attach("cv", SCAN_JPG, "cv.jpg");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ needsReview: true, ocr: { confidence: 55, lowConfidence: true } });
    expect(res.body.text).toContain("Accounts Payable");
    expect(res.body.profileId).toBeUndefined();
    expect(svc.llm.calls.length).toBe(before);
    expect(await count()).toBe(profiles);
  });

  it("several photos in one upload, and friendly errors for too many files or unsupported types", async () => {
    Object.assign(ocrMock, { text: PRIYA, confidence: 90 });
    let res = await request(app).post("/api/profile/intake").attach("cv", SCAN_PNG, "p1.png").attach("cv", SCAN_JPG, "p2.jpg");
    expect(res.status).toBe(201);
    expect(res.body.ocr).toMatchObject({ pagesRead: 2 });
    res = await request(app).post("/api/profile/intake").attach("cv", SCAN_PNG, "1.png").attach("cv", SCAN_PNG, "2.png").attach("cv", SCAN_PNG, "3.png").attach("cv", SCAN_PNG, "4.png");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("too_many_files");
    res = await request(app).post("/api/profile/intake").attach("cv", Buffer.from("GIF89a....."), "cv.gif");
    expect(res.body.error.code).toBe("unsupported_file");
  });
});

// Real OCR on small generated fixtures (tests/fixtures/cv/make-scan.py). About 1 to 3 seconds each.
const TESSDATA = new URL("../server/lib/tessdata/eng.traineddata.gz", import.meta.url);
describe.skipIf(!existsSync(TESSDATA))("real local OCR (tesseract.js)", () => {
  let real: OcrEngine;
  beforeAll(async () => { real = (await vi.importActual<typeof import("../server/lib/ocr.ts")>("../server/lib/ocr.ts")).tesseractOcr; });
  afterAll(async () => { await (await vi.importActual<typeof import("../server/lib/ocr.ts")>("../server/lib/ocr.ts")).shutdownOcr(); });

  it("reads a scanned CV image with high confidence", async () => {
    const r = await extractCvText([{ buffer: SCAN_PNG }], real);
    expect(r.ocr!.confidence).toBeGreaterThan(80);
    for (const want of ["Accounts Payable Executive", "PROFESSIONAL SUMMARY", "Bayan Lepas", "priya.nair.sample@example.com"]) expect(r.text).toContain(want);
  });

  it("reads a scanned PDF (page image pulled out without a canvas)", async () => {
    const r = await extractCvText([{ buffer: makeScanPdf([SCAN_JPG]) }], real);
    expect(r.source).toBe("ocr");
    expect(r.ocr!.confidence).toBeGreaterThan(80);
    expect(r.text).toContain("Accounts Payable Executive");
  });
});
