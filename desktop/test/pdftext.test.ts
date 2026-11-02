import { describe, expect, it } from "vitest";
import { textLayerToOcr, type TextItemLike } from "../src/pdftext.ts";

// Every glyph is 10 px wide at size 20, so positions are easy to check.
const measure = (s: string): number => s.length;
const run = (str: string, x: number, baseline: number, hasEOL = false): TextItemLike => ({
  str,
  transform: [20, 0, 0, -20, x, baseline],
  width: str.length * 10,
  hasEOL,
});

describe("textLayerToOcr", () => {
  it("rebuilds the text the way OCR does, one line per row", () => {
    const r = textLayerToOcr([run("IBAN: RO49 AAAA", 50, 100, true), run("Phone", 50, 140, true)], measure);
    expect(r.text).toBe("IBAN: RO49 AAAA\nPhone\n");
    expect(r.words.map((w) => w.text)).toEqual(["IBAN:", "RO49", "AAAA", "Phone"]);
  });

  it("gives every word its own box on the page", () => {
    const r = textLayerToOcr([run("key sk_live_123", 50, 100, true)], measure);
    const [key, secret] = r.words;
    expect(key!.box).toEqual({ x: 50, y: 83, w: 30, h: 22 });
    expect(secret!.box.x).toBe(90);
    expect(secret!.box.w).toBe(110);
    expect(r.text.slice(secret!.start, secret!.end)).toBe("sk_live_123");
  });

  it("joins runs that touch and splits runs with a gap", () => {
    // "sk_live_" and "abc123" are drawn back to back: one word.
    const touching = textLayerToOcr([run("sk_live_", 50, 100), run("abc123", 130, 100, true)], measure);
    expect(touching.words.map((w) => w.text)).toEqual(["sk_live_abc123"]);
    // A label and its value with space between them, but no space character.
    const gap = textLayerToOcr([run("Email:", 50, 100), run("a@b.ro", 140, 100, true)], measure);
    expect(gap.text).toBe("Email: a@b.ro\n");
  });

  it("boxes a rotated run as a whole", () => {
    const r = textLayerToOcr([{ str: "AB12", transform: [0, -20, -20, 0, 300, 400], width: 40, hasEOL: true }], measure);
    expect(r.words).toHaveLength(1);
    const b = r.words[0]!.box;
    expect(b.y).toBeCloseTo(360);
    expect(b.h).toBeCloseTo(40);
  });

  it("returns nothing for an empty layer", () => {
    expect(textLayerToOcr([], measure)).toEqual({ text: "", words: [] });
  });
});
