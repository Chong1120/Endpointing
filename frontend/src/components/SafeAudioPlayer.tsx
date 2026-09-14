import GraphicEqRounded from '@mui/icons-material/GraphicEqRounded';
import LockRounded from '@mui/icons-material/LockRounded';
import { Alert, Box, Button, Chip, Skeleton, Stack, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { api, ApiError } from '../services/api';
import type { Utterance } from '../services/types';
import { brand } from '../theme';
import { formatTimestamp } from '../utils/format';

export interface SafeAudioHandle {
  seek(ms: number): void;
}

const HAS_MARKER = /\[[A-Z][A-Z0-9_]*\]/;

/**
 * Plays the REDACTED recording through a short-lived signed URL issued by the
 * API (the storage bucket is private). The strip below the player marks the
 * transcript segments that contained redacted PII.
 */
export const SafeAudioPlayer = forwardRef<SafeAudioHandle, {
  callId: string;
  utterances: Utterance[];
  durationSeconds: number | null;
  onTime?: (ms: number) => void;
}>(function SafeAudioPlayer({ callId, utterances, durationSeconds, onTime }, ref) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expiresIn, setExpiresIn] = useState<number | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const retried = useRef(false);

  const loadUrl = useCallback(async () => {
    setError(null);
    try {
      const result = await api.audioUrl(callId);
      setUrl(result.url);
      setExpiresIn(result.expires_in);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the safe recording.');
    }
  }, [callId]);

  useEffect(() => {
    void loadUrl();
  }, [loadUrl]);

  useImperativeHandle(ref, () => ({
    seek(ms: number) {
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = ms / 1000;
      void audio.play().catch(() => undefined);
    },
  }));

  const totalMs = Math.max(
    (durationSeconds ?? 0) * 1000,
    utterances.reduce((max, u) => Math.max(max, u.end_ms), 0),
    1,
  );

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.5, gap: 1, flexWrap: 'wrap' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <GraphicEqRounded color="primary" />
          <Typography variant="h5" component="h2">
            Safe recording
          </Typography>
        </Stack>
        <Stack direction="row" spacing={0.75}>
          <Chip size="small" icon={<LockRounded />} label="PII silenced" sx={{ bgcolor: alpha(brand.teal, 0.08), color: 'primary.dark', '& .MuiChip-icon': { color: 'primary.main' } }} />
          {expiresIn !== null && (
            <Tooltip title="Playback uses a signed URL from a private bucket. Each access is recorded in the audit trail.">
              <Chip size="small" label={`Signed URL · ${Math.round(expiresIn / 60)} min`} variant="outlined" />
            </Tooltip>
          )}
        </Stack>
      </Stack>

      {error ? (
        <Alert severity="warning" action={<Button onClick={() => void loadUrl()}>Retry</Button>}>
          {error}
        </Alert>
      ) : url ? (
        <audio
          ref={audioRef}
          src={url}
          controls
          preload="metadata"
          style={{ width: '100%', height: 40 }}
          onTimeUpdate={(e) => {
            const ms = e.currentTarget.currentTime * 1000;
            setCurrentMs(ms);
            onTime?.(ms);
          }}
          onError={() => {
            // Signed URLs expire; fetch a fresh one once.
            if (!retried.current) {
              retried.current = true;
              void loadUrl();
            } else {
              setError('The safe recording could not be played.');
            }
          }}
        />
      ) : (
        <Skeleton variant="rounded" height={40} />
      )}

      {utterances.length > 0 && (
        <Box sx={{ mt: 1.5 }}>
          <Box
            role="img"
            aria-label="Timeline of transcript segments; dark segments contained redacted PII"
            sx={{ position: 'relative', height: 14, borderRadius: 1, bgcolor: '#F1F5F9', overflow: 'hidden' }}
          >
            {utterances.map((u) => {
              const redacted = HAS_MARKER.test(u.text);
              return (
                <Tooltip key={u.seq} title={`${formatTimestamp(u.start_ms)}–${formatTimestamp(u.end_ms)}${redacted ? ' · contains redacted PII' : ''}`}>
                  <Box
                    onClick={() => {
                      const audio = audioRef.current;
                      if (audio) {
                        audio.currentTime = u.start_ms / 1000;
                        void audio.play().catch(() => undefined);
                      }
                    }}
                    sx={{
                      position: 'absolute',
                      top: 2,
                      bottom: 2,
                      left: `${(u.start_ms / totalMs) * 100}%`,
                      width: `max(3px, calc(${((u.end_ms - u.start_ms) / totalMs) * 100}% - 2px))`,
                      borderRadius: '3px',
                      cursor: 'pointer',
                      bgcolor: redacted ? brand.redaction : alpha(brand.teal, 0.28),
                    }}
                  />
                </Tooltip>
              );
            })}
            <Box sx={{ position: 'absolute', top: 0, bottom: 0, width: 2, bgcolor: brand.tealBright, left: `${Math.min(100, (currentMs / totalMs) * 100)}%`, pointerEvents: 'none' }} />
          </Box>
          <Stack direction="row" spacing={2} sx={{ mt: 0.75 }}>
            <Legend color={alpha(brand.teal, 0.28)} label="Speech" />
            <Legend color={brand.redaction} label="Segment with silenced PII" />
          </Stack>
        </Box>
      )}
    </Box>
  );
});

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
      <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: color }} />
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Stack>
  );
}
