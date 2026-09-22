import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuditEvent, PolicyPreset, UserRole } from '../../domain/types.js';
import type {
  AuditListItem,
  AuditRepository,
  NewAuditEvent,
  PolicyRepository,
  UserProfile,
  UserRepository,
} from '../types.js';
import { assertNoError } from './client.js';

export class SupabaseAuditRepository implements AuditRepository {
  constructor(private readonly db: SupabaseClient) {}

  async insert(event: NewAuditEvent): Promise<void> {
    const { error } = await this.db.from('audit_logs').insert(event);
    assertNoError(error, 'writing audit event');
  }

  async listForCall(orgId: string, callId: string): Promise<AuditEvent[]> {
    const { data, error } = await this.db
      .from('audit_logs')
      .select('*')
      .eq('organization_id', orgId)
      .eq('call_id', callId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(1000);
    assertNoError(error, 'reading audit trail');
    return (data ?? []) as AuditEvent[];
  }

  async listForOrg(
    orgId: string,
    filters: { callId?: string; eventType?: string; since?: string; limit: number; offset: number },
  ): Promise<{ items: AuditListItem[]; total: number }> {
    let query = this.db
      .from('audit_logs')
      .select('*, calls(call_number)', { count: 'exact' })
      .eq('organization_id', orgId);
    if (filters.callId) query = query.eq('call_id', filters.callId);
    if (filters.since) query = query.gte('created_at', filters.since);
    if (filters.eventType) query = query.eq('event_type', filters.eventType);
    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(filters.offset, filters.offset + filters.limit - 1);
    assertNoError(error, 'reading audit log');
    const items = ((data ?? []) as Array<AuditEvent & { calls: { call_number: number } | null }>).map(
      ({ calls, ...event }) => ({ ...event, call_number: calls ? Number(calls.call_number) : null }),
    );
    return { items, total: count ?? 0 };
  }
}

export class SupabaseUserRepository implements UserRepository {
  constructor(private readonly db: SupabaseClient) {}

  async ensureProfile(userId: string, email: string, orgName: string): Promise<UserProfile> {
    const { data, error } = await this.db.rpc('ensure_user_profile', {
      p_user_id: userId,
      p_email: email,
      p_org_name: orgName,
    });
    assertNoError(error, 'loading user profile');
    const row = (Array.isArray(data) ? data[0] : data) as
      | { user_id: string; organization_id: string; email: string; role: UserRole; organization_name: string }
      | undefined;
    if (!row) throw new Error('User profile could not be created.');
    return { userId: row.user_id, email: row.email, orgId: row.organization_id, orgName: row.organization_name, role: row.role };
  }

  async listForOrg(orgId: string): Promise<UserProfile[]> {
    const { data, error } = await this.db
      .from('users')
      .select('id, email, role, organization_id, organizations(name)')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true });
    assertNoError(error, 'reading team members');
    return (data ?? []).map((row) => toProfile(row as MemberRow));
  }

  async setRole(orgId: string, userId: string, role: UserRole): Promise<UserProfile | null> {
    const { data, error } = await this.db
      .from('users')
      .update({ role })
      .eq('id', userId)
      .eq('organization_id', orgId)
      .select('id, email, role, organization_id, organizations(name)')
      .maybeSingle();
    assertNoError(error, 'changing a role');
    return data ? toProfile(data as MemberRow) : null;
  }

  async moveToOrganization(userId: string, orgId: string, role: UserRole): Promise<UserProfile> {
    const { data, error } = await this.db
      .from('users')
      .update({ organization_id: orgId, role })
      .eq('id', userId)
      .select('id, email, role, organization_id, organizations(name)')
      .maybeSingle();
    assertNoError(error, 'joining a team');
    if (!data) throw new Error('The profile could not be moved.');
    return toProfile(data as MemberRow);
  }

  async findOrganization(orgId: string): Promise<{ id: string; name: string } | null> {
    const { data, error } = await this.db.from('organizations').select('id, name').eq('id', orgId).maybeSingle();
    assertNoError(error, 'reading an organization');
    return data ? { id: data.id as string, name: data.name as string } : null;
  }

  async findOrganizationByName(name: string): Promise<{ id: string; name: string } | null> {
    const { data, error } = await this.db.from('organizations').select('id, name').eq('name', name).limit(1).maybeSingle();
    assertNoError(error, 'reading an organization');
    return data ? { id: data.id as string, name: data.name as string } : null;
  }

  async createOrganization(name: string): Promise<{ id: string; name: string }> {
    const { data, error } = await this.db.from('organizations').insert({ name }).select('id, name').single();
    assertNoError(error, 'creating an organization');
    if (!data) throw new Error('The organization could not be created.');
    return { id: data.id as string, name: data.name as string };
  }

  async upsertProfile({ userId, email, orgId, role }: { userId: string; email: string; orgId: string; role: UserRole }): Promise<UserProfile> {
    const { data, error } = await this.db
      .from('users')
      .upsert({ id: userId, email, organization_id: orgId, role }, { onConflict: 'id' })
      .select('id, email, role, organization_id, organizations(name)')
      .single();
    assertNoError(error, 'saving a profile');
    return toProfile(data as unknown as MemberRow);
  }
}

interface MemberRow {
  id: string;
  email: string;
  role: UserRole;
  organization_id: string;
  organizations: { name: string } | { name: string }[] | null;
}

function toProfile(row: MemberRow): UserProfile {
  const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
  return { userId: row.id, email: row.email, orgId: row.organization_id, orgName: org?.name ?? 'Organization', role: row.role };
}

export class SupabasePolicyRepository implements PolicyRepository {
  constructor(private readonly db: SupabaseClient) {}

  async listOverrides(orgId: string): Promise<Partial<Record<PolicyPreset, string[]>>> {
    const { data, error } = await this.db
      .from('pii_policy_settings')
      .select('preset, policies')
      .eq('organization_id', orgId);
    assertNoError(error, 'reading policy settings');
    const overrides: Partial<Record<PolicyPreset, string[]>> = {};
    for (const row of (data ?? []) as Array<{ preset: PolicyPreset; policies: string[] }>) {
      overrides[row.preset] = row.policies;
    }
    return overrides;
  }

  async saveOverride(orgId: string, preset: PolicyPreset, policies: string[], actorId: string): Promise<void> {
    const { error } = await this.db.from('pii_policy_settings').upsert(
      { organization_id: orgId, preset, policies, updated_by: actorId, updated_at: new Date().toISOString() },
      { onConflict: 'organization_id,preset' },
    );
    assertNoError(error, 'saving policy settings');
  }

  async deleteOverride(orgId: string, preset: PolicyPreset): Promise<void> {
    const { error } = await this.db
      .from('pii_policy_settings')
      .delete()
      .eq('organization_id', orgId)
      .eq('preset', preset);
    assertNoError(error, 'resetting policy settings');
  }
}
