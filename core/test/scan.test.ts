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

test("detects common API keys and tokens", () => {
  const keys = [
    "ghp_1A2b3C4d5E6f7G8h9I0jK1lM2nO3pQ4rS5tU",
    "sk-abcDEF1234567890ghijKLMN",
    "AKIAIOSFODNN7EXAMPLE",
    // Split so GitHub's push protection doesn't flag our own test fixture.
    "xoxb-" + "12345678901-abcdEFGHijklMNOP",
  ];
  for (const key of keys) {
    const dets = scan(`token = ${key}`);
    assert.equal(dets.length, 1, key);
    assert.equal(dets[0]!.category, "api_key", key);
    assert.equal(dets[0]!.text, key, key);
  }
});

test("does not flag an sk- prefix that is too short to be a key", () => {
  assert.deepEqual(scan("the sk-foo helper"), []);
});

test("detects a JWT", () => {
  const jwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
    ".eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0" +
    ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
  const dets = scan(`Authorization: Bearer ${jwt}`);
  assert.equal(dets.length, 1);
  assert.equal(dets[0]!.category, "jwt");
  assert.equal(dets[0]!.text, jwt);
});

test("does not treat a plain dotted string as a JWT", () => {
  assert.deepEqual(scan("see config.local.json"), []);
});

test("detects credit cards and labels the brand", () => {
  const visa = scan("paid with 4111 1111 1111 1111 yesterday");
  assert.equal(visa.length, 1);
  assert.equal(visa[0]!.category, "credit_card");
  assert.equal(visa[0]!.label, "Visa card");

  const mc = scan("card 5555555555554444");
  assert.equal(mc[0]!.label, "Mastercard");
});

test("does not flag a long number that fails Luhn", () => {
  assert.deepEqual(scan("order 1234 5678 9012 3456"), []);
});

test("reads an ID machine-readable zone as MRZ, not a payment card", () => {
  // The MRZ packs digit runs against letters and `<` fillers; a run there can
  // pass Luhn by chance (4111… is the Visa test number) but it isn't a card.
  // The card detector's lookarounds reject it, and the MRZ detector claims it.
  const dets = scan("IDROU4111111111111111<<<<<<");
  assert.equal(dets.length, 1);
  assert.equal(dets[0]!.category, "mrz");
});

test("still detects a real card surrounded by punctuation", () => {
  const dets = scan("card:4111-1111-1111-1111.");
  assert.equal(dets.length, 1);
  assert.equal(dets[0]!.category, "credit_card");
  assert.equal(dets[0]!.label, "Visa card");
});

test("detects a valid IBAN", () => {
  const dets = scan("send it to DE89 3704 0044 0532 0130 00 please");
  assert.equal(dets.length, 1);
  assert.equal(dets[0]!.category, "iban");
});

test("ignores an IBAN-shaped string with a bad checksum", () => {
  assert.deepEqual(scan("ref DE00 3704 0044 0532 0130 00"), []);
});

test("does not start an IBAN match glued to a preceding letter", () => {
  // Same MRZ problem as cards: the country code shouldn't be picked up mid-token.
  assert.deepEqual(scan("XDE89370400440532013000"), []);
  // …but the same IBAN on its own is still detected.
  assert.equal(scan("IBAN: DE89 3704 0044 0532 0130 00").length, 1);
});

test("detects a Romanian CNP", () => {
  const dets = scan("CNP 1960209025813 pe buletin");
  assert.equal(dets.length, 1);
  assert.equal(dets[0]!.category, "national_id");
});

test("a Luhn-valid CNP is a national ID, not a payment card", () => {
  // 1800209020157 passes both the CNP control digit and Luhn. With the old
  // 13-digit floor the critical card rule shadowed the CNP; the 14-digit floor
  // keeps a 13-digit national ID out of the card detector entirely.
  const dets = scan("CNP 1800209020157");
  assert.equal(dets.length, 1);
  assert.equal(dets[0]!.category, "national_id");
});

test("detects the name line of an ID machine-readable zone", () => {
  // surname<<given-names, padded with `<` — a TD1/TD3 MRZ name line.
  const dets = scan("POPESCU<<ION<<<<<<<<<<<<<<<<<<");
  assert.equal(dets.length, 1);
  assert.equal(dets[0]!.category, "mrz");
});

test("does not treat lowercase code or shift operators as an MRZ", () => {
  assert.deepEqual(scan("stream << value << endl;"), []);
  assert.deepEqual(scan("MAX<<2"), []); // all-caps but far too short to be a zone
});

test("can disable the mrz category", () => {
  const t = "IDROU123456<<<<<<<<<<<<<<<<<<";
  assert.equal(scan(t).length, 1);
  assert.deepEqual(scan(t, { enabled: { mrz: false } }), []);
});

test("detects a Romanian ID card series and number", () => {
  const dets = scan("eliberat SERIA RK NR 123456 de SPCLEP");
  assert.equal(dets.length, 1);
  assert.equal(dets[0]!.category, "id_document");
  assert.equal(dets[0]!.label, "ID card number (RO)");
});

test("needs the series label, not any two letters and six digits", () => {
  assert.deepEqual(scan("order code AB 123456 shipped"), []);
});
