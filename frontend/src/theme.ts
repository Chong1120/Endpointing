import { alpha, createTheme } from '@mui/material/styles';

/**
 * "Redacted Dossier": the product removes personal data from calls, so it
 * looks like the documents redaction comes from — paper, ink, hairline rules,
 * stamps — with one hot signal colour. Ink is also the colour of every
 * redaction bar, which is the point.
 */
export const brand = {
  ink: '#141414',
  inkSoft: '#211F1C',
  /** Hot signal orange: on ink, for stamps and display accents. */
  signal: '#FF5A1F',
  /** Deeper signal: text, icons and buttons on paper. */
  signalDeep: '#D9480F',
  slate: '#5B5549',
  border: '#D6CEBD',
  canvas: '#F1EDE4',
  sheet: '#FBF9F4',
  redaction: '#141414',
};

export const fonts = {
  display: '"IBM Plex Sans Condensed", "IBM Plex Sans", "Arial Narrow", sans-serif',
  text: '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, "Cascadia Mono", Consolas, monospace',
};

/** Warm paper grain, drawn once and tiled; nothing to download. */
export const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.09 0 0 0 0 0.07 0 0 0 0 0.04 0 0 0 0.06 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: brand.signalDeep, dark: '#B83A0B', light: '#FF8A5B', contrastText: '#FFFFFF' },
    secondary: { main: brand.ink, contrastText: brand.sheet },
    success: { main: '#2F6B3F', light: '#E1EBDC' },
    warning: { main: '#935400', light: '#F3E5C6' },
    error: { main: '#B42318', light: '#F5DCD4' },
    info: { main: '#1F3A5F', light: '#DDE3EB' },
    background: { default: brand.canvas, paper: brand.sheet },
    text: { primary: brand.ink, secondary: brand.slate },
    divider: brand.border,
  },
  shape: { borderRadius: 2 },
  typography: {
    fontFamily: fonts.text,
    h1: { fontFamily: fonts.display, fontSize: '2.15rem', fontWeight: 700, letterSpacing: '-0.005em' },
    h2: { fontFamily: fonts.display, fontSize: '1.75rem', fontWeight: 700 },
    h3: { fontFamily: fonts.display, fontSize: '1.35rem', fontWeight: 600 },
    h4: { fontFamily: fonts.display, fontSize: '1.15rem', fontWeight: 600 },
    h5: { fontSize: '1rem', fontWeight: 600 },
    h6: { fontSize: '0.9rem', fontWeight: 600 },
    subtitle2: { fontWeight: 600 },
    overline: { fontFamily: fonts.mono, fontWeight: 500, letterSpacing: '0.14em', fontSize: '0.68rem' },
    caption: { letterSpacing: '0.005em' },
    button: { textTransform: 'none', fontWeight: 600, letterSpacing: '0.01em' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: brand.canvas, backgroundImage: GRAIN },
        '::selection': { backgroundColor: alpha(brand.signal, 0.28) },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 2, paddingInline: 16 },
        outlined: { borderColor: brand.ink, color: brand.ink, '&:hover': { borderColor: brand.ink, backgroundColor: alpha(brand.ink, 0.05) } },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { border: `1px solid ${brand.border}`, borderRadius: 2, backgroundColor: brand.sheet } },
    },
    MuiPaper: { styleOverrides: { rounded: { borderRadius: 2 }, outlined: { borderColor: brand.border } } },
    // Chips read as stamps: square, monospaced, capitals.
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 2, fontFamily: fonts.mono, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase' },
        sizeSmall: { height: 22, fontSize: '0.66rem' },
        outlined: { borderColor: brand.ink },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontFamily: fonts.mono,
          fontSize: '0.68rem',
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: brand.slate,
          backgroundColor: '#ECE7DC',
        },
        root: { borderColor: brand.border },
      },
    },
    MuiTableRow: {
      styleOverrides: { hover: { '&:hover': { backgroundColor: alpha(brand.signal, 0.05) } } },
    },
    MuiTooltip: {
      styleOverrides: { tooltip: { backgroundColor: brand.ink, borderRadius: 2, fontSize: '0.75rem' } },
    },
    MuiOutlinedInput: {
      styleOverrides: { root: { backgroundColor: brand.sheet, borderRadius: 2 }, notchedOutline: { borderColor: '#BDB4A2' } },
    },
    MuiAlert: { styleOverrides: { root: { borderRadius: 2 } } },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600 } } },
    MuiLinearProgress: { styleOverrides: { root: { borderRadius: 0 } } },
  },
});
