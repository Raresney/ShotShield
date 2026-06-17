// Copy vendored runtime assets out of node_modules into public/ so Vite serves
// them locally — OCR (tesseract.js) and face detection (face-api.js) both run
// fully offline, with nothing fetched at runtime. Runs on predev/prebuild.

import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const vendor = join(here, "..", "public", "vendor");

// ── tesseract.js (OCR) ──
const tess = join(vendor, "tesseract");
mkdirSync(tess, { recursive: true });
// The web worker tesseract.js spawns to do the work off the main thread.
cpSync(require.resolve("tesseract.js/dist/worker.min.js"), join(tess, "worker.min.js"));
// The wasm core. Copy the whole package so tesseract picks the right variant
// (SIMD vs fallback) at runtime.
const coreDir = dirname(require.resolve("tesseract.js-core/package.json"));
cpSync(coreDir, join(tess, "core"), { recursive: true });

// ── face-api.js (face detection) ──
// Only the tiny face detector and its weights — a frontal-face model that's
// plenty for the portrait photo on an ID, at a fraction of the other models' size.
const faces = join(vendor, "faceapi");
mkdirSync(faces, { recursive: true });
const modelDir = join(dirname(require.resolve("@vladmandic/face-api/package.json")), "model");
for (const f of ["tiny_face_detector_model-weights_manifest.json", "tiny_face_detector_model.bin"]) {
  cpSync(join(modelDir, f), join(faces, f));
}

console.log("vendor runtime copied to", vendor);
