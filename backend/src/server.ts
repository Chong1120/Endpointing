import { mkdir } from 'node:fs/promises';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { describeError } from './pipeline/failures.js';
import { sweepCalls } from './pipeline/statusChecks.js';
import { buildRuntime, purgeStaleUploads } from './runtime.js';

const SWEEP_EVERY_MS = 2 * 60_000;

const config = loadConfig();
const runtime = buildRuntime(config);
const { deps } = runtime;
const { logger } = deps;

await mkdir(config.uploadTmpDir, { recursive: true });
await purgeStaleUploads(config.uploadTmpDir, 60 * 60_000, logger);
const purgeTimer = setInterval(() => void purgeStaleUploads(config.uploadTmpDir, 60 * 60_000, logger), 15 * 60_000);
purgeTimer.unref();

try {
  await deps.storage.ensureBucket();
} catch (error) {
  logger.error({ err: describeError(error) }, 'safe audio bucket check failed');
}

const server = createApp(deps).listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      completionSignal: config.webhooksEnabled ? `webhook via ${config.publicApiUrl}` : 'status-check fallback (no public HTTPS URL)',
    },
    'SafeCall API listening',
  );
});

// Safety net: resume calls a restart interrupted and catch missed webhooks.
async function sweep() {
  try {
    const result = await sweepCalls(deps);
    if (result.requeued || result.resumed || result.failed) logger.info(result, 'resumed pending calls');
  } catch (error) {
    logger.warn({ err: describeError(error) }, 'sweep failed');
  }
}
void sweep();
const sweepTimer = setInterval(() => void sweep(), SWEEP_EVERY_MS);
sweepTimer.unref();

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down API');
  clearInterval(sweepTimer);
  server.close();
  await runtime.close().catch(() => undefined);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
