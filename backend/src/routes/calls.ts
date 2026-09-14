import { Router } from 'express';
import { z } from 'zod';
import { DEPARTMENTS, POLICY_PRESETS } from '../domain/types.js';
import { badRequest, conflict, notFound } from '../errors.js';
import type { AppDeps } from '../http/appDeps.js';
import { presentCall } from '../http/presenters.js';
import { CallQuerySchema, parseId, parseInput, toCallFilters } from '../http/validation.js';
import { getAuth, requireRole } from '../middleware/auth.js';
import { createUploadMiddleware, sanitizeFilename } from '../middleware/upload.js';
import { canRetry } from '../pipeline/failures.js';
import { intakeCall, removeTempFile } from '../pipeline/intake.js';
import { resolvePolicies } from '../services/assemblyai/policies.js';

const UploadFieldsSchema = z.object({
  department: z.enum(DEPARTMENTS).default('Customer Support'),
  policy_preset: z.enum(POLICY_PRESETS).default('CONTACT_CENTER'),
  analysis_enabled: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

export function callsRouter(deps: AppDeps): Router {
  const router = Router();
  const upload = createUploadMiddleware(deps.config);

  // Upload a recording -> temporary file -> AssemblyAI -> temp file deleted.
  router.post('/', upload, async (req, res) => {
    const auth = getAuth(req);
    const file = req.file;
    if (!file) throw badRequest('Choose an audio file to upload.');

    let fields: z.infer<typeof UploadFieldsSchema>;
    try {
      fields = parseInput(UploadFieldsSchema, req.body);
    } catch (error) {
      await removeTempFile(file.path, deps);
      throw error;
    }

    const overrides = await deps.policies.listOverrides(auth.orgId).catch(async (error) => {
      await removeTempFile(file.path, deps);
      throw error;
    });

    const call = await intakeCall(deps, {
      auth,
      tempFilePath: file.path,
      originalFilename: sanitizeFilename(file.originalname),
      sizeBytes: file.size,
      department: fields.department,
      preset: fields.policy_preset,
      policies: resolvePolicies(fields.policy_preset, overrides[fields.policy_preset]),
      analysisEnabled: fields.analysis_enabled,
      source: 'upload',
    });
    res.status(202).json({ call: presentCall(call) });
  });

  router.get('/', async (req, res) => {
    const auth = getAuth(req);
    const query = parseInput(CallQuerySchema, req.query);
    const { items, total } = await deps.calls.list(auth.orgId, toCallFilters(query));
    res.json({
      items: items.map((item) => ({ ...item, reference: `CALL-${item.call_number}` })),
      total,
      page: query.page,
      page_size: query.page_size,
    });
  });

  router.get('/:id', async (req, res) => {
    const auth = getAuth(req);
    const call = await deps.calls.findById(auth.orgId, parseId(req.params.id));
    if (!call) throw notFound('Call not found.');
    const [utterances, audit] = await Promise.all([
      deps.calls.listUtterances(call.id),
      deps.auditEvents.listForCall(auth.orgId, call.id),
    ]);
    res.json({ call: presentCall(call), utterances, audit });
  });

  // Short-lived signed URL for the REDACTED recording in the private bucket.
  router.get('/:id/audio-url', async (req, res) => {
    const auth = getAuth(req);
    const call = await deps.calls.findById(auth.orgId, parseId(req.params.id));
    if (!call) throw notFound('Call not found.');
    if (!call.safe_audio_path) throw conflict('The safe recording is not available yet.');

    const ttl = deps.config.signedUrlTtlSeconds;
    const url = await deps.storage.createSignedUrl(call.safe_audio_path, ttl);
    await deps.audit.record({
      orgId: auth.orgId,
      callId: call.id,
      type: 'SAFE_AUDIO_ACCESSED',
      actorId: auth.userId,
      metadata: { expires_in_seconds: ttl, format: call.safe_audio_format },
    });
    res.set('Cache-Control', 'no-store');
    res.json({ url, expires_in: ttl, format: call.safe_audio_format });
  });

  router.get('/:id/audit', async (req, res) => {
    const auth = getAuth(req);
    const call = await deps.calls.findById(auth.orgId, parseId(req.params.id));
    if (!call) throw notFound('Call not found.');
    res.json({ events: await deps.auditEvents.listForCall(auth.orgId, call.id) });
  });

  // Resume a failed pipeline from the stage that failed.
  router.post('/:id/retry', async (req, res) => {
    const auth = getAuth(req);
    const call = await deps.calls.findById(auth.orgId, parseId(req.params.id));
    if (!call) throw notFound('Call not found.');
    if (!canRetry(call) || !call.assemblyai_transcript_id) {
      throw conflict('This call cannot be retried. Upload the recording again instead.');
    }

    await deps.audit.record({
      orgId: auth.orgId,
      callId: call.id,
      type: 'RETRY_STARTED',
      actorId: auth.userId,
      metadata: { previous_stage: call.failed_stage },
    });
    const updated = await deps.calls.update(call.id, { status: 'PROCESSING', failed_stage: null, error_message: null });
    await deps.queue.requeueProcessCall({ callId: call.id, transcriptId: call.assemblyai_transcript_id, trigger: 'retry' });
    res.status(202).json({ call: presentCall(updated) });
  });

  router.delete('/:id', requireRole('admin'), async (req, res) => {
    const auth = getAuth(req);
    const call = await deps.calls.findById(auth.orgId, parseId(req.params.id));
    if (!call) throw notFound('Call not found.');
    if (call.status === 'UPLOADING' || call.status === 'PROCESSING') {
      throw conflict('This call is still being processed. Try again when it has finished.');
    }

    if (call.safe_audio_path) await deps.storage.remove([call.safe_audio_path]);
    if (call.assemblyai_transcript_id && !call.original_deleted_at) {
      await deps.transcription.deleteTranscript(call.assemblyai_transcript_id).catch((error) => {
        deps.logger.warn({ callId: call.id, err: String(error) }, 'could not delete transcript at AssemblyAI');
      });
    }
    await deps.calls.delete(call.id);
    await deps.audit.record({
      orgId: auth.orgId,
      callId: null,
      type: 'CALL_DELETED',
      actorId: auth.userId,
      metadata: { call_reference: `CALL-${call.call_number}`, safe_audio_removed: Boolean(call.safe_audio_path) },
    });
    res.status(204).end();
  });

  return router;
}
