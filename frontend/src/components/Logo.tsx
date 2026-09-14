import { Box, Stack, Typography } from '@mui/material';
import { brand } from '../theme';

export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <Box component="svg" viewBox="0 0 32 32" sx={{ width: size, height: size, flexShrink: 0 }} aria-hidden>
      <path fill={brand.teal} d="M16 2 4 7v8c0 7.2 5.1 13.9 12 15 6.9-1.1 12-7.8 12-15V7L16 2z" />
      <path fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" d="m10.5 16.2 3.8 3.8 7.2-7.6" />
    </Box>
  );
}

export function Logo({ inverted = false, small = false }: { inverted?: boolean; small?: boolean }) {
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
      <LogoMark size={small ? 24 : 30} />
      <Box>
        <Typography sx={{ fontWeight: 750, fontSize: small ? '1rem' : '1.15rem', letterSpacing: '-0.01em', color: inverted ? '#FFFFFF' : 'text.primary', lineHeight: 1.1 }}>
          SafeCall
        </Typography>
        {!small && (
          <Typography sx={{ fontSize: '0.7rem', color: inverted ? '#94A3B8' : 'text.secondary', lineHeight: 1.3 }}>
            Privacy-first call archive
          </Typography>
        )}
      </Box>
    </Stack>
  );
}
