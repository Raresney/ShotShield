import { describe, expect, it } from "vitest";
import { linesToResult } from "../src/nativeocr.ts";

describe("linesToResult", () => {
  it("rebuilds the text so every word's offsets point back at it", () => {
    const r = linesToResult([
      { words: [{ text: "CNP", x: 10, y: 20, w: 30, h: 12 }, { text: "2950312401231", x: 50, y: 20, w: 120, h: 12 }] },
      { words: [{ text: "SERIA", x: 10, y: 40, w: 40, h: 12 }] },
    ]);
    expect(r.text).toBe("CNP 2950312401231\nSERIA\n");
    for (const w of r.words) expect(r.text.slice(w.start, w.end)).toBe(w.text);
    expect(r.words[1]!.box).toEqual({ x: 50, y: 20, w: 120, h: 12 });
  });

  it("skips empty lines instead of adding blank ones", () => {
    const r = linesToResult([{ words: [] }, { words: [{ text: "a", x: 0, y: 0, w: 1, h: 1 }] }]);
    expect(r.text).toBe("a\n");
  });

  it("gives an empty result for an image with no text", () => {
    expect(linesToResult([])).toEqual({ text: "", words: [] });
  });
});
