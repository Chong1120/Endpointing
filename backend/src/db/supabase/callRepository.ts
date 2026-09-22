import type { SupabaseClient } from '@supabase/supabase-js';
import type { CallRecord, Utterance } from '../../domain/types.js';
import type {
  AnalyticsRow,
  CallFilters,
  CallListItem,
  CallPatch,
  CallRepository,
  NewCall,
  SearchResultItem,
} from '../types.js';
import { assertNoError } from './client.js';

const LIST_COLUMNS =
  'id, call_number, original_filename, department, status, sentiment, topics, pii_total, pii_types, duration_seconds, created_at, processed_at, error_message, source, summary:ai_summary->>summary';
const ANALYTICS_COLUMNS =
  'id, status, department, created_at, processed_at, pii_counts, pii_total, sentiment, topics, duration_seconds';
const PAGE_SIZE = 1000; // PostgREST's default max_rows
const MAX_ROWS = 10_000;

// PostgREST builders have deeply generic types; filters are applied loosely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;

function applyFilters(query: Query, filters: Partial<CallFilters>): Query {
  let q = query;
  if (filters.createdBy) q = q.eq('created_by', filters.createdBy);
  if (filters.status) q = q.eq('status', filters.status);
  if (filters.department) q = q.eq('department', filters.department);
  if (filters.sentiment) q = q.eq('sentiment', filters.sentiment);
  if (filters.piiType) q = q.contains('pii_types', [filters.piiType]);
  if (filters.from) q = q.gte('created_at', filters.from);
  if (filters.to) q = q.lt('created_at', filters.to);
  return q;
}

function normalizeCall(row: Record<string, unknown>): CallRecord {
  return {
    ...(row as unknown as CallRecord),
    duration_seconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    call_number: Number(row.call_number),
  };
}

function normalizeListItem(row: Record<string, unknown>): CallListItem {
  return {
    ...(row as unknown as CallListItem),
    duration_seconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    call_number: Number(row.call_number),
    summary: (row.summary as string | null) ?? null,
  };
}

