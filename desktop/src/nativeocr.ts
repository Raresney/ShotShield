import type { OcrResult, OcrWord } from "./ocr.ts";

/** A line as the system OCR returns it: words in reading order, boxes in pixels. */
export interface NativeLine {
  words: { text: string; x: number; y: number; w: number; h: number }[];
}

/**
 * Rebuild the text the same way the Tesseract pass does (words joined by a
 * space, a newline after each line) so scan() offsets map back to word boxes.
 */
export function linesToResult(lines: NativeLine[]): OcrResult {
  const words: OcrWord[] = [];
  let text = "";
  for (const line of lines) {
    if (line.words.length === 0) continue;
    for (const w of line.words) {
      if (text.length > 0 && !text.endsWith("\n")) text += " ";
      const start = text.length;
      text += w.text;
      words.push({ text: w.text, start, end: text.length, box: { x: w.x, y: w.y, w: w.w, h: w.h } });
    }
    text += "\n";
  }
  return { text, words };
}

// Set once the system OCR turns out to be missing (a browser build, a platform
// without one, a Windows install with no OCR language), so later images don't
// ask again.
let unavailable = false;

/**
 * Read an image with the OCR engine built into the operating system, when there
 * is one. It runs on the device, like Tesseract. Resolves to null when there is
 * no such engine, so callers treat it as an optional extra pass.
 */
export async function ocrNative(source: HTMLImageElement | HTMLCanvasElement): Promise<OcrResult | null> {
  if (unavailable) return null;
  // A browser build (tests, `vite dev`) has no native side to ask.
  if (!("__TAURI_INTERNALS__" in window)) {
    unavailable = true;
    return null;
  }
  const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  if (!width || !height) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0);
  const pixels = ctx.getImageData(0, 0, width, height).data;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const lines = await invoke<NativeLine[]>("ocr_native", new Uint8Array(pixels.buffer), {
      headers: { width: String(width), height: String(height) },
    });
    return linesToResult(lines);
  } catch (err) {
    // No engine on this platform, or no OCR language installed: stop asking.
    // Anything else (an oversized image, say) only skips this one read.
    const msg = String(err);
    if (/not found|no OCR language|unknown command/i.test(msg)) unavailable = true;
    console.info("System OCR not used:", msg);
    return null;
  }
}
