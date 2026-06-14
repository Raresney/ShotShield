import { scan, type Detection } from "@shotshield/core";

const input = document.querySelector<HTMLTextAreaElement>("#input")!;
const summary = document.querySelector<HTMLParagraphElement>("#summary")!;
const results = document.querySelector<HTMLDivElement>("#results")!;

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

function render(): void {
  const dets = scan(input.value);
  results.replaceChildren(...dets.map(row));

  if (!input.value.trim()) summary.textContent = "";
  else if (dets.length === 0) summary.textContent = "Nothing sensitive found.";
  else summary.textContent = `${dets.length} found`;
}

input.addEventListener("input", render);
