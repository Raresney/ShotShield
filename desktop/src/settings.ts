// User-facing detection settings: which categories run, a confidence floor, and
// how covered regions are drawn. The core scanner already accepts this config;
// this module owns the UI for it and persists the choices in localStorage so
// they survive a restart.

import type { Category, ScanConfig } from "@shotshield/core";
import type { CoverStyle } from "./redact.ts";

// The categories the user can switch, grouped the way people think about them.
// Faces aren't a core scan category (they come from the face model), so they get
// their own switch inside the Identity group.
const GROUPS: { title: string; items: { cat: Category | "face"; label: string }[] }[] = [
  {
    title: "Secrets",
    items: [
      { cat: "api_key", label: "API keys & tokens" },
      { cat: "credential", label: "Passwords & credentials" },
      { cat: "jwt", label: "JSON Web Tokens" },
    ],
  },
  {
    title: "Financial",
    items: [
      { cat: "credit_card", label: "Payment cards" },
      { cat: "cvv", label: "Card security codes" },
      { cat: "iban", label: "IBAN" },
      { cat: "bic", label: "SWIFT / BIC" },
      { cat: "crypto_wallet", label: "Crypto wallets" },
    ],
  },
  {
    title: "Identity",
    items: [
      { cat: "face", label: "Faces" },
      { cat: "national_id", label: "CNP" },
      { cat: "id_document", label: "ID card number" },
      { cat: "mrz", label: "Passport / ID MRZ" },
      { cat: "tax_id", label: "Tax ID (CUI / CIF)" },
      { cat: "name", label: "Names" },
    ],
  },
  {
    title: "Contact",
    items: [
      { cat: "email", label: "Email addresses" },
      { cat: "phone", label: "Phone numbers" },
      { cat: "ip_address", label: "Public IP addresses" },
    ],
  },
];

export interface Settings {
  enabled: Partial<Record<Category, boolean>>;
  /** Faces are detected outside the core scan, so they're tracked separately. */
  faces: boolean;
  /** 0..1 floor; detections below it are dropped. */
  minConfidence: number;
  /** How a covered region is drawn on the image. */
  cover: CoverStyle;
}

const STORAGE_KEY = "shotshield.settings";

function defaults(): Settings {
  const enabled: Partial<Record<Category, boolean>> = {};
  for (const g of GROUPS) for (const { cat } of g.items) if (cat !== "face") enabled[cat] = true;
  return { enabled, faces: true, minConfidence: 0, cover: "solid" };
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
      cover: saved.cover === "mosaic" ? "mosaic" : "solid",
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
  const commit = () => {
    save(s);
    onChange();
  };

  body.append(coverGroup(s, commit));

  for (const g of GROUPS) {
    const section = group(g.title);
    for (const { cat, label } of g.items) {
      const on = cat === "face" ? s.faces : (s.enabled[cat] ?? true);
      section.append(
        toggle(label, on, (next) => {
          if (cat === "face") s.faces = next;
          else s.enabled[cat] = next;
          commit();
        }),
      );
    }
    body.append(section);
  }

  const sens = group("Sensitivity");
  const note = document.createElement("p");
  note.className = "set-note";
  note.textContent = "Hide findings the engine is less sure about.";
  sens.append(note, slider(s, commit));
  body.append(sens);
}

function group(title: string): HTMLElement {
  const section = document.createElement("section");
  section.className = "set-group";
  const h = document.createElement("h3");
  h.textContent = title;
  section.append(h);
  return section;
}

// Solid black or a mosaic. The mosaic is generated, not sampled from the
// pixels underneath, so it is as irreversible as the solid fill.
function coverGroup(s: Settings, commit: () => void): HTMLElement {
  const section = group("Cover style");
  const seg = document.createElement("div");
  seg.className = "segmented";
  seg.setAttribute("role", "radiogroup");
  seg.setAttribute("aria-label", "Cover style");
  const options: { value: CoverStyle; label: string; icon: string }[] = [
    { value: "solid", label: "Solid", icon: "#i-square" },
    { value: "mosaic", label: "Mosaic", icon: "#i-grid" },
  ];
  const buttons = options.map(({ value, label, icon }) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.dataset.value = value;
    b.innerHTML = `<svg class="icon"><use href="${icon}"></use></svg>`;
    b.append(label);
    b.addEventListener("click", () => {
      s.cover = value;
      sync();
      commit();
    });
    return b;
  });
  const sync = () =>
    buttons.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.value === s.cover)));
  sync();
  seg.append(...buttons);
  section.append(seg);
  return section;
}

function slider(s: Settings, commit: () => void): HTMLElement {
  const row = document.createElement("label");
  row.className = "settings-slider";
  const top = document.createElement("div");
  top.className = "settings-slider-top";
  const caption = document.createElement("span");
  caption.textContent = "Minimum confidence";
  const value = document.createElement("span");
  value.className = "settings-slider-value";
  const setValue = () => (value.textContent = `${Math.round(s.minConfidence * 100)}%`);
  setValue();
  top.append(caption, value);
  const input = document.createElement("input");
  input.type = "range";
  input.min = "0";
  input.max = "95";
  input.step = "5";
  input.value = String(Math.round(s.minConfidence * 100));
  input.addEventListener("input", () => {
    s.minConfidence = Number(input.value) / 100;
    setValue();
    commit();
  });
  row.append(top, input);
  return row;
}

// A label on the left and a visually-hidden checkbox immediately followed by
// the .settings-switch track the CSS animates (input:checked + .settings-switch).
function toggle(label: string, checked: boolean, onToggle: (on: boolean) => void): HTMLElement {
  const el = document.createElement("label");
  el.className = "settings-item";

  const text = document.createElement("span");
  text.className = "settings-label";
  text.textContent = label;

  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  box.addEventListener("change", () => onToggle(box.checked));

  const track = document.createElement("span");
  track.className = "settings-switch";

  el.append(text, box, track);
  return el;
}
