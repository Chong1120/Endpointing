import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import type { Logger } from 'pino';
import type { AppConfig } from '../config.js';
import { AppError } from '../errors.js';
import { describeError } from '../pipeline/failures.js';

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
};

/** Maps errors to safe JSON responses. Internal details are logged, never returned. */
export function errorHandler(logger: Logger, config: AppConfig): ErrorRequestHandler {
  const maxMb = Math.round(config.maxUploadBytes / (1024 * 1024));

  return (err, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }

    let appError: AppError | null = null;
    if (err instanceof AppError) {
      appError = err;
    } else if (err instanceof multer.MulterError) {
      appError =
        err.code === 'LIMIT_FILE_SIZE'
          ? new AppError(413, 'PAYLOAD_TOO_LARGE', `Recordings must be ${maxMb} MB or smaller.`)
          : new AppError(400, 'BAD_UPLOAD', 'Upload exactly one audio file in the "file" field.');
    } else if (err && typeof err === 'object' && 'type' in err) {
      const type = (err as { type?: string }).type;
      if (type === 'entity.parse.failed') appError = new AppError(400, 'BAD_REQUEST', 'Request body is not valid JSON.');
      if (type === 'entity.too.large') appError = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
    }

    if (appError) {
      if (appError.status >= 500) logger.error({ path: req.path, err: describeError(err) }, 'request failed');
      res.status(appError.status).json({
        error: { code: appError.code, message: appError.message, ...(appError.details ? { details: appError.details } : {}) },
      });
      return;
    }

    logger.error({ path: req.path, method: req.method, err: describeError(err) }, 'unhandled error');
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' } });
  };
}
