import { createWorker } from "tesseract.js";
import { orientedCanvas, preprocessForOcr, type OcrLook } from "./image.ts";

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

// A small pool of OCR workers, so a batch (or a PDF's pages) reads several
// images at once. Each worker runs one image at a time and reports progress to
// whoever holds it. Two or three, by core count: each worker holds its own
// copy of the language models, so more would cost memory for little gain.
export function ocrConcurrency(): number {
  const cores = typeof navigator === "undefined" ? 2 : navigator.hardwareConcurrency || 2;
  return Math.max(1, Math.min(3, Math.floor(cores / 2)));
}

interface Slot {
  worker: ReturnType<typeof createWorker> | null;
  onProgress: ProgressFn | null;
  phase: "reading" | "orienting";
}

const idle: Slot[] = [];
const waiting: ((slot: Slot) => void)[] = [];
let created = 0;

function acquire(): Promise<Slot> {
  const free = idle.pop();
  if (free) return Promise.resolve(free);
  if (created < ocrConcurrency()) {
    created++;
    return Promise.resolve({ worker: null, onProgress: null, phase: "reading" });
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function release(slot: Slot): void {
  slot.onProgress = null;
  const next = waiting.shift();
  if (next) next(slot);
  else idle.push(slot);
}

// A slot's worker, created on first use and reused. Every asset is local
// (see scripts/copy-vendor.mjs) — nothing is fetched at runtime.
function workerOf(slot: Slot) {
  if (!slot.worker) {
    // English + Romanian: ID cards carry diacritics and Romanian field labels
    // that the English model alone misreads. Both .traineddata files are local.
    slot.worker = createWorker("eng+ron", 1, {
      workerPath: "/vendor/tesseract/worker.min.js",
      corePath: "/vendor/tesseract/core",
      langPath: "/vendor/tesseract/lang",
      // Load the worker from its same-origin path, not a blob: URL, so the CSP
      // can keep worker-src to 'self'. Every asset is local either way.
      workerBlobURL: false,
      gzip: false,
      logger: (m) => {
        if (m.status === "recognizing text") slot.onProgress?.(slot.phase, m.progress);
      },
    }).catch((err) => {
      // Don't cache a rejected init. A transient failure (a missing asset, low
      // memory) would otherwise kill OCR until restart; reset so the next call retries.
      slot.worker = null;
      throw err;
    });
  }
  return slot.worker;
}

// How many confident runs of 4+ letters a word holds. Rotated or upside-down
// text gives Tesseract only short, shaky fragments, so counting these separates
// an upright read from a sideways one far more reliably than a raw confidence
// count — which Tesseract happily hands to the garbage it reads off rotated
// text. Runs are counted *inside* words: a config line is a single OCR word
// ("DATABASE_URL=postgres://admin") yet holds three real runs, and scoring it
// zero made upright code screenshots look unreadable.
export function realWordRuns(text: string, confidence: number): number {
  if (confidence < 60) return 0;
  return text.match(/\p{L}{4,}/gu)?.length ?? 0;
}

interface Scored extends OcrResult {
  /** How many real words we read — a robust proxy for "this is the right way up". */
  score: number;
}

// Run one OCR pass and rebuild the text from the words rather than trusting
// data.text, so each character offset maps straight back to its word box. With
// `enhance` (the default) the source is contrast-stretched and upscaled first;
// the orientation search skips it, since it only needs a relative word count.
async function recognize(
  slot: Slot,
  source: HTMLImageElement | HTMLCanvasElement,
  enhance = true,
  look: OcrLook = "first",
): Promise<Scored> {
  const prepared = enhance ? preprocessForOcr(source, look) : null;
  const input = prepared ? prepared.canvas : source;
  const scale = prepared ? prepared.scale : 1;

  const worker = await workerOf(slot);
  const { data } = await worker.recognize(input, {}, { blocks: true, text: true });

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
            // Divide back by `scale` so boxes land in the source image's pixels,
            // not the (possibly upscaled) preprocessed canvas's.
            box: {
              x: w.bbox.x0 / scale,
              y: w.bbox.y0 / scale,
              w: (w.bbox.x1 - w.bbox.x0) / scale,
              h: (w.bbox.y1 - w.bbox.y0) / scale,
            },
          });
          score += realWordRuns(w.text, w.confidence);
        }
        text += "\n";
      }
    }
  }
  return { text, words, score };
}

/** OCR an image at its current orientation. */
export async function ocr(image: HTMLImageElement, progress?: ProgressFn): Promise<OcrResult> {
  const slot = await acquire();
  slot.onProgress = progress ?? null;
  slot.phase = "reading";
  try {
    const { text, words } = await recognize(slot, image);
    return { text, words };
  } finally {
    release(slot);
  }
}

/**
 * The retry read: same image, deliberately different render scale (see
 * preprocessForOcr). Run when the first pass looked like an ID but missed the
 * CNP — the field most often lost to a marginal, scale-dependent read.
 */
export async function ocrSecondLook(
  image: HTMLImageElement,
  progress?: ProgressFn,
): Promise<OcrResult> {
  const slot = await acquire();
  slot.onProgress = progress ?? null;
  slot.phase = "reading";
  try {
    const { text, words } = await recognize(slot, image, true, "second");
    return { text, words };
  } finally {
    release(slot);
  }
}

// This many real words means the read is clearly upright — skip the search.
const CLEARLY_UPRIGHT = 8;

/**
 * Pick the orientation to OCR from the search scores (index = quarter turns).
 * The image as given wins unless a turn reads clearly better: a screenshot is
 * almost always upright already, and a near-tie between orientations is noise,
 * not evidence — rotating on it is what flipped upright code screenshots.
 */
export function pickOrientation(scores: number[]): number {
  const asIs = scores[0] ?? 0;
  let best = 0;
  for (let t = 1; t < scores.length; t++) {
    const s = scores[t] ?? 0;
    if (s >= asIs * 1.5 + 3 && s > (scores[best] ?? 0)) best = t;
  }
  return best;
}
// Orientation only needs a relative score, so search on a downscaled copy.
const SEARCH_MAX_DIM = 1200;

/**
 * OCR with automatic orientation. Reads the image as-is first; only if that
 * reads poorly do we rotate it 90/180/270 (on a downscaled copy, for speed),
 * keep whichever orientation reads best, and OCR that one at full size.
 */
export async function ocrAutoOrient(
  image: HTMLImageElement,
  progress?: ProgressFn,
): Promise<OrientedOcr> {
  const slot = await acquire();
  slot.onProgress = progress ?? null;
  try {
    slot.phase = "reading";
    const first = await recognize(slot, image);
    if (first.score >= CLEARLY_UPRIGHT) {
      return { text: first.text, words: first.words, quarterTurns: 0 };
    }

    // Not clearly upright — it may be sideways. Score all four orientations on a
    // downscaled copy (a like-for-like comparison) and keep whichever reads best.
    slot.phase = "orienting";
    const scores: number[] = [];
    for (const turns of [0, 1, 2, 3]) {
      slot.onProgress?.("orienting", turns / 4);
      scores.push((await recognize(slot, orientedCanvas(image, turns, SEARCH_MAX_DIM), false)).score);
    }
    const bestTurns = pickOrientation(scores);

    if (bestTurns === 0) {
      return { text: first.text, words: first.words, quarterTurns: 0 };
    }
    slot.phase = "reading";
    const best = await recognize(slot, orientedCanvas(image, bestTurns));
    return { text: best.text, words: best.words, quarterTurns: bestTurns };
  } finally {
    release(slot);
  }
}
