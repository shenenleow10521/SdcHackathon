// Local OCR for scanned CVs and photos (OWNER: intake agent). Runs on our server with tesseract.js (WebAssembly,
// in a Node worker thread, so the request thread stays free). Nothing is sent to any cloud service.
// Language data: English + Malay "best_int" models from tessdata (Apache-2.0, via the @tesseract.js-data packages),
// vendored in ./tessdata (about 4 MB) so there is no download at first use.
// One worker is kept warm and shut down after 2 idle minutes; jobs run one at a time.
import { createWorker, type Worker } from "tesseract.js";
import { fileURLToPath } from "node:url";
import { HttpError } from "./http.ts";

export const OCR_TIMEOUT_MS = 30_000;
export const OCR_MAX_PAGES = 3;
export const OCR_MAX_PIXELS = 40_000_000; // a 40 MP photo; larger is rejected before decoding
/** Below this mean word confidence (0 to 100) the user checks the text before we continue. */
export const OCR_LOW_CONFIDENCE = 80;
const IDLE_MS = 120_000;
const MAX_QUEUE = 4;
const LANG_PATH = fileURLToPath(new URL("./tessdata", import.meta.url));

export type OcrOutput = { text: string; confidence: number };
/** Reads images (PNG, JPEG or PGM bytes) in order and joins their text. Swappable in tests. */
export type OcrEngine = (images: Buffer[]) => Promise<OcrOutput>;

let worker: Promise<Worker> | null = null;
let idle: NodeJS.Timeout | undefined;
let chain: Promise<unknown> = Promise.resolve();
let queued = 0;

const getWorker = () => (worker ??= createWorker(["eng", "msa"], 1, { langPath: LANG_PATH, cacheMethod: "none", gzip: true }));

/** Stop the worker (frees about 100 MB). Safe to call at any time. */
export async function shutdownOcr() {
  clearTimeout(idle);
  const w = worker; worker = null;
  if (w) try { await (await w).terminate(); } catch { /* already gone */ }
}

async function run(images: Buffer[]): Promise<OcrOutput> {
  const w = await getWorker();
  const parts: { text: string; confidence: number }[] = [];
  for (const img of images) {
    const { data } = await w.recognize(img);
    parts.push({ text: data.text, confidence: data.confidence });
  }
  // Confidence of the whole document: pages weighted by how much text they hold.
  const chars = parts.reduce((n, p) => n + p.text.trim().length, 0);
  const confidence = chars ? parts.reduce((n, p) => n + p.confidence * p.text.trim().length, 0) / chars : 0;
  return { text: parts.map(p => p.text).join("\n\n"), confidence: Math.round(confidence) };
}

export const tesseractOcr: OcrEngine = images => {
  if (queued >= MAX_QUEUE) return Promise.reject(new HttpError(503, "ocr_busy", "Many scans are being read right now. Try again in a minute, or paste your CV text."));
  queued++;
  const job = chain.then(async () => {
    clearTimeout(idle);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new HttpError(400, "ocr_timeout",
        "Reading this scan took too long. Try a clearer photo of each page, or paste your CV text.")), OCR_TIMEOUT_MS);
    });
    try {
      return await Promise.race([run(images), timeout]);
    } catch (e) {
      await shutdownOcr(); // a stuck or broken worker is replaced on the next job
      throw e;
    } finally {
      clearTimeout(timer);
      queued--;
      idle = setTimeout(() => { void shutdownOcr(); }, IDLE_MS);
      idle.unref();
    }
  });
  chain = job.catch(() => undefined);
  return job;
};

/** PNG or JPEG size from the file header, without decoding the image. */
export function imageInfo(buf: Buffer): { type: "png" | "jpeg"; width: number; height: number } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString("latin1", 12, 16) === "IHDR")
    return { type: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    let i = 2;
    while (i + 9 < buf.length && buf[i] === 0xff) {
      const m = buf[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return { type: "jpeg", height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return { type: "jpeg", width: 0, height: 0 }; // a JPEG whose size we couldn't find; Tesseract decides
  }
  return null;
}

/** Drop stray spaces and runs of blank lines so OCR text reads like pasted text. */
export function tidyOcrText(s: string): string {
  return s.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
