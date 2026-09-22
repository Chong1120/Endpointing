import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from '../src/app.js';
import { DEMO_ORG_NAME, DEMO_PERSONAS, demoPassword } from '../src/domain/demo.js';
import type { UserRole } from '../src/domain/types.js';
import { SupabaseDemoAccountService } from '../src/services/demoAccounts.js';
import { seedIfEmpty } from '../src/services/demoWorkspace.js';
import { buildTestDeps } from './support/fakes.js';

let tmp: string;
let ctx: ReturnType<typeof buildTestDeps>;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'safecall-demo-'));
  ctx = buildTestDeps({ uploadTmpDir: tmp });
  app = createApp(ctx.deps);
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const login = (persona: string) => request(app).post('/api/demo/login').send({ persona });

describe('one-click demo sign-in', () => {
  it('lists the personas without anyone signing in', async () => {
    const res = await request(app).get('/api/demo/personas');
    expect(res.status).toBe(200);
    expect(res.body.personas.map((p: { key: string; role: string }) => [p.key, p.role])).toEqual([
      ['customer', 'customer'],
      ['agent', 'agent'],
      ['admin', 'admin'],
    ]);
    expect(res.body.notice).toMatch(/sign up normally/i);
  });

  it('creates the workspace once and puts all three personas in it', async () => {
    const customer = await login('customer');
    expect(customer.status).toBe(200);
    expect(customer.headers['cache-control']).toBe('no-store');
    expect(customer.body.persona).toMatchObject({ key: 'customer', role: 'customer' });
    expect(customer.body.session.access_token).toBeTruthy();

    await login('agent');
    await login('admin');

    const organizations = [...ctx.users.organizations.values()];
    expect(organizations).toEqual([DEMO_ORG_NAME]);
    const members = await ctx.users.listForOrg([...ctx.users.organizations.keys()][0]!);
    expect(members.map((m) => m.role).sort()).toEqual(['admin', 'agent', 'customer']);
  });

  it('never sends a password to the browser, and only accepts the three personas', async () => {
    const res = await login('customer');
    const secret = ctx.deps.config.assemblyai.webhookSecret;
    for (const persona of DEMO_PERSONAS) {
      expect(JSON.stringify(res.body)).not.toContain(demoPassword(secret, persona.email));
    }
    expect((await login('superuser')).status).toBe(400);
    expect((await request(app).post('/api/demo/login').send({})).status).toBe(400);
  });

  it('stops a crawler from hammering the demo', async () => {
    const attempts = [];
    for (let i = 0; i < 121; i += 1) attempts.push(await login('customer'));
    expect(attempts.filter((res) => res.status === 200)).toHaveLength(120);
    expect(attempts.at(-1)!.status).toBe(429);
  });
});

describe('what a customer can reach', () => {
  /** Signs in through the demo route, then uses the returned token like a browser would. */
  async function signIn(persona: string) {
    const res = await login(persona);
    return res.body.session.access_token as string;
  }

  it('sees only their own calls, and none of the staff screens', async () => {
    const customerToken = await signIn('customer');
    const adminToken = await signIn('admin');

    const me = await request(app).get('/api/me').set(as(customerToken));
    expect(me.body.user.permissions).toEqual(['calls:read', 'agent:call']);

    // Two calls in the workspace: one the customer made, one the admin made.
    const orgId = me.body.organization.id as string;
    const mine = await ctx.calls.create({
      organization_id: orgId,
      created_by: me.body.user.id,
      original_filename: 'mine.mp3',
      department: 'Billing',
      source: 'upload',
      policy_preset: 'CONTACT_CENTER',
      pii_policies: [],
      analysis_enabled: true,
    });
    const theirs = await ctx.calls.create({
      organization_id: orgId,
      created_by: 'someone-else',
      original_filename: 'theirs.mp3',
      department: 'Billing',
      source: 'upload',
      policy_preset: 'CONTACT_CENTER',
      pii_policies: [],
      analysis_enabled: true,
    });

    const list = await request(app).get('/api/calls').set(as(customerToken));
    expect(list.body.items.map((item: { id: string }) => item.id)).toEqual([mine.id]);
    expect((await request(app).get(`/api/calls/${theirs.id}`).set(as(customerToken))).status).toBe(404);
    expect((await request(app).get(`/api/calls/${theirs.id}/audit`).set(as(customerToken))).status).toBe(404);
    expect((await request(app).get(`/api/calls/${mine.id}`).set(as(customerToken))).status).toBe(200);

    // Staff screens are closed to them.
    for (const path of ['/api/search?q=bill', '/api/analytics', '/api/audit', '/api/export?format=csv', '/api/follow-ups']) {
      expect((await request(app).get(path).set(as(customerToken))).status).toBe(403);
    }
    // …and open to the admin, on the same workspace.
    expect((await request(app).get('/api/analytics').set(as(adminToken))).status).toBe(200);
    expect((await request(app).get('/api/calls').set(as(adminToken))).body.items).toHaveLength(2);
  });

  it('can still call the live agent, up to the daily limit', async () => {
    const token = await signIn('customer');
    expect((await request(app).post('/api/voice-agent/session').set(as(token))).status).toBe(200);

    const me = await request(app).get('/api/me').set(as(token));
    for (let i = 0; i < 50; i += 1) {
      await ctx.deps.audit.record({ orgId: me.body.organization.id, type: 'VOICE_SESSION_STARTED', actorId: null, metadata: {} });
    }
    const capped = await request(app).post('/api/voice-agent/session').set(as(token));
    expect(capped.status).toBe(429);
    expect(capped.body.error.message).toMatch(/limit for today/i);
  });
});

