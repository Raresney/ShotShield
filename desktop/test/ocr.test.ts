import { describe, it, expect } from "vitest";
import { isRealWord } from "../src/ocr.ts";

// The orientation search counts "real words" to tell an upright read from a
// sideways one; rotated text only yields short, mixed, low-confidence fragments.
describe("isRealWord", () => {
  it("accepts a confident run of 4+ letters", () => {
    expect(isRealWord("hello", 80)).toBe(true);
    expect(isRealWord("nume", 60)).toBe(true);
  });

  it("rejects a low-confidence read", () => {
    expect(isRealWord("hello", 40)).toBe(false);
  });

  it("rejects the short / mixed fragments rotated text produces", () => {
    expect(isRealWord("ab", 95)).toBe(false); // too short
    expect(isRealWord("12:30", 95)).toBe(false); // not letters
    expect(isRealWord("a1b2", 95)).toBe(false); // mixed
  });
});
