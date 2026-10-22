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

let workerPromise: ReturnType<typeof createWorker> | null = null;
let onProgress: ProgressFn | null = null;
let phase: "reading" | "orienting" = "reading";

// One worker already serializes recognize(); this serializes the JS around it too.
// Without it a second scan starting mid-read overwrites onProgress/phase, and the
// first scan's finally nulls progress while the second is still running. Each OCR
// call acquires the lock first, so the progress lifecycle never overlaps.
let lock: Promise<void> = Promise.resolve();
function acquire(): Promise<() => void> {
  const prev = lock;
  let release!: () => void;
  lock = new Promise<void>((res) => (release = res));
  return prev.then(() => release);
}

// One worker, created on first use and reused. Every asset is local
// (see scripts/copy-vendor.mjs) — nothing is fetched at runtime.
function getWorker() {
  if (!workerPromise) {
    // English + Romanian: ID cards carry diacritics and Romanian field labels
    // that the English model alone misreads. Both .traineddata files are local.
    workerPromise = createWorker("eng+ron", 1, {
      workerPath: "/vendor/tesseract/worker.min.js",
      corePath: "/vendor/tesseract/core",
      langPath: "/vendor/tesseract/lang",
      // Load the worker from its same-origin path, not a blob: URL, so the CSP
      // can keep worker-src to 'self'. Every asset is local either way.
      workerBlobURL: false,
      gzip: false,
      logger: (m) => {
        if (m.status === "recognizing text") onProgress?.(phase, m.progress);
      },
    }).catch((err) => {
      // Don't cache a rejected init. A transient failure (a missing asset, low
      // memory) would otherwise kill OCR until restart; reset so the next call retries.
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
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
  source: HTMLImageElement | HTMLCanvasElement,
  enhance = true,
  look: OcrLook = "first",
): Promise<Scored> {
  const prepared = enhance ? preprocessForOcr(source, look) : null;
  const input = prepared ? prepared.canvas : source;
  const scale = prepared ? prepared.scale : 1;

  const worker = await getWorker();
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
  const release = await acquire();
  onProgress = progress ?? null;
  phase = "reading";
  try {
    const { text, words } = await recognize(image);
    return { text, words };
  } finally {
    onProgress = null;
    release();
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
  const release = await acquire();
  onProgress = progress ?? null;
  phase = "reading";
  try {
    const { text, words } = await recognize(image, true, "second");
    return { text, words };
  } finally {
    onProgress = null;
    release();
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
  const release = await acquire();
  onProgress = progress ?? null;
  try {
    phase = "reading";
    const first = await recognize(image);
    if (first.score >= CLEARLY_UPRIGHT) {
      return { text: first.text, words: first.words, quarterTurns: 0 };
    }

    // Not clearly upright — it may be sideways. Score all four orientations on a
    // downscaled copy (a like-for-like comparison) and keep whichever reads best.
    phase = "orienting";
    const scores: number[] = [];
    for (const turns of [0, 1, 2, 3]) {
      onProgress?.("orienting", turns / 4);
      scores.push((await recognize(orientedCanvas(image, turns, SEARCH_MAX_DIM), false)).score);
    }
    const bestTurns = pickOrientation(scores);

    if (bestTurns === 0) {
      return { text: first.text, words: first.words, quarterTurns: 0 };
    }
    phase = "reading";
    const best = await recognize(orientedCanvas(image, bestTurns));
    return { text: best.text, words: best.words, quarterTurns: bestTurns };
  } finally {
    onProgress = null;
    release();
  }
}
