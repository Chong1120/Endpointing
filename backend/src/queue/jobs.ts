export interface ProcessCallJob {
  callId: string;
  transcriptId: string;
  trigger: 'webhook' | 'poll' | 'retry' | 'sweeper';
}

export interface PollTranscriptJob {
  callId: string;
  transcriptId: string;
  attempt: number;
}

/**
 * Automatic retries for the post-transcription pipeline before a call is
 * marked FAILED. With exponential backoff from 10s this spans ~5 minutes,
 * long enough to ride out LLM Gateway rate limits.
 */
export const PROCESS_CALL_ATTEMPTS = 6;
export const PROCESS_CALL_BACKOFF_MS = 10_000;

export interface JobQueue {
  /** Returns enqueued=false when this call is already being processed (e.g. a duplicate webhook). */
  enqueueProcessCall(job: ProcessCallJob): Promise<{ enqueued: boolean }>;
  /** Manual retry of a failed call. */
  requeueProcessCall(job: ProcessCallJob): Promise<void>;
  /** Local-dev fallback when AssemblyAI cannot reach a webhook URL. */
  enqueuePollTranscript(job: PollTranscriptJob, delayMs: number): Promise<void>;
  close(): Promise<void>;
}
