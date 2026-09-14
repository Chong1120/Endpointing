import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { processCall } from '../src/pipeline/processCall.js';
import { PRESET_DEFINITIONS } from '../src/services/assemblyai/policies.js';
import { toSafeTranscript } from '../src/services/assemblyai/transcription.js';
import { buildTestDeps } from './support/fakes.js';
import { redactedTranscriptFixture } from './support/fixtures.js';

const WAV = Buffer.concat([Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt '), Buffer.alloc(64)]);

let tmp: string;
let ctx: ReturnType<typeof buildTestDeps>;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'safecall-test-'));
  ctx = buildTestDeps({ uploadTmpDir: tmp });
  ctx.authVerifier.addUser('alice');
  ctx.authVerifier.addUser('bob');
  app = createApp(ctx.deps);
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

async function uploadAs(token: string, filename = 'support-call.wav') {
  return request(app)
    .post('/api/calls')
    .set(as(token))
    .field('department', 'Billing')
    .field('policy_preset', 'CONTACT_CENTER')
    .field('analysis_enabled', 'true')
    .attach('file', WAV, filename);
}

async function completeCall(callId: string) {
  const call = ctx.calls.calls.get(callId)!;
  ctx.transcription.results.set(call.assemblyai_transcript_id!, {
    status: 'completed',
    transcript: toSafeTranscript(redactedTranscriptFixture(call.assemblyai_transcript_id!)),
  });
  await processCall(ctx.deps, { callId, transcriptId: call.assemblyai_transcript_id!, trigger: 'webhook' }, { attempt: 1, maxAttempts: 5 });
}

describe('authentication', () => {
  it('rejects requests without a bearer token', async () => {
    const res = await request(app).get('/api/calls');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects unknown or expired tokens', async () => {
    const res = await request(app).get('/api/calls').set(as('mallory'));
    expect(res.status).toBe(401);
  });

  it('provisions an organization on first use', async () => {
    const res = await request(app).get('/api/me').set(as('alice'));
    expect(res.status).toBe(200);
    expect(res.body.organization.name).toBe('alice org');
    expect(res.body.user.role).toBe('admin');
    expect(res.body.platform.speech_models).toEqual(['universal-3-5-pro', 'universal-2']);
  });

  it('keeps the health check public', async () => {
    expect((await request(app).get('/health')).status).toBe(200);
  });
});

describe('upload endpoint', () => {
  it('sends the recording to AssemblyAI and deletes the temporary file', async () => {
    const res = await uploadAs('alice');
    expect(res.status).toBe(202);
    expect(res.body.call).toMatchObject({ status: 'TRANSCRIBING', department: 'Billing', policy_preset: 'CONTACT_CENTER', original_filename: 'support-call.wav' });
    expect(res.body.call.reference).toMatch(/^CALL-\d+$/);
    expect(res.body.call).not.toHaveProperty('safe_audio_path');

    // Raw upload was a temp file, sent to AssemblyAI, then deleted.
    expect(ctx.transcription.uploadedPaths).toHaveLength(1);
    expect(existsSync(ctx.transcription.uploadedPaths[0]!)).toBe(false);
    expect(readdirSync(tmp)).toEqual([]);

    const submission = ctx.transcription.submissions[0]!;
    expect(submission.policies).toEqual(PRESET_DEFINITIONS.CONTACT_CENTER.policies);
    expect(submission.webhook?.url).toBe(`https://api.safecall.test/webhooks/assemblyai?call_id=${res.body.call.id}`);
    expect(submission.webhook?.secret).toBe(ctx.deps.config.assemblyai.webhookSecret);

    expect(ctx.auditEvents.typesFor(res.body.call.id)).toEqual(['CALL_RECEIVED', 'RAW_UPLOAD_DELETED', 'TRANSCRIPTION_SUBMITTED']);
  });

  it('uses the organization override for the selected preset', async () => {
    const me = await request(app).get('/api/me').set(as('alice'));
    await ctx.policies.saveOverride(me.body.organization.id, 'CONTACT_CENTER', ['person_name']);
    await uploadAs('alice');
    expect(ctx.transcription.submissions[0]?.policies).toEqual(['person_name']);
  });

  it('rejects unsupported file types without keeping the file', async () => {
    const res = await request(app).post('/api/calls').set(as('alice')).attach('file', Buffer.from('hello'), 'notes.txt');
    expect(res.status).toBe(415);
    expect(res.body.error.message).toMatch(/Unsupported file type/);
    expect(ctx.calls.calls.size).toBe(0);
    expect(readdirSync(tmp)).toEqual([]);
  });

  it('rejects files over the size limit', async () => {
    const small = buildTestDeps({ uploadTmpDir: tmp, maxUploadBytes: 1024 });
    small.authVerifier.addUser('alice');
    const res = await request(createApp(small.deps))
      .post('/api/calls')
      .set(as('alice'))
      .attach('file', Buffer.alloc(4096), 'big.wav');
    expect(res.status).toBe(413);
    expect(readdirSync(tmp)).toEqual([]);
  });

  it('requires a file', async () => {
    const res = await request(app).post('/api/calls').set(as('alice')).field('department', 'Billing');
    expect(res.status).toBe(400);
  });

  it('validates form fields and cleans up the temp file', async () => {
    const res = await request(app)
      .post('/api/calls')
      .set(as('alice'))
      .field('policy_preset', 'NOT_A_PRESET')
      .attach('file', WAV, 'a.wav');
    expect(res.status).toBe(400);
    expect(readdirSync(tmp)).toEqual([]);
  });

  it('marks the call FAILED when AssemblyAI upload fails', async () => {
    ctx.transcription.uploadError = Object.assign(new Error('Unauthorized'), { status: 401 });
    const res = await uploadAs('alice');
    expect(res.status).toBe(202);
    expect(res.body.call).toMatchObject({ status: 'FAILED', failed_stage: 'UPLOAD', can_retry: false });
    expect(readdirSync(tmp)).toEqual([]);
  });

  it('falls back to status checks when webhooks are not reachable', async () => {
    const local = buildTestDeps({ uploadTmpDir: tmp, webhooksEnabled: false, publicApiUrl: null });
    local.authVerifier.addUser('alice');
    await request(createApp(local.deps)).post('/api/calls').set(as('alice')).attach('file', WAV, 'a.wav');
    expect(local.transcription.submissions[0]?.webhook).toBeNull();
    expect(local.queue.pollJobs).toHaveLength(1);
  });
});

