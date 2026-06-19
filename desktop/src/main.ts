import { scan, type Detection } from "@shotshield/core";
import { ocr, ocrAutoOrient, type Box, type OcrWord, type ProgressFn } from "./ocr.ts";
import type { FaceHit } from "./faces.ts";
import { orientedCanvas, loadImageEl } from "./image.ts";
import { locate, paint, type Region } from "./redact.ts";
import { downloadCanvas } from "./export.ts";
import { loadSettings, renderSettings, scanConfig } from "./settings.ts";
import { checkForUpdate, type PendingUpdate } from "./update.ts";

const stage = document.querySelector<HTMLDivElement>("#stage")!;
const stagePrompt = document.querySelector<HTMLDivElement>("#stagePrompt")!;
const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const fileInput = document.querySelector<HTMLInputElement>("#file")!;
const clearBtn = document.querySelector<HTMLButtonElement>("#clear")!;
const exportBtn = document.querySelector<HTMLButtonElement>("#export")!;
const rotateBtn = document.querySelector<HTMLButtonElement>("#rotate")!;
const compareBtn = document.querySelector<HTMLButtonElement>("#compare")!;
const input = document.querySelector<HTMLTextAreaElement>("#input")!;
const summary = document.querySelector<HTMLParagraphElement>("#summary")!;
const results = document.querySelector<HTMLDivElement>("#results")!;
const drawbox = document.querySelector<HTMLDivElement>("#drawbox")!;
const drawHint = document.querySelector<HTMLParagraphElement>("#drawHint")!;
const progress = document.querySelector<HTMLDivElement>("#progress")!;
const progressBar = document.querySelector<HTMLDivElement>("#progressBar")!;
const settingsBody = document.querySelector<HTMLDivElement>("#settingsBody")!;
const updateBanner = document.querySelector<HTMLDivElement>("#updateBanner")!;

// Detection settings (which categories run, the confidence floor), persisted.
const settings = loadSettings();

function showProgress(fraction: number): void {
  progress.hidden = false;
  progressBar.style.width = `${Math.round(fraction * 100)}%`;
}
function hideProgress(): void {
  progress.hidden = true;
  progressBar.style.width = "0%";
}

// Accent used to outline a finding's region when its row is hovered.
const accent = getComputedStyle(document.documentElement).getPropertyValue("--low").trim() || "#2563eb";
let hovered: Box[] | null = null;

// Don't echo full secrets back in the list — show just enough to recognise.
function mask(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= 6) return "•".repeat(Math.max(1, t.length));
  return `${t.slice(0, 3)}…${t.slice(-2)}`;
}

// ── Text path ──
function row(d: Detection): HTMLElement {
  const el = document.createElement("div");
  el.className = "hit";

  const dot = document.createElement("span");
  dot.className = `sev sev-${d.severity}`;
  dot.title = d.severity;

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = d.label;

  const match = document.createElement("code");
  match.className = "match";
  match.textContent = mask(d.text);

  el.append(dot, label, match);
  return el;
}

function scanText(): void {
  if (!input.value.trim()) {
    summary.textContent = "";
    results.replaceChildren();
    return;
  }
  const dets = scan(input.value, scanConfig(settings));
  results.replaceChildren(...dets.map(row));
  summary.textContent = dets.length === 0 ? "Nothing sensitive found." : `${dets.length} found`;
}

input.addEventListener("input", scanText);

// Re-run whatever is on screen when a setting changes — the text scan, and the
// image's findings (recomputed from the cached OCR, so no fresh read needed).
function onSettingsChange(): void {
  scanText();
  recomputeRegions();
}
renderSettings(settingsBody, settings, onSettingsChange);

// ── Image path ──
// Bumped on every load/clear so a slow OCR pass can't render stale results.
let gen = 0;
let currentImg: HTMLImageElement | null = null;
let sourceImg: HTMLImageElement | null = null; // the image as shown (post-rotation), for re-rotating
let regions: Region[] = [];
let manualBoxes: Box[] = []; // hand-drawn redaction rectangles, in image-pixel space
// The last OCR pass, cached so a settings change can re-derive findings without
// reading the image again. Detected faces are cached the same way.
let lastOcr: { text: string; words: OcrWord[] } | null = null;
let lastFaces: Region[] = [];

function displayImage(img: HTMLImageElement): void {
  sourceImg = img;
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext("2d")!.drawImage(img, 0, 0);
  canvas.hidden = false;
  stagePrompt.hidden = true;
  clearBtn.hidden = false;
  rotateBtn.hidden = false;
  drawHint.hidden = false;
  stage.classList.add("has-image");
}

