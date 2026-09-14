import type { CallStatus, PolicyPreset } from '../services/types';

export function entityLabel(entity: string): string {
  const label = entity
    .toLowerCase()
    .split('_')
    .join(' ')
    .replace(/\bus\b/, 'US')
    .replace(/\bip\b/, 'IP')
    .replace(/\bcvv\b/, 'CVV')
    .replace(/\burl\b/, 'URL');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatTimestamp(ms: number): string {
  return formatDuration(ms / 1000);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(iso));
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(iso));
}

export function relativeTime(iso: string): string {
  const diff = (Date.now() - Date.parse(iso)) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86_400) return `${Math.round(diff / 3600)} h ago`;
  return formatDate(iso);
}

export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export const numberFormat = new Intl.NumberFormat();

export const PRESET_LABELS: Record<PolicyPreset, string> = {
  CONTACT_CENTER: 'Contact Center',
  FINANCIAL: 'Financial',
  HEALTHCARE: 'Healthcare',
  CUSTOM: 'Custom',
};

export const IN_PROGRESS: CallStatus[] = ['UPLOADING', 'TRANSCRIBING', 'PROCESSING'];

export function languageName(code: string | null | undefined): string {
  if (!code) return '—';
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code.split('_')[0] ?? code) ?? code;
  } catch {
    return code;
  }
}

export function modelLabel(model: string | null | undefined): string {
  if (!model) return '—';
  if (model === 'universal-3-5-pro') return 'Universal-3.5 Pro';
  if (model === 'universal-2') return 'Universal-2';
  return model;
}

export const AUDIT_EVENT_LABELS: Record<string, string> = {
  CALL_RECEIVED: 'Call received',
  RAW_UPLOAD_DELETED: 'Raw upload deleted',
  TRANSCRIPTION_SUBMITTED: 'Sent to AssemblyAI',
  WEBHOOK_RECEIVED: 'AssemblyAI webhook received',
  TRANSCRIPTION_COMPLETED: 'Transcription completed',
  SPEAKERS_SEPARATED: 'Speakers separated',
  PII_DETECTION_COMPLETED: 'PII detected',
  TRANSCRIPT_REDACTED: 'Transcript redacted',
  SAFE_TRANSCRIPT_STORED: 'Safe transcript stored',
  AUDIO_REDACTED: 'Audio redacted',
  SAFE_AUDIO_STORED: 'Safe audio stored',
  AI_ANALYSIS_COMPLETED: 'AI analysis completed',
  AI_ANALYSIS_SKIPPED: 'AI analysis skipped',
  ARCHIVE_CREATED: 'Safe archive created',
  ASSEMBLYAI_DATA_DELETED: 'Deleted from AssemblyAI',
  PROCESSING_FAILED: 'Processing failed',
  RETRY_STARTED: 'Retry started',
  SAFE_AUDIO_ACCESSED: 'Safe audio accessed',
  DATASET_EXPORTED: 'Safe dataset exported',
  POLICY_UPDATED: 'PII policy updated',
  CALL_DELETED: 'Call deleted',
};

export const auditLabel = (type: string) => AUDIT_EVENT_LABELS[type] ?? type;

/** One-line, human description of an audit event's (already privacy-safe) metadata. */
export function auditDetail(type: string, meta: Record<string, unknown>): string {
  const n = (key: string) => (typeof meta[key] === 'number' ? (meta[key] as number) : null);
  switch (type) {
    case 'CALL_RECEIVED':
      return [meta.department, meta.policy_preset && PRESET_LABELS[meta.policy_preset as PolicyPreset], n('size_bytes') !== null && `${Math.round((n('size_bytes') as number) / 1024)} KB`]
        .filter(Boolean)
        .join(' · ');
    case 'RAW_UPLOAD_DELETED':
      return 'Temporary copy removed from SafeCall servers';
    case 'TRANSCRIPTION_SUBMITTED':
      return [
        meta.transcript_id ? `Transcript ${String(meta.transcript_id).slice(0, 8)}…` : null,
        `${Array.isArray(meta.pii_policies) ? meta.pii_policies.length : 0} PII policies`,
        `via ${meta.completion_signal === 'webhook' ? 'webhook' : 'status check'}`,
      ]
        .filter(Boolean)
        .join(' · ');
    case 'WEBHOOK_RECEIVED':
      return meta.duplicate ? 'Duplicate delivery ignored' : `Status: ${String(meta.status)}`;
    case 'TRANSCRIPTION_COMPLETED':
      return [modelLabel(meta.speech_model as string), languageName(meta.language as string), n('duration_seconds') !== null && formatDuration(n('duration_seconds'))]
        .filter((v) => v && v !== '—')
        .join(' · ');
    case 'SPEAKERS_SEPARATED':
      return `${n('speakers') ?? 0} speakers`;
    case 'PII_DETECTION_COMPLETED':
      return `${n('entities_detected') ?? 0} entities · ${Array.isArray(meta.entity_types) ? meta.entity_types.length : 0} types`;
    case 'TRANSCRIPT_REDACTED':
      return `${n('markers_replaced') ?? 0} values replaced with entity labels`;
    case 'AUDIO_REDACTED':
      return `PII replaced with ${String(meta.method ?? 'silence')}${meta.format ? ` · ${String(meta.format).toUpperCase()}` : ''}`;
    case 'SAFE_AUDIO_STORED':
      return 'Private bucket · signed-URL access only';
    case 'AI_ANALYSIS_COMPLETED':
      return `${String(meta.model ?? 'LLM Gateway')} · input: redacted transcript`;
    case 'AI_ANALYSIS_SKIPPED':
      return meta.reason === 'no_speech_detected' ? 'No speech detected' : 'Disabled for this call';
    case 'ARCHIVE_CREATED':
      return `${n('pii_entities_protected') ?? 0} PII entities protected${n('processing_seconds') !== null ? ` · ${formatSeconds(n('processing_seconds'))}` : ''}`;
    case 'ASSEMBLYAI_DATA_DELETED':
      return 'Transcript deleted at AssemblyAI after archiving';
    case 'PROCESSING_FAILED':
      return String(meta.reason ?? 'Processing failed');
    case 'RETRY_STARTED':
      return `Resuming from ${String(meta.previous_stage ?? 'failed stage').toLowerCase().replace(/_/g, ' ')}`;
    case 'SAFE_AUDIO_ACCESSED':
      return `Signed URL valid for ${n('expires_in_seconds') ?? 0}s`;
    case 'DATASET_EXPORTED':
      return `${String(meta.format ?? '').toUpperCase()} · ${n('calls') ?? 0} calls · ${n('utterances') ?? 0} utterances`;
    case 'POLICY_UPDATED':
      return meta.reset ? `${String(meta.preset)} reset to default` : `${String(meta.preset)} · ${n('policies_count') ?? 0} entity types`;
    case 'CALL_DELETED':
      return String(meta.call_reference ?? '');
    default:
      return '';
  }
}
