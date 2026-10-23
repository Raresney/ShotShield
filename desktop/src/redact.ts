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

/** What a pointer on a hand-drawn box would do: move it, or drag an edge/corner. */
export type BoxGrip = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/**
 * Which hand-drawn box (and which part of it) sits under an image-space point.
 * `tol` is the grab margin around edges, in image pixels. The last-drawn box is
 * on top, so it wins.
 */
export function boxGripAt(boxes: Box[], x: number, y: number, tol: number): { index: number; grip: BoxGrip } | null {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i]!;
    if (x < b.x - tol || x > b.x + b.w + tol || y < b.y - tol || y > b.y + b.h + tol) continue;
    const n = Math.abs(y - b.y) <= tol;
    const s = Math.abs(y - (b.y + b.h)) <= tol;
    const w = Math.abs(x - b.x) <= tol;
    const e = Math.abs(x - (b.x + b.w)) <= tol;
    const grip = `${n ? "n" : s ? "s" : ""}${w ? "w" : e ? "e" : ""}` as BoxGrip | "";
    return { index: i, grip: grip || "move" };
  }
  return null;
}

/**
 * The box after dragging `grip` by (dx, dy), clamped to the image and never
 * smaller than `min` on a side. Dragging an edge past the opposite one stops
 * at the minimum rather than flipping the box.
 */
export function dragBox(b: Box, grip: BoxGrip, dx: number, dy: number, bounds: { w: number; h: number }, min = 6): Box {
  if (grip === "move") {
    return {
      x: Math.max(0, Math.min(bounds.w - b.w, b.x + dx)),
      y: Math.max(0, Math.min(bounds.h - b.h, b.y + dy)),
      w: b.w,
      h: b.h,
    };
  }
  let left = b.x;
  let top = b.y;
  let right = b.x + b.w;
  let bottom = b.y + b.h;
  if (grip.includes("w")) left = Math.max(0, Math.min(right - min, left + dx));
  if (grip.includes("e")) right = Math.min(bounds.w, Math.max(left + min, right + dx));
  if (grip.includes("n")) top = Math.max(0, Math.min(bottom - min, top + dy));
  if (grip.includes("s")) bottom = Math.min(bounds.h, Math.max(top + min, bottom + dy));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** The padding paint() puts around a detected box, so hit-testing matches what's drawn. */
export const coverPad = (b: Box): number => Math.max(2, b.h * 0.15);

/**
 * Which region sits under an image-space point, if any. When boxes overlap the
 * smallest wins — it's the one the pointer is most clearly aiming at.
 */
export function regionAt(regions: Region[], x: number, y: number): number | null {
  let hit: number | null = null;
  let hitArea = Infinity;
  regions.forEach((r, i) => {
    for (const b of r.boxes) {
      const pad = coverPad(b);
      if (x < b.x - pad || x > b.x + b.w + pad || y < b.y - pad || y > b.y + b.h + pad) continue;
      const area = b.w * b.h;
      if (area < hitArea) {
        hit = i;
        hitArea = area;
      }
    }
  });
  return hit;
}

/**
 * The pasted text with every detection replaced by a marker, ready to share.
 * Detections never overlap (the scanner resolves that), so a right-to-left
 * splice keeps every offset valid.
 */
export function redactText(text: string, dets: Detection[]): string {
  let out = text;
  for (const d of [...dets].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, d.start) + "[REDACTED]" + out.slice(d.end);
  }
  return out;
}

/** How a covered region is drawn: a solid fill, or a generated mosaic. */
export type CoverStyle = "solid" | "mosaic";

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
  style: CoverStyle = "solid",
): void {
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const rects: Box[] = [];
  for (const region of regions) {
    if (!region.hidden) continue;
    for (const b of region.boxes) {
      // Pad a hair so descenders and antialiased edges are fully covered.
      const pad = coverPad(b);
      rects.push({ x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 });
    }
  }
  // Manual boxes are exactly what the user dragged — no padding.
  rects.push(...manual);
  for (const r of rects) cover(ctx, r, style);
}

function cover(ctx: CanvasRenderingContext2D, r: Box, style: CoverStyle): void {
  if (style === "mosaic") mosaic(ctx, r);
  else {
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
}

/**
 * A mosaic that carries no information about what it covers. Real pixelation
 * averages each block of the source, and averaged text can be brute-forced
 * back (render candidate strings, pixelate, compare). Here only the region's
 * single overall mean colour is read; every block is that mean plus seeded
 * noise, so the pattern depends on the box position, never on the content.
 */
export function mosaic(ctx: CanvasRenderingContext2D, r: Box): void {
  const x = Math.max(0, Math.floor(r.x));
  const y = Math.max(0, Math.floor(r.y));
  const w = Math.min(ctx.canvas.width - x, Math.ceil(r.w + (r.x - x)));
  const h = Math.min(ctx.canvas.height - y, Math.ceil(r.h + (r.y - y)));
  if (!(w > 0 && h > 0)) return;

  const px = ctx.getImageData(x, y, w, h).data;
  let red = 0, green = 0, blue = 0;
  const n = px.length / 4;
  for (let i = 0; i < px.length; i += 4) {
    red += px[i]!;
    green += px[i + 1]!;
    blue += px[i + 2]!;
  }
  // Pull the mean toward mid-grey so a mostly-white text box still reads as covered.
  const mean = [red / n, green / n, blue / n].map((c) => c * 0.55 + 128 * 0.45 - 24);

  const block = Math.max(6, Math.round(Math.min(w, h) / 3));
  let seed = (x * 73856093) ^ (y * 19349663) ^ (w * 83492791);
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let by = y; by < y + h; by += block) {
    for (let bx = x; bx < x + w; bx += block) {
      const j = (rand() - 0.5) * 70;
      const [cr, cg, cb] = mean.map((c) => Math.max(0, Math.min(255, Math.round(c + j))));
      ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
      ctx.fillRect(bx, by, Math.min(block, x + w - bx), Math.min(block, y + h - by));
    }
  }
}
