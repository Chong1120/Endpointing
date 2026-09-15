export const CALL_STATUSES = ['UPLOADING', 'TRANSCRIBING', 'PROCESSING', 'COMPLETED', 'FAILED'] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export const POLICY_PRESETS = ['CONTACT_CENTER', 'FINANCIAL', 'HEALTHCARE', 'CUSTOM'] as const;
export type PolicyPreset = (typeof POLICY_PRESETS)[number];

export const DEPARTMENTS = [
  'Customer Support',
  'Billing',
  'Technical Support',
  'Collections',
  'Sales',
  'General Inquiry',
] as const;

export const SENTIMENTS = ['positive', 'neutral', 'negative'] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export type UserRole = 'admin' | 'analyst' | 'viewer';

declare const safeTextBrand: unique symbol;
/**
 * Text that has already passed through AssemblyAI PII redaction. The LLM
 * analysis service only accepts this type, so raw text cannot be sent to an
 * LLM by accident — the compiler rejects it.
 */
export type SafeText = string & { readonly [safeTextBrand]: true };

export interface SpeakerRole {
  speaker: string;
  role: 'agent' | 'customer' | 'other';
}

export interface CallAnalysis {
  summary: string;
  customer_issue: string;
  resolution: string;
  sentiment: Sentiment;
  /** Optional extras — smaller models may omit them. */
  sentiment_trend: { start: Sentiment; end: Sentiment } | null;
  topics: string[];
  action_items: string[];
  speaker_roles: SpeakerRole[];
  qa: {
    issue_resolved: boolean;
    agent_professionalism: 'excellent' | 'good' | 'needs_improvement';
    notes: string;
  } | null;
}

export interface StoredAnalysis extends CallAnalysis {
  model: string;
  generated_at: string;
}

export type PiiCounts = Record<string, number>;

export interface CallRecord {
  id: string;
  call_number: number;
  organization_id: string;
  created_by: string | null;
  original_filename: string;
  department: string;
  source: 'upload' | 'sample';
  status: CallStatus;
  failed_stage: string | null;
  error_message: string | null;
  policy_preset: PolicyPreset;
  pii_policies: string[];
  analysis_enabled: boolean;
  detected_language: string | null;
  duration_seconds: number | null;
  speakers_count: number | null;
  speech_model_used: string | null;
  assemblyai_transcript_id: string | null;
  safe_audio_path: string | null;
  safe_audio_format: 'mp3' | 'wav' | null;
  redacted_transcript: string | null;
  pii_counts: PiiCounts;
  pii_total: number;
  pii_types: string[];
  ai_summary: StoredAnalysis | null;
  sentiment: Sentiment | null;
  topics: string[];
  created_at: string;
  submitted_at: string | null;
  transcription_completed_at: string | null;
  processed_at: string | null;
  original_deleted_at: string | null;
  updated_at: string;
}

export interface Utterance {
  seq: number;
  speaker: string;
  start_ms: number;
  end_ms: number;
  text: string;
}

export const AUDIT_EVENT_TYPES = [
  'CALL_RECEIVED',
  'RAW_UPLOAD_DELETED',
  'TRANSCRIPTION_SUBMITTED',
  'WEBHOOK_RECEIVED',
  'TRANSCRIPTION_COMPLETED',
  'SPEAKERS_SEPARATED',
  'PII_DETECTION_COMPLETED',
  'TRANSCRIPT_REDACTED',
  'SAFE_TRANSCRIPT_STORED',
  'AUDIO_REDACTED',
  'SAFE_AUDIO_STORED',
  'AI_ANALYSIS_COMPLETED',
  'AI_ANALYSIS_SKIPPED',
  'ARCHIVE_CREATED',
  'ASSEMBLYAI_DATA_DELETED',
  'PROCESSING_FAILED',
  'RETRY_STARTED',
  'SAFE_AUDIO_ACCESSED',
  'DATASET_EXPORTED',
  'POLICY_UPDATED',
  'CALL_DELETED',
  'VOICE_SESSION_STARTED',
  'VOICE_SESSION_DELETED',
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export type AuditMetadata = Record<string, string | number | boolean | null | string[] | number[] | Record<string, number>>;

export interface AuditEvent {
  id: number;
  organization_id: string;
  call_id: string | null;
  event_type: AuditEventType;
  metadata: AuditMetadata;
  actor_id: string | null;
  created_at: string;
}

/** Identity of the signed-in user, resolved from the Supabase access token. */
export interface AuthContext {
  userId: string;
  email: string;
  orgId: string;
  orgName: string;
  role: UserRole;
}
