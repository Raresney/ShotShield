import { describe, it, expect } from "vitest";
import { locate, mergeRegions, needsSecondLook, boxGripAt, dragBox, redactText, regionAt, SEVERITY_RANK, type Region } from "../src/redact.ts";
import type { Detection } from "@shotshield/core";
import type { OcrWord } from "../src/ocr.ts";

const det = (start: number, end: number, over: Partial<Detection> = {}): Detection => ({
  category: "email",
  label: "Email address",
  severity: "medium",
  start,
  end,
  text: "x",
  confidence: 0.9,
  redactByDefault: true,
  ...over,
});

const word = (start: number, end: number, x = 0): OcrWord => ({
  text: "w",
  start,
  end,
  box: { x, y: 0, w: 10, h: 10 },
});

describe("locate", () => {
  const words = [word(0, 5, 0), word(6, 11, 20), word(12, 20, 40)];

  it("pairs a detection with only the word box it overlaps", () => {
    const [region] = locate([det(6, 11)], words);
    expect(region!.boxes).toHaveLength(1);
    expect(region!.boxes[0]!.x).toBe(20);
  });

  it("covers every word a detection spans", () => {
    const [region] = locate([det(3, 14)], words);
    expect(region!.boxes).toHaveLength(3);
  });

  it("carries redactByDefault into the region's hidden flag", () => {
    expect(locate([det(0, 5, { redactByDefault: true })], words)[0]!.hidden).toBe(true);
    expect(locate([det(0, 5, { redactByDefault: false })], words)[0]!.hidden).toBe(false);
  });

  it("returns no boxes when nothing overlaps", () => {
    expect(locate([det(30, 40)], words)[0]!.boxes).toHaveLength(0);
  });
});

const region = (
  category: Detection["category"],
  x: number,
  y: number,
  w = 100,
  h = 20,
): Region => ({
  detection: det(0, 5, { category }),
  hidden: true,
  boxes: [{ x, y, w, h }],
});

describe("mergeRegions", () => {
  it("drops a second-pass hit of the same category on the same spot", () => {
    const base = [region("national_id", 100, 200)];
    // The retry re-read the same CNP with a slightly shifted box.
    const merged = mergeRegions(base, [region("national_id", 110, 205)]);
    expect(merged).toHaveLength(1);
  });

  it("keeps a second-pass hit the first pass missed entirely", () => {
    const base = [region("mrz", 0, 400)];
    const merged = mergeRegions(base, [region("national_id", 100, 200)]);
    expect(merged).toHaveLength(2);
  });

  it("keeps same-category hits at different spots", () => {
    const merged = mergeRegions([region("email", 0, 0)], [region("email", 500, 500)]);
    expect(merged).toHaveLength(2);
  });

  it("keeps overlapping hits of different categories", () => {
    // A face box crossing a text field is two real findings, not a duplicate.
    const merged = mergeRegions([region("face", 90, 190, 200, 200)], [region("national_id", 100, 200)]);
    expect(merged).toHaveLength(2);
  });
});

describe("SEVERITY_RANK", () => {
  it("orders findings scariest-first", () => {
    expect(SEVERITY_RANK.critical).toBeLessThan(SEVERITY_RANK.high);
    expect(SEVERITY_RANK.high).toBeLessThan(SEVERITY_RANK.medium);
    expect(SEVERITY_RANK.medium).toBeLessThan(SEVERITY_RANK.low);
  });
});

describe("needsSecondLook", () => {
  const cnp = det(0, 13, { category: "national_id" });
  const seria = det(20, 38, { category: "id_document" });

  it("fires when the text reads as a Romanian ID but no CNP was found", () => {
    expect(needsSecondLook([], "CARTE DE IDENTITATE ROMANIA", true)).toBe(true);
    expect(needsSecondLook([], "IDROU1870709<<080019", true)).toBe(true); // MRZ carries ROU
    expect(needsSecondLook([seria], "seria RK nr 123456", true)).toBe(true);
  });

  it("stays quiet once a CNP was detected", () => {
    expect(needsSecondLook([cnp], "CNP 1960209025813 ROMANIA", true)).toBe(false);
  });

  it("stays quiet on ordinary screenshots and foreign documents", () => {
    expect(needsSecondLook([], "npm ERR! code E404", true)).toBe(false);
    expect(needsSecondLook([det(0, 30, { category: "mrz" })], "P<DEUMUSTERMANN<<ERIKA", true)).toBe(false);
  });

  it("stays quiet when the CNP category is disabled", () => {
    expect(needsSecondLook([], "CNP ROMANIA", false)).toBe(false);
  });
});

describe("redactText", () => {
  it("replaces every detection and keeps the rest", () => {
    const text = "user a@b.co pass 1234 end";
    const out = redactText(text, [det(5, 11), det(17, 21)]);
    expect(out).toBe("user [REDACTED] pass [REDACTED] end");
  });

  it("is a no-op with nothing detected", () => {
    expect(redactText("clean", [])).toBe("clean");
  });
});

describe("regionAt", () => {
  const regs = [region("email", 100, 100, 200, 20), region("face", 80, 80, 300, 300)];

  it("finds the region under a point, padding included", () => {
    expect(regionAt(regs, 150, 110)).toBe(0);
    expect(regionAt(regs, 150, 98)).toBe(0); // inside the 3px cover padding
  });

  it("prefers the smallest box when regions overlap", () => {
    expect(regionAt(regs, 150, 110)).toBe(0);
    expect(regionAt(regs, 350, 300)).toBe(1);
  });

  it("returns null off every box", () => {
    expect(regionAt(regs, 10, 10)).toBeNull();
  });
});

describe("boxGripAt", () => {
  const boxes = [{ x: 100, y: 100, w: 200, h: 100 }];

  it("moves from the inside, resizes from edges and corners", () => {
    expect(boxGripAt(boxes, 200, 150, 5)).toEqual({ index: 0, grip: "move" });
    expect(boxGripAt(boxes, 200, 102, 5)?.grip).toBe("n");
    expect(boxGripAt(boxes, 298, 150, 5)?.grip).toBe("e");
    expect(boxGripAt(boxes, 101, 199, 5)?.grip).toBe("sw");
  });

  it("returns null away from every box, and prefers the last-drawn one", () => {
    expect(boxGripAt(boxes, 10, 10, 5)).toBeNull();
    const stacked = [...boxes, { x: 150, y: 120, w: 50, h: 50 }];
    expect(boxGripAt(stacked, 170, 140, 5)?.index).toBe(1);
  });
});

describe("dragBox", () => {
  const b = { x: 100, y: 100, w: 200, h: 100 };
  const bounds = { w: 1000, h: 500 };

  it("moves without resizing, clamped to the image", () => {
    expect(dragBox(b, "move", 50, -20, bounds)).toEqual({ x: 150, y: 80, w: 200, h: 100 });
    expect(dragBox(b, "move", 5000, 5000, bounds)).toEqual({ x: 800, y: 400, w: 200, h: 100 });
  });

  it("resizes from the dragged edge or corner only", () => {
    expect(dragBox(b, "e", 30, 999, bounds)).toEqual({ x: 100, y: 100, w: 230, h: 100 });
    expect(dragBox(b, "nw", -10, -10, bounds)).toEqual({ x: 90, y: 90, w: 210, h: 110 });
  });

  it("stops at the minimum instead of flipping", () => {
    expect(dragBox(b, "w", 500, 0, bounds)).toEqual({ x: 294, y: 100, w: 6, h: 100 });
  });
});
