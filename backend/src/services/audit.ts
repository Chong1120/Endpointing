import type { Logger } from 'pino';
import type { AuditRepository } from '../db/types.js';
import type { AuditEventType, AuditMetadata } from '../domain/types.js';

export interface AuditEntry {
  orgId: string;
  callId?: string | null;
  type: AuditEventType;
  metadata?: Record<string, unknown>;
  actorId?: string | null;
}

export interface AuditLogger {
  record(entry: AuditEntry): Promise<void>;
  /** Event types already recorded for a call — lets retried pipeline stages avoid duplicate entries. */
  recordedTypes(orgId: string, callId: string): Promise<Set<AuditEventType>>;
}

// Keys that name content rather than technical facts are dropped, even if a
// value slipped in by mistake. IDs and counts (transcript_id, input_tokens,
// utterances) are allowed.
const FORBIDDEN_KEY =
  /^(text|transcript|redacted_transcript|unredacted_\w+|utterance_text|content|body|message|url|\w+_url|secret|\w+_secret|token|access_token|refresh_token|api_key|password|authorization|email|\w+_email|phone|\w+_phone|name|full_name|customer_name|agent_name)$/i;
const MAX_STRING = 200;
const MAX_ARRAY = 60;

function clampString(value: string): string {
  return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
}

function isCountMap(value: unknown): value is Record<string, number> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === 'number' && Number.isFinite(v))
  );
}

/**
 * Audit metadata may contain technical IDs, statuses and counts — never raw
 * PII or transcript content. Unknown shapes and suspicious keys are dropped.
 */
export function sanitizeAuditMetadata(metadata: Record<string, unknown> = {}): AuditMetadata {
  const clean: AuditMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_KEY.test(key)) continue;
    if (value === null || typeof value === 'boolean') {
      clean[key] = value;
    } else if (typeof value === 'number') {
      if (Number.isFinite(value)) clean[key] = value;
    } else if (typeof value === 'string') {
      clean[key] = clampString(value);
    } else if (Array.isArray(value)) {
      if (value.every((v) => typeof v === 'string')) clean[key] = value.slice(0, MAX_ARRAY).map(clampString);
      else if (value.every((v) => typeof v === 'number')) clean[key] = value.slice(0, MAX_ARRAY);
    } else if (isCountMap(value)) {
      clean[key] = value;
    }
  }
  return clean;
}

export class RepositoryAuditLogger implements AuditLogger {
  constructor(
    private readonly repository: AuditRepository,
    private readonly logger: Logger,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    const metadata = sanitizeAuditMetadata(entry.metadata);
    await this.repository.insert({
      organization_id: entry.orgId,
      call_id: entry.callId ?? null,
      event_type: entry.type,
      metadata,
      actor_id: entry.actorId ?? null,
    });
    this.logger.info({ audit: entry.type, callId: entry.callId ?? undefined, orgId: entry.orgId }, 'audit event');
  }

  async recordedTypes(orgId: string, callId: string): Promise<Set<AuditEventType>> {
    const events = await this.repository.listForCall(orgId, callId);
    return new Set(events.map((event) => event.event_type));
  }
}
