import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import CloudUploadRounded from '@mui/icons-material/CloudUploadRounded';
import ForumRounded from '@mui/icons-material/ForumRounded';
import GraphicEqRounded from '@mui/icons-material/GraphicEqRounded';
import HeadsetMicRounded from '@mui/icons-material/HeadsetMicRounded';
import Inventory2Rounded from '@mui/icons-material/Inventory2Rounded';
import LockRounded from '@mui/icons-material/LockRounded';
import PlaylistPlayRounded from '@mui/icons-material/PlaylistPlayRounded';
import ShieldRounded from '@mui/icons-material/ShieldRounded';
import VerifiedUserRounded from '@mui/icons-material/VerifiedUserRounded';
import { Alert, Box, Button, Grid, Skeleton, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import { CallsTable } from '../components/CallsTable';
import { EmptyState, PageHeader, SectionCard, StatCard } from '../components/common';
import { useApiQuery } from '../hooks/useApiQuery';
import { useDemoCalls } from '../hooks/useDemoCalls';
import { useCan, useMe } from '../hooks/useMe';
import { api } from '../services/api';
import { brand } from '../theme';
import { IN_PROGRESS, numberFormat } from '../utils/format';

function Guarantee({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <Stack direction="row" spacing={1.5}>
      <Box sx={{ width: 32, height: 32, flexShrink: 0, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: alpha(brand.teal, 0.08), color: 'primary.main', '& svg': { fontSize: 18 } }}>
        {icon}
      </Box>
      <Box>
        <Typography variant="body2" sx={{ fontWeight: 650 }}>
          {title}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.5, display: 'block' }}>
          {text}
        </Typography>
      </Box>
    </Stack>
  );
}

export function DashboardPage() {
  const me = useMe();
  const canUpload = useCan('calls:upload');
  const canCall = useCan('agent:call');
  // Roles without analytics still land here; asking anyway would greet them with a permission error.
  const canSeeTotals = useCan('analytics:read');
  const analytics = useApiQuery(async () => (canSeeTotals ? await api.analytics() : null), [canSeeTotals], {
    poll: (d) => (d && d.totals.in_progress > 0 ? 4000 : false),
  });
  const recent = useApiQuery(() => api.listCalls({ page_size: 8 }), [], {
    poll: (d) => (d?.items.some((c) => IN_PROGRESS.includes(c.status)) ? 3000 : false),
  });
  const { loadDemoCalls, running } = useDemoCalls(() => {
    void recent.reload();
    void analytics.reload();
  });

  const totals = analytics.data?.totals;
  const empty = recent.data && recent.data.total === 0;

  return (
    <>
      <PageHeader
        title={me ? `${me.organization.name}` : 'Dashboard'}
        subtitle="Turn sensitive conversations into safe, reusable business data."
        actions={
          <>
            {canUpload && (
              <>
                <Button variant="outlined" startIcon={<PlaylistPlayRounded />} onClick={() => void loadDemoCalls()} disabled={running}>
                  {running ? 'Sending demo calls…' : 'Load demo calls'}
                </Button>
                <Button variant="outlined" startIcon={<CloudUploadRounded />} component={RouterLink} to="/upload">
                  Upload call
                </Button>
              </>
            )}
            {canCall && (
              <Button variant="contained" startIcon={<HeadsetMicRounded />} component={RouterLink} to="/agent">
                Call the live agent
              </Button>
            )}
          </>
        }
      />

      {(analytics.error || recent.error) && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {(analytics.error ?? recent.error)?.message}
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 2, display: canSeeTotals ? undefined : 'none' }}>
        {[
          { label: 'Calls processed', value: totals?.calls, icon: <ForumRounded />, caption: totals ? `${totals.in_progress} in progress · ${totals.failed} failed` : undefined },
          { label: 'PII entities protected', value: totals?.pii_entities, icon: <LockRounded />, caption: 'Redacted from transcript and audio', accent: true },
          { label: 'Safe archives', value: totals?.safe_archives, icon: <Inventory2Rounded />, caption: 'Redacted audio + transcript + insights' },
          {
            label: 'Processing success',
            value: totals ? (totals.success_rate === null ? '—' : `${totals.success_rate}%`) : undefined,
            icon: <CheckCircleRounded />,
            caption: 'Completed ÷ finished calls',
          },
        ].map((stat) => (
          <Grid key={stat.label} size={{ xs: 12, sm: 6, lg: 3 }}>
            <StatCard
              label={stat.label}
              value={stat.value === undefined ? <Skeleton width={80} /> : typeof stat.value === 'number' ? numberFormat.format(stat.value) : stat.value}
              icon={stat.icon}
              caption={stat.caption}
              accent={stat.accent}
            />
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <SectionCard
            title="Recent calls"
            action={
              <Button size="small" component={RouterLink} to="/calls">
                View all
              </Button>
            }
            sx={{ height: '100%' }}
          >
            {recent.loading && !recent.data ? (
              <Stack spacing={1}>
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} variant="rounded" height={44} />
                ))}
              </Stack>
            ) : empty ? (
              <EmptyState
                icon={<ShieldRounded />}
                title="Your safe archive is empty"
                description="Upload a recording, or load four synthetic demo calls. They run through the real AssemblyAI pipeline and include fake names, phone numbers and cards."
                action={
                  canUpload ? (
                    <Stack direction="row" spacing={1}>
                      <Button variant="contained" onClick={() => void loadDemoCalls()} disabled={running} startIcon={<PlaylistPlayRounded />}>
                        {running ? 'Sending…' : 'Load demo calls'}
                      </Button>
                      <Button variant="outlined" component={RouterLink} to="/upload">
                        Upload a call
                      </Button>
                    </Stack>
                  ) : undefined
                }
              />
            ) : (
              <Box sx={{ mx: -2.5 }}>
                <CallsTable items={recent.data?.items ?? []} compact />
              </Box>
            )}
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          <SectionCard title="How every call is protected" sx={{ height: '100%' }}>
            <Stack spacing={2}>
              <Guarantee icon={<GraphicEqRounded />} title="Raw audio is temporary" text="Uploads land in temporary storage and are deleted as soon as AssemblyAI has them." />
              <Guarantee icon={<ShieldRounded />} title="AssemblyAI redacts text and audio" text="Universal-3.5 Pro transcribes and separates speakers; PII is replaced with labels and silenced in the audio." />
              <Guarantee icon={<VerifiedUserRounded />} title="Only safe artifacts are archived" text="Redacted audio sits in a private bucket, playable only through short-lived signed URLs." />
              <Guarantee icon={<AutoAwesomeRounded />} title="AI runs on safe data only" text="LLM Gateway analyzes the redacted transcript. Nothing is sent to an LLM before redaction." />
            </Stack>
          </SectionCard>
        </Grid>
      </Grid>
    </>
  );
}
