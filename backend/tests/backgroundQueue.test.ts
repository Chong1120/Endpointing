import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDeps } from '../src/http/appDeps.js';
import { BackgroundJobQueue } from '../src/queue/backgroundQueue.js';
import { toSafeTranscript } from '../src/services/assemblyai/transcription.js';
import { buildTestDeps, silentLogger } from './support/fakes.js';
import { redactedTranscriptFixture } from './support/fixtures.js';

const ORG = '22222222-2222-4222-8222-222222222222';

function setup(settings = { maxAttempts: 3, backoffMs: 1_000 }) {
  const ctx = buildTestDeps();
  const queue = new BackgroundJobQueue(silentLogger, settings);
  const deps: AppDeps = { ...ctx.deps, queue };
  queue.attach(deps);
  ctx.transcription.results.set('transcript-1', { status: 'completed', transcript: toSafeTranscript(redactedTranscriptFixture()) });
  return { ...ctx, deps, queue };
}

async function seedCall(ctx: ReturnType<typeof setup>) {
  const call = await ctx.calls.create({
    organization_id: ORG,
    created_by: null,
    original_filename: 'call-a.wav',
    department: 'Customer Support',
    source: 'upload',
    policy_preset: 'CONTACT_CENTER',
    pii_policies: ['person_name'],
    analysis_enabled: true,
  });
  return ctx.calls.update(call.id, { status: 'TRANSCRIBING', assemblyai_transcript_id: 'transcript-1', submitted_at: new Date().toISOString() });
}

const jobFor = (callId: string, trigger: 'webhook' | 'retry' = 'webhook') => ({ callId, transcriptId: 'transcript-1', trigger });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('in-process background queue (no Redis)', () => {
  it('processes a call in the background and ignores duplicate deliveries', async () => {
    const ctx = setup();
    const call = await seedCall(ctx);

    expect(await ctx.queue.enqueueProcessCall(jobFor(call.id))).toEqual({ enqueued: true });
    expect(await ctx.queue.enqueueProcessCall(jobFor(call.id))).toEqual({ enqueued: false });
    await vi.runAllTimersAsync();

    expect(ctx.calls.calls.get(call.id)?.status).toBe('COMPLETED');
    expect(ctx.analysis.inputs).toHaveLength(1);
    expect(ctx.queue.isActive(call.id)).toBe(false);
  });

  it('retries a transient failure after a backoff, then completes', async () => {
    const ctx = setup();
    const call = await seedCall(ctx);
    ctx.analysis.error = Object.assign(new Error('LLM Gateway returned HTTP 429'), { status: 429 });

    await ctx.queue.enqueueProcessCall(jobFor(call.id));
    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.calls.calls.get(call.id)?.status).toBe('PROCESSING');
    expect(ctx.queue.isActive(call.id)).toBe(true);

    ctx.analysis.error = null;
    await vi.advanceTimersByTimeAsync(1_001);
    expect(ctx.calls.calls.get(call.id)?.status).toBe('COMPLETED');
  });

  it('marks the call FAILED once the retry budget is spent', async () => {
    const ctx = setup({ maxAttempts: 2, backoffMs: 1_000 });
    const call = await seedCall(ctx);
    ctx.analysis.error = Object.assign(new Error('LLM Gateway returned HTTP 503'), { status: 503 });

    await ctx.queue.enqueueProcessCall(jobFor(call.id));
    await vi.runAllTimersAsync();

    expect(ctx.calls.calls.get(call.id)).toMatchObject({ status: 'FAILED', failed_stage: 'AI_ANALYSIS' });
    expect(ctx.queue.isActive(call.id)).toBe(false);
  });

  it('refuses a manual retry while the call is still running', async () => {
    const ctx = setup();
    const call = await seedCall(ctx);
    await ctx.queue.enqueueProcessCall(jobFor(call.id));
    await expect(ctx.queue.requeueProcessCall(jobFor(call.id, 'retry'))).rejects.toThrow(/already being processed/);
    await vi.runAllTimersAsync();
  });

  it('runs the local status check and hands off to processing', async () => {
    const ctx = setup();
    const call = await seedCall(ctx);

    await ctx.queue.enqueuePollTranscript({ callId: call.id, transcriptId: 'transcript-1', attempt: 1 }, 5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.runAllTimersAsync();

    expect(ctx.calls.calls.get(call.id)?.status).toBe('COMPLETED');
  });

  it('schedules nothing after close', async () => {
    const ctx = setup();
    const call = await seedCall(ctx);
    await ctx.queue.close();
    await ctx.queue.enqueueProcessCall(jobFor(call.id));
    await vi.runAllTimersAsync();
    expect(ctx.calls.calls.get(call.id)?.status).toBe('TRANSCRIBING');
  });
});
