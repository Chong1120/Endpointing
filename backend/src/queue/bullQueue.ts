import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { conflict } from '../errors.js';
import {
  JOB_NAMES,
  PROCESS_CALL_ATTEMPTS,
  PROCESS_CALL_BACKOFF_MS,
  QUEUE_NAME,
  pollJobId,
  processCallJobId,
  type JobQueue,
  type PollTranscriptJob,
  type ProcessCallJob,
} from './jobs.js';

/**
 * BullMQ requires `maxRetriesPerRequest: null`. `family: 0` lets ioredis
 * resolve both IPv4 and IPv6 (Railway's private network is IPv6).
 */
export function createRedisConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, family: 0 });
}

export function createQueue(connection: Redis): Queue {
  return new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { age: 7 * 24 * 3600, count: 10_000 },
      removeOnFail: { age: 30 * 24 * 3600 },
    },
  });
}

export class BullJobQueue implements JobQueue {
  constructor(private readonly queue: Queue) {}

  async enqueueProcessCall(job: ProcessCallJob): Promise<{ enqueued: boolean }> {
    const jobId = processCallJobId(job.callId);
    if (await this.queue.getJob(jobId)) return { enqueued: false };
    // BullMQ ignores an add() whose jobId already exists, so concurrent
    // duplicate webhooks still produce a single job.
    await this.queue.add(JOB_NAMES.PROCESS_CALL, job, {
      jobId,
      attempts: PROCESS_CALL_ATTEMPTS,
      backoff: { type: 'exponential', delay: PROCESS_CALL_BACKOFF_MS },
    });
    return { enqueued: true };
  }

  async requeueProcessCall(job: ProcessCallJob): Promise<void> {
    const jobId = processCallJobId(job.callId);
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'active') throw conflict('This call is already being processed.');
      await existing.remove();
    }
    await this.queue.add(JOB_NAMES.PROCESS_CALL, job, {
      jobId,
      attempts: PROCESS_CALL_ATTEMPTS,
      backoff: { type: 'exponential', delay: PROCESS_CALL_BACKOFF_MS },
    });
  }

  async enqueuePollTranscript(job: PollTranscriptJob, delayMs: number): Promise<void> {
    await this.queue.add(JOB_NAMES.POLL_TRANSCRIPT, job, {
      jobId: pollJobId(job.callId, job.attempt),
      delay: delayMs,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
    });
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
