import { scan, type Detection } from "@shotshield/core";
import { ocr } from "./ocr.ts";

const stage = document.querySelector<HTMLDivElement>("#stage")!;
const stagePrompt = document.querySelector<HTMLDivElement>("#stagePrompt")!;
const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const fileInput = document.querySelector<HTMLInputElement>("#file")!;
const clearBtn = document.querySelector<HTMLButtonElement>("#clear")!;
const input = document.querySelector<HTMLTextAreaElement>("#input")!;
const summary = document.querySelector<HTMLParagraphElement>("#summary")!;
const results = document.querySelector<HTMLDivElement>("#results")!;

// ── Findings list (shared by the text and image paths) ──
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
  match.textContent = d.text; // textContent, never innerHTML — this is untrusted

  el.append(dot, label, match);
  return el;
}

function renderList(dets: Detection[], emptyHint: string): void {
  results.replaceChildren(...dets.map(row));
  if (dets.length === 0) summary.textContent = emptyHint;
  else summary.textContent = `${dets.length} found`;
}

// ── Text path ──
function scanText(): void {
  if (!input.value.trim()) {
    summary.textContent = "";
    results.replaceChildren();
    return;
  }
  renderList(scan(input.value), "Nothing sensitive found.");
}

input.addEventListener("input", scanText);

// ── Image path ──
// Bumped on every load/clear so a slow OCR pass can't render stale results.
let gen = 0;

function showImage(img: HTMLImageElement): void {
  const ctx = canvas.getContext("2d")!;
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  ctx.drawImage(img, 0, 0);
  canvas.hidden = false;
  stagePrompt.hidden = true;
  clearBtn.hidden = false;
  stage.classList.add("has-image");
  void scanImage(img, gen);
}

async function scanImage(img: HTMLImageElement, token: number): Promise<void> {
  summary.textContent = "Reading image…";
  results.replaceChildren();
  const { text } = await ocr(img, (p) => {
    if (token === gen) summary.textContent = `Reading image… ${Math.round(p * 100)}%`;
  });
  if (token !== gen) return; // a newer image (or a clear) superseded this one
  renderList(scan(text), "Nothing sensitive found.");
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
  canvas.hidden = true;
  stagePrompt.hidden = false;
  clearBtn.hidden = true;
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
