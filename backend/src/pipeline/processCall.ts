import type { AuditEventType, CallRecord } from '../domain/types.js';
import { PipelineError, type PipelineStage } from '../errors.js';
import type { ProcessCallJob } from '../queue/jobs.js';
import type { SafeTranscript } from '../services/assemblyai/safeTranscript.js';
import { speakerTranscriptFromArchive } from '../services/assemblyai/safeTranscript.js';
import { AnalysisValidationError } from '../services/llm/analysis.js';
import { countPiiMarkers, countRedactionMarkers, summarizePii } from '../services/pii.js';
import { AUDIO_CONTENT_TYPES, buildSafeAudioPath } from '../services/storage/safeAudioStorage.js';
import { nowIso, sleepFor, type PipelineDeps } from './deps.js';
import { describeError, markCallFailed } from './failures.js';
import { recheckRedaction } from './redactionRecheck.js';

export type ProcessOutcome = 'completed' | 'skipped' | 'failed';

export interface AttemptInfo {
  attempt: number;
  maxAttempts: number;
}

const STAGE_MESSAGES: Record<PipelineStage, string> = {
  UPLOAD: 'The recording could not be uploaded to AssemblyAI.',
  TRANSCRIPTION: 'AssemblyAI could not transcribe this recording.',
  PII_REDACTION: 'PII redaction could not be verified, so nothing was archived.',
  AUDIO_REDACTION: 'The redacted audio could not be retrieved from AssemblyAI.',
  STORAGE: 'The safe archive could not be saved to storage. Retry to try again.',
  AI_ANALYSIS: 'AI analysis of the redacted transcript failed. Retry to run it again.',
  ARCHIVE: 'The safe archive could not be finalized. Retry to try again.',
};

// Redacted audio is produced asynchronously after the transcript completes.
const REDACTED_AUDIO_WAIT_MS = [0, 2_000, 3_000, 5_000, 5_000, 10_000, 10_000, 15_000, 15_000, 20_000, 20_000];

export function friendlyTranscriptionError(error: string): string {
  const text = error.toLowerCase();
  if (/no spoken audio|does not appear to contain audio|no speech|empty audio/.test(text)) {
    return 'No speech was detected in this recording.';
  }
  if (/decode|unsupported|not a valid|format|corrupt|could not be processed/.test(text)) {
    return 'The file could not be decoded as audio. Upload a standard recording such as MP3 or WAV.';
  }
  if (/too short|minimum/.test(text)) return 'The recording is too short to transcribe.';
  if (/download/.test(text)) return 'AssemblyAI could not read the uploaded recording. Please upload it again.';
  return `AssemblyAI could not transcribe this recording (${error.slice(0, 160)}).`;
}

/**
 * Post-transcription pipeline, run by the worker after the AssemblyAI webhook:
 * fetch transcript → verify redaction → store safe transcript + PII stats →
 * fetch redacted audio → private storage → AI analysis on the SAFE transcript
 * → delete data at AssemblyAI → mark archive COMPLETED.
 *
 * Every stage is idempotent, so automatic retries and duplicate webhooks resume
 * where the previous attempt stopped instead of redoing (or duplicating) work.
 */
export async function processCall(deps: PipelineDeps, job: ProcessCallJob, attempt: AttemptInfo): Promise<ProcessOutcome> {
  const claimed = await deps.calls.claimForProcessing(job.callId, job.transcriptId);
  if (!claimed) {
    deps.logger.info({ callId: job.callId, trigger: job.trigger }, 'nothing to process (already archived or not awaiting processing)');
    return 'skipped';
  }

  const tracker: { stage: PipelineStage } = { stage: 'TRANSCRIPTION' };
  try {
    await runStages(deps, claimed, job.transcriptId, tracker);
    return 'completed';
  } catch (error) {
    const failure =
      error instanceof PipelineError
        ? error
        : new PipelineError(tracker.stage, STAGE_MESSAGES[tracker.stage], true, { cause: error });
    const isFinal = !failure.retryable || attempt.attempt >= attempt.maxAttempts;
    deps.logger.warn(
      { callId: claimed.id, stage: failure.stage, attempt: attempt.attempt, final: isFinal, err: describeError(error) },
      'processing attempt failed',
    );
    if (!isFinal) throw failure;
    await markCallFailed(deps, claimed, failure.stage, failure.userMessage, error);
    return 'failed';
  }
}