async function scanImage(
  img: HTMLImageElement,
  token: number,
  opts: { autoOrient: boolean },
): Promise<void> {
  summary.textContent = "Reading image…";
  results.replaceChildren();
  showProgress(0);

  const onProgress: ProgressFn = (phase, fraction) => {
    if (token !== gen) return;
    summary.textContent =
      phase === "orienting" ? "Checking orientation…" : `Reading image… ${Math.round(fraction * 100)}%`;
    showProgress(fraction);
  };

  let text = "";
  let words: OcrWord[] = [];
  let working = img;
  try {
    if (opts.autoOrient) {
      const oriented = await ocrAutoOrient(img, onProgress);
      if (token !== gen) return;
      // The boxes come back in the upright frame, so show the image that way too.
      if (oriented.quarterTurns !== 0) {
        working = await loadImageEl(orientedCanvas(img, oriented.quarterTurns).toDataURL("image/png"));
        if (token !== gen) return;
        displayImage(working);
      }
      text = oriented.text;
      words = oriented.words;
    } else {
      const result = await ocr(img, onProgress);
      if (token !== gen) return;
      text = result.text;
      words = result.words;
    }
  } catch (err) {
    if (token !== gen) return;
    hideProgress();
    console.error("OCR failed", err);
    summary.textContent = `Couldn't read the image: ${err instanceof Error ? err.message : String(err)}`;
    return;
  }

  currentImg = working;
  lastOcr = { text, words };
  console.log("OCR done:", { chars: text.length, words: words.length });

  // Faces are best-effort and detected once per image, then cached: a model-load
  // failure must not drop the text findings, and toggling the Faces setting later
  // shouldn't re-run the detector.
  summary.textContent = "Looking for faces…";
  lastFaces = [];
  try {
    const { detectFaces } = await import("./faces.ts");
    const hits = await detectFaces(working);
    if (token !== gen) return;
    lastFaces = hits.map(faceRegion);
  } catch (err) {
    console.error("Face detection failed", err);
  }
  if (token !== gen) return;

  hideProgress();
  recomputeRegions();
}

// Build the redaction list from the cached OCR and faces under the current
// settings, then paint and render. Runs after a scan finishes and whenever a
// setting changes, so toggling a category never triggers a fresh OCR pass.
function recomputeRegions(): void {
  if (!lastOcr || !currentImg) return;
  const textRegions = lastOcr.text.trim()
    ? locate(scan(lastOcr.text, scanConfig(settings)), lastOcr.words)
    : [];
  const faceRegions = settings.faces ? lastFaces : [];
  regions = [...textRegions, ...faceRegions];
  paint(canvas, currentImg, regions, manualBoxes);
  renderRegions();
  exportBtn.hidden = false;
}

// Wrap a detected face as a redaction region, so it lists, toggles, paints and
// exports exactly like a text finding — hidden by default, since the portrait is
// usually the most identifying thing on an ID.
function faceRegion(hit: FaceHit): Region {
  return {
    detection: {
      category: "face",
      label: "Face",
      severity: "critical",
      start: 0,
      end: 0,
      text: "",
      confidence: hit.score,
      redactByDefault: true,
    },
    boxes: [hit.box],
    hidden: true,
  };
}

function renderRegions(): void {
  results.replaceChildren(...regions.map(regionRow), ...manualBoxes.map(manualRow));

  const parts: string[] = [];
  if (regions.length > 0) {
    const hidden = regions.filter((r) => r.hidden).length;
    parts.push(`${hidden} of ${regions.length} hidden`);
  }
  if (manualBoxes.length > 0) parts.push(`${manualBoxes.length} manual`);
  summary.textContent =
    parts.length > 0
      ? parts.join(" · ")
      : "Nothing sensitive found — drag on the image to redact anything by hand.";

  // Compare only makes sense once something is actually covered.
  compareBtn.hidden = !(regions.some((r) => r.hidden) || manualBoxes.length > 0);
}

// A finding row in image mode is a toggle: click to cover/uncover its region.
function regionRow(region: Region, index: number): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "hit hit-toggle";
  el.setAttribute("aria-pressed", String(region.hidden));

  const dot = document.createElement("span");
  dot.className = `sev sev-${region.detection.severity}`;
  dot.title = region.detection.severity;

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = region.detection.label;

  const match = document.createElement("code");
  match.className = "match";
  // A face has no text to mask — show its size instead.
  match.textContent =
    region.detection.category === "face"
      ? `${Math.round(region.boxes[0]?.w ?? 0)}×${Math.round(region.boxes[0]?.h ?? 0)} px`
      : mask(region.detection.text);

  const conf = document.createElement("span");
  conf.className = "conf";
  conf.textContent = `${Math.round(region.detection.confidence * 100)}%`;
  conf.title = "detection confidence";

  const pill = document.createElement("span");
  pill.className = "pill";
  pill.textContent = region.hidden ? "Hidden" : "Visible";

  el.append(dot, label, match, conf, pill);
  el.addEventListener("click", () => toggle(index));
  el.addEventListener("mouseenter", () => setHover(region.boxes));
  el.addEventListener("mouseleave", () => setHover(null));
  return el;
}

