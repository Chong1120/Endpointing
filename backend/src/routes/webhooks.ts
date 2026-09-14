import { createHash, timingSafeEqual } from 'node:crypto';
import express, { Router } from 'express';
import type { AppDeps } from '../http/appDeps.js';
import { WEBHOOK_AUTH_HEADER } from '../services/assemblyai/transcription.js';

/** Constant-time comparison (hashing first makes lengths equal). */
export function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * AssemblyAI webhook receiver.
 *
 * Deliveries carry only `{ transcript_id, status }` (plus a separate
 * "redacted audio ready" notification). The handler authenticates, enqueues
 * the processing job and returns 2xx immediately — AssemblyAI expects a
 * response within 10 seconds, so no transcript work happens here.
 */
export function webhooksRouter(deps: AppDeps): Router {
  const router = Router();

  router.post('/assemblyai', express.json({ limit: '64kb' }), async (req, res) => {
    const provided = req.get(WEBHOOK_AUTH_HEADER) ?? '';
    if (!provided || !secretsMatch(provided, deps.config.assemblyai.webhookSecret)) {
      deps.logger.warn({ ip: req.ip }, 'rejected AssemblyAI webhook with invalid auth header');
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid webhook signature.' } });
      return;
    }

    const body = (req.body ?? {}) as { transcript_id?: unknown; status?: unknown };

    // Redacted-audio-ready notification (no transcript_id). The worker fetches
    // the redacted file itself, so this only needs acknowledging.
    if (body.status === 'redacted_audio_ready') {
      res.status(200).json({ received: true });
      return;
    }

    const transcriptId = typeof body.transcript_id === 'string' ? body.transcript_id : null;
    const status = body.status;
    if (!transcriptId || (status !== 'completed' && status !== 'error')) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Unrecognized webhook payload.' } });
      return;
    }

    const call = await deps.calls.findByTranscriptId(transcriptId);
    const expectedCallId = typeof req.query.call_id === 'string' ? req.query.call_id : null;
    if (!call || (expectedCallId && expectedCallId !== call.id)) {
      deps.logger.warn({ transcriptId }, 'webhook for unknown transcript ignored');
      res.status(200).json({ received: true, ignored: true });
      return;
    }

    const { enqueued } = await deps.queue.enqueueProcessCall({ callId: call.id, transcriptId, trigger: 'webhook' });
    await deps.audit.record({
      orgId: call.organization_id,
      callId: call.id,
      type: 'WEBHOOK_RECEIVED',
      metadata: { status, transcript_id: transcriptId, duplicate: !enqueued },
    });
    res.status(200).json({ received: true, duplicate: !enqueued });
  });

  return router;
}
