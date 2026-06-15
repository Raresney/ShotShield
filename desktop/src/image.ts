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

/** Promise-based image loader. */
export function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", () => reject(new Error("image failed to load")));
    img.src = src;
  });
}
