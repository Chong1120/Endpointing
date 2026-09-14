import { Box, Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { Fragment } from 'react';
import { useNavigate } from 'react-router';
import type { CallListItem } from '../services/types';
import { IN_PROGRESS, formatDateTime, formatDuration, relativeTime } from '../utils/format';
import { PiiCount, SentimentChip } from './common';
import { RedactedText } from './RedactedText';
import { StatusBadge } from './StatusBadge';

/**
 * Calls list. In-progress calls open the processing view; archived calls open
 * the detail view. Search snippets (or AI summaries) get a full-width sub-row.
 */
export function CallsTable({ items, compact = false }: { items: CallListItem[]; compact?: boolean }) {
  const navigate = useNavigate();
  const columns = compact ? 5 : 8;

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size={compact ? 'small' : 'medium'} sx={{ minWidth: compact ? 560 : 760 }}>
        <TableHead>
          <TableRow>
            <TableCell>Call</TableCell>
            <TableCell>{compact ? 'Received' : 'Date'}</TableCell>
            {!compact && <TableCell>Department</TableCell>}
            {!compact && <TableCell align="right">Duration</TableCell>}
            <TableCell>PII protected</TableCell>
            <TableCell>Sentiment</TableCell>
            {!compact && <TableCell>Topics</TableCell>}
            <TableCell>Status</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((call) => {
            const inProgress = IN_PROGRESS.includes(call.status);
            const href = inProgress ? `/calls/${call.id}/processing` : `/calls/${call.id}`;
            const detail = call.snippet ?? (compact ? null : call.summary);
            const open = () => navigate(href);
            return (
              <Fragment key={call.id}>
                <TableRow
                  hover
                  tabIndex={0}
                  onClick={open}
                  onKeyDown={(e) => e.key === 'Enter' && open()}
                  sx={{ cursor: 'pointer', verticalAlign: 'top', ...(detail && { '& > td': { borderBottom: 0, pb: 0.5 } }) }}
                >
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 650 }}>
                      {call.reference}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', maxWidth: 320 }}>
                      {compact ? `${call.department} · ${call.original_filename}` : call.original_filename}
                      {!compact && call.source === 'sample' && ' · synthetic sample'}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Typography variant="body2">{compact ? relativeTime(call.created_at) : formatDateTime(call.created_at)}</Typography>
                  </TableCell>
                  {!compact && <TableCell sx={{ whiteSpace: 'nowrap' }}>{call.department}</TableCell>}
                  {!compact && (
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatDuration(call.duration_seconds)}
                    </TableCell>
                  )}
                  <TableCell>
                    {call.status === 'COMPLETED' ? (
                      <PiiCount total={call.pii_total} />
                    ) : (
                      <Typography variant="body2" color="text.disabled">
                        —
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <SentimentChip sentiment={call.sentiment} />
                  </TableCell>
                  {!compact && (
                    <TableCell>
                      <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap', maxWidth: 240 }}>
                        {call.topics.slice(0, 3).map((topic) => (
                          <Chip key={topic} label={topic} size="small" sx={{ bgcolor: '#EEF2F6' }} />
                        ))}
                      </Stack>
                    </TableCell>
                  )}
                  <TableCell>
                    <StatusBadge status={call.status} />
                  </TableCell>
                </TableRow>
                {detail && (
                  <TableRow hover onClick={open} sx={{ cursor: 'pointer' }}>
                    <TableCell colSpan={columns} sx={{ pt: 0, pb: 1.75 }}>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{
                          lineHeight: 1.75,
                          maxWidth: 1040,
                          ...(!call.snippet && { display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }),
                        }}
                      >
                        <RedactedText text={detail} />
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}
