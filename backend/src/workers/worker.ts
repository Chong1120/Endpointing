import { Worker, type Job } from 'bullmq';
import { loadConfig } from '../config.js';
import { processCall } from '../pipeline/processCall.js';
import { pollTranscript, sweepStuckCalls } from '../pipeline/statusChecks.js';
import { createRedisConnection } from '../queue/bullQueue.js';
import { JOB_NAMES, QUEUE_NAME, type PollTranscriptJob, type ProcessCallJob } from '../queue/jobs.js';
import { buildRuntime } from '../runtime.js';

const config = loadConfig();
const runtime = buildRuntime(config, 'safecall-worker');
const { deps } = runtime;
const { logger } = deps;

try {
  await deps.storage.ensureBucket();
} catch (error) {
  logger.error({ err: error instanceof Error ? error.message : String(error) }, 'safe audio bucket check failed');
}

// Periodic safety net for calls whose webhook never arrived.
await runtime.bullQueue.upsertJobScheduler(
  JOB_NAMES.SWEEP_STUCK_CALLS,
  { every: 5 * 60_000 },
  { name: JOB_NAMES.SWEEP_STUCK_CALLS, data: {} },
);

const worker = new Worker(
  QUEUE_NAME,
  async (job: Job) => {
    switch (job.name) {
      case JOB_NAMES.PROCESS_CALL:
        return processCall(deps, job.data as ProcessCallJob, {
          attempt: job.attemptsMade + 1,
          maxAttempts: job.opts.attempts ?? 1,
        });
      case JOB_NAMES.POLL_TRANSCRIPT:
        return pollTranscript(deps, job.data as PollTranscriptJob);
      case JOB_NAMES.SWEEP_STUCK_CALLS:
        return sweepStuckCalls(deps);
      default:
        logger.warn({ job: job.name }, 'ignoring unknown job');
        return undefined;
    }
  },
  {
    connection: createRedisConnection(config.redisUrl),
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4),
  },
);

worker.on('completed', (job, result) => {
  if (job.name !== JOB_NAMES.POLL_TRANSCRIPT) logger.info({ job: job.name, jobId: job.id, result }, 'job completed');
});
worker.on('failed', (job, error) => {
  logger.warn({ job: job?.name, jobId: job?.id, attempts: job?.attemptsMade, err: error.message }, 'job attempt failed');
});
worker.on('error', (error) => logger.error({ err: error.message }, 'worker error'));

logger.info({ queue: QUEUE_NAME }, 'SafeCall worker started');

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down worker');
  await worker.close().catch(() => undefined);
  await runtime.close().catch(() => undefined);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
