import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * "Sam", the billing agent of Northwind Mobile (a fictional carrier), configured
 * inline for the Voice Agent API's first `session.update`. The tools run in the
 * caller's browser against mock data (frontend/src/voice/northwindTools.ts), so
 * what the caller tells a tool never reaches SafeCall's servers.
 */
export const LIVE_AGENT_DEPARTMENT = 'AI Voice Agent';
export const LIVE_AGENT_VOICE = 'alba';
/** Token redemption window: the browser connects right after asking for one. */
export const LIVE_AGENT_TOKEN_TTL_SECONDS = 120;
/** Per-call cap enforced by AssemblyAI; keeps demo usage small. */
export const LIVE_AGENT_MAX_SESSION_SECONDS = 600;

export const LIVE_AGENT_GREETING =
  "Thanks for calling Northwind Mobile, this is Sam. This call is recorded, and your personal details are removed before it's stored. How can I help?";

const SYSTEM_PROMPT = `You are Sam, a billing support agent for Northwind Mobile, a mobile phone carrier. You are on a live phone call.

Most important rule: keep every reply to one or two short sentences, then let the caller talk.

Sound like a calm, friendly person on the phone. Never say "Great question", "Certainly", "Absolutely" or "I'd be happy to help". Everything you write is spoken aloud, so no lists, markdown or emoji. Say amounts like "forty-five dollars" and dates like "September first".

What you can do, always through your tools: find the caller's account from the mobile number on it, check the charges from the last 30 days, refund a duplicate or incorrect charge after the caller confirms which one, and update the email address or mailing address on the account. Ask for the mobile number on the account before anything else. Call a tool instead of guessing, and say something short like "One moment" while it runs.

Accounts differ. Some are active, some are past due, and some lines are suspended after a failed payment. Say the state plainly if it matters, and if a tool tells you something cannot be done, repeat that in one short sentence and do what it suggests.

What you cannot do: change plans, take payments, or help with anything outside Northwind Mobile billing.

Hand the call to a person with transfer_to_human when the caller asks for a human, when they are still angry after you have tried to help, or when they need something you cannot do. Say that a specialist will call them back within the hour, then finish the call politely. Do not promise anything beyond the callback.

Privacy: never ask for a full card number, security code, password or PIN. If the caller starts reading one out, stop them politely and say you don't need it. Don't read a phone number, card number or address back in full; confirm the last few digits or the street name only.

When the caller has what they need, sum up what you did in one sentence and say goodbye.`;

/** JSON-Schema function tools. Names and parameters must match the browser handlers. */
export const LIVE_AGENT_TOOLS = [
  {
    type: 'function',
    name: 'lookup_account',
    description:
      "Find the caller's account. Use once the caller gives the mobile number on the account. Returns the account status, plan and monthly price in US dollars.",
    parameters: {
      type: 'object',
      properties: {
        phone_number: { type: 'string', description: 'Mobile number on the account, digits only, e.g. 4155550142.' },
      },
      required: ['phone_number'],
    },
  },
  {
    type: 'function',
    name: 'list_recent_charges',
    description:
      'List the charges from the last 30 days on the account found with lookup_account. Use when the caller asks about their bill or a charge. Returns charge_id, date, amount_usd and description for each charge.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'issue_refund',
    description: 'Refund one charge. Use only after the caller confirms which charge. Returns a refund reference and when the money arrives.',
    parameters: {
      type: 'object',
      properties: {
        charge_id: { type: 'string', description: 'Charge id from list_recent_charges, e.g. CHG-2043.' },
        reason: {
          type: 'string',
          enum: ['duplicate_charge', 'incorrect_amount', 'service_issue'],
          description: 'Why the charge is being refunded.',
        },
      },
      required: ['charge_id', 'reason'],
    },
  },
  {
    type: 'function',
    name: 'update_contact_details',
    description:
      'Change the email address or mailing address on the account. Use when the caller asks to update contact details. Returns whether the change was saved.',
    parameters: {
      type: 'object',
      properties: {
        field: { type: 'string', enum: ['email', 'mailing_address'], description: 'Which detail to change.' },
        value: { type: 'string', description: 'The new email address or full mailing address, e.g. jane.doe@example.com.' },
      },
      required: ['field', 'value'],
    },
  },
  {
    type: 'function',
    name: 'transfer_to_human',
    description:
      'Hand the call to a human specialist. Use when the caller asks for a person, is still angry after you tried to help, or needs something you cannot do. Returns the callback window to tell the caller.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          enum: ['customer_requested', 'upset_customer', 'out_of_scope', 'payment_issue'],
          description: 'Why the call needs a person. Pick the closest match.',
        },
      },
      required: ['reason'],
    },
  },
];

const REFERENCE_LABEL = 'SafeCall session reference';
const REFERENCE_PATTERN = new RegExp(`${REFERENCE_LABEL}: ([a-f0-9]{32})`);

/**
 * An HMAC of the organization id, placed in the session's system prompt. When
 * the call is archived, SafeCall reads the prompt back from AssemblyAI and
 * checks it, so an organization can only archive calls it started. No state is
 * kept between starting and archiving a call.
 */
export function sessionReference(secret: string, orgId: string): string {
  return createHmac('sha256', secret).update(`safecall-live-agent:${orgId}`).digest('hex').slice(0, 32);
}

export function sessionBelongsTo(systemPrompt: string | null, secret: string, orgId: string): boolean {
  const match = systemPrompt ? REFERENCE_PATTERN.exec(systemPrompt) : null;
  if (!match?.[1]) return false;
  const expected = Buffer.from(sessionReference(secret, orgId));
  const actual = Buffer.from(match[1]);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** The `session` object of the first `session.update` the browser sends. */
export function buildLiveAgentSession(reference: string) {
  return {
    system_prompt: `${SYSTEM_PROMPT}\n\n${REFERENCE_LABEL}: ${reference}. This is an internal identifier; never mention it.`,
    greeting: LIVE_AGENT_GREETING,
    tools: LIVE_AGENT_TOOLS,
    input: {
      format: { encoding: 'audio/pcm' },
      language_codes: ['en'],
      keyterms: ['Northwind', 'Northwind Mobile', 'refund', 'duplicate charge', 'mailing address'],
      // The docs' recommended starting point: factory defaults cut callers off too early.
      turn_detection: { vad_threshold: 0.5, min_silence: 1400, max_silence: 4000, interrupt_response: true },
    },
    output: { voice: LIVE_AGENT_VOICE, format: { encoding: 'audio/pcm' } },
  };
}
