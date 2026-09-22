import CloudUploadRounded from '@mui/icons-material/CloudUploadRounded';
import FactCheckRounded from '@mui/icons-material/FactCheckRounded';
import ForumRounded from '@mui/icons-material/ForumRounded';
import HeadsetMicRounded from '@mui/icons-material/HeadsetMicRounded';
import InsightsRounded from '@mui/icons-material/InsightsRounded';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import MenuRounded from '@mui/icons-material/MenuRounded';
import PolicyRounded from '@mui/icons-material/PolicyRounded';
import GroupsRounded from '@mui/icons-material/GroupsRounded';
import SpaceDashboardRounded from '@mui/icons-material/SpaceDashboardRounded';
import SupportAgentRounded from '@mui/icons-material/SupportAgentRounded';
import {
  Alert,
  Avatar,
  Box,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Logo } from '../components/Logo';
import { useAuth } from '../hooks/useAuth';
import { useMeState } from '../hooks/useMe';
import { DemoBar } from '../components/DemoBar';
import type { Permission } from '../services/types';
import { brand } from '../theme';

const DRAWER_WIDTH = 252;

const NAV: Array<{ to: string; label: string; icon: ReactNode; end?: boolean; permission?: Permission }> = [
  { to: '/', label: 'Dashboard', icon: <SpaceDashboardRounded />, end: true, permission: 'calls:browse' },
  { to: '/agent', label: 'Live agent', icon: <HeadsetMicRounded />, permission: 'agent:call' },
  { to: '/escalations', label: 'Escalations', icon: <SupportAgentRounded />, permission: 'followups:read' },
  { to: '/upload', label: 'Upload call', icon: <CloudUploadRounded />, permission: 'calls:upload' },
  { to: '/calls', label: 'Calls & search', icon: <ForumRounded />, permission: 'calls:browse' },
  { to: '/analytics', label: 'Analytics', icon: <InsightsRounded />, permission: 'analytics:read' },
  { to: '/policies', label: 'PII policies', icon: <PolicyRounded />, permission: 'policies:write' },
  { to: '/audit', label: 'Audit trail', icon: <FactCheckRounded />, permission: 'audit:read' },
  { to: '/team', label: 'Team', icon: <GroupsRounded />, permission: 'team:read' },
];

export function AppLayout() {
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('md'));
  const [open, setOpen] = useState(false);
  const { session, signOut } = useAuth();
  const location = useLocation();
  const { me: profile, error: meError } = useMeState();

  const email = session?.user.email ?? '';
  const drawer = (
    <Stack sx={{ height: '100%', color: '#CBD5E1' }}>
      <Box sx={{ px: 2.5, pt: 2.75, pb: 2.5 }}>
        <Logo inverted />
      </Box>
      <List component="nav" sx={{ px: 1.5, flex: 1 }} aria-label="Main">
        {NAV.filter((item) => !item.permission || (profile?.user.permissions ?? []).includes(item.permission)).map((item) => {
          const active = item.end ? location.pathname === item.to : location.pathname.startsWith(item.to);
          return (
            <ListItemButton
              key={item.to}
              component={NavLink}
              to={item.to}
              end={item.end}
              onClick={() => setOpen(false)}
              sx={{
                borderRadius: 2,
                mb: 0.5,
                py: 0.9,
                color: active ? '#FFFFFF' : '#A7B3C4',
                bgcolor: active ? alpha(brand.tealBright, 0.14) : 'transparent',
                '&:hover': { bgcolor: alpha('#FFFFFF', 0.06) },
              }}
            >
              <ListItemIcon sx={{ minWidth: 36, color: active ? brand.tealBright : '#7C8BA1' }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} slotProps={{ primary: { sx: { fontSize: '0.9rem', fontWeight: active ? 650 : 500 } } }} />
            </ListItemButton>
          );
        })}
      </List>

      <Box sx={{ mx: 2, mb: 2, p: 1.5, borderRadius: 2, border: `1px solid ${alpha('#94A3B8', 0.18)}`, bgcolor: alpha('#FFFFFF', 0.03) }}>
        <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em', color: brand.tealBright }}>
          PROTECTED BY ASSEMBLYAI
        </Typography>
        <Typography sx={{ fontSize: '0.75rem', color: '#94A3B8', mt: 0.5, lineHeight: 1.45 }}>
          Voice Agent API · Universal-3.5 Pro · PII redaction for text & audio · LLM Gateway on safe data
        </Typography>
      </Box>

      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', px: 2, py: 1.75, borderTop: `1px solid ${alpha('#94A3B8', 0.15)}` }}>
        <Avatar sx={{ width: 32, height: 32, bgcolor: brand.teal, fontSize: '0.85rem' }}>{email.charAt(0).toUpperCase()}</Avatar>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography noWrap sx={{ fontSize: '0.82rem', fontWeight: 600, color: '#F1F5F9' }}>
            {profile?.organization.name ?? '…'}
          </Typography>
          <Typography noWrap sx={{ fontSize: '0.72rem', color: '#94A3B8' }}>
            {email}
          </Typography>
        </Box>
        <Tooltip title="Sign out">
          <IconButton size="small" onClick={() => void signOut()} sx={{ color: '#94A3B8' }} aria-label="Sign out">
            <LogoutRounded fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Stack>
  );

  return (
      <Box sx={{ display: 'flex', minHeight: '100vh' }}>
        {compact ? (
          <Drawer open={open} onClose={() => setOpen(false)} slotProps={{ paper: { sx: { width: DRAWER_WIDTH, bgcolor: brand.ink } } }}>
            {drawer}
          </Drawer>
        ) : (
          // Full-height dark column with a sticky nav, so long pages keep the sidebar background.
          <Box component="aside" sx={{ width: DRAWER_WIDTH, flexShrink: 0, bgcolor: brand.ink }}>
            <Box sx={{ position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' }}>{drawer}</Box>
          </Box>
        )}
        <Box component="main" sx={{ flex: 1, minWidth: 0 }}>
          {compact && (
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1, px: 2, py: 1, bgcolor: brand.ink }}>
              <IconButton onClick={() => setOpen(true)} sx={{ color: '#fff' }} aria-label="Open navigation">
                <MenuRounded />
              </IconButton>
              <Logo inverted small />
            </Stack>
          )}
          <Box sx={{ maxWidth: 1380, mx: 'auto', px: { xs: 2, md: 4 }, py: { xs: 2.5, md: 3.5 } }}>
            {meError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {meError.message}
              </Alert>
            )}
            <DemoBar />
            <Outlet />
          </Box>
        </Box>
      </Box>
  );
}
