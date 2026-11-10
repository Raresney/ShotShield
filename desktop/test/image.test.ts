import { describe, expect, it } from "vitest";
import { ocrGrey } from "../src/image.ts";

describe("ocrGrey", () => {
  // Red ink over a blue-green guilloche line: luma puts them close together,
  // the blue channel far apart.
  const ink = [200, 60, 40] as const;
  const tint = [90, 150, 190] as const;

  it("reads luma on the first look", () => {
    expect(ocrGrey(255, 255, 255, "first")).toBe(255);
    expect(Math.abs(ocrGrey(...ink, "first") - ocrGrey(...tint, "first"))).toBeLessThan(40);
  });

  it("reads the blue channel on the second look, where tinted ink stands out", () => {
    expect(ocrGrey(...ink, "second")).toBe(40);
    expect(ocrGrey(...tint, "second") - ocrGrey(...ink, "second")).toBeGreaterThan(120);
  });
});
