import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryAuditRepository, silentLogger } from './support/fakes.js';
import { RepositoryAuditLogger, sanitizeAuditMetadata } from '../src/services/audit.js';
import { SupabaseSafeAudioStorage, buildSafeAudioPath } from '../src/services/storage/safeAudioStorage.js';

function fakeSupabase(bucket: { public: boolean } | null) {
  const objectApi = {
    upload: vi.fn(async () => ({ data: { path: 'p' }, error: null })),
    createSignedUrl: vi.fn(async (path: string, ttl: number) => ({
      data: { signedUrl: `http://127.0.0.1:54321/storage/v1/object/sign/safe-call-audio/${path}?token=t&ttl=${ttl}` },
      error: null,
    })),
    remove: vi.fn(async () => ({ data: [], error: null })),
  };
  const storage = {
    from: vi.fn(() => objectApi),
    getBucket: vi.fn(async () =>
      bucket ? { data: { id: 'safe-call-audio', public: bucket.public }, error: null } : { data: null, error: { message: 'Bucket not found' } },
    ),
    createBucket: vi.fn(async () => ({ data: { name: 'safe-call-audio' }, error: null })),
    updateBucket: vi.fn(async () => ({ data: { message: 'ok' }, error: null })),
  };
  return { client: { storage } as unknown as SupabaseClient, storage, objectApi };
}

describe('safe audio storage', () => {
  it('builds org/year/month object paths', () => {
    expect(buildSafeAudioPath('org-1', 'call-9', '2026-09-03T10:00:00Z', 'mp3')).toBe('org_org-1/2026/09/call-9.mp3');
    expect(buildSafeAudioPath('org-1', 'call-9', new Date('2026-12-31T23:00:00Z'), 'wav')).toBe('org_org-1/2026/12/call-9.wav');
  });

  it('uploads redacted audio with the right content type to the private bucket', async () => {
    const { client, storage, objectApi } = fakeSupabase({ public: false });
    const store = new SupabaseSafeAudioStorage(client, 'safe-call-audio', 1024);
    await store.upload('org_1/2026/09/c.mp3', Buffer.from('audio'), 'audio/mpeg');
    expect(storage.from).toHaveBeenCalledWith('safe-call-audio');
    expect(objectApi.upload).toHaveBeenCalledWith('org_1/2026/09/c.mp3', Buffer.from('audio'), {
      contentType: 'audio/mpeg',
      upsert: true,
      cacheControl: 'no-store',
    });
  });

  it('generates short-lived signed URLs', async () => {
    const { client, objectApi } = fakeSupabase({ public: false });
    const store = new SupabaseSafeAudioStorage(client, 'safe-call-audio', 1024);
    const url = await store.createSignedUrl('org_1/2026/09/c.mp3', 300);
    expect(objectApi.createSignedUrl).toHaveBeenCalledWith('org_1/2026/09/c.mp3', 300);
    expect(url).toContain('/object/sign/');
  });

  it('creates the bucket as private when missing', async () => {
    const { client, storage } = fakeSupabase(null);
    await new SupabaseSafeAudioStorage(client, 'safe-call-audio', 1024).ensureBucket();
    expect(storage.createBucket).toHaveBeenCalledWith('safe-call-audio', expect.objectContaining({ public: false }));
  });

  it('forces an existing public bucket back to private', async () => {
    const { client, storage } = fakeSupabase({ public: true });
    await new SupabaseSafeAudioStorage(client, 'safe-call-audio', 1024).ensureBucket();
    expect(storage.updateBucket).toHaveBeenCalledWith('safe-call-audio', { public: false });
  });
});

describe('audit logging', () => {
  it('drops content-bearing keys and keeps technical IDs and counts', () => {
    const clean = sanitizeAuditMetadata({
      transcript_id: 'abc',
      text: 'My card is 4111',
      redacted_transcript: '...',
      redacted_audio_url: 'https://s3/...',
      customer_email: 'a@b.c',
      password: 'hunter2',
      counts: { PHONE_NUMBER: 2 },
      entity_types: ['PHONE_NUMBER'],
      nested: { anything: 'goes' },
      duration_seconds: 42,
      input_tokens: 900,
      utterances: 13,
      ok: true,
    });
    expect(clean).toEqual({
      transcript_id: 'abc',
      counts: { PHONE_NUMBER: 2 },
      entity_types: ['PHONE_NUMBER'],
      duration_seconds: 42,
      input_tokens: 900,
      utterances: 13,
      ok: true,
    });
  });

  it('keeps transcript IDs but truncates long strings', () => {
    const clean = sanitizeAuditMetadata({ stage: 'x'.repeat(500) });
    expect(String(clean.stage).length).toBeLessThanOrEqual(201);
  });

  it('writes sanitized events and reports recorded types', async () => {
    const repo = new InMemoryAuditRepository();
    const audit = new RepositoryAuditLogger(repo, silentLogger);
    await audit.record({ orgId: 'org', callId: 'call', type: 'CALL_RECEIVED', actorId: 'user', metadata: { size_bytes: 10, text: 'raw' } });
    expect(repo.events[0]).toMatchObject({
      organization_id: 'org',
      call_id: 'call',
      event_type: 'CALL_RECEIVED',
      actor_id: 'user',
      metadata: { size_bytes: 10 },
    });
    expect(await audit.recordedTypes('org', 'call')).toEqual(new Set(['CALL_RECEIVED']));
  });
});
