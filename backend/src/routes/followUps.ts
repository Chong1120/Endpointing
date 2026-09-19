import { Router } from 'express';
import { notFound } from '../errors.js';
import type { AppDeps } from '../http/appDeps.js';
import { parseId } from '../http/validation.js';
import { getAuth, requirePermission } from '../middleware/auth.js';

const PAGE = { limit: 100, offset: 0 };

/**
 * Calls the agent handed to a person. The queue is derived from the audit
 * trail: a call is open while it has a FOLLOW_UP_REQUESTED without a matching
 * FOLLOW_UP_RESOLVED. Only the reason travels with it, never what was said.
 */
export function followUpsRouter(deps: AppDeps): Router {
  const router = Router();

  router.get('/follow-ups', requirePermission('followups:read'), async (req, res) => {
    const auth = getAuth(req);
    const [requested, resolved] = await Promise.all([
      deps.auditEvents.listForOrg(auth.orgId, { eventType: 'FOLLOW_UP_REQUESTED', ...PAGE }),
      deps.auditEvents.listForOrg(auth.orgId, { eventType: 'FOLLOW_UP_RESOLVED', ...PAGE }),
    ]);
    const done = new Set(resolved.items.map((event) => event.call_id));
    const items = [];
    for (const event of requested.items) {
      if (!event.call_id || done.has(event.call_id)) continue;
      const call = await deps.calls.findById(auth.orgId, event.call_id);
      if (!call) continue;
      items.push({
        id: call.id,
        reference: `CALL-${call.call_number}`,
        department: call.department,
        status: call.status,
        sentiment: call.sentiment,
        topics: call.topics,
        summary: call.ai_summary?.summary ?? null,
        pii_total: call.pii_total,
        duration_seconds: call.duration_seconds,
        created_at: call.created_at,
        reason: String(event.metadata.reason ?? 'customer_requested'),
        requested_at: event.created_at,
      });
    }
    res.json({ items, total: items.length });
  });

  router.post('/calls/:id/follow-up/resolve', requirePermission('followups:resolve'), async (req, res) => {
    const auth = getAuth(req);
    const call = await deps.calls.findById(auth.orgId, parseId(req.params.id));
    if (!call) throw notFound('Call not found.');
    await deps.audit.record({
      orgId: auth.orgId,
      callId: call.id,
      type: 'FOLLOW_UP_RESOLVED',
      actorId: auth.userId,
      metadata: { call_reference: `CALL-${call.call_number}` },
    });
    res.status(204).end();
  });

  return router;
}
