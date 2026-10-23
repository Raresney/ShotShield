import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";

import { scan, type Detection, type Severity } from "@shotshield/core";
import { ocr, ocrAutoOrient, ocrSecondLook, type Box, type OcrWord, type ProgressFn } from "./ocr.ts";
import type { FaceHit } from "./faces.ts";
import { orientedCanvas, loadImageEl } from "./image.ts";
import { locate, mergeRegions, needsSecondLook, paint, redactText, regionAt, SEVERITY_RANK, type Region } from "./redact.ts";
import { canvasBlob, redactedName, saveCanvas } from "./export.ts";
import { loadSettings, renderSettings, scanConfig } from "./settings.ts";
import { checkForUpdate, type PendingUpdate } from "./update.ts";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const stage = $<HTMLDivElement>("#stage");
const stagePrompt = $<HTMLDivElement>("#stagePrompt");
const canvas = $<HTMLCanvasElement>("#canvas");
const fileInput = $<HTMLInputElement>("#file");
const clearBtn = $<HTMLButtonElement>("#clear");
const exportBtn = $<HTMLButtonElement>("#export");
const copyBtn = $<HTMLButtonElement>("#copyClipboard");
const copyLabel = copyBtn.querySelector("span")!;
const rotateBtn = $<HTMLButtonElement>("#rotate");
const compareBtn = $<HTMLButtonElement>("#compare");
const toggleAllBtn = $<HTMLButtonElement>("#toggleAll");
const undoBtn = $<HTMLButtonElement>("#undo");
const zoomReset = $<HTMLButtonElement>("#zoomReset");
const input = $<HTMLTextAreaElement>("#input");
const summary = $<HTMLParagraphElement>("#summary");
const results = $<HTMLDivElement>("#results");
const drawbox = $<HTMLDivElement>("#drawbox");
const drawHint = $<HTMLParagraphElement>("#drawHint");
const progress = $<HTMLDivElement>("#progress");
const progressBar = $<HTMLDivElement>("#progressBar");
const progressStage = $<HTMLElement>("#progressStage");
const settingsBody = $<HTMLDivElement>("#settingsBody");
const updateBanner = $<HTMLDivElement>("#updateBanner");
const stageActions = $<HTMLDivElement>("#stageActions");
const pickBtn = $<HTMLButtonElement>("#pickBtn");
const pasteBtn = $<HTMLButtonElement>("#pasteBtn");
const statusEngine = $<HTMLElement>("#statusEngine");
const findingsCount = $<HTMLElement>("#findingsCount");
const meterBar = $<HTMLElement>("#meterBar");
const statusProtected = $<HTMLElement>("#statusProtected");
const statusExposed = $<HTMLElement>("#statusExposed");
const statusExposedWrap = $<HTMLElement>("#statusExposedWrap");
const workspaceMeta = $<HTMLElement>("#workspaceMeta");
const themeToggle = $<HTMLButtonElement>("#themeToggle");
const modeImage = $<HTMLButtonElement>("#modeImage");
const modeText = $<HTMLButtonElement>("#modeText");
const imagePane = $<HTMLElement>("#imagePane");
const textPane = $<HTMLElement>("#textPane");
const settingsBtn = $<HTMLButtonElement>("#settingsBtn");
const settingsClose = $<HTMLButtonElement>("#settingsClose");
const settingsDrawer = $<HTMLElement>("#settingsDrawer");
const drawerBackdrop = $<HTMLElement>("#drawerBackdrop");
const sevChips = [...document.querySelectorAll<HTMLButtonElement>(".sev-chip")];
const sevCounts: Record<Severity, HTMLElement> = {
  critical: $("#criticalCount"),
  high: $("#highCount"),
  medium: $("#mediumCount"),
  low: $("#lowCount"),
};

// Detection settings (which categories run, the confidence floor, cover style), persisted.
const settings = loadSettings();

