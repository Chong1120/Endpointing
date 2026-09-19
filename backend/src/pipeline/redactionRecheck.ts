import type { CallRecord, PiiCounts } from '../domain/types.js';
import type { PiiPolicyName } from '../services/assemblyai/policies.js';
import { countPiiMarkers, summarizePii } from '../services/pii.js';
import { findLeftoverPii, maskAnalysis, maskLeftovers, staticEntityMap, type LeftoverPii } from '../services/redactionCheck.js';
import { AUDIO_CONTENT_TYPES } from '../services/storage/safeAudioStorage.js';
import { sleepFor, type PipelineDeps } from './deps.js';
import { describeError } from './failures.js';

const TRANSCRIPT_POLL_MS = 3_000;
const TRANSCRIPT_POLL_ATTEMPTS = 40; // about two minutes
const AUDIO_POLL_MS = 5_000;
const AUDIO_POLL_ATTEMPTS = 12;
const SIGNED_URL_SECONDS = 900;

export interface RecheckResult {
  /** `clean` nothing slipped through · `redacted` transcript and audio fixed · `text_only` transcript fixed, audio unchanged */
  status: 'clean' | 'redacted' | 'text_only';
  found: number;
  labels: string[];
}

/**
 * Checks an archived call for values AssemblyAI's redaction missed and, when it
 * finds any, sends the already-redacted recording back with
 * `redact_static_entities`. That pass removes the exact terms from the
 * transcript and from the audio, and the results replace what was stored.
 *
 * Safe to run more than once: a clean transcript is a no-op, and the second
 * pass only ever sees audio that was already redacted.
 */
export async function recheckRedaction(deps: PipelineDeps, call: CallRecord): Promise<RecheckResult> {
  const findings = findLeftoverPii(call.redacted_transcript);
  if (findings.length === 0) return { status: 'clean', found: 0, labels: [] };

  const labels = [...new Set(findings.map((finding) => finding.label))].sort();
  deps.logger.warn({ callId: call.id, entities: findings.length, entity_types: labels }, 'redaction check found values left in a transcript');

  let status: RecheckResult['status'] = 'text_only';
  if (call.safe_audio_path) {
    try {
      await reRedactWithAssemblyAI(deps, call, call.safe_audio_path, findings);
      status = 'redacted';
    } catch (error) {
      deps.logger.warn({ callId: call.id, err: describeError(error) }, 'second redaction pass failed; masking the stored text instead');
    }
  }
  if (status === 'text_only') await maskStoredText(deps, call, findings);

  await deps.audit.record({
    orgId: call.organization_id,
    callId: call.id,
    type: 'EXTRA_PII_REDACTED',
    metadata: {
      entities: findings.length,
      entity_types: labels,
      method: status === 'redacted' ? 'assemblyai_static_entities' : 'transcript_mask',
      audio_updated: status === 'redacted',
    },
  });
  return { status, found: findings.length, labels };
}

async function reRedactWithAssemblyAI(deps: PipelineDeps, call: CallRecord, audioPath: string, findings: LeftoverPii[]): Promise<void> {
  const format = call.safe_audio_format ?? deps.config.assemblyai.redactedAudioFormat;
  const audioUrl = await deps.storage.createSignedUrl(audioPath, SIGNED_URL_SECONDS);
  const submitted = await deps.transcription.submit({
    audioUrl,
    policies: call.pii_policies as PiiPolicyName[],
    redactedAudioFormat: format,
    webhook: null,
    staticEntities: staticEntityMap(findings),
  });

  const transcript = await waitForTranscript(deps, submitted.id);
  const counts = mergedCounts(call.pii_counts, findings, countPiiMarkers(transcript.text));
  const { total, types } = summarizePii(counts);
  await deps.calls.replaceUtterances(call.id, transcript.utterances);
  await deps.calls.update(call.id, {
    redacted_transcript: transcript.text,
    pii_counts: counts,
    pii_total: total,
    pii_types: types,
    ...(call.ai_summary ? { ai_summary: maskAnalysis(call.ai_summary, findings) } : {}),
  });

  const audio = await waitForRedactedAudio(deps, submitted.id);
  if (audio) await deps.storage.upload(audioPath, audio, AUDIO_CONTENT_TYPES[format]);
  await deps.transcription.deleteTranscript(submitted.id).catch((error: unknown) => {
    deps.logger.warn({ callId: call.id, err: describeError(error) }, 'could not delete the recheck transcript at AssemblyAI');
  });
}

/** Fallback: mask the stored text. The recording still contains the spoken value. */
async function maskStoredText(deps: PipelineDeps, call: CallRecord, findings: LeftoverPii[]): Promise<void> {
  const text = maskLeftovers(call.redacted_transcript ?? '', findings);
  const utterances = (await deps.calls.listUtterances(call.id)).map((utterance) => ({
    ...utterance,
    text: maskLeftovers(utterance.text, findings),
  }));
  const counts = mergedCounts(call.pii_counts, findings, countPiiMarkers(text));
  const { total, types } = summarizePii(counts);
  await deps.calls.replaceUtterances(call.id, utterances);
  await deps.calls.update(call.id, {
    redacted_transcript: text,
    pii_counts: counts,
    pii_total: total,
    pii_types: types,
    ...(call.ai_summary ? { ai_summary: maskAnalysis(call.ai_summary, findings) } : {}),
  });
}

/**
 * The second pass only sees what the first one didn't silence, so counting its
 * markers alone would under-report. Keep what the first pass protected and add
 * what this check caught.
 */
function mergedCounts(previous: PiiCounts, findings: LeftoverPii[], fresh: PiiCounts): PiiCounts {
  const caught: PiiCounts = {};
  for (const { label } of findings) caught[label] = (caught[label] ?? 0) + 1;
  const merged: PiiCounts = {};
  for (const label of new Set([...Object.keys(previous), ...Object.keys(fresh), ...Object.keys(caught)])) {
    merged[label] = Math.max((previous[label] ?? 0) + (caught[label] ?? 0), fresh[label] ?? 0);
  }
  return merged;
}

async function waitForTranscript(deps: PipelineDeps, transcriptId: string) {
  for (let attempt = 0; attempt < TRANSCRIPT_POLL_ATTEMPTS; attempt += 1) {
    const result = await deps.transcription.getTranscript(transcriptId);
    if (result.status === 'completed') return result.transcript;
    if (result.status === 'error') throw new Error(`the second redaction pass failed: ${result.error}`);
    await sleepFor(deps, TRANSCRIPT_POLL_MS);
  }
  throw new Error('the second redaction pass did not finish in time');
}

/** Null when the new audio isn't ready: the transcript is fixed, the stored audio keeps the first redaction. */
async function waitForRedactedAudio(deps: PipelineDeps, transcriptId: string): Promise<Buffer | null> {
  for (let attempt = 0; attempt < AUDIO_POLL_ATTEMPTS; attempt += 1) {
    const result = await deps.transcription.getRedactedAudio(transcriptId);
    if (result.status === 'ready') return deps.transcription.downloadRedactedAudio(result.url, deps.config.maxUploadBytes * 4);
    await sleepFor(deps, AUDIO_POLL_MS);
  }
  return null;
}
