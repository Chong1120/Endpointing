import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { AppDeps } from './http/appDeps.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { callsRouter } from './routes/calls.js';
import { insightsRouter } from './routes/insights.js';
import { settingsRouter } from './routes/settings.js';
import { webhooksRouter } from './routes/webhooks.js';

/** Allows exact origins plus simple wildcards such as https://*.vercel.app */
export function corsOriginMatcher(allowed: string[]) {
  const patterns = allowed.map((origin) =>
    origin.includes('*')
      ? new RegExp(`^${origin.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')).join('[a-z0-9-]+')}$`, 'i')
      : origin.toLowerCase(),
  );
  return (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
    if (!origin) return callback(null, true);
    const ok = patterns.some((p) => (typeof p === 'string' ? p === origin.toLowerCase() : p.test(origin)));
    callback(null, ok);
  };
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'safecall-api', webhooks: deps.config.webhooksEnabled ? 'enabled' : 'status-check' });
  });

  // Server-to-server; authenticated with the shared header secret.
  app.use('/webhooks', webhooksRouter(deps));

  const api = express.Router();
  api.use(express.json({ limit: '256kb' }));
  api.use(requireAuth(deps.authVerifier, deps.users));
  api.use('/calls', callsRouter(deps));
  api.use(insightsRouter(deps));
  api.use(settingsRouter(deps));

  app.use('/api', cors({ origin: corsOriginMatcher(deps.config.corsOrigins), maxAge: 600 }), api);

  app.use(notFoundHandler);
  app.use(errorHandler(deps.logger, deps.config));
  return app;
}
