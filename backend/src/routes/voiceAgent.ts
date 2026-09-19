import { Router } from 'express';
import { badRequest, conflict, serviceUnavailable } from '../errors.js';
import type { AppDeps } from '../http/appDeps.js';
import { presentCall } from '../http/presenters.js';
import { getAuth, requirePermission } from '../middleware/auth.js';
import { describeError } from '../pipeline/failures.js';
import { archiveVoiceSession } from '../pipeline/voiceSession.js';
import {
  LIVE_AGENT_MAX_SESSION_SECONDS,
  LIVE_AGENT_TOKEN_TTL_SECONDS,
  LIVE_AGENT_VOICE,
  buildLiveAgentSession,
  sessionReference,
} from '../services/assemblyai/liveAgent.js';
import { VOICE_AGENT_WS_URL } from '../services/assemblyai/voiceAgent.js';

const SESSION_ID = /^[A-Za-z0-9_-]{6,128}$/;
/** Why the agent handed the call to a person. No free text, so nothing the caller said travels with it. */
const ESCALATION_REASONS = ['customer_requested', 'upset_customer', 'out_of_scope', 'payment_issue'];

function escalationReason(body: unknown): string | null {
  const value = (body as { escalation?: { reason?: unknown } } | null)?.escalation?.reason;
  return typeof value === 'string' && ESCALATION_REASONS.includes(value) ? value : null;
}

/** Live agent: a single-use Voice Agent token for the browser, and archiving of finished calls. */
export function voiceAgentRouter(deps: AppDeps): Router {
  const router = Router();
  const archiving = new Set<string>();

  router.post('/session', requirePermission('agent:call'), async (req, res) => {
    const auth = getAuth(req);
    let token: string;
    try {
      token = await deps.voiceAgent.createToken({
        expiresInSeconds: LIVE_AGENT_TOKEN_TTL_SECONDS,
        maxSessionSeconds: LIVE_AGENT_MAX_SESSION_SECONDS,
      });
    } catch (error) {
      deps.logger.error({ err: describeError(error) }, 'voice agent token request failed');
      throw serviceUnavailable('The live agent is unavailable right now. Try again in a moment.');
    }
    await deps.audit.record({
      orgId: auth.orgId,
      type: 'VOICE_SESSION_STARTED',
      actorId: auth.userId,
      metadata: { voice: LIVE_AGENT_VOICE, max_session_seconds: LIVE_AGENT_MAX_SESSION_SECONDS },
    });
    res.set('Cache-Control', 'no-store');
    res.json({
      token,
      websocket_url: VOICE_AGENT_WS_URL,
      max_session_seconds: LIVE_AGENT_MAX_SESSION_SECONDS,
      session: buildLiveAgentSession(sessionReference(deps.config.assemblyai.webhookSecret, auth.orgId)),
    });
  });

  router.post('/sessions/:sessionId/archive', requirePermission('agent:call'), async (req, res) => {
    const auth = getAuth(req);
    const sessionId = String(req.params.sessionId);
    if (!SESSION_ID.test(sessionId)) throw badRequest('Invalid session id.');
    if (archiving.has(sessionId)) throw conflict('This call is already being archived.');
    archiving.add(sessionId);
    try {
      const call = await archiveVoiceSession(deps, auth, sessionId);
      const reason = escalationReason(req.body);
      if (reason) {
        await deps.audit.record({
          orgId: auth.orgId,
          callId: call.id,
          type: 'FOLLOW_UP_REQUESTED',
          actorId: auth.userId,
          metadata: { reason, channel: 'live_agent', voice_session_id: sessionId },
        });
      }
      res.status(202).json({ call: presentCall(call), follow_up: reason });
    } finally {
      archiving.delete(sessionId);
    }
  });

  return router;
}
