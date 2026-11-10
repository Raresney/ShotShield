import { describe, it, expect, beforeEach } from "vitest";
import { captureKeys, captureShortcut, customRules, loadSettings, scanConfig } from "../src/settings.ts";
import { scan } from "@shotshield/core";

beforeEach(() => localStorage.clear());

describe("loadSettings", () => {
  it("defaults to everything enabled, faces on, no confidence floor", () => {
    const s = loadSettings();
    expect(s.faces).toBe(true);
    expect(s.minConfidence).toBe(0);
    expect(s.cover).toBe("solid");
    expect(s.enabled.email).toBe(true);
    expect(s.enabled.national_id).toBe(true);
  });

  it("merges saved over defaults, so a category added later still defaults on", () => {
    localStorage.setItem(
      "shotshield.settings",
      JSON.stringify({ enabled: { email: false }, faces: false, minConfidence: 0.5 }),
    );
    const s = loadSettings();
    expect(s.enabled.email).toBe(false); // saved
    expect(s.enabled.iban).toBe(true); // not in saved -> default on
    expect(s.faces).toBe(false);
    expect(s.minConfidence).toBe(0.5);
  });

  it("keeps a saved cover style and rejects unknown ones", () => {
    localStorage.setItem("shotshield.settings", JSON.stringify({ cover: "mosaic" }));
    expect(loadSettings().cover).toBe("mosaic");
    localStorage.setItem("shotshield.settings", JSON.stringify({ cover: "blur" }));
    expect(loadSettings().cover).toBe("solid");
  });

  it("keeps the tray on and capture copying off unless saved otherwise", () => {
    expect(loadSettings()).toMatchObject({ tray: true, copyCaptures: false });
    localStorage.setItem("shotshield.settings", JSON.stringify({ tray: false, copyCaptures: true }));
    expect(loadSettings()).toMatchObject({ tray: false, copyCaptures: true });
  });

  it("falls back to defaults on corrupt storage", () => {
    localStorage.setItem("shotshield.settings", "{ not json");
    const s = loadSettings();
    expect(s.faces).toBe(true);
    expect(s.minConfidence).toBe(0);
  });
});

describe("scanConfig", () => {
  it("forwards the enabled map and confidence floor to the scanner", () => {
    const cfg = scanConfig({ ...loadSettings(), enabled: { email: false }, minConfidence: 0.3 });
    expect(cfg.enabled?.email).toBe(false);
    expect(cfg.minConfidence).toBe(0.3);
  });
});

describe("user rules", () => {
  it("escapes plain-text rules and keeps regex ones, both ignoring case", () => {
    const rules = customRules([
      { id: "a", label: "Code name", pattern: "Project (Falcon)", regex: false },
      { id: "b", label: "", pattern: String.raw`PRJ-\d{4}`, regex: true },
    ]);
    expect(rules).toEqual([
      { id: "a", label: "Code name", pattern: String.raw`Project \(Falcon\)`, flags: "i" },
      { id: "b", label: "Your rule", pattern: String.raw`PRJ-\d{4}`, flags: "i" },
    ]);
  });

  it("leaves out empty and invalid rules", () => {
    expect(customRules([
      { id: "a", label: "x", pattern: "  ", regex: false },
      { id: "b", label: "y", pattern: "([", regex: true },
    ])).toEqual([]);
  });

  it("feeds the allow list and rules into the scan", () => {
    const s = loadSettings();
    s.allow = ["*@acme.com"];
    s.rules = [{ id: "r", label: "Code name", pattern: "falcon", regex: false }];
    const dets = scan("Mail ana@acme.com about Project FALCON, cc eve@evil.com", scanConfig(s));
    expect(dets.map((d) => d.text)).toEqual(["FALCON", "eve@evil.com"]);
  });

  it("drops malformed saved rules", () => {
    localStorage.setItem("shotshield.settings", JSON.stringify({ allow: ["ok", 3], rules: [{ id: 1 }, { id: "r", label: "", pattern: "x", regex: false }] }));
    const s = loadSettings();
    expect(s.allow).toEqual(["ok"]);
    expect(s.rules).toHaveLength(1);
  });
});

describe("capture shortcut labels", () => {
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
  const win = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/131.0";
  const linux = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)";

  it("writes Control+Option+R the Mac way", () => {
    expect(captureKeys(mac)).toEqual(["⌃", "⌥", "R"]);
    expect(captureShortcut(mac)).toBe("⌃⌥R");
  });

  it("writes Ctrl+Alt+R everywhere else", () => {
    expect(captureShortcut(win)).toBe("Ctrl+Alt+R");
    expect(captureShortcut(linux)).toBe("Ctrl+Alt+R");
  });
});
