import type { Logger } from 'pino';
import type { AppConfig } from '../config.js';
import type { CallRepository } from '../db/types.js';
import type { JobQueue } from '../queue/jobs.js';
import type { TranscriptionService } from '../services/assemblyai/transcription.js';
import type { AuditLogger } from '../services/audit.js';
import type { AnalysisService } from '../services/llm/analysis.js';
import type { SafeAudioStorage } from '../services/storage/safeAudioStorage.js';

/** Everything the processing pipeline talks to. Tests swap in fakes. */
export interface PipelineDeps {
  config: AppConfig;
  logger: Logger;
  calls: CallRepository;
  audit: AuditLogger;
  transcription: TranscriptionService;
  analysis: AnalysisService;
  storage: SafeAudioStorage;
  queue: JobQueue;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export const nowIso = (deps: Pick<PipelineDeps, 'now'>) => (deps.now ? deps.now() : new Date()).toISOString();

export const sleepFor = (deps: Pick<PipelineDeps, 'sleep'>, ms: number) =>
  deps.sleep ? deps.sleep(ms) : new Promise<void>((resolve) => setTimeout(resolve, ms));
