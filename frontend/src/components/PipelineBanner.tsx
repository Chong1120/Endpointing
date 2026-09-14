import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded';
import GraphicEqRounded from '@mui/icons-material/GraphicEqRounded';
import ShieldRounded from '@mui/icons-material/ShieldRounded';
import VerifiedUserRounded from '@mui/icons-material/VerifiedUserRounded';
import { Box, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { brand } from '../theme';

const PHASES: Array<{ label: string; caption: string; icon: ReactNode }> = [
  { label: 'Raw call', caption: 'Temporary only', icon: <GraphicEqRounded /> },
  { label: 'Protected by AssemblyAI', caption: 'Transcribe · detect · redact', icon: <ShieldRounded /> },
  { label: 'Safe call', caption: 'Redacted audio + transcript', icon: <VerifiedUserRounded /> },
  { label: 'AI analysis', caption: 'On safe data only', icon: <AutoAwesomeRounded /> },
];

export type PhaseState = 'done' | 'active' | 'pending' | 'failed';

/** RAW CALL → PROTECTED BY ASSEMBLYAI → SAFE CALL → AI ANALYSIS */
export function PipelineBanner({ states }: { states: PhaseState[] }) {
  return (
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      sx={{ alignItems: { md: 'center' }, gap: 1, p: 2, borderRadius: 3, bgcolor: brand.ink, color: '#CBD5E1' }}
    >
      {PHASES.map((phase, index) => {
        const state = states[index] ?? 'pending';
        const color =
          state === 'done' ? brand.tealBright : state === 'active' ? '#FFFFFF' : state === 'failed' ? '#FCA5A5' : '#64748B';
        return (
          <Stack key={phase.label} direction="row" sx={{ alignItems: 'center', gap: 1, flex: 1, minWidth: 0 }}>
            <Stack
              direction="row"
              sx={{
                alignItems: 'center',
                gap: 1.25,
                flex: 1,
                minWidth: 0,
                px: 1.5,
                py: 1.1,
                borderRadius: 2,
                border: '1px solid',
                borderColor: state === 'active' ? alpha(brand.tealBright, 0.7) : state === 'done' ? alpha(brand.tealBright, 0.3) : 'rgba(148,163,184,0.2)',
                bgcolor: state === 'done' ? alpha(brand.tealBright, 0.1) : state === 'active' ? alpha(brand.tealBright, 0.16) : 'transparent',
                ...(state === 'active' && {
                  animation: 'safecallPulse 1.8s ease-in-out infinite',
                  '@keyframes safecallPulse': {
                    '0%, 100%': { boxShadow: `0 0 0 0 ${alpha(brand.tealBright, 0.35)}` },
                    '50%': { boxShadow: `0 0 0 5px ${alpha(brand.tealBright, 0)}` },
                  },
                }),
              }}
            >
              <Box sx={{ color, display: 'grid', placeItems: 'center', '& svg': { fontSize: 20 } }}>{phase.icon}</Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.05em', lineHeight: 1.3, textTransform: 'uppercase', color: state === 'pending' ? '#94A3B8' : '#F8FAFC' }}>
                  {phase.label}
                </Typography>
                <Typography sx={{ fontSize: '0.72rem', color: '#94A3B8' }} noWrap>
                  {state === 'failed' ? 'Stopped — see details' : phase.caption}
                </Typography>
              </Box>
            </Stack>
            {index < PHASES.length - 1 && (
              <ArrowForwardRounded sx={{ display: { xs: 'none', md: 'block' }, fontSize: 18, color: states[index] === 'done' ? brand.tealBright : '#475569' }} />
            )}
          </Stack>
        );
      })}
    </Stack>
  );
}

/** Derives the four phases from the call's audit trail. */
export function phaseStates(events: Set<string>, status: string): PhaseState[] {
  const done = [
    events.has('CALL_RECEIVED'),
    events.has('TRANSCRIPT_REDACTED') && events.has('AUDIO_REDACTED'),
    events.has('SAFE_TRANSCRIPT_STORED') && events.has('SAFE_AUDIO_STORED'),
    events.has('AI_ANALYSIS_COMPLETED') || events.has('AI_ANALYSIS_SKIPPED'),
  ];
  const firstOpen = done.findIndex((d) => !d);
  return done.map((isDone, index) => {
    if (isDone) return 'done';
    if (index !== firstOpen) return 'pending';
    if (status === 'FAILED') return 'failed';
    return status === 'COMPLETED' ? 'done' : 'active';
  });
}