describe('organization isolation', () => {
  it('hides one organization’s calls from another', async () => {
    const { body } = await uploadAs('alice');
    const id = body.call.id;
    await completeCall(id);

    for (const url of [`/api/calls/${id}`, `/api/calls/${id}/audio-url`, `/api/calls/${id}/audit`]) {
      const res = await request(app).get(url).set(as('bob'));
      expect(res.status, url).toBe(404);
    }
    expect((await request(app).delete(`/api/calls/${id}`).set(as('bob'))).status).toBe(404);
    expect((await request(app).post(`/api/calls/${id}/retry`).set(as('bob'))).status).toBe(404);

    const list = await request(app).get('/api/calls').set(as('bob'));
    expect(list.body.total).toBe(0);
    const search = await request(app).get('/api/search?q=card').set(as('bob'));
    expect(search.body.total).toBe(0);
    const exported = await request(app).get('/api/export?format=jsonl').set(as('bob'));
    expect(exported.text).toBe('');

    expect((await request(app).get(`/api/calls/${id}`).set(as('alice'))).status).toBe(200);
  });

  it('treats malformed IDs as not found', async () => {
    expect((await request(app).get('/api/calls/not-a-uuid').set(as('alice'))).status).toBe(404);
  });
});

describe('call detail, playback and export', () => {
  it('returns the safe archive with a signed URL for redacted audio', async () => {
    const { body } = await uploadAs('alice');
    const id = body.call.id;

    const early = await request(app).get(`/api/calls/${id}/audio-url`).set(as('alice'));
    expect(early.status).toBe(409);

    await completeCall(id);
    const detail = await request(app).get(`/api/calls/${id}`).set(as('alice'));
    expect(detail.body.call).toMatchObject({ status: 'COMPLETED', pii_total: 9, has_safe_audio: true });
    expect(detail.body.utterances).toHaveLength(10);
    expect(detail.body.audit.map((e: { event_type: string }) => e.event_type)).toContain('ARCHIVE_CREATED');

    const audio = await request(app).get(`/api/calls/${id}/audio-url`).set(as('alice'));
    expect(audio.status).toBe(200);
    expect(audio.body).toMatchObject({ expires_in: 300, format: 'mp3' });
    expect(audio.body.url).toMatch(/^https:\/\/storage\.test\/signed\/org_.+\.mp3\?expires=300$/);
    expect(audio.headers['cache-control']).toBe('no-store');
    expect(ctx.auditEvents.typesFor(id)).toContain('SAFE_AUDIO_ACCESSED');
  });

  it('exports a safe dataset as JSONL and CSV', async () => {
    const { body } = await uploadAs('alice');
    await completeCall(body.call.id);

    const jsonl = await request(app).get('/api/export?format=jsonl').set(as('alice'));
    expect(jsonl.status).toBe(200);
    expect(jsonl.headers['content-disposition']).toMatch(/safecall-safe-dataset-\d{8}\.jsonl/);
    const record = JSON.parse(jsonl.text.trim());
    expect(record).toMatchObject({ call_id: body.call.id, sentiment: 'positive', topics: ['Account Update', 'Billing'] });
    expect(record.utterances[0]).toMatchObject({ speaker: 'A', role: 'agent' });
    expect(Object.keys(record)).not.toContain('audio');

    const csv = await request(app).get('/api/export?format=csv').set(as('alice'));
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\r\n')[0]).toContain('call_id,call_reference,department');
    expect(csv.text).toContain('[PERSON_NAME]');
  });

  it('retries a failed call from the failed stage', async () => {
    const { body } = await uploadAs('alice');
    const id = body.call.id;
    const transcriptId = ctx.calls.calls.get(id)!.assemblyai_transcript_id!;
    await ctx.calls.update(id, { status: 'FAILED', failed_stage: 'AI_ANALYSIS', error_message: 'AI analysis failed.' });

    const res = await request(app).post(`/api/calls/${id}/retry`).set(as('alice'));
    expect(res.status).toBe(202);
    expect(res.body.call.status).toBe('PROCESSING');
    expect(ctx.queue.processJobs.at(-1)).toEqual({ callId: id, transcriptId, trigger: 'retry' });
    expect(ctx.auditEvents.typesFor(id)).toContain('RETRY_STARTED');
  });

  it('refuses to retry calls that need a new upload', async () => {
    const { body } = await uploadAs('alice');
    await ctx.calls.update(body.call.id, { status: 'FAILED', failed_stage: 'TRANSCRIPTION' });
    expect((await request(app).post(`/api/calls/${body.call.id}/retry`).set(as('alice'))).status).toBe(409);
  });

  it('deletes a call and its safe audio', async () => {
    const { body } = await uploadAs('alice');
    await completeCall(body.call.id);
    expect(ctx.storage.objects.size).toBe(1);
    const res = await request(app).delete(`/api/calls/${body.call.id}`).set(as('alice'));
    expect(res.status).toBe(204);
    expect(ctx.storage.objects.size).toBe(0);
    expect(ctx.calls.calls.size).toBe(0);
    expect(ctx.auditEvents.events.at(-1)?.event_type).toBe('CALL_DELETED');
  });
});

