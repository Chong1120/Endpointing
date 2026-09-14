import type { PollTranscriptJob } from '../queue/jobs.js';
import type { PipelineDeps } from './deps.js';
import { describeError, markCallFailed } from './failures.js';

/** ~1 hour of status checks at <=10s spacing before giving up. */
export const MAX_STATUS_CHECKS = 360;
/** A webhook normally arrives within a minute or two of the transcript completing. */
const CHECK_TRANSCRIBING_AFTER_MS = 3 * 60_000;
const GIVE_UP_AFTER_MS = 6 * 60 * 60_000;

export const nextStatusCheckDelayMs = (attempt: number) => Math.min(3_000 + attempt * 1_000, 10_000);

/**
 * Local-development fallback used when AssemblyAI cannot reach our webhook
 * (no public HTTPS URL). A delayed check asks for the transcript status and
 * hands off to the same processing job the webhook would have triggered.
 */
export async function pollTranscript(deps: PipelineDeps, job: PollTranscriptJob): Promise<void> {
  const call = await deps.calls.findByIdForSystem(job.callId);
  if (!call || call.status !== 'TRANSCRIBING' || call.assemblyai_transcript_id !== job.transcriptId) return;

  const status = await deps.transcription.getTranscriptStatus(job.transcriptId);
  if (status === 'completed' || status === 'error') {
    await deps.queue.enqueueProcessCall({ callId: call.id, transcriptId: job.transcriptId, trigger: 'poll' });
    return;
  }
  if (job.attempt >= MAX_STATUS_CHECKS) {
    await markCallFailed(deps, call, 'TRANSCRIPTION', 'Timed out waiting for AssemblyAI to finish transcribing.', null);
    return;
  }
  await deps.queue.enqueuePollTranscript({ ...job, attempt: job.attempt + 1 }, nextStatusCheckDelayMs(job.attempt));
}

/**
 * Safety net, run when the API starts and every few minutes after:
 * - calls waiting on AssemblyAI longer than usual get a status check (a
 *   webhook may have been missed, or a restart dropped a pending check);
 * - calls left mid-pipeline by a restart or deploy are resumed. Every stage
 *   is idempotent, so resuming never duplicates work.
 */
export async function sweepCalls(
  deps: PipelineDeps,
): Promise<{ checked: number; requeued: number; resumed: number; failed: number }> {
  const now = deps.now ? deps.now() : new Date();
  let requeued = 0;
  let resumed = 0;
  let failed = 0;

  const waiting = await deps.calls.findStuckTranscribing(new Date(now.getTime() - CHECK_TRANSCRIBING_AFTER_MS).toISOString(), 50);
  for (const call of waiting) {
    if (!call.assemblyai_transcript_id) continue;
    try {
      const status = await deps.transcription.getTranscriptStatus(call.assemblyai_transcript_id);
      if (status === 'completed' || status === 'error') {
        const { enqueued } = await deps.queue.enqueueProcessCall({
          callId: call.id,
          transcriptId: call.assemblyai_transcript_id,
          trigger: 'sweeper',
        });
        if (enqueued) requeued += 1;
      } else if (call.submitted_at && now.getTime() - Date.parse(call.submitted_at) > GIVE_UP_AFTER_MS) {
        await markCallFailed(deps, call, 'TRANSCRIPTION', 'Timed out waiting for AssemblyAI to finish transcribing.', null);
        failed += 1;
      }
    } catch (error) {
      deps.logger.warn({ callId: call.id, err: describeError(error) }, 'sweep could not check transcript status');
    }
  }

  const interrupted = await deps.calls.findByStatus('PROCESSING', 50);
  for (const call of interrupted) {
    if (!call.assemblyai_transcript_id) continue;
    const { enqueued } = await deps.queue.enqueueProcessCall({
      callId: call.id,
      transcriptId: call.assemblyai_transcript_id,
      trigger: 'sweeper',
    });
    if (enqueued) resumed += 1;
  }

  return { checked: waiting.length, requeued, resumed, failed };
}
