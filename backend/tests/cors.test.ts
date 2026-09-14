import { describe, expect, it } from 'vitest';
import { corsOriginMatcher } from '../src/app.js';
import { loadConfig, normalizeOrigin } from '../src/config.js';

const base = {
  ASSEMBLYAI_API_KEY: 'test-key',
  ASSEMBLYAI_WEBHOOK_SECRET: '1234567890abcdef',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
};

function allows(corsOrigins: string, origin: string): boolean {
  let allowed = false;
  corsOriginMatcher(loadConfig({ ...base, CORS_ORIGINS: corsOrigins }).corsOrigins)(origin, (_error, allow) => {
    allowed = Boolean(allow);
  });
  return allowed;
}

describe('CORS origins', () => {
  it('normalises what people paste into CORS_ORIGINS', () => {
    expect(normalizeOrigin('https://endpointing.vercel.app/')).toBe('https://endpointing.vercel.app');
    expect(normalizeOrigin('endpointing.vercel.app')).toBe('https://endpointing.vercel.app');
    expect(normalizeOrigin(' "HTTPS://Endpointing.vercel.app/dashboard" ')).toBe('https://endpointing.vercel.app');
    expect(normalizeOrigin('localhost:5173')).toBe('http://localhost:5173');
    expect(normalizeOrigin('  ')).toBe('');
  });

  it('allows the deployed site however its address was pasted', () => {
    for (const pasted of ['https://endpointing.vercel.app/', 'endpointing.vercel.app', 'http://localhost:5173, https://endpointing.vercel.app']) {
      expect(allows(pasted, 'https://endpointing.vercel.app')).toBe(true);
    }
  });

  it('still rejects other sites, and wildcards match one subdomain label only', () => {
    expect(allows('https://endpointing.vercel.app', 'https://attacker.example')).toBe(false);
    expect(allows('https://*.vercel.app', 'https://endpointing-git-main.vercel.app')).toBe(true);
    expect(allows('https://*.vercel.app', 'https://vercel.app.attacker.example')).toBe(false);
  });
});
