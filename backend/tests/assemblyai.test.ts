import { describe, expect, it } from 'vitest';
import { PipelineError } from '../src/errors.js';
import { PRESET_DEFINITIONS } from '../src/services/assemblyai/policies.js';
import { speakerTranscript } from '../src/services/assemblyai/safeTranscript.js';
import {
  WEBHOOK_AUTH_HEADER,
  buildTranscriptParams,
  toSafeTranscript,
} from '../src/services/assemblyai/transcription.js';
import { RAW_PII_VALUES, redactedTranscriptFixture, transcriptWithUnredactedFields } from './support/fixtures.js';

describe('AssemblyAI transcription request', () => {
  const policies = PRESET_DEFINITIONS.CONTACT_CENTER.policies;

  it('requests diarization, language detection and text + audio PII redaction', () => {
    const params = buildTranscriptParams({
      audioUrl: 'https://cdn.assemblyai.com/upload/abc',
      policies,
      redactedAudioFormat: 'wav',
      webhook: { url: 'https://api.safecall.example/webhooks/assemblyai?call_id=1', secret: 's3cret' },
    });

    expect(params).toMatchObject({
      audio_url: 'https://cdn.assemblyai.com/upload/abc',
      speech_models: ['universal-3-5-pro', 'universal-2'],
      speaker_labels: true,
      language_detection: true,
      format_text: true,
      redact_pii: true,
      redact_pii_policies: policies,
      redact_pii_sub: 'entity_name',
      redact_pii_audio: true,
      redact_pii_audio_quality: 'wav',
      redact_pii_audio_options: { override_audio_redaction_method: 'silence' },
      webhook_url: 'https://api.safecall.example/webhooks/assemblyai?call_id=1',
      webhook_auth_header_name: WEBHOOK_AUTH_HEADER,
      webhook_auth_header_value: 's3cret',
    });
  });

  it('never asks AssemblyAI for the unredacted transcript or deprecated summaries', () => {
    const params = buildTranscriptParams({ audioUrl: 'u', policies, redactedAudioFormat: 'mp3', webhook: null }) as Record<string, unknown>;
    expect(params).not.toHaveProperty('redact_pii_return_unredacted');
    for (const deprecated of ['summarization', 'summary_model', 'summary_type', 'auto_chapters']) {
      expect(params).not.toHaveProperty(deprecated);
    }
    expect(params).not.toHaveProperty('webhook_url');
  });

  it('refuses to submit without any PII policy', () => {
    expect(() => buildTranscriptParams({ audioUrl: 'u', policies: [], redactedAudioFormat: 'mp3', webhook: null })).toThrow(
      PipelineError,
    );
  });
});

describe('safe transcript conversion', () => {
  it('keeps redacted utterances, speakers and metadata', () => {
    const safe = toSafeTranscript(redactedTranscriptFixture());
    expect(safe.speakers).toEqual(['A', 'B']);
    expect(safe.utterances).toHaveLength(10);
    expect(safe.utterances[0]).toEqual({
      seq: 0,
      speaker: 'A',
      start_ms: 400,
      end_ms: 5200,
      text: 'Thank you for calling Northwind Mobile, my name is [PERSON_NAME]. How can I help you today?',
    });
    expect(safe.languageCode).toBe('en');
    expect(safe.speechModelUsed).toBe('universal-3-5-pro');
    expect(speakerTranscript(safe).split('\n')[1]).toMatch(/^Speaker B: Hi \[PERSON_NAME\]/);
  });

  it('drops unredacted fields even if AssemblyAI returned them', () => {
    const safe = toSafeTranscript(transcriptWithUnredactedFields());
    const serialized = JSON.stringify(safe);
    for (const value of RAW_PII_VALUES) expect(serialized).not.toContain(value);
    expect(Object.keys(safe)).not.toContain('unredacted_text');
  });

  it('rejects transcripts where PII redaction was not applied', () => {
    expect(() => toSafeTranscript(redactedTranscriptFixture('t', { redact_pii: false }))).toThrow(/without PII redaction/);
  });
});
