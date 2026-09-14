import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { Utterance } from '../services/types';
import { brand } from '../theme';
import { formatTimestamp } from '../utils/format';
import { RedactedText } from './RedactedText';

const ROLE_LABEL = { agent: 'Agent', customer: 'Customer', other: 'Participant' } as const;

/** Speaker-separated REDACTED transcript. Click a timestamp to play that moment of the safe recording. */
export function TranscriptView({
  utterances,
  roles,
  activeMs,
  onSeek,
}: {
  utterances: Utterance[];
  roles: Map<string, 'agent' | 'customer' | 'other'>;
  activeMs?: number;
  onSeek?: (ms: number) => void;
}) {
  if (utterances.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No speech was transcribed for this call.
      </Typography>
    );
  }

  return (
    <Stack spacing={0.5}>
      {utterances.map((u) => {
        const role = roles.get(u.speaker);
        const isAgent = role === 'agent';
        const active = activeMs !== undefined && activeMs >= u.start_ms && activeMs < u.end_ms;
        return (
          <Box
            key={u.seq}
            sx={{
              display: 'grid',
              gridTemplateColumns: '36px 1fr',
              gap: 1.5,
              p: 1.25,
              borderRadius: 2,
              transition: 'background-color 120ms',
              bgcolor: active ? alpha(brand.tealBright, 0.1) : 'transparent',
            }}
          >
            <Box
              aria-hidden
              sx={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                fontSize: '0.8rem',
                fontWeight: 700,
                bgcolor: isAgent ? alpha(brand.teal, 0.12) : '#EEF2F6',
                color: isAgent ? 'primary.dark' : '#334155',
              }}
            >
              {u.speaker}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
                <Typography variant="body2" sx={{ fontWeight: 650 }}>
                  {role ? ROLE_LABEL[role] : `Speaker ${u.speaker}`}
                </Typography>
                {role && (
                  <Typography variant="caption" color="text.secondary">
                    Speaker {u.speaker}
                  </Typography>
                )}
                <ButtonBase
                  onClick={() => onSeek?.(u.start_ms)}
                  disabled={!onSeek}
                  sx={{ borderRadius: 1, px: 0.5, fontSize: '0.75rem', color: 'primary.main', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
                  aria-label={`Play from ${formatTimestamp(u.start_ms)}`}
                >
                  {formatTimestamp(u.start_ms)}
                </ButtonBase>
              </Stack>
              <Typography variant="body1" sx={{ mt: 0.25, lineHeight: 1.7 }}>
                <RedactedText text={u.text} />
              </Typography>
            </Box>
          </Box>
        );
      })}
    </Stack>
  );
}
