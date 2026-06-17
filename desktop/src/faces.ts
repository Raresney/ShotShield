import * as faceapi from "@vladmandic/face-api";
import type { Box } from "./ocr.ts";

export interface FaceHit {
  box: Box;
  /** 0..1 detector score. */
  score: number;
}

// Lazy single load. A failed load resets so the next scan retries, the same way
// the OCR worker does — a transient asset/memory hiccup shouldn't kill detection
// until restart. TF.js picks its own backend (WebGL in the WebView, CPU as a
// fallback); both are CSP-safe — neither needs eval or a network round-trip.
let ready: Promise<void> | null = null;
function load(): Promise<void> {
  if (!ready) {
    // Model is vendored locally (see scripts/copy-vendor.mjs) — nothing is
    // fetched off the network, consistent with the offline/privacy guarantee.
    ready = faceapi.nets.tinyFaceDetector.loadFromUri("/vendor/faceapi").catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

/** Detect faces, returning each box in the image's own pixel space. */
export async function detectFaces(image: HTMLImageElement | HTMLCanvasElement): Promise<FaceHit[]> {
  await load();
  // inputSize must be a multiple of 32; 512 keeps the smallish faces on a
  // full-frame photo in reach without making CPU inference crawl.
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.5 });
  const found = await faceapi.detectAllFaces(image, options);
  return found.map(({ box, score }) => ({
    box: { x: box.x, y: box.y, w: box.width, h: box.height },
    score,
  }));
}
