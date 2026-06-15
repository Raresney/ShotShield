import type { Detection } from "@shotshield/core";
import type { Box, OcrWord } from "./ocr.ts";

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
