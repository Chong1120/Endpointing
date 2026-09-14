import { AssemblyAI, type Transcript, type TranscriptParams } from 'assemblyai';
import type { Utterance } from '../../domain/types.js';
import { PipelineError } from '../../errors.js';
import type { PiiPolicyName } from './policies.js';
import { safeTextFromRedactedTranscript, type SafeTranscript } from './safeTranscript.js';

/**
 * Speech models in priority order (AssemblyAI treats this as a fallback list).
 * Verified against the pre-recorded API reference on 2026-09-14.
 */
export const SPEECH_MODELS = ['universal-3-5-pro', 'universal-2'] as const;

/** Header AssemblyAI echoes back on webhook deliveries so we can authenticate them. */
export const WEBHOOK_AUTH_HEADER = 'X-SafeCall-Webhook-Secret';

/**
 * `redact_pii_audio_options` is documented in the API reference but not yet in
 * the SDK 4.41 typings. `transcripts.submit()` forwards params verbatim, so we
 * extend the type locally instead of dropping to raw HTTP.
 */
interface RedactPiiAudioOptions {
  override_audio_redaction_method?: 'silence';
  return_redacted_no_speech_audio?: boolean;
}
export type SafeCallTranscriptParams = TranscriptParams & { redact_pii_audio_options?: RedactPiiAudioOptions };

export interface SubmitRequest {
  audioUrl: string;
  policies: PiiPolicyName[];
  redactedAudioFormat: 'mp3' | 'wav';
  webhook: { url: string; secret: string } | null;
}

export type TranscriptResult =
  | { status: 'queued' | 'processing' }
  | { status: 'error'; error: string }
  | { status: 'completed'; transcript: SafeTranscript };

export type RedactedAudioResult = { status: 'ready'; url: string } | { status: 'pending'; detail: string };

export interface TranscriptionService {
  /** Uploads a local file to AssemblyAI and returns its private upload URL. */
  uploadFile(filePath: string): Promise<string>;
  submit(request: SubmitRequest): Promise<{ id: string; status: string }>;
  /** Status only — used by the dev fallback and the stuck-call sweeper. */
  getTranscriptStatus(id: string): Promise<'queued' | 'processing' | 'completed' | 'error'>;
  getTranscript(id: string): Promise<TranscriptResult>;
  getRedactedAudio(id: string): Promise<RedactedAudioResult>;
  downloadRedactedAudio(url: string, maxBytes: number): Promise<Buffer>;
  deleteTranscript(id: string): Promise<void>;
}

/**
 * Builds the transcription request. PII redaction is always on, markers use
 * entity names (e.g. `[PHONE_NUMBER]`) so they can be counted, redacted audio
 * uses silence, and `redact_pii_return_unredacted` is never requested.
 */
export function buildTranscriptParams(request: SubmitRequest): SafeCallTranscriptParams {
  if (request.policies.length === 0) {
    throw new PipelineError('PII_REDACTION', 'At least one PII policy is required.', false);
  }
  return {
    audio_url: request.audioUrl,
    speech_models: [...SPEECH_MODELS],
    speaker_labels: true,
    language_detection: true,
    punctuate: true,
    format_text: true,
    redact_pii: true,
    redact_pii_policies: request.policies as TranscriptParams['redact_pii_policies'],
    redact_pii_sub: 'entity_name',
    redact_pii_audio: true,
    redact_pii_audio_quality: request.redactedAudioFormat,
    redact_pii_audio_options: {
      override_audio_redaction_method: 'silence',
      return_redacted_no_speech_audio: true,
    },
    ...(request.webhook
      ? {
          webhook_url: request.webhook.url,
          webhook_auth_header_name: WEBHOOK_AUTH_HEADER,
          webhook_auth_header_value: request.webhook.secret,
        }
      : {}),
  };
}

/**
 * Reduces an AssemblyAI transcript to safe fields. Refuses transcripts where
 * PII redaction was not applied so unredacted text can never be archived.
 */
