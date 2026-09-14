/**
 * HTTP-facing error with a stable code and a message that is safe to show to
 * users. Anything that is not an AppError is reported as a generic 500 so
 * stack traces and internal details never reach the client.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required.') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission to do that.') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found.') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message: string) => new AppError(409, 'CONFLICT', message);
export const payloadTooLarge = (message: string) => new AppError(413, 'PAYLOAD_TOO_LARGE', message);
export const unsupportedMediaType = (message: string) => new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', message);
export const serviceUnavailable = (message: string) => new AppError(503, 'SERVICE_UNAVAILABLE', message);

/** Pipeline stages, used for failure reporting and resumable retries. */
export type PipelineStage =
  | 'UPLOAD'
  | 'TRANSCRIPTION'
  | 'PII_REDACTION'
  | 'AUDIO_REDACTION'
  | 'STORAGE'
  | 'AI_ANALYSIS'
  | 'ARCHIVE';

/**
 * Failure inside the processing pipeline. `userMessage` is shown in the UI;
 * `retryable` tells the queue whether an automatic retry could succeed.
 */
export class PipelineError extends Error {
  constructor(
    readonly stage: PipelineStage,
    readonly userMessage: string,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(userMessage, options);
    this.name = 'PipelineError';
  }
}

/** Extracts an HTTP status from SDK/fetch errors when one is available. */
export function httpStatusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = (error as { status?: unknown; statusCode?: unknown }).status ??
    (error as { statusCode?: unknown }).statusCode;
  return typeof candidate === 'number' ? candidate : undefined;
}

/** Network errors, timeouts, 429 and 5xx responses are worth retrying. */
export function isTransientError(error: unknown): boolean {
  const status = httpStatusOf(error);
  if (status !== undefined) return status === 408 || status === 429 || status >= 500;
  if (error instanceof Error) {
    const text = `${error.name} ${error.message}`.toLowerCase();
    return /timeout|timed out|econnreset|econnrefused|enotfound|eai_again|socket|network|fetch failed|aborted/.test(text);
  }
  return false;
}
