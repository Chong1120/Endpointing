import RestartAltRounded from '@mui/icons-material/RestartAltRounded';
import ScienceRounded from '@mui/icons-material/ScienceRounded';
import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useMe } from '../hooks/useMe';
import { useNotify } from '../hooks/useNotify';
import { ApiError, api } from '../services/api';
import { DEMO_ORG_NAME, type DemoPersona } from '../services/types';
import { brand } from '../theme';

const PERSONAS: Array<{ key: DemoPersona['key']; label: string }> = [
  { key: 'customer', label: 'Customer' },
  { key: 'agent', label: 'Support agent' },
  { key: 'admin', label: 'Admin' },
];

/**
 * Shown only inside the shared demo workspace: swap between the three roles
 * without signing out, and put the workspace back if someone has been busy.
 */
export function DemoBar() {
  const me = useMe();
  const { signInAsDemo } = useAuth();
  const notify = useNotify();
  const [busy, setBusy] = useState(false);

  if (me?.organization.name !== DEMO_ORG_NAME) return null;

  async function switchTo(key: DemoPersona['key']) {
    setBusy(true);
    try {
      await signInAsDemo(key);
      window.location.assign('/');
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not switch role.', 'error');
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      const { calls_deleted } = await api.resetDemo();
      notify(`Demo workspace reset. ${calls_deleted} call(s) removed; sample calls are being processed again.`);
      window.location.reload();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not reset the demo.', 'error');
      setBusy(false);
    }
  }

  const current = me.user.role === 'customer' ? 'customer' : me.user.role === 'agent' ? 'agent' : 'admin';

  return (
    <Box
      sx={{
        mb: 2,
        px: 2,
        py: 1.25,
        borderRadius: 2,
        border: `1px solid ${alpha(brand.teal, 0.25)}`,
        bgcolor: alpha(brand.teal, 0.06),
      }}
    >
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <ScienceRounded sx={{ fontSize: 18, color: 'primary.main' }} />
          <Typography variant="body2">
            <strong>Demo workspace.</strong> Shared test accounts — everything here is synthetic.
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          {PERSONAS.map((persona) =>
            persona.key === current ? (
              <Chip key={persona.key} size="small" color="primary" label={`You: ${persona.label}`} />
            ) : (
              <Button key={persona.key} size="small" variant="outlined" disabled={busy} onClick={() => void switchTo(persona.key)}>
                {persona.label}
              </Button>
            ),
          )}
          {me.user.role === 'admin' && (
            <Button size="small" color="inherit" startIcon={<RestartAltRounded />} disabled={busy} onClick={() => void reset()}>
              Reset demo
            </Button>
          )}
        </Stack>
      </Stack>
    </Box>
  );
}
