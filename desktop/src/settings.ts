// User-facing detection settings: which categories run, a confidence floor, and
// how covered regions are drawn. The core scanner already accepts this config;
// this module owns the UI for it and persists the choices in localStorage so
// they survive a restart.

import type { Category, CustomRule, ScanConfig } from "@shotshield/core";
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
      { cat: "id_document", label: "ID, passport & licence numbers" },
      { cat: "mrz", label: "Passport / ID MRZ" },
      { cat: "tax_id", label: "Tax ID (CUI / CIF)" },
      { cat: "name", label: "Names" },
      { cat: "license_plate", label: "Licence plates" },
    ],
  },
  {
    title: "Contact",
    items: [
      { cat: "email", label: "Email addresses" },
      { cat: "phone", label: "Phone numbers" },
      { cat: "address", label: "Postal addresses" },
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
  /** Closing the window keeps ShotShield in the tray. */
  tray: boolean;
  /** Put a capture on the clipboard as soon as it's covered. */
  copyCaptures: boolean;
  /** Values never covered, one glob each ("*" = anything). */
  allow: string[];
  /** The user's own things to cover, on top of the built-in detectors. */
  rules: UserRule[];
}

export interface UserRule {
  id: string;
  label: string;
  pattern: string;
  /** A regular expression; otherwise the pattern is plain text. */
  regex: boolean;
}

const STORAGE_KEY = "shotshield.settings";

function defaults(): Settings {
  const enabled: Partial<Record<Category, boolean>> = {};
  for (const g of GROUPS) for (const { cat } of g.items) if (cat !== "face") enabled[cat] = true;
  return { enabled, faces: true, minConfidence: 0, cover: "solid", tray: true, copyCaptures: false, allow: [], rules: [] };
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
      tray: saved.tray ?? base.tray,
      copyCaptures: saved.copyCaptures ?? base.copyCaptures,
      allow: Array.isArray(saved.allow) ? saved.allow.filter((a) => typeof a === "string") : base.allow,
      rules: Array.isArray(saved.rules) ? saved.rules.filter(isRule) : base.rules,
    };
  } catch {
    return base; // unavailable or corrupt storage: fall back to defaults
  }
}

function isRule(r: unknown): r is UserRule {
  const x = r as UserRule;
  return !!x && typeof x.id === "string" && typeof x.label === "string" && typeof x.pattern === "string";
}

export function saveSettings(s: Settings): void {
  save(s);
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
  return { enabled: s.enabled, minConfidence: s.minConfidence, allow: s.allow, customRules: customRules(s.rules) };
}

// Plain-text rules are escaped into a pattern; both kinds ignore case. Empty
// and invalid ones are left out (the panel flags the invalid ones).
export function customRules(rules: UserRule[]): CustomRule[] {
  return rules
    .filter((r) => r.pattern.trim() && (!r.regex || validRegex(r.pattern)))
    .map((r) => ({
      id: r.id,
      label: r.label.trim() || "Your rule",
      pattern: r.regex ? r.pattern : r.pattern.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      flags: "i",
    }));
}

export function validRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/** The capture shortcut's keys, written the way this platform writes them. */
export function captureKeys(ua = navigator.userAgent): string[] {
  return /Macintosh|Mac OS X/.test(ua) ? ["⌃", "⌥", "R"] : ["Ctrl", "Alt", "R"];
}

/** The capture shortcut as one label: "Ctrl+Alt+R", or "⌃⌥R" on a Mac. */
export function captureShortcut(ua = navigator.userAgent): string {
  const keys = captureKeys(ua);
  return keys[0] === "⌃" ? keys.join("") : keys.join("+");
}

/** What the Background section needs from the app shell (the desktop app only). */
export interface BackgroundHooks {
  setTray(on: boolean): void;
  autostart: boolean;
  setAutostart(on: boolean): Promise<void>;
}

// Build the panel into `body` and wire every control to persist, then call
// `onChange` so the caller can refresh the current scan. `background` adds the
// tray and start-at-login switches where the app supports them.
export function renderSettings(
  body: HTMLElement,
  s: Settings,
  onChange: () => void,
  background?: BackgroundHooks,
): void {
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

  body.append(allowGroup(s, commit), rulesGroup(s, commit));

  if (background) body.append(backgroundGroup(s, commit, background));
}

