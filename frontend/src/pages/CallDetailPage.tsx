import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import HourglassTopRounded from '@mui/icons-material/HourglassTopRounded';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import ShieldRounded from '@mui/icons-material/ShieldRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Grid,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router';
import { AuditTimeline } from '../components/AuditTimeline';
import { InsightsPanel } from '../components/InsightsPanel';
import { PageHeader, PiiBreakdown, SectionCard } from '../components/common';
import { SafeAudioPlayer, type SafeAudioHandle } from '../components/SafeAudioPlayer';
import { StatusBadge } from '../components/StatusBadge';
import { TranscriptView } from '../components/TranscriptView';
import { useApiQuery } from '../hooks/useApiQuery';
import { useMe } from '../hooks/useMe';
import { useNotify } from '../hooks/useNotify';
import { api, ApiError } from '../services/api';
import { brand } from '../theme';
import { IN_PROGRESS, PRESET_LABELS, formatDateTime, formatDuration, languageName, modelLabel } from '../utils/format';

function Fact({ label, value, ok }: { label: string; value: ReactNode; ok?: boolean }) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 2, py: 0.6 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        {ok && <CheckRounded sx={{ fontSize: 15, color: 'success.main' }} />}
        <Typography variant="body2" sx={{ fontWeight: 600, textAlign: 'right' }}>
          {value}
        </Typography>
      </Stack>
    </Stack>
  );
}

