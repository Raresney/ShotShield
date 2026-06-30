import { test } from "node:test";
import assert from "node:assert/strict";
import { scan } from "../src/index.ts";

// ReDoS / fuzz guard. Every built-in pattern runs with the global flag over
// whatever text OCR rebuilds, so a single catastrophic-backtracking pattern
// would let a crafted (or just unlucky) image hang the scan. These cases feed
// scan() the inputs that exercise the ambiguous parts of each regex — long runs
// of the same class, the `.`/`@`/`<` structure the email and MRZ rules pivot on —
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
  // Email: local-part, then a long dotted tail that never resolves to a TLD.
  "email dotted tail": "a".repeat(N) + "@" + "a.".repeat(N),
  "email trailing dots": "user@" + ".".repeat(N),
  // MRZ: a wall of fillers and uppercase, the `<<`-anchored rule's worst case.
  "mrz fillers": "<".repeat(N),
  "mrz uppercase": "A".repeat(N) + "<<" + "B".repeat(N),
  // Long digit runs feed the card / CNP / phone passes at once.
  "digit run": "1".repeat(N),
  // Space-separated short tokens hammer the split-CNP two-group pass.
  "split tokens": "12 ".repeat(N),
  // Mixed look-alike letters the CNP unconfuse passes walk over.
  "cnp lookalikes": "OISBZ ".repeat(N),
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