describe('policies, samples and analytics', () => {
  it('lists presets and saves a validated override', async () => {
    const list = await request(app).get('/api/policies').set(as('alice'));
    expect(list.body.presets.map((p: { preset: string }) => p.preset)).toEqual(['CONTACT_CENTER', 'FINANCIAL', 'HEALTHCARE', 'CUSTOM']);

    const bad = await request(app).put('/api/policies/CUSTOM').set(as('alice')).send({ policies: ['person_name', 'made_up'] });
    expect(bad.status).toBe(400);

    const ok = await request(app).put('/api/policies/CUSTOM').set(as('alice')).send({ policies: ['person_name', 'phone_number'] });
    expect(ok.body).toEqual({ preset: 'CUSTOM', policies: ['person_name', 'phone_number'], customized: true });
  });

  it('runs a bundled synthetic sample through the real intake path', async () => {
    const samples = await request(app).get('/api/demo/samples').set(as('alice'));
    expect(samples.body.samples).toHaveLength(4);
    const res = await request(app).post('/api/demo/samples/call-c').set(as('alice')).send({});
    expect(res.status).toBe(202);
    expect(res.body.call).toMatchObject({ source: 'sample', department: 'General Inquiry', status: 'TRANSCRIBING' });
    expect(readdirSync(tmp)).toEqual([]);
  });

  it('summarizes the organization’s archive', async () => {
    const { body } = await uploadAs('alice');
    await completeCall(body.call.id);
    const res = await request(app).get('/api/analytics').set(as('alice'));
    expect(res.body.totals).toMatchObject({ calls: 1, completed: 1, safe_archives: 1, pii_entities: 9, success_rate: 100 });
    expect(res.body.top_topics[0]).toEqual({ topic: 'Account Update', count: 1 });
    expect(res.body.sentiment.positive).toBe(1);
  });

  it('lists the organization audit log', async () => {
    await uploadAs('alice');
    const res = await request(app).get('/api/audit?event_type=CALL_RECEIVED').set(as('alice'));
    expect(res.body.total).toBe(1);
    const bob = await request(app).get('/api/audit').set(as('bob'));
    expect(bob.body.total).toBe(0);
  });
});
