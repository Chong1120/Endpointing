import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import GroupAddRounded from '@mui/icons-material/GroupAddRounded';
import { Alert, Box, Button, Card, Chip, LinearProgress, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { PageHeader, SectionCard, roleName } from '../components/common';
import { useApiQuery } from '../hooks/useApiQuery';
import { useCan, useMe } from '../hooks/useMe';
import { useNotify } from '../hooks/useNotify';
import { ApiError, api } from '../services/api';
import type { UserRole } from '../services/types';

/**
 * The three roles a workspace actually runs on. `analyst` and `viewer` still
 * exist and keep working; they are only offered if someone already has one.
 */
const ROLES: Array<{ value: UserRole; what: string }> = [
  { value: 'admin', what: 'Runs the workspace: PII policies, deletions, exports, analytics and the team.' },
  { value: 'agent', what: 'Works the escalation queue and the calls on it. Nothing else.' },
  { value: 'customer', what: 'Calls the AI agent and sees only their own calls. Never the console.' },
];

const ALL_ROLES: Array<{ value: UserRole; what: string }> = [
  ...ROLES,
  { value: 'analyst', what: 'Studies the safe archive: search, analytics and exports. No policy changes.' },
  { value: 'viewer', what: 'Reads calls and the audit trail. Changes nothing.' },
];

export function TeamPage() {
  const me = useMe();
  const manages = useCan('team:manage');
  const notify = useNotify();
  const team = useApiQuery(() => api.team(), []);
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changeRole(userId: string, role: UserRole) {
    setError(null);
    try {
      const { member } = await api.setMemberRole(userId, role);
      team.setData((current) =>
        current ? { ...current, members: current.members.map((existing) => (existing.id === member.id ? { ...existing, role: member.role } : existing)) } : current,
      );
      notify(`Role updated to ${roleName(member.role).toLowerCase()}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The role could not be changed.');
    }
  }

  async function join() {
    setJoining(true);
    setError(null);
    try {
      const result = await api.joinTeam(code.trim());
      notify(
        result.calls_left_behind > 0
          ? `You joined ${result.organization.name}. ${result.calls_left_behind} call(s) stay in your old workspace.`
          : `You joined ${result.organization.name} as a ${roleName(result.role).toLowerCase()}.`,
      );
      window.location.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That code could not be used.');
      setJoining(false);
    }
  }

  const invite = team.data?.invite;

  return (
    <>
      <PageHeader
        title="Team"
        subtitle="Who works in this workspace and what each person may do. The API enforces these roles; the screens only hide what a role cannot use."
      />
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {team.loading && !team.data && <LinearProgress sx={{ mb: 2 }} />}
      {team.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {team.error.message}
        </Alert>
      )}

      <Stack spacing={2.5}>
        <SectionCard title={team.data?.organization.name ?? 'Workspace'} action={<Chip size="small" label={`${team.data?.members.length ?? 0} people`} />}>
          <Stack spacing={1.5}>
            {(team.data?.members ?? []).map((member) => (
              <Stack
                key={member.id}
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.5}
                sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', borderBottom: '1px solid', borderColor: 'divider', pb: 1.5 }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {member.email} {member.is_you && <Chip size="small" label="you" sx={{ ml: 0.5 }} />}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {ALL_ROLES.find((role) => role.value === member.role)?.what}
                  </Typography>
                </Box>
                {manages ? (
                  <TextField
                    select
                    size="small"
                    label="Role"
                    value={member.role}
                    onChange={(event) => void changeRole(member.id, event.target.value as UserRole)}
                    sx={{ width: 190, flexShrink: 0 }}
                  >
                    {(ROLES.some((role) => role.value === member.role) ? ROLES : ALL_ROLES).map((role) => (
                      <MenuItem key={role.value} value={role.value}>
                        {roleName(role.value)}
                      </MenuItem>
                    ))}
                  </TextField>
                ) : (
                  <Chip size="small" variant="outlined" label={roleName(member.role)} sx={{ flexShrink: 0 }} />
                )}
              </Stack>
            ))}
          </Stack>
        </SectionCard>

        {manages && invite && (
          <SectionCard title="Invite someone" action={<Chip size="small" variant="outlined" label={`Valid ${invite.valid_for_days} days`} />}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Ask them to sign up, open this page and paste the code under “Join a workspace”. They arrive as a support agent; change their role above.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField value={invite.code} size="small" fullWidth slotProps={{ input: { readOnly: true, sx: { fontFamily: 'monospace', fontSize: '0.8rem' } } }} />
              <Button
                variant="outlined"
                startIcon={<ContentCopyRounded />}
                sx={{ flexShrink: 0 }}
                onClick={() => {
                  void navigator.clipboard?.writeText(invite.code);
                  notify('Invite code copied.');
                }}
              >
                Copy
              </Button>
            </Stack>
          </SectionCard>
        )}

        <SectionCard title="Join a workspace">
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Got a code from a teammate? Paste it here. Calls you already uploaded stay in your current workspace
            {me ? ` (${me.organization.name})` : ''}.
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              value={code}
              onChange={(event) => setCode(event.target.value)}
              size="small"
              fullWidth
              label="Invite code"
              placeholder="A1B2C3…"
              slotProps={{ htmlInput: { style: { fontFamily: 'monospace' } } }}
            />
            <Button variant="contained" startIcon={<GroupAddRounded />} disabled={!code.trim() || joining} onClick={() => void join()} sx={{ flexShrink: 0 }}>
              Join
            </Button>
          </Stack>
        </SectionCard>
      </Stack>
    </>
  );
}
