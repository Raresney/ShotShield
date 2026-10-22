import { describe, it, expect } from "vitest";
import { pickOrientation, realWordRuns } from "../src/ocr.ts";

// The orientation search counts real letter runs to tell an upright read from a
// sideways one; rotated text only yields short, mixed, low-confidence fragments.
describe("realWordRuns", () => {
  it("counts a confident run of 4+ letters", () => {
    expect(realWordRuns("hello", 80)).toBe(1);
    expect(realWordRuns("nume", 60)).toBe(1);
  });

  it("counts runs inside code and config tokens", () => {
    expect(realWordRuns("DATABASE_URL=postgres://admin", 85)).toBe(3);
  });

  it("ignores a low-confidence read", () => {
    expect(realWordRuns("hello", 40)).toBe(0);
  });

  it("ignores the short / mixed fragments rotated text produces", () => {
    expect(realWordRuns("ab", 95)).toBe(0);
    expect(realWordRuns("12:30", 95)).toBe(0);
    expect(realWordRuns("a1b2", 95)).toBe(0);
  });
});

describe("pickOrientation", () => {
  it("keeps the image as given on a near-tie", () => {
    expect(pickOrientation([2, 0, 3, 1])).toBe(0);
    expect(pickOrientation([0, 0, 0, 0])).toBe(0);
  });

  it("rotates a sideways photo whose turn reads clearly better", () => {
    expect(pickOrientation([1, 14, 2, 0])).toBe(1);
    expect(pickOrientation([0, 1, 0, 9])).toBe(3);
  });

  it("needs a margin proportional to the as-is read", () => {
    expect(pickOrientation([6, 0, 10, 0])).toBe(0);
    expect(pickOrientation([6, 0, 13, 0])).toBe(2);
  });
});
