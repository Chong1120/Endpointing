import { keyframes } from '@emotion/react';
import CallEndRounded from '@mui/icons-material/CallEndRounded';
import CallRounded from '@mui/icons-material/CallRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import CloudDoneRounded from '@mui/icons-material/CloudDoneRounded';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import GraphicEqRounded from '@mui/icons-material/GraphicEqRounded';
import HeadsetMicRounded from '@mui/icons-material/HeadsetMicRounded';
import LockRounded from '@mui/icons-material/LockRounded';
import ShieldRounded from '@mui/icons-material/ShieldRounded';
import { Alert, Box, Button, Card, Chip, CircularProgress, Grid, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { PageHeader, SectionCard } from '../components/common';
import { useNotify } from '../hooks/useNotify';
import { ApiError, accessToken, api } from '../services/api';
import { brand } from '../theme';
import { formatTime } from '../utils/format';
import { LiveAgentCall, micErrorMessage, type SpeakingState } from '../voice/liveAgentCall';
import type { AgentAction } from '../voice/northwindTools';

type Stage = 'idle' | 'connecting' | 'live' | 'archiving' | 'failed';

// Fictional details: 555-0100 to 555-0199 and example.com are reserved for examples.
const SCRIPT = [
  'Hi, I think I was charged twice this month.',
  'The number on my account is 415 555 0142.',
  'Yes, please refund the second charge.',
  'Can you also change my email to jane.doe@example.com?',
  'Actually, can I speak to a real person about this?',
];

const ripple = keyframes`
  from { transform: scale(1); opacity: 0.55; }
  to { transform: scale(1.6); opacity: 0; }
`;

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

function statusCopy(stage: Stage, speaking: SpeakingState, hangingUp: boolean): { title: string; detail: string } {
  switch (stage) {
    case 'idle':
      return { title: 'Ready when you are', detail: 'Call Sam and talk like a Northwind Mobile customer. Use made-up details only.' };
    case 'connecting':
      return { title: 'Connecting…', detail: 'Opening a secure line to AssemblyAI.' };
    case 'live':
      if (hangingUp) return { title: 'Hanging up…', detail: 'Ending the session at AssemblyAI.' };
      if (speaking.agent) return { title: 'Sam is speaking', detail: 'Interrupt any time, like on a real call.' };
      if (speaking.caller) return { title: 'Listening', detail: 'Sam replies when you pause.' };
      return { title: 'Your turn', detail: "Speak naturally. Hang up when you're done." };
    case 'archiving':
      return { title: 'Protecting the recording…', detail: 'Fetching the call from AssemblyAI and sending it through PII redaction.' };
    case 'failed':
      return { title: 'The call did not finish', detail: 'See the message below the call panel.' };
  }
}

function CallOrb({ stage, speaking, level }: { stage: Stage; speaking: SpeakingState; level: number }) {
  const live = stage === 'live';
  const agentTalking = live && speaking.agent;
  const scale = live && !agentTalking ? 1 + Math.min(level, 1) * 0.35 : 1;
  return (
    <Box sx={{ position: 'relative', width: 176, height: 176, my: { xs: 3, md: 5 }, display: 'grid', placeItems: 'center' }} aria-hidden>
      {agentTalking &&
        [0, 0.7].map((delay) => (
          <Box
            key={delay}
            sx={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              border: `2px solid ${brand.tealBright}`,
              animation: `${ripple} 1.4s ease-out ${delay}s infinite`,
              '@media (prefers-reduced-motion: reduce)': { animation: 'none', opacity: 0.4 },
            }}
          />
        ))}
      <Box
        sx={{
          position: 'absolute',
          inset: 10,
          borderRadius: '50%',
          bgcolor: alpha(live ? brand.tealBright : '#94A3B8', live ? 0.16 : 0.08),
          transform: `scale(${scale})`,
          transition: 'transform 120ms linear',
        }}
      />
      <Box
        sx={{
          position: 'relative',
          width: 116,
          height: 116,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          bgcolor: live ? brand.teal : brand.inkSoft,
          border: `1px solid ${alpha('#FFFFFF', 0.12)}`,
          color: '#FFFFFF',
          '& svg': { fontSize: 46 },
        }}
      >
        {stage === 'connecting' || stage === 'archiving' ? <CircularProgress size={42} sx={{ color: brand.tealBright }} /> : <HeadsetMicRounded />}
      </Box>
    </Box>
  );
}

function PrivacyStep({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <Stack direction="row" spacing={1.5}>
      <Box
        sx={{ width: 32, height: 32, flexShrink: 0, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: alpha(brand.teal, 0.08), color: 'primary.main', '& svg': { fontSize: 18 } }}
      >
        {icon}
      </Box>
      <Box>
        <Typography variant="body2" sx={{ fontWeight: 650 }}>
          {title}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.5 }}>
          {text}
        </Typography>
      </Box>
    </Stack>
  );
}

const pillButton = { borderRadius: 999, px: 4, py: 1.25 };

