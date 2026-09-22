import type { SupabaseClient } from '@supabase/supabase-js';

/** A Supabase session, handed to the browser so it can sign in without a password. */
export interface DemoSession {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface DemoAccountService {
  /** Creates the account if it does not exist (and resets the password if it does). Returns the user id. */
  ensureUser(email: string, password: string): Promise<string>;
  signIn(email: string, password: string): Promise<DemoSession>;
}

/**
 * Demo sign-in through Supabase Auth's admin API. Only the server ever sees
 * the passwords; the browser receives a normal session, so from there on the
 * demo accounts behave exactly like accounts someone signed up for.
 */
export class SupabaseDemoAccountService implements DemoAccountService {
  constructor(
    private readonly db: SupabaseClient,
    private readonly supabaseUrl: string,
    private readonly serviceRoleKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async ensureUser(email: string, password: string): Promise<string> {
    const existing = await this.findByEmail(email);
    if (existing) {
      // Keeps the account usable if the secret changed since it was created.
      await this.db.auth.admin.updateUserById(existing, { password, email_confirm: true });
      return existing;
    }
    const { data, error } = await this.db.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) {
      // A parallel first request may have won the race.
      const raced = await this.findByEmail(email);
      if (raced) return raced;
      throw new Error(`Could not create the demo account: ${error?.message ?? 'unknown error'}`);
    }
    return data.user.id;
  }

  /**
   * Straight to the token endpoint rather than `db.auth.signInWithPassword`:
   * signing in on the shared service-role client stores that session on it and
   * sends the demo user's JWT on every later query, dropping the whole API
   * from service_role to authenticated — which RLS denies.
   */
  async signIn(email: string, password: string): Promise<DemoSession> {
    const response = await this.fetchImpl(`${this.supabaseUrl.replace(/\/+$/, '')}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: this.serviceRoleKey, authorization: `Bearer ${this.serviceRoleKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = (await response.json().catch(() => null)) as
      | { access_token?: string; refresh_token?: string; expires_in?: number; user?: { id?: string }; error_description?: string; msg?: string }
      | null;
    if (!response.ok || !body?.access_token || !body.refresh_token || !body.user?.id) {
      throw new Error(`Demo sign-in failed (${response.status}): ${body?.error_description ?? body?.msg ?? 'no session'}`);
    }
    return {
      userId: body.user.id,
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresIn: body.expires_in ?? 3_600,
    };
  }

  private async findByEmail(email: string): Promise<string | null> {
    // listUsers is paginated; the demo project has few users, and the filter
    // keeps it to one page in any case.
    const { data, error } = await this.db.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) throw new Error(`Could not read the demo accounts: ${error.message}`);
    const match = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    return match?.id ?? null;
  }
}
