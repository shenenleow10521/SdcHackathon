// PDF text extraction for CV upload (OWNER: intake agent). Uses unpdf (a serverless build of Mozilla pdf.js).
// Checks: size <= 5 MB, starts with the %PDF magic bytes, not password-protected, has real text (not a scan).
// Every failure is a friendly 400 that tells the user they can paste their CV text instead.
// pdfScanImages() pulls the scanned page images out of a PDF with no text layer (pure JS, no canvas), for local OCR.
import { getDocumentProxy, extractText, getResolvedPDFJS } from "unpdf";
import { HttpError } from "./http.ts";

export const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MAX_PAGES = 15;     // a CV is a few pages; more than this is probably not a CV
const MIN_TEXT_CHARS = 80;

const fail = (code: string, message: string) => new HttpError(400, code, `${message} You can paste your CV text instead.`);

export async function extractPdfText(buf: Buffer | Uint8Array): Promise<{ text: string; pages: number }> {
  if (buf.length > MAX_PDF_BYTES) throw new HttpError(413, "too_large", "The PDF is larger than 5 MB. You can paste your CV text instead.");
  if (Buffer.from(buf.subarray(0, 5)).toString("latin1") !== "%PDF-") throw fail("not_pdf", "That file is not a PDF.");

  let pdf;
  try {
    // Copy the bytes: pdf.js takes ownership of (detaches) the array it is given.
    pdf = await getDocumentProxy(new Uint8Array(buf), { verbosity: 0, isEvalSupported: false } as any);
  } catch (e: any) {
    if (e?.name === "PasswordException") throw fail("pdf_encrypted", "This PDF is password-protected, so we can't read it.");
    throw fail("pdf_unreadable", "We couldn't read this PDF (it may be damaged).");
  }
  try {
    if (pdf.numPages > MAX_PAGES) throw fail("pdf_too_long", `This PDF has ${pdf.numPages} pages; we read CVs of up to ${MAX_PAGES} pages.`);
    const { text } = await extractText(pdf, { mergePages: true });
    const clean = String(text || "").replace(/\u0000/g, "").trim();
    if (clean.replace(/\s/g, "").length < MIN_TEXT_CHARS)
      throw fail("pdf_no_text", "This PDF has no readable text. It may be a scanned image.");
    return { text: clean, pages: pdf.numPages };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw fail("pdf_unreadable", "We couldn't read the text in this PDF.");
  } finally {
    // Free pdf.js memory (destroy() exists at runtime but is missing from unpdf's types).
    try { await (pdf as any).destroy?.(); } catch { /* ignore */ }
  }
}

/** Grey 8-bit PGM (P5) image: Tesseract reads it directly, and it needs no encoder. */
function toPgm(img: { width: number; height: number; kind?: number; data: Uint8Array | Uint8ClampedArray }): Buffer | null {
  const { width: w, height: h, data } = img;
  const head = Buffer.from(`P5
${w} ${h}
255
`, "latin1");
  const out = Buffer.alloc(head.length + w * h);
  head.copy(out);
  const px = out.subarray(head.length);
  const n = w * h;
  if (data.length === n * 3 || data.length === n * 4) {
    const ch = data.length / n;
    for (let i = 0; i < n; i++) px[i] = (data[i * ch] * 77 + data[i * ch + 1] * 150 + data[i * ch + 2] * 29) >> 8;
  } else if (data.length === n) {
    px.set(data);
  } else if (data.length === ((w + 7) >> 3) * h) {
    // pdf.js 1-bit images (fax-style scans): rows padded to whole bytes, bit 1 = white.
    const row = (w + 7) >> 3;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = data[y * row + (x >> 3)] & (0x80 >> (x & 7)) ? 255 : 0;
  } else return null;
  return out;
}

/**
 * For a PDF with no text layer: the largest image on each of the first `maxPages` pages, as grey PGM images.
 * Pages with no usable image (e.g. text drawn as vector shapes) are skipped.
 */
export async function pdfScanImages(buf: Buffer | Uint8Array, maxPages: number, maxPixels: number): Promise<{ images: Buffer[]; pagesTotal: number }> {
  const pdf = await getDocumentProxy(new Uint8Array(buf), { verbosity: 0, isEvalSupported: false } as any);
  try {
    const { OPS } = await getResolvedPDFJS();
    const images: Buffer[] = [];
    for (let p = 1; p <= Math.min(pdf.numPages, maxPages); p++) {
      const page = await pdf.getPage(p);
      const ops = await page.getOperatorList();
      let best: any = null;
      for (let i = 0; i < ops.fnArray.length; i++) {
        if (ops.fnArray[i] !== OPS.paintImageXObject) continue;
        const key = ops.argsArray[i][0] as string;
        const img: any = await new Promise(r => (key.startsWith("g_") ? page.commonObjs : page.objs).get(key, r));
        if (img?.data && img.width * img.height <= maxPixels && (!best || img.width * img.height > best.width * best.height)) best = img;
      }
      // Skip logos and icons: a scanned page is at least a few hundred pixels each way.
      const pgm = best && best.width >= 400 && best.height >= 300 ? toPgm(best) : null;
      if (pgm) images.push(pgm);
    }
    return { images, pagesTotal: pdf.numPages };
  } finally {
    try { await (pdf as any).destroy?.(); } catch { /* ignore */ }
  }
}
