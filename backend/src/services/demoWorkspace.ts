import { DEMO_ORG_NAME, DEMO_PERSONAS, demoPassword, type DemoPersona } from '../domain/demo.js';
import type { AppDeps } from '../http/appDeps.js';
import { describeError } from '../pipeline/failures.js';
import { intakeCall } from '../pipeline/intake.js';
import { resolvePolicies } from '../services/assemblyai/policies.js';
import type { DemoSession } from './demoAccounts.js';

/**
 * One shared workspace behind the three demo logins. It is built on first use
 * and repaired on every sign-in, so a visitor who changes a role or deletes
 * something cannot leave the next visitor with a broken demo.
 *
 * The seeded calls are the bundled synthetic recordings, run through the real
 * pipeline. Nothing here bypasses redaction.
 */
const SEED_SAMPLES = ['call-d', 'call-b'] as const;

let building: Promise<string> | null = null;

/** Creates the workspace and the three accounts if they are missing, and returns the organization id. */
export async function ensureDemoWorkspace(deps: AppDeps): Promise<string> {
  building ??= build(deps).finally(() => {
    building = null;
  });
  return building;
}

async function build(deps: AppDeps): Promise<string> {
  const organization =
    (await deps.users.findOrganizationByName(DEMO_ORG_NAME)) ?? (await deps.users.createOrganization(DEMO_ORG_NAME));

  for (const persona of DEMO_PERSONAS) {
    const userId = await deps.demoAccounts.ensureUser(persona.email, demoPassword(deps.config.assemblyai.webhookSecret, persona.email));
    await deps.users.upsertProfile({ userId, email: persona.email, orgId: organization.id, role: persona.role });
  }

  return organization.id;
}

/** Signs a visitor in as one of the personas, building the workspace if needed. */
export async function startDemoSession(deps: AppDeps, persona: DemoPersona): Promise<{ orgId: string; session: DemoSession }> {
  const orgId = await ensureDemoWorkspace(deps);
  const session = await deps.demoAccounts.signIn(persona.email, demoPassword(deps.config.assemblyai.webhookSecret, persona.email));
  // Seeding runs in the background: the visitor should not wait on AssemblyAI.
  if (deps.demoSeeding) {
    void seedIfEmpty(deps, orgId).catch((error) => deps.logger.error({ err: describeError(error) }, 'demo seeding failed'));
  }
  return { orgId, session };
}

/**
 * Gives the workspace something to look at: two synthetic calls through the
 * real pipeline, one of them marked as handed to a person so the escalation
 * queue is not empty either.
 */
export async function seedIfEmpty(deps: AppDeps, orgId: string): Promise<number> {
  const { total } = await deps.calls.list(orgId, { limit: 1, offset: 0 });
  if (total > 0) return 0;

  const customer = (await deps.users.listForOrg(orgId)).find((member) => member.role === 'customer');
  const auth = {
    userId: customer?.userId ?? null,
    orgId,
    email: customer?.email ?? '',
    orgName: DEMO_ORG_NAME,
    role: customer?.role ?? ('customer' as const),
  };

  let seeded = 0;
  for (const [index, id] of SEED_SAMPLES.entries()) {
    const sample = await deps.samples.get(id);
    if (!sample) continue;
    const overrides = await deps.policies.listOverrides(orgId);
    const temp = await deps.samples.copyToTemp(sample, deps.config.uploadTmpDir);
    const call = await intakeCall(deps, {
      auth: { ...auth, userId: auth.userId ?? '' },
      tempFilePath: temp.path,
      originalFilename: sample.file,
      sizeBytes: temp.sizeBytes,
      department: sample.department,
      preset: sample.policyPreset,
      policies: resolvePolicies(sample.policyPreset, overrides[sample.policyPreset]),
      analysisEnabled: true,
      source: 'sample',
    });
    seeded += 1;

    // The first one arrives in the support agent's queue.
    if (index === 0) {
      await deps.audit.record({
        orgId,
        callId: call.id,
        type: 'FOLLOW_UP_REQUESTED',
        actorId: auth.userId,
        metadata: { reason: 'customer_requested', channel: 'demo_seed' },
      });
    }
  }
  return seeded;
}

/**
 * Puts the workspace back the way a visitor expects to find it: roles as they
 * should be, calls cleared, then seeded again. Deliberately available to the
 * demo admin, who is meant to be able to break things.
 */
export async function resetDemoWorkspace(deps: AppDeps, orgId: string): Promise<{ deleted: number }> {
  const { items } = await deps.calls.list(orgId, { limit: 200, offset: 0 });
  for (const item of items) {
    const call = await deps.calls.findById(orgId, item.id);
    if (call?.safe_audio_path) await deps.storage.remove([call.safe_audio_path]).catch(() => undefined);
    await deps.calls.delete(item.id);
  }

  for (const persona of DEMO_PERSONAS) {
    const member = (await deps.users.listForOrg(orgId)).find((profile) => profile.email === persona.email);
    if (member && member.role !== persona.role) await deps.users.setRole(orgId, member.userId, persona.role);
  }

  if (deps.demoSeeding) await seedIfEmpty(deps, orgId);
  return { deleted: items.length };
}

/** True when this is the shared demo workspace, which has a few extra rules. */
export async function isDemoWorkspace(deps: AppDeps, orgId: string): Promise<boolean> {
  const organization = await deps.users.findOrganization(orgId);
  return organization?.name === DEMO_ORG_NAME;
}
