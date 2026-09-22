import { Router } from 'express';
import { DEMO_PERSONAS, findPersona } from '../domain/demo.js';
import { badRequest, forbidden, tooManyRequests } from '../errors.js';
import type { AppDeps } from '../http/appDeps.js';
import { getAuth } from '../middleware/auth.js';
import { describeError } from '../pipeline/failures.js';
import { isDemoWorkspace, resetDemoWorkspace, startDemoSession } from '../services/demoWorkspace.js';

/** Sign-ins per IP per hour. Several judges can share one office or venue address, and
 * every role switch is another sign-in, so this is deliberately loose; it only has to stop
 * a crawler sitting on the endpoint. */
const RATE_LIMIT = 120;
const HOUR_MS = 60 * 60 * 1_000;

function rateLimiter(limit: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (ip: string): boolean => {
    const now = Date.now();
    if (hits.size > 5_000) hits.clear();
    const entry = hits.get(ip);
    if (!entry || entry.resetAt < now) {
      hits.set(ip, { count: 1, resetAt: now + HOUR_MS });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  };
}

/**
 * The three one-click demo logins. This router is deliberately unauthenticated
 * — signing in is the whole point — so it is rate limited per IP, and the
 * passwords never leave the server (see domain/demo.ts).
 */
export function demoRouter(deps: AppDeps): Router {
  const router = Router();
  const allow = rateLimiter(RATE_LIMIT);

  router.get('/personas', (_req, res) => {
    res.json({
      personas: DEMO_PERSONAS.map(({ key, label, blurb, role }) => ({ key, label, blurb, role })),
      notice: 'These accounts are shared and exist for trying SafeCall out. You can also sign up normally.',
    });
  });

  router.post('/login', async (req, res) => {
    const persona = findPersona((req.body as { persona?: unknown } | null)?.persona);
    if (!persona) throw badRequest('Choose one of the demo roles.');
    if (!allow(req.ip ?? 'unknown')) throw tooManyRequests('Too many demo sign-ins from here. Try again in an hour.');

    let started: Awaited<ReturnType<typeof startDemoSession>>;
    try {
      started = await startDemoSession(deps, persona);
    } catch (error) {
      deps.logger.error({ err: describeError(error), persona: persona.key }, 'demo sign-in failed');
      throw badRequest('The demo accounts are not available right now. Sign up instead — it takes a moment.');
    }

    res.set('Cache-Control', 'no-store');
    res.json({
      persona: { key: persona.key, label: persona.label, role: persona.role },
      session: {
        access_token: started.session.accessToken,
        refresh_token: started.session.refreshToken,
        expires_in: started.session.expiresIn,
      },
    });
  });

  return router;
}

/** Authenticated half: resetting the shared workspace. Mounted under /api. */
export function demoAdminRouter(deps: AppDeps): Router {
  const router = Router();

  router.post('/demo/reset', async (req, res) => {
    const auth = getAuth(req);
    if (auth.role !== 'admin') throw forbidden('Only the demo admin can reset the workspace.');
    if (!(await isDemoWorkspace(deps, auth.orgId))) throw forbidden('This is not the demo workspace.');

    const { deleted } = await resetDemoWorkspace(deps, auth.orgId);
    await deps.audit.record({
      orgId: auth.orgId,
      type: 'DEMO_RESET',
      actorId: auth.userId,
      metadata: { calls_deleted: deleted },
    });
    res.json({ calls_deleted: deleted });
  });

  return router;
}
