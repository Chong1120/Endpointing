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
    filters: { callId?: string; eventType?: string; limit: number; offset: number },
  ): Promise<{ items: AuditListItem[]; total: number }> {
    let query = this.db
      .from('audit_logs')
      .select('*, calls(call_number)', { count: 'exact' })
      .eq('organization_id', orgId);
    if (filters.callId) query = query.eq('call_id', filters.callId);
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