function toggle(index: number): void {
  const region = regions[index];
  if (!region || !currentImg) return;
  region.hidden = !region.hidden;
  repaint();
  renderRegions();
}

// ── Manual redaction ──
// Drag anywhere on the image to black out a region the scan can't catch — a
// face, an address, a signature. Boxes are stored in image-pixel space so they
// survive the canvas being scaled to fit, and painted onto the canvas itself so
// the saved PNG carries them.
function repaint(): void {
  if (!currentImg) return;
  paint(canvas, currentImg, regions, manualBoxes);
  if (hovered) {
    const ctx = canvas.getContext("2d")!;
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(2, canvas.width * 0.004);
    for (const b of hovered) ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.restore();
  }
}

// Outline a finding's region on the canvas while its row is hovered.
function setHover(boxes: Box[] | null): void {
  hovered = boxes && boxes.length ? boxes : null;
  repaint();
}

// Hold the Compare button to redraw the image without its redactions — a quick
// before/after to confirm the boxes cover the right thing. Releasing repaints the
// redacted view. (A press-and-hold button, not a slider, so it doesn't fight the
// canvas's drag-to-redact gesture.)
function peekOriginal(): void {
  if (currentImg) canvas.getContext("2d")!.drawImage(currentImg, 0, 0);
}
compareBtn.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  peekOriginal();
});
for (const ev of ["pointerup", "pointerleave", "pointercancel"]) {
  compareBtn.addEventListener(ev, () => repaint());
}

// A manual box, listed beside the auto findings. Clicking the row removes it.
function manualRow(box: Box, index: number): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "hit hit-toggle";
  el.setAttribute("aria-pressed", "true");

  const dot = document.createElement("span");
  dot.className = "sev sev-critical";
  dot.title = "manual";

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = "Redacted area";

  const size = document.createElement("code");
  size.className = "match";
  size.textContent = `${Math.round(box.w)}×${Math.round(box.h)}`;

  const pill = document.createElement("span");
  pill.className = "pill";
  pill.textContent = "Remove";

  el.append(dot, label, size, pill);
  el.addEventListener("click", () => {
    manualBoxes.splice(index, 1);
    repaint();
    renderRegions();
  });
  el.addEventListener("mouseenter", () => setHover([box]));
  el.addEventListener("mouseleave", () => setHover(null));
  return el;
}

// Map a pointer's client coordinates to image pixels, clamped to the canvas.
function toImageXY(clientX: number, clientY: number): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  const x = ((clientX - r.left) / r.width) * canvas.width;
  const y = ((clientY - r.top) / r.height) * canvas.height;
  return {
    x: Math.max(0, Math.min(canvas.width, x)),
    y: Math.max(0, Math.min(canvas.height, y)),
  };
}

let drag: { x: number; y: number; cx: number; cy: number } | null = null;

