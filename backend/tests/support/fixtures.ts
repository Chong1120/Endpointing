import type { Transcript } from 'assemblyai';

/**
 * A completed AssemblyAI transcript for sample Call A, as returned with
 * `redact_pii: true` and `redact_pii_sub: "entity_name"`.
 */
const UTTERANCES = [
  { speaker: 'A', start: 400, end: 5200, text: 'Thank you for calling Northwind Mobile, my name is [PERSON_NAME]. How can I help you today?' },
  { speaker: 'B', start: 5800, end: 11200, text: 'Hi [PERSON_NAME]. I just moved, and I need to update my account details. My name is [PERSON_NAME].' },
  { speaker: 'A', start: 11800, end: 16000, text: 'Welcome. First, can you confirm the phone number on the account?' },
  { speaker: 'B', start: 16500, end: 19500, text: 'Sure. It is [PHONE_NUMBER].' },
  { speaker: 'A', start: 20000, end: 23000, text: 'Thank you. And what is the best email address for your account?' },
  { speaker: 'B', start: 23500, end: 26000, text: 'It is [EMAIL_ADDRESS].' },
  { speaker: 'A', start: 26500, end: 28500, text: 'Got it. What is your new home address?' },
  { speaker: 'B', start: 29000, end: 34000, text: '[LOCATION_ADDRESS].' },
  {
    speaker: 'B',
    start: 34500,
    end: 45000,
    text: 'The new card number is [CREDIT_CARD_NUMBER]. It expires [CREDIT_CARD_EXPIRATION], and the security code is [CREDIT_CARD_CVV].',
  },
  { speaker: 'A', start: 45500, end: 50000, text: 'Thank you. Your new card is saved and autopay is active.' },
];

export const EXPECTED_PII_COUNTS = {
  PERSON_NAME: 3,
  PHONE_NUMBER: 1,
  EMAIL_ADDRESS: 1,
  LOCATION_ADDRESS: 1,
  CREDIT_CARD_NUMBER: 1,
  CREDIT_CARD_EXPIRATION: 1,
  CREDIT_CARD_CVV: 1,
};

/** Raw values that must never appear anywhere in SafeCall's stored data. */
export const RAW_PII_VALUES = ['Sarah Mitchell', '415-555-0198', 'sarah.mitchell@example.com', '4111 1111 1111 1111', 'Maple Avenue'];

export function redactedTranscriptFixture(id = 'transcript-1', overrides: Record<string, unknown> = {}): Transcript {
  return {
    id,
    status: 'completed',
    redact_pii: true,
    redact_pii_sub: 'entity_name',
    language_code: 'en',
    audio_duration: 50,
    speech_model_used: 'universal-3-5-pro',
    text: UTTERANCES.map((u) => u.text).join(' '),
    utterances: UTTERANCES.map((u) => ({ ...u, confidence: 0.97, words: [] })),
    ...overrides,
  } as unknown as Transcript;
}

/** Simulates a misconfigured request that also returned unredacted fields. */
export function transcriptWithUnredactedFields(id = 'transcript-1'): Transcript {
  return redactedTranscriptFixture(id, {
    unredacted_text: 'My name is Sarah Mitchell and my number is 415-555-0198, email sarah.mitchell@example.com',
    unredacted_utterances: [{ speaker: 'B', start: 0, end: 1000, text: 'My name is Sarah Mitchell, card 4111 1111 1111 1111, Maple Avenue' }],
  });
}
