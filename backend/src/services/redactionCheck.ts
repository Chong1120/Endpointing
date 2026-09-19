import type { CallAnalysis } from '../domain/types.js';

/**
 * Second opinion on AssemblyAI's redaction.
 *
 * AssemblyAI redacts what it recognises as an entity, and a few shapes slip
 * through: a number the caller restarts ("415-555-0197— 415 555 0197", where
 * only the second attempt is redacted) or a bare code after "the security code
 * is". This module finds those leftovers in an already-redacted transcript, so
 * the pipeline can run redaction again with `redact_static_entities`, which
 * removes the exact terms from the transcript and bleeps them out of the audio.
 *
 * The rules are deliberately conservative: only high-confidence shapes
 * (keyword + code, long digit runs, phone patterns, email addresses). Names and
 * free text are left to AssemblyAI, because guessing them would redact
 * ordinary words.
 */

export interface LeftoverPii {
  /** AssemblyAI entity name, reused as the redaction label. */
  label: string;
  /** The exact text to redact. */
  term: string;
}

interface Rule {
  label: string;
  pattern: RegExp;
  /** Capture group holding the value, when the pattern also matches a keyword. */
  group?: number;
}

const RULES: Rule[] = [
  // "the security code is 123", "CVV 456", "PIN is 9021"
  {
    label: 'CREDIT_CARD_CVV',
    pattern: /\b(?:security code|card code|cvv|cvc|verification code|pin(?:\s+number)?)\b(?:\s+(?:is|was|number))?\s*[:=-]?\s*(\d{3,6})\b/gi,
    group: 1,
  },
  // "account number is 7730 2291"
  { label: 'ACCOUNT_NUMBER', pattern: /\baccount(?:\s+number)?\s*(?:is|:)?\s*((?:\d[\s-]?){6,20})/gi, group: 1 },
  { label: 'US_SOCIAL_SECURITY_NUMBER', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { label: 'EMAIL_ADDRESS', pattern: /\b[\w.+-]+@[\w-]+\.[A-Za-z]{2,}\b/g },
  // Spoken out: "jane dot doe at example dot com"
  { label: 'EMAIL_ADDRESS', pattern: /\b[\w-]+(?:\s+dot\s+[\w-]+)*\s+at\s+[\w-]+\s+dot\s+(?:com|net|org|io|co|edu|gov|my)\b/gi },
  { label: 'PHONE_NUMBER', pattern: /(?:\+\d{1,3}[\s-]?)?(?:\(\d{3}\)\s?|\d{3}[\s-])\d{3}[\s-]\d{4}\b/g },
  { label: 'CREDIT_CARD_NUMBER', pattern: /\b(?:\d[\s-]?){13,19}\b/g },
  { label: 'PHONE_NUMBER', pattern: /\b(?:\d[\s-]?){10,11}\b/g },
];

const MARKER = /\[[A-Z][A-Z0-9_]*\]/g;
const DATE_LIKE = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/;
const TRAILING = /[.,;:!?\s-]+$/;

type Range = [number, number];

const overlaps = (ranges: Range[], start: number, end: number) => ranges.some(([from, to]) => start < to && end > from);

function markerRanges(text: string): Range[] {
  const ranges: Range[] = [];
  for (const match of text.matchAll(MARKER)) {
    const start = match.index ?? 0;
    ranges.push([start, start + match[0].length]);
  }
  return ranges;
}

/** Values still readable in an already-redacted transcript. */
export function findLeftoverPii(text: string | null | undefined): LeftoverPii[] {
  if (!text) return [];
  const blocked = markerRanges(text);
  const claimed: Range[] = [];
  const seen = new Set<string>();
  const found: LeftoverPii[] = [];

  for (const rule of RULES) {
    for (const match of text.matchAll(rule.pattern)) {
      const raw = rule.group ? match[rule.group] : match[0];
      if (!raw) continue;
      const matchStart = match.index ?? 0;
      const start = rule.group ? matchStart + match[0].lastIndexOf(raw) : matchStart;
      const end = start + raw.length;
      if (overlaps(blocked, start, end) || overlaps(claimed, start, end)) continue;

      const term = raw.replace(TRAILING, '').trim();
      const digits = (term.match(/\d/g) ?? []).length;
      const looksLikeEmail = term.includes('@') || /\sat\s/i.test(term);
      if (!looksLikeEmail && digits < 3) continue;
      if (DATE_LIKE.test(term)) continue;

      claimed.push([start, end]);
      const key = `${rule.label}:${term.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ label: rule.label, term });
    }
  }
  return found;
}

/** The `redact_static_entities` map: one label, the exact terms to remove. */
export function staticEntityMap(findings: LeftoverPii[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const { label, term } of findings) {
    const terms = (map[label] ??= []);
    if (!terms.includes(term)) terms.push(term);
  }
  return map;
}

/** Local fallback when the recording can't be sent back to AssemblyAI. */
export function maskLeftovers(text: string, findings: LeftoverPii[]): string {
  let masked = text;
  for (const { label, term } of findings) masked = masked.split(term).join(`[${label}]`);
  return masked;
}

/** The AI insights are written from the transcript, so they need the same treatment. */
export function maskAnalysis<T extends CallAnalysis>(analysis: T, findings: LeftoverPii[]): T {
  if (findings.length === 0) return analysis;
  const mask = (value: string) => maskLeftovers(value, findings);
  return {
    ...analysis,
    summary: mask(analysis.summary),
    customer_issue: mask(analysis.customer_issue),
    resolution: mask(analysis.resolution),
    action_items: analysis.action_items.map(mask),
    qa: analysis.qa ? { ...analysis.qa, notes: mask(analysis.qa.notes) } : analysis.qa,
  };
}
