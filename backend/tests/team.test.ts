import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createInviteCode, readInviteCode } from '../src/domain/invite.js';
import { permissionsFor } from '../src/domain/permissions.js';
import type { UserRole } from '../src/domain/types.js';
import { buildTestDeps } from './support/fakes.js';

let tmp: string;
let ctx: ReturnType<typeof buildTestDeps>;
let app: ReturnType<typeof createApp>;

const SECRET = 'test-webhook-secret-0123456789';
const MISSING_CALL = '2a2b8f3e-0000-4000-8000-000000000000';
const ORG_A = '2a2b8f3e-1111-4000-8000-00000000000a';
const ORG_B = '2a2b8f3e-2222-4000-8000-00000000000b';

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'safecall-team-'));
  ctx = buildTestDeps({ uploadTmpDir: tmp });
  app = createApp(ctx.deps);
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Adds a signed-in user with a role, in a given workspace. */
function member(token: string, role: UserRole, orgId = ORG_A, orgName = 'Northwind') {
  const identity = ctx.authVerifier.addUser(token);
  ctx.users.profiles.set(identity.userId, { userId: identity.userId, email: identity.email, orgId, orgName, role });
  return identity;
}

describe('what each role may do', () => {
  it('gives every role the permissions it needs and nothing more', () => {
    expect(permissionsFor('admin')).toContain('team:manage');
    expect(permissionsFor('analyst')).toEqual(expect.arrayContaining(['calls:browse', 'analytics:read', 'export', 'calls:upload']));
    expect(permissionsFor('analyst')).not.toContain('followups:resolve');
    // A support agent gets the queue and the calls on it: no archive, no
    // analytics, no team, and no phoning the AI agent they take calls from.
    expect(permissionsFor('agent')).toEqual(['calls:read', 'calls:read:all', 'followups:read', 'followups:resolve']);
    expect(permissionsFor('viewer')).toEqual(['calls:read', 'calls:read:all', 'calls:browse', 'audit:read']);
    // A customer may call the agent and read their own calls, and nothing else.
    expect(permissionsFor('customer')).toEqual(['calls:read', 'agent:call']);
  });

  it('tells the browser what the signed-in user may do', async () => {
    member('ana', 'analyst');
    const res = await request(app).get('/api/me').set(as('ana'));
    expect(res.body.user).toMatchObject({ role: 'analyst' });
    expect(res.body.user.permissions).toContain('export');
    expect(res.body.user.permissions).not.toContain('policies:write');
  });

  it('keeps a support agent to their queue', async () => {
    member('sam', 'agent');
    for (const path of ['/api/export?format=csv', '/api/search?q=bill', '/api/analytics', '/api/team']) {
      expect((await request(app).get(path).set(as('sam'))).status).toBe(403);
    }
    expect((await request(app).put('/api/policies/CUSTOM').set(as('sam')).send({ policies: ['PERSON_NAME'] })).status).toBe(403);
    expect((await request(app).delete(`/api/calls/${MISSING_CALL}`).set(as('sam'))).status).toBe(403);
    expect((await request(app).post('/api/demo/samples/anything').set(as('sam'))).status).toBe(403);
    // The agent is who the AI hands calls to; they don't phone it themselves.
    expect((await request(app).post('/api/voice-agent/session').set(as('sam'))).status).toBe(403);

    // The queue, and the calls on it, are their job.
    expect((await request(app).get('/api/follow-ups').set(as('sam'))).status).toBe(200);
    expect((await request(app).get('/api/calls').set(as('sam'))).status).toBe(200);
  });

  it('lets an analyst read the queue but not close anything on it', async () => {
    member('ana', 'analyst');
    expect((await request(app).get('/api/follow-ups').set(as('ana'))).status).toBe(200);
    expect((await request(app).post(`/api/calls/${MISSING_CALL}/follow-up/resolve`).set(as('ana'))).status).toBe(403);
    expect((await request(app).get('/api/export?format=csv').set(as('ana'))).status).toBe(200);
  });

  it('keeps a viewer out of the queue and the live agent', async () => {
    member('vic', 'viewer');
    expect((await request(app).get('/api/follow-ups').set(as('vic'))).status).toBe(403);
    expect((await request(app).post('/api/voice-agent/session').set(as('vic'))).status).toBe(403);
    expect((await request(app).get('/api/calls').set(as('vic'))).status).toBe(200);
  });
});

