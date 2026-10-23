// PDF text extraction for CV upload (OWNER: intake agent). Uses unpdf (a serverless build of Mozilla pdf.js).
// Checks: size <= 5 MB, starts with the %PDF magic bytes, not password-protected, has real text (not a scan).
// Every failure is a friendly 400 that tells the user they can paste their CV text instead.
import { getDocumentProxy, extractText } from "unpdf";
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
