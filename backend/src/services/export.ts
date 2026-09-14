import type { CallRecord, Utterance } from '../domain/types.js';

/**
 * Safe dataset export. Built exclusively from the archive: redacted
 * utterances, AI analysis of the redacted transcript and metadata. There is
 * no raw audio, raw transcript or PII value to export — none is stored.
 */
export interface SafeCallExport {
  call_id: string;
  call_reference: string;
  department: string;
  created_at: string;
  language: string | null;
  duration_seconds: number | null;
  pii_entities_redacted: number;
  summary: string | null;
  sentiment: string | null;
  topics: string[];
  utterances: Array<{ speaker: string; role: string | null; start_ms: number; end_ms: number; text: string }>;
}

export function buildSafeExport(call: CallRecord, utterances: Utterance[]): SafeCallExport {
  const roles = new Map((call.ai_summary?.speaker_roles ?? []).map((r) => [r.speaker, r.role]));
  return {
    call_id: call.id,
    call_reference: `CALL-${call.call_number}`,
    department: call.department,
    created_at: call.created_at,
    language: call.detected_language,
    duration_seconds: call.duration_seconds,
    pii_entities_redacted: call.pii_total,
    summary: call.ai_summary?.summary ?? null,
    sentiment: call.sentiment,
    topics: call.topics,
    utterances: utterances.map((u) => ({
      speaker: u.speaker,
      role: roles.get(u.speaker) ?? null,
      start_ms: u.start_ms,
      end_ms: u.end_ms,
      text: u.text,
    })),
  };
}

/** One JSON object per call per line. */
export function toJsonl(records: SafeCallExport[]): string {
  return records.map((record) => JSON.stringify(record)).join('\n') + (records.length > 0 ? '\n' : '');
}

const CSV_COLUMNS = [
  'call_id', 'call_reference', 'department', 'created_at', 'language', 'speaker', 'role', 'start_ms', 'end_ms',
  'safe_text', 'summary', 'sentiment', 'topics', 'pii_entities_redacted',
] as const;

/** RFC 4180 quoting plus a guard against spreadsheet formula injection. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One row per utterance, with call-level fields repeated (analytics-friendly). */
export function toCsv(records: SafeCallExport[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const record of records) {
    const base = {
      call_id: record.call_id,
      call_reference: record.call_reference,
      department: record.department,
      created_at: record.created_at,
      language: record.language,
      summary: record.summary,
      sentiment: record.sentiment,
      topics: record.topics.join('; '),
      pii_entities_redacted: record.pii_entities_redacted,
    };
    const rows = record.utterances.length > 0 ? record.utterances : [null];
    for (const u of rows) {
      const row: Record<(typeof CSV_COLUMNS)[number], unknown> = {
        ...base,
        speaker: u?.speaker ?? null,
        role: u?.role ?? null,
        start_ms: u?.start_ms ?? null,
        end_ms: u?.end_ms ?? null,
        safe_text: u?.text ?? null,
      };
      lines.push(CSV_COLUMNS.map((column) => csvCell(row[column])).join(','));
    }
  }
  // BOM so spreadsheet apps open the UTF-8 file correctly.
  return `﻿${lines.join('\r\n')}\r\n`;
}
