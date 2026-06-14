import { scan, type Detection } from "@shotshield/core";
import { ocr } from "./ocr.ts";
import { locate, paint, type Region } from "./redact.ts";
import { downloadCanvas } from "./export.ts";

const stage = document.querySelector<HTMLDivElement>("#stage")!;
const stagePrompt = document.querySelector<HTMLDivElement>("#stagePrompt")!;
const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const fileInput = document.querySelector<HTMLInputElement>("#file")!;
const clearBtn = document.querySelector<HTMLButtonElement>("#clear")!;
const exportBtn = document.querySelector<HTMLButtonElement>("#export")!;
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
let regions: Region[] = [];

function showImage(img: HTMLImageElement): void {
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext("2d")!.drawImage(img, 0, 0);
  canvas.hidden = false;
  stagePrompt.hidden = true;
  clearBtn.hidden = false;
  stage.classList.add("has-image");
  void scanImage(img, gen);
}

async function scanImage(img: HTMLImageElement, token: number): Promise<void> {
  summary.textContent = "Reading image…";
  results.replaceChildren();
  const { text, words } = await ocr(img, (p) => {
    if (token === gen) summary.textContent = `Reading image… ${Math.round(p * 100)}%`;
  });
  if (token !== gen) return; // a newer image (or a clear) superseded this one
  currentImg = img;
  regions = locate(scan(text), words);
  paint(canvas, img, regions);
  renderRegions();
  exportBtn.hidden = false;
}

function renderRegions(): void {
  results.replaceChildren(...regions.map(regionRow));
  if (regions.length === 0) {
    summary.textContent = "Nothing sensitive found.";
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

function loadImage(src: string): void {
  const img = new Image();
  img.addEventListener("load", () => showImage(img));
  img.src = src;
}

function handleFile(file: File | null | undefined): void {
  if (!file || !file.type.startsWith("image/")) return;
  gen++;
  const reader = new FileReader();
  reader.addEventListener("load", () => loadImage(reader.result as string));
  reader.readAsDataURL(file);
}

function clearImage(): void {
  gen++;
  currentImg = null;
  regions = [];
  canvas.hidden = true;
  stagePrompt.hidden = false;
  clearBtn.hidden = true;
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
fileInput.addEventListener("change", () => handleFile(fileInput.files?.[0]));
clearBtn.addEventListener("click", clearImage);
exportBtn.addEventListener("click", () => downloadCanvas(canvas, "shotshield-redacted.png"));

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
