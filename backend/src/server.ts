import { mkdir } from 'node:fs/promises';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { buildRuntime, purgeStaleUploads } from './runtime.js';

const config = loadConfig();
const runtime = buildRuntime(config, 'safecall-api');
const { deps } = runtime;
const { logger } = deps;

await mkdir(config.uploadTmpDir, { recursive: true });
await purgeStaleUploads(config.uploadTmpDir, 60 * 60_000, logger);
const purgeTimer = setInterval(() => void purgeStaleUploads(config.uploadTmpDir, 60 * 60_000, logger), 15 * 60_000);
purgeTimer.unref();

try {
  await deps.storage.ensureBucket();
} catch (error) {
  logger.error({ err: error instanceof Error ? error.message : String(error) }, 'safe audio bucket check failed');
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

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down API');
  server.close();
  await runtime.close().catch(() => undefined);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
