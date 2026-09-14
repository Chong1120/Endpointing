import DataObjectRounded from '@mui/icons-material/DataObjectRounded';
import FileDownloadRounded from '@mui/icons-material/FileDownloadRounded';
import TableChartRounded from '@mui/icons-material/TableChartRounded';
import { Button, ListItemIcon, ListItemText, Menu, MenuItem } from '@mui/material';
import { useState } from 'react';
import { useNotify } from '../hooks/useNotify';
import { api, ApiError, saveBlob } from '../services/api';
import type { CallFilters } from '../services/types';

/** Exports redacted utterances + AI analysis (never raw audio, raw text or PII). */
export function ExportMenu({ filters = {}, variant = 'outlined' }: { filters?: CallFilters; variant?: 'outlined' | 'contained' }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const notify = useNotify();

  async function run(format: 'jsonl' | 'csv') {
    setAnchor(null);
    setBusy(true);
    try {
      const { blob, filename } = await api.exportDataset(format, filters);
      saveBlob(blob, filename);
      notify(`Safe dataset exported (${format.toUpperCase()}).`);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Export failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant={variant} startIcon={<FileDownloadRounded />} onClick={(e) => setAnchor(e.currentTarget)} disabled={busy}>
        {busy ? 'Exporting…' : 'Export safe dataset'}
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem onClick={() => void run('jsonl')}>
          <ListItemIcon>
            <DataObjectRounded fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="JSONL" secondary="One call per line — for AI & training pipelines" />
        </MenuItem>
        <MenuItem onClick={() => void run('csv')}>
          <ListItemIcon>
            <TableChartRounded fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="CSV" secondary="One utterance per row — for analytics & QA" />
        </MenuItem>
      </Menu>
    </>
  );
}
