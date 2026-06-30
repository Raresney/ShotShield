// Built-in detectors. Each entry is a pattern plus an optional refine() that
// validates a raw match. Adding a detector means adding a row here.

import type { Category, Severity } from "./types.ts";
import { luhn, ibanValid, cnpValid, cuiValid } from "./validators.ts";

export interface PatternSpec {
  category: Category;
  label: string;
  severity: Severity;
  /** Pattern source; compiled with the global flag in the scanner. */
  source: string;
  /** Extra flags besides "g". */
  flags?: string;
  baseConfidence: number;
  /** Return false to reject a match, or an object to accept it (with overrides). */
  refine?: (raw: string) => false | { label?: string; confidence?: number };
}

const digitsOnly = (s: string): string => s.replace(/\D/g, "");

// Undo the digit-for-letter slips OCR makes on a photo, then drop anything left
// (stray spaces, punctuation). Shared by the two CNP passes that read mangled
// runs: O->0, I/l->1, Z->2, A->4, S->5, G->6, T->7, B->8, g/q->9.
const unconfuseDigits = (s: string): string =>
  s
    .replace(/[OoQD]/g, "0").replace(/[Il]/g, "1").replace(/[Zz]/g, "2")
    .replace(/A/g, "4").replace(/S/g, "5").replace(/G/g, "6")
    .replace(/T/g, "7").replace(/[Bb]/g, "8").replace(/[gq]/g, "9")
    .replace(/\D/g, "");

// A CNP encodes the holder's sex/century, birth date and county before the
// control digit: S YY MM DD JJ NNN C. Validating that embedded date and county
// is far more robust on a photo than the control digit — a single misread digit
// breaks the checksum, but the month, day and county still read true — while
// staying precise: a random 13-digit run (a timestamp, an order id) almost
// always lands an out-of-range month or day. County codes run 01-52.
function cnpStructValid(d: string): boolean {
  if (!/^[1-8]\d{12}$/.test(d)) return false;
  const month = +d.slice(3, 5);
  const day = +d.slice(5, 7);
  const county = +d.slice(7, 9);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 && county >= 1 && county <= 52;
}

function cardBrand(d: string): string {
  if (/^4\d{12,18}$/.test(d)) return "Visa card";
  if (/^(5[1-5]\d{14}|2(22[1-9]|2[3-9]\d|[3-6]\d\d|7[01]\d|720)\d{12})$/.test(d)) return "Mastercard";
  if (/^3[47]\d{13}$/.test(d)) return "Amex card";
  if (/^(6011\d{12}|65\d{14}|64[4-9]\d{13})$/.test(d)) return "Discover card";
  return "Payment card";
}

