// Core domain types for the detection engine. Pure types — erased at run time.
// The Category union grows as detectors are added.

export type Category =
  | "api_key"
  | "jwt"
  | "credit_card"
  | "iban"
  | "national_id"
  | "id_document"
  | "mrz"
  | "email"
  | "custom";

export type Severity = "critical" | "high" | "medium" | "low";

/** A single piece of sensitive data found in the source text. */
export interface Detection {
  category: Category;
  /** Human-readable label, e.g. "Email address". */
  label: string;
  severity: Severity;
  /** Start offset (UTF-16 code units), inclusive. */
  start: number;
  /** End offset, exclusive. */
  end: number;
  /** The matched substring. */
  text: string;
  /** 0..1 confidence this is a true positive. */
  confidence: number;
  /** Smart default for whether to redact (the user can always toggle it). */
  redactByDefault: boolean;
}

/** A user-defined rule. Regex is intentional here — it comes from the user. */
export interface CustomRule {
  id: string;
  label: string;
  /** Regex source, compiled with the global flag added. */
  pattern: string;
  /** Extra flags besides "g". */
  flags?: string;
  severity?: Severity;
}

export interface ScanConfig {
  /** Per-category on/off. Omitted categories default to on. */
  enabled?: Partial<Record<Category, boolean>>;
  customRules?: CustomRule[];
  /** Drop detections below this confidence. Default: 0. */
  minConfidence?: number;
}
