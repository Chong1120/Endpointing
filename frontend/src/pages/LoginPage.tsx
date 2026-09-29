import LockRounded from '@mui/icons-material/LockRounded';
import ScienceRounded from '@mui/icons-material/ScienceRounded';
import { Alert, Box, Button, Card, CardContent, Divider, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Logo } from '../components/Logo';
import { RedactionMarker } from '../components/RedactedText';
import { useApiQuery } from '../hooks/useApiQuery';
import { useAuth } from '../hooks/useAuth';
import { api } from '../services/api';
import type { DemoPersona } from '../services/types';
import { Stamp } from '../components/StatusBadge';
import { GRAIN, brand, fonts } from '../theme';

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
      {/* The dossier cover: ink, a stamped label, and a page from the archive with its redactions. */}
      <Box
        sx={{
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          justifyContent: 'space-between',
          p: 6,
          bgcolor: brand.ink,
          backgroundImage: GRAIN,
        }}
      >
        <Logo inverted />
        <Box sx={{ maxWidth: 540 }}>
          <Typography sx={{ fontFamily: fonts.mono, color: brand.signal, fontWeight: 500, letterSpacing: '0.16em', fontSize: '0.72rem' }}>
            CASE FILE · CALL RECORDINGS
          </Typography>
          <Typography sx={{ fontFamily: fonts.display, color: brand.canvas, fontSize: '2.7rem', fontWeight: 700, lineHeight: 1.08, mt: 1.5 }}>
            Turn sensitive conversations into safe, reusable business data.
          </Typography>

          <Box sx={{ position: 'relative', mt: 4, p: 2.75, pt: 2.25, bgcolor: brand.canvas, backgroundImage: GRAIN, transform: 'rotate(-1deg)', boxShadow: '0 18px 40px rgba(0,0,0,0.45)' }}>
            <Typography sx={{ fontFamily: fonts.mono, fontSize: '0.64rem', letterSpacing: '0.14em', color: '#6E685D', mb: 1 }}>
              TRANSCRIPT · EXCERPT · SPEAKER B
            </Typography>
            <Typography sx={{ color: brand.ink, fontSize: '1.02rem', lineHeight: 2.1 }}>
              “Hi, my name is <RedactionMarker entity="PERSON_NAME" /> and my card number is <RedactionMarker entity="CREDIT_CARD_NUMBER" />.”
            </Typography>
            <Box sx={{ position: 'absolute', right: 18, top: -14 }}>
              <Stamp color={brand.signalDeep} tilt large>
                Redacted
              </Stamp>
            </Box>
          </Box>

          <Stack sx={{ mt: 4.5 }}>
            {[
              ['01', 'Protected by AssemblyAI', 'Transcription, speaker separation and PII redaction for the transcript and the audio.'],
              ['02', 'Only safe artifacts are archived', 'Raw audio is deleted after transfer. The archive holds redacted audio, redacted text and statistics.'],
              ['03', 'AI insights on safe data', 'Summaries, sentiment and topics, generated from the redacted transcript only.'],
            ].map(([n, title, text]) => (
              <Stack key={n} direction="row" spacing={2} sx={{ py: 1.4, borderTop: `1px solid ${alpha(brand.canvas, 0.14)}` }}>
                <Typography sx={{ fontFamily: fonts.mono, fontSize: '0.78rem', color: brand.signal, pt: '2px', width: 22 }}>{n}</Typography>
                <Box>
                  <Typography sx={{ fontWeight: 600, color: brand.canvas }}>{title}</Typography>
                  <Typography sx={{ fontSize: '0.86rem', color: '#9C9486', lineHeight: 1.5 }}>{text}</Typography>
                </Box>
              </Stack>
            ))}
          </Stack>
        </Box>
        <Typography sx={{ fontFamily: fonts.mono, color: '#6E685D', fontSize: '0.66rem', letterSpacing: '0.06em' }}>
          HACKATHON PROTOTYPE · AUTOMATED REDACTION IS NOT A COMPLIANCE CERTIFICATION
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
