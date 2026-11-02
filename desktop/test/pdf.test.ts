import { describe, expect, it } from "vitest";
import { isPdf, pageName, pageScale } from "../src/pdf.ts";
import { buildPdf } from "../src/pdfwrite.ts";

describe("isPdf", () => {
  it("goes by the MIME type, or the extension when there is none", () => {
    expect(isPdf(new File([], "scan", { type: "application/pdf" }))).toBe(true);
    expect(isPdf(new File([], "Contract.PDF"))).toBe(true);
    expect(isPdf(new File([], "shot.png", { type: "image/png" }))).toBe(false);
  });
});

describe("pageScale", () => {
  it("renders an A4 page at 200 dpi", () => {
    const s = pageScale(595, 842, 4096);
    expect(Math.round(842 * s)).toBe(2339);
  });

  it("caps the longer side for an oversized page", () => {
    const s = pageScale(2384, 3370, 4096); // A0
    expect(Math.round(3370 * s)).toBe(4096);
  });
});

describe("pageName", () => {
  it("pads the page number to the page count", () => {
    expect(pageName("contract.pdf", 3, 12)).toBe("contract-p03.png");
    expect(pageName("scan.PDF", 1, 1)).toBe("scan-p1.png");
    expect(pageName(".pdf", 2, 5)).toBe("document-p2.png");
  });
});

describe("buildPdf", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0x00, 0x01, 0xff, 0xd9]);
  const pdf = buildPdf([
    { jpeg, width: 1654, height: 2339, widthPt: 595.44, heightPt: 842.04 },
    { jpeg, width: 2339, height: 1654, widthPt: 842.04, heightPt: 595.44 },
  ]);
  const text = new TextDecoder("latin1").decode(pdf);

  it("writes a header, a page per image and a trailer", () => {
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/Count 2");
    expect(text).toContain("/MediaBox [0 0 595.44 842.04]");
    expect(text).toContain("/MediaBox [0 0 842.04 595.44]");
    expect(text.match(/\/Filter \/DCTDecode/g)).toHaveLength(2);
  });

  it("points every xref entry and startxref at the right byte", () => {
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const entries = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(8);
    entries.forEach((offset, i) => expect(text.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });

  it("embeds the JPEG bytes untouched", () => {
    const at = text.indexOf("stream\n") + "stream\n".length;
    expect([...pdf.slice(at, at + jpeg.length)]).toEqual([...jpeg]);
  });
});