describe('the Supabase demo sign-in', () => {
  it('goes to the token endpoint and never signs in on the shared service client', async () => {
    // Signing in on the service-role client attaches that user's session to it,
    // so every later query runs as `authenticated` and RLS denies it.
    const serviceClient = {
      auth: {
        signInWithPassword: () => {
          throw new Error('the shared service client must never sign in');
        },
        admin: {},
      },
    };
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: 'tok', refresh_token: 'ref', expires_in: 3600, user: { id: 'user-1' } })),
    );
    const service = new SupabaseDemoAccountService(
      serviceClient as unknown as SupabaseClient,
      'https://project.supabase.co/',
      'sb_secret_key',
      fetchImpl as unknown as typeof fetch,
    );

    expect(await service.signIn('customer@demo.safecall.app', 'pw')).toEqual({
      userId: 'user-1',
      accessToken: 'tok',
      refreshToken: 'ref',
      expiresIn: 3600,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://project.supabase.co/auth/v1/token?grant_type=password');
    expect((init.headers as Record<string, string>).apikey).toBe('sb_secret_key');
  });

  it('reports a refused sign-in instead of returning a broken session', async () => {
    const service = new SupabaseDemoAccountService(
      { auth: { admin: {} } } as unknown as SupabaseClient,
      'https://project.supabase.co',
      'sb_secret_key',
      (async () => new Response(JSON.stringify({ error_description: 'Invalid login credentials' }), { status: 400 })) as unknown as typeof fetch,
    );
    await expect(service.signIn('customer@demo.safecall.app', 'wrong')).rejects.toThrow(/Invalid login credentials/);
  });
});

describe('seeding', () => {
  it('fills an empty workspace with sample calls, one of them waiting for a person', async () => {
    await login('customer'); // background seeding stays off; this test drives it directly
    const orgId = [...ctx.users.organizations.keys()][0]!;
    const seeded = await seedIfEmpty(ctx.deps, orgId);
    expect(seeded).toBe(2);

    const { items } = await ctx.calls.list(orgId, { limit: 10, offset: 0 });
    expect(items).toHaveLength(2);
    expect(ctx.auditEvents.events.filter((event) => event.event_type === 'FOLLOW_UP_REQUESTED')).toHaveLength(1);

    // Seeding is once per workspace, not once per sign-in.
    expect(await seedIfEmpty(ctx.deps, orgId)).toBe(0);
  });
});

describe('resetting the shared workspace', () => {
  it('lets the demo admin put it back, and nobody else', async () => {
    const customerToken = (await login('customer')).body.session.access_token as string;
    const adminToken = (await login('admin')).body.session.access_token as string;
    const orgId = [...ctx.users.organizations.keys()][0]!;

    await ctx.calls.create({
      organization_id: orgId,
      created_by: null,
      original_filename: 'left-behind.mp3',
      department: 'Billing',
      source: 'upload',
      policy_preset: 'CONTACT_CENTER',
      pii_policies: [],
      analysis_enabled: true,
    });
    // Someone fiddled with a role before leaving.
    const agent = (await ctx.users.listForOrg(orgId)).find((m) => m.role === 'agent')!;
    await ctx.users.setRole(orgId, agent.userId, 'viewer' as UserRole);

    expect((await request(app).post('/api/demo/reset').set(as(customerToken))).status).toBe(403);

    const reset = await request(app).post('/api/demo/reset').set(as(adminToken));
    expect(reset.status).toBe(200);
    expect(reset.body.calls_deleted).toBe(1);
    expect((await ctx.users.listForOrg(orgId)).find((m) => m.userId === agent.userId)?.role).toBe('agent');
    expect(ctx.auditEvents.events.some((event) => event.event_type === 'DEMO_RESET')).toBe(true);
  });
});
