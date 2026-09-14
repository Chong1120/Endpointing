import { describe, expect, it } from 'vitest';
import type { AnalyticsRow } from '../src/db/types.js';
import { computeAnalytics } from '../src/services/analytics.js';
import { csvCell, toCsv, toJsonl, type SafeCallExport } from '../src/services/export.js';

const NOW = new Date('2026-09-14T12:00:00Z');

function row(overrides: Partial<AnalyticsRow>): AnalyticsRow {
  return {
    id: crypto.randomUUID(),
    status: 'COMPLETED',
    department: 'Billing',
    created_at: '2026-09-14T10:00:00Z',
    processed_at: '2026-09-14T10:01:00Z',
    pii_counts: {},
    pii_total: 0,
    sentiment: 'neutral',
    topics: [],
    duration_seconds: 60,
    ...overrides,
  };
}

describe('analytics', () => {
  it('aggregates totals, PII, topics, sentiment and volume', () => {
    const summary = computeAnalytics(
      [
        row({ pii_counts: { PHONE_NUMBER: 2, PERSON_NAME: 1 }, pii_total: 3, topics: ['Billing', 'Refund'], sentiment: 'negative' }),
        row({ pii_counts: { PHONE_NUMBER: 1 }, pii_total: 1, topics: ['Billing'], sentiment: 'positive', created_at: '2026-09-13T08:00:00Z', processed_at: '2026-09-13T08:02:00Z' }),
        row({ status: 'FAILED', processed_at: null, pii_total: 0 }),
        row({ status: 'TRANSCRIBING', processed_at: null }),
      ],
      NOW,
    );
    expect(summary.totals).toMatchObject({
      calls: 4,
      completed: 2,
      failed: 1,
      in_progress: 1,
      safe_archives: 2,
      pii_entities: 4,
      success_rate: 66.7,
      avg_processing_seconds: 90,
      audio_minutes: 2,
    });
    expect(summary.pii_by_type).toEqual([
      { type: 'PHONE_NUMBER', count: 3 },
      { type: 'PERSON_NAME', count: 1 },
    ]);
    expect(summary.top_topics[0]).toEqual({ topic: 'Billing', count: 2 });
    expect(summary.sentiment).toEqual({ positive: 1, neutral: 0, negative: 1 });
    expect(summary.volume).toHaveLength(14);
    expect(summary.volume.at(-1)).toEqual({ date: '2026-09-14', calls: 3, pii: 3 });
    expect(summary.volume.at(-2)).toEqual({ date: '2026-09-13', calls: 1, pii: 1 });
  });

  it('reports no success rate before any call finishes', () => {
    expect(computeAnalytics([], NOW).totals.success_rate).toBeNull();
  });
});

describe('safe dataset export formats', () => {
  const record: SafeCallExport = {
    call_id: 'c1',
    call_reference: 'CALL-1001',
    department: 'Billing',
    created_at: '2026-09-14T10:00:00Z',
    language: 'en',
    duration_seconds: 60,
    pii_entities_redacted: 2,
    summary: 'Refund, "duplicate" charge',
    sentiment: 'neutral',
    topics: ['Billing', 'Refund'],
    utterances: [
      { speaker: 'A', role: 'agent', start_ms: 0, end_ms: 1000, text: 'Hello [PERSON_NAME].' },
      { speaker: 'B', role: 'customer', start_ms: 1000, end_ms: 2000, text: '=HYPERLINK("x")' },
    ],
  };

  it('writes one JSON object per call', () => {
    const lines = toJsonl([record, { ...record, call_id: 'c2' }]).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).utterances).toHaveLength(2);
  });

  it('writes one CSV row per utterance with safe quoting', () => {
    const csv = toCsv([record]);
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"Refund, ""duplicate"" charge"');
    expect(lines[2]).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('neutralizes spreadsheet formulas', () => {
    expect(csvCell('+1234')).toBe("'+1234");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(null)).toBe('');
  });
});
