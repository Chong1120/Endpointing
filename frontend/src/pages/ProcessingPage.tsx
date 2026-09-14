import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import CloudUploadRounded from '@mui/icons-material/CloudUploadRounded';
import LockRounded from '@mui/icons-material/LockRounded';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import VerifiedUserRounded from '@mui/icons-material/VerifiedUserRounded';
import { Alert, Box, Button, Card, CardContent, Grid, Skeleton, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router';
import { PageHeader, PiiBreakdown, SectionCard } from '../components/common';
import { PipelineBanner, phaseStates } from '../components/PipelineBanner';
import { ProcessingSteps } from '../components/ProcessingSteps';
import { StatusBadge } from '../components/StatusBadge';
import { useApiQuery } from '../hooks/useApiQuery';
import { useNotify } from '../hooks/useNotify';
import { api, ApiError } from '../services/api';
import { brand } from '../theme';
import { IN_PROGRESS, PRESET_LABELS, formatSeconds } from '../utils/format';

function useElapsed(since: string | undefined, running: boolean, until?: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  if (!since) return null;
  const end = until ? Date.parse(until) : now;
  return Math.max(0, (end - Date.parse(since)) / 1000);
}

export function ProcessingPage() {
  const { id = '' } = useParams();
  const notify = useNotify();
  const detail = useApiQuery(() => api.getCall(id), [id], {
    poll: (d) => (!d || IN_PROGRESS.includes(d.call.status) ? 2000 : false),
  });
  const [retrying, setRetrying] = useState(false);

  const call = detail.data?.call;
  const audit = detail.data?.audit ?? [];
  const inProgress = call ? IN_PROGRESS.includes(call.status) : true;
  const elapsed = useElapsed(call?.created_at, inProgress, call?.status === 'COMPLETED' ? call.processed_at : null);

  async function retry() {
    setRetrying(true);
    try {
      await api.retry(id);
      notify('Retry started — resuming from the failed step.', 'info');
      await detail.reload();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Retry failed.', 'error');
    } finally {
      setRetrying(false);
    }
  }

  if (detail.error && !call) {
    return <Alert severity="error">{detail.error.message}</Alert>;
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <Typography variant="overline" color="primary">
            Processing
          </Typography>
        }
        title={
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <span>{call?.reference ?? <Skeleton width={160} />}</span>
            {call && <StatusBadge status={call.status} />}
          </Stack>
        }
        subtitle={call ? `${call.original_filename} · ${call.department} · ${PRESET_LABELS[call.policy_preset]} policy` : undefined}
      />

      <Box sx={{ mb: 2.5 }}>
        <PipelineBanner states={call ? phaseStates(new Set(audit.map((e) => e.event_type)), call.status) : ['active', 'pending', 'pending', 'pending']} />
      </Box>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, md: 7 }}>
          <SectionCard title="Pipeline" action={elapsed !== null && <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatSeconds(elapsed)}</Typography>}>
            {call ? <ProcessingSteps call={call} audit={audit} /> : <Skeleton variant="rounded" height={420} />}
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Stack spacing={2.5}>
            {call?.status === 'COMPLETED' && (
              <Card sx={{ borderColor: alpha(brand.teal, 0.4), background: `linear-gradient(180deg, ${alpha(brand.teal, 0.07)}, #fff 70%)` }}>
                <CardContent sx={{ p: 3 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', color: 'success.main' }}>
                    <VerifiedUserRounded />
                    <Typography variant="overline" sx={{ color: 'success.main' }}>
                      Safe archive created
                    </Typography>
                  </Stack>
                  <Typography sx={{ fontSize: '2.6rem', fontWeight: 750, letterSpacing: '-0.02em', mt: 1, lineHeight: 1.1 }}>
                    {call.pii_total}
                  </Typography>
                  <Typography color="text.secondary" sx={{ mb: 2 }}>
                    PII {call.pii_total === 1 ? 'entity' : 'entities'} protected
                  </Typography>
                  <PiiBreakdown counts={call.pii_counts} />
                  <Button
                    variant="contained"
                    size="large"
                    endIcon={<ArrowForwardRounded />}
                    component={RouterLink}
                    to={`/calls/${call.id}`}
                    sx={{ mt: 3 }}
                    fullWidth
                  >
                    Open safe archive
                  </Button>
                </CardContent>
              </Card>
            )}

            {call?.status === 'FAILED' && (
              <Card sx={{ borderColor: 'error.light' }}>
                <CardContent sx={{ p: 3 }}>
                  <Typography variant="overline" color="error">
                    Processing stopped
                  </Typography>
                  <Typography sx={{ mt: 0.5, fontWeight: 600 }}>{call.error_message ?? 'Something went wrong while processing this call.'}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    {call.can_retry
                      ? 'Everything completed before this step is kept. Retry resumes from the failed step.'
                      : 'The raw recording was deliberately not kept, so upload it again to retry.'}
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 2.5 }}>
                    {call.can_retry ? (
                      <Button variant="contained" startIcon={<RefreshRounded />} onClick={() => void retry()} disabled={retrying}>
                        {retrying ? 'Retrying…' : 'Retry'}
                      </Button>
                    ) : (
                      <Button variant="contained" startIcon={<CloudUploadRounded />} component={RouterLink} to="/upload">
                        Upload again
                      </Button>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            )}

            {inProgress && (
              <SectionCard title="Live status">
                <Typography variant="body2" color="text.secondary">
                  This page updates on its own as each stage finishes. Steps are marked done only when the backend records the matching audit event.
                </Typography>
              </SectionCard>
            )}

            <SectionCard title="Privacy guarantees">
              <Stack spacing={1.25}>
                {[
                  'Raw audio lives only in temporary storage and is deleted after transfer',
                  'Only the redacted transcript and redacted audio are archived',
                  'The LLM receives the redacted transcript only',
                  'Every step and every playback is written to the audit trail',
                ].map((text) => (
                  <Stack key={text} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                    <LockRounded sx={{ fontSize: 16, color: 'primary.main', mt: '2px' }} />
                    <Typography variant="body2" color="text.secondary">
                      {text}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </SectionCard>
          </Stack>
        </Grid>
      </Grid>
    </>
  );
}
