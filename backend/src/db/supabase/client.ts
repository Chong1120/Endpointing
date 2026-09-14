import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client. Server-side only: it bypasses RLS, so every
 * repository method scopes its queries to an organization explicitly.
 */
export function createServiceClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function assertNoError(error: { message: string } | null, action: string): void {
  if (error) throw new Error(`Database error while ${action}: ${error.message}`);
}
