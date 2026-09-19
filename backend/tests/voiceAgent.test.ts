import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { buildLiveAgentSession, sessionBelongsTo, sessionReference } from '../src/services/assemblyai/liveAgent.js';
import { AssemblyAIVoiceAgentService } from '../src/services/assemblyai/voiceAgent.js';
import { buildTestDeps } from './support/fakes.js';

let tmp: string;
let ctx: ReturnType<typeof buildTestDeps>;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'safecall-voice-'));
  ctx = buildTestDeps({ uploadTmpDir: tmp });
  ctx.authVerifier.addUser('alice');
  ctx.authVerifier.addUser('bob');
  app = createApp(ctx.deps);
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Starts a live-agent call as `token`, then registers the finished session with the fake AssemblyAI. */
async function finishedCallFor(token: string, sessionId = 'sess_9a648a2ab75747a9') {
  const started = await request(app).post('/api/voice-agent/session').set(as(token));
  ctx.voiceAgent.sessions.set(sessionId, {
    id: sessionId,
    status: 'completed',
    durationSeconds: 42.6,
    systemPrompt: started.body.session.system_prompt,
    recordingUrl: 'https://s3.assemblyai.test/sess/audio.ogg?X-Amz-Signature=abc',
  });
  return sessionId;
}

describe('starting a live-agent call', () => {
  it('gives the browser a single-use token and the agent config, never the API key', async () => {
    const res = await request(app).post('/api/voice-agent/session').set(as('alice'));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ token: 'voice-token-single-use', websocket_url: 'wss://agents.assemblyai.com/v1/ws', max_session_seconds: 600 });
    expect(JSON.stringify(res.body)).not.toContain(ctx.deps.config.assemblyai.apiKey);
    expect(res.body.session.output.voice).toBe('alba');
    expect(res.body.session.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'lookup_account',
      'list_recent_charges',
      'issue_refund',
      'update_contact_details',
      'transfer_to_human',
    ]);
    expect(ctx.voiceAgent.tokenRequests).toEqual([{ expiresInSeconds: 120, maxSessionSeconds: 600 }]);
    expect(ctx.auditEvents.events.map((event) => event.event_type)).toContain('VOICE_SESSION_STARTED');
  });

  it('requires sign-in', async () => {
    expect((await request(app).post('/api/voice-agent/session')).status).toBe(401);
  });

  it('signs the organization into the session so only it can archive the call', () => {
    const secret = 'test-webhook-secret-0123456789';
    const prompt = buildLiveAgentSession(sessionReference(secret, 'org-a')).system_prompt;
    expect(sessionBelongsTo(prompt, secret, 'org-a')).toBe(true);
    expect(sessionBelongsTo(prompt, secret, 'org-b')).toBe(false);
    expect(sessionBelongsTo(prompt, 'another-secret-0123456789', 'org-a')).toBe(false);
    expect(sessionBelongsTo(null, secret, 'org-a')).toBe(false);
  });
});

describe('archiving a finished live-agent call', () => {
  it('runs the recording through the redaction pipeline, then deletes the session at AssemblyAI', async () => {
    const sessionId = await finishedCallFor('alice');
    const res = await request(app).post(`/api/voice-agent/sessions/${sessionId}/archive`).set(as('alice'));
    expect(res.status).toBe(202);
    expect(res.body.call).toMatchObject({ status: 'TRANSCRIBING', department: 'AI Voice Agent', policy_preset: 'CONTACT_CENTER', analysis_enabled: true });
    expect(res.body.call.original_filename).toMatch(/^live-agent-call-.+\.ogg$/);

    // Recording: temporary file → AssemblyAI → deleted. The voice session copy is deleted too.
    expect(ctx.transcription.uploadedPaths).toHaveLength(1);
    expect(readdirSync(tmp)).toEqual([]);
    expect(ctx.voiceAgent.deleted).toEqual([sessionId]);

    expect(ctx.auditEvents.typesFor(res.body.call.id)).toEqual(
      expect.arrayContaining(['CALL_RECEIVED', 'RAW_UPLOAD_DELETED', 'TRANSCRIPTION_SUBMITTED', 'VOICE_SESSION_DELETED']),
    );
    const received = ctx.auditEvents.events.find((event) => event.call_id === res.body.call.id && event.event_type === 'CALL_RECEIVED');
    expect(received?.metadata).toMatchObject({ channel: 'live_agent', voice_session_id: sessionId });
    expect(JSON.stringify(ctx.auditEvents.events)).not.toContain('X-Amz-Signature');
  });

  it("refuses to archive another organization's call", async () => {
    const sessionId = await finishedCallFor('alice');
    const res = await request(app).post(`/api/voice-agent/sessions/${sessionId}/archive`).set(as('bob'));
    expect(res.status).toBe(403);
    expect(ctx.transcription.uploadedPaths).toEqual([]);
    expect(ctx.voiceAgent.deleted).toEqual([]);
  });

  it('waits for the recording to appear after the call ends', async () => {
    const sessionId = await finishedCallFor('alice');
    ctx.voiceAgent.activeLookups.set(sessionId, 3);
    const res = await request(app).post(`/api/voice-agent/sessions/${sessionId}/archive`).set(as('alice'));
    expect(res.status).toBe(202);
    expect(ctx.voiceAgent.lookups).toBe(4);
  });

  it('gives up with a retryable error when the recording never appears', async () => {
    const sessionId = await finishedCallFor('alice');
    ctx.voiceAgent.activeLookups.set(sessionId, 1_000);
    const res = await request(app).post(`/api/voice-agent/sessions/${sessionId}/archive`).set(as('alice'));
    expect(res.status).toBe(503);
    expect(ctx.voiceAgent.lookups).toBe(24);
    expect(ctx.calls.calls.size).toBe(0);
  });

  it('reports an unknown or already archived session as not found', async () => {
    const res = await request(app).post('/api/voice-agent/sessions/sess_unknown123/archive').set(as('alice'));
    expect(res.status).toBe(404);
  });

  it('rejects malformed session ids', async () => {
    const res = await request(app).post('/api/voice-agent/sessions/not%20valid/archive').set(as('alice'));
    expect(res.status).toBe(400);
  });
});

