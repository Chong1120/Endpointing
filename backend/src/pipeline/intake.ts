import { rm } from 'node:fs/promises';
import type { AuthContext, CallRecord, PolicyPreset } from '../domain/types.js';
import type { PiiPolicyName } from '../services/assemblyai/policies.js';
import { SPEECH_MODELS } from '../services/assemblyai/transcription.js';
import { nowIso, type PipelineDeps } from './deps.js';
import { describeError, markCallFailed, retryTransient } from './failures.js';

export interface IntakeRequest {
  auth: AuthContext;
  /** Raw recording in temporary storage. Always deleted by intake. */
  tempFilePath: string;
  originalFilename: string;
  sizeBytes: number;
  department: string;
  preset: PolicyPreset;
  policies: PiiPolicyName[];
  analysisEnabled: boolean;
  source: 'upload' | 'sample';
}

export async function removeTempFile(filePath: string, deps: Pick<PipelineDeps, 'logger'>): Promise<boolean> {
  try {
    await rm(filePath, { force: true });
    return true;
  } catch (error) {
    deps.logger.error({ err: describeError(error) }, 'failed to delete temporary upload');
    return false;
  }
}

/**
 * Receives a raw recording and hands it to AssemblyAI:
 *   create call → upload to AssemblyAI → delete temp file → submit redacted
 *   transcription (webhook or status-check fallback).
 * The raw file never reaches permanent storage.
 */
export async function intakeCall(deps: PipelineDeps, request: IntakeRequest): Promise<CallRecord> {
  const { auth } = request;
  let call: CallRecord;
  try {
    call = await deps.calls.create({
      organization_id: auth.orgId,
      created_by: auth.userId,
      original_filename: request.originalFilename,
      department: request.department,
      source: request.source,
      policy_preset: request.preset,
      pii_policies: request.policies,
      analysis_enabled: request.analysisEnabled,
    });
  } catch (error) {
    await removeTempFile(request.tempFilePath, deps);
    throw error;
  }

  await deps.audit.record({
    orgId: auth.orgId,
    callId: call.id,
    type: 'CALL_RECEIVED',
    actorId: auth.userId,
    metadata: {
      size_bytes: request.sizeBytes,
      department: request.department,
      policy_preset: request.preset,
      ai_analysis: request.analysisEnabled,
      source: request.source,
    },
  });

  let uploadUrl: string | null = null;
  let uploadError: unknown = null;
  try {
    uploadUrl = await retryTransient(() => deps.transcription.uploadFile(request.tempFilePath), deps);
  } catch (error) {
    uploadError = error;
  }

  if (await removeTempFile(request.tempFilePath, deps)) {
    await deps.audit.record({
      orgId: auth.orgId,
      callId: call.id,
      type: 'RAW_UPLOAD_DELETED',
      metadata: { location: 'api_temporary_storage', size_bytes: request.sizeBytes, sent_to_assemblyai: uploadError === null },
    });
  }

  if (uploadError !== null || !uploadUrl) {
    return markCallFailed(
      deps,
      call,
      'UPLOAD',
      'The recording could not be sent to AssemblyAI. Please upload it again.',
      uploadError,
    );
  }

  const webhook =
    deps.config.webhooksEnabled && deps.config.publicApiUrl
      ? {
          url: `${deps.config.publicApiUrl}/webhooks/assemblyai?call_id=${encodeURIComponent(call.id)}`,
          secret: deps.config.assemblyai.webhookSecret,
        }
      : null;

  let transcriptId: string;
  try {
    const submitted = await retryTransient(
      () =>
        deps.transcription.submit({
          audioUrl: uploadUrl,
          policies: request.policies,
          redactedAudioFormat: deps.config.assemblyai.redactedAudioFormat,
          webhook,
        }),
      deps,
    );
    transcriptId = submitted.id;
  } catch (error) {
    return markCallFailed(
      deps,
      call,
      'TRANSCRIPTION',
      'AssemblyAI did not accept the transcription request. Please upload the recording again.',
      error,
    );
  }

  call = await deps.calls.update(call.id, {
    status: 'TRANSCRIBING',
    assemblyai_transcript_id: transcriptId,
    submitted_at: nowIso(deps),
  });

  await deps.audit.record({
    orgId: auth.orgId,
    callId: call.id,
    type: 'TRANSCRIPTION_SUBMITTED',
    metadata: {
      transcript_id: transcriptId,
      speech_models: [...SPEECH_MODELS],
      speaker_labels: true,
      language_detection: true,
      redact_pii_audio: true,
      audio_redaction_method: 'silence',
      pii_policies: request.policies,
      completion_signal: webhook ? 'webhook' : 'status_check',
    },
  });

  if (!webhook) {
    await deps.queue.enqueuePollTranscript({ callId: call.id, transcriptId, attempt: 1 }, 5_000);
  }
  return call;
}
