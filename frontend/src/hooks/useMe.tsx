import { createContext, useContext } from 'react';
import type { Me, Permission } from '../services/types';

export const MeContext = createContext<Me | null>(null);

/** Profile, organization and platform settings for the signed-in user (loaded by AppLayout). */
export function useMe(): Me | null {
  return useContext(MeContext);
}

/**
 * What this user's role allows, as decided by the API. The UI hides what a role
 * cannot do; the API enforces it (backend/src/domain/permissions.ts).
 */
export function useCan(permission: Permission): boolean {
  const me = useMe();
  return me?.user.permissions.includes(permission) ?? false;
}
