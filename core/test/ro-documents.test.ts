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

// A made-up older Romanian ID: CNP 2950312401231, card ZZ 123456. Its second
// MRZ line has a single "<" filler, so the "<<" run that marks the first line
// isn't there to find; the line is recognised by its fixed fields instead.
const MRZ2 = "ZZ123456<1ROU9503124F301015024012313";

test("the second MRZ line of an ID card is covered", () => {
  assert.deepEqual(hits(MRZ2, "mrz"), [MRZ2]);
  assert.deepEqual(hits(`IDROUPOPESCU<<ANA<<<<<<<<<<<<<<<<<<<\n${MRZ2}`, "mrz"), [
    "IDROUPOPESCU<<ANA<<<<<<<<<<<<<<<<<<<",
    MRZ2,
  ]);
});

test("the second MRZ line as OCR reads it off a photo", () => {
  // Spaces where the reader split the line, O read for 0 in the dates.
  const spaced = "ZZ123456<1ROU 9503124F 3010150 24012313";
  assert.deepEqual(hits(spaced, "mrz"), [spaced]);
  const slipped = "ZZ123456<1ROU95O3124F3O1O15024012313";
  assert.deepEqual(hits(slipped, "mrz"), [slipped]);
  // And the other way round: a zero read for the O of ROU.
  const zero = "ZZ123456<1R0U9503124F301015024012313";
  assert.deepEqual(hits(zero, "mrz"), [zero]);
});

test("the second MRZ line of a passport and of a credit-card-sized ID", () => {
  // ICAO's specimen passport, and a TD1 card (birth date first) with no fillers.
  const td3 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";
  assert.deepEqual(hits(td3, "mrz"), [td3]);
  const td1 = "9503124F3010150ROU24012313ZZ12";
  assert.deepEqual(hits(td1, "mrz"), [td1]);
});

test("MRZ-shaped text with impossible dates is left alone", () => {
  assert.deepEqual(hits("ZZ123456<1ROU9513124F301015024012313", "mrz"), []);
  assert.deepEqual(hits("9513124F3010150ROU24012313ZZ12", "mrz"), []);
  assert.deepEqual(hits("Build ZZ123456 ROU passed in 9503 ms", "mrz"), []);
});
