// Copy the tesseract.js runtime (web worker + wasm core) out of node_modules
// into public/ so Vite serves it locally. Together with the committed language
// model in public/vendor/tesseract/lang, this lets OCR run fully offline — no
// CDN, nothing fetched at runtime. Runs automatically on predev/prebuild.

import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const dest = join(here, "..", "public", "vendor", "tesseract");

mkdirSync(dest, { recursive: true });

// The web worker tesseract.js spawns to do the work off the main thread.
cpSync(require.resolve("tesseract.js/dist/worker.min.js"), join(dest, "worker.min.js"));

// The wasm core. Copy the whole package so tesseract picks the right variant
// (SIMD vs fallback) at runtime.
const coreDir = dirname(require.resolve("tesseract.js-core/package.json"));
cpSync(coreDir, join(dest, "core"), { recursive: true });

console.log("tesseract runtime copied to", dest);
