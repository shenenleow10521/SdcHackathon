// CV file -> plain text (OWNER: intake agent). Picks the path from the file's first bytes, not its name:
//   PDF with a text layer -> pdf.js text            (source "pdf")
//   PDF that is a scan    -> page images -> local OCR (source "ocr")
//   JPG / PNG photo(s)    -> local OCR               (source "ocr", up to 3 images, one per page)
// The text then goes through the same personal-details scrub as pasted text, before any AI model sees it.
import { HttpError } from "./http.ts";
import { extractPdfText, pdfScanImages } from "./pdf.ts";
import { tesseractOcr, imageInfo, tidyOcrText, OCR_MAX_PAGES, OCR_MAX_PIXELS, OCR_LOW_CONFIDENCE, type OcrEngine } from "./ocr.ts";

export type CvFile = { buffer: Buffer; originalname?: string; mimetype?: string };
export type OcrInfo = { kind: "image" | "pdf"; confidence: number; lowConfidence: boolean; pagesRead: number; pagesTotal: number };
export type CvText = { text: string; source: "pdf" | "ocr"; ocr?: OcrInfo };

const MIN_TEXT_CHARS = 80;
const OCR_UNREADABLE = 40; // mean word confidence (0 to 100)
const fail = (code: string, message: string) => new HttpError(400, code, message);
const isPdf = (b: Buffer) => b.subarray(0, 5).toString("latin1") === "%PDF-";

async function ocrText(ocr: OcrEngine, images: Buffer[], kind: OcrInfo["kind"], pagesTotal: number): Promise<CvText> {
  const r = await ocr(images);
  const text = tidyOcrText(r.text);
  if (text.replace(/\s/g, "").length < MIN_TEXT_CHARS)
    throw fail("ocr_no_text", "We couldn't find enough readable text in this scan. Try a sharper, well-lit photo, or paste your CV text.");
  // Below this the text is mostly noise, so asking the user to fix it is no help.
  if (r.confidence < OCR_UNREADABLE)
    throw fail("ocr_unreadable", "We couldn't read this scan clearly. Try a sharper, well-lit photo taken straight on, or paste your CV text.");
  return { text, source: "ocr", ocr: { kind, confidence: r.confidence, lowConfidence: r.confidence < OCR_LOW_CONFIDENCE, pagesRead: images.length, pagesTotal } };
}

export async function extractCvText(files: CvFile[], ocr: OcrEngine = tesseractOcr): Promise<CvText> {
  if (!files.length) throw fail("bad_request", 'No file received. Send a PDF, JPG or PNG in the field "cv", or paste your CV text.');
  const first = files[0].buffer;

  if (isPdf(first)) {
    if (files.length > 1) throw fail("too_many_files", "Send one PDF, or up to 3 photos (one per page).");
    try {
      return { ...(await extractPdfText(first)), source: "pdf" };
    } catch (e) {
      if (!(e instanceof HttpError) || e.code !== "pdf_no_text") throw e;
    }
    const { images, pagesTotal } = await pdfScanImages(first, OCR_MAX_PAGES, OCR_MAX_PIXELS).catch(() => ({ images: [], pagesTotal: 0 }));
    if (!images.length)
      throw fail("pdf_scan_unreadable", "This PDF has no text we can read. Upload a photo (JPG or PNG) of each page, or paste your CV text.");
    return ocrText(ocr, images, "pdf", pagesTotal);
  }

  if (files.length > OCR_MAX_PAGES) throw fail("too_many_files", `Send up to ${OCR_MAX_PAGES} photos (one per page), or paste your CV text.`);
  for (const f of files) {
    const info = imageInfo(f.buffer);
    if (!info) {
      if (isPdf(f.buffer)) throw fail("too_many_files", "Send one PDF, or up to 3 photos (one per page).");
      // Keep the old code for files named .pdf, so existing clients see the same error.
      if (/\.pdf$/i.test(f.originalname || "") || /pdf/i.test(f.mimetype || "")) throw fail("not_pdf", "That file is not a PDF. You can paste your CV text instead.");
      throw fail("unsupported_file", "We read PDF, JPG and PNG files. Upload one of those, or paste your CV text.");
    }
    if (info.width * info.height > OCR_MAX_PIXELS)
      throw fail("image_too_large", `This photo is too large (${Math.round(info.width * info.height / 1e6)} megapixels). Use a photo of up to ${OCR_MAX_PIXELS / 1e6} megapixels, or paste your CV text.`);
    if (info.width && (info.width < 300 || info.height < 300))
      throw fail("image_too_small", "This image is too small to read. Upload a clearer photo, or paste your CV text.");
  }
  return ocrText(ocr, files.map(f => f.buffer), "image", files.length);
}
