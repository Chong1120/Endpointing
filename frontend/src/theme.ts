import { alpha, createTheme } from '@mui/material/styles';

/** Enterprise, security-focused palette: ink neutrals with a teal "protected" accent. */
export const brand = {
  ink: '#0B1220',
  inkSoft: '#131C2E',
  teal: '#0F766E',
  tealBright: '#14B8A6',
  slate: '#475569',
  border: '#E3E8EF',
  canvas: '#F5F7FA',
  redaction: '#1E293B',
};

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: brand.teal, dark: '#0B5E58', light: '#5EAAA3', contrastText: '#FFFFFF' },
    secondary: { main: '#334155', contrastText: '#FFFFFF' },
    success: { main: '#15803D', light: '#DCFCE7' },
    warning: { main: '#B45309', light: '#FEF3C7' },
    error: { main: '#B91C1C', light: '#FEE2E2' },
    info: { main: '#1D4ED8', light: '#DBEAFE' },
    background: { default: brand.canvas, paper: '#FFFFFF' },
    text: { primary: '#0F172A', secondary: brand.slate },
    divider: brand.border,
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: '"Inter Variable", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    h1: { fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.02em' },
    h2: { fontSize: '1.6rem', fontWeight: 700, letterSpacing: '-0.015em' },
    h3: { fontSize: '1.3rem', fontWeight: 650, letterSpacing: '-0.01em' },
    h4: { fontSize: '1.1rem', fontWeight: 650 },
    h5: { fontSize: '1rem', fontWeight: 650 },
    h6: { fontSize: '0.9rem', fontWeight: 650 },
    subtitle2: { fontWeight: 600 },
    overline: { fontWeight: 650, letterSpacing: '0.08em', fontSize: '0.7rem' },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: 8, paddingInline: 14 } },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { border: `1px solid ${brand.border}`, borderRadius: 12 } },
    },
    MuiPaper: { styleOverrides: { outlined: { borderColor: brand.border } } },
    MuiChip: { styleOverrides: { root: { fontWeight: 600 }, sizeSmall: { height: 22, fontSize: '0.72rem' } } },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontSize: '0.72rem',
          fontWeight: 650,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: brand.slate,
          backgroundColor: '#FAFBFC',
        },
        root: { borderColor: brand.border },
      },
    },
    MuiTableRow: {
      styleOverrides: { hover: { '&:hover': { backgroundColor: alpha(brand.teal, 0.035) } } },
    },
    MuiTooltip: { styleOverrides: { tooltip: { backgroundColor: brand.ink, fontSize: '0.75rem' } } },
    MuiOutlinedInput: { styleOverrides: { root: { backgroundColor: '#FFFFFF' } } },
  },
});
