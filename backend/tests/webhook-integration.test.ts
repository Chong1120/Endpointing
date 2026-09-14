import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { processCall } from '../src/pipeline/processCall.js';
import { WEBHOOK_AUTH_HEADER, toSafeTranscript } from '../src/services/assemblyai/transcription.js';
import { buildTestDeps } from './support/fakes.js';
import { RAW_PII_VALUES, redactedTranscriptFixture } from './support/fixtures.js';

let tmp: string;
let ctx: ReturnType<typeof buildTestDeps>;
let app: ReturnType<typeof createApp>;
const auth = { Authorization: 'Bearer alice' };

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'safecall-webhook-'));
  ctx = buildTestDeps({ uploadTmpDir: tmp });
  ctx.authVerifier.addUser('alice');
  app = createApp(ctx.deps);
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

async function uploadCall() {
  const res = await request(app)
    .post('/api/calls')
    .set(auth)
    .field('department', 'Customer Support')
    .attach('file', Buffer.from('RIFF....WAVEfmt '), 'call-a.wav');
  const call = res.body.call as { id: string };
  const transcriptId = ctx.calls.calls.get(call.id)!.assemblyai_transcript_id!;
  return { callId: call.id, transcriptId };
}

const deliver = (body: object, secret: string | null = ctx.deps.config.assemblyai.webhookSecret, callId?: string) => {
  const req = request(app).post(`/webhooks/assemblyai${callId ? `?call_id=${callId}` : ''}`);
  if (secret !== null) req.set(WEBHOOK_AUTH_HEADER, secret);
  return req.send(body);
};

describe('webhook authentication', () => {
  it('rejects deliveries without the shared secret', async () => {
    const { transcriptId } = await uploadCall();
    const res = await deliver({ transcript_id: transcriptId, status: 'completed' }, null);
    expect(res.status).toBe(401);
    expect(ctx.queue.processJobs).toHaveLength(0);
  });

  it('rejects deliveries with the wrong secret', async () => {
    const { transcriptId } = await uploadCall();
    const res = await deliver({ transcript_id: transcriptId, status: 'completed' }, 'guess');
    expect(res.status).toBe(401);
    expect(ctx.queue.processJobs).toHaveLength(0);
  });

  it('accepts authenticated deliveries and only enqueues work', async () => {
    const { callId, transcriptId } = await uploadCall();
    const res = await deliver({ transcript_id: transcriptId, status: 'completed' }, undefined, callId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, duplicate: false });
    expect(ctx.queue.processJobs).toEqual([{ callId, transcriptId, trigger: 'webhook' }]);
    // No processing happened inside the handler.
    expect(ctx.calls.calls.get(callId)?.status).toBe('TRANSCRIBING');
  });

  it('acknowledges redacted-audio notifications and ignores unknown transcripts', async () => {
    expect((await deliver({ status: 'redacted_audio_ready', redacted_audio_url: 'https://s3/x' })).status).toBe(200);
    const unknown = await deliver({ transcript_id: 'nope', status: 'completed' });
    expect(unknown.body).toMatchObject({ ignored: true });
    expect((await deliver({ hello: 'world' })).status).toBe(400);
  });

  it('ignores a delivery whose call_id does not match the transcript', async () => {
    const { transcriptId } = await uploadCall();
    const res = await deliver({ transcript_id: transcriptId, status: 'completed' }, undefined, '00000000-0000-4000-8000-000000000000');
    expect(res.body).toMatchObject({ ignored: true });
    expect(ctx.queue.processJobs).toHaveLength(0);
  });
});

describe('duplicate webhooks', () => {
  it('collapses repeated deliveries into one job', async () => {
    const { callId, transcriptId } = await uploadCall();
    const first = await deliver({ transcript_id: transcriptId, status: 'completed' });
    const second = await deliver({ transcript_id: transcriptId, status: 'completed' });
    expect(first.body.duplicate).toBe(false);
    expect(second.body.duplicate).toBe(true);
    expect(ctx.queue.processJobs).toHaveLength(1);
    const received = ctx.auditEvents.events.filter((e) => e.event_type === 'WEBHOOK_RECEIVED' && e.call_id === callId);
    expect(received.map((e) => e.metadata.duplicate)).toEqual([false, true]);
  });
});

describe('integration: upload → AssemblyAI job → webhook → worker → safe archive', () => {
  it('produces a searchable, playable, exportable safe archive', async () => {
    // 1. Upload
    const { callId, transcriptId } = await uploadCall();
    expect(ctx.transcription.submissions).toHaveLength(1);

    // 2. AssemblyAI finishes the (mocked) job
    ctx.transcription.results.set(transcriptId, {
      status: 'completed',
      transcript: toSafeTranscript(redactedTranscriptFixture(transcriptId)),
    });

    // 3. Webhook arrives
    expect((await deliver({ transcript_id: transcriptId, status: 'completed' }, undefined, callId)).status).toBe(200);

    // 4. Worker runs the queued job
    const job = ctx.queue.processJobs[0]!;
    expect(await processCall(ctx.deps, job, { attempt: 1, maxAttempts: 5 })).toBe('completed');

    // 5. Safe archive is available through the API
    const detail = await request(app).get(`/api/calls/${callId}`).set(auth);
    expect(detail.body.call).toMatchObject({
      status: 'COMPLETED',
      pii_total: 9,
      has_safe_audio: true,
      sentiment: 'positive',
      speakers_count: 2,
    });
    expect(detail.body.call.ai_summary.summary).toBeTruthy();
    expect(detail.body.utterances[3].text).toBe('Sure. It is [PHONE_NUMBER].');

    const events = detail.body.audit.map((e: { event_type: string }) => e.event_type);
    expect(events).toEqual([
      'CALL_RECEIVED',
      'RAW_UPLOAD_DELETED',
      'TRANSCRIPTION_SUBMITTED',
      'WEBHOOK_RECEIVED',
      'TRANSCRIPTION_COMPLETED',
      'SPEAKERS_SEPARATED',
      'PII_DETECTION_COMPLETED',
      'TRANSCRIPT_REDACTED',
      'SAFE_TRANSCRIPT_STORED',
      'AUDIO_REDACTED',
      'SAFE_AUDIO_STORED',
      'AI_ANALYSIS_COMPLETED',
      'ASSEMBLYAI_DATA_DELETED',
      'ARCHIVE_CREATED',
    ]);

    const audio = await request(app).get(`/api/calls/${callId}/audio-url`).set(auth);
    expect(audio.status).toBe(200);

    const search = await request(app).get('/api/search?q=autopay').set(auth);
    expect(search.body.items.map((i: { id: string }) => i.id)).toEqual([callId]);

    const exported = await request(app).get('/api/export?format=jsonl').set(auth);
    for (const value of RAW_PII_VALUES) expect(exported.text).not.toContain(value);
    expect(exported.text).toContain('[CREDIT_CARD_NUMBER]');
  });
});
