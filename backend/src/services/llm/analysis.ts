import { z } from 'zod';
import type { CallAnalysis, SafeText } from '../../domain/types.js';
import { httpStatusOf, isTransientError } from '../../errors.js';

/**
 * Structured call analysis via AssemblyAI LLM Gateway (OpenAI-compatible chat
 * completions). Input is always the REDACTED transcript — the `SafeText`
 * parameter type enforces that.
 *
 * Output modes (verified against the LLM Gateway docs, 2026-09-14):
 * - `json_schema`: `response_format` with a strict JSON Schema, for models whose
 *   `supported_parameters` include `response_format`.
 * - `prompt`: the same schema is given in the system prompt, for models without
 *   `response_format` (e.g. qwen3.5-4b-32k-fast).
 * Both modes use server-side `json-repair` and strict validation here.
 */

export const ANALYSIS_SYSTEM_PROMPT = `You are a contact-center quality analyst working inside SafeCall, a privacy-first call archive.

You will receive a customer-support call transcript that has ALREADY been PII-redacted by AssemblyAI. Personal information appears only as placeholders such as [PERSON_NAME], [PHONE_NUMBER] or [CREDIT_CARD_NUMBER].

Rules:
- Analyze only the redacted transcript.
- Never attempt to infer, reconstruct, or recover redacted personal information. Treat placeholders as opaque and never guess what they contain.
- Do not invent facts that are not present in the transcript. If something was not discussed, write "Not discussed".
- Do not include personal information in your output. Refer to people by role ("the customer", "the agent").
- summary: 2-4 neutral sentences.
- topics: 1-6 short business topic labels in Title Case (for example "Billing", "Refund", "Account Update").
- action_items: concrete follow-ups stated or clearly implied in the call. Use an empty list if there are none.
- speaker_roles: map every speaker label that appears (A, B, ...) to agent, customer or other.
- sentiment describes the customer's overall sentiment; sentiment_trend gives the customer's sentiment at the start and at the end of the call.
- Respond only with JSON that matches the provided schema.`;

const SENTIMENT_SCHEMA = { type: 'string', enum: ['positive', 'neutral', 'negative'] } as const;

export const ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Neutral 2-4 sentence summary of the call.' },
    customer_issue: { type: 'string', description: 'The problem or request the customer called about.' },
    resolution: { type: 'string', description: 'How the call ended / what was done. "Not discussed" if unresolved.' },
    sentiment: SENTIMENT_SCHEMA,
    sentiment_trend: {
      type: 'object',
      properties: { start: SENTIMENT_SCHEMA, end: SENTIMENT_SCHEMA },
      required: ['start', 'end'],
      additionalProperties: false,
    },
    topics: { type: 'array', items: { type: 'string' } },
    action_items: { type: 'array', items: { type: 'string' } },
    speaker_roles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          speaker: { type: 'string' },
          role: { type: 'string', enum: ['agent', 'customer', 'other'] },
        },
        required: ['speaker', 'role'],
        additionalProperties: false,
      },
    },
    qa: {
      type: 'object',
      properties: {
        issue_resolved: { type: 'boolean' },
        agent_professionalism: { type: 'string', enum: ['excellent', 'good', 'needs_improvement'] },
        notes: { type: 'string', description: 'One sentence of QA feedback for the agent.' },
      },
      required: ['issue_resolved', 'agent_professionalism', 'notes'],
      additionalProperties: false,
    },
  },
  required: ['summary', 'customer_issue', 'resolution', 'sentiment', 'sentiment_trend', 'topics', 'action_items', 'speaker_roles', 'qa'],
  additionalProperties: false,
} as const;

/** Models the LLM Gateway "Models" table lists without `response_format` (fallback when /v1/models is unreachable). */
const MODELS_WITHOUT_RESPONSE_FORMAT = new Set([
  'qwen3.5-4b-32k-fast',
  'gpt-oss-20b',
  'gpt-4.1',
  'claude-opus-4-7',
  'claude-opus-4-8',
  'claude-opus-5',
  'claude-sonnet-5',
]);

