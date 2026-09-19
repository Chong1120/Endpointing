import { Router } from 'express';
import { z } from 'zod';
import { POLICY_PRESETS, type PolicyPreset } from '../domain/types.js';
import { badRequest, notFound } from '../errors.js';
import type { AppDeps } from '../http/appDeps.js';
import { parseInput } from '../http/validation.js';
import { getAuth, requirePermission } from '../middleware/auth.js';
import { permissionsFor } from '../domain/permissions.js';
import { SUPPORTED_EXTENSIONS } from '../middleware/upload.js';
import { intakeCall } from '../pipeline/intake.js';
import {
  ASSEMBLYAI_PII_POLICIES,
  POLICY_CATEGORIES,
  PRESET_DEFINITIONS,
  entityLabel,
  isPiiPolicy,
  resolvePolicies,
} from '../services/assemblyai/policies.js';
import { SPEECH_MODELS } from '../services/assemblyai/transcription.js';

const PresetParam = z.enum(POLICY_PRESETS);
const PolicyBodySchema = z.object({ policies: z.array(z.string()).min(1).max(ASSEMBLYAI_PII_POLICIES.length) });
const SampleBodySchema = z.object({ analysis_enabled: z.boolean().default(true) });

function presetParam(value: unknown): PolicyPreset {
  const parsed = PresetParam.safeParse(value);
  if (!parsed.success) throw notFound('Unknown policy preset.');
  return parsed.data;
}

/** Profile, PII policy presets and demo samples. */
export function settingsRouter(deps: AppDeps): Router {
  const router = Router();

  router.get('/me', (req, res) => {
    const auth = getAuth(req);
    res.json({
      user: { id: auth.userId, email: auth.email, role: auth.role, permissions: permissionsFor(auth.role) },
      organization: { id: auth.orgId, name: auth.orgName },
      platform: {
        webhooks_enabled: deps.config.webhooksEnabled,
        max_upload_mb: Math.round(deps.config.maxUploadBytes / (1024 * 1024)),
        redacted_audio_format: deps.config.assemblyai.redactedAudioFormat,
        llm_model: deps.config.llm.model,
        speech_models: [...SPEECH_MODELS],
        supported_extensions: [...SUPPORTED_EXTENSIONS],
      },
    });
  });

  router.get('/policies', async (req, res) => {
    const auth = getAuth(req);
    const overrides = await deps.policies.listOverrides(auth.orgId);
    res.json({
      presets: POLICY_PRESETS.map((preset) => {
        const definition = PRESET_DEFINITIONS[preset];
        return {
          preset,
          label: definition.label,
          description: definition.description,
          default_policies: definition.policies,
          policies: resolvePolicies(preset, overrides[preset]),
          customized: Boolean(overrides[preset]?.length),
        };
      }),
      categories: Object.entries(POLICY_CATEGORIES).map(([name, policies]) => ({
        name,
        policies: policies.map((policy) => ({ name: policy, label: entityLabel(policy) })),
      })),
    });
  });

  router.put('/policies/:preset', requirePermission('policies:write'), async (req, res) => {
    const auth = getAuth(req);
    const preset = presetParam(req.params.preset);
    const { policies } = parseInput(PolicyBodySchema, req.body);
    const invalid = policies.filter((policy) => !isPiiPolicy(policy));
    if (invalid.length > 0) throw badRequest(`Unknown PII policy: ${invalid.join(', ')}.`);
    const unique = [...new Set(policies)];

    await deps.policies.saveOverride(auth.orgId, preset, unique, auth.userId);
    await deps.audit.record({
      orgId: auth.orgId,
      type: 'POLICY_UPDATED',
      actorId: auth.userId,
      metadata: { preset, policies: unique, policies_count: unique.length },
    });
    res.json({ preset, policies: unique, customized: true });
  });

  router.delete('/policies/:preset', requirePermission('policies:write'), async (req, res) => {
    const auth = getAuth(req);
    const preset = presetParam(req.params.preset);
    await deps.policies.deleteOverride(auth.orgId, preset);
    await deps.audit.record({ orgId: auth.orgId, type: 'POLICY_UPDATED', actorId: auth.userId, metadata: { preset, reset: true } });
    res.json({ preset, policies: PRESET_DEFINITIONS[preset].policies, customized: false });
  });

  router.get('/demo/samples', async (_req, res) => {
    res.json(await deps.samples.list());
  });

  // Runs a bundled synthetic recording through the real pipeline (real AssemblyAI calls).
  router.post('/demo/samples/:id', requirePermission('calls:upload'), async (req, res) => {
    const auth = getAuth(req);
    const sample = await deps.samples.get(String(req.params.id));
    if (!sample) throw notFound('Sample not found.');
    const body = parseInput(SampleBodySchema, req.body ?? {});
    const overrides = await deps.policies.listOverrides(auth.orgId);
    const temp = await deps.samples.copyToTemp(sample, deps.config.uploadTmpDir);

    const call = await intakeCall(deps, {
      auth,
      tempFilePath: temp.path,
      originalFilename: sample.file,
      sizeBytes: temp.sizeBytes,
      department: sample.department,
      preset: sample.policyPreset,
      policies: resolvePolicies(sample.policyPreset, overrides[sample.policyPreset]),
      analysisEnabled: body.analysis_enabled,
      source: 'sample',
    });
    res.status(202).json({ call: { ...call, reference: `CALL-${call.call_number}` } });
  });

  return router;
}
