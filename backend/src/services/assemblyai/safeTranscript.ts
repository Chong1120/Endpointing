import type { SafeText, Utterance } from '../../domain/types.js';

/**
 * A completed AssemblyAI transcript reduced to the fields SafeCall is allowed
 * to keep. It is only ever built from a response where `redact_pii` was
 * applied, and it never carries `unredacted_*` fields.
 */
export interface SafeTranscript {
  id: string;
  /** Full redacted transcript text. */
  text: SafeText;
  /** Speaker-separated redacted utterances. */
  utterances: Utterance[];
  speakers: string[];
  audioDurationSeconds: number | null;
  languageCode: string | null;
  speechModelUsed: string | null;
}

// The only two ways to obtain SafeText. Both are fed exclusively from
// redacted sources: a verified AssemblyAI redacted transcript, or SafeCall's
// own archive (which only ever stores verified redacted text).
function brand(text: string): SafeText {
  return text as SafeText;
}

export function safeTextFromRedactedTranscript(text: string): SafeText {
  return brand(text);
}

/** Speaker-labelled transcript used as LLM input, rebuilt from archived redacted utterances. */
export function speakerTranscriptFromArchive(utterances: Utterance[]): SafeText {
  return brand(formatSpeakerTranscript(utterances));
}

export function speakerTranscript(transcript: SafeTranscript): SafeText {
  return brand(formatSpeakerTranscript(transcript.utterances));
}

function formatSpeakerTranscript(utterances: Utterance[]): string {
  return utterances.map((u) => `Speaker ${u.speaker}: ${u.text}`).join('\n');
}
