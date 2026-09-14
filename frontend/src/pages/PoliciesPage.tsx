import PolicyRounded from '@mui/icons-material/PolicyRounded';
import RestartAltRounded from '@mui/icons-material/RestartAltRounded';
import SaveRounded from '@mui/icons-material/SaveRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  Checkbox,
  Chip,
  FormControlLabel,
  Grid,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader, SectionCard } from '../components/common';
import { useApiQuery } from '../hooks/useApiQuery';
import { useMe } from '../hooks/useMe';
import { useNotify } from '../hooks/useNotify';
import { api, ApiError } from '../services/api';
import type { PolicyPreset } from '../services/types';
import { brand } from '../theme';

export function PoliciesPage() {
  const me = useMe();
  const notify = useNotify();
  const policies = useApiQuery(() => api.policies(), []);
  const [selected, setSelected] = useState<PolicyPreset>('CONTACT_CENTER');
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const current = policies.data?.presets.find((p) => p.preset === selected);
  useEffect(() => {
    if (current) setDraft(new Set(current.policies));
  }, [current]);

  const dirty = useMemo(() => {
    if (!current) return false;
    return current.policies.length !== draft.size || current.policies.some((p) => !draft.has(p));
  }, [current, draft]);

  const canEdit = me?.user.role === 'admin';

  function toggle(name: string) {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      await api.savePolicy(selected, [...draft]);
      notify(`${current?.label} policy saved. It applies to new uploads.`);
      await policies.reload();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not save the policy.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    try {
      await api.resetPolicy(selected);
      notify(`${current?.label} policy reset to the default.`);
      await policies.reload();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not reset the policy.', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="PII policies"
        subtitle="Each preset is a list of AssemblyAI PII entity types (redact_pii_policies). The preset chosen at upload decides what is redacted from the transcript and silenced in the audio."
      />
      {policies.error && <Alert severity="error">{policies.error.message}</Alert>}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Stack spacing={1.5}>
            {(policies.data?.presets ?? []).map((preset) => {
              const active = preset.preset === selected;
              return (
                <Card key={preset.preset} sx={{ borderColor: active ? 'primary.main' : 'divider', boxShadow: active ? `0 0 0 1px ${brand.teal}` : 'none', bgcolor: active ? alpha(brand.teal, 0.04) : undefined }}>
                  <CardActionArea onClick={() => setSelected(preset.preset)} sx={{ p: 2 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <PolicyRounded sx={{ color: 'primary.main', fontSize: 20 }} />
                      <Typography sx={{ fontWeight: 650, flex: 1 }}>{preset.label}</Typography>
                      {preset.customized && <Chip size="small" label="Customized" color="primary" variant="outlined" />}
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75, lineHeight: 1.5 }}>
                      {preset.description}
                    </Typography>
                    <Typography variant="caption" sx={{ display: 'block', mt: 1, fontWeight: 600 }}>
                      {preset.policies.length} entity types
                    </Typography>
                  </CardActionArea>
                </Card>
              );
            })}
            {policies.loading && !policies.data && [0, 1, 2, 3].map((i) => <Skeleton key={i} variant="rounded" height={110} />)}
          </Stack>
        </Grid>
        <Grid size={{ xs: 12, md: 8 }}>
          <SectionCard
            title={current ? `${current.label} · ${draft.size} selected` : 'Policy'}
            action={
              canEdit && current ? (
                <Stack direction="row" spacing={1}>
                  {current.customized && (
                    <Button size="small" startIcon={<RestartAltRounded />} onClick={() => void reset()} disabled={saving}>
                      Reset to default
                    </Button>
                  )}
                  <Button size="small" variant="contained" startIcon={<SaveRounded />} onClick={() => void save()} disabled={!dirty || draft.size === 0 || saving}>
                    Save changes
                  </Button>
                </Stack>
              ) : null
            }
          >
            {!canEdit && (
              <Alert severity="info" sx={{ mb: 2 }}>
                Only organization admins can change policies.
              </Alert>
            )}
            <Stack spacing={2.5}>
              {(policies.data?.categories ?? []).map((category) => (
                <Box key={category.name}>
                  <Typography variant="overline" color="text.secondary">
                    {category.name}
                  </Typography>
                  <Grid container>
                    {category.policies.map((policy) => (
                      <Grid key={policy.name} size={{ xs: 12, sm: 6, lg: 4 }}>
                        <FormControlLabel
                          control={<Checkbox size="small" checked={draft.has(policy.name)} onChange={() => toggle(policy.name)} disabled={!canEdit} />}
                          label={<Typography variant="body2">{policy.label}</Typography>}
                        />
                      </Grid>
                    ))}
                  </Grid>
                </Box>
              ))}
            </Stack>
            <Alert severity="info" variant="outlined" sx={{ mt: 2.5 }}>
              Changes apply to new uploads. Existing archives keep the policy they were processed with, as shown in each call's audit trail. A full mailing address is matched by <b>Location address</b>. Standalone fragments such as a city or ZIP code need their own types.
            </Alert>
          </SectionCard>
        </Grid>
      </Grid>
    </>
  );
}
