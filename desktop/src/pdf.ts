// Open a PDF as a stack of page images, so every page goes through the same
// OCR + detection pass as a screenshot. pdf.js and everything it loads (worker,
// fonts, CMaps, wasm decoders) are copied into public/vendor/pdfjs on
// predev/prebuild, so this works offline like the rest of the app.

/** Pages rendered at this resolution read well with OCR without being huge. */
const RENDER_DPI = 200;
/** A very long PDF would take ages to scan; open the first pages and say so. */
export const MAX_PDF_PAGES = 30;

const VENDOR = "/vendor/pdfjs";

export interface PdfPage {
  name: string;
  dataUrl: string;
  /** 1-based page number and how many pages the PDF has in total. */
  page: number;
  pages: number;
  /** PDF points per rendered pixel, to save the page back at its original size. */
  ptPerPx: number;
}

export class PdfError extends Error {
  constructor(readonly reason: "password" | "invalid") {
    super(reason === "password" ? "The PDF is password-protected" : "The file isn't a readable PDF");
  }
}

export function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/**
 * Scale from PDF points (1/72 in) to pixels: RENDER_DPI, but never past
 * `maxDim` on the longer side.
 */
export function pageScale(widthPt: number, heightPt: number, maxDim: number): number {
  const scale = RENDER_DPI / 72;
  const longest = Math.max(widthPt, heightPt) * scale;
  return longest > maxDim ? maxDim / Math.max(widthPt, heightPt) : scale;
}

/** "contract.pdf", page 3 of 12 -> "contract-p03.png". */
export function pageName(fileName: string, page: number, pages: number): string {
  const base = fileName.replace(/\.pdf$/i, "") || "document";
  return `${base}-p${String(page).padStart(String(pages).length, "0")}.png`;
}

/** Render the pages one at a time, so the first one can show while the rest load. */
export async function* pdfPages(file: File, maxDim: number): AsyncGenerator<PdfPage> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `${VENDOR}/pdf.worker.min.mjs`;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: `${VENDOR}/cmaps/`,
    standardFontDataUrl: `${VENDOR}/standard_fonts/`,
    wasmUrl: `${VENDOR}/wasm/`,
    iccUrl: `${VENDOR}/iccs/`,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    void task.destroy();
    throw new PdfError(err instanceof pdfjs.PasswordException ? "password" : "invalid");
  }
  try {
    const pages = doc.numPages;
    for (let n = 1; n <= Math.min(pages, MAX_PDF_PAGES); n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = pageScale(base.width, base.height, maxDim);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      // White behind the page: a transparent PDF would otherwise OCR as black.
      await page.render({ canvas, viewport, background: "#ffffff" }).promise;
      yield { name: pageName(file.name, n, pages), dataUrl: canvas.toDataURL("image/png"), page: n, pages, ptPerPx: 1 / scale };
      page.cleanup();
    }
  } finally {
    // Stops the worker too, so a closed PDF doesn't keep its memory.
    void task.destroy();
  }
}
