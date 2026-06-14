import { createWorker } from "tesseract.js";

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

type ProgressFn = (fraction: number) => void;

let workerPromise: ReturnType<typeof createWorker> | null = null;
let onProgress: ProgressFn | null = null;

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
        if (m.status === "recognizing text") onProgress?.(m.progress);
      },
    });
  }
  return workerPromise;
}

export async function ocr(image: HTMLImageElement, progress?: ProgressFn): Promise<OcrResult> {
  onProgress = progress ?? null;
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(image, {}, { blocks: true, text: true });

    // Rebuild the text from the words rather than trusting data.text, so each
    // character offset maps straight back to the word box it came from.
    const words: OcrWord[] = [];
    let text = "";
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
              box: {
                x: w.bbox.x0,
                y: w.bbox.y0,
                w: w.bbox.x1 - w.bbox.x0,
                h: w.bbox.y1 - w.bbox.y0,
              },
            });
          }
          text += "\n";
        }
      }
    }
    return { text, words };
  } finally {
    onProgress = null;
  }
}
