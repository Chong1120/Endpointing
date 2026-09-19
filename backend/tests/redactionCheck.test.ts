import { describe, expect, it } from 'vitest';
import { recheckRedaction } from '../src/pipeline/redactionRecheck.js';
import { toSafeTranscript } from '../src/services/assemblyai/transcription.js';
import { findLeftoverPii, maskAnalysis, maskLeftovers, staticEntityMap } from '../src/services/redactionCheck.js';
import { SAMPLE_ANALYSIS, buildTestDeps } from './support/fakes.js';
import { redactedTranscriptFixture } from './support/fixtures.js';

const LEAKY = 'Sure. 415-555-0197— [PHONE_NUMBER]. The security code is 123.';
const CLEANED = 'Sure. [PHONE_NUMBER] [PHONE_NUMBER]. The security code is [CREDIT_CARD_CVV].';

describe('finding values the first redaction pass missed', () => {
  it('catches a number the caller restarted', () => {
    expect(findLeftoverPii(LEAKY)).toEqual([
      { label: 'CREDIT_CARD_CVV', term: '123' },
      { label: 'PHONE_NUMBER', term: '415-555-0197' },
    ]);
  });

  it('catches account numbers, card numbers and email addresses, written or spoken', () => {
    expect(findLeftoverPii('the account number is 7730 2291')).toEqual([{ label: 'ACCOUNT_NUMBER', term: '7730 2291' }]);
    expect(findLeftoverPii('card 4000 0566 5566 5556 expires soon')).toEqual([{ label: 'CREDIT_CARD_NUMBER', term: '4000 0566 5566 5556' }]);
    expect(findLeftoverPii('send it to kevin.walsh@example.com')).toEqual([{ label: 'EMAIL_ADDRESS', term: 'kevin.walsh@example.com' }]);
    expect(findLeftoverPii('my email is jane dot doe at example dot com')).toEqual([
      { label: 'EMAIL_ADDRESS', term: 'jane dot doe at example dot com' },
    ]);
  });

  it('leaves ordinary conversation and existing labels alone', () => {
    const text =
      'I see two charges for $45 on September 1st (2026-09-01). Refund RF-7731 arrives in 3 to 5 business days, and [PHONE_NUMBER] is on file.';
    expect(findLeftoverPii(text)).toEqual([]);
    expect(findLeftoverPii(null)).toEqual([]);
  });

  it('groups terms by label for AssemblyAI and can mask text locally', () => {
    const findings = findLeftoverPii(LEAKY);
    expect(staticEntityMap(findings)).toEqual({ CREDIT_CARD_CVV: ['123'], PHONE_NUMBER: ['415-555-0197'] });
    expect(maskLeftovers(LEAKY, findings)).toBe('Sure. [PHONE_NUMBER]— [PHONE_NUMBER]. The security code is [CREDIT_CARD_CVV].');
    const analysis = maskAnalysis({ ...SAMPLE_ANALYSIS, summary: 'The caller gave 415-555-0197 and the code 123.' }, findings);
    expect(analysis.summary).toBe('The caller gave [PHONE_NUMBER] and the code [CREDIT_CARD_CVV].');
  });
});

async function archivedCall(ctx: ReturnType<typeof buildTestDeps>, overrides: Record<string, unknown> = {}) {
  const call = await ctx.calls.create({
    organization_id: 'org-1',
    created_by: 'user-1',
    original_filename: 'live-agent-call.ogg',
    department: 'Billing',
    source: 'upload',
    policy_preset: 'CONTACT_CENTER',
    pii_policies: ['person_name', 'phone_number', 'credit_card_cvv'],
    analysis_enabled: true,
  });
  await ctx.calls.replaceUtterances(call.id, [{ seq: 0, speaker: 'B', start_ms: 0, end_ms: 4000, text: LEAKY }]);
  return ctx.calls.update(call.id, {
    status: 'COMPLETED',
    redacted_transcript: LEAKY,
    pii_counts: { PERSON_NAME: 1, PHONE_NUMBER: 1 },
    pii_total: 2,
    pii_types: ['PERSON_NAME', 'PHONE_NUMBER'],
    safe_audio_path: 'org_1/2026/09/call.mp3',
    safe_audio_format: 'mp3',
    ai_summary: {
      ...SAMPLE_ANALYSIS,
      summary: 'The caller gave 415-555-0197 and the code 123.',
      model: 'qwen3.5-4b-32k-fast',
      generated_at: '2026-09-19T00:00:00.000Z',
    },
    ...overrides,
  });
}

