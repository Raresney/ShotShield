// A minimal PDF writer: one JPEG per page, drawn edge to edge. That's all a
// redacted copy needs: the pages are flattened images, so no text layer, no
// fonts and no leftover objects from the original file can leak what was
// covered.

export interface PdfImagePage {
  jpeg: Uint8Array;
  /** Pixel size of the JPEG. */
  width: number;
  height: number;
  /** Page size in PDF points (1/72 in). */
  widthPt: number;
  heightPt: number;
}

const enc = new TextEncoder();
const num = (n: number): string => String(Math.round(n * 100) / 100);

export function buildPdf(pages: PdfImagePage[]): Uint8Array {
  // Object numbers: 1 catalog, 2 page tree, then image, content, page per page.
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: string | Uint8Array): void => {
    const bytes = typeof chunk === "string" ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, ...body: (string | Uint8Array)[]): void => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    body.forEach(push);
    push("\nendobj\n");
  };

  // The binary comment marks the file as binary for tools that sniff it.
  push("%PDF-1.4\n");
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  const pageRef = (i: number): number => 5 + i * 3;
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageRef(i)} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  pages.forEach((p, i) => {
    const img = 3 + i * 3;
    const content = `q ${num(p.widthPt)} 0 0 ${num(p.heightPt)} 0 0 cm /Im0 Do Q`;
    object(
      img,
      `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      p.jpeg,
      "\nendstream",
    );
    object(img + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    object(
      pageRef(i),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.widthPt)} ${num(p.heightPt)}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${img + 1} 0 R >>`,
    );
  });

  const count = 3 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
