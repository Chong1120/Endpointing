import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthContext } from '../src/domain/types.js';
import { processCall } from '../src/pipeline/processCall.js';
import { pollTranscript, sweepStuckCalls } from '../src/pipeline/statusChecks.js';
import { toSafeTranscript } from '../src/services/assemblyai/transcription.js';
import { buildTestDeps } from './support/fakes.js';
import { EXPECTED_PII_COUNTS, RAW_PII_VALUES, redactedTranscriptFixture, transcriptWithUnredactedFields } from './support/fixtures.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_1 = { attempt: 1, maxAttempts: 5 };
const FINAL_ATTEMPT = { attempt: 5, maxAttempts: 5 };

async function seedTranscribingCall(ctx: ReturnType<typeof buildTestDeps>, transcriptId = 'transcript-1', analysisEnabled = true) {
  const call = await ctx.calls.create({
    organization_id: ORG,
    created_by: null,
    original_filename: 'call-a.wav',
    department: 'Customer Support',
    source: 'upload',
    policy_preset: 'CONTACT_CENTER',
    pii_policies: ['person_name', 'phone_number'],
    analysis_enabled: analysisEnabled,
  });
  return ctx.calls.update(call.id, {
    status: 'TRANSCRIBING',
    assemblyai_transcript_id: transcriptId,
    submitted_at: new Date().toISOString(),
  });
}

