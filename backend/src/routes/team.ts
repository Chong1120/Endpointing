import { Router } from 'express';
import { z } from 'zod';
import { badRequest, conflict, notFound } from '../errors.js';
import { INVITE_VALID_FOR_DAYS, createInviteCode, readInviteCode } from '../domain/invite.js';
import { permissionsFor } from '../domain/permissions.js';
import { USER_ROLES } from '../domain/types.js';
import type { AppDeps } from '../http/appDeps.js';
import { parseInput } from '../http/validation.js';
import { getAuth, requirePermission, type ProfileCache } from '../middleware/auth.js';

const RoleBody = z.object({ role: z.enum(USER_ROLES) });
const JoinBody = z.object({ code: z.string().trim().min(8).max(80) });

/**
 * The people in a workspace and what they may do. Everyone signing up gets
 * their own workspace; an invite code (signed, not stored) moves someone into
 * an existing one, where an admin sets their role.
 */
export function teamRouter(deps: AppDeps, profiles: ProfileCache): Router {
  const router = Router();
  const secret = deps.config.assemblyai.webhookSecret;

  router.get('/team', async (req, res) => {
    const auth = getAuth(req);
    const members = await deps.users.listForOrg(auth.orgId);
    const manages = permissionsFor(auth.role).includes('team:manage');
    res.json({
      organization: { id: auth.orgId, name: auth.orgName },
      members: members.map((member) => ({ id: member.userId, email: member.email, role: member.role, is_you: member.userId === auth.userId })),
      invite: manages ? { code: createInviteCode(secret, auth.orgId), valid_for_days: INVITE_VALID_FOR_DAYS } : null,
    });
  });

  router.post('/team/join', async (req, res) => {
    const auth = getAuth(req);
    const { code } = parseInput(JoinBody, req.body);
    const orgId = readInviteCode(secret, code);
    if (!orgId) throw badRequest('That invite code is not valid any more. Ask for a new one.');
    if (orgId === auth.orgId) throw conflict('You are already in this workspace.');

    const organization = await deps.users.findOrganization(orgId);
    if (!organization) throw notFound('That workspace no longer exists.');

    // Calls stay with the workspace they were uploaded to; say how many are left behind.
    const { total } = await deps.calls.list(auth.orgId, { limit: 1, offset: 0 });
    const profile = await deps.users.moveToOrganization(auth.userId, orgId, 'agent');
    profiles.invalidate(auth.userId);
    await deps.audit.record({ orgId, type: 'MEMBER_JOINED', actorId: auth.userId, metadata: { member_id: auth.userId, role: profile.role } });

    res.json({ organization: { id: profile.orgId, name: profile.orgName }, role: profile.role, calls_left_behind: total });
  });

  router.post('/team/invite', requirePermission('team:manage'), (req, res) => {
    const auth = getAuth(req);
    res.json({ code: createInviteCode(secret, auth.orgId), valid_for_days: INVITE_VALID_FOR_DAYS });
  });

  router.patch('/team/members/:userId', requirePermission('team:manage'), async (req, res) => {
    const auth = getAuth(req);
    const { role } = parseInput(RoleBody, req.body);
    const members = await deps.users.listForOrg(auth.orgId);
    const target = members.find((member) => member.userId === req.params.userId);
    if (!target) throw notFound('That person is not in your workspace.');
    if (target.role === 'admin' && role !== 'admin' && members.filter((member) => member.role === 'admin').length === 1) {
      throw conflict('Your workspace needs at least one admin.');
    }

    const updated = await deps.users.setRole(auth.orgId, target.userId, role);
    if (!updated) throw notFound('That person is not in your workspace.');
    profiles.invalidate(target.userId);
    await deps.audit.record({
      orgId: auth.orgId,
      type: 'MEMBER_ROLE_CHANGED',
      actorId: auth.userId,
      metadata: { member_id: target.userId, role, previous_role: target.role },
    });

    res.json({ member: { id: updated.userId, email: updated.email, role: updated.role, is_you: updated.userId === auth.userId } });
  });

  return router;
}
