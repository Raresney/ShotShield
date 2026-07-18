import type { Detection, Severity } from "@shotshield/core";
import type { Box, OcrWord } from "./ocr.ts";

/** Display order for findings: the scariest first. */
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export interface Region {
  detection: Detection;
  boxes: Box[];
  /** Whether this region is currently covered on the canvas. */
  hidden: boolean;
}

/** Pair each detection with the word boxes it covers. */
export function locate(dets: Detection[], words: OcrWord[]): Region[] {
  return dets.map((detection) => ({
    detection,
    hidden: detection.redactByDefault,
    boxes: words
      .filter((w) => w.start < detection.end && detection.start < w.end)
      .map((w) => w.box),
  }));
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Union the regions from a second OCR pass into the first's. The two passes
 * read the same image, so most hits come back twice with near-identical boxes;
 * a candidate is a duplicate when a kept region of the same category already
 * covers the same spot on the image. Different categories may overlap freely
 * (a face box crossing a text field is two real findings, not one).
 */
export function mergeRegions(base: Region[], extra: Region[]): Region[] {
  const merged = [...base];
  for (const r of extra) {
    const dup = merged.some(
      (k) =>
        k.detection.category === r.detection.category &&
        r.boxes.some((rb) => k.boxes.some((kb) => boxesOverlap(rb, kb))),
    );
    if (!dup) merged.push(r);
  }
  return merged;
}

/**
 * Should the scan take a second, differently-scaled look at this image?
 * Only when it clearly reads as a Romanian ID (a "seria" document number, or
 * CNP/ROMÂNIA/ROU in the text — the MRZ of a Romanian document carries ROU)
 * yet no CNP was detected: that's the field a marginal OCR read loses most,
 * and the retry is one extra pass on exactly the miss that matters. Ordinary
 * screenshots and foreign documents never pay for it.
 */
export function needsSecondLook(dets: Detection[], text: string, cnpEnabled: boolean): boolean {
  if (!cnpEnabled) return false;
  if (dets.some((d) => d.category === "national_id")) return false;
  return (
    dets.some((d) => d.category === "id_document") || /\bCNP\b|ROM[ÂA]N|ROU/i.test(text)
  );
}

/**
 * Redraw the image, cover every hidden detection region, then lay the
 * hand-drawn boxes on top. Everything lands on the canvas, so the export
 * (which just reads the canvas back) carries the manual redactions too.
 */
export function paint(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  regions: Region[],
  manual: Box[] = [],
): void {
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  ctx.fillStyle = "#0a0a0a";
  for (const region of regions) {
    if (!region.hidden) continue;
    for (const b of region.boxes) {
      // Pad a hair so descenders and antialiased edges are fully covered.
      const pad = Math.max(2, b.h * 0.15);
      ctx.fillRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
    }
  }
  // Manual boxes are exactly what the user dragged — no padding.
  for (const b of manual) {
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }
}
