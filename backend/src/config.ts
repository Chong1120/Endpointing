import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const booleanFlag = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(defaultValue ? 'true' : 'false')
    .transform((value) => value === 'true' || value === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  ASSEMBLYAI_API_KEY: z.string().min(1, 'ASSEMBLYAI_API_KEY is required'),
  ASSEMBLYAI_WEBHOOK_SECRET: z.string().min(16, 'ASSEMBLYAI_WEBHOOK_SECRET must be at least 16 characters'),
  ASSEMBLYAI_BASE_URL: z.url().default('https://api.assemblyai.com'),
  ASSEMBLYAI_DELETE_AFTER_ARCHIVE: booleanFlag(true),
  REDACTED_AUDIO_FORMAT: z.enum(['mp3', 'wav']).default('mp3'),

  LLM_GATEWAY_URL: z.url().default('https://llm-gateway.assemblyai.com/v1/chat/completions'),
  LLM_MODEL: z.string().min(1).default('claude-sonnet-4-6'),
  // Optional second model tried by the gateway if the first fails. Empty = none.
  LLM_FALLBACK_MODEL: z.string().default(''),
  // auto = ask the gateway whether LLM_MODEL supports response_format.
  LLM_RESPONSE_FORMAT: z.enum(['auto', 'json_schema', 'prompt']).default('auto'),

  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  SUPABASE_AUDIO_BUCKET: z.string().min(1).default('safe-call-audio'),

  // Normalised by normalizePublicUrl: Railway shows its domain without "https://".
  PUBLIC_API_URL: z.string().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(1000).default(200),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  UPLOAD_TMP_DIR: z.string().optional(),
});

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  port: number;
  logLevel: string;
  assemblyai: {
    apiKey: string;
    webhookSecret: string;
    baseUrl: string;
    deleteAfterArchive: boolean;
    redactedAudioFormat: 'mp3' | 'wav';
  };
  llm: {
    gatewayUrl: string;
    model: string;
    fallbackModel: string | null;
    responseFormat: 'auto' | 'json_schema' | 'prompt';
  };
  supabase: {
    url: string;
    serviceRoleKey: string;
    audioBucket: string;
  };
  /** Public base URL of this API. Required for AssemblyAI webhook delivery. */
  publicApiUrl: string | null;
  /**
   * True when AssemblyAI can reach us over HTTPS. Otherwise (local dev without
   * a tunnel) the API falls back to checking transcript status on a timer
   * instead of receiving a webhook.
   */
  webhooksEnabled: boolean;
  corsOrigins: string[];
  maxUploadBytes: number;
  signedUrlTtlSeconds: number;
  uploadTmpDir: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

export function isPublicHttpsUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !LOCAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Accepts the forms people paste from a hosting dashboard: a bare host
 * ("app.up.railway.app"), surrounding quotes or a trailing slash. An unusable
 * value returns null, so the API still starts and falls back to status checks
 * (visible in the startup log and on /health) instead of crash-looping.
 */
export function normalizePublicUrl(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim().replace(/^["']+|["']+$/g, '').trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(candidate).hostname ? candidate.replace(/\/+$/, '') : null;
  } catch {
    return null;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid SafeCall configuration:\n${problems}`);
  }
  const e = parsed.data;
  const publicApiUrl = normalizePublicUrl(e.PUBLIC_API_URL);

  return {
    env: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    assemblyai: {
      apiKey: e.ASSEMBLYAI_API_KEY,
      webhookSecret: e.ASSEMBLYAI_WEBHOOK_SECRET,
      baseUrl: e.ASSEMBLYAI_BASE_URL,
      deleteAfterArchive: e.ASSEMBLYAI_DELETE_AFTER_ARCHIVE,
      redactedAudioFormat: e.REDACTED_AUDIO_FORMAT,
    },
    llm: {
      gatewayUrl: e.LLM_GATEWAY_URL,
      model: e.LLM_MODEL,
      fallbackModel: e.LLM_FALLBACK_MODEL.trim() || null,
      responseFormat: e.LLM_RESPONSE_FORMAT,
    },
    supabase: {
      url: e.SUPABASE_URL,
      serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
      audioBucket: e.SUPABASE_AUDIO_BUCKET,
    },
    publicApiUrl,
    webhooksEnabled: isPublicHttpsUrl(publicApiUrl),
    corsOrigins: e.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
    maxUploadBytes: Math.round(e.MAX_UPLOAD_MB * 1024 * 1024),
    signedUrlTtlSeconds: e.SIGNED_URL_TTL_SECONDS,
    uploadTmpDir: e.UPLOAD_TMP_DIR ?? path.join(os.tmpdir(), 'safecall-uploads'),
  };
}
