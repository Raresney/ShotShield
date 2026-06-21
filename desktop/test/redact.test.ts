import { describe, it, expect } from "vitest";
import { locate } from "../src/redact.ts";
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
