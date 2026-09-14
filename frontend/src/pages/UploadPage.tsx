import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import CloudUploadRounded from '@mui/icons-material/CloudUploadRounded';
import GraphicEqRounded from '@mui/icons-material/GraphicEqRounded';
import LockRounded from '@mui/icons-material/LockRounded';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import ShieldRounded from '@mui/icons-material/ShieldRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  Grid,
  IconButton,
  LinearProgress,
  MenuItem,
  Radio,
  Skeleton,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router';
import { PageHeader, SectionCard } from '../components/common';
import { useApiQuery } from '../hooks/useApiQuery';
import { useMe } from '../hooks/useMe';
import { useNotify } from '../hooks/useNotify';
import { api, ApiError } from '../services/api';
import { DEPARTMENTS, type PolicyPreset } from '../services/types';
import { brand } from '../theme';
import { entityLabel } from '../utils/format';

const FALLBACK_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.webm', '.mp4'];

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadPage() {
  const me = useMe();
  const navigate = useNavigate();
  const notify = useNotify();
  const inputRef = useRef<HTMLInputElement>(null);
  const policies = useApiQuery(() => api.policies(), []);
  const samples = useApiQuery(() => api.samples(), []);

  const [file, setFile] = useState<File | null>(null);
  const [department, setDepartment] = useState(DEPARTMENTS[0]!);
  const [preset, setPreset] = useState<PolicyPreset>('CONTACT_CENTER');
  const [analysisEnabled, setAnalysisEnabled] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runningSample, setRunningSample] = useState<string | null>(null);

  const extensions = me?.platform.supported_extensions ?? FALLBACK_EXTENSIONS;
  const maxMb = me?.platform.max_upload_mb ?? 200;
  const busy = progress !== null;

  function choose(candidate: File | undefined) {
    setError(null);
    if (!candidate) return;
    const ext = `.${candidate.name.split('.').pop()?.toLowerCase() ?? ''}`;
    if (!extensions.includes(ext)) {
      setError(`“${candidate.name}” is not a supported audio file. Use ${extensions.slice(0, 6).join(', ')} or similar.`);
      return;
    }
    if (candidate.size > maxMb * 1024 * 1024) {
      setError(`This file is ${formatBytes(candidate.size)}. The limit is ${maxMb} MB.`);
      return;
    }
    setFile(candidate);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    choose(event.dataTransfer.files[0]);
  }

  async function submit() {
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      const { call } = await api.uploadCall({ file, department, policyPreset: preset, analysisEnabled }, setProgress);
      navigate(`/calls/${call.id}/processing`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed.');
      setProgress(null);
    }
  }

  async function runSample(id: string) {
    setRunningSample(id);
    try {
      const { call } = await api.runSample(id, analysisEnabled);
      navigate(`/calls/${call.id}/processing`);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not start the sample.', 'error');
      setRunningSample(null);
    }
  }

  const presets = policies.data?.presets ?? [];

  return (
    <>
      <PageHeader
        title="Upload a call"
        subtitle="The recording goes to temporary storage only. It's sent to AssemblyAI for transcription and PII redaction, then deleted. Only safe artifacts are archived."
      />
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <Stack spacing={2.5}>
            <SectionCard title="1 · Recording">
              <Box
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => !busy && inputRef.current?.click()}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
                role="button"
                tabIndex={0}
                aria-label="Choose an audio file"
                sx={{
                  border: '2px dashed',
                  borderColor: dragging ? 'primary.main' : alpha(brand.teal, 0.3),
                  bgcolor: dragging ? alpha(brand.teal, 0.06) : alpha(brand.teal, 0.02),
                  borderRadius: 3,
                  py: 5,
                  px: 3,
                  textAlign: 'center',
                  cursor: busy ? 'default' : 'pointer',
                  transition: 'all 120ms',
                  '&:hover': { borderColor: 'primary.main' },
                }}
              >
                <CloudUploadRounded sx={{ fontSize: 40, color: 'primary.main' }} />
                <Typography variant="h4" sx={{ mt: 1 }}>
                  Drag & drop a call recording
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  or click to browse · {extensions.slice(0, 8).join(' ')} · up to {maxMb} MB
                </Typography>
                <input
                  ref={inputRef}
                  type="file"
                  hidden
                  accept={extensions.join(',')}
                  onChange={(e) => {
                    choose(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </Box>
              {file && (
                <Stack direction="row" spacing={1.5} sx={{ mt: 2, p: 1.5, borderRadius: 2, border: 1, borderColor: 'divider', alignItems: 'center' }}>
                  <GraphicEqRounded color="primary" />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                      {file.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatBytes(file.size)}
                    </Typography>
                  </Box>
                  <IconButton size="small" onClick={() => setFile(null)} disabled={busy} aria-label="Remove file">
                    <CloseRounded fontSize="small" />
                  </IconButton>
                </Stack>
              )}
              <TextField select label="Department" value={department} onChange={(e) => setDepartment(e.target.value)} sx={{ mt: 2.5, minWidth: 260 }} size="small">
                {DEPARTMENTS.map((d) => (
                  <MenuItem key={d} value={d}>
                    {d}
                  </MenuItem>
                ))}
              </TextField>
            </SectionCard>

            <SectionCard title="2 · Redaction policy">
              <Grid container spacing={1.5}>
                {presets.length === 0
                  ? [0, 1, 2, 3].map((i) => (
                      <Grid key={i} size={{ xs: 12, sm: 6 }}>
                        <Skeleton variant="rounded" height={112} />
                      </Grid>
                    ))
                  : presets.map((p) => {
                      const selected = p.preset === preset;
                      return (
                        <Grid key={p.preset} size={{ xs: 12, sm: 6 }}>
                          <Card sx={{ height: '100%', borderColor: selected ? 'primary.main' : 'divider', bgcolor: selected ? alpha(brand.teal, 0.04) : undefined, boxShadow: selected ? `0 0 0 1px ${brand.teal}` : 'none' }}>
                            <CardActionArea onClick={() => setPreset(p.preset)} sx={{ p: 1.75, height: '100%', alignItems: 'flex-start', display: 'flex' }}>
                              <Radio checked={selected} size="small" sx={{ p: 0.25, mr: 1 }} tabIndex={-1} />
                              <Box>
                                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                  <Typography sx={{ fontWeight: 650 }}>{p.label}</Typography>
                                  <Chip size="small" label={`${p.policies.length} types`} sx={{ bgcolor: '#EEF2F6' }} />
                                  {p.customized && <Chip size="small" label="Customized" color="primary" variant="outlined" />}
                                </Stack>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, lineHeight: 1.5 }}>
                                  {p.description}
                                </Typography>
                              </Box>
                            </CardActionArea>
                          </Card>
                        </Grid>
                      );
                    })}
              </Grid>
              {presets.length > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                  Protects:{' '}
                  {(presets.find((p) => p.preset === preset)?.policies ?? [])
                    .slice(0, 10)
                    .map((p) => entityLabel(p))
                    .join(', ')}
                  {(presets.find((p) => p.preset === preset)?.policies.length ?? 0) > 10 && ', …'}
                </Typography>
              )}
            </SectionCard>

            <SectionCard title="3 · AI analysis">
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography sx={{ fontWeight: 600 }}>Generate insights from the redacted transcript</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Summary, customer issue, resolution, sentiment, topics and action items via AssemblyAI LLM Gateway. The LLM only ever sees redacted text.
                  </Typography>
                </Box>
                <Switch checked={analysisEnabled} onChange={(e) => setAnalysisEnabled(e.target.checked)} slotProps={{ input: { 'aria-label': 'Enable AI analysis' } }} />
              </Stack>
            </SectionCard>

            {error && <Alert severity="error">{error}</Alert>}

            {busy ? (
              <Card sx={{ p: 2.5 }}>
                <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {progress !== null && progress < 1 ? 'Uploading over an encrypted connection…' : 'Sending to AssemblyAI and deleting the temporary copy…'}
                  </Typography>
                  {progress !== null && progress < 1 && (
                    <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {Math.round(progress * 100)}%
                    </Typography>
                  )}
                </Stack>
                <LinearProgress variant={progress !== null && progress < 1 ? 'determinate' : 'indeterminate'} value={(progress ?? 0) * 100} />
              </Card>
            ) : (
              <Button variant="contained" size="large" startIcon={<ShieldRounded />} disabled={!file} onClick={() => void submit()} sx={{ alignSelf: 'flex-start', px: 3 }}>
                Protect & process call
              </Button>
            )}
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, lg: 4 }}>
          <Stack spacing={2.5}>
            <SectionCard title="Try a synthetic sample">
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Text-to-speech recordings with fictional PII. They go through the same real pipeline as an upload.
              </Typography>
              <Stack spacing={1}>
                {(samples.data?.samples ?? []).map((sample) => (
                  <Stack key={sample.id} direction="row" spacing={1.5} sx={{ p: 1.25, borderRadius: 2, border: 1, borderColor: 'divider', alignItems: 'center' }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 650 }}>
                        {sample.title}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.45 }}>
                        {sample.department} · {sample.expectedPii.length === 0 ? 'no PII' : `${sample.expectedPii.length} PII types`}
                      </Typography>
                    </Box>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<PlayArrowRounded />}
                      onClick={() => void runSample(sample.id)}
                      disabled={runningSample !== null || busy}
                    >
                      {runningSample === sample.id ? 'Sending…' : 'Run'}
                    </Button>
                  </Stack>
                ))}
                {samples.loading && <Skeleton variant="rounded" height={160} />}
              </Stack>
            </SectionCard>
            <SectionCard title="What happens next">
              <Stack spacing={1.5}>
                {[
                  { icon: <LockRounded />, text: 'Temporary upload → AssemblyAI → temporary file deleted' },
                  { icon: <ShieldRounded />, text: 'Transcription, speaker separation and PII redaction of text and audio' },
                  { icon: <AutoAwesomeRounded />, text: 'Optional AI analysis on the redacted transcript' },
                  { icon: <GraphicEqRounded />, text: 'Safe archive: redacted audio, redacted transcript, statistics, audit trail' },
                ].map((item) => (
                  <Stack key={item.text} direction="row" spacing={1.25} sx={{ alignItems: 'flex-start', '& svg': { fontSize: 18, color: 'primary.main', mt: '1px' } }}>
                    {item.icon}
                    <Typography variant="body2" color="text.secondary">
                      {item.text}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </SectionCard>
          </Stack>
        </Grid>
      </Grid>
    </>
  );
}
