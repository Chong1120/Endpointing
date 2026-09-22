import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../services/api';
import { supabase } from '../services/supabase';
import type { DemoPersona } from '../services/types';

interface AuthState {
  session: Session | null;
  loading: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, organizationName: string): Promise<{ needsConfirmation: boolean }>;
  /** Signs in as one of the shared demo personas. The API holds the password; we only get a session. */
  signInAsDemo(persona: DemoPersona['key']): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      loading,
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message);
      },
      async signUp(email, password, organizationName) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { organization_name: organizationName } },
        });
        if (error) throw new Error(error.message);
        return { needsConfirmation: !data.session };
      },
      async signInAsDemo(persona) {
        const { session: demo } = await api.demoLogin(persona);
        const { error } = await supabase.auth.setSession({ access_token: demo.access_token, refresh_token: demo.refresh_token });
        if (error) throw new Error(error.message);
      },
      async signOut() {
        await supabase.auth.signOut();
      },
    }),
    [session, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