// One value per line. Written back on every keystroke (debounced), so the
// findings update while you type.
function allowGroup(s: Settings, commit: () => void): HTMLElement {
  const section = group("Never cover");
  const note = document.createElement("p");
  note.className = "set-note";
  note.textContent = "One value per line, * for any part (*@yourcompany.com). Right-click a finding to add it.";
  const area = document.createElement("textarea");
  area.className = "set-textarea";
  area.rows = 3;
  area.spellcheck = false;
  area.placeholder = "you@yourcompany.com";
  area.setAttribute("aria-label", "Values never covered");
  area.value = s.allow.join("\n");
  let timer = 0;
  area.addEventListener("input", () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      s.allow = area.value.split("\n").map((l) => l.trim()).filter(Boolean);
      commit();
    }, 300);
  });
  section.append(note, area);
  return section;
}

function rulesGroup(s: Settings, commit: () => void): HTMLElement {
  const section = group("Also cover");
  const note = document.createElement("p");
  note.className = "set-note";
  note.textContent = "Things only you know are sensitive: a project code name, an internal ID format.";
  const list = document.createElement("div");
  list.className = "rule-list";
  let timer = 0;
  const later = () => {
    clearTimeout(timer);
    timer = window.setTimeout(commit, 300);
  };

  const row = (rule: UserRule): HTMLElement => {
    const el = document.createElement("div");
    el.className = "rule-row";
    const label = document.createElement("input");
    label.className = "rule-label";
    label.placeholder = "Name";
    label.value = rule.label;
    label.setAttribute("aria-label", "Rule name");
    const pattern = document.createElement("input");
    pattern.className = "rule-pattern";
    pattern.value = rule.pattern;
    pattern.spellcheck = false;
    pattern.setAttribute("aria-label", "Text or pattern to cover");
    const kind = document.createElement("button");
    kind.type = "button";
    kind.className = "rule-kind";
    kind.title = "Plain text or regular expression";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "rule-remove";
    remove.title = "Remove rule";
    remove.setAttribute("aria-label", "Remove rule");
    remove.innerHTML = `<svg class="icon"><use href="#i-x"></use></svg>`;
    const sync = () => {
      kind.textContent = rule.regex ? ".*" : "Aa";
      pattern.placeholder = rule.regex ? "PRJ-\\d{4}" : "Project Falcon";
      kind.setAttribute("aria-pressed", String(rule.regex));
      pattern.setAttribute("aria-invalid", String(rule.regex && !validRegex(rule.pattern)));
    };
    sync();
    label.addEventListener("input", () => {
      rule.label = label.value;
      later();
    });
    pattern.addEventListener("input", () => {
      rule.pattern = pattern.value;
      sync();
      later();
    });
    kind.addEventListener("click", () => {
      rule.regex = !rule.regex;
      sync();
      commit();
    });
    remove.addEventListener("click", () => {
      s.rules = s.rules.filter((r) => r !== rule);
      el.remove();
      commit();
    });
    el.append(label, pattern, kind, remove);
    return el;
  };

  list.append(...s.rules.map(row));
  const add = document.createElement("button");
  add.type = "button";
  add.className = "btn rule-add";
  add.innerHTML = `<svg class="icon"><use href="#i-plus"></use></svg><span>Add rule</span>`;
  add.addEventListener("click", () => {
    const rule: UserRule = { id: `rule-${Date.now().toString(36)}`, label: "", pattern: "", regex: false };
    s.rules.push(rule);
    const el = row(rule);
    list.append(el);
    el.querySelector<HTMLInputElement>(".rule-label")?.focus();
  });
  section.append(note, list, add);
  return section;
}

function backgroundGroup(s: Settings, commit: () => void, hooks: BackgroundHooks): HTMLElement {
  const section = group("Background");
  const note = document.createElement("p");
  note.className = "set-note";
  note.textContent = `Keep ${captureShortcut()} ready with the window closed.`;
  section.append(
    note,
    toggle("Keep running in the tray", s.tray, (on) => {
      s.tray = on;
      hooks.setTray(on);
      commit();
    }),
    toggle("Start at login", hooks.autostart, (on) => {
      hooks.autostart = on;
      void hooks.setAutostart(on);
    }),
    toggle("Copy captures once covered", s.copyCaptures, (on) => {
      s.copyCaptures = on;
      commit();
    }),
  );
  return section;
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
