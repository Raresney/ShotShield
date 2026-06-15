import { test } from "node:test";
import assert from "node:assert/strict";
import { luhn, ibanValid, cnpValid, cuiValid } from "../src/validators.ts";

test("luhn accepts valid numbers and rejects off-by-one", () => {
  assert.ok(luhn("4111111111111111")); // Visa test number
  assert.ok(!luhn("4111111111111112"));
  assert.ok(!luhn("nope"));
});

test("ibanValid checks the mod-97 checksum", () => {
  assert.ok(ibanValid("DE89370400440532013000"));
  assert.ok(ibanValid("GB82WEST12345698765432"));
  assert.ok(!ibanValid("DE00370400440532013000"));
});

test("cnpValid checks the Romanian control digit", () => {
  assert.ok(cnpValid("1960209025813"));
  assert.ok(!cnpValid("1960209025810")); // wrong control digit
  assert.ok(!cnpValid("123"));
});

test("cuiValid checks the Romanian fiscal control digit", () => {
  assert.ok(cuiValid("13548146"));
  assert.ok(cuiValid("RO13548146")); // the RO prefix is ignored
  assert.ok(!cuiValid("13548147")); // wrong control digit
  assert.ok(!cuiValid("1"));
});
