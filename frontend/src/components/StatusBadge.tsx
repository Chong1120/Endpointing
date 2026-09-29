import { Box, CircularProgress } from '@mui/material';
import type { ReactNode } from 'react';
import type { CallStatus } from '../services/types';
import { fonts } from '../theme';

const IN_PROGRESS_LABEL: Partial<Record<CallStatus, string>> = {
  UPLOADING: 'Uploading',
  TRANSCRIBING: 'Transcribing',
  PROCESSING: 'Redacting',
};

/**
 * A rubber stamp: square, capitals, a coloured outline. `tilt` gives the large
 * one on a call's file its slightly-off, pressed-by-hand angle.
 */
export function Stamp({ children, color, tilt = false, large = false }: { children: ReactNode; color: string; tilt?: boolean; large?: boolean }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        px: large ? 1.5 : 0.9,
        py: large ? 0.55 : 0.2,
        border: `${large ? 2 : 1.5}px solid`,
        borderColor: color,
        color,
        borderRadius: '2px',
        fontFamily: fonts.mono,
        fontSize: large ? '0.78rem' : '0.64rem',
        fontWeight: 600,
        letterSpacing: large ? '0.18em' : '0.1em',
        textTransform: 'uppercase',
        lineHeight: 1.5,
        whiteSpace: 'nowrap',
        transform: tilt ? 'rotate(-2.5deg)' : undefined,
      }}
    >
      {children}
    </Box>
  );
}

/** Status as a stamp; the word carries the meaning, never the colour alone. */
export function StatusBadge({ status, large = false }: { status: CallStatus; large?: boolean }) {
  if (status === 'COMPLETED') {
    return large ? (
      <Stamp color="primary.main" tilt large>
        Safe archive
      </Stamp>
    ) : (
      <Stamp color="success.main">Archived</Stamp>
    );
  }
  if (status === 'FAILED') return <Stamp color="error.main" large={large}>Failed</Stamp>;
  return (
    <Stamp color="info.main" large={large}>
      <CircularProgress size={9} thickness={7} sx={{ color: 'info.main' }} />
      {IN_PROGRESS_LABEL[status] ?? 'Processing'}
    </Stamp>
  );
}
