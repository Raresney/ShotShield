import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import * as reader from "zxing-wasm/reader";
import * as writer from "zxing-wasm/writer";
import { codeBox, codeKind, codeLabel, readCodes } from "../src/codes.ts";

const require = createRequire(import.meta.url);

describe("codeKind", () => {
  it("ranks codes that hold a way in above plain links", () => {
    expect(codeKind("otpauth://totp/Mail:ana?secret=JBSWY3DPEHPK3PXP")).toEqual({ kind: "2FA secret", severity: "critical" });
    expect(codeKind("otpauth-migration://offline?data=CjEK")).toMatchObject({ severity: "critical" });
    expect(codeKind("WIFI:T:WPA;S:Home;P:hunter22;;")).toEqual({ kind: "Wi-Fi login", severity: "critical" });
    expect(codeKind("bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq")).toMatchObject({ kind: "Crypto address" });
    expect(codeKind("https://example.com/menu")).toEqual({ kind: "Link", severity: "medium" });
    expect(codeKind("just some words")).toEqual({ kind: "Text", severity: "medium" });
    expect(codeKind("")).toEqual({ kind: "Data", severity: "medium" });
  });

  it("knows the formats that carry a person", () => {
    expect(codeKind("BCD\n002\n1\nSCT\nBICXXXXX\nAna Pop\nRO49AAAA1B31007593840000")).toMatchObject({ kind: "Payment details", severity: "high" });
    expect(codeKind("M1POPESCU/ANA         EABC123 OTPLHRRO 0391 123Y012A0001 100")).toMatchObject({ kind: "Boarding pass", severity: "high" });
    expect(codeKind("BEGIN:VCARD\nVERSION:3.0\nFN:Ana Pop\nEND:VCARD")).toMatchObject({ kind: "Contact card", severity: "high" });
    expect(codeKind("mailto:ana@example.com")).toMatchObject({ kind: "Contact", severity: "high" });
  });
});

describe("codeLabel", () => {
  it("names each symbology", () => {
    expect(codeLabel("QRCode")).toBe("QR code");
    expect(codeLabel("MicroQRCode")).toBe("QR code");
    expect(codeLabel("Aztec")).toBe("Aztec code");
    expect(codeLabel("DataMatrix")).toBe("Data Matrix code");
    expect(codeLabel("PDF417")).toBe("PDF417 barcode");
    expect(codeLabel("Something")).toBe("Barcode");
  });
});

describe("codeBox", () => {
  it("bounds a rotated code and pads it", () => {
    const box = codeBox(
      { topLeft: { x: 150, y: 100 }, topRight: { x: 200, y: 150 }, bottomRight: { x: 150, y: 200 }, bottomLeft: { x: 100, y: 150 } },
      1000,
      1000,
    );
    expect(box).toEqual({ x: 95, y: 95, w: 110, h: 110 });
  });

  it("stays inside the image", () => {
    const box = codeBox(
      { topLeft: { x: 0, y: 0 }, topRight: { x: 100, y: 0 }, bottomRight: { x: 100, y: 100 }, bottomLeft: { x: 0, y: 100 } },
      102,
      300,
    );
    expect(box).toEqual({ x: 0, y: 0, w: 102, h: 105 });
  });
});

// The real reader on a code drawn by zxing's own encoder, so the options and
// the position mapping are checked against the wasm, not a mock.
describe("readCodes", () => {
  const wasm = (name: string) => readFileSync(require.resolve(`zxing-wasm/${name}/zxing_${name}.wasm`));
  beforeAll(() => {
    reader.prepareZXingModule({ overrides: { wasmBinary: wasm("reader").buffer as ArrayBuffer } });
    writer.prepareZXingModule({ overrides: { wasmBinary: wasm("writer").buffer as ArrayBuffer } });
  });

  // Draw a code's modules `scale` pixels wide at (left, top) on a white page.
  async function page(text: string, format: "QRCode" | "Aztec", left: number, top: number) {
    const { symbol, error } = await writer.writeBarcode(text, { format });
    expect(error).toBe("");
    const scale = 6;
    const width = 600;
    const height = 400;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let y = 0; y < symbol.height * scale; y++) {
      for (let x = 0; x < symbol.width * scale; x++) {
        const v = symbol.data[Math.floor(y / scale) * symbol.width + Math.floor(x / scale)];
        const i = ((top + y) * width + left + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = v;
      }
    }
    return { pixels: { width, height, data, colorSpace: "srgb" } as ImageData, size: symbol.width * scale };
  }

  it("finds a QR code where it was drawn and reads it", async () => {
    const { pixels, size } = await page("WIFI:T:WPA;S:Home;P:hunter22;;", "QRCode", 200, 80);
    const hits = await readCodes(pixels, reader.readBarcodes);
    expect(hits).toHaveLength(1);
    const [hit] = hits;
    expect(hit.format).toBe("QRCode");
    expect(hit.text).toBe("WIFI:T:WPA;S:Home;P:hunter22;;");
    // The cover takes in the whole symbol.
    expect(hit.box.x).toBeLessThanOrEqual(200);
    expect(hit.box.y).toBeLessThanOrEqual(80);
    expect(hit.box.x + hit.box.w).toBeGreaterThanOrEqual(200 + size - 6);
    expect(hit.box.y + hit.box.h).toBeGreaterThanOrEqual(80 + size - 6);
  });

  it("reads an Aztec code, the boarding-pass format", async () => {
    const { pixels } = await page("M1POPESCU/ANA         EABC123 OTPLHRRO 0391", "Aztec", 40, 40);
    const hits = await readCodes(pixels, reader.readBarcodes);
    expect(hits.map((h) => h.format)).toEqual(["Aztec"]);
  });

  it("finds nothing on a blank page", async () => {
    const data = new Uint8ClampedArray(200 * 100 * 4).fill(255);
    const hits = await readCodes({ width: 200, height: 100, data, colorSpace: "srgb" } as ImageData, reader.readBarcodes);
    expect(hits).toEqual([]);
  });
});
