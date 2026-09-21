import type { LiveAgentSession } from '../services/types';
import { createNorthwindBackOffice, type AgentAction, type EscalationReason } from './northwindTools';

/**
 * Browser side of AssemblyAI's Voice Agent API (docs verified 2026-09-15).
 * Audio is PCM16 mono at 24 kHz, base64-encoded, over the WebSocket.
 * - `input.audio` is only sent after `session.ready`.
 * - Barge-in: queued playback is flushed when `reply.done` reports "interrupted".
 * - `tool.result` goes out as soon as no reply is being generated (see sendToolResults).
 * - `session.end` is sent before closing, so the 30-second resume window isn't billed.
 * The AudioContext runs at the device rate and the capture worklet resamples to
 * 24 kHz: a forced 24 kHz context loses echo cancellation in Firefox and is
 * ignored by Safari. Transcript events are deliberately not surfaced, because
 * they contain unredacted speech.
 */

const RATE = 24_000;
const CHUNK_SAMPLES = 1_200; // 50 ms of audio per input.audio message
/** Last resort for a tool result the reply.done handler never got to send. */
const TOOL_RESULT_DEADLINE_MS = 6_000;

export interface SpeakingState {
  caller: boolean;
  agent: boolean;
}

export interface LiveCallEvents {
  onLive(): void;
  onSpeaking(state: SpeakingState): void;
  onAction(action: AgentAction): void;
  onLevel(level: number): void;
  onError(message: string): void;
}

const CAPTURE_WORKLET = `
class SafeCallPcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.step = o.inputSampleRate / o.targetSampleRate;
    this.size = o.chunkSamples;
    this.chunk = new Int16Array(this.size);
    this.filled = 0;
    this.offset = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    let pos = this.offset;
    while (pos < input.length) {
      const i = Math.floor(pos);
      const a = input[i];
      const b = i + 1 < input.length ? input[i + 1] : a;
      const s = Math.max(-1, Math.min(1, a + (b - a) * (pos - i)));
      this.chunk[this.filled++] = Math.round(s * 32767);
      if (this.filled === this.size) {
        // Transferring the buffer detaches it and its length reads 0 afterwards,
        // so the next chunk is sized from this.size, never from the old array.
        this.port.postMessage(this.chunk.buffer, [this.chunk.buffer]);
        this.chunk = new Int16Array(this.size);
        this.filled = 0;
      }
      pos += this.step;
    }
    this.offset = pos - input.length;
    return true;
  }
}
registerProcessor('safecall-pcm-capture', SafeCallPcmCapture);
`;

const FATAL_ERRORS: Record<string, string> = {
  UNAUTHORIZED: 'The call could not be authorized. Start it again.',
  unauthorized: 'The call could not be authorized. Start it again.',
  FORBIDDEN: 'This AssemblyAI account cannot use the Voice Agent API.',
  server_error: 'The voice agent stopped unexpectedly. Try again in a minute.',
  INTERNAL_ERROR: 'The voice agent stopped unexpectedly. Try again.',
  internal_error: 'The voice agent stopped unexpectedly. Try again.',
  agent_init_failed: 'The voice agent could not start. Try again.',
  agent_timeout: 'The voice agent took too long to start. Try again.',
  at_capacity: 'The voice agent is busy right now. Try again in a minute.',
  concurrency_exceeded: 'Another live call is already running on this account. End it and try again.',
  session_expired: 'The call reached its time limit.',
};

