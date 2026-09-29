import LogoutRounded from '@mui/icons-material/LogoutRounded';
import ShieldRounded from '@mui/icons-material/ShieldRounded';
import { Alert, Box, Button, Chip, Container, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Link as RouterLink, Outlet, useLocation } from 'react-router';
import { Logo } from '../components/Logo';
import { DemoBar } from '../components/DemoBar';
import { useAuth } from '../hooks/useAuth';
import { useMeState } from '../hooks/useMe';
import { brand } from '../theme';

/**
 * What a customer of Northwind Mobile sees. No console, no other people's
 * calls, no jargon: a phone line to the AI agent and the calls they made.
 * SafeCall is the privacy layer behind it, credited but not in the way.
 */
export function CustomerLayout() {
  const { session, signOut } = useAuth();
  const { error } = useMeState();
  const onHome = useLocation().pathname === '/';

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: brand.canvas }}>
      <Box sx={{ bgcolor: brand.ink, color: '#E4DED2' }}>
        <Container maxWidth="lg">
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', py: 1.75, gap: 2 }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
              <Logo inverted small />
              <Typography noWrap sx={{ color: '#9C9486', fontSize: '0.8rem', display: { xs: 'none', sm: 'block' } }}>
                Customer line
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Chip
                size="small"
                icon={<ShieldRounded sx={{ fontSize: 15 }} />}
                label="Northwind Mobile demo"
                sx={{ bgcolor: alpha(brand.signal, 0.12), color: brand.signal, '& .MuiChip-icon': { color: brand.signal }, display: { xs: 'none', sm: 'flex' } }}
              />
              {!onHome && (
                <Button component={RouterLink} to="/" size="small" sx={{ color: '#CFC8BA' }}>
                  Back
                </Button>
              )}
              <Button size="small" startIcon={<LogoutRounded />} onClick={() => void signOut()} sx={{ color: '#9C9486' }}>
                {session?.user.email ? 'Sign out' : 'Leave'}
              </Button>
            </Stack>
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: { xs: 2.5, md: 3.5 } }}>
        <DemoBar />
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error.message}
          </Alert>
        )}
        <Outlet />
      </Container>

      <Container maxWidth="lg" sx={{ pb: 4 }}>
        <Typography variant="caption" color="text.secondary">
          Calls are recorded. Names, numbers, addresses and card details are removed before anything is stored — even we cannot read them
          back. Northwind Mobile is fictional and every account here is made up.
        </Typography>
      </Container>
    </Box>
  );
}
