import { Box, Stack, Typography } from '@mui/material';
import { brand, fonts } from '../theme';

/**
 * A page with one line redacted: what the product does, in 32 pixels.
 * On dark backgrounds the page turns to paper and the text lines to ink.
 */
export function LogoMark({ size = 30, inverted = false }: { size?: number; inverted?: boolean }) {
  const page = inverted ? brand.canvas : brand.ink;
  const line = inverted ? brand.ink : brand.canvas;
  return (
    <Box component="svg" viewBox="0 0 32 32" sx={{ width: size, height: size, flexShrink: 0 }} aria-hidden>
      <rect x="3" y="2" width="26" height="28" rx="1.5" fill={page} />
      <rect x="8" y="8" width="16" height="2.4" fill={line} opacity="0.85" />
      <rect x="8" y="13.6" width="16" height="5.4" fill={brand.signal} />
      <rect x="8" y="22.4" width="10" height="2.4" fill={line} opacity="0.85" />
    </Box>
  );
}

export function Logo({ inverted = false, small = false }: { inverted?: boolean; small?: boolean }) {
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
      <LogoMark size={small ? 24 : 30} inverted={inverted} />
      <Box>
        <Typography
          sx={{
            fontFamily: fonts.display,
            fontWeight: 700,
            fontSize: small ? '1.05rem' : '1.25rem',
            letterSpacing: '0.005em',
            color: inverted ? brand.canvas : 'text.primary',
            lineHeight: 1.05,
          }}
        >
          SafeCall
        </Typography>
        {!small && (
          <Typography sx={{ fontFamily: fonts.mono, fontSize: '0.55rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: inverted ? '#9C9486' : 'text.secondary', lineHeight: 1.5 }}>
            Privacy-first call archive
          </Typography>
        )}
      </Box>
    </Stack>
  );
}
