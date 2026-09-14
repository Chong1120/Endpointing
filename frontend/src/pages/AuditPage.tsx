import FactCheckRounded from '@mui/icons-material/FactCheckRounded';
import {
  Alert,
  Box,
  Card,
  Chip,
  LinearProgress,
  Link,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { EmptyState, PageHeader } from '../components/common';
import { useApiQuery } from '../hooks/useApiQuery';
import { useMe } from '../hooks/useMe';
import { api } from '../services/api';
import { brand } from '../theme';
import { AUDIT_EVENT_LABELS, auditDetail, auditLabel, formatDateTime } from '../utils/format';

export function AuditPage() {
  const me = useMe();
  const [eventType, setEventType] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const audit = useApiQuery(() => api.audit({ event_type: eventType || undefined, page: page + 1, page_size: pageSize }), [eventType, page, pageSize]);

  return (
    <>
      <PageHeader
        title="Audit trail"
        subtitle="Every processing step, playback, export and policy change, with technical IDs and counts only. Raw PII never appears here."
        actions={
          <TextField select size="small" label="Event" value={eventType} onChange={(e) => { setEventType(e.target.value); setPage(0); }} sx={{ width: 240 }}>
            <MenuItem value="">All events</MenuItem>
            {Object.entries(AUDIT_EVENT_LABELS).map(([type, label]) => (
              <MenuItem key={type} value={type}>
                {label}
              </MenuItem>
            ))}
          </TextField>
        }
      />
      {audit.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {audit.error.message}
        </Alert>
      )}
      <Card sx={{ position: 'relative' }}>
        {audit.loading && <LinearProgress sx={{ position: 'absolute', top: 0, left: 0, right: 0 }} />}
        {audit.data && audit.data.items.length === 0 ? (
          <EmptyState icon={<FactCheckRounded />} title="No audit events" description="Events appear here as calls are uploaded, processed, played and exported." />
        ) : (
          <Box sx={{ overflowX: 'auto', opacity: audit.loading && audit.data ? 0.6 : 1 }}>
            <Table size="small" sx={{ minWidth: 820 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Time</TableCell>
                  <TableCell>Event</TableCell>
                  <TableCell>Call</TableCell>
                  <TableCell>Actor</TableCell>
                  <TableCell>Details</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(audit.data?.items ?? []).map((event) => (
                  <TableRow key={event.id} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{formatDateTime(event.created_at)}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: event.event_type === 'PROCESSING_FAILED' ? 'error.main' : brand.teal, flexShrink: 0 }} />
                        <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {auditLabel(event.event_type)}
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {event.call_id && event.call_number ? (
                        <Link component={RouterLink} to={`/calls/${event.call_id}`} underline="hover" sx={{ fontWeight: 600 }}>
                          CALL-{event.call_number}
                        </Link>
                      ) : (
                        <Typography variant="body2" color="text.disabled">
                          —
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={event.actor_id ? (event.actor_id === me?.user.id ? 'You' : 'User') : 'System'} sx={{ bgcolor: '#F1F5F9' }} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {auditDetail(event.event_type, event.metadata)}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TablePagination
              component="div"
              count={audit.data?.total ?? 0}
              page={page}
              onPageChange={(_e, next) => setPage(next)}
              rowsPerPage={pageSize}
              onRowsPerPageChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(0);
              }}
              rowsPerPageOptions={[25, 50, 100]}
            />
          </Box>
        )}
      </Card>
    </>
  );
}
