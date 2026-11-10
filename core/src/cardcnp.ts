// The older Romanian ID card prints its CNP twice: once in full behind the
// "CNP" label, and once in pieces in the second MRZ line, where the birth date
// has its own field and the first digit plus the last six follow the expiry
// date. The MRZ is set in OCR-B and reads far more reliably off a photo than
// the printed number, which sits on a guilloche background under the laminate.
// So when that line reads cleanly, the card's own CNP is known, and the printed
// copy can be found approximately: a few misread, dropped or stray characters
// that would defeat every pattern still leave it close to the known value.

import { cnpValid } from "./validators.ts";

// Digits, and the letters (and marks) OCR reads in their place.
const LOOKALIKE: Record<string, string> = {
  O: "0", o: "0", Q: "0", D: "0",
  I: "1", l: "1", "|": "1", "!": "1",
  Z: "2", z: "2", A: "4", S: "5", G: "6", T: "7",
  B: "8", b: "8", g: "9", q: "9",
};
const asDigit = (c: string): string | undefined => (/\d/.test(c) ? c : LOOKALIKE[c]);
const digits = (s: string): string => [...s].map((c) => asDigit(c) ?? "").join("");

// The older card's second MRZ line (TD2, 36 chars): document number + check,
// ROU, birth date + check, sex, expiry + check, then the CNP's first digit and
// last six, then the final check digit.
const D = "[0-9OQDIZSB]";
const TD2_RO = new RegExp(`[A-Z0-9<]{9}[0-9O<]R[O0Q]U(${D}{6})${D}[MF<]${D}{6}${D}(${D}{7})`, "g");

/** The CNPs that ROU second MRZ lines in `text` spell out, checksum-valid only. */
export function cnpsFromMrz(text: string): string[] {
  const found = new Set<string>();
  for (const line of text.split("\n")) {
    for (const m of line.replace(/ /g, "").matchAll(TD2_RO)) {
      const birth = digits(m[1]!);
      const tail = digits(m[2]!);
      const cnp = tail[0] + birth + tail.slice(1);
      if (cnpValid(cnp)) found.add(cnp);
    }
  }
  return [...found];
}

/**
 * Spans of `text` that read as `cnp` within `maxEdits` character edits, after
 * undoing look-alike letters. Spaces, dots and dashes inside the run are
 * skipped (OCR splits the printed block), and a match never crosses a line.
 * A match must cover at least `minDigits` characters, so a short fragment
 * that happens to share a few digits isn't taken.
 */
export function findApprox(
  text: string,
  cnp: string,
  maxEdits = 4,
  minDigits = 10,
): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let lineStart = 0;
  for (const line of text.split("\n")) {
    // The line as a digit sequence, with each position's offset in `text`.
    const seq: string[] = [];
    const at: number[] = [];
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (/[ .\-–—]/.test(c)) continue;
      seq.push(asDigit(c) ?? "#");
      at.push(lineStart + i);
    }
    for (const s of approxIn(seq, cnp, maxEdits)) {
      if (s.end - s.start >= minDigits) spans.push({ start: at[s.start]!, end: at[s.end - 1]! + 1 });
    }
    lineStart += line.length + 1;
  }
  return spans;
}

// Approximate substring search (Sellers): edit distance of `p` against every
// substring of `t`, in one O(|p|·|t|) pass. Each local best that's within
// `k` edits is returned as a [start, end) range of `t`.
function approxIn(t: string[], p: string, k: number): Array<{ start: number; end: number }> {
  const m = p.length;
  let cost = Array.from({ length: m + 1 }, (_, i) => i);
  let from = Array.from({ length: m + 1 }, () => 0);
  const out: Array<{ start: number; end: number }> = [];
  let best: { start: number; end: number; d: number } | null = null;
  for (let j = 1; j <= t.length; j++) {
    const c = [0];
    const f = [j];
    for (let i = 1; i <= m; i++) {
      const sub = cost[i - 1]! + (p[i - 1] === t[j - 1] ? 0 : 1);
      const skipText = cost[i]! + 1;
      const skipPattern = c[i - 1]! + 1;
      if (sub <= skipText && sub <= skipPattern) {
        c.push(sub);
        f.push(from[i - 1]!);
      } else if (skipText <= skipPattern) {
        c.push(skipText);
        f.push(from[i]!);
      } else {
        c.push(skipPattern);
        f.push(f[i - 1]!);
      }
    }
    cost = c;
    from = f;
    const d = c[m]!;
    if (d <= k) {
      const here = { start: f[m]!, end: j, d };
      if (best && here.start < best.end) {
        if (d < best.d) best = here;
      } else {
        if (best) out.push(best);
        best = here;
      }
    }
  }
  if (best) out.push(best);
  return out;
}
