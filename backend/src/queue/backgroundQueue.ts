import type { Logger } from 'pino';
import { conflict } from '../errors.js';
import type { PipelineDeps } from '../pipeline/deps.js';
import { describeError } from '../pipeline/failures.js';
import { processCall } from '../pipeline/processCall.js';
import { pollTranscript } from '../pipeline/statusChecks.js';
import {
  PROCESS_CALL_ATTEMPTS,
  PROCESS_CALL_BACKOFF_MS,
  type JobQueue,
  type PollTranscriptJob,
  type ProcessCallJob,
} from './jobs.js';

/**
 * Runs pipeline work inside the API process — no Redis, no separate worker.
 *
 * The database is the source of truth: every pipeline stage is idempotent,
 * and the periodic sweep (`sweepCalls`) resumes anything a restart or deploy
 * interrupted. Designed for a single API instance.
 */
export class BackgroundJobQueue implements JobQueue {
  private deps: PipelineDeps | null = null;
  private readonly activeCalls = new Set<string>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private closed = false;

  constructor(
    private readonly logger: Logger,
    private readonly settings = { maxAttempts: PROCESS_CALL_ATTEMPTS, backoffMs: PROCESS_CALL_BACKOFF_MS },
  ) {}

  /** Connects the queue to the pipeline. Called once deps exist (deps include this queue). */
  attach(deps: PipelineDeps): void {
    this.deps = deps;
  }

  isActive(callId: string): boolean {
    return this.activeCalls.has(callId);
  }

  async enqueueProcessCall(job: ProcessCallJob): Promise<{ enqueued: boolean }> {
    if (this.activeCalls.has(job.callId)) return { enqueued: false };
    this.activeCalls.add(job.callId);
    this.later(0, () => this.runProcess(job, 1));
    return { enqueued: true };
  }

  async requeueProcessCall(job: ProcessCallJob): Promise<void> {
    if (this.activeCalls.has(job.callId)) throw conflict('This call is already being processed.');
    this.activeCalls.add(job.callId);
    this.later(0, () => this.runProcess(job, 1));
  }

  async enqueuePollTranscript(job: PollTranscriptJob, delayMs: number): Promise<void> {
    this.later(delayMs, () => this.runPoll(job));
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  private later(delayMs: number, task: () => Promise<void>): void {
    if (this.closed) return;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      void task();
    }, delayMs);
    this.timers.add(timer);
  }

  private pipeline(): PipelineDeps {
    if (!this.deps) throw new Error('BackgroundJobQueue used before attach()');
    return this.deps;
  }

  private async runProcess(job: ProcessCallJob, attempt: number): Promise<void> {
    try {
      const outcome = await processCall(this.pipeline(), job, { attempt, maxAttempts: this.settings.maxAttempts });
      this.logger.info({ callId: job.callId, outcome, attempt }, 'call processing finished');
      this.activeCalls.delete(job.callId);
    } catch (error) {
      // processCall throws only when a retry may still succeed. Past the retry
      // budget (e.g. the database itself is unreachable) the sweep takes over.
      if (this.closed || attempt >= this.settings.maxAttempts + 2) {
        this.logger.error({ callId: job.callId, attempt, err: describeError(error) }, 'call processing paused; the sweep will resume it');
        this.activeCalls.delete(job.callId);
        return;
      }
      const delay = this.settings.backoffMs * 2 ** (attempt - 1);
      this.logger.warn({ callId: job.callId, attempt, retryInMs: delay, err: describeError(error) }, 'call processing will retry');
      this.later(delay, () => this.runProcess(job, attempt + 1));
    }
  }

  private async runPoll(job: PollTranscriptJob): Promise<void> {
    try {
      await pollTranscript(this.pipeline(), job);
    } catch (error) {
      this.logger.warn({ callId: job.callId, err: describeError(error) }, 'transcript status check failed; trying again shortly');
      this.later(10_000, () => this.runPoll(job));
    }
  }
}
