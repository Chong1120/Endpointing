export type CallStatus = 'UPLOADING' | 'TRANSCRIBING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type PolicyPreset = 'CONTACT_CENTER' | 'FINANCIAL' | 'HEALTHCARE' | 'CUSTOM';
export type Sentiment = 'positive' | 'neutral' | 'negative';

export const DEPARTMENTS = ['Customer Support', 'Billing', 'Technical Support', 'Collections', 'Sales', 'General Inquiry'];
/** Department recorded on calls taken by the live agent. */
export const LIVE_AGENT_DEPARTMENT = 'AI Voice Agent';
/** Filter choices: the upload departments plus live-agent calls. */
export const FILTER_DEPARTMENTS = [...DEPARTMENTS, LIVE_AGENT_DEPARTMENT];

/** What the API returns to start a live-agent call. */
export interface LiveAgentSession {
  token: string;
  websocket_url: string;
  max_session_seconds: number;
  /** Sent unchanged as the first `session.update`. */
  session: Record<string, unknown>;
}

export interface CallAnalysis {
  summary: string;
  customer_issue: string;
  resolution: string;
  sentiment: Sentiment;
  sentiment_trend: { start: Sentiment; end: Sentiment } | null;
  topics: string[];
  action_items: string[];
  speaker_roles: Array<{ speaker: string; role: 'agent' | 'customer' | 'other' }>;
  qa: { issue_resolved: boolean; agent_professionalism: 'excellent' | 'good' | 'needs_improvement'; notes: string } | null;
  model: string;
  generated_at: string;
}

export interface Call {
  id: string;
  call_number: number;
  reference: string;
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
  safe_audio_format: 'mp3' | 'wav' | null;
  redacted_transcript: string | null;
  pii_counts: Record<string, number>;
  pii_total: number;
  pii_types: string[];
  ai_summary: CallAnalysis | null;
  sentiment: Sentiment | null;
  topics: string[];
  created_at: string;
  submitted_at: string | null;
  transcription_completed_at: string | null;
  processed_at: string | null;
  original_deleted_at: string | null;
  has_safe_audio: boolean;
  can_retry: boolean;
}

export interface CallListItem {
  id: string;
  call_number: number;
  reference: string;
  original_filename: string;
  department: string;
  status: CallStatus;
  sentiment: Sentiment | null;
  topics: string[];
  pii_total: number;
  pii_types: string[];
  duration_seconds: number | null;
  created_at: string;
  processed_at: string | null;
  error_message: string | null;
  source: 'upload' | 'sample';
  summary: string | null;
  snippet?: string | null;
}

export interface Utterance {
  seq: number;
  speaker: string;
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface AuditEvent {
  id: number;
  call_id: string | null;
  event_type: string;
  metadata: Record<string, unknown>;
  actor_id: string | null;
  created_at: string;
  call_number?: number | null;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  query?: string | null;
}

export interface CallDetail {
  call: Call;
  utterances: Utterance[];
  audit: AuditEvent[];
}

export type UserRole = 'admin' | 'analyst' | 'agent' | 'viewer';

export type Permission =
  | 'calls:read'
  | 'calls:upload'
  | 'calls:delete'
  | 'calls:recheck'
  | 'policies:write'
  | 'export'
  | 'audit:read'
  | 'followups:read'
  | 'followups:resolve'
  | 'agent:call'
  | 'team:manage';

export interface TeamMember {
  id: string;
  email: string;
  role: UserRole;
  is_you: boolean;
}

export interface Team {
  organization: { id: string; name: string };
  members: TeamMember[];
  invite: { code: string; valid_for_days: number } | null;
}

export interface Me {
  user: { id: string; email: string; role: UserRole; permissions: Permission[] };
  organization: { id: string; name: string };
  platform: {
    webhooks_enabled: boolean;
    max_upload_mb: number;
    redacted_audio_format: 'mp3' | 'wav';
    llm_model: string;
    speech_models: string[];
    supported_extensions: string[];
  };
}

export interface PolicyPresetInfo {
  preset: PolicyPreset;
  label: string;
  description: string;
  default_policies: string[];
  policies: string[];
  customized: boolean;
}

export interface PoliciesResponse {
  presets: PolicyPresetInfo[];
  categories: Array<{ name: string; policies: Array<{ name: string; label: string }> }>;
}

export interface Sample {
  id: string;
  title: string;
  file: string;
  department: string;
  policyPreset: PolicyPreset;
  description: string;
  expectedPii: string[];
}

export interface Analytics {
  totals: {
    calls: number;
    completed: number;
    failed: number;
    in_progress: number;
    safe_archives: number;
    pii_entities: number;
    success_rate: number | null;
    avg_processing_seconds: number | null;
    audio_minutes: number;
  };
  pii_by_type: Array<{ type: string; count: number }>;
  top_topics: Array<{ topic: string; count: number }>;
  sentiment: { positive: number; neutral: number; negative: number };
  departments: Array<{ department: string; calls: number }>;
  volume: Array<{ date: string; calls: number; pii: number }>;
}

export interface CallFilters {
  q?: string;
  status?: CallStatus | '';
  department?: string;
  sentiment?: Sentiment | '';
  pii_type?: string;
  from?: string;
  to?: string;
  page?: number;
  page_size?: number;
}

/** One call the AI agent handed to a person, as returned by /api/follow-ups. */
export interface FollowUp {
  id: string;
  reference: string;
  department: string;
  status: CallStatus;
  sentiment: Sentiment | null;
  topics: string[];
  summary: string | null;
  pii_total: number;
  duration_seconds: number | null;
  created_at: string;
  reason: string;
  requested_at: string;
}