export function CallDetailPage() {
  const { id = '' } = useParams();
  const me = useMe();
  const navigate = useNavigate();
  const notify = useNotify();
  const playerRef = useRef<SafeAudioHandle>(null);
  const [audioMs, setAudioMs] = useState<number | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const detail = useApiQuery(() => api.getCall(id), [id], {
    poll: (d) => (d && IN_PROGRESS.includes(d.call.status) ? 3000 : false),
  });
  const call = detail.data?.call;
  const utterances = detail.data?.utterances ?? [];
  const roles = useMemo(
    () => new Map((call?.ai_summary?.speaker_roles ?? []).map((r) => [r.speaker, r.role] as const)),
    [call?.ai_summary],
  );

  async function retry() {
    setBusy(true);
    try {
      await api.retry(id);
      navigate(`/calls/${id}/processing`);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Retry failed.', 'error');
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.deleteCall(id);
      notify('Call and its safe recording were deleted.');
      navigate('/calls');
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Delete failed.', 'error');
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  if (detail.error && !call) return <Alert severity="error">{detail.error.message}</Alert>;
  if (!call) {
    return (
      <Stack spacing={2}>
        <Skeleton variant="rounded" height={64} />
        <Skeleton variant="rounded" height={140} />
        <Skeleton variant="rounded" height={420} />
      </Stack>
    );
  }

  const inProgress = IN_PROGRESS.includes(call.status);

  return (
    <>
      <PageHeader
        eyebrow={
          <Button component={RouterLink} to="/calls" size="small" startIcon={<ArrowBackRounded />} sx={{ ml: -1 }}>
            Calls
          </Button>
        }
        title={
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <span>{call.reference}</span>
            <StatusBadge status={call.status} large />
          </Stack>
        }
        subtitle={`${call.original_filename} · ${call.department} · ${formatDateTime(call.created_at)}${call.source === 'sample' ? ' · synthetic sample' : ''}`}
        actions={
          <>
            {call.can_retry && (
              <Button variant="contained" startIcon={<RefreshRounded />} onClick={() => void retry()} disabled={busy}>
                Retry
              </Button>
            )}
            {me?.user.role === 'admin' && !inProgress && (
              <Button variant="outlined" color="error" startIcon={<DeleteOutlineRounded />} onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
          </>
        }
      />

      {inProgress && (
        <Alert
          severity="info"
          icon={<HourglassTopRounded />}
          sx={{ mb: 2.5 }}
          action={
            <Button component={RouterLink} to={`/calls/${call.id}/processing`}>
              View progress
            </Button>
          }
        >
          This call is still being protected. The safe archive appears here when processing finishes.
        </Alert>
      )}
      {call.status === 'FAILED' && (
        <Alert severity="error" sx={{ mb: 2.5 }}>
          {call.error_message}
        </Alert>
      )}

      <Card sx={{ mb: 2.5, overflow: 'hidden' }}>
        <Grid container>
          <Grid size={{ xs: 12, md: 3 }} sx={{ p: 3, bgcolor: brand.ink, color: '#fff' }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', color: brand.tealBright }}>
              <ShieldRounded fontSize="small" />
              <Typography variant="overline" sx={{ color: brand.tealBright }}>
                Protected
              </Typography>
            </Stack>
            <Typography sx={{ fontSize: '3rem', fontWeight: 750, lineHeight: 1.05, mt: 1, letterSpacing: '-0.02em' }}>{call.pii_total}</Typography>
            <Typography sx={{ color: '#CBD5E1' }}>PII {call.pii_total === 1 ? 'entity' : 'entities'} protected</Typography>
          </Grid>
          <Grid size={{ xs: 12, md: 5 }} sx={{ p: 3, borderRight: { md: 1 }, borderColor: { md: 'divider' } }}>
            <Typography variant="overline" color="text.secondary">
              PII protection report
            </Typography>
            <Box sx={{ mt: 1 }}>
              <PiiBreakdown counts={call.pii_counts} />
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
              Counts come from AssemblyAI's redaction labels. The original values were never received or stored by SafeCall.
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, md: 4 }} sx={{ p: 3 }}>
            <Fact label="Policy" value={`${PRESET_LABELS[call.policy_preset]} · ${call.pii_policies.length} types`} />
            <Fact label="Raw upload" value="Deleted after transfer" ok />
            <Fact label="AssemblyAI copy" value={call.original_deleted_at ? 'Deleted' : 'Retention policy'} ok={Boolean(call.original_deleted_at)} />
            <Fact label="Storage" value={call.has_safe_audio ? 'Private bucket' : '—'} ok={call.has_safe_audio} />
            <Fact
              label="Transcription"
              value={[modelLabel(call.speech_model_used), languageName(call.detected_language)].filter((v) => v !== '—').join(' · ') || '—'}
            />
            <Fact label="Speakers · duration" value={`${call.speakers_count ?? '—'} · ${formatDuration(call.duration_seconds)}`} />
          </Grid>
        </Grid>
      </Card>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Stack spacing={2.5}>
            {call.has_safe_audio && (
              <Card>
                <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
                  <SafeAudioPlayer ref={playerRef} callId={call.id} utterances={utterances} durationSeconds={call.duration_seconds} onTime={setAudioMs} />
                </CardContent>
              </Card>
            )}
            <SectionCard
              title="Redacted transcript"
              action={
                <Typography variant="caption" color="text.secondary">
                  {utterances.length} utterances · {call.speakers_count ?? 0} speakers
                </Typography>
              }
            >
              <Box sx={{ mx: -1.25 }}>
                <TranscriptView utterances={utterances} roles={roles} activeMs={audioMs} onSeek={call.has_safe_audio ? (ms) => playerRef.current?.seek(ms) : undefined} />
              </Box>
            </SectionCard>
          </Stack>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Stack spacing={2.5}>
            <SectionCard
              title={
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }} component="span">
                  <AutoAwesomeRounded sx={{ fontSize: 18, color: 'primary.main' }} />
                  <span>AI insights</span>
                </Stack>
              }
            >
              {call.ai_summary ? (
                <InsightsPanel analysis={call.ai_summary} />
              ) : (
                <Box sx={{ p: 2, borderRadius: 2, bgcolor: alpha(brand.teal, 0.04) }}>
                  <Typography variant="body2" color="text.secondary">
                    {!call.analysis_enabled
                      ? 'AI analysis was turned off for this call.'
                      : call.status === 'COMPLETED'
                        ? 'No speech was available to analyze.'
                        : call.status === 'FAILED'
                          ? 'AI analysis has not completed. Retry to run it on the redacted transcript.'
                          : 'Insights will appear after redaction completes.'}
                  </Typography>
                </Box>
              )}
            </SectionCard>
            <SectionCard title="Audit trail">
              <AuditTimeline events={detail.data?.audit ?? []} currentUserId={me?.user.id} />
            </SectionCard>
          </Stack>
        </Grid>
      </Grid>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>Delete {call.reference}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This permanently removes the redacted recording, the redacted transcript and the AI insights. The deletion itself stays in the organization audit log.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => void remove()} disabled={busy}>
            Delete call
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
