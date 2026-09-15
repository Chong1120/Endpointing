import { describe, expect, it, vi } from 'vitest';
import type { SafeText } from '../src/domain/types.js';
import {
  ANALYSIS_JSON_SCHEMA,
  AnalysisValidationError,
  LlmGatewayAnalysisService,
  extractJsonObject,
  parseAnalysis,
} from '../src/services/llm/analysis.js';
import { SAMPLE_ANALYSIS } from './support/fakes.js';

const SAFE = 'Speaker A: Hello, this is [PERSON_NAME].\nSpeaker B: My number is [PHONE_NUMBER].' as SafeText;

function gatewayResponse(content: unknown, status = 200) {
  return new Response(
    JSON.stringify({
      request_id: 'req_abc',
      model: 'claude-sonnet-4-6',
      choices: [{ message: { role: 'assistant', content: typeof content === 'string' ? content : JSON.stringify(content) } }],
      usage: { input_tokens: 120, output_tokens: 80 },
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

function service(fetchImpl: unknown, extra: Record<string, unknown> = {}) {
  return new LlmGatewayAnalysisService({
    apiKey: 'aai-key',
    gatewayUrl: 'https://llm-gateway.assemblyai.com/v1/chat/completions',
    model: 'claude-sonnet-4-6',
    fallbackModel: null,
    responseFormat: 'json_schema',
    fetchImpl: fetchImpl as typeof fetch,
    sleep: async () => undefined,
    ...extra,
  });
}

describe('AI JSON validation', () => {
  it('accepts a response that matches the schema', () => {
    expect(parseAnalysis(JSON.stringify(SAMPLE_ANALYSIS))).toEqual(SAMPLE_ANALYSIS);
  });

  it('rejects non-JSON, empty and incomplete responses', () => {
    expect(() => parseAnalysis('not json')).toThrow(AnalysisValidationError);
    expect(() => parseAnalysis('')).toThrow(AnalysisValidationError);
    const { summary: _omit, ...missing } = SAMPLE_ANALYSIS;
    expect(() => parseAnalysis(JSON.stringify(missing))).toThrow(/summary/);
    expect(() => parseAnalysis(JSON.stringify({ ...SAMPLE_ANALYSIS, topics: 'Billing' }))).toThrow(/topics/);
  });

  it('rejects invalid enum values', () => {
    expect(() => parseAnalysis(JSON.stringify({ ...SAMPLE_ANALYSIS, sentiment: 'ecstatic' }))).toThrow(/sentiment/);
  });

  it('never keeps fields outside the schema', () => {
    const parsed = parseAnalysis(JSON.stringify({ ...SAMPLE_ANALYSIS, guessed_name: 'Jane Doe' })) as unknown as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('guessed_name');
    expect(JSON.stringify(parsed)).not.toContain('Jane Doe');
  });

  it('normalizes casing and treats optional extras as optional', () => {
    const { sentiment_trend: _t, qa: _q, speaker_roles: _r, ...required } = SAMPLE_ANALYSIS;
    const parsed = parseAnalysis(JSON.stringify({ ...required, sentiment: 'Positive', topics: ['Billing', 'Billing', 'Refund'] }));
    expect(parsed).toMatchObject({ sentiment: 'positive', sentiment_trend: null, qa: null, speaker_roles: [], topics: ['Billing', 'Refund'] });
    const roles = parseAnalysis(JSON.stringify({ ...SAMPLE_ANALYSIS, speaker_roles: [{ speaker: 'Speaker A', role: 'Agent' }] }));
    expect(roles.speaker_roles).toEqual([{ speaker: 'A', role: 'agent' }]);
  });

  it('extracts JSON from markdown fences or surrounding prose', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonObject('Here you go: {"a":1} hope it helps')).toBe('{"a":1}');
    expect(parseAnalysis(`\`\`\`json\n${JSON.stringify(SAMPLE_ANALYSIS)}\n\`\`\``)).toEqual(SAMPLE_ANALYSIS);
  });
});

describe('LLM Gateway analysis service', () => {
  it('sends only the redacted transcript with a strict JSON schema and privacy instructions', async () => {
    const fetchImpl = vi.fn(async () => gatewayResponse(SAMPLE_ANALYSIS));
    const result = await service(fetchImpl, { fallbackModel: 'gemini-2.5-flash' }).analyze(SAFE);
    expect(result.analysis).toEqual(SAMPLE_ANALYSIS);
    expect(result.meta).toEqual({ model: 'claude-sonnet-4-6', requestId: 'req_abc', inputTokens: 120, outputTokens: 80, outputMode: 'json_schema' });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://llm-gateway.assemblyai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('aai-key'); // raw key, no Bearer
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.fallbacks).toEqual([{ model: 'gemini-2.5-flash' }]);
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'call_analysis', schema: ANALYSIS_JSON_SCHEMA, strict: true },
    });
    expect(body.post_processing_steps).toEqual([{ type: 'json-repair' }]);
    const system = body.messages[0].content as string;
    expect(system).toContain('Analyze only the redacted transcript.');
    expect(system).toContain('Never attempt to infer, reconstruct, or recover redacted personal information.');
    expect(system).toContain('Do not invent facts that are not present in the transcript.');
    expect(body.messages[1].content).toContain(SAFE);
  });

  it('puts the schema in the prompt for models without response_format', async () => {
    const fetchImpl = vi.fn(async () => gatewayResponse(`\`\`\`json\n${JSON.stringify(SAMPLE_ANALYSIS)}\n\`\`\``));
    const result = await service(fetchImpl, { model: 'qwen3.5-4b-32k-fast', responseFormat: 'prompt' }).analyze(SAFE);
    expect(result.meta.outputMode).toBe('prompt');
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).not.toHaveProperty('response_format');
    expect(body.messages[0].content).toContain('"customer_issue"');
    expect(body.post_processing_steps).toEqual([{ type: 'json-repair' }]);
  });

  it('detects response_format support from the gateway model list', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/models')
        ? new Response(JSON.stringify({ data: [{ id: 'qwen3.5-4b-32k-fast', supported_parameters: ['max_tokens', 'temperature'] }] }))
        : gatewayResponse(SAMPLE_ANALYSIS),
    );
    const llm = service(fetchImpl, { model: 'qwen3.5-4b-32k-fast', responseFormat: 'auto' });
    await llm.analyze(SAFE);
    await llm.analyze(SAFE);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/models'))).toHaveLength(1); // cached
    expect(await llm.outputMode()).toBe('prompt');
  });

  it('retries transient gateway errors', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"error":"busy"}', { status: 503 }))
      .mockResolvedValueOnce(gatewayResponse(SAMPLE_ANALYSIS));
    await expect(service(fetchImpl).analyze(SAFE)).resolves.toMatchObject({ analysis: SAMPLE_ANALYSIS });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('backs off on rate limits and honors Retry-After', async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"message":"too many requests for this action"}', { status: 429, headers: { 'retry-after': '7' } }))
      .mockResolvedValueOnce(new Response('{"message":"too many requests for this action"}', { status: 429 }))
      .mockResolvedValueOnce(gatewayResponse(SAMPLE_ANALYSIS));
    await expect(service(fetchImpl, { sleep }).analyze(SAFE)).resolves.toMatchObject({ analysis: SAMPLE_ANALYSIS });
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([7_000, 20_000]);
  });

  it('gives up with a validation error after repeated malformed output', async () => {
    const fetchImpl = vi.fn(async () => gatewayResponse('{"summary": 1}'));
    await expect(service(fetchImpl, { maxAttempts: 2 }).analyze(SAFE)).rejects.toBeInstanceOf(AnalysisValidationError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry client errors and surfaces the gateway reason in the error', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('{"metadata":{"errors":["Your account does not have access to this LLM Gateway model"]}}', { status: 400 }),
    );
    await expect(service(fetchImpl).analyze(SAFE)).rejects.toThrow(/HTTP 400.*does not have access/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('uses the fallback model while the account cannot use the first, and tries the first again an hour later', async () => {
    let now = 0;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
      JSON.parse(String(init?.body)).model === 'claude-opus-5'
        ? new Response('{"metadata":{"errors":["Your account does not have access to this LLM Gateway model"]}}', { status: 400 })
        : gatewayResponse(SAMPLE_ANALYSIS),
    );
    const onModelUnavailable = vi.fn();
    const llm = service(fetchImpl, {
      model: 'claude-opus-5',
      fallbackModel: 'qwen3.5-4b-32k-fast',
      responseFormat: 'prompt',
      now: () => now,
      onModelUnavailable,
    });
    const bodies = () => fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));

    await expect(llm.analyze(SAFE)).resolves.toMatchObject({ analysis: SAMPLE_ANALYSIS });
    expect(bodies().map((body) => body.model)).toEqual(['claude-opus-5', 'qwen3.5-4b-32k-fast']);
    expect(bodies()[0].fallbacks).toEqual([{ model: 'qwen3.5-4b-32k-fast' }]);
    expect(bodies()[1]).not.toHaveProperty('fallbacks');
    expect(onModelUnavailable).toHaveBeenCalledWith('claude-opus-5', 'qwen3.5-4b-32k-fast', expect.stringMatching(/does not have access/));

    await llm.analyze(SAFE);
    expect(bodies().slice(2).map((body) => body.model)).toEqual(['qwen3.5-4b-32k-fast']); // skipped within the hour

    now += 60 * 60_000;
    await llm.analyze(SAFE);
    expect(bodies().slice(3).map((body) => body.model)).toEqual(['claude-opus-5', 'qwen3.5-4b-32k-fast']);
  });

  it('does not switch models for errors a different model would not fix', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"message":"invalid api key"}', { status: 401 }));
    const llm = service(fetchImpl, { model: 'claude-opus-5', fallbackModel: 'qwen3.5-4b-32k-fast', responseFormat: 'prompt' });
    await expect(llm.analyze(SAFE)).rejects.toThrow(/HTTP 401/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sends temperature and response_format only to models that accept them', async () => {
    const catalog = {
      data: [
        { id: 'claude-opus-5', supported_parameters: ['max_tokens', 'tools', 'tool_choice', 'stream'] },
        { id: 'qwen3.5-4b-32k-fast', supported_parameters: ['max_tokens', 'temperature', 'stream'] },
      ],
    };
    for (const [model, temperature] of [['claude-opus-5', undefined], ['qwen3.5-4b-32k-fast', 0.2]] as const) {
      const fetchImpl = vi.fn(async (url: string) =>
        url.endsWith('/models') ? new Response(JSON.stringify(catalog)) : gatewayResponse(SAMPLE_ANALYSIS),
      );
      const result = await service(fetchImpl, { model, responseFormat: 'auto' }).analyze(SAFE);
      const [, init] = fetchImpl.mock.calls.find(([url]) => !String(url).endsWith('/models')) as unknown as [string, RequestInit];
      const body = JSON.parse(String(init.body));
      expect(body.temperature).toBe(temperature);
      expect(body).not.toHaveProperty('response_format');
      expect(result.meta.outputMode).toBe('prompt');
    }

    // Without the model list, the built-in tables give the same answer.
    const offline = vi.fn(async () => gatewayResponse(SAMPLE_ANALYSIS));
    await service(offline, { model: 'claude-opus-5', responseFormat: 'prompt' }).analyze(SAFE);
    expect(JSON.parse(String((offline.mock.calls[0] as unknown as [string, RequestInit])[1].body))).not.toHaveProperty('temperature');
  });
});
