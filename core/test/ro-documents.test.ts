import { test } from "node:test";
import assert from "node:assert/strict";
import { scan } from "../src/index.ts";

const hits = (text: string, category: string) =>
  scan(text).filter((d) => d.category === category).map((d) => d.text);

test("Romanian number plates, with or without spaces", () => {
  assert.deepEqual(hits("Masina CJ 12 ABC parcata langa B 123 XYZ si IS-07-KLM.", "license_plate"), [
    "CJ 12 ABC",
    "B 123 XYZ",
    "IS-07-KLM",
  ]);
  assert.deepEqual(hits("plate: AG07RTF", "license_plate"), ["AG07RTF"]);
});

test("plate-shaped text that isn't a plate stays clean", () => {
  // Unknown county, a lowercase tail, a letter group starting with O or I,
  // and a plate glued inside a longer token.
  assert.deepEqual(hits("XX 12 ABC", "license_plate"), []);
  assert.deepEqual(hits("CJ 12 abc", "license_plate"), []);
  assert.deepEqual(hits("CJ 12 OAK and B 10 IIS", "license_plate"), []);
  assert.deepEqual(hits("ID_CJ12ABC9", "license_plate"), []);
});

test("passport numbers behind their label", () => {
  assert.deepEqual(hits("Nr. pașaport: 054123456", "id_document"), ["054123456"]);
  assert.deepEqual(hits("Passport No. 05123456", "id_document"), ["05123456"]);
  assert.deepEqual(hits("PASSPORT NO.X1234567", "id_document"), ["X1234567"]);
  // No label, no hit: an 8-digit run alone is just a number.
  assert.deepEqual(hits("Order 05123456 shipped", "id_document"), []);
});

test("driving licence numbers behind their label", () => {
  assert.deepEqual(hits("Nr. permis de conducere: 123456789", "id_document"), ["123456789"]);
  assert.deepEqual(hits("Driving licence number AB123456", "id_document"), ["AB123456"]);
  // Words after the label aren't a number.
  assert.deepEqual(hits("Permis nr. EXPIRAT", "id_document"), []);
});
