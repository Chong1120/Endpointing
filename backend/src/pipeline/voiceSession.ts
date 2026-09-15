import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { AuthContext, CallRecord } from '../domain/types.js';
import { badRequest, forbidden, notFound, serviceUnavailable } from '../errors.js';
import type { AppDeps } from '../http/appDeps.js';
import { LIVE_AGENT_DEPARTMENT, sessionBelongsTo } from '../services/assemblyai/liveAgent.js';
import { resolvePolicies } from '../services/assemblyai/policies.js';
import type { VoiceSession } from '../services/assemblyai/voiceAgent.js';
import { nowIso, sleepFor } from './deps.js';
import { describeError } from './failures.js';
import { intakeCall, removeTempFile } from './intake.js';

// AssemblyAI publishes the recording a few seconds after the call ends.
const RECORDING_POLL_MS = 1_500;
const RECORDING_POLL_ATTEMPTS = 24;
const LIVE_AGENT_PRESET = 'CONTACT_CENTER' as const;

async function waitForRecording(deps: AppDeps, auth: AuthContext, sessionId: string): Promise<VoiceSession & { recordingUrl: string }> {
  for (let attempt = 1; ; attempt += 1) {
    const session = await deps.voiceAgent.getSession(sessionId);
    if (!session) throw notFound('This call was not found at AssemblyAI. It may already be archived.');
    if (!sessionBelongsTo(session.systemPrompt, deps.config.assemblyai.webhookSecret, auth.orgId)) {
      throw forbidden('This call was not started from your organization.');
    }
    if (session.recordingUrl) return { ...session, recordingUrl: session.recordingUrl };
    if (attempt >= RECORDING_POLL_ATTEMPTS) {
      throw session.status === 'completed'
        ? badRequest('This call has no recording to archive. It may have been too short.')
        : serviceUnavailable('The recording is not ready yet. Try again in a moment.');
    }
    await sleepFor(deps, RECORDING_POLL_MS);
  }
}

/**
 * Turns a finished live-agent call into a SafeCall call: the session recording
 * goes to a temporary file, then through the normal redaction pipeline (which
 * deletes the file). Once AssemblyAI's transcription has the audio, the voice
 * session is deleted there too, because it holds the unredacted recording and
 * conversation timeline.
 */
export async function archiveVoiceSession(deps: AppDeps, auth: AuthContext, sessionId: string): Promise<CallRecord> {
  const session = await waitForRecording(deps, auth, sessionId);

  const tempFilePath = path.join(deps.config.uploadTmpDir, `live-agent-${randomUUID()}.ogg`);
  let sizeBytes: number;
  try {
    sizeBytes = await deps.voiceAgent.downloadRecording(session.recordingUrl, tempFilePath, deps.config.maxUploadBytes);
  } catch (error) {
    await removeTempFile(tempFilePath, deps);
    deps.logger.error({ err: describeError(error) }, 'live agent recording download failed');
    throw serviceUnavailable('The call recording could not be fetched from AssemblyAI. Try again in a moment.');
  }

  const overrides = await deps.policies.listOverrides(auth.orgId).catch(async (error: unknown) => {
    await removeTempFile(tempFilePath, deps);
    throw error;
  });

  const call = await intakeCall(deps, {
    auth,
    tempFilePath,
    originalFilename: `live-agent-call-${nowIso(deps).slice(0, 16).replace(/[:T]/g, '-')}.ogg`,
    sizeBytes,
    department: LIVE_AGENT_DEPARTMENT,
    preset: LIVE_AGENT_PRESET,
    policies: resolvePolicies(LIVE_AGENT_PRESET, overrides[LIVE_AGENT_PRESET]),
    analysisEnabled: true,
    source: 'upload',
    receivedMetadata: { channel: 'live_agent', voice_session_id: sessionId, call_seconds: session.durationSeconds },
  });

  // Keep the session when the upload failed, so the call can be archived again.
  if (call.assemblyai_transcript_id) {
    try {
      await deps.voiceAgent.deleteSession(sessionId);
      await deps.audit.record({
        orgId: auth.orgId,
        callId: call.id,
        type: 'VOICE_SESSION_DELETED',
        metadata: { voice_session_id: sessionId, location: 'assemblyai_voice_agent' },
      });
    } catch (error) {
      deps.logger.warn({ callId: call.id, err: describeError(error) }, 'could not delete the voice session at AssemblyAI');
    }
  }
  return call;
}
