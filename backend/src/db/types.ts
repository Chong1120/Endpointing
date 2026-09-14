import type {
  AuditEvent,
  AuditEventType,
  AuditMetadata,
  CallRecord,
  CallStatus,
  PolicyPreset,
  Sentiment,
  UserRole,
  Utterance,
} from '../domain/types.js';

export interface NewCall {
  organization_id: string;
  created_by: string | null;
  original_filename: string;
  department: string;
  source: 'upload' | 'sample';
  policy_preset: PolicyPreset;
  pii_policies: string[];
  analysis_enabled: boolean;
}

export type CallPatch = Partial<Omit<CallRecord, 'id' | 'call_number' | 'organization_id' | 'created_at' | 'updated_at'>>;

export interface CallFilters {
  status?: CallStatus;
  department?: string;
  sentiment?: Sentiment;
  piiType?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export type CallListItem = Pick<
  CallRecord,
  | 'id'
  | 'call_number'
  | 'original_filename'
  | 'department'
  | 'status'
  | 'sentiment'
  | 'topics'
  | 'pii_total'
  | 'pii_types'
  | 'duration_seconds'
  | 'created_at'
  | 'processed_at'
  | 'error_message'
  | 'source'
> & { summary: string | null };

export interface SearchResultItem extends CallListItem {
  snippet: string;
  rank: number;
}

export type AnalyticsRow = Pick<
  CallRecord,
  'id' | 'status' | 'department' | 'created_at' | 'processed_at' | 'pii_counts' | 'pii_total' | 'sentiment' | 'topics' | 'duration_seconds'
>;

export interface CallRepository {
  create(input: NewCall): Promise<CallRecord>;
  /** Organization-scoped lookup used by every user-facing route. */
  findById(orgId: string, id: string): Promise<CallRecord | null>;
  /** Unscoped lookup for the worker; IDs come from our own queue. */
  findByIdForSystem(id: string): Promise<CallRecord | null>;
  findByTranscriptId(transcriptId: string): Promise<CallRecord | null>;
  list(orgId: string, filters: CallFilters): Promise<{ items: CallListItem[]; total: number }>;
  search(orgId: string, query: string, filters: CallFilters): Promise<{ items: SearchResultItem[]; total: number }>;
  update(id: string, patch: CallPatch): Promise<CallRecord>;
  /**
   * Atomically marks a call PROCESSING if it is waiting on (or in the middle
   * of) post-transcription work. Returns null when there is nothing to do,
   * e.g. a duplicate webhook for an archive that is already complete.
   */
  claimForProcessing(id: string, transcriptId: string): Promise<CallRecord | null>;
  replaceUtterances(callId: string, utterances: Utterance[]): Promise<void>;
  listUtterances(callId: string): Promise<Utterance[]>;
  listUtterancesForCalls(callIds: string[]): Promise<Map<string, Utterance[]>>;
  listForAnalytics(orgId: string): Promise<AnalyticsRow[]>;
  listCompleted(orgId: string, filters: Omit<CallFilters, 'status'>): Promise<CallRecord[]>;
  /** Calls stuck waiting on AssemblyAI (missed webhook), across all organizations. */
  findStuckTranscribing(olderThanIso: string, limit: number): Promise<CallRecord[]>;
  delete(id: string): Promise<void>;
}

export interface NewAuditEvent {
  organization_id: string;
  call_id: string | null;
  event_type: AuditEventType;
  metadata: AuditMetadata;
  actor_id: string | null;
}

export interface AuditListItem extends AuditEvent {
  call_number: number | null;
}

export interface AuditRepository {
  insert(event: NewAuditEvent): Promise<void>;
  listForCall(orgId: string, callId: string): Promise<AuditEvent[]>;
  listForOrg(
    orgId: string,
    filters: { callId?: string; eventType?: string; limit: number; offset: number },
  ): Promise<{ items: AuditListItem[]; total: number }>;
}

export interface UserProfile {
  userId: string;
  email: string;
  orgId: string;
  orgName: string;
  role: UserRole;
}

export interface UserRepository {
  /** Returns the user's profile, creating an organization for first-time users. */
  ensureProfile(userId: string, email: string, orgName: string): Promise<UserProfile>;
}

export interface PolicyRepository {
  listOverrides(orgId: string): Promise<Partial<Record<PolicyPreset, string[]>>>;
  saveOverride(orgId: string, preset: PolicyPreset, policies: string[], actorId: string): Promise<void>;
  deleteOverride(orgId: string, preset: PolicyPreset): Promise<void>;
}
