import { Router } from 'express';
import { z } from 'zod';
import { AUDIT_EVENT_TYPES } from '../domain/types.js';
import type { AppDeps } from '../http/appDeps.js';
import { CallQuerySchema, parseInput, toCallFilters } from '../http/validation.js';
import { getAuth } from '../middleware/auth.js';
import { computeAnalytics } from '../services/analytics.js';
import { buildSafeExport, toCsv, toJsonl } from '../services/export.js';

const AuditQuerySchema = z.object({
  call_id: z.uuid().optional(),
  event_type: z.enum(AUDIT_EVENT_TYPES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

const ExportQuerySchema = CallQuerySchema.omit({ q: true, status: true, page: true, page_size: true }).extend({
  format: z.enum(['jsonl', 'csv']).default('jsonl'),
});

/** Search, analytics, audit log and safe dataset export. */
export function insightsRouter(deps: AppDeps): Router {
  const router = Router();

  // Full-text search over SAFE data only (redacted transcript, AI analysis, metadata).
  router.get('/search', async (req, res) => {
    const auth = getAuth(req);
    const query = parseInput(CallQuerySchema, req.query);
    const filters = toCallFilters(query);
    if (!query.q) {
      const { items, total } = await deps.calls.list(auth.orgId, filters);
      res.json({
        items: items.map((item) => ({ ...item, reference: `CALL-${item.call_number}`, snippet: null })),
        total,
        page: query.page,
        page_size: query.page_size,
        query: null,
      });
      return;
    }
    const { items, total } = await deps.calls.search(auth.orgId, query.q, filters);
    res.json({
      items: items.map((item) => ({ ...item, reference: `CALL-${item.call_number}` })),
      total,
      page: query.page,
      page_size: query.page_size,
      query: query.q,
    });
  });

  router.get('/analytics', async (req, res) => {
    const auth = getAuth(req);
    res.json(computeAnalytics(await deps.calls.listForAnalytics(auth.orgId)));
  });

  router.get('/audit', async (req, res) => {
    const auth = getAuth(req);
    const query = parseInput(AuditQuerySchema, req.query);
    const { items, total } = await deps.auditEvents.listForOrg(auth.orgId, {
      callId: query.call_id,
      eventType: query.event_type,
      limit: query.page_size,
      offset: (query.page - 1) * query.page_size,
    });
    res.json({ items, total, page: query.page, page_size: query.page_size });
  });

  router.get('/export', async (req, res) => {
    const auth = getAuth(req);
    const query = parseInput(ExportQuerySchema, req.query);
    const filters = toCallFilters({ ...query, page: 1, page_size: 100 });
    const calls = await deps.calls.listCompleted(auth.orgId, { ...filters, limit: 0, offset: 0 });
    const utterances = await deps.calls.listUtterancesForCalls(calls.map((call) => call.id));
    const records = calls.map((call) => buildSafeExport(call, utterances.get(call.id) ?? []));
    const body = query.format === 'csv' ? toCsv(records) : toJsonl(records);

    await deps.audit.record({
      orgId: auth.orgId,
      callId: null,
      type: 'DATASET_EXPORTED',
      actorId: auth.userId,
      metadata: {
        format: query.format,
        calls: records.length,
        utterances: records.reduce((sum, r) => sum + r.utterances.length, 0),
      },
    });

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.set({
      'Content-Type': query.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8',
      'Content-Disposition': `attachment; filename="safecall-safe-dataset-${stamp}.${query.format}"`,
      'Cache-Control': 'no-store',
    });
    res.send(body);
  });

  return router;
}