describe('invite codes', () => {
  it('carries the workspace, and only survives untouched, unexpired and signed with our secret', () => {
    const code = createInviteCode(SECRET, '2a2b8f3e-1111-4000-8000-000000000042');
    expect(readInviteCode(SECRET, code)).toBe('2a2b8f3e-1111-4000-8000-000000000042');
    expect(readInviteCode(SECRET, code.toLowerCase())).toBe('2a2b8f3e-1111-4000-8000-000000000042');
    expect(readInviteCode('another-secret-0123456789', code)).toBeNull();
    expect(readInviteCode(SECRET, `${code}x`)).toBeNull();
    expect(readInviteCode(SECRET, code, Date.now() + 8 * 24 * 60 * 60 * 1_000)).toBeNull();
    expect(readInviteCode(SECRET, 'nonsense')).toBeNull();
  });
});

describe('a workspace and its people', () => {
  it('shows the roster and the invite code to admins, and hides the page from everyone else', async () => {
    member('ada', 'admin');
    member('sam', 'agent');
    member('ana', 'analyst');

    const admin = await request(app).get('/api/team').set(as('ada'));
    expect(admin.body.members.map((m: { email: string; role: string }) => [m.email, m.role])).toEqual([
      ['ada@example.com', 'admin'],
      ['sam@example.com', 'agent'],
      ['ana@example.com', 'analyst'],
    ]);
    expect(admin.body.members.find((m: { is_you: boolean; email: string }) => m.is_you).email).toBe('ada@example.com');
    expect(readInviteCode(SECRET, admin.body.invite.code)).toBe(ORG_A);

    // Managing people is the admin's job; nobody else needs the page.
    expect((await request(app).get('/api/team').set(as('sam'))).status).toBe(403);
    expect((await request(app).get('/api/team').set(as('ana'))).status).toBe(403);
    expect((await request(app).post('/api/team/invite').set(as('sam'))).status).toBe(403);

    // Joining stays open: everyone is an admin of their own workspace until they join another.
    expect((await request(app).post('/api/team/join').set(as('sam')).send({ code: 'NOT-A-CODE' })).status).toBe(400);
  });

  it('moves someone into the workspace when they redeem a code, and their new role applies at once', async () => {
    member('ada', 'admin');
    const newcomer = member('noor', 'admin', ORG_B, "Noor's organization");

    const { body } = await request(app).post('/api/team/invite').set(as('ada'));
    const joined = await request(app).post('/api/team/join').set(as('noor')).send({ code: body.code });
    expect(joined.status).toBe(200);
    expect(joined.body).toMatchObject({ organization: { id: ORG_A, name: 'Northwind' }, role: 'agent', calls_left_behind: 0 });

    // No stale cached profile: the next request is already in the new workspace, as an agent.
    const me = await request(app).get('/api/me').set(as('noor'));
    expect(me.body).toMatchObject({ user: { role: 'agent' }, organization: { id: ORG_A, name: 'Northwind' } });
    expect((await request(app).get('/api/export?format=csv').set(as('noor'))).status).toBe(403);

    const promoted = await request(app).patch(`/api/team/members/${newcomer.userId}`).set(as('ada')).send({ role: 'analyst' });
    expect(promoted.status).toBe(200);
    expect(promoted.body.member).toMatchObject({ role: 'analyst' });
    expect((await request(app).get('/api/export?format=csv').set(as('noor'))).status).toBe(200);

    expect(ctx.auditEvents.events.map((event) => event.event_type)).toEqual(expect.arrayContaining(['MEMBER_JOINED', 'MEMBER_ROLE_CHANGED']));
    expect(JSON.stringify(ctx.auditEvents.events)).not.toContain('@example.com');
  });

  it('refuses a stale code, a code for the workspace you are already in, and a member of another workspace', async () => {
    member('ada', 'admin');
    const outsider = member('bo', 'admin', ORG_B, 'Other company');

    expect((await request(app).post('/api/team/join').set(as('ada')).send({ code: 'NOT-A-CODE' })).status).toBe(400);
    const own = await request(app).post('/api/team/invite').set(as('ada'));
    expect((await request(app).post('/api/team/join').set(as('ada')).send({ code: own.body.code })).status).toBe(409);
    expect((await request(app).post('/api/team/join').set(as('ada')).send({ code: createInviteCode(SECRET, '2a2b8f3e-4040-4000-8000-000000000404') })).status).toBe(404);

    const res = await request(app).patch(`/api/team/members/${outsider.userId}`).set(as('ada')).send({ role: 'viewer' });
    expect(res.status).toBe(404);
    expect(ctx.users.profiles.get(outsider.userId)?.role).toBe('admin');
  });

  it('keeps at least one admin and rejects a role that does not exist', async () => {
    const solo = member('ada', 'admin');
    member('sam', 'agent');

    const demote = await request(app).patch(`/api/team/members/${solo.userId}`).set(as('ada')).send({ role: 'viewer' });
    expect(demote.status).toBe(409);
    expect((await request(app).patch(`/api/team/members/${solo.userId}`).set(as('ada')).send({ role: 'owner' })).status).toBe(400);
  });
});
