import CloudUploadRounded from '@mui/icons-material/CloudUploadRounded';
import FilterAltOffRounded from '@mui/icons-material/FilterAltOffRounded';
import LockRounded from '@mui/icons-material/LockRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import SearchOffRounded from '@mui/icons-material/SearchOffRounded';
import { Alert, Box, Button, Card, InputAdornment, LinearProgress, MenuItem, Stack, TablePagination, TextField, Typography } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router';
import { CallsTable } from '../components/CallsTable';
import { EmptyState, PageHeader } from '../components/common';
import { ExportMenu } from '../components/ExportMenu';
import { useApiQuery } from '../hooks/useApiQuery';
import { api } from '../services/api';
import { DEPARTMENTS, type CallFilters, type CallStatus, type Sentiment } from '../services/types';
import { IN_PROGRESS, entityLabel } from '../utils/format';

const STATUS_OPTIONS: Array<{ value: CallStatus; label: string }> = [
  { value: 'COMPLETED', label: 'Safe' },
  { value: 'TRANSCRIBING', label: 'Transcribing' },
  { value: 'PROCESSING', label: 'Protecting' },
  { value: 'FAILED', label: 'Failed' },
];

const PII_TYPES = [
  'PERSON_NAME', 'PHONE_NUMBER', 'EMAIL_ADDRESS', 'LOCATION_ADDRESS', 'LOCATION_ADDRESS_STREET', 'CREDIT_CARD_NUMBER',
  'CREDIT_CARD_CVV', 'CREDIT_CARD_EXPIRATION', 'ACCOUNT_NUMBER', 'BANKING_INFORMATION', 'DATE_OF_BIRTH', 'PASSWORD',
  'US_SOCIAL_SECURITY_NUMBER', 'HEALTHCARE_NUMBER', 'MEDICAL_CONDITION',
];

const FILTER_KEYS = ['q', 'status', 'department', 'sentiment', 'pii_type', 'from', 'to'] as const;

export function CallsPage() {
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [query, setQuery] = useState(params.get('q') ?? '');

  const filters: CallFilters = useMemo(() => {
    const f: CallFilters = {};
    for (const key of FILTER_KEYS) {
      const value = params.get(key);
      if (value) (f as Record<string, string>)[key] = value;
    }
    return f;
  }, [params]);

  // Debounce the free-text search into the URL.
  useEffect(() => {
    const timer = setTimeout(() => update('q', query.trim()), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function update(key: (typeof FILTER_KEYS)[number], value: string) {
    setPage(0);
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  }

  const request = { ...filters, page: page + 1, page_size: pageSize };
  const results = useApiQuery(() => (filters.q ? api.search(request) : api.listCalls(request)), [JSON.stringify(request)], {
    poll: (d) => (d?.items.some((c) => IN_PROGRESS.includes(c.status)) ? 4000 : false),
  });
  const hasFilters = FILTER_KEYS.some((key) => params.get(key));

  return (
    <>
      <PageHeader
        title="Calls & search"
        subtitle="Search covers redacted transcripts, AI analysis and metadata only. The original values were never stored, so they can't be found."
        actions={
          <>
            <ExportMenu filters={filters} />
            <Button variant="contained" startIcon={<CloudUploadRounded />} component={RouterLink} to="/upload">
              Upload call
            </Button>
          </>
        }
      />

      <Card sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5} sx={{ alignItems: { lg: 'center' } }}>
          <TextField
            size="small"
            placeholder="Search safe transcripts, summaries, topics…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            sx={{ flex: 1, minWidth: 240 }}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRounded fontSize="small" /></InputAdornment> } }}
          />
          <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', rowGap: 1.5 }}>
            <TextField size="small" type="date" label="From" value={filters.from ?? ''} onChange={(e) => update('from', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} sx={{ width: 150 }} />
            <TextField size="small" type="date" label="To" value={filters.to ?? ''} onChange={(e) => update('to', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} sx={{ width: 150 }} />
            <TextField size="small" select label="Status" value={filters.status ?? ''} onChange={(e) => update('status', e.target.value)} sx={{ width: 140 }}>
              <MenuItem value="">All</MenuItem>
              {STATUS_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField size="small" select label="Department" value={filters.department ?? ''} onChange={(e) => update('department', e.target.value)} sx={{ width: 170 }}>
              <MenuItem value="">All</MenuItem>
              {DEPARTMENTS.map((d) => (
                <MenuItem key={d} value={d}>
                  {d}
                </MenuItem>
              ))}
            </TextField>
            <TextField size="small" select label="Sentiment" value={filters.sentiment ?? ''} onChange={(e) => update('sentiment', e.target.value as Sentiment)} sx={{ width: 140 }}>
              <MenuItem value="">All</MenuItem>
              <MenuItem value="positive">Positive</MenuItem>
              <MenuItem value="neutral">Neutral</MenuItem>
              <MenuItem value="negative">Negative</MenuItem>
            </TextField>
            <TextField size="small" select label="PII type" value={filters.pii_type ?? ''} onChange={(e) => update('pii_type', e.target.value)} sx={{ width: 190 }}>
              <MenuItem value="">Any</MenuItem>
              {PII_TYPES.map((t) => (
                <MenuItem key={t} value={t}>
                  <LockRounded sx={{ fontSize: 14, mr: 1, color: 'primary.main' }} />
                  {entityLabel(t)}
                </MenuItem>
              ))}
            </TextField>
            {hasFilters && (
              <Button
                startIcon={<FilterAltOffRounded />}
                onClick={() => {
                  setQuery('');
                  setPage(0);
                  setParams({}, { replace: true });
                }}
              >
                Clear
              </Button>
            )}
          </Stack>
        </Stack>
      </Card>

      {results.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {results.error.message}
        </Alert>
      )}

      <Card sx={{ position: 'relative' }}>
        {results.loading && <LinearProgress sx={{ position: 'absolute', top: 0, left: 0, right: 0 }} />}
        {results.data && results.data.items.length === 0 ? (
          <EmptyState
            icon={hasFilters ? <SearchOffRounded /> : <LockRounded />}
            title={hasFilters ? 'No matching calls' : 'No calls yet'}
            description={hasFilters ? 'Try different words or remove a filter. Redacted values like names or card numbers are never searchable.' : 'Upload a recording or load the demo calls from the dashboard.'}
          />
        ) : (
          <Box sx={{ opacity: results.loading && results.data ? 0.6 : 1, transition: 'opacity 150ms' }}>
            <CallsTable items={results.data?.items ?? []} />
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', pl: 2 }}>
              <Typography variant="caption" color="text.secondary">
                {results.data?.query ? `Results for “${results.data.query}” in safe data` : ' '}
              </Typography>
              <TablePagination
                component="div"
                count={results.data?.total ?? 0}
                page={page}
                onPageChange={(_e, next) => setPage(next)}
                rowsPerPage={pageSize}
                onRowsPerPageChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(0);
                }}
                rowsPerPageOptions={[10, 20, 50]}
              />
            </Stack>
          </Box>
        )}
      </Card>
    </>
  );
}
