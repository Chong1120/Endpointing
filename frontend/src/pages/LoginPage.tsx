import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded';
import LockRounded from '@mui/icons-material/LockRounded';
import ScienceRounded from '@mui/icons-material/ScienceRounded';
import ShieldRounded from '@mui/icons-material/ShieldRounded';
import VerifiedUserRounded from '@mui/icons-material/VerifiedUserRounded';
import { Alert, Box, Button, Card, CardContent, Divider, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Logo } from '../components/Logo';
import { RedactionMarker } from '../components/RedactedText';
import { useApiQuery } from '../hooks/useApiQuery';
import { useAuth } from '../hooks/useAuth';
import { api } from '../services/api';
import type { DemoPersona } from '../services/types';
import { brand } from '../theme';

function Feature({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <Stack direction="row" spacing={1.75}>
      <Box sx={{ width: 38, height: 38, flexShrink: 0, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: alpha(brand.tealBright, 0.14), color: brand.tealBright }}>
        {icon}
      </Box>
      <Box>
        <Typography sx={{ fontWeight: 650, color: '#F8FAFC' }}>{title}</Typography>
        <Typography sx={{ fontSize: '0.875rem', color: '#94A3B8', lineHeight: 1.5 }}>{text}</Typography>
      </Box>
    </Stack>
  );
}

/** One-click sign-in as a shared demo account, so the product can be tried without signing up. */
function DemoLogins({ onError }: { onError: (message: string | null) => void }) {
  const { signInAsDemo } = useAuth();
  const personas = useApiQuery(() => api.demoPersonas(), []);
  const [busy, setBusy] = useState<string | null>(null);

  async function enter(key: DemoPersona['key']) {
    setBusy(key);
    onError(null);
    try {
      await signInAsDemo(key);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'The demo accounts are unavailable. Sign up instead.');
      setBusy(null);
    }
  }

  if (personas.error || (!personas.loading && !personas.data)) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        <ScienceRounded sx={{ fontSize: 18, color: 'primary.main' }} />
        <Typography variant="body2" sx={{ fontWeight: 650 }}>
          Try it without signing up
        </Typography>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
        Shared accounts for testing, one for each role. They all work in the same demo workspace, so a call made as the customer shows up
        for the agent and the admin.
      </Typography>
      <Stack spacing={1}>
        {(personas.data?.personas ?? []).map((persona) => (
          <Button
            key={persona.key}
            onClick={() => void enter(persona.key)}
            disabled={busy !== null}
            variant="outlined"
            sx={{ justifyContent: 'flex-start', textAlign: 'left', py: 1.1, px: 1.75 }}
          >
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {busy === persona.key ? 'Signing in…' : `Enter as ${persona.label}`}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.4 }}>
                {persona.blurb}
              </Typography>
            </Box>
          </Button>
        ))}
      </Stack>
      <Divider sx={{ mt: 2.5 }}>
        <Typography variant="caption" color="text.secondary">
          or use your own account
        </Typography>
      </Divider>
    </Box>
  );
}

export function LoginPage() {
  const { session, loading, signIn, signUp } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organization, setOrganization] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (!loading && session) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== '/login' ? from : '/'} replace />;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === 'signin') {
        await signIn(email, password);
      } else {
        const { needsConfirmation } = await signUp(email, password, organization);
        if (needsConfirmation) setInfo('Account created. Check your email to confirm it, then sign in.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.1fr 1fr' } }}>
      <Box
        sx={{
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          justifyContent: 'space-between',
          p: 6,
          background: `radial-gradient(circle at 20% 10%, ${alpha(brand.tealBright, 0.16)} 0, transparent 45%), linear-gradient(160deg, ${brand.ink} 0%, #0E1D2B 100%)`,
        }}
      >
        <Logo inverted />
        <Box sx={{ maxWidth: 520 }}>
          <Typography sx={{ color: brand.tealBright, fontWeight: 700, letterSpacing: '0.08em', fontSize: '0.78rem' }}>
            PRIVACY-FIRST CALL ARCHIVE
          </Typography>
          <Typography sx={{ color: '#fff', fontSize: '2.35rem', fontWeight: 750, letterSpacing: '-0.025em', lineHeight: 1.15, mt: 1.5 }}>
            Turn sensitive conversations into safe, reusable business data.
          </Typography>
          <Box sx={{ mt: 3, p: 2, borderRadius: 2, bgcolor: alpha('#FFFFFF', 0.04), border: `1px solid ${alpha('#94A3B8', 0.15)}` }}>
            <Typography sx={{ color: '#CBD5E1', fontSize: '0.95rem', lineHeight: 2 }}>
              “Hi, my name is <RedactionMarker entity="PERSON_NAME" /> and my card number is <RedactionMarker entity="CREDIT_CARD_NUMBER" />.”
            </Typography>
          </Box>
          <Stack spacing={2.5} sx={{ mt: 4 }}>
            <Feature icon={<ShieldRounded />} title="Protected by AssemblyAI" text="Transcription, speaker separation and PII redaction for both transcript and audio." />
            <Feature icon={<VerifiedUserRounded />} title="Only safe artifacts are archived" text="Raw uploads are deleted after transfer. Your archive holds redacted audio, redacted text and statistics." />
            <Feature icon={<AutoAwesomeRounded />} title="AI insights on safe data" text="Summaries, sentiment, topics and action items generated from the redacted transcript only." />
          </Stack>
        </Box>
        <Typography sx={{ color: '#64748B', fontSize: '0.75rem' }}>
          Hackathon prototype. Automated redaction is not a compliance certification.
        </Typography>
      </Box>

      <Box sx={{ display: 'grid', placeItems: 'center', p: { xs: 2, sm: 4 } }}>
        <Card sx={{ width: '100%', maxWidth: 420 }}>
          <CardContent sx={{ p: 4 }}>
            <Box sx={{ display: { md: 'none' }, mb: 3 }}>
              <Logo />
            </Box>
            <Typography variant="h3">{mode === 'signin' ? 'Welcome back' : 'Create your workspace'}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2.5 }}>
              {mode === 'signin' ? 'Sign in to your SafeCall archive.' : 'Your organization gets its own isolated archive.'}
            </Typography>
            <DemoLogins onError={setError} />
            <Tabs value={mode} onChange={(_e, value) => setMode(value)} sx={{ mb: 2.5, minHeight: 40, '& .MuiTab-root': { minHeight: 40 } }}>
              <Tab value="signin" label="Sign in" />
              <Tab value="signup" label="Create account" />
            </Tabs>
            <Stack component="form" spacing={2} onSubmit={submit}>
              {mode === 'signup' && (
                <TextField label="Organization name" value={organization} onChange={(e) => setOrganization(e.target.value)} placeholder="Northwind Support" fullWidth />
              )}
              <TextField label="Work email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} fullWidth />
              <TextField
                label="Password"
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                helperText={mode === 'signup' ? 'At least 8 characters.' : undefined}
                slotProps={{ htmlInput: { minLength: mode === 'signup' ? 8 : undefined } }}
                fullWidth
              />
              {error && <Alert severity="error">{error}</Alert>}
              {info && <Alert severity="info">{info}</Alert>}
              <Button type="submit" variant="contained" size="large" disabled={busy} startIcon={<LockRounded />}>
                {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in securely' : 'Create account'}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
