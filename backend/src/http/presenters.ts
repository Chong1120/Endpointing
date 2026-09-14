import type { CallRecord } from '../domain/types.js';
import { canRetry } from '../pipeline/failures.js';

/**
 * Shape returned to the browser. Internal storage paths are replaced by a
 * boolean; everything else is already privacy-safe (redacted text, counts,
 * analysis of redacted text, metadata).
 */
export function presentCall(call: CallRecord) {
  const { safe_audio_path, ...rest } = call;
  return {
    ...rest,
    reference: `CALL-${call.call_number}`,
    has_safe_audio: Boolean(safe_audio_path),
    can_retry: canRetry(call),
  };
}

export type PresentedCall = ReturnType<typeof presentCall>;
