import type { UserRole } from './types.js';

/**
 * What each role may do. Roles map to the people around a contact centre: a
 * customer calls in, a support agent works the calls the AI handed over, an
 * analyst studies the safe archive, an admin runs the workspace, and a viewer
 * only looks.
 *
 * `calls:read` is permission to read calls at all; `calls:read:all` is
 * permission to read everyone's. A customer has the first and not the second,
 * so they only ever see the calls they made.
 */
export const PERMISSIONS = [
  'calls:read',
  'calls:read:all',
  'calls:browse',
  'calls:upload',
  'calls:delete',
  'calls:recheck',
  'analytics:read',
  'policies:write',
  'export',
  'audit:read',
  'followups:read',
  'followups:resolve',
  'agent:call',
  'team:read',
  'team:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  admin: PERMISSIONS,
  analyst: ['calls:read', 'calls:read:all', 'calls:browse', 'calls:upload', 'analytics:read', 'export', 'audit:read', 'followups:read'],
  /**
   * A support agent works a queue, so they get the queue and the calls on it —
   * not the archive, the analytics or the team. They also have no business
   * phoning the AI agent: they are the person it hands calls to.
   */
  agent: ['calls:read', 'calls:read:all', 'followups:read', 'followups:resolve'],
  viewer: ['calls:read', 'calls:read:all', 'calls:browse', 'audit:read'],
  customer: ['calls:read', 'agent:call'],
};

export function permissionsFor(role: UserRole): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.viewer)];
}

export function can(role: UserRole, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}