const svgIcon = (id: string): SVGSVGElement => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${id}`);
  svg.append(use);
  return svg;
};

// ── Theme ──
// Dark by default. The toggle sets data-theme on the root — the hook every CSS
// theme rule keys off — and the choice survives a restart.
type Theme = "dark" | "light";
function applyTheme(t: Theme): void {
  if (t === "light") document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");
  themeToggle.setAttribute("aria-label", `Switch to ${t === "light" ? "dark" : "light"} theme`);
  themeToggle.title = t === "light" ? "Dark theme" : "Light theme";
}
let theme: Theme = (() => {
  try {
    return localStorage.getItem("shotshield.theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
})();
applyTheme(theme);
themeToggle.addEventListener("click", () => {
  theme = theme === "light" ? "dark" : "light";
  try {
    localStorage.setItem("shotshield.theme", theme);
  } catch {
    /* storage unavailable — applies for this session only */
  }
  applyTheme(theme);
});

// ── Settings drawer ──
function setDrawer(open: boolean): void {
  settingsDrawer.hidden = !open;
  drawerBackdrop.hidden = !open;
  settingsBtn.setAttribute("aria-expanded", String(open));
  if (open) settingsClose.focus();
  else if (document.activeElement && settingsDrawer.contains(document.activeElement)) settingsBtn.focus();
}
settingsBtn.addEventListener("click", () => setDrawer(settingsDrawer.hidden));
settingsClose.addEventListener("click", () => setDrawer(false));
drawerBackdrop.addEventListener("click", () => setDrawer(false));

// ── Mode: image or pasted text ──
type Mode = "image" | "text";
let mode: Mode = "image";
function setMode(m: Mode): void {
  mode = m;
  modeImage.setAttribute("aria-selected", String(m === "image"));
  modeText.setAttribute("aria-selected", String(m === "text"));
  imagePane.hidden = m !== "image";
  textPane.hidden = m !== "text";
  // The footer acts on whatever the mode shows: the redacted image, or the
  // pasted text with its findings swapped for markers.
  exportBtn.hidden = m === "text";
  copyLabel.textContent = m === "text" ? "Copy redacted text" : "Copy";
  copyBtn.title = m === "text" ? "Copy the text with every finding replaced" : "Copy the redacted image";
  copyBtn.disabled = m === "text" ? !input.value.trim() : !currentImg;
  workspaceMeta.hidden = m === "text";
  sevFilter = null;
  if (m === "text") {
    scanText();
    input.focus();
  } else if (currentImg) {
    renderRegions();
  } else {
    showEmpty();
  }
}
modeImage.addEventListener("click", () => setMode("image"));
modeText.addEventListener("click", () => setMode("text"));

// ── Dashboard read-outs ──
// One place that fills the counts, the coverage meter and the status bar.
function showDashboard(severities: Severity[], protectedCount: number, exposedCount: number): void {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const s of severities) counts[s]++;
  findingsCount.textContent = String(severities.length + (mode === "image" ? manualBoxes.length : 0));
  for (const chip of sevChips) {
    const sev = chip.dataset.sev as Severity;
    sevCounts[sev].textContent = String(counts[sev]);
    // A chip that counts nothing reads dim and can't be used as a filter.
    chip.classList.toggle("zero", counts[sev] === 0);
    chip.setAttribute("aria-pressed", String(sevFilter === sev));
  }
  const total = protectedCount + exposedCount;
  meterBar.style.width = total ? `${(protectedCount / total) * 100}%` : "0%";
  meterBar.classList.toggle("partial", exposedCount > 0);
  statusProtected.textContent = String(protectedCount);
  statusExposed.textContent = String(exposedCount);
  statusExposedWrap.hidden = exposedCount === 0;
}

// Click a severity chip to show only that severity; click again for all.
let sevFilter: Severity | null = null;
for (const chip of sevChips) {
  chip.addEventListener("click", () => {
    const sev = chip.dataset.sev as Severity;
    sevFilter = sevFilter === sev ? null : sev;
    if (mode === "text") scanText();
    else renderRegions();
  });
}

function showEmpty(): void {
  const el = document.createElement("div");
  el.className = "empty";
  const title = document.createElement("strong");
  const copy = document.createElement("span");
  if (mode === "text") {
    title.textContent = input.value.trim() ? "Nothing sensitive found" : "Nothing scanned yet";
    copy.textContent = input.value.trim()
      ? "No secrets or personal data in this text."
      : "Paste text on the left — findings appear here as you type.";
  } else {
    title.textContent = "No findings yet";
    copy.textContent = "Scan a screenshot and every detection lands here.";
  }
  el.append(svgIcon("i-shield"), title, copy);
  results.classList.remove("fresh");
  results.replaceChildren(el);
  summary.textContent = "";
  showDashboard([], 0, 0);
}

// The status pill names the stage the scan is in (Reading / Orientation /
// Second look / Faces), so a scan feels like a pipeline, not one opaque wait.
// A stage with no measurable fraction runs the bar indeterminate.
function showProgress(fraction: number | null, label = "Scanning"): void {
  progress.hidden = false;
  progressStage.textContent = label;
  summary.textContent = `${label}…`;
  progressBar.classList.toggle("indeterminate", fraction === null);
  progressBar.style.width = fraction === null ? "" : `${Math.round(fraction * 100)}%`;
  statusEngine.textContent = "Scanning";
  statusEngine.classList.add("busy");
}
function hideProgress(): void {
  progress.hidden = true;
  progressBar.classList.remove("indeterminate");
  progressBar.style.width = "0%";
  statusEngine.textContent = "Ready";
  statusEngine.classList.remove("busy");
}

// Accent used to outline a finding's region when its row is hovered. Read live
// so it follows the active theme.
function accentColor(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#2dd4bf";
}
let hovered: Box[] | null = null;

// Don't echo full secrets back in the list — show just enough to recognise.
function mask(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= 6) return "•".repeat(Math.max(1, t.length));
  return `${t.slice(0, 3)}…${t.slice(-2)}`;
}

// A finding row: severity bar, label, masked value + confidence, state badge.
function hitRow(opts: {
  sev: Severity | "manual";
  label: string;
  value: string;
  confidence?: number;
  state: { text: string; icon: string };
  pressed?: boolean;
  tag?: "button" | "div";
  index?: number;
}): HTMLElement {
  const el = document.createElement(opts.tag ?? "button");
  el.className = "hit";
  el.dataset.sev = opts.sev;
  el.style.setProperty("--i", String(opts.index ?? 0));
  if (el instanceof HTMLButtonElement) el.type = "button";
  if (opts.pressed !== undefined) el.setAttribute("aria-pressed", String(opts.pressed));

  const body = document.createElement("span");
  body.className = "hit-body";
  const label = document.createElement("span");
  label.className = "hit-label";
  label.textContent = opts.label;
  const meta = document.createElement("span");
  meta.className = "hit-meta";
  const code = document.createElement("code");
  code.textContent = opts.value;
  meta.append(code);
  if (opts.confidence !== undefined) {
    const conf = document.createElement("span");
    conf.textContent = `${Math.round(opts.confidence * 100)}%`;
    conf.title = "Detection confidence";
    meta.append(conf);
  }
  body.append(label, meta);

  const state = document.createElement("span");
  state.className = "hit-state";
  state.append(svgIcon(opts.state.icon), opts.state.text);

  el.append(body, state);
  return el;
}

// ── Text path ──
function scanText(): void {
  if (mode !== "text") return;
  if (!input.value.trim()) {
    copyBtn.disabled = true;
    showEmpty();
    return;
  }
  const dets = scan(input.value, scanConfig(settings));
  copyBtn.disabled = false;
  if (dets.length === 0) {
    showEmpty();
    summary.textContent = "Nothing sensitive found";
    return;
  }
  const shown = dets
    .filter((d) => !sevFilter || d.severity === sevFilter)
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  // Text results re-render on every keystroke — no entrance animation, or the
  // list would flicker while typing.
  results.classList.remove("fresh");
  results.replaceChildren(
    ...shown.map((d: Detection) => {
      const row = hitRow({
        sev: d.severity,
        label: d.label,
        value: mask(d.text),
        confidence: d.confidence,
        state: { text: "Found", icon: "i-eye" },
        tag: "div",
      });
      row.classList.add("hit-static");
      return row;
    }),
  );
  summary.textContent = `${dets.length} ${dets.length === 1 ? "thing" : "things"} to remove before sharing`;
  // Pasted text is only flagged, never covered — every hit counts as exposed.
  showDashboard(dets.map((d) => d.severity), 0, dets.length);
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
let sourceName: string | null = null;
let regions: Region[] = [];
let manualBoxes: Box[] = []; // hand-drawn redaction rectangles, in image-pixel space
// Undo/redo history for the manual boxes: each entry is a full snapshot of the
// list. Both are reset when the image changes.
let undoStack: Box[][] = [];
let redoStack: Box[][] = [];
// The OCR passes for the current image (one, or two when the second look ran),
// cached so a settings change can re-derive findings without reading the image
// again. Detected faces are cached the same way.
let lastOcr: { text: string; words: OcrWord[] }[] = [];
let lastFaces: Region[] = [];

showEmpty();

function displayImage(img: HTMLImageElement): void {
  sourceImg = img;
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext("2d")!.drawImage(img, 0, 0);
  canvas.hidden = false;
  stagePrompt.hidden = true;
  stageActions.hidden = false;
  drawHint.hidden = false;
  stage.classList.add("has-image");
  workspaceMeta.textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
  resetView();
}

async function scanImage(
  img: HTMLImageElement,
  token: number,
  opts: { autoOrient: boolean },
): Promise<void> {
  results.replaceChildren();
  exportBtn.disabled = true;
  copyBtn.disabled = true;
  showProgress(0, "Reading");

  // Both OCR passes report the same "reading" phase; this flag relabels the
  // second one so the status pill tells them apart.
  let secondPass = false;
  const onProgress: ProgressFn = (phase, fraction) => {
    if (token !== gen) return;
    if (phase === "orienting") showProgress(fraction, "Checking orientation");
    else showProgress(fraction, secondPass ? "Taking a closer look" : "Reading text");
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
  lastOcr = [{ text, words }];

  // Second look: when the image clearly reads as a Romanian ID but the CNP —
  // the field a marginal, scale-dependent read loses most often — came back
  // empty, retry once at a deliberately different render scale and keep both
  // passes. Best-effort: a retry failure must not drop the first pass.
  const firstDets = scan(text, scanConfig(settings));
  if (needsSecondLook(firstDets, text, settings.enabled.national_id ?? true)) {
    secondPass = true;
    showProgress(0, "Taking a closer look");
    try {
      const second = await ocrSecondLook(working, onProgress);
      if (token !== gen) return;
      if (second.text.trim()) lastOcr.push(second);
    } catch (err) {
      console.error("Second OCR pass failed", err);
    }
    if (token !== gen) return;
  }

  // Faces are best-effort and detected once per image, then cached: a model-load
  // failure must not drop the text findings, and toggling the Faces setting later
  // shouldn't re-run the detector.
  showProgress(null, "Looking for faces");
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
  recomputeRegions(true);
}

// Build the redaction list from the cached OCR and faces under the current
// settings, then paint and render. Runs after a scan finishes and whenever a
// setting changes, so toggling a category never triggers a fresh OCR pass.
function recomputeRegions(fresh = false): void {
  if (lastOcr.length === 0 || !currentImg) return;
  // Union the passes: the second look mostly re-reads what the first saw, so
  // duplicate hits (same category, same spot) collapse and only what one pass
  // caught alone — the missed CNP — comes through as a new region.
  let textRegions: Region[] = [];
  for (const pass of lastOcr) {
    if (!pass.text.trim()) continue;
    textRegions = mergeRegions(textRegions, locate(scan(pass.text, scanConfig(settings)), pass.words));
  }
  const faceRegions = settings.faces ? lastFaces : [];
  regions = [...textRegions, ...faceRegions];
  repaint();
  exportBtn.disabled = false;
  if (mode === "image") {
    copyBtn.disabled = false;
    renderRegions(fresh);
  }
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

// `fresh` marks a brand-new scan: only then do rows play their stagger-in
// animation. Re-renders (toggling a region, changing a setting, undo) keep the
// list still — replaying the entrance on every click reads as flicker.
function renderRegions(fresh = false): void {
  undoBtn.disabled = undoStack.length === 0;
  const hiddenCount = regions.filter((r) => r.hidden).length;
  const exposedCount = regions.length - hiddenCount;
  compareBtn.hidden = !(hiddenCount > 0 || manualBoxes.length > 0);
  toggleAllBtn.hidden = regions.length === 0;
  toggleAllBtn.replaceChildren(svgIcon(exposedCount > 0 ? "i-eye-off" : "i-eye"));
  toggleAllBtn.title = exposedCount > 0 ? "Cover all (Space)" : "Uncover all (Space)";

  if (regions.length === 0 && manualBoxes.length === 0) {
    showEmpty();
    summary.textContent = currentImg ? "Nothing sensitive found" : "";
    const empty = results.querySelector(".empty");
    if (currentImg && empty) {
      empty.querySelector("strong")!.textContent = "Nothing sensitive found";
      empty.querySelector("span")!.textContent = "Drag on the image to cover anything by hand.";
    }
    return;
  }

  results.classList.toggle("fresh", fresh);
  // Scariest first: a critical hit should never hide below the fold.
  const ordered = regions
    .map((region, index) => ({ region, index }))
    .filter(({ region }) => !sevFilter || region.detection.severity === sevFilter)
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.region.detection.severity] - SEVERITY_RANK[b.region.detection.severity],
    );
  results.replaceChildren(
    ...ordered.map(({ region, index }, i) => regionRow(region, index, i)),
    ...(sevFilter ? [] : manualBoxes.map((b, i) => manualRow(b, i, ordered.length + i))),
  );

  const parts: string[] = [];
  if (regions.length > 0) parts.push(`${hiddenCount} of ${regions.length} covered`);
  if (manualBoxes.length > 0) parts.push(`${manualBoxes.length} drawn by hand`);
  summary.textContent = parts.join(" · ");

  // Hand-drawn boxes count toward what's covered, but only detections feed the
  // severity read-outs — a box isn't a "finding".
  showDashboard(
    regions.map((r) => r.detection.severity),
    hiddenCount + manualBoxes.length,
    exposedCount,
  );
}

// A finding row in image mode is a toggle: click to cover/uncover its region.
function regionRow(region: Region, index: number, position: number): HTMLElement {
  const d = region.detection;
  const el = hitRow({
    sev: d.severity,
    label: d.label,
    // A face has no text to mask — show its size instead.
    value:
      d.category === "face"
        ? `${Math.round(region.boxes[0]?.w ?? 0)} × ${Math.round(region.boxes[0]?.h ?? 0)} px`
        : mask(d.text),
    confidence: d.confidence,
    state: region.hidden ? { text: "Covered", icon: "i-eye-off" } : { text: "Visible", icon: "i-eye" },
    pressed: region.hidden,
    index: position,
  });
  el.title = region.hidden ? "Click to uncover" : "Click to cover";
  el.addEventListener("click", () => toggle(index));
  el.addEventListener("mouseenter", () => setHover(region.boxes));
  el.addEventListener("mouseleave", () => setHover(null));
  // Keyboard users get the same region outline when they tab onto the row.
  el.addEventListener("focus", () => setHover(region.boxes));
  el.addEventListener("blur", () => setHover(null));
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
// Drag anywhere on the image to cover a region the scan can't catch — an
// address, a signature. Boxes are stored in image-pixel space so they survive
// the canvas being scaled to fit, and painted onto the canvas itself so the
// saved PNG carries them.
function pushManualHistory(): void {
  undoStack.push(manualBoxes.map((b) => ({ ...b })));
  redoStack = [];
}
function undoManual(): void {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(manualBoxes.map((b) => ({ ...b })));
  manualBoxes = prev;
  repaint();
  renderRegions();
}
function redoManual(): void {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(manualBoxes.map((b) => ({ ...b })));
  manualBoxes = next;
  repaint();
  renderRegions();
}
undoBtn.addEventListener("click", undoManual);

// Cover or uncover every detected region at once (Space). While anything is
// still visible, hide it all; once everything's hidden, the next press reveals it.
function toggleAllRegions(): void {
  if (!currentImg || regions.length === 0) return;
  const anyVisible = regions.some((r) => !r.hidden);
  for (const r of regions) r.hidden = anyVisible;
  repaint();
  renderRegions();
}
toggleAllBtn.addEventListener("click", toggleAllRegions);

function repaint(): void {
  if (!currentImg) return;
  paint(canvas, currentImg, regions, manualBoxes, settings.cover);
  if (hovered) {
    const ctx = canvas.getContext("2d")!;
    ctx.save();
    ctx.strokeStyle = accentColor();
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
// before/after. A press-and-hold button, not a slider, so it doesn't fight the
// canvas's drag-to-redact gesture.
compareBtn.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  if (currentImg) canvas.getContext("2d")!.drawImage(currentImg, 0, 0);
});
for (const ev of ["pointerup", "pointerleave", "pointercancel"]) {
  compareBtn.addEventListener(ev, () => repaint());
}

// A hand-drawn box, listed beside the findings. Clicking the row removes it.
function manualRow(box: Box, index: number, position: number): HTMLElement {
  const el = hitRow({
    sev: "manual",
    label: "Drawn by hand",
    value: `${Math.round(box.w)} × ${Math.round(box.h)} px`,
    state: { text: "Remove", icon: "i-trash" },
    pressed: true,
    index: position,
  });
  el.classList.add("hit-manual");
  el.addEventListener("click", () => {
    pushManualHistory();
    manualBoxes.splice(index, 1);
    setHover(null);
    renderRegions();
  });
  el.addEventListener("mouseenter", () => setHover([box]));
  el.addEventListener("mouseleave", () => setHover(null));
  el.addEventListener("focus", () => setHover([box]));
  el.addEventListener("blur", () => setHover(null));
  return el;
}

// Map a pointer's client coordinates to image pixels, clamped to the canvas.
// getBoundingClientRect includes the zoom transform, so this holds at any zoom.
function toImageXY(clientX: number, clientY: number): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  const x = ((clientX - r.left) / r.width) * canvas.width;
  const y = ((clientY - r.top) / r.height) * canvas.height;
  return {
    x: Math.max(0, Math.min(canvas.width, x)),
    y: Math.max(0, Math.min(canvas.height, y)),
  };
}

// ── Zoom & pan ──
// A CSS transform on the canvas (origin top-left): the image keeps its fitted
// layout box, and the transform scales and shifts it on top. Ctrl+wheel and
// +/-/0 zoom toward the cursor or centre; the wheel and a middle-drag pan.
const view = { z: 1, tx: 0, ty: 0 };
const MAX_ZOOM = 8;

function applyView(): void {
  if (view.z <= 1) Object.assign(view, { z: 1, tx: 0, ty: 0 });
  canvas.style.transform =
    view.z === 1 ? "" : `translate(${view.tx}px, ${view.ty}px) scale(${view.z})`;
  stage.classList.toggle("zoomed", view.z > 1);
  // Show the real pixel scale (100% = one image pixel per screen pixel).
  const shown = canvas.getBoundingClientRect().width * devicePixelRatio;
  const scale = canvas.width ? shown / canvas.width : 1;
  zoomReset.textContent = `${Math.round(scale * 100)}%`;
  // Past 150% show crisp pixels, so a box can be drawn exactly on a glyph edge.
  stage.classList.toggle("magnified", scale > 1.5);
}

function zoomAt(clientX: number, clientY: number, factor: number): void {
  const next = Math.max(1, Math.min(MAX_ZOOM, view.z * factor));
  if (next === view.z) return;
  // Keep the image point under the cursor fixed. With origin 0 0 the canvas's
  // untransformed left edge is rect.left - tx.
  const r = canvas.getBoundingClientRect();
  const left = r.left - view.tx;
  const top = r.top - view.ty;
  const qx = (clientX - left - view.tx) / view.z;
  const qy = (clientY - top - view.ty) / view.z;
  view.z = next;
  view.tx = clientX - left - next * qx;
  view.ty = clientY - top - next * qy;
  applyView();
}

function zoomCentre(factor: number): void {
  const s = stage.getBoundingClientRect();
  zoomAt(s.left + s.width / 2, s.top + s.height / 2, factor);
}

function resetView(): void {
  Object.assign(view, { z: 1, tx: 0, ty: 0 });
  applyView();
}

stage.addEventListener(
  "wheel",
  (e) => {
    if (!stage.classList.contains("has-image")) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
    } else if (view.z > 1) {
      e.preventDefault();
      view.tx -= e.shiftKey ? e.deltaY : e.deltaX;
      view.ty -= e.shiftKey ? 0 : e.deltaY;
      applyView();
    }
  },
  { passive: false },
);
zoomReset.addEventListener("click", resetView);
new ResizeObserver(() => {
  if (stage.classList.contains("has-image")) applyView();
}).observe(stage);

// ── Pointer on the image ──
// A drag draws a manual box; a click on a finding toggles it; a middle-drag
// pans. Hovering a finding outlines it, same as hovering its card.
let drag: { x: number; y: number; cx: number; cy: number } | null = null;
let pan: { cx: number; cy: number; tx: number; ty: number } | null = null;
let canvasHover: number | null = null;

canvas.addEventListener("pointerdown", (e) => {
  if (!currentImg) return; // wait until this image's OCR pass has settled
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  if (e.button === 1) {
    pan = { cx: e.clientX, cy: e.clientY, tx: view.tx, ty: view.ty };
    stage.classList.add("panning");
    return;
  }
  if (e.button !== 0) return;
  const p = toImageXY(e.clientX, e.clientY);
  drag = { x: p.x, y: p.y, cx: e.clientX, cy: e.clientY };
});

canvas.addEventListener("pointermove", (e) => {
  if (pan) {
    view.tx = pan.tx + (e.clientX - pan.cx);
    view.ty = pan.ty + (e.clientY - pan.cy);
    applyView();
    return;
  }
  if (!drag) {
    if (!currentImg) return;
    const p = toImageXY(e.clientX, e.clientY);
    const hit = regionAt(regions, p.x, p.y);
    if (hit !== canvasHover) {
      canvasHover = hit;
      canvas.classList.toggle("over-region", hit !== null);
      setHover(hit === null ? null : regions[hit]!.boxes);
    }
    return;
  }
  // The live preview rectangle is drawn in the stage's own coordinate space,
  // clamped to the image so it never spills past the edge.
  const s = stage.getBoundingClientRect();
  const c = canvas.getBoundingClientRect();
  const ex = Math.max(c.left, Math.min(c.right, e.clientX));
  const ey = Math.max(c.top, Math.min(c.bottom, e.clientY));
  drawbox.style.left = `${Math.min(drag.cx, ex) - s.left}px`;
  drawbox.style.top = `${Math.min(drag.cy, ey) - s.top}px`;
  drawbox.style.width = `${Math.abs(ex - drag.cx)}px`;
  drawbox.style.height = `${Math.abs(ey - drag.cy)}px`;
  drawbox.hidden = false;
});

canvas.addEventListener("pointerleave", () => {
  if (canvasHover === null) return;
  canvasHover = null;
  canvas.classList.remove("over-region");
  setHover(null);
});

canvas.addEventListener("pointerup", (e) => {
  if (pan) {
    pan = null;
    stage.classList.remove("panning");
    return;
  }
  if (!drag) return;
  drawbox.hidden = true;
  const start = drag;
  drag = null;
  // Barely moved: a click, not a drag — toggle the finding under it.
  if (Math.hypot(e.clientX - start.cx, e.clientY - start.cy) < 4) {
    const hit = regionAt(regions, start.x, start.y);
    if (hit !== null) toggle(hit);
    return;
  }
  const end = toImageXY(e.clientX, e.clientY);
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);
  // Require a real, big-enough rectangle. Written as `>=` so a NaN (e.g. a
  // zero-size canvas rect) fails the test instead of slipping through.
  if (!(w >= 6 && h >= 6)) return;
  pushManualHistory();
  manualBoxes.push({ x, y, w, h });
  repaint();
  renderRegions();
});

canvas.addEventListener("pointercancel", () => {
  drag = null;
  pan = null;
  stage.classList.remove("panning");
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
      regions = [];
      manualBoxes = [];
      undoStack = [];
      redoStack = [];
      sevFilter = null;
      displayImage(img);
      void scanImage(img, token, opts);
    })
    .catch(() => {
      if (token === gen) summary.textContent = "Couldn't load the image.";
    });
}

function handleFile(file: File | null | undefined): void {
  if (!file || !file.type.startsWith("image/")) return;
  if (mode !== "image") setMode("image");
  const token = ++gen;
  sourceName = file.name;
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
  sourceName = null;
  regions = [];
  manualBoxes = [];
  undoStack = [];
  redoStack = [];
  lastOcr = [];
  lastFaces = [];
  sevFilter = null;
  canvas.hidden = true;
  drawbox.hidden = true;
  stagePrompt.hidden = false;
  stageActions.hidden = true;
  compareBtn.hidden = true;
  toggleAllBtn.hidden = true;
  exportBtn.disabled = true;
  copyBtn.disabled = true;
  drawHint.hidden = true;
  workspaceMeta.textContent = "";
  hideProgress();
  hovered = null;
  canvasHover = null;
  resetView();
  stage.classList.remove("has-image");
  showEmpty();
}

const canPick = () => !stage.classList.contains("has-image");

// The whole empty stage stays clickable; the prompt buttons are the real,
// keyboard-focusable controls and stop the click from double-opening the picker.
stage.addEventListener("click", () => canPick() && fileInput.click());
pickBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (canPick()) fileInput.click();
});
// Read an image straight from the clipboard. Some WebViews refuse the async
// clipboard API; Ctrl+V (the paste event below) always works, so say so.
pasteBtn.addEventListener("click", async (e) => {
  e.stopPropagation();
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith("image/"));
      if (type) {
        const blob = await item.getType(type);
        handleFile(new File([blob], "clipboard", { type }));
        return;
      }
    }
    flash(pasteBtn, "No image copied");
  } catch (err) {
    console.error("Clipboard read failed", err);
    flash(pasteBtn, "Use Ctrl+V");
  }
});
fileInput.addEventListener("change", () => {
  handleFile(fileInput.files?.[0]);
  // Clear the value so choosing the same file again (e.g. after Clear) still
  // fires `change` — otherwise the picker sees no change and nothing loads.
  fileInput.value = "";
});
clearBtn.addEventListener("click", clearImage);

async function exportImage(): Promise<void> {
  if (exportBtn.disabled) return;
  try {
    const result = await saveCanvas(canvas, redactedName(sourceName));
    if (result !== "cancelled") flash(exportBtn, "Saved");
  } catch (err) {
    console.error("Save failed", err);
    flash(exportBtn, "Save failed");
  }
}
exportBtn.addEventListener("click", () => void exportImage());

// Briefly swap a button's label to confirm an action, then restore it. Only the
// label span changes, so the button's icon survives.
function flash(btn: HTMLButtonElement, msg: string): void {
  const label = btn.querySelector("span") ?? btn;
  const original = label.textContent;
  btn.disabled = true;
  label.textContent = msg;
  setTimeout(() => {
    label.textContent = original;
    btn.disabled = false;
  }, 1300);
}

// Copy the redacted canvas (boxes already baked in) to the clipboard as a PNG.
copyBtn.addEventListener("click", async () => {
  if (mode === "text") {
    try {
      await navigator.clipboard.writeText(redactText(input.value, scan(input.value, scanConfig(settings))));
      flash(copyBtn, "Copied");
    } catch (err) {
      console.error("Clipboard copy failed", err);
      flash(copyBtn, "Failed");
    }
    return;
  }
  try {
    const blob = await canvasBlob(canvas);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    flash(copyBtn, "Copied");
  } catch (err) {
    console.error("Clipboard copy failed", err);
    flash(copyBtn, "Failed");
  }
});
rotateBtn.addEventListener("click", () => {
  if (!sourceImg) return;
  // Manual rotate is a deliberate 90° nudge — don't re-run the auto search.
  const token = ++gen;
  loadImage(orientedCanvas(sourceImg, 1).toDataURL("image/png"), { autoOrient: false }, token);
});

// Drag and drop anywhere in the window lands on the stage.
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  if (!e.dataTransfer?.types.includes("Files")) return;
  dragDepth++;
  stage.classList.add("dragover");
});
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) stage.classList.remove("dragover");
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  stage.classList.remove("dragover");
  handleFile(e.dataTransfer?.files?.[0]);
});

// Paste an image from the clipboard. Pasting text falls through untouched.
window.addEventListener("paste", (e) => {
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
  if (item) handleFile(item.getAsFile());
});

// ── Keyboard shortcuts ──
// Space toggles every region, Ctrl/Cmd+Z and Ctrl+Shift+Z / Ctrl+Y undo and redo
// the manual boxes, Ctrl/Cmd+S saves, Ctrl+O opens, Delete drops the last box,
// Escape closes the drawer. Suppressed while typing in the text box.
function inEditable(t: EventTarget | null): boolean {
  return t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement;
}
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !settingsDrawer.hidden) {
    setDrawer(false);
    return;
  }
  if (inEditable(e.target)) return;
  const mod = e.ctrlKey || e.metaKey;

  if (mod && (e.key === "z" || e.key === "Z")) {
    e.preventDefault();
    if (e.shiftKey) redoManual();
    else undoManual();
  } else if (mod && (e.key === "y" || e.key === "Y")) {
    e.preventDefault();
    redoManual();
  } else if (mod && (e.key === "s" || e.key === "S")) {
    e.preventDefault();
    void exportImage();
  } else if (mod && (e.key === "o" || e.key === "O")) {
    e.preventDefault();
    if (mode !== "image") setMode("image");
    fileInput.click();
  } else if (!mod && ["+", "=", "-", "0"].includes(e.key)) {
    if (!stage.classList.contains("has-image") || mode !== "image") return;
    e.preventDefault();
    if (e.key === "0") resetView();
    else zoomCentre(e.key === "-" ? 1 / 1.25 : 1.25);
  } else if (e.key === " " && !mod && !(e.target instanceof HTMLButtonElement)) {
    // Don't steal Space from a focused button (a finding row toggles itself).
    if (!currentImg || regions.length === 0) return;
    e.preventDefault();
    toggleAllRegions();
  } else if ((e.key === "Delete" || e.key === "Backspace") && !mod) {
    if (!manualBoxes.length) return;
    e.preventDefault();
    pushManualHistory();
    manualBoxes.pop();
    repaint();
    renderRegions();
  }
});

// ── Updates ──
function showUpdateBanner(update: PendingUpdate): void {
  updateBanner.replaceChildren();

  const text = document.createElement("span");
  text.className = "update-text";
  text.textContent = `ShotShield ${update.version} is available.`;

  const action = document.createElement("button");
  action.type = "button";
  action.className = "btn btn-primary";
  action.textContent = "Update & restart";

  const later = document.createElement("button");
  later.type = "button";
  later.className = "btn";
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
