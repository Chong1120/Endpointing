import type { AnalyticsRow } from '../db/types.js';

export interface AnalyticsSummary {
  totals: {
    calls: number;
    completed: number;
    failed: number;
    in_progress: number;
    safe_archives: number;
    pii_entities: number;
    /** completed / (completed + failed), as a percentage; null until a call finishes. */
    success_rate: number | null;
    avg_processing_seconds: number | null;
    audio_minutes: number;
  };
  pii_by_type: Array<{ type: string; count: number }>;
  top_topics: Array<{ topic: string; count: number }>;
  sentiment: { positive: number; neutral: number; negative: number };
  departments: Array<{ department: string; calls: number }>;
  /** Zero-filled daily series (UTC) for the last `days` days. */
  volume: Array<{ date: string; calls: number; pii: number }>;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export function computeAnalytics(rows: AnalyticsRow[], now: Date = new Date(), days = 14): AnalyticsSummary {
  const completed = rows.filter((r) => r.status === 'COMPLETED');
  const failed = rows.filter((r) => r.status === 'FAILED').length;
  const finished = completed.length + failed;

  const processingTimes = completed
    .filter((r) => r.processed_at)
    .map((r) => (Date.parse(r.processed_at as string) - Date.parse(r.created_at)) / 1000)
    .filter((s) => Number.isFinite(s) && s >= 0);

  const piiByType = new Map<string, number>();
  const topics = new Map<string, number>();
  const departments = new Map<string, number>();
  const sentiment = { positive: 0, neutral: 0, negative: 0 };
  let piiTotal = 0;
  let audioSeconds = 0;

  for (const row of rows) {
    departments.set(row.department, (departments.get(row.department) ?? 0) + 1);
    if (row.status !== 'COMPLETED') continue;
    piiTotal += row.pii_total;
    audioSeconds += row.duration_seconds ?? 0;
    for (const [type, count] of Object.entries(row.pii_counts ?? {})) {
      piiByType.set(type, (piiByType.get(type) ?? 0) + count);
    }
    for (const topic of row.topics ?? []) {
      const key = topic.trim();
      if (key) topics.set(key, (topics.get(key) ?? 0) + 1);
    }
    if (row.sentiment) sentiment[row.sentiment] += 1;
  }

  const volumeByDay = new Map<string, { calls: number; pii: number }>();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (days - 1));
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    volumeByDay.set(d.toISOString().slice(0, 10), { calls: 0, pii: 0 });
  }
  for (const row of rows) {
    const bucket = volumeByDay.get(row.created_at.slice(0, 10));
    if (!bucket) continue;
    bucket.calls += 1;
    if (row.status === 'COMPLETED') bucket.pii += row.pii_total;
  }

  const sortDesc = <K extends string>(map: Map<string, number>, key: K) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ [key]: name, count }) as { [P in K]: string } & { count: number });

  return {
    totals: {
      calls: rows.length,
      completed: completed.length,
      failed,
      in_progress: rows.length - finished,
      safe_archives: completed.length,
      pii_entities: piiTotal,
      success_rate: finished > 0 ? round1((completed.length / finished) * 100) : null,
      avg_processing_seconds:
        processingTimes.length > 0 ? round1(processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length) : null,
      audio_minutes: round1(audioSeconds / 60),
    },
    pii_by_type: sortDesc(piiByType, 'type'),
    top_topics: sortDesc(topics, 'topic').slice(0, 10),
    sentiment,
    departments: [...departments.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([department, calls]) => ({ department, calls })),
    volume: [...volumeByDay.entries()].map(([date, v]) => ({ date, ...v })),
  };
}
