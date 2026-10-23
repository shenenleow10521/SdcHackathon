// Builds a minimal, valid one-page PDF (Helvetica text, one line per string) with no dependencies.
// Used to create test fixtures; run `npx tsx tests/fixtures/cv/make-pdf.ts` to regenerate the .pdf files.
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function makePdf(lines: string[]): Buffer {
  // PDF string literals need (, ) and \ escaped; keep to Latin-1 characters.
  const esc = (s: string) => s.replace(/[\()]/g, m => "\\" + m).replace(/[^\x20-\x7e]/g, "?");
  const body = lines.map((l, i) => `BT /F1 10 Tf 50 ${780 - i * 14} Td (${esc(l)}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(body, "latin1")} >>\nstream\n${body}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// CLI: regenerate priya-nair.pdf from priya-nair.txt.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const txt = readFileSync(new URL("./priya-nair.txt", import.meta.url), "utf8");
  writeFileSync(new URL("./priya-nair.pdf", import.meta.url), makePdf(txt.split(/\r?\n/)));
  console.log("wrote tests/fixtures/cv/priya-nair.pdf");
}