export type OutputMode = 'json_schema' | 'prompt';

// Validation: required fields and types are strict; enum casing/spacing is
// normalized; unknown keys are stripped so nothing unexpected is ever stored.
const normalizeEnum = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s-]+/g, '_') : value;
const sentiment = z.preprocess(normalizeEnum, z.enum(['positive', 'neutral', 'negative']));
const shortText = (max: number) => z.string().trim().min(1).max(max);

export const CallAnalysisSchema = z.object({
  summary: shortText(2000),
  customer_issue: shortText(1000),
  resolution: shortText(1000),
  sentiment,
  sentiment_trend: z
    .object({ start: sentiment, end: sentiment })
    .nullish()
    .transform((value) => value ?? null),
  topics: z
    .array(shortText(60))
    .max(20)
    .transform((topics) => [...new Set(topics)].slice(0, 6)),
  action_items: z
    .array(shortText(300))
    .max(20)
    .transform((items) => items.slice(0, 8)),
  speaker_roles: z
    .array(
      z.object({
        speaker: z.preprocess(
          (value) => (typeof value === 'string' ? value.replace(/^speaker\s+/i, '').trim().toUpperCase() : value),
          z.string().regex(/^[A-Z0-9]{1,3}$/),
        ),
        role: z.preprocess(normalizeEnum, z.enum(['agent', 'customer', 'other'])),
      }),
    )
    .max(20)
    .default([]),
  qa: z
    .object({
      issue_resolved: z.boolean(),
      agent_professionalism: z.preprocess(normalizeEnum, z.enum(['excellent', 'good', 'needs_improvement'])),
      notes: z.string().trim().max(1000),
    })
    .nullish()
    .transform((value) => value ?? null),
});

export class AnalysisValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalysisValidationError';
  }
}

/** Pulls the JSON object out of a reply that may be wrapped in markdown fences or prose. */
export function extractJsonObject(content: string): string {
  const unfenced = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  if (unfenced.startsWith('{')) return unfenced;
  const first = unfenced.indexOf('{');
  const last = unfenced.lastIndexOf('}');
  return first >= 0 && last > first ? unfenced.slice(first, last + 1) : unfenced;
}

/** Parses and validates the model's JSON. Throws AnalysisValidationError on any mismatch. */
export function parseAnalysis(content: unknown): CallAnalysis {
  if (typeof content !== 'string' || content.trim() === '') {
    throw new AnalysisValidationError('LLM returned an empty response.');
  }
  let json: unknown;
  try {
    json = JSON.parse(extractJsonObject(content));
  } catch {
    throw new AnalysisValidationError('LLM response was not valid JSON.');
  }
  const result = CallAnalysisSchema.safeParse(json);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.') || '(root)'))].join(', ');
    throw new AnalysisValidationError(`LLM response did not match the analysis schema (${fields}).`);
  }
  return result.data;
}

export interface AnalysisResult {
  analysis: CallAnalysis;
  meta: {
    model: string;
    requestId: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    outputMode: OutputMode;
  };
}

export interface AnalysisService {
  analyze(transcript: SafeText): Promise<AnalysisResult>;
}

export interface LlmGatewayOptions {
  apiKey: string;
  gatewayUrl: string;
  model: string;
  fallbackModel: string | null;
  /** `auto` asks the gateway's /v1/models endpoint whether the model supports response_format. */
  responseFormat?: 'auto' | OutputMode;
  timeoutMs?: number;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export function buildAnalysisRequest(
  transcript: SafeText,
  model: string,
  fallbackModel: string | null,
  mode: OutputMode = 'json_schema',
) {
  const system =
    mode === 'json_schema'
      ? ANALYSIS_SYSTEM_PROMPT
      : `${ANALYSIS_SYSTEM_PROMPT}\n\nOutput format: reply with ONE JSON object only (no markdown fences, no commentary) that validates against this JSON Schema:\n${JSON.stringify(ANALYSIS_JSON_SCHEMA)}`;
  return {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `Redacted call transcript (speaker-labelled):\n\n${transcript}` },
    ],
    max_tokens: 1500,
    temperature: 0.2,
    ...(mode === 'json_schema'
      ? { response_format: { type: 'json_schema', json_schema: { name: 'call_analysis', schema: ANALYSIS_JSON_SCHEMA, strict: true } } }
      : {}),
    post_processing_steps: [{ type: 'json-repair' }],
    ...(fallbackModel && fallbackModel !== model ? { fallbacks: [{ model: fallbackModel }] } : {}),
  };
}