describe('successful processing', () => {
  let ctx: ReturnType<typeof buildTestDeps>;
  beforeEach(() => {
    ctx = buildTestDeps();
    ctx.transcription.results.set('transcript-1', { status: 'completed', transcript: toSafeTranscript(redactedTranscriptFixture()) });
  });

  it('creates a complete safe archive', async () => {
    const seeded = await seedTranscribingCall(ctx);
    const outcome = await processCall(ctx.deps, { callId: seeded.id, transcriptId: 'transcript-1', trigger: 'webhook' }, ATTEMPT_1);
    expect(outcome).toBe('completed');

    const call = ctx.calls.calls.get(seeded.id)!;
    expect(call.status).toBe('COMPLETED');
    expect(call.pii_counts).toEqual(EXPECTED_PII_COUNTS);
    expect(call.pii_total).toBe(9);
    expect(call.speakers_count).toBe(2);
    expect(call.detected_language).toBe('en');
    expect(call.speech_model_used).toBe('universal-3-5-pro');
    expect(call.redacted_transcript).toContain('[CREDIT_CARD_NUMBER]');
    expect(ctx.calls.utterances.get(seeded.id)).toHaveLength(10);

    // Redacted audio stored privately under org/year/month.
    const [objectPath, object] = [...ctx.storage.objects.entries()][0]!;
    expect(objectPath).toMatch(new RegExp(`^org_${ORG}/\\d{4}/\\d{2}/${seeded.id}\\.mp3$`));
    expect(object.contentType).toBe('audio/mpeg');
    expect(call.safe_audio_path).toBe(objectPath);

    // AI analysis ran on the redacted, speaker-labelled transcript only.
    expect(ctx.analysis.inputs).toHaveLength(1);
    expect(ctx.analysis.inputs[0]).toMatch(/^Speaker A: .*\[PERSON_NAME\]/);
    expect(call.ai_summary?.summary).toContain('updated');
    expect(call.sentiment).toBe('positive');
    expect(call.topics).toEqual(['Account Update', 'Billing']);

    // Data deleted at AssemblyAI after archiving.
    expect(ctx.transcription.deleted).toEqual(['transcript-1']);
    expect(call.original_deleted_at).not.toBeNull();

    expect(ctx.auditEvents.typesFor(seeded.id)).toEqual([
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
  });

  it('never persists unredacted text, even if AssemblyAI returns it', async () => {
    ctx.transcription.results.set('transcript-1', { status: 'completed', transcript: toSafeTranscript(transcriptWithUnredactedFields()) });
    const seeded = await seedTranscribingCall(ctx);
    await processCall(ctx.deps, { callId: seeded.id, transcriptId: 'transcript-1', trigger: 'webhook' }, ATTEMPT_1);

    const stored = JSON.stringify({
      call: ctx.calls.calls.get(seeded.id),
      utterances: ctx.calls.utterances.get(seeded.id),
      audit: ctx.auditEvents.events,
      llmInput: ctx.analysis.inputs,
    });
    for (const value of RAW_PII_VALUES) expect(stored).not.toContain(value);
  });

  it('skips AI analysis when disabled for the call', async () => {
    const seeded = await seedTranscribingCall(ctx, 'transcript-1', false);
    await processCall(ctx.deps, { callId: seeded.id, transcriptId: 'transcript-1', trigger: 'webhook' }, ATTEMPT_1);
    expect(ctx.analysis.inputs).toHaveLength(0);
    expect(ctx.auditEvents.typesFor(seeded.id)).toContain('AI_ANALYSIS_SKIPPED');
    expect(ctx.calls.calls.get(seeded.id)?.status).toBe('COMPLETED');
  });
});

describe('duplicate webhook handling', () => {
  it('processes a call once even if the job runs twice', async () => {
    const ctx = buildTestDeps();
    ctx.transcription.results.set('transcript-1', { status: 'completed', transcript: toSafeTranscript(redactedTranscriptFixture()) });
    const seeded = await seedTranscribingCall(ctx);
    const job = { callId: seeded.id, transcriptId: 'transcript-1', trigger: 'webhook' as const };

    expect(await processCall(ctx.deps, job, ATTEMPT_1)).toBe('completed');
    const eventsAfterFirst = ctx.auditEvents.events.length;
    expect(await processCall(ctx.deps, job, ATTEMPT_1)).toBe('skipped');
    expect(ctx.auditEvents.events.length).toBe(eventsAfterFirst);
    expect(ctx.storage.objects.size).toBe(1);
    expect(ctx.analysis.inputs).toHaveLength(1);
  });

  it('ignores jobs whose transcript ID does not match the call', async () => {
    const ctx = buildTestDeps();
    const seeded = await seedTranscribingCall(ctx);
    expect(await processCall(ctx.deps, { callId: seeded.id, transcriptId: 'someone-else', trigger: 'webhook' }, ATTEMPT_1)).toBe(
      'skipped',
    );
    expect(ctx.calls.calls.get(seeded.id)?.status).toBe('TRANSCRIBING');
  });
});

describe('failed AssemblyAI processing', () => {
  it('marks the call FAILED with an understandable message', async () => {
    const ctx = buildTestDeps();
    ctx.transcription.results.set('transcript-1', {
      status: 'error',
      error: 'Transcoding failed. File does not appear to contain audio.',
    });
    const seeded = await seedTranscribingCall(ctx);
    const outcome = await processCall(ctx.deps, { callId: seeded.id, transcriptId: 'transcript-1', trigger: 'webhook' }, ATTEMPT_1);

    expect(outcome).toBe('failed');
    const call = ctx.calls.calls.get(seeded.id)!;
    expect(call).toMatchObject({ status: 'FAILED', failed_stage: 'TRANSCRIPTION', error_message: 'No speech was detected in this recording.' });
    expect(call.redacted_transcript).toBeNull();
    const failure = ctx.auditEvents.events.find((e) => e.event_type === 'PROCESSING_FAILED');
    expect(failure?.metadata).toMatchObject({ stage: 'TRANSCRIPTION', can_retry: false });
  });

  it('retries transient AI failures, then fails at the AI stage and resumes on retry', async () => {
    const ctx = buildTestDeps();
    ctx.transcription.results.set('transcript-1', { status: 'completed', transcript: toSafeTranscript(redactedTranscriptFixture()) });
    ctx.analysis.error = Object.assign(new Error('LLM Gateway returned HTTP 503'), { status: 503 });
    const seeded = await seedTranscribingCall(ctx);
    const job = { callId: seeded.id, transcriptId: 'transcript-1', trigger: 'webhook' as const };

    // Non-final attempt: throws so BullMQ retries; call stays PROCESSING.
    await expect(processCall(ctx.deps, job, ATTEMPT_1)).rejects.toThrow(/AI analysis/);
    expect(ctx.calls.calls.get(seeded.id)?.status).toBe('PROCESSING');
    expect(ctx.calls.calls.get(seeded.id)?.safe_audio_path).not.toBeNull();

    // Final attempt: marked FAILED at AI_ANALYSIS, retry is allowed.
    expect(await processCall(ctx.deps, job, FINAL_ATTEMPT)).toBe('failed');
    const failed = ctx.calls.calls.get(seeded.id)!;
    expect(failed).toMatchObject({ status: 'FAILED', failed_stage: 'AI_ANALYSIS' });
    expect(ctx.transcription.deleted).toEqual([]); // AssemblyAI data kept so retry can work

    // Manual retry resumes: no second audio upload, analysis now succeeds.
    ctx.analysis.error = null;
    await ctx.calls.update(seeded.id, { status: 'PROCESSING' });
    expect(await processCall(ctx.deps, { ...job, trigger: 'retry' }, ATTEMPT_1)).toBe('completed');
    expect(ctx.storage.objects.size).toBe(1);
    expect(ctx.auditEvents.typesFor(seeded.id).filter((t) => t === 'SAFE_AUDIO_STORED')).toHaveLength(1);
    expect(ctx.calls.calls.get(seeded.id)?.status).toBe('COMPLETED');
  });

  it('waits for redacted audio and retries when it is not ready', async () => {
    const ctx = buildTestDeps();
    ctx.transcription.results.set('transcript-1', { status: 'completed', transcript: toSafeTranscript(redactedTranscriptFixture()) });
    ctx.transcription.redactedAudio = { status: 'pending', detail: 'not ready' };
    const seeded = await seedTranscribingCall(ctx);
    await expect(
      processCall(ctx.deps, { callId: seeded.id, transcriptId: 'transcript-1', trigger: 'webhook' }, ATTEMPT_1),
    ).rejects.toThrow(/redacted audio/);
    expect(ctx.calls.calls.get(seeded.id)?.redacted_transcript).not.toBeNull();
  });
});

describe('status-check fallback and sweeper', () => {
  const auth: AuthContext = { userId: 'u', email: 'u@example.com', orgId: ORG, orgName: 'Org', role: 'admin' };

  it('re-schedules while transcribing and hands off when complete', async () => {
    const ctx = buildTestDeps({ webhooksEnabled: false, publicApiUrl: null });
    const seeded = await seedTranscribingCall(ctx);
    ctx.transcription.results.set('transcript-1', { status: 'processing' });

    await pollTranscript(ctx.deps, { callId: seeded.id, transcriptId: 'transcript-1', attempt: 1 });
    expect(ctx.queue.pollJobs).toHaveLength(1);
    expect(ctx.queue.processJobs).toHaveLength(0);

    ctx.transcription.results.set('transcript-1', { status: 'completed', transcript: toSafeTranscript(redactedTranscriptFixture()) });
    await pollTranscript(ctx.deps, { callId: seeded.id, transcriptId: 'transcript-1', attempt: 2 });
    expect(ctx.queue.processJobs).toEqual([{ callId: seeded.id, transcriptId: 'transcript-1', trigger: 'poll' }]);
    expect(auth.orgId).toBe(ORG);
  });

  it('requeues calls whose webhook never arrived', async () => {
    const ctx = buildTestDeps();
    const seeded = await seedTranscribingCall(ctx);
    await ctx.calls.update(seeded.id, { submitted_at: new Date(Date.now() - 30 * 60_000).toISOString() });
    ctx.transcription.results.set('transcript-1', { status: 'completed', transcript: toSafeTranscript(redactedTranscriptFixture()) });

    expect(await sweepStuckCalls(ctx.deps)).toEqual({ checked: 1, requeued: 1, failed: 0 });
    expect(ctx.queue.processJobs[0]?.trigger).toBe('sweeper');
  });
});
