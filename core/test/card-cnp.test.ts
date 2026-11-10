import { test } from "node:test";
import assert from "node:assert/strict";
import { scan } from "../src/index.ts";
import { cnpsFromMrz, findApprox } from "../src/cardcnp.ts";

// A made-up older Romanian ID: CNP 2950312401231. Its second MRZ line carries
// the birth date (950312) and the first digit plus last six (2 + 401231).
const MRZ = "IDROUPOPESCU<<ANA<<<<<<<<<<<<<<<<<<<\nZZ123456<1ROU9503124F301015024012313";
const card = (printed: string) => `ROMANIA CARTE DE IDENTITATE\n${printed}\n${MRZ}`;
const cnpHits = (text: string) => scan(text).filter((d) => d.category === "national_id").map((d) => d.text);

test("the CNP is rebuilt from the second MRZ line", () => {
  assert.deepEqual(cnpsFromMrz(MRZ), ["2950312401231"]);
  // OCR spaces and O-for-0 in the line don't matter.
  assert.deepEqual(cnpsFromMrz("ZZ123456<1ROU 95O3124F 3010150 24O12313"), ["2950312401231"]);
  assert.deepEqual(cnpsFromMrz("ZZ123456<1R0U9503124F301015024012313"), ["2950312401231"]);
  // A misread that breaks the CNP control digit gives nothing, not a wrong CNP.
  assert.deepEqual(cnpsFromMrz("ZZ123456<1ROU9503124F301015024012393"), []);
  // Another country's card carries no CNP.
  assert.deepEqual(cnpsFromMrz("ZZ123456<1HUN9503124F301015024012313"), []);
});

test("a printed CNP the patterns can't read is found through the MRZ", () => {
  // A stray mark read for a digit: every pattern pass misses this one alone.
  assert.deepEqual(cnpHits("CNP 29503l24|01231"), []);
  assert.deepEqual(cnpHits(card("CNP 29503l24|01231")), ["29503l24|01231"]);
  // Label lost, a digit dropped, a hologram mark and a split.
  assert.deepEqual(cnpHits(card("CMP 295031 4)1231")), ["295031 4)1231"]);
  // Two digits misread so the date no longer parses.
  assert.deepEqual(cnpHits(card("CNP 2957312A0l2E1")), ["2957312A0l2E1"]);
});

test("a cleanly read CNP is still one finding", () => {
  assert.deepEqual(cnpHits(card("CNP 2950312401231")), ["2950312401231"]);
});

test("other numbers on the card are not mistaken for the CNP", () => {
  const text = card("CNP 2950312401231\nTel 0721 234 567\nEmis 12.03.2015 SPCLEP Sector 4\nNr 7716254012");
  assert.deepEqual(cnpHits(text), ["2950312401231"]);
  // Too far from the card's CNP, or just a fragment of it.
  assert.deepEqual(findApprox("2950399999999", "2950312401231"), []);
  assert.deepEqual(findApprox("Seria 950312", "2950312401231"), []);
});

test("the MRZ route honours the CNP switch and the allow list", () => {
  const text = card("CNP 29503l24|01231");
  assert.deepEqual(scan(text, { enabled: { national_id: false } }).filter((d) => d.category === "national_id"), []);
  assert.deepEqual(scan(text, { allow: ["2950312401231"] }).filter((d) => d.category === "national_id"), []);
});
