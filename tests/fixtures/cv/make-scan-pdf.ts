// Builds a minimal "scanned" PDF: one page per JPEG, each drawn full-page, with no text layer (no dependencies).
import { readFileSync } from "node:fs";

/** Width and height from a baseline or progressive JPEG's SOF marker. */
function jpegSize(buf: Buffer): { width: number; height: number; gray: boolean } {
  let i = 2;
  while (i < buf.length) {
    const marker = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), gray: buf[i + 9] === 1 };
    i += 2 + len;
  }
  throw new Error("not a JPEG");
}

export function makeScanPdf(jpegs: Buffer[]): Buffer {
  const objects: (string | Buffer)[] = ["<< /Type /Catalog /Pages 2 0 R >>", ""];
  const kids: string[] = [];
  for (const jpg of jpegs) {
    const { width, height, gray } = jpegSize(jpg);
    const page = objects.length + 1, img = page + 1, content = page + 2;
    kids.push(`${page} 0 R`);
    const draw = `q 595 0 0 ${Math.round(595 * height / width)} 0 0 cm /Im0 Do Q`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 ${Math.round(595 * height / width)}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${content} 0 R >>`,
      Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /${gray ? "DeviceGray" : "DeviceRGB"} /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`, "latin1"), jpg, Buffer.from("\nendstream", "latin1")]),
      `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`,
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  let len = parts[0].length;
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(len);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), Buffer.isBuffer(o) ? o : Buffer.from(o, "latin1"), Buffer.from("\nendobj\n", "latin1")]);
    parts.push(b); len += b.length;
  });
  const trailer = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("")
    + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${len}\n%%EOF\n`;
  parts.push(Buffer.from(trailer, "latin1"));
  return Buffer.concat(parts);
}

export const scanJpeg = () => readFileSync(new URL("./priya-scan.jpg", import.meta.url));
