import { describe, it, expect, beforeEach } from "vitest";
import { loadSettings, scanConfig } from "../src/settings.ts";

beforeEach(() => localStorage.clear());

describe("loadSettings", () => {
  it("defaults to everything enabled, faces on, no confidence floor", () => {
    const s = loadSettings();
    expect(s.faces).toBe(true);
    expect(s.minConfidence).toBe(0);
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

  it("falls back to defaults on corrupt storage", () => {
    localStorage.setItem("shotshield.settings", "{ not json");
    const s = loadSettings();
    expect(s.faces).toBe(true);
    expect(s.minConfidence).toBe(0);
  });
});

describe("scanConfig", () => {
  it("forwards the enabled map and confidence floor to the scanner", () => {
    const cfg = scanConfig({ enabled: { email: false }, faces: true, minConfidence: 0.3 });
    expect(cfg.enabled?.email).toBe(false);
    expect(cfg.minConfidence).toBe(0.3);
  });
});
