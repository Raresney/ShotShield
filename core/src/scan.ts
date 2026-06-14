// The scanner: run every enabled rule over the text, validate, then collapse
// overlapping hits so the same characters are never reported twice.

import type { CustomRule, Detection, ScanConfig, Severity } from "./types.ts";
import { BUILTIN_PATTERNS } from "./patterns.ts";

interface CompiledRule {
  category: Detection["category"];
  label: string;
  severity: Severity;
  regex: RegExp;
  baseConfidence: number;
  refine?: (raw: string) => false | { label?: string; confidence?: number };
}

function severityRank(s: Severity): number {
  return s === "critical" ? 3 : s === "high" ? 2 : s === "medium" ? 1 : 0;
}

// Smart default: pre-check everything except low-severity (noisier) hits.
function redactByDefault(s: Severity): boolean {
  return s !== "low";
}

function compile(config?: ScanConfig): CompiledRule[] {
  const enabled = config?.enabled ?? {};
  const rules: CompiledRule[] = [];
  for (const p of BUILTIN_PATTERNS) {
    if (enabled[p.category] === false) continue;
    rules.push({
      category: p.category,
      label: p.label,
      severity: p.severity,
      regex: new RegExp(p.source, "g" + (p.flags ?? "")),
      baseConfidence: p.baseConfidence,
      refine: p.refine,
    });
  }
  if (enabled.custom !== false) {
    for (const r of config?.customRules ?? []) rules.push(compileCustom(r));
  }
  return rules;
}

function compileCustom(r: CustomRule): CompiledRule {
  const flags = "g" + (r.flags ?? "").replace(/g/g, "");
  return {
    category: "custom",
    label: r.label,
    severity: r.severity ?? "high",
    regex: new RegExp(r.pattern, flags),
    baseConfidence: 0.8,
  };
}

/** Scan text for sensitive data. Returns non-overlapping detections, in order. */
export function scan(text: string, config?: ScanConfig): Detection[] {
  const rules = compile(config);
  const minConfidence = config?.minConfidence ?? 0;
  const found: Detection[] = [];

  for (const rule of rules) {
    rule.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.regex.exec(text)) !== null) {
      const raw = m[0];
      if (raw.length === 0) {
        rule.regex.lastIndex++; // guard against zero-width matches
        continue;
      }
      let label = rule.label;
      let confidence = rule.baseConfidence;
      if (rule.refine) {
        const res = rule.refine(raw);
        if (res === false) continue;
        if (res.label !== undefined) label = res.label;
        if (res.confidence !== undefined) confidence = res.confidence;
      }
      if (confidence < minConfidence) continue;
      found.push({
        category: rule.category,
        label,
        severity: rule.severity,
        start: m.index,
        end: m.index + raw.length,
        text: raw,
        confidence,
        redactByDefault: redactByDefault(rule.severity),
      });
    }
  }

  return resolveOverlaps(found);
}

// When two detections overlap, keep the stronger one (severity, then
// confidence, then span length). Interval scheduling by priority.
function resolveOverlaps(dets: Detection[]): Detection[] {
  const byStrength = [...dets].sort((a, b) => strength(b) - strength(a));
  const kept: Detection[] = [];
  for (const d of byStrength) {
    const overlaps = kept.some((k) => d.start < k.end && k.start < d.end);
    if (!overlaps) kept.push(d);
  }
  return kept.sort((a, b) => a.start - b.start);
}

function strength(d: Detection): number {
  return severityRank(d.severity) * 1_000_000 + d.confidence * 10_000 + (d.end - d.start);
}
