import { describe, it, expect } from "vitest";
import { redactedName, uniqueNames } from "../src/export.ts";

describe("redactedName", () => {
  it("keeps the source name and marks it redacted", () => {
    expect(redactedName("Screenshot 2026-10-23 at 14.02.png")).toBe("Screenshot-2026-10-23-at-14.02-redacted.png");
  });

  it("falls back to a generic name for clipboard images", () => {
    expect(redactedName("clipboard")).toBe("screenshot-redacted.png");
    expect(redactedName(null)).toBe("screenshot-redacted.png");
  });
});

describe("uniqueNames", () => {
  it("suffixes repeats so a batch never overwrites itself", () => {
    expect(uniqueNames(["a.png", "b.png", "a.png", "A.png"])).toEqual(["a.png", "b.png", "a-2.png", "A-3.png"]);
  });

  it("handles names without an extension", () => {
    expect(uniqueNames(["x", "x"])).toEqual(["x", "x-2"]);
  });
});
