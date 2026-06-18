// User-facing detection settings: which categories run, and a confidence floor.
// The core scanner already accepts this config; this module owns the UI for it
// and persists the choices in localStorage so they survive a restart.

import type { Category, ScanConfig } from "@shotshield/core";

// The categories the user can switch, with friendly labels. "custom" and "face"
// aren't core scan categories — faces get their own switch below, and custom
// rules aren't editable from here yet — so they're left out of this list.
const CATEGORIES: { cat: Category; label: string }[] = [
  { cat: "api_key", label: "API keys & tokens" },
  { cat: "jwt", label: "JWT" },
  { cat: "credit_card", label: "Payment cards" },
  { cat: "cvv", label: "Card security codes" },
  { cat: "iban", label: "IBAN" },
  { cat: "bic", label: "SWIFT/BIC" },
  { cat: "national_id", label: "CNP" },
  { cat: "tax_id", label: "Tax ID (CUI/CIF)" },
  { cat: "id_document", label: "ID card number" },
  { cat: "mrz", label: "Passport / ID MRZ" },
  { cat: "name", label: "Names" },
  { cat: "email", label: "Email addresses" },
  { cat: "phone", label: "Phone numbers" },
];

export interface Settings {
  enabled: Partial<Record<Category, boolean>>;
  /** Faces are detected outside the core scan, so they're tracked separately. */
  faces: boolean;
  /** 0..1 floor; detections below it are dropped. */
  minConfidence: number;
}

const STORAGE_KEY = "shotshield.settings";

function defaults(): Settings {
  const enabled: Partial<Record<Category, boolean>> = {};
  for (const { cat } of CATEGORIES) enabled[cat] = true;
  return { enabled, faces: true, minConfidence: 0 };
}

// Merge whatever was saved over the defaults, so a category added in a later
// version defaults to on rather than vanishing for someone with old settings.
export function loadSettings(): Settings {
  const base = defaults();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<Settings>;
    return {
      enabled: { ...base.enabled, ...(saved.enabled ?? {}) },
      faces: saved.faces ?? base.faces,
      minConfidence:
        typeof saved.minConfidence === "number" ? saved.minConfidence : base.minConfidence,
    };
  } catch {
    return base; // unavailable or corrupt storage: fall back to defaults
  }
}

function save(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage can be unavailable (private mode, quota). Settings still apply for
    // this session; they just won't persist.
  }
}

export function scanConfig(s: Settings): ScanConfig {
  return { enabled: s.enabled, minConfidence: s.minConfidence };
}

// Build the panel into `body` and wire every control to persist, then call
// `onChange` so the caller can refresh the current scan.
export function renderSettings(body: HTMLElement, s: Settings, onChange: () => void): void {
  body.replaceChildren();

  const grid = document.createElement("div");
  grid.className = "settings-grid";
  for (const { cat, label } of CATEGORIES) {
    grid.append(
      toggle(label, s.enabled[cat] ?? true, (on) => {
        s.enabled[cat] = on;
        save(s);
        onChange();
      }),
    );
  }
  grid.append(
    toggle("Faces", s.faces, (on) => {
      s.faces = on;
      save(s);
      onChange();
    }),
  );
  body.append(grid);

  const row = document.createElement("label");
  row.className = "settings-slider";
  const text = document.createElement("span");
  const setText = () => (text.textContent = `Minimum confidence: ${Math.round(s.minConfidence * 100)}%`);
  setText();
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "95";
  slider.step = "5";
  slider.value = String(Math.round(s.minConfidence * 100));
  slider.addEventListener("input", () => {
    s.minConfidence = Number(slider.value) / 100;
    setText();
    save(s);
    onChange();
  });
  row.append(text, slider);
  body.append(row);
}

function toggle(label: string, checked: boolean, onToggle: (on: boolean) => void): HTMLElement {
  const el = document.createElement("label");
  el.className = "settings-item";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  box.addEventListener("change", () => onToggle(box.checked));
  const span = document.createElement("span");
  span.textContent = label;
  el.append(box, span);
  return el;
}
