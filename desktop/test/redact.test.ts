import { describe, it, expect } from "vitest";
import { locate, mergeRegions, needsSecondLook, type Region } from "../src/redact.ts";
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
