import type { CallRecord } from '../domain/types.js';
import { httpStatusOf, isTransientError, type PipelineStage } from '../errors.js';
import { sleepFor, type PipelineDeps } from './deps.js';

/** Log-safe summary of an error (no request bodies, no transcript content). */
export function describeError(error: unknown): Record<string, unknown> | undefined {
  if (!error) return undefined;
  if (error instanceof Error) {
    return { name: error.name, message: error.message.slice(0, 300), status: httpStatusOf(error) };
  }
  return { message: String(error).slice(0, 300) };
}

/**
 * Retry is offered when the transcript still exists at AssemblyAI and the
 * failure happened after transcription (audio fetch, storage, AI analysis…).
 * Upload/transcription failures need a fresh upload because the raw file was
 * deliberately deleted.
 */
export function canRetry(call: Pick<CallRecord, 'status' | 'failed_stage' | 'assemblyai_transcript_id' | 'original_deleted_at'>): boolean {
  return (
    call.status === 'FAILED' &&
    Boolean(call.assemblyai_transcript_id) &&
    !call.original_deleted_at &&
    !['UPLOAD', 'TRANSCRIPTION', 'PII_REDACTION'].includes(call.failed_stage ?? '')
  );
}

export async function markCallFailed(
  deps: PipelineDeps,
  call: Pick<CallRecord, 'id' | 'organization_id'>,
  stage: PipelineStage,
  userMessage: string,
  error: unknown,
): Promise<CallRecord> {
  deps.logger.error({ callId: call.id, stage, err: describeError(error) }, 'call processing failed');
  const updated = await deps.calls.update(call.id, { status: 'FAILED', failed_stage: stage, error_message: userMessage });
  await deps.audit.record({
    orgId: call.organization_id,
    callId: call.id,
    type: 'PROCESSING_FAILED',
    metadata: { stage, reason: userMessage, can_retry: canRetry(updated) },
  });
  return updated;
}

/** Retries network blips, 429s and 5xx responses with exponential backoff. */
export async function retryTransient<T>(fn: () => Promise<T>, deps: Pick<PipelineDeps, 'sleep'>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attempts || !isTransientError(error)) throw error;
      await sleepFor(deps, 1000 * 2 ** (attempt - 1));
    }
  }
}
