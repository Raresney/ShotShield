import { test } from "node:test";
import assert from "node:assert/strict";
import { scan } from "../src/index.ts";

// ReDoS / fuzz guard. Every built-in pattern runs with the global flag over
// whatever text OCR rebuilds, so a single catastrophic-backtracking pattern
// would let a crafted (or just unlucky) image hang the scan. These cases feed
// scan() the inputs that exercise the ambiguous parts of each regex (long runs
// of the same class, the `.`/`@`/`<` structure the email and MRZ rules pivot on)
// and assert the whole scan stays well under a time budget. A quadratic pattern
// clears this comfortably; an exponential one blows past it, failing CI.

// Generous enough that a loaded CI box won't flake on a linear scan of a large
// input, tight enough that genuine catastrophic backtracking (seconds to
// minutes) trips it. A bounded pattern clears this with room to spare.
const BUDGET_MS = 2000;

function timed(text: string): number {
  const t0 = performance.now();
  const out = scan(text);
  const dt = performance.now() - t0;
  assert.ok(Array.isArray(out), "scan must return an array");
  return dt;
}

const N = 20_000;
const adversarial: Record<string, string> = {
  // Names: a long run of given names, every one a window to weigh, and a word
  // glued from hyphens and apostrophes for the tokenizer.
  "name run": "Ana Maria ".repeat(N),
  "name hyphen glue": "Ana" + "-Maria'Ion".repeat(N),
  // Email: local-part, then a long dotted tail that never resolves to a TLD.
  "email dotted tail": "a".repeat(N) + "@" + "a.".repeat(N),
  "email trailing dots": "user@" + ".".repeat(N),
  // MRZ: a wall of fillers and uppercase, the `<<`-anchored rule's worst case.
  "mrz fillers": "<".repeat(N),
  "mrz uppercase": "A".repeat(N) + "<<" + "B".repeat(N),
  // The fixed-field MRZ line rules, on spaced uppercase and digit tokens.
  "mrz spaced line": "A1 ".repeat(N),
  // A card whose MRZ spells out a CNP, so the approximate search runs over a
  // long line of digits and look-alikes.
  "card cnp search": "ZZ123456<1ROU9503124F301015024012313\n" + "29503lZ4|0 ".repeat(N / 4),
  "mrz date fields": "ZZ123456<1ROU 9503124F ".repeat(N / 20),
  // Long digit runs feed the card / CNP / phone passes at once.
  "digit run": "1".repeat(N),
  // Separator-joined short tokens hammer the split-CNP multi-run pass, one
  // case per separator class member it stitches across.
  "split tokens": "12 ".repeat(N),
  "dotted tokens": "12.".repeat(N),
  "dashed tokens": "12-".repeat(N),
  "newline tokens": "12\n".repeat(N),
  // Mixed look-alike letters the CNP unconfuse passes walk over.
  "cnp lookalikes": "OISBZ ".repeat(N),
  // The credential pass: a lookbehind on a secret name, tried at every offset.
  "secret names": "password_secret_token.".repeat(N / 10),
  "secret assignments": "pwd=pwd=".repeat(N / 4),
  // Key-body continuation across spaces.
  "key tail pieces": "sk-proj-" + "a1b2c3d4 ".repeat(N / 4),
  "key tail no digit": "sk-proj-" + "abcdefghabcdefgh ".repeat(N / 8),
  // URL credentials and IPs.
  "url colons": "a://" + "b:".repeat(N),
  "url at signs": "ab://u:" + "p@".repeat(N),
  "ip dots": "1.".repeat(N),
  "hex run": "0x" + "a".repeat(N),
  // OCR-slip variants: spaced scheme, db URL without @, zero-as-@ phone.
  "db url colons": "postgres: //u:" + "a:".repeat(N),
  "phone slips": "+1" + " @".repeat(N),
  "iban zero code": "R0" + "1".repeat(N),
  // Form-label names: a label wall, and capitalised words that never end.
  "name labels": "Name: ".repeat(N / 4),
  "name words": "Name: " + "Ab-".repeat(N),
  // ID name on the line under its label: label fragments on every line, and
  // capitals that run on without ending the line.
  "id name lines": "nume last name\nABC\n".repeat(N / 16),
  "id name capitals": "prenume\n" + "AB ".repeat(N),
  // Address parts: county lines, and a street whose flat parts never stop.
  "county lines": "Jud.CJ Mun.".repeat(N / 10),
  "street parts": "Str.A" + " bl,1".repeat(N / 4),
  "street name run": "Str." + "A b".repeat(N),
};

for (const [name, input] of Object.entries(adversarial)) {
  test(`adversarial input stays under budget: ${name}`, () => {
    const dt = timed(input);
    assert.ok(dt < BUDGET_MS, `scan took ${dt.toFixed(0)}ms (budget ${BUDGET_MS}ms)`);
  });
}

// Random fuzzing: scan() must never throw on arbitrary text, regardless of the
// byte soup it gets. Deterministic PRNG so a failure reproduces.
test("random fuzz: scan never throws", () => {
  let seed = 0x1234abcd;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  // A pool weighted toward the characters the detectors care about.
  const pool = "0123456789ABCDEFOISBZ<.@:- /\nghp_sk";
  for (let iter = 0; iter < 200; iter++) {
    const len = Math.floor(rand() * 2000);
    let s = "";
    for (let i = 0; i < len; i++) s += pool[Math.floor(rand() * pool.length)];
    assert.doesNotThrow(() => scan(s));
  }
});

test("an allow entry full of stars stays fast on a long value", () => {
  const key = "-----BEGIN PRIVATE KEY-----\n" + "A".repeat(4000) + "\n-----END PRIVATE KEY-----";
  const t0 = performance.now();
  scan(key, { allow: ["*a*a*a*a*a*a*a*a*a*a*a*a*b"] });
  assert.ok(performance.now() - t0 < 200);
});
