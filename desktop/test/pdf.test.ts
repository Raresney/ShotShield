import { describe, expect, it } from "vitest";
import { isPdf, pageName, pageScale } from "../src/pdf.ts";

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