export function toSafeTranscript(raw: Transcript): SafeTranscript {
  if (raw.redact_pii !== true) {
    throw new PipelineError(
      'PII_REDACTION',
      'AssemblyAI returned a transcript without PII redaction, so it was not archived.',
      false,
    );
  }

  const text = raw.text ?? '';
  const rawUtterances = raw.utterances ?? [];
  const utterances: Utterance[] =
    rawUtterances.length > 0
      ? rawUtterances.map((u, index) => ({
          seq: index,
          speaker: String(u.speaker ?? 'A'),
          start_ms: Math.max(0, Math.round(u.start ?? 0)),
          end_ms: Math.max(0, Math.round(u.end ?? 0)),
          text: u.text ?? '',
        }))
      : text
        ? [{ seq: 0, speaker: 'A', start_ms: 0, end_ms: Math.round((raw.audio_duration ?? 0) * 1000), text }]
        : [];

  const extra = raw as unknown as Record<string, unknown>;
  const speechModelUsed =
    typeof extra.speech_model_used === 'string'
      ? extra.speech_model_used
      : typeof raw.speech_model === 'string'
        ? raw.speech_model
        : null;

  return {
    id: raw.id,
    text: safeTextFromRedactedTranscript(text),
    utterances,
    speakers: [...new Set(utterances.map((u) => u.speaker))].sort(),
    audioDurationSeconds: typeof raw.audio_duration === 'number' ? raw.audio_duration : null,
    languageCode: typeof raw.language_code === 'string' ? raw.language_code : null,
    speechModelUsed,
  };
}

export class AssemblyAITranscriptionService implements TranscriptionService {
  private readonly client: AssemblyAI;

  constructor(options: { apiKey: string; baseUrl: string }) {
    this.client = new AssemblyAI({ apiKey: options.apiKey, baseUrl: options.baseUrl });
  }

  async uploadFile(filePath: string): Promise<string> {
    return this.client.files.upload(filePath);
  }

  async submit(request: SubmitRequest): Promise<{ id: string; status: string }> {
    const transcript = await this.client.transcripts.submit(buildTranscriptParams(request));
    return { id: transcript.id, status: transcript.status };
  }

  async getTranscriptStatus(id: string): Promise<'queued' | 'processing' | 'completed' | 'error'> {
    const { status } = await this.client.transcripts.get(id);
    return status === 'queued' || status === 'processing' || status === 'completed' ? status : 'error';
  }

  async getTranscript(id: string): Promise<TranscriptResult> {
    const raw = await this.client.transcripts.get(id);
    switch (raw.status) {
      case 'queued':
      case 'processing':
        return { status: raw.status };
      case 'error':
        return { status: 'error', error: raw.error ?? 'Transcription failed.' };
      case 'completed':
        return { status: 'completed', transcript: toSafeTranscript(raw) };
      default:
        return { status: 'error', error: `Unexpected transcript status: ${String(raw.status)}` };
    }
  }

  async getRedactedAudio(id: string): Promise<RedactedAudioResult> {
    try {
      const response = await this.client.transcripts.redactedAudio(id);
      if (response.status === 'redacted_audio_ready' && response.redacted_audio_url) {
        return { status: 'ready', url: response.redacted_audio_url };
      }
      return { status: 'pending', detail: String(response.status) };
    } catch (error) {
      // The endpoint errors until the redacted file has been generated.
      return { status: 'pending', detail: error instanceof Error ? error.message : 'not ready' };
    }
  }

  async downloadRedactedAudio(url: string, maxBytes: number): Promise<Buffer> {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) {
      throw Object.assign(new Error(`Redacted audio download failed with HTTP ${response.status}`), {
        status: response.status,
      });
    }
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > maxBytes) {
      throw new PipelineError('AUDIO_REDACTION', 'The redacted audio file is larger than the allowed size.', false);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0) {
      throw new PipelineError('AUDIO_REDACTION', 'AssemblyAI returned an empty redacted audio file.', true);
    }
    return buffer;
  }

  async deleteTranscript(id: string): Promise<void> {
    await this.client.transcripts.delete(id);
  }
}
