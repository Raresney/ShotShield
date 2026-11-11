import type { Severity } from "@shotshield/core";
import type { Box } from "./ocr.ts";

// QR codes and 2D barcodes, read with zxing-cpp compiled to wasm. A code can
// hold far more than it shows: a Wi-Fi password, a 2FA setup secret, a login
// link, the name and booking on a boarding pass. 1D barcodes are left out on
// purpose: on a screenshot they're product codes, and stripes in a photo would
// read as false hits.

export interface CodeHit {
  box: Box;
  /** zxing's name for the symbology, e.g. "QRCode", "PDF417". */
  format: string;
  /** What the code decodes to. */
  text: string;
}

export const CODE_FORMATS = ["QRCode", "MicroQRCode", "RMQRCode", "Aztec", "DataMatrix", "PDF417", "MaxiCode"] as const;

interface Corner {
  x: number;
  y: number;
}
interface Corners {
  topLeft: Corner;
  topRight: Corner;
  bottomLeft: Corner;
  bottomRight: Corner;
}

/**
 * The axis-aligned box around a code's four corners (it may be rotated), grown
 * by a little margin so the cover reaches past the outer modules, and kept
 * inside the image.
 */
export function codeBox(p: Corners, width: number, height: number): Box {
  const xs = [p.topLeft.x, p.topRight.x, p.bottomLeft.x, p.bottomRight.x];
  const ys = [p.topLeft.y, p.topRight.y, p.bottomLeft.y, p.bottomRight.y];
  let x0 = Math.min(...xs);
  let y0 = Math.min(...ys);
  let x1 = Math.max(...xs);
  let y1 = Math.max(...ys);
  const pad = Math.max(2, 0.05 * Math.max(x1 - x0, y1 - y0));
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width, x1 + pad);
  y1 = Math.min(height, y1 + pad);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** How a code is named in the findings list. */
export function codeLabel(format: string): string {
  if (/QR/i.test(format)) return "QR code";
  if (/Aztec/i.test(format)) return "Aztec code";
  if (/DataMatrix/i.test(format)) return "Data Matrix code";
  if (/PDF417/i.test(format)) return "PDF417 barcode";
  if (/MaxiCode/i.test(format)) return "MaxiCode";
  return "Barcode";
}

/**
 * What a code holds, named without showing it, and how bad it is to leak.
 * Secrets that let someone in (2FA, Wi-Fi, a wallet) rank above personal data,
 * which ranks above a plain link or text.
 */
export function codeKind(text: string): { kind: string; severity: Severity } {
  const t = text.trimStart();
  if (/^otpauth(?:-migration)?:\/\//i.test(t)) return { kind: "2FA secret", severity: "critical" };
  if (/^WIFI:/i.test(t)) return { kind: "Wi-Fi login", severity: "critical" };
  if (/^(?:bitcoin|ethereum|litecoin|monero|solana|lightning):/i.test(t)) {
    return { kind: "Crypto address", severity: "critical" };
  }
  // EPC "SEPA credit transfer" QR: the payee's name and IBAN.
  if (/^BCD\r?\n/.test(t)) return { kind: "Payment details", severity: "high" };
  // IATA boarding pass (BCBP): passenger name, booking reference, flight.
  if (/^M[1-4][A-Z/ ]{3,}/.test(t)) return { kind: "Boarding pass", severity: "high" };
  if (/^(?:BEGIN:VCARD|MECARD:)/i.test(t)) return { kind: "Contact card", severity: "high" };
  if (/^(?:mailto|tel|sms|smsto|geo):/i.test(t)) return { kind: "Contact", severity: "high" };
  if (/^https?:\/\//i.test(t)) return { kind: "Link", severity: "medium" };
  return { kind: t ? "Text" : "Data", severity: "medium" };
}

type Reader = typeof import("zxing-wasm/reader");

// Lazy single load, retried after a failure the same way the face model is.
// The wasm is vendored (see scripts/copy-vendor.mjs): the library's default
// would fetch it from a CDN, which the app's CSP blocks anyway.
let reader: Promise<Reader> | null = null;
function load(): Promise<Reader> {
  if (!reader) {
    reader = import("zxing-wasm/reader")
      .then((mod) => {
        mod.prepareZXingModule({
          overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? `/vendor/zxing/${path}` : prefix + path) },
        });
        return mod;
      })
      .catch((err) => {
        reader = null;
        throw err;
      });
  }
  return reader;
}

/** Find the codes in raw pixels. */
export async function readCodes(pixels: ImageData, read: Reader["readBarcodes"]): Promise<CodeHit[]> {
  const found = await read(pixels, { formats: [...CODE_FORMATS], tryHarder: true, tryRotate: true, tryInvert: true });
  return found
    .filter((r) => r.isValid)
    .map((r) => ({ box: codeBox(r.position, pixels.width, pixels.height), format: r.format, text: r.text }));
}

/** Find the codes in an image, each box in the image's own pixel space. */
export async function detectCodes(image: HTMLImageElement | HTMLCanvasElement): Promise<CodeHit[]> {
  const width = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
  const height = image instanceof HTMLImageElement ? image.naturalHeight : image.height;
  if (!width || !height) return [];
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(image, 0, 0);
  const { readBarcodes } = await load();
  return readCodes(ctx.getImageData(0, 0, width, height), readBarcodes);
}