describe('rechecking an archived call', () => {
  it('sends the leftovers back to AssemblyAI and replaces the stored transcript, insights and audio', async () => {
    const ctx = buildTestDeps();
    const call = await archivedCall(ctx);
    await ctx.storage.upload('org_1/2026/09/call.mp3', Buffer.from('first-redaction'), 'audio/mpeg');
    ctx.transcription.results.set('transcript-1', {
      status: 'completed',
      transcript: toSafeTranscript(
        redactedTranscriptFixture('transcript-1', {
          text: CLEANED,
          utterances: [{ speaker: 'B', start: 0, end: 4000, text: CLEANED, confidence: 0.95, words: [] }],
        }),
      ),
    });
    ctx.transcription.audioBytes = Buffer.from('second-redaction');

    const result = await recheckRedaction(ctx.deps, call);

    expect(result).toMatchObject({ status: 'redacted', found: 2 });
    expect(result.labels).toEqual(['CREDIT_CARD_CVV', 'PHONE_NUMBER']);

    const submission = ctx.transcription.submissions[0]!;
    expect(submission.staticEntities).toEqual({ CREDIT_CARD_CVV: ['123'], PHONE_NUMBER: ['415-555-0197'] });
    expect(submission.audioUrl).toContain('org_1/2026/09/call.mp3'); // the already-redacted recording, via a signed URL

    const stored = (await ctx.calls.findByIdForSystem(call.id))!;
    expect(stored.redacted_transcript).toBe(CLEANED);
    expect(stored.redacted_transcript).not.toContain('415-555-0197');
    // The first pass protected a name and one number; this check adds the repeated number and the code.
    expect(stored.pii_counts).toEqual({ PERSON_NAME: 1, PHONE_NUMBER: 2, CREDIT_CARD_CVV: 1 });
    expect(stored.pii_total).toBe(4);
    expect(stored.ai_summary?.summary).toBe('The caller gave [PHONE_NUMBER] and the code [CREDIT_CARD_CVV].');
    expect((await ctx.calls.listUtterances(call.id))[0]?.text).toBe(CLEANED);
    expect(ctx.storage.objects.get('org_1/2026/09/call.mp3')?.data.toString()).toBe('second-redaction');
    expect(ctx.transcription.deleted).toEqual(['transcript-1']);

    const audit = ctx.auditEvents.events.find((event) => event.event_type === 'EXTRA_PII_REDACTED');
    expect(audit?.metadata).toMatchObject({ entities: 2, method: 'assemblyai_static_entities', audio_updated: true });
    expect(JSON.stringify(audit?.metadata)).not.toContain('415-555-0197');
  });

  it('masks the stored text when there is no recording to send back', async () => {
    const ctx = buildTestDeps();
    const call = await archivedCall(ctx, { safe_audio_path: null, safe_audio_format: null });

    const result = await recheckRedaction(ctx.deps, call);

    expect(result.status).toBe('text_only');
    expect(ctx.transcription.submissions).toEqual([]);
    const stored = (await ctx.calls.findByIdForSystem(call.id))!;
    expect(stored.redacted_transcript).not.toContain('415-555-0197');
    expect(stored.redacted_transcript).not.toContain('is 123');
    expect((await ctx.calls.listUtterances(call.id))[0]?.text).not.toContain('415-555-0197');
  });

  it('does nothing when the transcript is already clean', async () => {
    const ctx = buildTestDeps();
    const call = await archivedCall(ctx, { redacted_transcript: 'Sure. [PHONE_NUMBER]. The security code is [CREDIT_CARD_CVV].' });

    expect(await recheckRedaction(ctx.deps, call)).toEqual({ status: 'clean', found: 0, labels: [] });
    expect(ctx.transcription.submissions).toEqual([]);
    expect(ctx.auditEvents.events.filter((event) => event.event_type === 'EXTRA_PII_REDACTED')).toEqual([]);
  });
});
