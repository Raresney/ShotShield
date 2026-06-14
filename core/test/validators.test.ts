import { test } from "node:test";
import assert from "node:assert/strict";
import { luhn } from "../src/validators.ts";

test("luhn accepts valid numbers and rejects off-by-one", () => {
  assert.ok(luhn("4111111111111111")); // Visa test number
  assert.ok(!luhn("4111111111111112"));
  assert.ok(!luhn("nope"));
});
