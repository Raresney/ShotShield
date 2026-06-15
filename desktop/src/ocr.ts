import { createWorker } from "tesseract.js";
import { orientedCanvas } from "./image.ts";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A word the engine read: where it sits in the rebuilt text, and on the image. */
export interface OcrWord {
  text: string;
  start: number;
  end: number;
  box: Box;
}

export interface OcrResult {
  /** Text rebuilt from the words, so scan() offsets map back to boxes exactly. */
  text: string;
  words: OcrWord[];
}

export interface OrientedOcr extends OcrResult {
  /** Clockwise quarter-turns applied to the input to read it upright. */
  quarterTurns: number;
}

/** Phase lets the UI say "Reading…" vs "Checking orientation…". */
export type ProgressFn = (phase: "reading" | "orienting", fraction: number) => void;

let workerPromise: ReturnType<typeof createWorker> | null = null;
let onProgress: ProgressFn | null = null;
let phase: "reading" | "orienting" = "reading";

// One worker, created on first use and reused. Every asset is local
// (see scripts/copy-tesseract.mjs) — nothing is fetched at runtime.
function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker("eng", 1, {
      workerPath: "/vendor/tesseract/worker.min.js",
      corePath: "/vendor/tesseract/core",
      langPath: "/vendor/tesseract/lang",
      gzip: false,
      logger: (m) => {
        if (m.status === "recognizing text") onProgress?.(phase, m.progress);
      },
    });
  }
  return workerPromise;
}

interface Scored extends OcrResult {
  /** Count of confident, real-looking words — a proxy for "read the right way up". */
  score: number;
}

// Run one OCR pass and rebuild the text from the words rather than trusting
// data.text, so each character offset maps straight back to its word box.
async function recognize(source: HTMLImageElement | HTMLCanvasElement): Promise<Scored> {
  const worker = await getWorker();
  const { data } = await worker.recognize(source, {}, { blocks: true, text: true });

  const words: OcrWord[] = [];
  let text = "";
  let score = 0;
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        for (const w of line.words) {
          if (text.length > 0 && !text.endsWith("\n")) text += " ";
          const start = text.length;
          text += w.text;
          words.push({
            text: w.text,
            start,
            end: text.length,
            box: { x: w.bbox.x0, y: w.bbox.y0, w: w.bbox.x1 - w.bbox.x0, h: w.bbox.y1 - w.bbox.y0 },
          });
          if (w.confidence >= 70 && w.text.length >= 2 && /[A-Za-z0-9]/.test(w.text)) score++;
        }
        text += "\n";
      }
    }
  }
  return { text, words, score };
}

/** OCR an image at its current orientation. */
export async function ocr(image: HTMLImageElement, progress?: ProgressFn): Promise<OcrResult> {
  onProgress = progress ?? null;
  phase = "reading";
  try {
    const { text, words } = await recognize(image);
    return { text, words };
  } finally {
    onProgress = null;
  }
}

// Above this many confident words we trust the orientation and skip the search.
const GOOD_ENOUGH = 6;
// Orientation only needs a relative score, so search on a downscaled copy.
const SEARCH_MAX_DIM = 1000;

/**
 * OCR with automatic orientation. Reads the image as-is first; only if that
 * reads poorly do we rotate it 90/180/270 (on a downscaled copy, for speed),
 * keep whichever orientation reads best, and OCR that one at full size.
 */
export async function ocrAutoOrient(
  image: HTMLImageElement,
  progress?: ProgressFn,
): Promise<OrientedOcr> {
  onProgress = progress ?? null;
  try {
    phase = "reading";
    const first = await recognize(image);
    if (first.score >= GOOD_ENOUGH) {
      return { text: first.text, words: first.words, quarterTurns: 0 };
    }

    // Poor read — maybe it's sideways. Score all four orientations downscaled.
    phase = "orienting";
    let bestTurns = 0;
    let bestScore = -1;
    for (const turns of [0, 1, 2, 3]) {
      onProgress?.("orienting", turns / 4);
      const { score } = await recognize(orientedCanvas(image, turns, SEARCH_MAX_DIM));
      if (score > bestScore) {
        bestScore = score;
        bestTurns = turns;
      }
    }

    if (bestTurns === 0) {
      return { text: first.text, words: first.words, quarterTurns: 0 };
    }
    phase = "reading";
    const best = await recognize(orientedCanvas(image, bestTurns));
    return { text: best.text, words: best.words, quarterTurns: bestTurns };
  } finally {
    onProgress = null;
  }
}
