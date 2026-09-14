import { Box, Chip, Stack, Typography } from '@mui/material';
import type { AuditEvent } from '../services/types';
import { brand } from '../theme';
import { auditDetail, auditLabel, formatTime } from '../utils/format';

const ACCESS_EVENTS = new Set(['SAFE_AUDIO_ACCESSED', 'DATASET_EXPORTED', 'RETRY_STARTED', 'WEBHOOK_RECEIVED']);

function dotColor(type: string): string {
  if (type === 'PROCESSING_FAILED') return '#B91C1C';
  if (ACCESS_EVENTS.has(type)) return '#94A3B8';
  return brand.teal;
}

/** Chronological audit trail for one call. Metadata is technical only (IDs, counts). */
export function AuditTimeline({ events, currentUserId }: { events: AuditEvent[]; currentUserId?: string }) {
  if (events.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No events yet.
      </Typography>
    );
  }
  return (
    <Stack component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {events.map((event, index) => {
        const detail = auditDetail(event.event_type, event.metadata);
        const actor = event.actor_id ? (event.actor_id === currentUserId ? 'You' : 'User') : 'System';
        return (
          <Box component="li" key={event.id} sx={{ display: 'flex', gap: 1.5 }}>
            <Stack sx={{ alignItems: 'center', pt: '6px' }}>
              <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: dotColor(event.event_type), boxShadow: '0 0 0 3px #fff' }} />
              {index < events.length - 1 && <Box sx={{ width: '1px', flex: 1, bgcolor: 'divider', mt: '4px' }} />}
            </Stack>
            <Box sx={{ pb: 1.5, minWidth: 0, flex: 1 }}>
              <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1, alignItems: 'baseline' }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {auditLabel(event.event_type)}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                  {formatTime(event.created_at)}
                </Typography>
              </Stack>
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mt: 0.25 }}>
                <Chip label={actor} size="small" sx={{ height: 18, fontSize: '0.65rem', bgcolor: '#F1F5F9' }} />
                {detail && (
                  <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                    {detail}
                  </Typography>
                )}
              </Stack>
            </Box>
          </Box>
        );
      })}
    </Stack>
  );
}
