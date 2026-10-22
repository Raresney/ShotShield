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
