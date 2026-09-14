import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from 'pino';
import type { AppConfig } from './config.js';
import { createServiceClient } from './db/supabase/client.js';
import { SupabaseCallRepository } from './db/supabase/callRepository.js';
import {
  SupabaseAuditRepository,
  SupabasePolicyRepository,
  SupabaseUserRepository,
} from './db/supabase/otherRepositories.js';
import type { AppDeps } from './http/appDeps.js';
import { createLogger } from './logger.js';
import { SupabaseAuthVerifier } from './middleware/auth.js';
import { BackgroundJobQueue } from './queue/backgroundQueue.js';
import { AssemblyAITranscriptionService } from './services/assemblyai/transcription.js';
import { RepositoryAuditLogger } from './services/audit.js';
import { LlmGatewayAnalysisService } from './services/llm/analysis.js';
import { FileSampleCatalog } from './services/samples.js';
import { SupabaseSafeAudioStorage } from './services/storage/safeAudioStorage.js';

/** Wires the production implementations used by the API server. */
export function buildRuntime(config: AppConfig, serviceName = 'safecall-api') {
  const logger = createLogger(config.logLevel, serviceName);
  const db = createServiceClient(config.supabase.url, config.supabase.serviceRoleKey);
  const auditEvents = new SupabaseAuditRepository(db);
  const queue = new BackgroundJobQueue(logger);

  const deps: AppDeps = {
    config,
    logger,
    calls: new SupabaseCallRepository(db),
    audit: new RepositoryAuditLogger(auditEvents, logger),
    auditEvents,
    transcription: new AssemblyAITranscriptionService({
      apiKey: config.assemblyai.apiKey,
      baseUrl: config.assemblyai.baseUrl,
    }),
    analysis: new LlmGatewayAnalysisService({
      apiKey: config.assemblyai.apiKey,
      gatewayUrl: config.llm.gatewayUrl,
      model: config.llm.model,
      fallbackModel: config.llm.fallbackModel,
      responseFormat: config.llm.responseFormat,
    }),
    storage: new SupabaseSafeAudioStorage(db, config.supabase.audioBucket, config.maxUploadBytes * 4),
    queue,
    users: new SupabaseUserRepository(db),
    policies: new SupabasePolicyRepository(db),
    authVerifier: new SupabaseAuthVerifier(db),
    samples: new FileSampleCatalog(),
  };
  queue.attach(deps);

  return {
    deps,
    async close() {
      await queue.close();
    },
  };
}

/**
 * Safety net for the temporary upload directory: removes files older than
 * `maxAgeMs` (e.g. left behind by a crash mid-request). Raw audio must not
 * linger on disk.
 */
export async function purgeStaleUploads(dir: string, maxAgeMs: number, logger: Logger): Promise<number> {
  let removed = 0;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return 0;
  }
  const cutoff = Date.now() - maxAgeMs;
  for (const entry of entries) {
    const file = path.join(dir, entry);
    try {
      const info = await stat(file);
      if (info.isFile() && info.mtimeMs < cutoff) {
        await rm(file, { force: true });
        removed += 1;
      }
    } catch {
      // File disappeared between readdir and stat; nothing to do.
    }
  }
  if (removed > 0) logger.warn({ removed }, 'purged stale temporary uploads');
  return removed;
}
