import { test } from "node:test";
import assert from "node:assert/strict";
import { scan } from "../src/index.ts";

// Real Tesseract output for a .env screenshot rendered in Consolas: the dotted
// zero and the letter O trade places, and @ comes back as Q.

const labels = (text: string) => scan(text).map((d) => d.label);

test("an IBAN whose country-code O was read as a zero", () => {
  assert.deepEqual(labels("PAYOUT_IBAN=R049AAAA1B31007593840000"), ["IBAN"]);
  assert.deepEqual(labels("RO49AAAA1B31007593840000"), ["IBAN"], "clean read still works");
  assert.ok(!labels("R049AAAA1B31007593840001").includes("IBAN"), "checksum still decides");
});

test("a phone number with a zero read as @ or O", () => {
  assert.deepEqual(labels("ONCALL_PHONE=+4@ 721 234 567"), ["Phone number"]);
  assert.deepEqual(labels("+4O 721 234 567"), ["Phone number"]);
  assert.deepEqual(scan("+1 @@@ @@@ @@@"), [], "mostly slips is not a number");
});

test("a database URL whose @ was lost and scheme colon spaced out", () => {
  const d = scan("DATABASE_URL=postgres: //admin:Wint3rCOmingQdb.acme.io:5432/app");
  assert.equal(d.length, 1);
  assert.equal(d[0]!.label, "Credentials in URL");
  assert.ok(d[0]!.text.startsWith("postgres: //admin:"));
});

test("a database URL with only host and port is not a credential", () => {
  for (const t of [
    "redis://cache.internal:6379",
    "postgres://db.acme.io:5432/app",
    "mongodb+srv://cluster0.abc.mongodb.net/app",
  ]) {
    assert.deepEqual(scan(t), [], t);
  }
});

test("a GitHub token split by a space, with a slashed zero read as @", () => {
  const d = scan("GITHUB_TOKEN=ghp_" + "R7nQ2mK9xV4bT6wL1pZ8cJ3hF 5dS@aE2yU7i");
  assert.equal(d.length, 1);
  assert.equal(d[0]!.label, "GitHub token");
  assert.ok(d[0]!.text.endsWith("5dS@aE2yU7i"), "the piece after the gap is covered too");
  // Too short once the gaps are closed: not a token.
  assert.deepEqual(labels("ghp_" + "abcdefghijklmnop qrs"), []);
});

test("an IBAN whose country code came back as R0O", () => {
  assert.deepEqual(labels("PAYOUT_IBAN=R0O49AAAA1B31007593840000"), ["IBAN"]);
  assert.ok(!labels("R0O49AAAA1B31007593840001").includes("IBAN"), "checksum still decides");
});

test("the same .env read by another renderer: @ inside the token, spaced login", () => {
  const text =
    "DATABASE_URL=postgres://admin: Tr@ub4dor-77@db. internal :5432/app\n" +
    "GITHUB_TOKEN=ghp_" + "R7nQ2mK9xV4bT6wL1pZ8cJ3hF5dS@aE2yU7i\n";
  const d = scan(text);
  assert.deepEqual(d.map((x) => x.label), ["Credentials in URL", "GitHub token"]);
  assert.ok(d[0]!.text.includes("Tr@ub4dor-77"), "the whole password is covered");
  // A short token-ish run with @ is still not a token.
  assert.deepEqual(labels("ghp_" + "abc@def"), []);
});
