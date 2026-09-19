import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { UserProfile, UserRepository } from '../db/types.js';
import { can, type Permission } from '../domain/permissions.js';
import type { AuthContext, UserRole } from '../domain/types.js';
import { forbidden, unauthorized } from '../errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export interface VerifiedIdentity {
  userId: string;
  email: string;
  orgName: string;
}

export interface AuthVerifier {
  /** Validates a Supabase access token. Returns null for invalid/expired tokens. */
  verify(accessToken: string): Promise<VerifiedIdentity | null>;
}

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com',
  'proton.me', 'protonmail.com', 'aol.com', 'gmx.com', 'mail.com',
]);

export function defaultOrganizationName(email: string, requested?: unknown): string {
  if (typeof requested === 'string' && requested.trim()) return requested.trim().slice(0, 80);
  const [local = 'My', domain = ''] = email.toLowerCase().split('@');
  if (domain && !FREE_EMAIL_DOMAINS.has(domain)) {
    const name = domain.split('.')[0] ?? domain;
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return `${local}'s organization`;
}

export class SupabaseAuthVerifier implements AuthVerifier {
  private readonly cache = new Map<string, { identity: VerifiedIdentity; expiresAt: number }>();

  constructor(private readonly db: SupabaseClient) {}

  async verify(accessToken: string): Promise<VerifiedIdentity | null> {
    const cached = this.cache.get(accessToken);
    if (cached && cached.expiresAt > Date.now()) return cached.identity;

    const { data, error } = await this.db.auth.getUser(accessToken);
    if (error || !data.user) return null;
    const identity = toIdentity(data.user);
    if (this.cache.size > 1000) this.cache.clear();
    this.cache.set(accessToken, { identity, expiresAt: Date.now() + 60_000 });
    return identity;
  }
}

function toIdentity(user: User): VerifiedIdentity {
  const email = user.email ?? '';
  return {
    userId: user.id,
    email,
    orgName: defaultOrganizationName(email, user.user_metadata?.organization_name),
  };
}

/**
 * Profiles are cached for a minute so every request doesn't hit the database.
 * Joining a team or changing someone's role drops their entry, so the change
 * takes effect on the next request instead of a minute later.
 */
export class ProfileCache {
  private readonly entries = new Map<string, { profile: UserProfile; expiresAt: number }>();

  get(userId: string): UserProfile | null {
    const entry = this.entries.get(userId);
    return entry && entry.expiresAt > Date.now() ? entry.profile : null;
  }

  set(profile: UserProfile) {
    if (this.entries.size > 1_000) this.entries.clear();
    this.entries.set(profile.userId, { profile, expiresAt: Date.now() + 60_000 });
  }

  invalidate(userId: string) {
    this.entries.delete(userId);
  }
}

/** Verifies the bearer token and attaches the caller's organization context. */
export function requireAuth(verifier: AuthVerifier, users: UserRepository, profiles = new ProfileCache()): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
    if (!match?.[1]) throw unauthorized();

    const identity = await verifier.verify(match[1]);
    if (!identity) throw unauthorized('Your session has expired. Please sign in again.');

    let profile = profiles.get(identity.userId);
    if (!profile) {
      profile = await users.ensureProfile(identity.userId, identity.email, identity.orgName);
      profiles.set(profile);
    }

    req.auth = { userId: profile.userId, email: profile.email, orgId: profile.orgId, orgName: profile.orgName, role: profile.role };
    next();
  };
}

export function getAuth(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

/** Route guard for what a role may do; see domain/permissions.ts. */
export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    if (!can(getAuth(req).role, permission)) throw forbidden(FORBIDDEN_MESSAGE[permission]);
    next();
  };
}

const FORBIDDEN_MESSAGE: Partial<Record<Permission, string>> = {
  'calls:upload': 'Your role cannot add calls. Ask an admin to change your role.',
  'calls:delete': 'Only an admin can delete a call.',
  'calls:recheck': 'Only an admin can re-run redaction.',
  'policies:write': 'Only an admin can change PII policies.',
  export: 'Your role cannot export the safe dataset.',
  'followups:resolve': 'Only a support agent or admin can close an escalation.',
  'team:manage': 'Only an admin can manage the team.',
};
