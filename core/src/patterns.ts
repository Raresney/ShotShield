// Built-in detectors. Each entry is a pattern plus an optional refine() that
// validates a raw match. Adding a detector means adding a row here.

import type { Category, Severity } from "./types.ts";
import { luhn, ibanValid, cnpValid } from "./validators.ts";

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

  // ── National IDs ──────────────────────────────────────────────────────────
  // Romanian CNP for now; other countries can follow as people ask for them.
  { category: "national_id", label: "CNP (RO)", severity: "high",
    source: "[1-9]\\d{12}", baseConfidence: 0.4,
    refine: (raw) => (cnpValid(raw) ? { confidence: 0.95 } : false) },

  // ── Email ─────────────────────────────────────────────────────────────────
  { category: "email", label: "Email address", severity: "medium",
    source: "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,24}", baseConfidence: 0.9 },
];
