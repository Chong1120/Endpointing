import type { UserRole } from './types.js';

/**
 * What each role may do. Roles map to the jobs around a contact centre: an
 * admin runs the workspace, an analyst studies the safe archive, a support
 * agent works the calls the AI handed over, and a viewer only looks.
 */
export const PERMISSIONS = [
  'calls:read',
  'calls:upload',
  'calls:delete',
  'calls:recheck',
  'policies:write',
  'export',
  'audit:read',
  'followups:read',
  'followups:resolve',
  'agent:call',
  'team:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  admin: PERMISSIONS,
  analyst: ['calls:read', 'calls:upload', 'export', 'audit:read', 'followups:read', 'agent:call'],
  agent: ['calls:read', 'followups:read', 'followups:resolve', 'agent:call'],
  viewer: ['calls:read', 'audit:read'],
};

export function permissionsFor(role: UserRole): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.viewer)];
}

export function can(role: UserRole, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}
