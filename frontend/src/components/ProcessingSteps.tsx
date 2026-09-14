import CheckRounded from '@mui/icons-material/CheckRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import { Box, CircularProgress, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { AuditEvent, Call } from '../services/types';
import { brand } from '../theme';
import { auditDetail, formatTime } from '../utils/format';

interface StepDefinition {
  label: string;
  description: string;
  doneOn: string[];
  notes?: Array<{ event: string; text: string }>;
}

const STEPS: StepDefinition[] = [
  {
    label: 'Call received',
    description: 'Uploaded to temporary storage, then securely sent to AssemblyAI',
    doneOn: ['CALL_RECEIVED'],
    notes: [{ event: 'RAW_UPLOAD_DELETED', text: 'Temporary copy deleted from SafeCall servers' }],
  },
  {
    label: 'Transcription',
    description: 'AssemblyAI Universal-3.5 Pro with automatic language detection',
    doneOn: ['TRANSCRIPTION_COMPLETED'],
    notes: [{ event: 'WEBHOOK_RECEIVED', text: 'Completion signalled by AssemblyAI webhook' }],
  },
  { label: 'Speaker separation', description: 'Speaker diarization separates agent and customer', doneOn: ['SPEAKERS_SEPARATED'] },
  { label: 'PII detection', description: 'Entities found using your redaction policy', doneOn: ['PII_DETECTION_COMPLETED'] },
  { label: 'Transcript redaction', description: 'Sensitive values replaced with entity labels', doneOn: ['TRANSCRIPT_REDACTED'] },
  { label: 'Audio redaction', description: 'Sensitive speech replaced with silence in the recording', doneOn: ['AUDIO_REDACTED'] },
  { label: 'AI analysis', description: 'LLM Gateway analyzes the redacted transcript only', doneOn: ['AI_ANALYSIS_COMPLETED', 'AI_ANALYSIS_SKIPPED'] },
  {
    label: 'Safe archive',
    description: 'Redacted audio in a private bucket, redacted transcript in the archive',
    doneOn: ['ARCHIVE_CREATED'],
    notes: [{ event: 'ASSEMBLYAI_DATA_DELETED', text: 'Transcript deleted at AssemblyAI after archiving' }],
  },
];

type StepState = 'done' | 'active' | 'failed' | 'pending';

/** Real processing states derived from audit events — no simulated progress. */
export function ProcessingSteps({ call, audit }: { call: Call; audit: AuditEvent[] }) {
  const byType = new Map<string, AuditEvent>();
  for (const event of audit) if (!byType.has(event.event_type)) byType.set(event.event_type, event);

  const doneFlags = STEPS.map((step) => step.doneOn.some((type) => byType.has(type)));
  const firstOpen = doneFlags.findIndex((d) => !d);
  const inProgress = call.status !== 'COMPLETED' && call.status !== 'FAILED';
  const submitted = byType.get('TRANSCRIPTION_SUBMITTED');
  const waitingOn = submitted?.metadata.completion_signal === 'webhook' ? 'Waiting for the AssemblyAI webhook…' : 'Checking AssemblyAI job status…';

  return (
    <Stack component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {STEPS.map((step, index) => {
        const state: StepState = doneFlags[index]
          ? 'done'
          : index === firstOpen
            ? call.status === 'FAILED'
              ? 'failed'
              : inProgress
                ? 'active'
                : 'pending'
            : 'pending';
        const doneEvent = step.doneOn.map((t) => byType.get(t)).find(Boolean);
        const detail = doneEvent ? auditDetail(doneEvent.event_type, doneEvent.metadata) : null;
        const isLast = index === STEPS.length - 1;

        return (
          <Box component="li" key={step.label} sx={{ display: 'flex', gap: 2 }}>
            <Stack sx={{ alignItems: 'center' }}>
              <StepIcon state={state} />
              {!isLast && (
                <Box sx={{ width: 2, flex: 1, minHeight: 18, my: 0.5, borderRadius: 1, bgcolor: state === 'done' ? alpha(brand.teal, 0.45) : 'divider' }} />
              )}
            </Stack>
            <Box sx={{ pb: isLast ? 0 : 2.25, pt: 0.35, minWidth: 0, flex: 1 }}>
              <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 2 }}>
                <Typography sx={{ fontWeight: 650, color: state === 'pending' ? 'text.secondary' : 'text.primary' }}>{step.label}</Typography>
                {doneEvent && (
                  <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                    {formatTime(doneEvent.created_at)}
                  </Typography>
                )}
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {state === 'failed' ? call.error_message ?? 'This step failed.' : detail || step.description}
              </Typography>
              {state === 'active' && index === 1 && (
                <Typography variant="caption" sx={{ color: 'info.main', fontWeight: 600 }}>
                  {waitingOn}
                </Typography>
              )}
              {step.notes?.map(
                (note) =>
                  byType.has(note.event) && (
                    <Stack key={note.event} direction="row" spacing={0.5} sx={{ alignItems: 'center', mt: 0.25 }}>
                      <CheckRounded sx={{ fontSize: 14, color: 'success.main' }} />
                      <Typography variant="caption" sx={{ color: 'success.main', fontWeight: 600 }}>
                        {note.text}
                      </Typography>
                    </Stack>
                  ),
              )}
            </Box>
          </Box>
        );
      })}
    </Stack>
  );
}

function StepIcon({ state }: { state: StepState }) {
  const base = { width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0 } as const;
  if (state === 'done') {
    return (
      <Box sx={{ ...base, bgcolor: 'primary.main', color: '#fff' }} aria-label="completed">
        <CheckRounded sx={{ fontSize: 17 }} />
      </Box>
    );
  }
  if (state === 'failed') {
    return (
      <Box sx={{ ...base, bgcolor: 'error.main', color: '#fff' }} aria-label="failed">
        <CloseRounded sx={{ fontSize: 17 }} />
      </Box>
    );
  }
  if (state === 'active') {
    return (
      <Box sx={{ ...base, border: '2px solid', borderColor: alpha(brand.teal, 0.3) }} aria-label="in progress">
        <CircularProgress size={16} thickness={6} />
      </Box>
    );
  }
  return <Box sx={{ ...base, border: '2px solid', borderColor: 'divider' }} aria-label="pending" />;
}