canvas.addEventListener("pointerdown", (e) => {
  if (!currentImg) return; // wait until this image's OCR pass has settled
  e.preventDefault();
  const p = toImageXY(e.clientX, e.clientY);
  drag = { x: p.x, y: p.y, cx: e.clientX, cy: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  // The live preview rectangle is drawn in the stage's own coordinate space.
  const s = stage.getBoundingClientRect();
  drawbox.style.left = `${Math.min(drag.cx, e.clientX) - s.left}px`;
  drawbox.style.top = `${Math.min(drag.cy, e.clientY) - s.top}px`;
  drawbox.style.width = `${Math.abs(e.clientX - drag.cx)}px`;
  drawbox.style.height = `${Math.abs(e.clientY - drag.cy)}px`;
  drawbox.hidden = false;
});

canvas.addEventListener("pointerup", (e) => {
  if (!drag) return;
  drawbox.hidden = true;
  const end = toImageXY(e.clientX, e.clientY);
  const x = Math.min(drag.x, end.x);
  const y = Math.min(drag.y, end.y);
  const w = Math.abs(end.x - drag.x);
  const h = Math.abs(end.y - drag.y);
  drag = null;
  // Require a real, big-enough rectangle. Written as `>=` so a NaN (e.g. a
  // zero-size canvas rect) fails the test instead of slipping through, the way
  // `w < 6` would.
  if (!(w >= 6 && h >= 6)) return;
  manualBoxes.push({ x, y, w, h });
  repaint();
  renderRegions();
});

canvas.addEventListener("pointercancel", () => {
  drag = null;
  drawbox.hidden = true;
});

// Phone photos can be 50MP+, which makes a huge canvas and a slow OCR pass; an
// extreme panorama can even exceed the WebView canvas limit. Cap the longest side
// so everything downstream (boxes, paint, export) works at a sane resolution.
const MAX_WORKING_DIM = 4096;
async function fitToWorkingSize(img: HTMLImageElement): Promise<HTMLImageElement> {
  if (Math.max(img.naturalWidth, img.naturalHeight) <= MAX_WORKING_DIM) return img;
  return loadImageEl(orientedCanvas(img, 0, MAX_WORKING_DIM).toDataURL("image/png"));
}

function loadImage(src: string, opts: { autoOrient: boolean }, token: number): void {
  loadImageEl(src)
    .then((img) => (token === gen ? fitToWorkingSize(img) : null))
    .then((img) => {
      if (!img || token !== gen) return;
      // A fresh image starts with no manual boxes and no settled OCR image, so
      // drawing stays disabled until this load's OCR pass finishes.
      currentImg = null;
      manualBoxes = [];
      displayImage(img);
      void scanImage(img, token, opts);
    })
    .catch(() => {
      if (token === gen) summary.textContent = "Couldn't load the image.";
    });
}

function handleFile(file: File | null | undefined): void {
  if (!file || !file.type.startsWith("image/")) return;
  const token = ++gen;
  const reader = new FileReader();
  reader.addEventListener("load", () =>
    loadImage(reader.result as string, { autoOrient: true }, token),
  );
  reader.readAsDataURL(file);
}

function clearImage(): void {
  gen++;
  currentImg = null;
  sourceImg = null;
  regions = [];
  manualBoxes = [];
  lastOcr = null;
  lastFaces = [];
  canvas.hidden = true;
  drawbox.hidden = true;
  stagePrompt.hidden = false;
  clearBtn.hidden = true;
  rotateBtn.hidden = true;
  compareBtn.hidden = true;
  exportBtn.hidden = true;
  drawHint.hidden = true;
  hideProgress();
  hovered = null;
  stage.classList.remove("has-image");
  summary.textContent = "";
  results.replaceChildren();
}

const canPick = () => !stage.classList.contains("has-image");

stage.addEventListener("click", () => canPick() && fileInput.click());
stage.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && canPick()) {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener("change", () => {
  handleFile(fileInput.files?.[0]);
  // Clear the value so choosing the same file again (e.g. after Clear) still
  // fires `change` — otherwise the picker sees no change and nothing loads.
  fileInput.value = "";
});
clearBtn.addEventListener("click", clearImage);
exportBtn.addEventListener("click", () => downloadCanvas(canvas, "shotshield-redacted.png"));
rotateBtn.addEventListener("click", () => {
  if (!sourceImg) return;
  // Manual rotate is a deliberate 90° nudge — don't re-run the auto search.
  const token = ++gen;
  loadImage(orientedCanvas(sourceImg, 1).toDataURL("image/png"), { autoOrient: false }, token);
});

stage.addEventListener("dragover", (e) => {
  e.preventDefault();
  stage.classList.add("dragover");
});
stage.addEventListener("dragleave", () => stage.classList.remove("dragover"));
stage.addEventListener("drop", (e) => {
  e.preventDefault();
  stage.classList.remove("dragover");
  handleFile(e.dataTransfer?.files?.[0]);
});

// Paste an image from the clipboard. Pasting text falls through untouched.
window.addEventListener("paste", (e) => {
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
  if (item) handleFile(item.getAsFile());
});

// ── Updates ──
function showUpdateBanner(update: PendingUpdate): void {
  updateBanner.replaceChildren();

  const text = document.createElement("span");
  text.className = "update-text";
  text.textContent = `ShotShield ${update.version} is available.`;

  const action = document.createElement("button");
  action.type = "button";
  action.className = "btn btn-primary update-action";
  action.textContent = "Update & restart";

  const later = document.createElement("button");
  later.type = "button";
  later.className = "btn update-later";
  later.textContent = "Later";
  later.addEventListener("click", () => (updateBanner.hidden = true));

  action.addEventListener("click", async () => {
    action.disabled = true;
    later.hidden = true;
    text.textContent = `Downloading ShotShield ${update.version}…`;
    try {
      await update.install((downloaded, total) => {
        text.textContent = total
          ? `Downloading… ${Math.round((downloaded / total) * 100)}%`
          : `Downloading… ${Math.round(downloaded / 1024)} KB`;
      });
      text.textContent = "Restarting…"; // the relaunch usually preempts this
    } catch (err) {
      console.error("Update failed", err);
      text.textContent = "Update failed — download it from the releases page instead.";
      action.disabled = false;
      action.textContent = "Retry";
      later.hidden = false;
    }
  });

  updateBanner.append(text, action, later);
  updateBanner.hidden = false;
}

// Check for a newer signed release on launch. Silent when there's nothing new or
// the check can't run (offline, no release yet, or running outside the app).
void (async () => {
  const update = await checkForUpdate();
  if (update) showUpdateBanner(update);
})();