export function micErrorMessage(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone access was blocked. Allow the microphone for this site, then start the call again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found. Connect one and try again.';
  if (name === 'NotReadableError') return 'The microphone is being used by another app. Close it and try again.';
  return 'The microphone could not be started.';
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function decodePcm16(base64: string) {
  const binary = atob(base64);
  const samples = new Float32Array(binary.length >> 1);
  for (let i = 0; i < samples.length; i += 1) {
    const value = binary.charCodeAt(2 * i) | (binary.charCodeAt(2 * i + 1) << 8);
    samples[i] = (value >= 0x8000 ? value - 0x10000 : value) / 0x8000;
  }
  return samples;
}

/** One live call with "Sam". Create a new instance per call. */
export class LiveAgentCall {
  /** Set once AssemblyAI confirms the session; needed to archive the call. */
  sessionId: string | null = null;
  /** Set when the agent hands the call to a person; sent with the archive request. */
  escalation: EscalationReason | null = null;
  /** Resolves when the call is over, with the session id to archive (null if it never started). */
  readonly finished: Promise<string | null>;

  private readonly events: LiveCallEvents;
  private readonly runTool = createNorthwindBackOffice();
  private resolveFinished: (sessionId: string | null) => void = () => undefined;
  private done = false;
  private ready = false;
  private ws: WebSocket | null = null;
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private workletUrl: string | null = null;
  // The capture nodes must stay referenced for the whole call. Nodes that only the
  // audio graph points to get garbage-collected, and with them the worklet's
  // message port, which silently stops the microphone stream.
  private mic: MediaStreamAudioSourceNode | null = null;
  private capture: AudioWorkletNode | null = null;
  private agentOut: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private levelTimer: number | null = null;
  private hangupTimer: number | null = null;
  private readonly playing = new Set<AudioBufferSourceNode>();
  private nextStartTime = 0;
  private replyInFlight = false;
  private pendingResults: Array<{ call_id: string; result: string; is_error: boolean }> = [];
  private toolTimer: number | null = null;
  private speaking: SpeakingState = { caller: false, agent: false };
  private fatalMessage: string | null = null;
  private actionCount = 0;

  constructor(events: LiveCallEvents) {
    this.events = events;
    this.finished = new Promise((resolve) => {
      this.resolveFinished = resolve;
    });
  }

  get ended(): boolean {
    return this.done;
  }

  /** Starts audio and asks for the microphone. Call it straight from a click handler. */
  async openMicrophone(): Promise<void> {
    const context = new AudioContext();
    this.context = context;
    await context.resume();
    const stream = await navigator.mediaDevices.getUserMedia({
      // Echo cancellation stops the agent hearing itself; the server already denoises.
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true },
    });
    if (this.done) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error('The call was cancelled.');
    }
    this.stream = stream;
  }

  /** Wires capture and playback, then opens the Voice Agent WebSocket with the single-use token. */
  async connect(session: LiveAgentSession): Promise<void> {
    const context = this.context;
    const stream = this.stream;
    if (!context || !stream) throw new Error('Open the microphone first.');

    this.workletUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'text/javascript' }));
    await context.audioWorklet.addModule(this.workletUrl);
    if (this.done) throw new Error('The call was cancelled.');

    const mic = context.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(context, 'safecall-pcm-capture', {
      processorOptions: { inputSampleRate: context.sampleRate, targetSampleRate: RATE, chunkSamples: CHUNK_SAMPLES },
    });
    this.mic = mic;
    this.capture = capture;
    capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      const ws = this.ws;
      if (this.ready && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input.audio', audio: toBase64(event.data) }));
      }
    };
    capture.onprocessorerror = () => {
      this.fatalMessage = 'The microphone stopped working. Start the call again.';
      this.dispose();
    };
    mic.connect(capture);
    // The worklet outputs silence; connecting it keeps the browser running it.
    capture.connect(context.destination);

    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 512;
    mic.connect(this.analyser);
    this.agentOut = context.createGain();
    this.agentOut.connect(context.destination);
    this.startLevelMeter();

    const url = new URL(session.websocket_url);
    url.searchParams.set('token', session.token);
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'session.update', session: session.session }));
    ws.onmessage = (event) => this.handle(event.data);
    ws.onclose = () =>
      this.finish(this.fatalMessage ?? (this.sessionId ? null : 'The connection to the voice agent closed before the call started.'));
  }

  /** Ends the call cleanly: `session.end`, then wait briefly for `session.ended`. */
  hangUp() {
    if (this.done || this.hangupTimer !== null) return;
    if (!this.sendEnd()) {
      this.finish();
      return;
    }
    this.hangupTimer = window.setTimeout(() => this.finish(), 4_000);
  }

  /** Immediate teardown, for cancelling or leaving the page. */
  dispose() {
    this.sendEnd();
    this.finish(this.fatalMessage);
  }

  private sendEnd(): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: 'session.end' }));
    return true;
  }

  private handle(raw: unknown) {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(String(raw)) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (message.type) {
      case 'session.ready':
        this.ready = true;
        this.sessionId = typeof message.session_id === 'string' ? message.session_id : null;
        this.events.onLive();
        break;
      case 'input.speech.started':
        this.setSpeaking({ caller: true });
        break;
      case 'input.speech.stopped':
        this.setSpeaking({ caller: false });
        break;
      case 'reply.started':
        this.replyInFlight = true;
        break;
      case 'reply.audio':
        if (typeof message.data === 'string') this.play(message.data);
        break;
      case 'reply.done':
        this.replyInFlight = false;
        if (message.status === 'interrupted') {
          this.flushPlayback();
          this.dropPendingResults();
        } else {
          this.sendToolResults();
        }
        break;
      case 'tool.call':
        this.runToolCall(message);
        break;
      case 'session.error': {
        const code = typeof message.code === 'string' ? message.code : '';
        const fatal = FATAL_ERRORS[code];
        if (fatal) this.fatalMessage = fatal;
        else console.warn('Voice agent error:', code);
        break;
      }
      case 'session.ended':
        this.finish(this.fatalMessage);
        break;
      default:
        // transcript.* events are ignored on purpose: they hold unredacted speech.
        break;
    }
  }

  private runToolCall(message: Record<string, unknown>) {
    const args = message.arguments && typeof message.arguments === 'object' ? (message.arguments as Record<string, unknown>) : {};
    const outcome = this.runTool(String(message.name ?? ''), args);
    if (outcome.escalation) this.escalation = outcome.escalation;
    this.actionCount += 1;
    this.events.onAction({ ...outcome.action, id: this.actionCount, at: new Date() });
    this.pendingResults.push({ call_id: String(message.call_id ?? ''), result: JSON.stringify(outcome.result), is_error: outcome.isError });
    this.sendToolResults();
    // A reply that never reports done would strand the result and leave the
    // agent waiting in silence, so send it anyway after a long pause.
    if (this.pendingResults.length > 0 && this.toolTimer === null) {
      this.toolTimer = window.setTimeout(() => {
        this.toolTimer = null;
        this.replyInFlight = false;
        this.sendToolResults();
      }, TOOL_RESULT_DEADLINE_MS);
    }
  }

  /**
   * The docs say to send a tool result "when reply.done is the latest event".
   * What that guards against is answering in the middle of a reply, so the gate
   * here is "no reply is being generated" rather than "nothing at all has
   * happened since". Any sound while a tool runs — a cough, a "hello?" — raises
   * input.speech.started, and treating that as a reason to hold the result left
   * the agent waiting for something that never came: silent until the caller
   * prompted it again.
   */
  private sendToolResults() {
    const ws = this.ws;
    if (this.replyInFlight || this.pendingResults.length === 0 || !ws || ws.readyState !== WebSocket.OPEN) return;
    const results = this.pendingResults;
    this.dropPendingResults();
    for (const result of results) ws.send(JSON.stringify({ type: 'tool.result', ...result }));
  }

  private dropPendingResults() {
    this.pendingResults = [];
    if (this.toolTimer !== null) window.clearTimeout(this.toolTimer);
    this.toolTimer = null;
  }

  private play(base64: string) {
    const context = this.context;
    const out = this.agentOut;
    if (!context || !out) return;
    const samples = decodePcm16(base64);
    if (samples.length === 0) return;
    const buffer = context.createBuffer(1, samples.length, RATE);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(out);
    const startAt = Math.max(context.currentTime, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;
    this.playing.add(source);
    this.setSpeaking({ agent: true });
    source.onended = () => {
      this.playing.delete(source);
      if (this.playing.size === 0) this.setSpeaking({ agent: false });
    };
  }

  private flushPlayback() {
    for (const source of this.playing) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
      source.disconnect();
    }
    this.playing.clear();
    this.nextStartTime = this.context?.currentTime ?? 0;
    this.setSpeaking({ agent: false });
  }

  private startLevelMeter() {
    const analyser = this.analyser;
    if (!analyser) return;
    const samples = new Uint8Array(analyser.fftSize);
    this.levelTimer = window.setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
      this.events.onLevel(Math.min(1, Math.sqrt(sum / samples.length) * 4));
    }, 100);
  }

  private setSpeaking(change: Partial<SpeakingState>) {
    const next = { ...this.speaking, ...change };
    if (next.caller === this.speaking.caller && next.agent === this.speaking.agent) return;
    this.speaking = next;
    this.events.onSpeaking(next);
  }

  private finish(message: string | null = null) {
    if (this.done) return;
    this.done = true;
    if (message) this.events.onError(message);
    this.teardown();
    this.resolveFinished(this.sessionId);
  }

  private teardown() {
    if (this.hangupTimer !== null) window.clearTimeout(this.hangupTimer);
    if (this.levelTimer !== null) window.clearInterval(this.levelTimer);
    this.hangupTimer = null;
    this.levelTimer = null;
    this.ready = false;
    this.dropPendingResults();
    this.flushPlayback();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) ws.close();
    }
    if (this.capture) {
      this.capture.port.onmessage = null;
      this.capture.onprocessorerror = null;
      this.capture.port.close();
      this.capture.disconnect();
    }
    this.mic?.disconnect();
    this.capture = null;
    this.mic = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    const context = this.context;
    this.context = null;
    this.agentOut = null;
    this.analyser = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
    if (this.workletUrl) URL.revokeObjectURL(this.workletUrl);
    this.workletUrl = null;
    this.setSpeaking({ caller: false, agent: false });
    this.events.onLevel(0);
  }
}
