// Turn a PDF page's own text layer into the same shape OCR produces: the text,
// rebuilt word by word, plus a box for every word on the rendered page. For a
// digital PDF that is exact where OCR would guess, and far faster.

import type { OcrResult, OcrWord } from "./ocr.ts";

/** The parts of a pdf.js TextItem this needs. */
export interface TextItemLike {
  str: string;
  /** Text-space matrix, already multiplied by the viewport transform. */
  transform: number[];
  /** Run width in page pixels. */
  width: number;
  hasEOL: boolean;
  fontFamily?: string;
}

/** Width of `text` set in `family`, in any unit (only ratios are used). */
export type MeasureFn = (text: string, family: string) => number;

interface Glyph {
  ch: string;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
}

export function textLayerToOcr(items: TextItemLike[], measure: MeasureFn): OcrResult {
  const lines: Glyph[][] = [[]];
  let prev: { right: number; baseline: number; size: number } | null = null;

  for (const item of items) {
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = item.transform;
    const size = Math.hypot(c, d) || Math.hypot(a, b);
    const line = lines[lines.length - 1]!;
    // Upright text runs right (a > 0) with its glyphs above the baseline (d < 0,
    // the viewport's y axis points down). Anything else is turned or flipped:
    // an upside-down /Rotate 180 page has a < 0 and d > 0.
    const upright = Math.abs(b) <= Math.abs(a) * 0.05 && a > 0 && d < 0;
    if (item.str && !upright) {
      // Rotated, upside-down or vertical text: per-glyph positions aren't worth
      // the maths here, so every glyph gets the whole run's bounding box. A
      // finding in it still gets covered, just more generously.
      const len = Math.hypot(a, b) || 1;
      const [dx, dy] = [(a / len) * item.width, (b / len) * item.width];
      // (c, d) points from the baseline toward the glyph tops in page pixels.
      const xs = [e, e + dx, e + c * 0.85, e + dx + c * 0.85, e - c * 0.25, e + dx - c * 0.25];
      const ys = [f, f + dy, f + d * 0.85, f + dy + d * 0.85, f - d * 0.25, f + dy - d * 0.25];
      const box = { x0: Math.min(...xs), x1: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
      if (line.length > 0) line.push({ ch: " ", ...box });
      for (const ch of item.str) line.push({ ch, ...box });
      prev = null;
    } else if (item.str) {
      // Glyph tops and bottoms: the ascent and descent of a typical font.
      const top = f - size * 0.85;
      const bottom = f + size * 0.25;
      const family = item.fontFamily ?? "sans-serif";
      const full = measure(item.str, family);
      const k = full > 0 ? item.width / full : 0;
      // Two runs on one line with a visible gap between them are two words, even
      // when the PDF doesn't spell the space out.
      if (prev && line.length > 0 && Math.abs(f - prev.baseline) < size * 0.5 && e - prev.right > size * 0.2) {
        line.push({ ch: " ", x0: prev.right, x1: e, top, bottom });
      }
      let x = e;
      for (let i = 0; i < item.str.length; i++) {
        const next = k > 0 ? e + measure(item.str.slice(0, i + 1), family) * k : x + item.width / item.str.length;
        line.push({ ch: item.str[i]!, x0: x, x1: next, top, bottom });
        x = next;
      }
      prev = { right: e + item.width, baseline: f, size };
    }
    if (item.hasEOL) {
      lines.push([]);
      prev = null;
    }
  }

  const words: OcrWord[] = [];
  let text = "";
  for (const line of lines) {
    let current: Glyph[] = [];
    const flush = (): void => {
      if (current.length === 0) return;
      if (text.length > 0 && !text.endsWith("\n")) text += " ";
      const start = text.length;
      const word = current.map((g) => g.ch).join("");
      text += word;
      const x = Math.min(...current.map((g) => g.x0));
      const y = Math.min(...current.map((g) => g.top));
      words.push({
        text: word,
        start,
        end: text.length,
        box: { x, y, w: Math.max(...current.map((g) => g.x1)) - x, h: Math.max(...current.map((g) => g.bottom)) - y },
      });
      current = [];
    };
    for (const g of line) {
      if (/\s/.test(g.ch)) flush();
      else current.push(g);
    }
    flush();
    if (line.length > 0) text += "\n";
  }
  return { text, words };
}
