export const QUEUE_NAME = 'safecall';

export const JOB_NAMES = {
  PROCESS_CALL: 'process-call',
  POLL_TRANSCRIPT: 'poll-transcript',
  SWEEP_STUCK_CALLS: 'sweep-stuck-calls',
} as const;

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

/**
 * One deterministic job ID per call, so repeated webhook deliveries for the
 * same transcript collapse into a single queued job.
 */
export const processCallJobId = (callId: string) => `process-${callId}`;
export const pollJobId = (callId: string, attempt: number) => `poll-${callId}-${attempt}`;

export interface JobQueue {
  /** Returns enqueued=false when a job for this call already exists (duplicate webhook). */
  enqueueProcessCall(job: ProcessCallJob): Promise<{ enqueued: boolean }>;
  /** Manual retry: replaces a finished/failed job for the call with a fresh one. */
  requeueProcessCall(job: ProcessCallJob): Promise<void>;
  /** Local-dev fallback when AssemblyAI cannot reach a webhook URL. */
  enqueuePollTranscript(job: PollTranscriptJob, delayMs: number): Promise<void>;
  close(): Promise<void>;
}