async function runStages(
  deps: PipelineDeps,
  initial: CallRecord,
  transcriptId: string,
  tracker: { stage: PipelineStage },
): Promise<void> {
  let call = initial;
  const orgId = call.organization_id;
  const recorded = await deps.audit.recordedTypes(orgId, call.id);
  const once = async (type: AuditEventType, metadata: Record<string, unknown>) => {
    if (recorded.has(type)) return;
    await deps.audit.record({ orgId, callId: call.id, type, metadata });
    recorded.add(type);
  };

  let transcript: SafeTranscript | null = null;
  const loadTranscript = async (): Promise<SafeTranscript> => {
    if (transcript) return transcript;
    const result = await deps.transcription.getTranscript(transcriptId);
    if (result.status === 'error') {
      throw new PipelineError('TRANSCRIPTION', friendlyTranscriptionError(result.error), false);
    }
    if (result.status !== 'completed') {
      throw new PipelineError('TRANSCRIPTION', 'AssemblyAI is still transcribing this call.', true);
    }
    transcript = result.transcript;
    return transcript;
  };

  // 1. Transcription + speaker separation --------------------------------
  tracker.stage = 'TRANSCRIPTION';
  if (!call.transcription_completed_at) {
    const t = await loadTranscript();
    call = await deps.calls.update(call.id, {
      transcription_completed_at: nowIso(deps),
      detected_language: t.languageCode,
      duration_seconds: t.audioDurationSeconds,
      speech_model_used: t.speechModelUsed,
      speakers_count: t.speakers.length,
    });
  }
  await once('TRANSCRIPTION_COMPLETED', {
    transcript_id: transcriptId,
    speech_model: call.speech_model_used,
    language: call.detected_language,
    duration_seconds: call.duration_seconds,
  });
  await once('SPEAKERS_SEPARATED', { speakers: call.speakers_count ?? 0 });

  // 2. PII detection & transcript redaction (done by AssemblyAI; verified here)
  tracker.stage = 'PII_REDACTION';
  if (call.redacted_transcript === null) {
    const t = await loadTranscript();
    const counts = countPiiMarkers(t.text);
    const { total, types } = summarizePii(counts);
    await deps.calls.replaceUtterances(call.id, t.utterances);
    call = await deps.calls.update(call.id, {
      redacted_transcript: t.text,
      pii_counts: counts,
      pii_total: total,
      pii_types: types,
    });
  }
  await once('PII_DETECTION_COMPLETED', {
    entities_detected: call.pii_total,
    entity_types: call.pii_types,
    counts: call.pii_counts,
    policies_applied: call.pii_policies.length,
  });
  await once('TRANSCRIPT_REDACTED', {
    substitution: 'entity_name',
    markers_replaced: countRedactionMarkers(call.redacted_transcript),
  });
  await once('SAFE_TRANSCRIPT_STORED', {
    characters: call.redacted_transcript?.length ?? 0,
    speakers: call.speakers_count ?? 0,
  });

  // 3. Redacted audio → private storage ----------------------------------
  if (!call.safe_audio_path) {
    tracker.stage = 'AUDIO_REDACTION';
    const format = deps.config.assemblyai.redactedAudioFormat;
    const url = await waitForRedactedAudio(deps, transcriptId);
    const audio = await deps.transcription.downloadRedactedAudio(url, deps.config.maxUploadBytes * 4);
    await once('AUDIO_REDACTED', { method: 'silence', format, bytes: audio.byteLength });

    tracker.stage = 'STORAGE';
    const objectPath = buildSafeAudioPath(orgId, call.id, call.created_at, format);
    await deps.storage.upload(objectPath, audio, AUDIO_CONTENT_TYPES[format]);
    call = await deps.calls.update(call.id, { safe_audio_path: objectPath, safe_audio_format: format });
  }
  await once('AUDIO_REDACTED', { method: 'silence', format: call.safe_audio_format });
  await once('SAFE_AUDIO_STORED', {
    bucket: deps.config.supabase.audioBucket,
    object_path: call.safe_audio_path,
    format: call.safe_audio_format,
    visibility: 'private',
  });

  // 4. AI analysis — input is rebuilt from the archived REDACTED utterances --
  tracker.stage = 'AI_ANALYSIS';
  if (!call.analysis_enabled) {
    await once('AI_ANALYSIS_SKIPPED', { reason: 'disabled_for_call' });
  } else if (!call.redacted_transcript?.trim()) {
    await once('AI_ANALYSIS_SKIPPED', { reason: 'no_speech_detected' });
  } else {
    let meta: Record<string, unknown> = { model: call.ai_summary?.model ?? null };
    if (!call.ai_summary) {
      const safeInput = speakerTranscriptFromArchive(await deps.calls.listUtterances(call.id));
      try {
        const result = await deps.analysis.analyze(safeInput);
        call = await deps.calls.update(call.id, {
          ai_summary: { ...result.analysis, model: result.meta.model, generated_at: nowIso(deps) },
          sentiment: result.analysis.sentiment,
          topics: result.analysis.topics,
        });
        meta = {
          model: result.meta.model,
          request_id: result.meta.requestId,
          input_tokens: result.meta.inputTokens,
          output_tokens: result.meta.outputTokens,
          structured_output: result.meta.outputMode,
        };
      } catch (error) {
        if (error instanceof AnalysisValidationError) {
          throw new PipelineError('AI_ANALYSIS', 'The AI analysis response was invalid. Retry to run it again.', true, {
            cause: error,
          });
        }
        throw error;
      }
    }
    await once('AI_ANALYSIS_COMPLETED', { ...meta, input: 'redacted_transcript' });
  }

  // 5. Cleanup at AssemblyAI (best effort), then finalize ----------------
  tracker.stage = 'ARCHIVE';
  if (deps.config.assemblyai.deleteAfterArchive && !call.original_deleted_at) {
    try {
      await deps.transcription.deleteTranscript(transcriptId);
      call = await deps.calls.update(call.id, { original_deleted_at: nowIso(deps) });
      await once('ASSEMBLYAI_DATA_DELETED', { transcript_id: transcriptId, scope: 'transcript' });
    } catch (error) {
      deps.logger.warn(
        { callId: call.id, err: describeError(error) },
        'could not delete transcript at AssemblyAI; it will expire under the account retention policy',
      );
    }
  }

  const processedAt = nowIso(deps);
  call = await deps.calls.update(call.id, {
    status: 'COMPLETED',
    processed_at: processedAt,
    failed_stage: null,
    error_message: null,
  });
  await once('ARCHIVE_CREATED', {
    pii_entities_protected: call.pii_total,
    safe_audio: Boolean(call.safe_audio_path),
    ai_analysis: Boolean(call.ai_summary),
    processing_seconds: Math.max(0, Math.round((Date.parse(processedAt) - Date.parse(call.created_at)) / 1000)),
  });

  // 6. Second opinion on the redaction. Anything AssemblyAI left in the
  //    transcript is redacted again, in the text and in the audio. Best effort:
  //    the archive is already complete, so a failure here never fails the call.
  try {
    const recheck = await recheckRedaction(deps, call);
    if (recheck.found > 0) deps.logger.info({ callId: call.id, ...recheck }, 'redaction rechecked after archiving');
  } catch (error) {
    deps.logger.warn({ callId: call.id, err: describeError(error) }, 'redaction recheck failed');
  }
}

async function waitForRedactedAudio(deps: PipelineDeps, transcriptId: string): Promise<string> {
  for (const delay of REDACTED_AUDIO_WAIT_MS) {
    if (delay > 0) await sleepFor(deps, delay);
    const result = await deps.transcription.getRedactedAudio(transcriptId);
    if (result.status === 'ready') return result.url;
  }
  throw new PipelineError(
    'AUDIO_REDACTION',
    'AssemblyAI has not finished generating the redacted audio yet. Retry in a minute.',
    true,
  );
}