interface ChatCompletionResponse {
  request_id?: string;
  model?: string;
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
}

export class LlmGatewayAnalysisService implements AnalysisService {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private modeLookup: Promise<OutputMode> | null = null;

  constructor(private readonly options: LlmGatewayOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Resolves (once per process) whether the configured model supports response_format. */
  outputMode(): Promise<OutputMode> {
    const configured = this.options.responseFormat ?? 'auto';
    if (configured !== 'auto') return Promise.resolve(configured);
    this.modeLookup ??= this.lookupOutputMode();
    return this.modeLookup;
  }

  private async lookupOutputMode(): Promise<OutputMode> {
    try {
      const modelsUrl = this.options.gatewayUrl.replace(/\/chat\/completions\/?$/, '/models');
      const response = await this.fetchImpl(modelsUrl, {
        headers: { authorization: this.options.apiKey },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        const body = (await response.json()) as { data?: Array<{ id?: string; supported_parameters?: string[] }> };
        const entry = body.data?.find((model) => model.id === this.options.model);
        if (entry?.supported_parameters) {
          return entry.supported_parameters.includes('response_format') ? 'json_schema' : 'prompt';
        }
      }
    } catch {
      // Fall back to the documented capability table below.
    }
    return MODELS_WITHOUT_RESPONSE_FORMAT.has(this.options.model) ? 'prompt' : 'json_schema';
  }

  async analyze(transcript: SafeText): Promise<AnalysisResult> {
    if (transcript.trim() === '') {
      throw new AnalysisValidationError('There is no speech in this call to analyze.');
    }
    const mode = await this.outputMode();
    const body = JSON.stringify(buildAnalysisRequest(transcript, this.options.model, this.options.fallbackModel, mode));
    const maxAttempts = this.options.maxAttempts ?? 4;

    for (let attempt = 1; ; attempt += 1) {
      try {
        const response = await this.fetchImpl(this.options.gatewayUrl, {
          method: 'POST',
          headers: { authorization: this.options.apiKey, 'content-type': 'application/json' },
          body,
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 90_000),
        });
        if (!response.ok) {
          // The request carries only the redacted transcript, so the error
          // detail is safe to log. It is never shown to end users.
          const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
          throw Object.assign(new Error(`LLM Gateway returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`), {
            status: response.status,
            retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
          });
        }
        const data = (await response.json()) as ChatCompletionResponse;
        const analysis = parseAnalysis(data.choices?.[0]?.message?.content);
        return {
          analysis,
          meta: {
            model: data.model ?? this.options.model,
            requestId: data.request_id ?? null,
            inputTokens: data.usage?.input_tokens ?? data.usage?.prompt_tokens ?? null,
            outputTokens: data.usage?.output_tokens ?? data.usage?.completion_tokens ?? null,
            outputMode: mode,
          },
        };
      } catch (error) {
        const retry = attempt < maxAttempts && (isTransientError(error) || error instanceof AnalysisValidationError);
        if (!retry) throw error;
        await this.sleep(retryDelayMs(error, attempt));
      }
    }
  }
}

/** Seconds or an HTTP date, as sent in `Retry-After`. */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

/** Honors Retry-After; rate limits (429) back off in 10s steps, other errors exponentially. */
export function retryDelayMs(error: unknown, attempt: number): number {
  const hinted = (error as { retryAfterMs?: unknown } | null)?.retryAfterMs;
  if (typeof hinted === 'number' && hinted > 0) return Math.min(hinted, 60_000);
  if (httpStatusOf(error) === 429) return Math.min(10_000 * attempt, 60_000);
  return 1000 * 2 ** (attempt - 1);
}
