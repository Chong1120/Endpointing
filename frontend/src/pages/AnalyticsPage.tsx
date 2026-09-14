import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import ForumRounded from '@mui/icons-material/ForumRounded';
import InsightsRounded from '@mui/icons-material/InsightsRounded';
import LockRounded from '@mui/icons-material/LockRounded';
import TimerRounded from '@mui/icons-material/TimerRounded';
import { Alert, Box, Grid, Skeleton, Stack, Typography } from '@mui/material';
import { BarList, ChartCard, ColumnChart, SentimentBar } from '../components/charts';
import { EmptyState, PageHeader, SectionCard, StatCard } from '../components/common';
import { ExportMenu } from '../components/ExportMenu';
import { useApiQuery } from '../hooks/useApiQuery';
import { api } from '../services/api';
import { entityLabel, formatDate, formatSeconds, numberFormat } from '../utils/format';

export function AnalyticsPage() {
  const analytics = useApiQuery(() => api.analytics(), [], { poll: (d) => (d && d.totals.in_progress > 0 ? 5000 : false) });
  const data = analytics.data;

  if (analytics.error && !data) return <Alert severity="error">{analytics.error.message}</Alert>;

  const header = (
    <PageHeader
      title="Analytics"
      subtitle="Aggregated from the safe archive: counts, redaction statistics and AI analysis of redacted transcripts."
      actions={<ExportMenu />}
    />
  );

  if (!data) {
    return (
      <>
        {header}
        <Grid container spacing={2}>
          {[0, 1, 2, 3].map((i) => (
            <Grid key={i} size={{ xs: 12, sm: 6, lg: 3 }}>
              <Skeleton variant="rounded" height={128} />
            </Grid>
          ))}
          <Grid size={12}>
            <Skeleton variant="rounded" height={300} />
          </Grid>
        </Grid>
      </>
    );
  }

  const { totals } = data;
  if (totals.calls === 0) {
    return (
      <>
        {header}
        <SectionCard>
          <EmptyState icon={<InsightsRounded />} title="No analytics yet" description="Process a few calls. Charts fill in as safe archives are created." />
        </SectionCard>
      </>
    );
  }

  return (
    <Box sx={{ opacity: analytics.loading ? 0.7 : 1, transition: 'opacity 150ms' }}>
      {header}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard label="Calls processed" value={numberFormat.format(totals.calls)} icon={<ForumRounded />} caption={`${totals.safe_archives} safe archives · ${totals.audio_minutes} audio minutes`} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard label="PII entities protected" value={numberFormat.format(totals.pii_entities)} icon={<LockRounded />} caption={`${data.pii_by_type.length} entity types detected`} accent />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            label="Processing success"
            value={totals.success_rate === null ? '—' : `${totals.success_rate}%`}
            icon={<CheckCircleRounded />}
            caption={`${totals.completed} completed · ${totals.failed} failed · ${totals.in_progress} in progress`}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard label="Avg processing time" value={formatSeconds(totals.avg_processing_seconds)} icon={<TimerRounded />} caption="Upload → safe archive, end to end" />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <ChartCard
            title="Call volume"
            subtitle="Calls received per day · last 14 days (UTC)"
            table={{ columns: ['Date', 'Calls', 'PII protected'], rows: data.volume.map((v) => [v.date, v.calls, v.pii]) }}
          >
            <ColumnChart data={data.volume.map((v) => ({ key: v.date, value: v.calls }))} unit="calls" formatX={(key) => formatDate(`${key}T12:00:00Z`)} />
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          <ChartCard
            title="Customer sentiment"
            subtitle="AI analysis of redacted transcripts"
            table={{ columns: ['Sentiment', 'Calls'], rows: [['Negative', data.sentiment.negative], ['Neutral', data.sentiment.neutral], ['Positive', data.sentiment.positive]] }}
          >
            <SentimentBar counts={data.sentiment} />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3 }}>
              {data.sentiment.positive + data.sentiment.neutral + data.sentiment.negative} analyzed calls. Sentiment is the customer's overall tone, as judged by the LLM from the redacted transcript.
            </Typography>
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <ChartCard
            title="PII entities protected by type"
            subtitle="Counts of redaction labels. Values were never stored."
            table={{ columns: ['Entity type', 'Protected'], rows: data.pii_by_type.map((p) => [entityLabel(p.type), p.count]) }}
          >
            <BarList data={data.pii_by_type.map((p) => ({ label: entityLabel(p.type), value: p.count }))} unit="entities" />
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <ChartCard
            title="Top topics"
            subtitle="From AI analysis of redacted transcripts"
            table={{ columns: ['Topic', 'Calls'], rows: data.top_topics.map((t) => [t.topic, t.count]) }}
          >
            <BarList data={data.top_topics.map((t) => ({ label: t.topic, value: t.count }))} unit="calls" />
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <ChartCard
            title="Calls by department"
            subtitle="Department selected at upload"
            table={{ columns: ['Department', 'Calls'], rows: data.departments.map((d) => [d.department, d.calls]) }}
          >
            <BarList data={data.departments.map((d) => ({ label: d.department, value: d.calls }))} unit="calls" />
          </ChartCard>
        </Grid>
      </Grid>
    </Box>
  );
}