export class SupabaseCallRepository implements CallRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async fetchAll<T>(build: (from: number, to: number) => Query): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
      const { data, error } = await build(from, from + PAGE_SIZE - 1);
      assertNoError(error, 'reading calls');
      const page = (data ?? []) as T[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
    return rows;
  }

  async create(input: NewCall): Promise<CallRecord> {
    const { data, error } = await this.db.from('calls').insert(input).select('*').single();
    assertNoError(error, 'creating call');
    return normalizeCall(data);
  }

  async findById(orgId: string, id: string): Promise<CallRecord | null> {
    const { data, error } = await this.db
      .from('calls')
      .select('*')
      .eq('organization_id', orgId)
      .eq('id', id)
      .maybeSingle();
    assertNoError(error, 'reading call');
    return data ? normalizeCall(data) : null;
  }

  async findByIdForSystem(id: string): Promise<CallRecord | null> {
    const { data, error } = await this.db.from('calls').select('*').eq('id', id).maybeSingle();
    assertNoError(error, 'reading call');
    return data ? normalizeCall(data) : null;
  }

  async findByTranscriptId(transcriptId: string): Promise<CallRecord | null> {
    const { data, error } = await this.db
      .from('calls')
      .select('*')
      .eq('assemblyai_transcript_id', transcriptId)
      .maybeSingle();
    assertNoError(error, 'reading call by transcript');
    return data ? normalizeCall(data) : null;
  }

  async list(orgId: string, filters: CallFilters): Promise<{ items: CallListItem[]; total: number }> {
    const query = applyFilters(
      this.db.from('calls').select(LIST_COLUMNS, { count: 'exact' }).eq('organization_id', orgId),
      filters,
    )
      .order('created_at', { ascending: false })
      .range(filters.offset, filters.offset + filters.limit - 1);
    const { data, error, count } = await query;
    assertNoError(error, 'listing calls');
    return { items: ((data ?? []) as Record<string, unknown>[]).map(normalizeListItem), total: count ?? 0 };
  }

  async search(orgId: string, query: string, filters: CallFilters): Promise<{ items: SearchResultItem[]; total: number }> {
    const { data, error } = await this.db.rpc('search_calls', {
      p_org: orgId,
      p_query: query,
      p_status: filters.status ?? null,
      p_department: filters.department ?? null,
      p_sentiment: filters.sentiment ?? null,
      p_pii_type: filters.piiType ?? null,
      p_from: filters.from ?? null,
      p_to: filters.to ?? null,
      p_limit: filters.limit,
      p_offset: filters.offset,
    });
    assertNoError(error, 'searching calls');
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    return {
      items: rows.map((row) => ({
        ...normalizeListItem(row),
        error_message: null,
        source: 'upload',
        snippet: String(row.snippet ?? ''),
        rank: Number(row.rank ?? 0),
      })),
      total: rows.length > 0 ? Number(rows[0]?.total_count ?? rows.length) : 0,
    };
  }

  async update(id: string, patch: CallPatch): Promise<CallRecord> {
    const { data, error } = await this.db.from('calls').update(patch).eq('id', id).select('*').single();
    assertNoError(error, 'updating call');
    return normalizeCall(data);
  }

  async claimForProcessing(id: string, transcriptId: string): Promise<CallRecord | null> {
    const { data, error } = await this.db
      .from('calls')
      .update({ status: 'PROCESSING', failed_stage: null, error_message: null })
      .eq('id', id)
      .eq('assemblyai_transcript_id', transcriptId)
      .in('status', ['TRANSCRIBING', 'PROCESSING'])
      .select('*')
      .maybeSingle();
    assertNoError(error, 'claiming call');
    return data ? normalizeCall(data) : null;
  }

  async replaceUtterances(callId: string, utterances: Utterance[]): Promise<void> {
    const { error: deleteError } = await this.db.from('call_utterances').delete().eq('call_id', callId);
    assertNoError(deleteError, 'clearing utterances');
    for (let i = 0; i < utterances.length; i += 500) {
      const chunk = utterances.slice(i, i + 500).map((u) => ({ ...u, call_id: callId }));
      const { error } = await this.db.from('call_utterances').insert(chunk);
      assertNoError(error, 'storing utterances');
    }
  }

  async listUtterances(callId: string): Promise<Utterance[]> {
    return this.fetchAll<Utterance>((from, to) =>
      this.db
        .from('call_utterances')
        .select('seq, speaker, start_ms, end_ms, text')
        .eq('call_id', callId)
        .order('seq', { ascending: true })
        .range(from, to),
    );
  }

  async listUtterancesForCalls(callIds: string[]): Promise<Map<string, Utterance[]>> {
    const result = new Map<string, Utterance[]>(callIds.map((id) => [id, []]));
    for (let i = 0; i < callIds.length; i += 100) {
      const ids = callIds.slice(i, i + 100);
      const rows = await this.fetchAll<Utterance & { call_id: string }>((from, to) =>
        this.db
          .from('call_utterances')
          .select('call_id, seq, speaker, start_ms, end_ms, text')
          .in('call_id', ids)
          .order('call_id', { ascending: true })
          .order('seq', { ascending: true })
          .range(from, to),
      );
      for (const { call_id, ...utterance } of rows) result.get(call_id)?.push(utterance);
    }
    return result;
  }

  async listForAnalytics(orgId: string): Promise<AnalyticsRow[]> {
    const rows = await this.fetchAll<Record<string, unknown>>((from, to) =>
      this.db
        .from('calls')
        .select(ANALYTICS_COLUMNS)
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .range(from, to),
    );
    return rows.map((row) => ({
      ...(row as unknown as AnalyticsRow),
      duration_seconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    }));
  }

  async listCompleted(orgId: string, filters: Omit<CallFilters, 'status'>): Promise<CallRecord[]> {
    const rows = await this.fetchAll<Record<string, unknown>>((from, to) =>
      applyFilters(
        this.db.from('calls').select('*').eq('organization_id', orgId).eq('status', 'COMPLETED'),
        filters,
      )
        .order('created_at', { ascending: false })
        .range(from, to),
    );
    return rows.map(normalizeCall);
  }

  async findStuckTranscribing(olderThanIso: string, limit: number): Promise<CallRecord[]> {
    const { data, error } = await this.db
      .from('calls')
      .select('*')
      .eq('status', 'TRANSCRIBING')
      .lt('submitted_at', olderThanIso)
      .order('submitted_at', { ascending: true })
      .limit(limit);
    assertNoError(error, 'finding stuck calls');
    return ((data ?? []) as Record<string, unknown>[]).map(normalizeCall);
  }

  async findByStatus(status: CallRecord['status'], limit: number): Promise<CallRecord[]> {
    const { data, error } = await this.db
      .from('calls')
      .select('*')
      .eq('status', status)
      .order('updated_at', { ascending: true })
      .limit(limit);
    assertNoError(error, 'finding calls by status');
    return ((data ?? []) as Record<string, unknown>[]).map(normalizeCall);
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.db.from('calls').delete().eq('id', id);
    assertNoError(error, 'deleting call');
  }
}
