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

test("an invalid custom rule is skipped, not fatal to the scan", () => {
  // A broken user pattern must not throw and abort the whole scan: the built-in
  // detectors and any valid custom rules still run.
  const prevWarn = console.warn;
  console.warn = () => {}; // silence the expected skip notice
  try {
    const dets = scan("mail alice@example.com ref ACME-1234", {
      customRules: [
        { id: "bad", label: "broken", pattern: "(" }, // unbalanced group
        { id: "ok", label: "ACME ticket", pattern: "ACME-\\d{4}" },
      ],
    });
    const cats = dets.map((d) => d.category).sort();
    assert.deepEqual(cats, ["custom", "email"]);
  } finally {
    console.warn = prevWarn;
  }
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

test("redacts a CNP behind its label even when OCR splits the digits", () => {
  // A phone photo often breaks the 13-digit run with stray spaces; anchored on
  // the printed "CNP" label we stitch it back together. The strict pass can't —
  // it needs 13 contiguous digits.
  const dets = scan("CNP 196020 9025813");
  assert.equal(dets.length, 1);
  assert.equal(dets[0]!.category, "national_id");
});

test("redacts a CNP whose control digit a misread has broken, label or not", () => {
  // 1960209025811 fails the checksum (the real number ends in 3) but its embedded
  // date and county still read true. We redact it on the strength of that structure
  // rather than leave an ID number in the clear over a single OCR typo — whether or
  // not a "CNP" label survived the photo.
  const bare = scan("1960209025811");
  assert.equal(bare.length, 1);
  assert.equal(bare[0]!.category, "national_id");
  const labelled = scan("CNP 1960209025811");
  assert.equal(labelled.length, 1);
  assert.equal(labelled[0]!.category, "national_id");
});

test("redacts a label-free CNP through letter-for-digit OCR slips", () => {
  // No "CNP" label in reach and the checksum broken, but the run still unscrambles
  // to a structurally valid CNP. "19G0Z09025811" is 1960209025811 with 6->G, 2->Z.
  const dets = scan("seria 19G0Z09025811 emis");
  assert.equal(dets.length, 1);
  assert.equal(dets[0]!.category, "national_id");
});

test("ignores a bare 13-digit run with no valid CNP date", () => {
  // 13-digit timestamps/order ids land an out-of-range month or day (here 90/00
  // and 45/67), so the label-free pass leaves them alone. This is what keeps the
  // looser checksum-free rule from flagging arbitrary long numbers in logs.
  assert.deepEqual(scan("seq 1709000000000 done"), []);
  assert.deepEqual(scan("ref 1234567890123 ok"), []);
});

test("redacts a CNP glued to its label with a broken control digit", () => {
  // "CNP1960209025811": OCR dropped the gap *and* flipped a digit. The strict run
  // rejects the bad checksum, and a label anchor that demands a word boundary after
  // "CNP" can't see a number fused onto it — so only the loosened anchor catches it.
  const dets = scan("CNP1960209025811");
  assert.equal(dets.length, 1);
  assert.equal(dets[0]!.category, "national_id");
});

test("redacts a labelled CNP through letter-for-digit OCR slips", () => {
  // Beyond O/I/S/B a photo flips 6→G and 2→Z. "19G0Z090Z5813" is 1960209025813
  // mangled that way; undo the look-alikes behind the label and the control checks.
  const dets = scan("CNP 19G0Z090Z5813");
  assert.equal(dets.length, 1);
  assert.equal(dets[0]!.category, "national_id");
});

test("does not redact a short number after the letters CNP", () => {
  assert.deepEqual(scan("CNP 1234"), []);
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

test("redacts a name behind a Romanian ID label", () => {
  const d = scan("NUME POPESCU");
  assert.equal(d.length, 1);
  assert.equal(d[0]!.category, "name");
  assert.equal(d[0]!.text, "POPESCU"); // the label itself stays out of the hit
});

test("handles trilingual labels and a two-part given name", () => {
  assert.equal(scan("Prenume ION ANDREI")[0]?.category, "name");
  assert.equal(scan("Last name SMITH")[0]?.category, "name");
});

test("does not fire on a label without an uppercase value", () => {
  assert.deepEqual(scan("the last name field is required"), []);
});

test("does not redact a bare column-header label as a name", () => {
  assert.deepEqual(scan("NUME PRENUME"), []);
});

test("can disable the name category", () => {
  assert.deepEqual(scan("NUME POPESCU", { enabled: { name: false } }), []);
});

test("detects an international phone number", () => {
  const d = scan("call me on +40 712 345 678 tomorrow");
  assert.equal(d.length, 1);
  assert.equal(d[0]!.category, "phone");
  assert.equal(d[0]!.text, "+40 712 345 678");
});

test("detects a Romanian mobile number, spaced or not", () => {
  assert.equal(scan("tel 0712 345 678")[0]?.category, "phone");
  assert.equal(scan("0712345678")[0]?.category, "phone");
});

test("does not flag a 10-digit run that isn't a phone", () => {
  assert.deepEqual(scan("order 1623456789 shipped"), []); // starts with 1, no +
});

test("does not pick a phone out of a longer digit run", () => {
  // The CNP's 13 digits shouldn't yield a phone; lookarounds reject the glue.
  assert.deepEqual(categories("1960209025813").filter((c) => c === "phone"), []);
});

test("can disable the phone category", () => {
  assert.deepEqual(scan("0712345678", { enabled: { phone: false } }), []);
});

test("detects a SWIFT/BIC behind its label", () => {
  assert.equal(scan("BIC: RZBRROBU")[0]?.category, "bic");
  assert.equal(scan("SWIFT RZBRROBUXXX")[0]?.category, "bic"); // 11-char, with branch
  assert.equal(scan("Cod SWIFT BTRLRO22")[0]?.category, "bic");
});

test("does not flag an unlabelled 8-letter token or the Swift language", () => {
  assert.deepEqual(scan("the DEADBEEF marker"), []);
  assert.deepEqual(scan("written in Swift recently"), []);
});

test("detects a CVV behind its label", () => {
  assert.equal(scan("CVV: 123")[0]?.category, "cvv");
  assert.equal(scan("CVC 4567")[0]?.category, "cvv");
});

test("does not flag a CVV label with no number, or a longer run", () => {
  assert.deepEqual(scan("enter your CVV now"), []);
  assert.deepEqual(categories("CVV 123456").filter((c) => c === "cvv"), []);
});

test("can disable the bic and cvv categories", () => {
  assert.deepEqual(scan("BIC: RZBRROBU", { enabled: { bic: false } }), []);
  assert.deepEqual(scan("CVV: 123", { enabled: { cvv: false } }), []);
});

test("detects a Romanian tax id (CUI/CIF) with a valid checksum", () => {
  assert.equal(scan("CUI 13548146")[0]?.category, "tax_id");
  assert.equal(scan("factura RO13548146")[0]?.category, "tax_id");
  assert.equal(scan("CIF: 13548146")[0]?.category, "tax_id");
});

test("ignores a CUI-shaped number with a bad checksum", () => {
  assert.deepEqual(scan("CUI 13548147"), []);
});

test("does not flag a bare number without the RO/CUI anchor", () => {
  assert.deepEqual(categories("13548146").filter((c) => c === "tax_id"), []);
});

test("can disable the tax_id category", () => {
  assert.deepEqual(scan("CUI 13548146", { enabled: { tax_id: false } }), []);
});
