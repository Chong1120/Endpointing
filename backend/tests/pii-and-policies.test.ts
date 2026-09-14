import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import {
  ASSEMBLYAI_PII_POLICIES,
  PRESET_DEFINITIONS,
  entityLabel,
  isPiiPolicy,
  resolvePolicies,
} from '../src/services/assemblyai/policies.js';
import { countPiiMarkers, countRedactionMarkers, summarizePii } from '../src/services/pii.js';
import { EXPECTED_PII_COUNTS, redactedTranscriptFixture } from './support/fixtures.js';

describe('PII count extraction', () => {
  it('counts entity_name markers in a redacted transcript', () => {
    const counts = countPiiMarkers(redactedTranscriptFixture().text);
    expect(counts).toEqual(EXPECTED_PII_COUNTS);
    expect(summarizePii(counts)).toEqual({
      total: 9,
      types: ['PERSON_NAME', 'CREDIT_CARD_CVV', 'CREDIT_CARD_EXPIRATION', 'CREDIT_CARD_NUMBER', 'EMAIL_ADDRESS', 'LOCATION_ADDRESS', 'PHONE_NUMBER'],
    });
  });

  it('ignores bracketed text that is not a known PII entity', () => {
    const counts = countPiiMarkers('Hold on [MUSIC] please [PHONE_NUMBER] and [NOT_A_POLICY] [person_name]');
    expect(counts).toEqual({ PHONE_NUMBER: 1 });
  });

  it('groups word-level markers of one entity into a single entity', () => {
    const text =
      'My name is [PERSON_NAME] [PERSON_NAME]. I live at [LOCATION_ADDRESS] [LOCATION_ADDRESS], [LOCATION_ADDRESS] - [LOCATION_ADDRESS].';
    expect(countPiiMarkers(text)).toEqual({ PERSON_NAME: 1, LOCATION_ADDRESS: 1 });
    expect(countRedactionMarkers(text)).toBe(6);
  });

  it('keeps separate entities separate', () => {
    expect(countPiiMarkers('[PERSON_NAME] and [PERSON_NAME] called. [PERSON_NAME]. [PERSON_NAME] [PHONE_NUMBER]')).toEqual({
      PERSON_NAME: 4,
      PHONE_NUMBER: 1,
    });
  });

  it('handles empty and null transcripts', () => {
    expect(countPiiMarkers('')).toEqual({});
    expect(countPiiMarkers(null)).toEqual({});
    expect(summarizePii({})).toEqual({ total: 0, types: [] });
  });

  it('returns counts only — never the underlying values', () => {
    const counts = countPiiMarkers('Call me at [PHONE_NUMBER].');
    expect(JSON.stringify(counts)).not.toMatch(/\d{3}/);
  });
});

describe('PII policy presets', () => {
  it('only uses policy names documented by AssemblyAI', () => {
    for (const definition of Object.values(PRESET_DEFINITIONS)) {
      for (const policy of definition.policies) expect(isPiiPolicy(policy)).toBe(true);
    }
  });

  it('CONTACT_CENTER protects the minimum required entity types', () => {
    const required = [
      'person_name', 'phone_number', 'email_address', 'location_address', 'credit_card_number', 'credit_card_cvv',
      'credit_card_expiration', 'account_number', 'banking_information', 'date_of_birth', 'password', 'healthcare_number',
    ];
    expect(PRESET_DEFINITIONS.CONTACT_CENTER.policies).toEqual(expect.arrayContaining(required));
  });

  it('applies organization overrides and drops unknown names', () => {
    expect(resolvePolicies('CUSTOM', ['person_name', 'bogus_policy'])).toEqual(['person_name']);
    expect(resolvePolicies('FINANCIAL', ['bogus'])).toEqual(PRESET_DEFINITIONS.FINANCIAL.policies);
    expect(resolvePolicies('HEALTHCARE', null)).toContain('medical_condition');
  });

  it('formats entity labels for display', () => {
    expect(entityLabel('PHONE_NUMBER')).toBe('Phone number');
    expect(entityLabel('us_social_security_number')).toBe('US social security number');
    expect(ASSEMBLYAI_PII_POLICIES.length).toBeGreaterThan(40);
  });
});

describe('configuration', () => {
  const base = {
    ASSEMBLYAI_API_KEY: 'key',
    ASSEMBLYAI_WEBHOOK_SECRET: '0123456789abcdef0123',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
  };

  it('enables webhooks only for public HTTPS URLs', () => {
    expect(loadConfig({ ...base, PUBLIC_API_URL: 'https://api.safecall.example' }).webhooksEnabled).toBe(true);
    expect(loadConfig({ ...base, PUBLIC_API_URL: 'http://localhost:4000' }).webhooksEnabled).toBe(false);
    expect(loadConfig({ ...base, PUBLIC_API_URL: '' }).webhooksEnabled).toBe(false);
  });

  it('accepts a public URL pasted without https://, with quotes or a trailing slash', () => {
    for (const pasted of ['app.up.railway.app', '"https://app.up.railway.app"', ' https://app.up.railway.app/ ']) {
      const config = loadConfig({ ...base, PUBLIC_API_URL: pasted });
      expect(config.publicApiUrl).toBe('https://app.up.railway.app');
      expect(config.webhooksEnabled).toBe(true);
    }
  });

  it('falls back to status checks instead of crashing on an unusable public URL', () => {
    const config = loadConfig({ ...base, PUBLIC_API_URL: 'https://' });
    expect(config.publicApiUrl).toBeNull();
    expect(config.webhooksEnabled).toBe(false);
  });

  it('rejects missing secrets with a readable message', () => {
    expect(() => loadConfig({ SUPABASE_URL: 'http://x.test' })).toThrow(/ASSEMBLYAI_API_KEY/);
  });

  it('parses boolean flags strictly', () => {
    expect(loadConfig({ ...base, ASSEMBLYAI_DELETE_AFTER_ARCHIVE: 'false' }).assemblyai.deleteAfterArchive).toBe(false);
  });
});