export const BUILTIN_PATTERNS: PatternSpec[] = [
  // ── Secrets & API keys ──────────────────────────────────────────────────
  // Known-prefix formats only: high precision, no entropy guessing. Catching
  // keys we don't have a prefix for is a separate, noisier job for later.
  // TODO: generic high-entropy secret pass behind an opt-in flag.
  { category: "api_key", label: "GitHub token", severity: "critical",
    source: "gh[pousr]_[A-Za-z0-9]{36}", baseConfidence: 0.99 },
  { category: "api_key", label: "OpenAI API key", severity: "critical",
    source: "sk-(?:proj-)?[A-Za-z0-9_-]{20,}", baseConfidence: 0.9 },
  { category: "api_key", label: "AWS access key ID", severity: "critical",
    source: "AKIA[0-9A-Z]{16}", baseConfidence: 0.97 },
  { category: "api_key", label: "Google API key", severity: "critical",
    source: "AIza[0-9A-Za-z_-]{35}", baseConfidence: 0.95 },
  { category: "api_key", label: "Slack token", severity: "critical",
    source: "xox[baprs]-[0-9A-Za-z-]{10,48}", baseConfidence: 0.95 },
  { category: "api_key", label: "Stripe secret key", severity: "critical",
    source: "(?:sk|rk)_live_[0-9A-Za-z]{16,}", baseConfidence: 0.97 },
  { category: "api_key", label: "SendGrid API key", severity: "critical",
    source: "SG\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}", baseConfidence: 0.97 },
  { category: "api_key", label: "Private key block", severity: "critical",
    source: "-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----", baseConfidence: 0.99 },

  // ── JWT ─────────────────────────────────────────────────────────────────
  // header.payload.signature, each base64url. The leading eyJ ({" in base64)
  // is what keeps this from matching arbitrary dotted strings.
  { category: "jwt", label: "JSON Web Token", severity: "high",
    source: "eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}", baseConfidence: 0.92 },

  // ── Payment cards ─────────────────────────────────────────────────────────
  // Loose digit-run match (spaces/dashes allowed), then Luhn decides. Brand is
  // a nicer label than a bare "card number". The lookarounds reject a run glued
  // to letters or the `<` filler of an ID's machine-readable zone — those pack
  // long digit strings that pass Luhn by chance but aren't cards. Floor is 14:
  // 13-digit PANs are extinct and 13 collides exactly with the Romanian CNP.
  { category: "credit_card", label: "Payment card", severity: "critical",
    source: "(?<![0-9A-Za-z<])(?:\\d[ -]?){13,18}\\d(?![0-9A-Za-z<])", baseConfidence: 0.5,
    refine: (raw) => {
      const d = digitsOnly(raw);
      if (d.length < 14 || d.length > 19 || !luhn(d)) return false;
      return { confidence: 0.97, label: cardBrand(d) };
    } },

  // ── IBAN ──────────────────────────────────────────────────────────────────
  // The leading lookbehind stops the country-code pair from starting inside a
  // longer token — e.g. the "OU82…" buried in an ID's "IDROU82…" MRZ line,
  // which could otherwise clear mod-97 by chance.
  { category: "iban", label: "IBAN", severity: "high",
    source: "(?<![0-9A-Za-z<])[A-Z]{2}\\d{2}(?:[ ]?[A-Z0-9]){11,30}", baseConfidence: 0.7,
    refine: (raw) => (ibanValid(raw.replace(/\s/g, "")) ? { confidence: 0.98 } : false) },

  // ── SWIFT/BIC ───────────────────────────────────────────────────────────────
  // A bank identifier is 8 or 11 chars: 4-letter bank, 2-letter country, 2 alnum
  // location, optional 3 alnum branch. Eight uppercase chars are common in code
  // (constant names, DEADBEEF), so we anchor on a printed BIC/SWIFT label — the
  // label carries the precision, the strict shape guards the value. Uppercase-only
  // on purpose, so the "Swift" language word in a dev screenshot isn't flagged.
  { category: "bic", label: "SWIFT/BIC", severity: "high",
    source: "(?<=\\b(?:[Cc]od\\s)?(?:BIC|SWIFT)(?:/(?:BIC|SWIFT))?[\\s:]{0,3})[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?(?![A-Z0-9])",
    baseConfidence: 0.9 },

  // ── Card security code ───────────────────────────────────────────────────────
  // A CVV is just 3–4 digits — meaningless on its own. Anchored on the printed
  // label it's a precise, high-value catch: a CVV beside a card is a real leak.
  { category: "cvv", label: "Card security code", severity: "high",
    source: "(?<=\\b(?:CVV2?|CVC2?|CV2|CVN)\\b[\\s:]{0,3})\\d{3,4}(?!\\d)",
    baseConfidence: 0.85 },

  // ── National IDs ──────────────────────────────────────────────────────────
  // Two passes for the Romanian CNP. First the strict one: a bare 13-digit run
  // is only a CNP if its control digit checks out — that keeps random 13-digit
  // numbers in logs and configs from being flagged.
  { category: "national_id", label: "CNP (RO)", severity: "high",
    source: "[1-9]\\d{12}", baseConfidence: 0.4,
    refine: (raw) => (cnpValid(raw) ? { confidence: 0.95 } : false) },

  // Then the buletin pass: the CNP printed behind a "CNP" label. A phone photo
  // defeats the strict rule — OCR splits the run with stray spaces, glues the
  // label onto the number ("CNP5050…"), and flips digits to look-alike letters
  // (O→0, S→5, B→8, but also 2→Z, 4→A, 6→G, 7→T, 9→g…), breaking the control
  // digit. Anchored loosely on the label — leading boundary only, so a glued
  // number still matches — we undo those confusables, allow the spaces, and
  // redact a ~13-digit run whether or not the checksum survives: the label carries
  // the precision, and one misread digit shouldn't leave an ID number in the clear.
  { category: "national_id", label: "CNP (RO)", severity: "high",
    source: "(?<=\\bCNP[\\s.:|/-]{0,4})[\\dOoQDIlSBbZzAGTgq][\\dOoQDIlSBbZzAGTgq ]{11,15}",
    baseConfidence: 0.85,
    refine: (raw) => {
      const d = unconfuseDigits(raw);
      if (d.length < 12 || d.length > 16) return false;
      return { confidence: d.length === 13 && cnpValid(d) ? 0.97 : 0.85 };
    } },

  // The label-free pass: a 13-character run that reads as a CNP once the OCR
  // look-alikes are undone, with a valid embedded birth date and county. This is
  // the net under the other two — it catches the printed CNP when a misread both
  // broke the control digit and mangled the "CNP" label (or pushed it out of
  // reach), the one case where the strict and label passes both come up empty.
  // The lookarounds keep it from starting mid-token or stealing the first 13
  // digits of a 14+ digit card run. Contiguous on purpose: allowing spaces with
  // no label to anchor it would let unrelated numbers glue into a false match.
  { category: "national_id", label: "CNP (RO)", severity: "high",
    source: "(?<![0-9A-Za-z<])[\\dOoQDIlSBbZzAGTgq]{13}(?![0-9A-Za-z<])",
    baseConfidence: 0.5,
    refine: (raw) => {
      const d = unconfuseDigits(raw);
      if (d.length !== 13 || !cnpStructValid(d)) return false;
      return { confidence: cnpValid(d) ? 0.95 : 0.8 };
    } },

  // The split pass: a buletin prints the CNP as one solid 13-digit block, but a
  // photo's kerning gap or a hologram crossing the digits makes OCR read it as
  // two word-boxes — so the rebuilt text carries a space the contiguous passes
  // above can't cross ("5050218 226798"), and the label pass misses it when the
  // "CNP" caption wasn't read right next to the number. Stitch two adjacent runs
  // back together and accept them only if they join into exactly 13 digits with a
  // valid CNP date and county. The "at least 7 real digits" floor keeps two
  // ordinary words made of look-alike letters from gluing into a false hit; the
  // span covers the gap, so both word boxes get painted.
  { category: "national_id", label: "CNP (RO)", severity: "high",
    source: "(?<![0-9A-Za-z<])[\\dOoQDIlSBbZzAGTgq]{2,12} [\\dOoQDIlSBbZzAGTgq]{2,12}(?![0-9A-Za-z<])",
    baseConfidence: 0.5,
    refine: (raw) => {
      if ((raw.match(/\d/g) ?? []).length < 7) return false;
      const d = unconfuseDigits(raw);
      if (d.length !== 13 || !cnpStructValid(d)) return false;
      return { confidence: cnpValid(d) ? 0.9 : 0.8 };
    } },

  // Tax ID (Romanian CUI/CIF): 2–10 digits with a control digit. A short number
  // clears the checksum ~9% of the time, so the bare value isn't enough — anchor
  // on a RO fiscal prefix or a CUI/CIF/"cod fiscal" label, then let the checksum
  // confirm it.
  { category: "tax_id", label: "Tax ID (RO)", severity: "high",
    source: "(?<=\\b(?:CUI|CIF|[Cc]od\\sfiscal|RO)[\\s:.]{0,3})\\d{2,10}(?!\\d)",
    baseConfidence: 0.6,
    refine: (raw) => (cuiValid(raw) ? { confidence: 0.95 } : false) },

  // ── ID documents ────────────────────────────────────────────────────────────
  // Machine-readable zone: the `<`-padded block at the bottom of passports and
  // ID cards. Its signature is a long, all-uppercase run of letters/digits with
  // `<` filler — which ordinary prose and code (lowercase, `>`, `/`) never make.
  // It packs name, document number, nationality and birth date, so the whole run
  // is critical. (Reading the `<` filler off a photo needs a clean, upright scan.)
  // Bounded to 90 chars each side (a single MRZ line is ≤44; the longest format
  // is two of them, never on one line since OCR keeps a newline between rows that
  // `[A-Z0-9<]` can't cross). The bound is what makes this safe: an unbounded `*`
  // before `<<` greedily eats to end-of-text then backtracks to find the `<<`,
  // which on a long uppercase blob costs O(n) per start position — O(n²) overall.
  { category: "mrz", label: "ID machine-readable zone", severity: "critical",
    source: "[A-Z0-9<]{0,90}<<[A-Z0-9<]{0,90}", baseConfidence: 0.5,
    refine: (raw) => {
      if (raw.length < 10) return false;
      const fillers = (raw.match(/</g) ?? []).length;
      if (fillers < 2 || raw.length - fillers < 4 || !/[A-Z]/.test(raw)) return false;
      // A country code or a leading document-type letter marks a true MRZ line.
      const strong = /ROU/.test(raw) || /^[IPAC]</.test(raw);
      return { confidence: strong ? 0.96 : 0.85 };
    } },

  // Romanian ID card series + number, e.g. "SERIA RK NR 123456". Anchored on the
  // printed "seria" label so a stray two-letters-plus-six-digits run elsewhere on
  // screen isn't swept up; the card number has no public checksum, so the anchor
  // carries the precision. Series letters must be uppercase (as printed).
  { category: "id_document", label: "ID card number (RO)", severity: "high",
    source: "[Ss][Ee][Rr][Ii][Aa]\\s+[A-Z]{2}\\s*(?:[Nn][Rr]\\.?|[Nn]um[ăa]r)?\\s*\\d{6}",
    baseConfidence: 0.9 },

  // ── Name ────────────────────────────────────────────────────────────────────
  // The holder's name behind a buletin's trilingual Nume/Nom/Last-name labels.
  // The lookbehind matches the label but keeps it out of the hit, so only the
  // uppercase value (1–3 words) is boxed. Best-effort: it leans on OCR keeping
  // the label next to its value. A name with no recognised label needs NER, not
  // a regex, so it's out of scope.
  { category: "name", label: "Name", severity: "high",
    source:
      "(?<=\\b(?:NUME|Nume|PRENUME|Prenume|NOM|Nom|PR[EÉ]NOM|Pr[eé]nom|LAST NAME|Last name|FIRST NAME|First name|SURNAME|Surname)\\b[\\s:/]{0,3})[A-ZĂÂÎȘȚŞŢ]{2,}(?:[ -][A-ZĂÂÎȘȚŞŢ]{2,}){0,2}",
    baseConfidence: 0.6,
    refine: (raw) =>
      /^(?:NUME|PRENUME|NOM|PR[EÉ]NOM|SURNAME|LAST|FIRST|NAME)$/.test(raw) ? false : { confidence: 0.6 } },

  // ── Email ─────────────────────────────────────────────────────────────────
  // Every quantifier is bounded to a real-world maximum (local-part ≤64, label
  // ≤63, ≤10 labels, TLD ≤24 per RFC), and the domain is dot-free labels rather
  // than one `[A-Za-z0-9.-]+\.` run. Both matter for safety: unbounded `+` runs
  // let a long dotted input backtrack across the whole string (O(n²) on a crafted
  // OCR blob), and the single-run domain lets the class `.` and the literal `\.`
  // match the same char. Bounding caps the work per start position, keeping the
  // global scan linear; no real address is excluded, and malformed domains like
  // `a..b` are rejected for free.
  { category: "email", label: "Email address", severity: "medium",
    source: "[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\\.){1,10}[A-Za-z]{2,24}", baseConfidence: 0.9 },

  // ── Phone numbers ───────────────────────────────────────────────────────────
  // Two precise shapes rather than one greedy run, since phone detection is
  // false-positive prone. International, explicit "+": a country code then 8–15
  // digits once separators are stripped.
  { category: "phone", label: "Phone number", severity: "high",
    source: "(?<![\\w+])\\+\\d(?:[ .\\-]?\\d){6,14}(?!\\w)", baseConfidence: 0.5,
    refine: (raw) => {
      const d = raw.replace(/\D/g, "");
      return d.length >= 8 && d.length <= 15 ? { confidence: 0.9 } : false;
    } },

  // Romanian national: 0, then a 2/3/7 service digit, then eight more (10 total),
  // separators optional. The leading 0 and service digit keep this off ordinary
  // 10-digit runs like timestamps or order ids.
  { category: "phone", label: "Phone number", severity: "high",
    source: "(?<![\\w+])0[237](?:[ .\\-]?\\d){8}(?!\\w)", baseConfidence: 0.6,
    refine: (raw) => (raw.replace(/\D/g, "").length === 10 ? { confidence: 0.9 } : false) },
];