describe('Voice Agent REST client', () => {
  it('mints tokens with the Bearer key and reads the session recording', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) =>
      String(url).includes('/v1/token')
        ? new Response(JSON.stringify({ token: 'tok_1', expires_in_seconds: 120 }))
        : new Response(
            JSON.stringify({
              id: 'sess_1',
              status: 'completed',
              duration_seconds: 12,
              config: { system_prompt: 'prompt' },
              artifacts: [
                { type: 'timeline', url: 'https://x.test/timeline.json' },
                { type: 'audio', url: 'https://x.test/audio.ogg' },
              ],
            }),
          ),
    );
    const client = new AssemblyAIVoiceAgentService({ apiKey: 'aai-key', fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(await client.createToken({ expiresInSeconds: 120, maxSessionSeconds: 600 })).toBe('tok_1');
    const [tokenUrl, tokenInit] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(tokenUrl)).toBe('https://agents.assemblyai.com/v1/token?expires_in_seconds=120&max_session_duration_seconds=600');
    expect((tokenInit.headers as Record<string, string>).authorization).toBe('Bearer aai-key');

    expect(await client.getSession('sess_1')).toEqual({
      id: 'sess_1',
      status: 'completed',
      durationSeconds: 12,
      systemPrompt: 'prompt',
      recordingUrl: 'https://x.test/audio.ogg',
    });
  });

  it('treats a missing session as null and surfaces other errors with their status', async () => {
    const missing = new AssemblyAIVoiceAgentService({ apiKey: 'k', fetchImpl: (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch });
    expect(await missing.getSession('sess_x')).toBeNull();
    await expect(missing.deleteSession('sess_x')).resolves.toBeUndefined();

    const down = new AssemblyAIVoiceAgentService({ apiKey: 'k', fetchImpl: (async () => new Response('busy', { status: 503 })) as unknown as typeof fetch });
    await expect(down.createToken({ expiresInSeconds: 60, maxSessionSeconds: 60 })).rejects.toMatchObject({ status: 503 });
  });
});

describe('handing a call to a person', () => {
  it('queues the call for a human and closes it again when someone handles it', async () => {
    const sessionId = await finishedCallFor('alice');
    const archived = await request(app)
      .post(`/api/voice-agent/sessions/${sessionId}/archive`)
      .set(as('alice'))
      .send({ escalation: { reason: 'upset_customer' } });
    expect(archived.status).toBe(202);
    expect(archived.body.follow_up).toBe('upset_customer');

    const callId = archived.body.call.id;
    const requested = ctx.auditEvents.events.find((event) => event.event_type === 'FOLLOW_UP_REQUESTED');
    expect(requested?.metadata).toMatchObject({ reason: 'upset_customer', channel: 'live_agent' });

    const queue = await request(app).get('/api/follow-ups').set(as('alice'));
    expect(queue.status).toBe(200);
    expect(queue.body.items).toHaveLength(1);
    expect(queue.body.items[0]).toMatchObject({ id: callId, reason: 'upset_customer', department: 'AI Voice Agent' });

    expect((await request(app).post(`/api/calls/${callId}/follow-up/resolve`).set(as('alice'))).status).toBe(204);
    expect((await request(app).get('/api/follow-ups').set(as('alice'))).body.items).toEqual([]);
  });

  it('keeps the queue inside the organization and ignores anything but a known reason', async () => {
    const sessionId = await finishedCallFor('alice');
    const archived = await request(app)
      .post(`/api/voice-agent/sessions/${sessionId}/archive`)
      .set(as('alice'))
      .send({ escalation: { reason: 'the caller said her card is 4111 1111 1111 1111' } });
    expect(archived.body.follow_up).toBeNull();
    expect(ctx.auditEvents.events.some((event) => event.event_type === 'FOLLOW_UP_REQUESTED')).toBe(false);
    expect(JSON.stringify(ctx.auditEvents.events)).not.toContain('4111');

    expect((await request(app).get('/api/follow-ups').set(as('bob'))).body.items).toEqual([]);
    expect((await request(app).post(`/api/calls/${archived.body.call.id}/follow-up/resolve`).set(as('bob'))).status).toBe(404);
  });
});
