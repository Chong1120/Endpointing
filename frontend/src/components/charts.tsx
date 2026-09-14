import BarChartRounded from '@mui/icons-material/BarChartRounded';
import TableRowsRounded from '@mui/icons-material/TableRowsRounded';
import {
  Box,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useState, type ReactNode } from 'react';
import { numberFormat } from '../utils/format';
import { SectionCard } from './common';

/**
 * Chart tokens (validated with the dataviz palette validator against the white
 * card surface). Single-series magnitude marks use one teal. Sentiment uses the
 * diverging red ↔ blue pair with a neutral gray midpoint (adjacent CVD ΔE 12.1);
 * the gray is below 3:1, so the legend carries values and a table view exists.
 * Text always uses text tokens, never a series color.
 */
export const CHART = {
  mark: '#0D9488',
  markHover: '#0B7F75',
  grid: '#EDF1F5',
  baseline: '#CBD5E1',
  negative: '#E34948',
  neutral: '#A8A69E',
  positive: '#2A78D6',
};

interface TableData {
  columns: string[];
  rows: Array<Array<string | number>>;
}

/** Card with a chart ⇄ table toggle — every chart has a table-view twin. */
export function ChartCard({
  title,
  subtitle,
  table,
  children,
}: {
  title: string;
  subtitle?: string;
  table: TableData;
  children: ReactNode;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <SectionCard
      title={title}
      sx={{ height: '100%' }}
      action={
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_e, next) => next && setView(next)}>
          <ToggleButton value="chart" aria-label="Chart view" sx={{ px: 1, py: 0.25 }}>
            <BarChartRounded sx={{ fontSize: 17 }} />
          </ToggleButton>
          <ToggleButton value="table" aria-label="Table view" sx={{ px: 1, py: 0.25 }}>
            <TableRowsRounded sx={{ fontSize: 17 }} />
          </ToggleButton>
        </ToggleButtonGroup>
      }
    >
      {subtitle && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -0.75, mb: 2 }}>
          {subtitle}
        </Typography>
      )}
      {view === 'chart' ? (
        children
      ) : (
        <Box sx={{ maxHeight: 320, overflow: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                {table.columns.map((c, i) => (
                  <TableCell key={c} align={i === 0 ? 'left' : 'right'}>
                    {c}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {table.rows.map((row, r) => (
                <TableRow key={r}>
                  {row.map((cell, i) => (
                    <TableCell key={i} align={i === 0 ? 'left' : 'right'} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {typeof cell === 'number' ? numberFormat.format(cell) : cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
    </SectionCard>
  );
}

/** Horizontal single-series bars, ranked. Value sits at the bar tip. */
export function BarList({ data, unit }: { data: Array<{ label: string; value: number }>; unit: string }) {
  if (data.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
        No data yet.
      </Typography>
    );
  }
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <Stack spacing={0.25}>
      {data.map((d) => (
        <Tooltip key={d.label} title={`${d.label}: ${numberFormat.format(d.value)} ${unit}`} placement="top" followCursor>
          <Box
            tabIndex={0}
            sx={{
              display: 'grid',
              gridTemplateColumns: 'minmax(96px, 38%) 1fr',
              alignItems: 'center',
              gap: 1.5,
              py: 0.6,
              px: 0.5,
              borderRadius: 1,
              outline: 'none',
              '&:hover .bar, &:focus-visible .bar': { bgcolor: CHART.markHover },
              '&:focus-visible': { boxShadow: `0 0 0 2px ${CHART.mark}` },
            }}
          >
            <Typography variant="body2" noWrap title={d.label}>
              {d.label}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
              <Box
                className="bar"
                sx={{
                  height: 14,
                  width: `${Math.max((d.value / max) * 100, 1.5)}%`,
                  maxWidth: 'calc(100% - 44px)',
                  bgcolor: CHART.mark,
                  borderRadius: '0 4px 4px 0',
                  transition: 'background-color 120ms',
                }}
              />
              <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'text.primary' }}>
                {numberFormat.format(d.value)}
              </Typography>
            </Stack>
          </Box>
        </Tooltip>
      ))}
    </Stack>
  );
}

function niceStep(max: number, ticks = 4): number {
  const raw = Math.max(max / ticks, 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Daily columns with hairline gridlines, clean integer ticks and a per-column hover tooltip. */
export function ColumnChart({
  data,
  unit,
  formatX,
  height = 190,
}: {
  data: Array<{ key: string; value: number }>;
  unit: string;
  formatX: (key: string) => string;
  height?: number;
}) {
  const max = Math.max(...data.map((d) => d.value), 0);
  const step = niceStep(max);
  const top = Math.max(step * Math.ceil(max / step), step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const peak = data.reduce((best, d, i) => (d.value > (data[best]?.value ?? -1) ? i : best), 0);
  const labelEvery = Math.ceil(data.length / 7);

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '32px 1fr', columnGap: 1 }}>
      {/* Y axis ticks */}
      <Box sx={{ position: 'relative', height }}>
        {ticks.map((t) => (
          <Typography
            key={t}
            variant="caption"
            sx={{ position: 'absolute', right: 0, bottom: `${(t / top) * 100}%`, transform: 'translateY(50%)', color: 'text.secondary', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}
          >
            {numberFormat.format(t)}
          </Typography>
        ))}
      </Box>
      {/* Plot */}
      <Box sx={{ position: 'relative', height }}>
        {ticks.map((t) => (
          <Box key={t} sx={{ position: 'absolute', left: 0, right: 0, bottom: `${(t / top) * 100}%`, height: '1px', bgcolor: t === 0 ? CHART.baseline : CHART.grid }} />
        ))}
        <Stack direction="row" sx={{ position: 'absolute', inset: 0, alignItems: 'flex-end' }}>
          {data.map((d, i) => (
            <Tooltip key={d.key} title={`${formatX(d.key)}: ${numberFormat.format(d.value)} ${unit}`} placement="top">
              <Box
                tabIndex={0}
                aria-label={`${formatX(d.key)}: ${d.value} ${unit}`}
                sx={{
                  flex: 1,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                  outline: 'none',
                  cursor: 'default',
                  '&:hover .col, &:focus-visible .col': { bgcolor: CHART.markHover },
                  '&:hover, &:focus-visible': { bgcolor: 'rgba(15,23,42,0.03)' },
                }}
              >
                {i === peak && d.value > 0 && (
                  <Typography variant="caption" sx={{ fontWeight: 650, color: 'text.primary', mb: 0.25, lineHeight: 1 }}>
                    {numberFormat.format(d.value)}
                  </Typography>
                )}
                <Box
                  className="col"
                  sx={{
                    width: 'min(24px, 62%)',
                    height: d.value > 0 ? `calc(${(d.value / top) * 100}% - ${i === peak ? 14 : 0}px)` : 0,
                    minHeight: d.value > 0 ? 3 : 0,
                    bgcolor: CHART.mark,
                    borderRadius: '4px 4px 0 0',
                    transition: 'background-color 120ms',
                  }}
                />
              </Box>
            </Tooltip>
          ))}
        </Stack>
      </Box>
      {/* X axis labels */}
      <Box />
      <Stack direction="row" sx={{ pt: 0.75 }}>
        {data.map((d, i) => (
          <Typography key={d.key} variant="caption" color="text.secondary" sx={{ flex: 1, textAlign: 'center', whiteSpace: 'nowrap', visibility: i % labelEvery === 0 || i === data.length - 1 ? 'visible' : 'hidden' }}>
            {formatX(d.key)}
          </Typography>
        ))}
      </Stack>
    </Box>
  );
}

/** Customer sentiment as a single diverging 100% stacked bar: negative ← neutral → positive. */
export function SentimentBar({ counts }: { counts: { positive: number; neutral: number; negative: number } }) {
  const total = counts.positive + counts.neutral + counts.negative;
  const segments = [
    { key: 'negative', label: 'Negative', value: counts.negative, color: CHART.negative },
    { key: 'neutral', label: 'Neutral', value: counts.neutral, color: CHART.neutral },
    { key: 'positive', label: 'Positive', value: counts.positive, color: CHART.positive },
  ];
  if (total === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
        Sentiment appears once analyzed calls are archived.
      </Typography>
    );
  }
  const pct = (v: number) => Math.round((v / total) * 100);
  return (
    <Box>
      <Stack direction="row" sx={{ height: 28, gap: '2px' }}>
        {segments
          .filter((s) => s.value > 0)
          .map((s, i, visible) => (
            <Tooltip key={s.key} title={`${s.label}: ${s.value} ${s.value === 1 ? 'call' : 'calls'} (${pct(s.value)}%)`}>
              <Box
                tabIndex={0}
                sx={{
                  flex: s.value,
                  bgcolor: s.color,
                  borderRadius: `${i === 0 ? 4 : 0}px ${i === visible.length - 1 ? 4 : 0}px ${i === visible.length - 1 ? 4 : 0}px ${i === 0 ? 4 : 0}px`,
                  display: 'grid',
                  placeItems: 'center',
                  outline: 'none',
                  '&:hover, &:focus-visible': { filter: 'brightness(1.08)' },
                }}
              >
                {pct(s.value) >= 18 && (
                  <Typography variant="caption" sx={{ color: s.key === 'neutral' ? '#0F172A' : '#FFFFFF', fontWeight: 700 }}>
                    {pct(s.value)}%
                  </Typography>
                )}
              </Box>
            </Tooltip>
          ))}
      </Stack>
      <Stack direction="row" sx={{ mt: 2, justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5 }}>
        {segments.map((s) => (
          <Stack key={s.key} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: s.color }} />
            <Typography variant="body2" color="text.secondary">
              {s.label}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>
              {s.value}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}
