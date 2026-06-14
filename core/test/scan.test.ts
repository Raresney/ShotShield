import { test } from "node:test";
import assert from "node:assert/strict";
import { scan, type ScanConfig } from "../src/index.ts";

const categories = (text: string, cfg?: ScanConfig): string[] =>
  scan(text, cfg).map((d) => d.category);

test("detects an email address", () => {
  const dets = scan("ping me at alice.dev@example.com ok");
  assert.equal(dets.length, 1);
  assert.equal(dets[0]!.category, "email");
  assert.equal(dets[0]!.text, "alice.dev@example.com");
});

test("returns nothing when there is nothing sensitive", () => {
  assert.deepEqual(scan("just some ordinary text"), []);
});

test("can disable a category", () => {
  const text = "mail me at alice@example.com";
  assert.deepEqual(categories(text), ["email"]);
  assert.deepEqual(categories(text, { enabled: { email: false } }), []);
});

test("supports user-defined custom rules", () => {
  const dets = scan("ticket ACME-99213 filed", {
    customRules: [{ id: "acme", label: "ACME ticket", pattern: "ACME-\\d{4,6}" }],
  });
  assert.equal(dets.length, 1);
  assert.equal(dets[0]!.category, "custom");
  assert.equal(dets[0]!.label, "ACME ticket");
});
