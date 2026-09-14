import { pino, type Logger } from 'pino';

/**
 * Structured logger. Logs carry IDs, statuses and counts only — never
 * transcript text, audio URLs or credentials. The redact list is a safety net
 * in case an object with those fields is ever logged by mistake.
 */
export function createLogger(level: string, service = 'safecall'): Logger {
  const pretty = process.env.NODE_ENV === 'development' && process.env.LOG_FORMAT !== 'json';
  return pino({
    level,
    base: { service },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers["x-safecall-webhook-secret"]',
        'headers.authorization',
        '*.apiKey',
        '*.api_key',
        '*.authorization',
        '*.webhook_auth_header_value',
        '*.password',
        '*.text',
        '*.transcript',
        '*.redacted_transcript',
        '*.unredacted_text',
        '*.redacted_audio_url',
        '*.upload_url',
        '*.signedUrl',
      ],
      censor: '[redacted]',
    },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } } : {}),
  });
}

export const logger = createLogger(
  process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  process.env.SERVICE_NAME ?? 'safecall',
);
