// The capture overlay: a frozen copy of the screen under a dim shade. Drag out
// a region (or click for the whole screen) and the crop goes to the main
// window; Escape or a right-click cancels. Losing focus does not cancel: a
// toast or another app grabbing focus would otherwise kill the capture.

import "@fontsource-variable/inter";
import "./capture.css";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

const frame = document.querySelector<HTMLCanvasElement>("#frame")!;
const shade = document.querySelector<HTMLDivElement>("#shade")!;
const selection = document.querySelector<HTMLDivElement>("#selection")!;
const size = document.querySelector<HTMLSpanElement>("#size")!;
const hint = document.querySelector<HTMLDivElement>("#hint")!;

let image: HTMLImageElement | null = null;
let start: { x: number; y: number } | null = null;
let done = false;

// Window CSS pixels -> frame pixels. The overlay covers exactly one monitor,
// so this is the monitor's scale factor, measured rather than assumed.
const scaleX = () => (image ? image.naturalWidth / innerWidth : 1);
const scaleY = () => (image ? image.naturalHeight / innerHeight : 1);

const cancel = () => {
  if (done) return;
  done = true;
  void invoke("capture_cancel");
};

async function load(): Promise<void> {
  try {
    const bytes = await invoke<ArrayBuffer>("capture_frame");
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    image = new Image();
    image.src = url;
    await image.decode();
    frame.width = image.naturalWidth;
    frame.height = image.naturalHeight;
    frame.getContext("2d")!.drawImage(image, 0, 0);
    URL.revokeObjectURL(url);
    const win = getCurrentWindow();
    await win.show();
    await win.setFocus();
  } catch (err) {
    console.error("Capture overlay failed", err);
    cancel();
  }
}

function rectFrom(a: { x: number; y: number }, b: { x: number; y: number }) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

function drawSelection(r: { x: number; y: number; w: number; h: number }): void {
  selection.hidden = false;
  Object.assign(selection.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  // The shade keeps the selection clear: a giant box-shadow around it.
  shade.classList.add("hidden");
  size.textContent = `${Math.round(r.w * scaleX())} × ${Math.round(r.h * scaleY())}`;
}

addEventListener("pointerdown", (e) => {
  if (e.button === 2) return cancel();
  if (e.button !== 0 || !image) return;
  start = { x: e.clientX, y: e.clientY };
  hint.hidden = true;
  document.body.setPointerCapture?.(e.pointerId);
});

addEventListener("pointermove", (e) => {
  if (start) drawSelection(rectFrom(start, { x: e.clientX, y: e.clientY }));
});

addEventListener("pointerup", (e) => {
  if (!start || !image || done) return;
  const r = rectFrom(start, { x: e.clientX, y: e.clientY });
  start = null;
  // A click (no real drag) takes the whole screen.
  const whole = r.w < 4 || r.h < 4;
  const rect = whole
    ? { x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight }
    : {
        x: Math.round(r.x * scaleX()),
        y: Math.round(r.y * scaleY()),
        w: Math.max(1, Math.round(r.w * scaleX())),
        h: Math.max(1, Math.round(r.h * scaleY())),
      };
  done = true;
  void invoke("capture_finish", { rect });
});

addEventListener("contextmenu", (e) => e.preventDefault());
addEventListener("keydown", (e) => {
  if (e.key === "Escape") cancel();
});

void load();
