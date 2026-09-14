import type { PollTranscriptJob } from '../queue/jobs.js';
import type { PipelineDeps } from './deps.js';
import { describeError, markCallFailed } from './failures.js';

/** ~1 hour of status checks at <=10s spacing before giving up. */
export const MAX_STATUS_CHECKS = 360;
const STUCK_AFTER_MS = 10 * 60_000;
const GIVE_UP_AFTER_MS = 6 * 60 * 60_000;

export const nextStatusCheckDelayMs = (attempt: number) => Math.min(3_000 + attempt * 1_000, 10_000);

/**
 * Local-development fallback used when AssemblyAI cannot reach our webhook
 * (no public HTTPS URL). A delayed queue job checks the transcript status and
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
 * Safety net for missed webhooks (e.g. the API was down for all of
 * AssemblyAI's redelivery attempts). Runs periodically in the worker.
 */
export async function sweepStuckCalls(deps: PipelineDeps): Promise<{ checked: number; requeued: number; failed: number }> {
  const now = deps.now ? deps.now() : new Date();
  const stuck = await deps.calls.findStuckTranscribing(new Date(now.getTime() - STUCK_AFTER_MS).toISOString(), 50);
  let requeued = 0;
  let failed = 0;

  for (const call of stuck) {
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
      deps.logger.warn({ callId: call.id, err: describeError(error) }, 'sweeper could not check transcript status');
    }
  }
  return { checked: stuck.length, requeued, failed };
}
