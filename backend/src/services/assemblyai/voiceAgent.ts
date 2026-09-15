import { writeFile } from 'node:fs/promises';

/**
 * AssemblyAI Voice Agent API, REST side (verified against the docs 2026-09-15):
 * - GET    /v1/token?expires_in_seconds&max_session_duration_seconds (Bearer key) → single-use token
 * - GET    /v1/sessions/{id} → status, the config the session ran with, and once
 *          it has ended: a stereo OGG/Opus recording (caller left, agent right),
 *          the conversation timeline and metadata, as short-lived pre-signed URLs
 * - DELETE /v1/sessions/{id} → 204; the session and its artifacts become inaccessible
 * The browser opens the WebSocket itself with the token, so live audio never
 * passes through SafeCall's servers.
 */
export const VOICE_AGENT_API_URL = 'https://agents.assemblyai.com';
export const VOICE_AGENT_WS_URL = 'wss://agents.assemblyai.com/v1/ws';

export interface VoiceSession {
  id: string;
  status: string;
  durationSeconds: number | null;
  /** The system prompt the session ran with; identifies the organization that started it. */
  systemPrompt: string | null;
  /** Pre-signed recording URL. Null until the session has ended. */
  recordingUrl: string | null;
}

export interface VoiceAgentService {
  createToken(options: { expiresInSeconds: number; maxSessionSeconds: number }): Promise<string>;
  /** Null when the session doesn't exist or was already deleted. */
  getSession(sessionId: string): Promise<VoiceSession | null>;
  /** Saves the recording to a local file and returns its size in bytes. */
  downloadRecording(url: string, filePath: string, maxBytes: number): Promise<number>;
  deleteSession(sessionId: string): Promise<void>;
}

interface SessionResponse {
  id?: string;
  status?: string;
  duration_seconds?: number | null;
  config?: { system_prompt?: unknown } | null;
  artifacts?: Array<{ type?: string; url?: string }>;
}

const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });

export class AssemblyAIVoiceAgentService implements VoiceAgentService {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch }) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? VOICE_AGENT_API_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private get headers() {
    return { authorization: `Bearer ${this.apiKey}` };
  }

  async createToken({ expiresInSeconds, maxSessionSeconds }: { expiresInSeconds: number; maxSessionSeconds: number }): Promise<string> {
    const url = new URL(`${this.baseUrl}/v1/token`);
    url.searchParams.set('expires_in_seconds', String(expiresInSeconds));
    url.searchParams.set('max_session_duration_seconds', String(maxSessionSeconds));
    const response = await this.fetchImpl(url, { headers: this.headers, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw httpError(`Voice Agent token request failed with HTTP ${response.status}`, response.status);
    const body = (await response.json()) as { token?: unknown };
    if (typeof body.token !== 'string' || body.token === '') throw new Error('The Voice Agent token response had no token.');
    return body.token;
  }

  async getSession(sessionId: string): Promise<VoiceSession | null> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}`, {
      headers: this.headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw httpError(`Voice Agent session lookup failed with HTTP ${response.status}`, response.status);
    const body = (await response.json()) as SessionResponse;
    const prompt = body.config?.system_prompt;
    const recording = body.artifacts?.find((artifact) => artifact.type === 'audio' && typeof artifact.url === 'string');
    return {
      id: body.id ?? sessionId,
      status: body.status ?? 'unknown',
      durationSeconds: typeof body.duration_seconds === 'number' ? body.duration_seconds : null,
      systemPrompt: typeof prompt === 'string' ? prompt : null,
      recordingUrl: recording?.url ?? null,
    };
  }

  async downloadRecording(url: string, filePath: string, maxBytes: number): Promise<number> {
    // Pre-signed URL: the signature authorizes the request, so no API key is sent.
    const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw httpError(`Recording download failed with HTTP ${response.status}`, response.status);
    if (Number(response.headers.get('content-length') ?? 0) > maxBytes) throw new Error('The recording is larger than the upload limit.');
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > maxBytes) throw new Error('The recording is larger than the upload limit.');
    await writeFile(filePath, data, { mode: 0o600 });
    return data.length;
  }

  async deleteSession(sessionId: string): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      headers: this.headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok && response.status !== 404) {
      throw httpError(`Voice Agent session delete failed with HTTP ${response.status}`, response.status);
    }
  }
}
