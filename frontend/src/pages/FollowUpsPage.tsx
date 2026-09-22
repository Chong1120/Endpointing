import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import HeadsetMicRounded from '@mui/icons-material/HeadsetMicRounded';
import SupportAgentRounded from '@mui/icons-material/SupportAgentRounded';
import { Alert, Button, Card, Chip, LinearProgress, Stack, Typography } from '@mui/material';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { EmptyState, PageHeader, PiiCount, SentimentChip } from '../components/common';
import { useApiQuery } from '../hooks/useApiQuery';
import { useCan } from '../hooks/useMe';
import { ApiError, api } from '../services/api';
import type { FollowUp } from '../services/types';
import { formatDateTime, formatDuration, relativeTime } from '../utils/format';

const REASONS: Record<string, string> = {
  customer_requested: 'Caller asked for a person',
  upset_customer: 'Caller was still upset',
  out_of_scope: 'Outside what the agent can do',
  payment_issue: 'Payment matter',
};

const reasonLabel = (reason: string) => REASONS[reason] ?? reason.replace(/_/g, ' ');

function FollowUpRow({ item, onResolved }: { item: FollowUp; onResolved: (id: string) => void }) {
  const canResolve = useCan('followups:resolve');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve() {
    setBusy(true);
    setError(null);
    try {
      await api.resolveFollowUp(item.id);
      onResolved(item.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not close this escalation.');
      setBusy(false);
    }
  }

  return (
    <Card sx={{ p: 2.5 }} component="li">
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'center' } }}>
        <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="subtitle2" component={RouterLink} to={`/calls/${item.id}`} sx={{ fontWeight: 700, textDecoration: 'none', color: 'primary.main' }}>
              {item.reference}
            </Typography>
            <Chip size="small" color="warning" variant="outlined" label={reasonLabel(item.reason)} />
            <SentimentChip sentiment={item.sentiment} />
            <PiiCount total={item.pii_total} />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {item.summary ?? 'The redacted summary appears here once processing finishes.'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {item.department} · {formatDuration(item.duration_seconds)} · escalated {relativeTime(item.requested_at)} ({formatDateTime(item.requested_at)})
          </Typography>
          {error && (
            <Typography variant="caption" color="error">
              {error}
            </Typography>
          )}
        </Stack>
        <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
          <Button component={RouterLink} to={`/calls/${item.id}`} size="small" variant="outlined">
            Open call
          </Button>
          {canResolve && (
            <Button size="small" variant="contained" startIcon={<CheckCircleRounded />} onClick={() => void resolve()} disabled={busy}>
              Mark handled
            </Button>
          )}
        </Stack>
      </Stack>
    </Card>
  );
}

export function FollowUpsPage() {
  const canCall = useCan('agent:call');
  const queue = useApiQuery(() => api.followUps(), [], { poll: 20_000 });
  const items = queue.data?.items ?? [];

  const remove = (id: string) => queue.setData((current) => (current ? { items: current.items.filter((item) => item.id !== id), total: current.total - 1 } : current));

  return (
    <>
      <PageHeader
        title="Escalations"
        subtitle="Calls the AI agent handed to a person. Only the reason travels with the call — the transcript here is already redacted."
        actions={
          canCall ? (
            <Button component={RouterLink} to="/agent" variant="outlined" startIcon={<HeadsetMicRounded />}>
              Live agent
            </Button>
          ) : undefined
        }
      />
      {queue.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {queue.error.message}
        </Alert>
      )}
      {queue.loading && !queue.data && <LinearProgress sx={{ mb: 2 }} />}
      {queue.data && items.length === 0 ? (
        <EmptyState
          icon={<SupportAgentRounded />}
          title="Nothing waiting for a person"
          description="When a caller asks for a human, stays upset, or needs something the agent cannot do, the call lands here."
        />
      ) : (
        <Stack component="ul" spacing={1.5} sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {items.map((item) => (
            <FollowUpRow key={item.id} item={item} onResolved={remove} />
          ))}
        </Stack>
      )}
    </>
  );
}
