// Small canvas helpers shared by the OCR and UI layers.

type Source = HTMLImageElement | HTMLCanvasElement;

function sourceSize(src: Source): { w: number; h: number } {
  return src instanceof HTMLImageElement
    ? { w: src.naturalWidth, h: src.naturalHeight }
    : { w: src.width, h: src.height };
}

/**
 * Draw `src` rotated clockwise by `turns` quarter-turns (0–3) onto a fresh
 * canvas, scaled down so its longest side is at most `maxDim`. Used both to
 * show a re-oriented image and to feed rotated copies to OCR.
 */
export function orientedCanvas(src: Source, turns: number, maxDim = Infinity): HTMLCanvasElement {
  const t = ((turns % 4) + 4) % 4;
  const { w: sw, h: sh } = sourceSize(src);
  const swapped = t % 2 === 1;
  const ow = swapped ? sh : sw; // dimensions after rotation, before scaling
  const oh = swapped ? sw : sh;
  const scale = Math.min(1, maxDim / Math.max(ow, oh));

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(ow * scale));
  canvas.height = Math.max(1, Math.round(oh * scale));

  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  // Rotate about the origin, then translate the result back into view.
  if (t === 1) {
    ctx.translate(sh, 0);
    ctx.rotate(Math.PI / 2);
  } else if (t === 2) {
    ctx.translate(sw, sh);
    ctx.rotate(Math.PI);
  } else if (t === 3) {
    ctx.translate(0, sw);
    ctx.rotate((3 * Math.PI) / 2);
  }
  ctx.drawImage(src, 0, 0);
  return canvas;
}

/**
 * Prepare an image for OCR. Phone photos of ID cards are noisy and their text is
 * small, so Tesseract often misreads a digit — and a single wrong digit fails the
 * CNP/IBAN checksum, silently dropping the field. A grayscale + percentile
 * contrast stretch and a modest upscale of small inputs let those digits resolve.
 *
 * Returns the prepared canvas and the `scale` applied, so word boxes read off it
 * divide cleanly back into the source image's pixel space. The original image is
 * left untouched — this output feeds OCR only, never the display or the export.
 */
export function preprocessForOcr(src: Source, targetDim = 2400): { canvas: HTMLCanvasElement; scale: number } {
  const { w, h } = sourceSize(src);
  const longest = Math.max(w, h);
  // Only ever upscale small inputs (callers already cap the working size), and
  // never past 2× — beyond that there's no real detail to recover.
  const scale = longest > 0 && longest < targetDim ? Math.min(2, targetDim / longest) : 1;
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, cw, ch);

  const image = ctx.getImageData(0, 0, cw, ch);
  const d = image.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114) | 0;
    d[i] = d[i + 1] = d[i + 2] = g;
    hist[g]!++;
  }

  // Stretch the 2nd–98th percentile range to full black/white. Percentiles (not
  // raw min/max) keep a few stray dark or bright pixels from flattening the stretch.
  const cut = (cw * ch) * 0.02;
  let lo = 0;
  for (let v = 0, acc = 0; v < 256; v++) {
    acc += hist[v]!;
    if (acc >= cut) { lo = v; break; }
  }
  let hi = 255;
  for (let v = 255, acc = 0; v >= 0; v--) {
    acc += hist[v]!;
    if (acc >= cut) { hi = v; break; }
  }
  const span = hi - lo;
  if (span > 0) {
    const k = 255 / span;
    for (let i = 0; i < d.length; i += 4) {
      let v = ((d[i]! - lo) * k) | 0;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  ctx.putImageData(image, 0, 0);
  return { canvas, scale };
}

/** Promise-based image loader. */
export function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", () => reject(new Error("image failed to load")));
    img.src = src;
  });
}
