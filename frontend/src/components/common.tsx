import LockRounded from '@mui/icons-material/LockRounded';
import SentimentDissatisfiedRounded from '@mui/icons-material/SentimentDissatisfiedRounded';
import SentimentNeutralRounded from '@mui/icons-material/SentimentNeutralRounded';
import SentimentSatisfiedAltRounded from '@mui/icons-material/SentimentSatisfiedAltRounded';
import { Box, Card, CardContent, Chip, Stack, Typography, type SxProps, type Theme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { ReactNode } from 'react';
import type { Sentiment } from '../services/types';
import { brand } from '../theme';
import { entityLabel, numberFormat } from '../utils/format';

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 3, alignItems: { md: 'flex-end' }, justifyContent: 'space-between' }}>
      <Box sx={{ minWidth: 0 }}>
        {eyebrow && <Box sx={{ mb: 0.75 }}>{eyebrow}</Box>}
        <Typography variant="h2" component="h1">
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 760 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {actions && (
        <Stack direction="row" spacing={1} sx={{ flexShrink: 0, flexWrap: 'wrap', rowGap: 1 }}>
          {actions}
        </Stack>
      )}
    </Stack>
  );
}

export function SectionCard({
  title,
  action,
  children,
  sx,
  dense = false,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  sx?: SxProps<Theme>;
  dense?: boolean;
}) {
  return (
    <Card sx={sx}>
      {(title || action) && (
        <Stack direction="row" sx={{ px: 2.5, pt: 2, pb: dense ? 1 : 1.5, alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Typography variant="h5" component="h2">
            {title}
          </Typography>
          {action}
        </Stack>
      )}
      <CardContent sx={{ pt: title ? 0 : 2.5, px: 2.5, '&:last-child': { pb: 2.5 } }}>{children}</CardContent>
    </Card>
  );
}

export function StatCard({
  label,
  value,
  icon,
  caption,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  caption?: ReactNode;
  accent?: boolean;
}) {
  return (
    <Card
      sx={{
        height: '100%',
        ...(accent && { background: `linear-gradient(135deg, ${brand.ink} 0%, #10312F 100%)`, borderColor: 'transparent', color: '#fff' }),
      }}
    >
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Typography variant="body2" sx={{ fontWeight: 600, color: accent ? 'rgba(255,255,255,0.75)' : 'text.secondary' }}>
            {label}
          </Typography>
          <Box
            sx={{
              display: 'grid',
              placeItems: 'center',
              width: 34,
              height: 34,
              borderRadius: 2,
              bgcolor: accent ? alpha(brand.tealBright, 0.18) : alpha(brand.teal, 0.08),
              color: accent ? brand.tealBright : 'primary.main',
              '& svg': { fontSize: 19 },
            }}
          >
            {icon}
          </Box>
        </Stack>
        <Typography sx={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.02em', mt: 1, lineHeight: 1.1 }}>{value}</Typography>
        {caption && (
          <Typography variant="caption" sx={{ display: 'block', mt: 0.75, color: accent ? 'rgba(255,255,255,0.65)' : 'text.secondary' }}>
            {caption}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return (
    <Stack spacing={1.5} sx={{ alignItems: 'center', textAlign: 'center', py: 6, px: 2 }}>
      <Box sx={{ display: 'grid', placeItems: 'center', width: 56, height: 56, borderRadius: '50%', bgcolor: alpha(brand.teal, 0.08), color: 'primary.main', '& svg': { fontSize: 28 } }}>
        {icon}
      </Box>
      <Typography variant="h4">{title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 440 }}>
        {description}
      </Typography>
      {action && <Box sx={{ pt: 1 }}>{action}</Box>}
    </Stack>
  );
}

const SENTIMENT_META: Record<Sentiment, { label: string; icon: ReactNode; color: string; bg: string }> = {
  positive: { label: 'Positive', icon: <SentimentSatisfiedAltRounded />, color: '#15803D', bg: '#DCFCE7' },
  neutral: { label: 'Neutral', icon: <SentimentNeutralRounded />, color: '#475569', bg: '#EEF2F6' },
  negative: { label: 'Negative', icon: <SentimentDissatisfiedRounded />, color: '#B91C1C', bg: '#FEE2E2' },
};

export function SentimentChip({ sentiment }: { sentiment: Sentiment | null }) {
  if (!sentiment) return <Typography variant="body2" color="text.disabled">—</Typography>;
  const meta = SENTIMENT_META[sentiment];
  return (
    <Chip
      size="small"
      icon={meta.icon as React.ReactElement}
      label={meta.label}
      sx={{ bgcolor: meta.bg, color: meta.color, '& .MuiChip-icon': { color: meta.color } }}
    />
  );
}

export const sentimentLabel = (s: Sentiment) => SENTIMENT_META[s].label;

export function PiiCount({ total }: { total: number }) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
      <LockRounded sx={{ fontSize: 15, color: total > 0 ? 'primary.main' : 'text.disabled' }} />
      <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {numberFormat.format(total)}
      </Typography>
    </Stack>
  );
}

/** Entity types and counts — never values. */
export function PiiBreakdown({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (entries.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No PII was detected under the selected policy.
      </Typography>
    );
  }
  return (
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75 }}>
      {entries.map(([type, count]) => (
        <Chip
          key={type}
          size="small"
          icon={<LockRounded />}
          label={`${entityLabel(type)} · ${count}`}
          variant="outlined"
          sx={{ borderColor: alpha(brand.teal, 0.3), '& .MuiChip-icon': { color: 'primary.main', fontSize: 14 } }}
        />
      ))}
    </Stack>
  );
}
