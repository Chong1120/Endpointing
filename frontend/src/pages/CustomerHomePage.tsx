import ForumRounded from '@mui/icons-material/ForumRounded';
import { Box, Chip, CircularProgress, LinearProgress, Stack, Typography } from '@mui/material';
import { EmptyState, SectionCard, SentimentChip } from '../components/common';
import { useApiQuery } from '../hooks/useApiQuery';
import { api } from '../services/api';
import { IN_PROGRESS, formatDateTime, formatDuration } from '../utils/format';
import { LiveAgentPage } from './LiveAgentPage';

/** The customer's whole product: call the agent, and look back at your own calls. */
export function CustomerHomePage() {
  const mine = useApiQuery(() => api.listCalls({ page_size: 5 }), [], {
    poll: (data) => (data?.items.some((call) => IN_PROGRESS.includes(call.status)) ? 4000 : false),
  });

  return (
    <>
      <LiveAgentPage variant="customer" onArchived={() => void mine.reload()} />

      <Box sx={{ mt: 2.5 }}>
        <SectionCard
          title="Your calls"
          action={
            <Typography variant="caption" color="text.secondary">
              Only yours — nobody else's
            </Typography>
          }
        >
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            A summary appears once the recording has been through redaction. The recording itself stays with Northwind Mobile's support
            team — this is your record that the call happened.
          </Typography>
          {mine.loading && !mine.data && <LinearProgress />}
          {mine.data && mine.data.items.length === 0 ? (
            <EmptyState
              icon={<ForumRounded />}
              title="No calls yet"
              description="Call the agent above. Once the recording is protected, it appears here with a summary you can read back."
            />
          ) : (
            <Stack spacing={1.25}>
              {(mine.data?.items ?? []).map((call) => {
                const working = IN_PROGRESS.includes(call.status);
                return (
                  <Stack
                    key={call.id}
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 650 }}>
                        {call.reference} · {formatDateTime(call.created_at)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {working ? 'Removing personal details…' : (call.summary ?? 'No summary for this call.')}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0 }}>
                      {working && <CircularProgress size={16} />}
                      <Chip size="small" variant="outlined" label={formatDuration(call.duration_seconds)} />
                      <SentimentChip sentiment={call.sentiment} />
                    </Stack>
                  </Stack>
                );
              })}
            </Stack>
          )}
        </SectionCard>
      </Box>
    </>
  );
}