export function LiveAgentPage() {
  const navigate = useNavigate();
  const notify = useNotify();
  const [stage, setStage] = useState<Stage>('idle');
  const [speaking, setSpeaking] = useState<SpeakingState>({ caller: false, agent: false });
  const [level, setLevel] = useState(0);
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [limit, setLimit] = useState(600);
  const [hangingUp, setHangingUp] = useState(false);
  const [unarchived, setUnarchived] = useState<string | null>(null);
  const [escalated, setEscalated] = useState(false);
  const callRef = useRef<LiveAgentCall | null>(null);
  // Read when the call is archived, which can happen after the call object is gone.
  const escalationRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const liveSince = useRef(0);
  const mounted = useRef(true);

  // Leaving mid-call (navigating away or closing the tab) ends the session and
  // still archives it, so AssemblyAI's unredacted copy doesn't linger.
  useEffect(() => {
    mounted.current = true;
    const leave = () => {
      const call = callRef.current;
      if (!call) return;
      callRef.current = null;
      const sessionId = call.sessionId;
      call.dispose();
      if (sessionId && tokenRef.current) api.archiveLiveAgentCallOnExit(sessionId, tokenRef.current, call.escalation);
    };
    window.addEventListener('pagehide', leave);
    return () => {
      mounted.current = false;
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, []);

  useEffect(() => {
    if (stage !== 'live') return;
    const timer = window.setInterval(() => {
      const seconds = (Date.now() - liveSince.current) / 1000;
      setElapsed(seconds);
      if (seconds >= limit - 1) callRef.current?.hangUp();
    }, 250);
    return () => window.clearInterval(timer);
  }, [stage, limit]);

  async function archive(sessionId: string) {
    setStage('archiving');
    setUnarchived(sessionId);
    try {
      const { call } = await api.archiveLiveAgentCall(sessionId, escalationRef.current);
      if (!mounted.current) return;
      notify(
        escalationRef.current
          ? `${call.reference} is waiting for a person in Escalations. Personal details are removed before anything is stored.`
          : `${call.reference} is being protected. Personal details are removed before anything is stored.`,
      );
      navigate(`/calls/${call.id}/processing`);
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof ApiError ? err.message : 'The call could not be archived. Try again.');
      setStage('failed');
    }
  }

  async function startCall() {
    setError(null);
    setActions([]);
    setElapsed(0);
    setHangingUp(false);
    setUnarchived(null);
    setEscalated(false);
    escalationRef.current = null;
    setStage('connecting');

    const outcome = { failed: false };
    const call = new LiveAgentCall({
      onLive: () => {
        liveSince.current = Date.now();
        setStage('live');
      },
      onSpeaking: setSpeaking,
      onAction: (action) => {
        if (action.tool === 'transfer_to_human') setEscalated(true);
        setActions((current) => [action, ...current].slice(0, 20));
      },
      onLevel: setLevel,
      onError: (message) => {
        outcome.failed = true;
        setError(message);
      },
    });
    callRef.current = call;

    const abort = (message: string) => {
      const cancelled = call.ended;
      call.dispose();
      callRef.current = null;
      if (cancelled) {
        setStage('idle');
      } else {
        setError(message);
        setStage('failed');
      }
    };

    try {
      await call.openMicrophone();
    } catch (err) {
      abort(micErrorMessage(err));
      return;
    }
    try {
      tokenRef.current = await accessToken();
      const session = await api.startLiveAgent();
      setLimit(session.max_session_seconds);
      await call.connect(session);
    } catch (err) {
      abort(err instanceof ApiError ? err.message : 'The live agent could not be started. Try again.');
      return;
    }

    const sessionId = await call.finished;
    if (callRef.current !== call) return; // Left the page: archived in the background.
    callRef.current = null;
    escalationRef.current = call.escalation;
    setHangingUp(false);
    if (sessionId) await archive(sessionId);
    else setStage(outcome.failed ? 'failed' : 'idle');
  }

  function hangUp() {
    setHangingUp(true);
    callRef.current?.hangUp();
  }

  const copy = statusCopy(stage, speaking, hangingUp);

  return (
    <>
      <PageHeader
        eyebrow={
          <Chip
            size="small"
            icon={<GraphicEqRounded />}
            label="Real time · AssemblyAI Voice Agent API"
            sx={{ bgcolor: alpha(brand.teal, 0.08), color: 'primary.main', '& .MuiChip-icon': { color: 'primary.main' } }}
          />
        }
        title="Live agent"
        subtitle="Call Northwind Mobile's AI billing agent. It listens, talks and looks things up in real time. When you hang up, SafeCall redacts the recording before anything is stored."
      />

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Card sx={{ bgcolor: brand.ink, border: 'none', color: '#E2E8F0' }}>
            <Stack sx={{ p: { xs: 2.5, md: 4 }, alignItems: 'center', textAlign: 'center', minHeight: { md: 540 } }}>
              <Stack direction="row" sx={{ width: '100%', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, textAlign: 'left' }}>
                <Box>
                  <Typography variant="overline" sx={{ color: brand.tealBright }}>
                    Northwind Mobile · Billing
                  </Typography>
                  <Typography sx={{ color: '#F8FAFC', fontWeight: 650, fontSize: '1.05rem' }}>Sam, AI support agent</Typography>
                </Box>
                <Chip
                  size="small"
                  label={stage === 'live' ? `${clock(elapsed)} / ${clock(limit)}` : `Up to ${Math.round(limit / 60)} min`}
                  sx={{ bgcolor: alpha('#FFFFFF', 0.08), color: '#CBD5E1', fontVariantNumeric: 'tabular-nums' }}
                />
              </Stack>

              <CallOrb stage={stage} speaking={speaking} level={level} />

              <Typography variant="h3" component="p" sx={{ color: '#F8FAFC' }} aria-live="polite">
                {copy.title}
              </Typography>
              <Typography variant="body2" sx={{ color: '#94A3B8', mt: 1, maxWidth: 440 }}>
                {copy.detail}
              </Typography>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 4, alignItems: 'center' }}>
                {(stage === 'idle' || stage === 'failed') && (
                  <Button
                    size="large"
                    variant="contained"
                    startIcon={<CallRounded />}
                    onClick={() => void startCall()}
                    sx={{ ...pillButton, bgcolor: brand.tealBright, color: brand.ink, '&:hover': { bgcolor: '#2DD4BF' } }}
                  >
                    {stage === 'failed' ? 'Call again' : 'Start call'}
                  </Button>
                )}
                {stage === 'failed' && unarchived && (
                  <Button
                    size="large"
                    variant="outlined"
                    startIcon={<CloudDoneRounded />}
                    onClick={() => void archive(unarchived)}
                    sx={{ ...pillButton, color: '#E2E8F0', borderColor: alpha('#FFFFFF', 0.3) }}
                  >
                    Archive this call
                  </Button>
                )}
                {stage === 'connecting' && (
                  <Button size="large" variant="outlined" onClick={() => callRef.current?.dispose()} sx={{ ...pillButton, color: '#E2E8F0', borderColor: alpha('#FFFFFF', 0.3) }}>
                    Cancel
                  </Button>
                )}
                {stage === 'live' && (
                  <Button size="large" variant="contained" color="error" startIcon={<CallEndRounded />} onClick={hangUp} disabled={hangingUp} sx={pillButton}>
                    End call
                  </Button>
                )}
              </Stack>

              <Typography variant="caption" sx={{ color: '#64748B', mt: 'auto', pt: 4 }}>
                Best in Chrome or Edge. Echo cancellation is on, so headphones are optional.
              </Typography>
            </Stack>
          </Card>
          {escalated && !error && (
            <Alert severity="info" sx={{ mt: 2 }}>
              Sam is handing this call to a person. It joins the Escalations queue once the recording is redacted.
            </Alert>
          )}
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </Grid>

        <Grid size={{ xs: 12, lg: 5 }}>
          <Stack spacing={2.5}>
            <SectionCard title="Try this call">
              <Stack component="ol" spacing={1.25} sx={{ m: 0, pl: 2.5 }}>
                {SCRIPT.map((line) => (
                  <Typography component="li" key={line} variant="body2">
                    “{line}”
                  </Typography>
                ))}
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                The number and email are made up. Whatever you say, names, numbers and addresses are removed from the stored recording and transcript.
              </Typography>
            </SectionCard>

            <SectionCard
              title="What Sam did"
              action={
                <Typography variant="caption" color="text.secondary">
                  Tool calls
                </Typography>
              }
            >
              {actions.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Account lookups, refunds and updates appear here as Sam makes them. Personal details are never shown.
                </Typography>
              ) : (
                <Stack component="ul" spacing={1.25} sx={{ listStyle: 'none', m: 0, p: 0 }}>
                  {actions.map((action) => (
                    <Stack component="li" key={action.id} direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
                      {action.ok ? (
                        <CheckCircleRounded sx={{ fontSize: 18, color: 'success.main', mt: '2px' }} />
                      ) : (
                        <ErrorOutlineRounded sx={{ fontSize: 18, color: 'warning.main', mt: '2px' }} />
                      )}
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {action.label}
                        </Typography>
                        {action.detail && (
                          <Typography variant="caption" color="text.secondary">
                            {action.detail}
                          </Typography>
                        )}
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                        {formatTime(action.at.toISOString())}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              )}
            </SectionCard>

            <SectionCard title="How this call stays private">
              <Stack spacing={1.75}>
                <PrivacyStep
                  icon={<LockRounded />}
                  title="During the call"
                  text="Audio streams directly between this browser and AssemblyAI. SafeCall's servers never receive the live conversation, and no transcript is shown on screen."
                />
                <PrivacyStep
                  icon={<ShieldRounded />}
                  title="When you hang up"
                  text="SafeCall fetches AssemblyAI's recording of the call and runs the same PII redaction as uploads: labels in the transcript, silence in the audio."
                />
                <PrivacyStep
                  icon={<CloudDoneRounded />}
                  title="What's kept"
                  text="Only the redacted recording, transcript and AI insights. The original session, with its unredacted recording, is deleted from AssemblyAI."
                />
              </Stack>
            </SectionCard>
          </Stack>
        </Grid>
      </Grid>
    </>
  );
}
