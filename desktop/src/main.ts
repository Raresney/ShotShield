import { scan, type Detection } from "@shotshield/core";
import { ocr, ocrAutoOrient, type OcrWord, type ProgressFn } from "./ocr.ts";
import { orientedCanvas, loadImageEl } from "./image.ts";
import { locate, paint, type Region } from "./redact.ts";
import { downloadCanvas } from "./export.ts";

const stage = document.querySelector<HTMLDivElement>("#stage")!;
const stagePrompt = document.querySelector<HTMLDivElement>("#stagePrompt")!;
const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const fileInput = document.querySelector<HTMLInputElement>("#file")!;
const clearBtn = document.querySelector<HTMLButtonElement>("#clear")!;
const exportBtn = document.querySelector<HTMLButtonElement>("#export")!;
const rotateBtn = document.querySelector<HTMLButtonElement>("#rotate")!;
const input = document.querySelector<HTMLTextAreaElement>("#input")!;
const summary = document.querySelector<HTMLParagraphElement>("#summary")!;
const results = document.querySelector<HTMLDivElement>("#results")!;

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
  const dets = scan(input.value);
  results.replaceChildren(...dets.map(row));
  summary.textContent = dets.length === 0 ? "Nothing sensitive found." : `${dets.length} found`;
}

input.addEventListener("input", scanText);

// ── Image path ──
// Bumped on every load/clear so a slow OCR pass can't render stale results.
let gen = 0;
let currentImg: HTMLImageElement | null = null;
let sourceImg: HTMLImageElement | null = null; // the image as shown (post-rotation), for re-rotating
let regions: Region[] = [];

function displayImage(img: HTMLImageElement): void {
  sourceImg = img;
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext("2d")!.drawImage(img, 0, 0);
  canvas.hidden = false;
  stagePrompt.hidden = true;
  clearBtn.hidden = false;
  rotateBtn.hidden = false;
  stage.classList.add("has-image");
}

async function scanImage(
  img: HTMLImageElement,
  token: number,
  opts: { autoOrient: boolean },
): Promise<void> {
  summary.textContent = "Reading image…";
  results.replaceChildren();

  const onProgress: ProgressFn = (phase, fraction) => {
    if (token !== gen) return;
    summary.textContent =
      phase === "orienting" ? "Checking orientation…" : `Reading image… ${Math.round(fraction * 100)}%`;
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
    console.error("OCR failed", err);
    summary.textContent = `Couldn't read the image: ${err instanceof Error ? err.message : String(err)}`;
    return;
  }

  currentImg = working;
  console.log("OCR done:", { chars: text.length, words: words.length });

  if (!text.trim()) {
    regions = [];
    paint(canvas, working, regions);
    exportBtn.hidden = false;
    summary.textContent = "No readable text found — if the photo is sideways, try Rotate.";
    return;
  }

  regions = locate(scan(text), words);
  paint(canvas, working, regions);
  renderRegions();
  exportBtn.hidden = false;
}

function renderRegions(): void {
  results.replaceChildren(...regions.map(regionRow));
  if (regions.length === 0) {
    summary.textContent = "Nothing sensitive found. If the text looks sideways, try Rotate.";
    return;
  }
  const hidden = regions.filter((r) => r.hidden).length;
  summary.textContent = `${hidden} of ${regions.length} hidden`;
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
  match.textContent = mask(region.detection.text);

  const pill = document.createElement("span");
  pill.className = "pill";
  pill.textContent = region.hidden ? "Hidden" : "Visible";

  el.append(dot, label, match, pill);
  el.addEventListener("click", () => toggle(index));
  return el;
}

function toggle(index: number): void {
  const region = regions[index];
  if (!region || !currentImg) return;
  region.hidden = !region.hidden;
  paint(canvas, currentImg, regions);
  renderRegions();
}

function loadImage(src: string, opts: { autoOrient: boolean }, token: number): void {
  loadImageEl(src)
    .then((img) => {
      if (token !== gen) return;
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
  canvas.hidden = true;
  stagePrompt.hidden = false;
  clearBtn.hidden = true;
  rotateBtn.hidden = true;
  exportBtn.hidden = true;
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
