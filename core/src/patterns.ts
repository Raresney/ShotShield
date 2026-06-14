// Built-in detectors. Each entry is a pattern plus an optional refine() that
// validates a raw match. Adding a detector means adding a row here.

import type { Category, Severity } from "./types.ts";

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

  // ── Email ─────────────────────────────────────────────────────────────────
  { category: "email", label: "Email address", severity: "medium",
    source: "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,24}", baseConfidence: 0.9 },
];
