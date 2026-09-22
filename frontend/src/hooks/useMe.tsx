import { createContext, useContext, type ReactNode } from 'react';
import { useApiQuery } from './useApiQuery';
import { useAuth } from './useAuth';
import { api, type ApiError } from '../services/api';
import type { Me, Permission } from '../services/types';

interface MeState {
  me: Me | null;
  loading: boolean;
  error: ApiError | null;
  reload(): void;
}

const MeContext = createContext<MeState>({ me: null, loading: true, error: null, reload: () => undefined });

/** Loads the signed-in user once for everything below it: role, permissions, workspace, platform settings. */
export function MeProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const query = useApiQuery(() => api.me(), [session?.user.id]);
  return (
    <MeContext.Provider value={{ me: query.data ?? null, loading: query.loading, error: query.error, reload: () => void query.reload() }}>
      {children}
    </MeContext.Provider>
  );
}

/** Profile, organization and platform settings for the signed-in user. */
export function useMe(): Me | null {
  return useContext(MeContext).me;
}

export function useMeState(): MeState {
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
