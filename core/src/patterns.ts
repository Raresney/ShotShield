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
  {
    category: "email",
    label: "Email address",
    severity: "medium",
    source: "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,24}",
    baseConfidence: 0.9,
  },
];
