import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { UserProfile, UserRepository } from '../db/types.js';
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

/** Verifies the bearer token and attaches the caller's organization context. */
export function requireAuth(verifier: AuthVerifier, users: UserRepository): RequestHandler {
  const profiles = new Map<string, { profile: UserProfile; expiresAt: number }>();

  return async (req: Request, _res: Response, next: NextFunction) => {
    const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
    if (!match?.[1]) throw unauthorized();

    const identity = await verifier.verify(match[1]);
    if (!identity) throw unauthorized('Your session has expired. Please sign in again.');

    let profile = profiles.get(identity.userId);
    if (!profile || profile.expiresAt < Date.now()) {
      const loaded = await users.ensureProfile(identity.userId, identity.email, identity.orgName);
      profile = { profile: loaded, expiresAt: Date.now() + 60_000 };
      profiles.set(identity.userId, profile);
    }

    req.auth = {
      userId: profile.profile.userId,
      email: profile.profile.email,
      orgId: profile.profile.orgId,
      orgName: profile.profile.orgName,
      role: profile.profile.role,
    };
    next();
  };
}

export function getAuth(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!roles.includes(getAuth(req).role)) throw forbidden();
    next();
  };
}
