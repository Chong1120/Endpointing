import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import VerifiedUserRounded from '@mui/icons-material/VerifiedUserRounded';
import { Chip, CircularProgress } from '@mui/material';
import type { CallStatus } from '../services/types';

const IN_PROGRESS_LABEL: Partial<Record<CallStatus, string>> = {
  UPLOADING: 'Uploading',
  TRANSCRIBING: 'Transcribing',
  PROCESSING: 'Protecting',
};

/** Icon + label, so status never relies on color alone. */
export function StatusBadge({ status, large = false }: { status: CallStatus; large?: boolean }) {
  const size = large ? 'medium' : 'small';
  if (status === 'COMPLETED') {
    return (
      <Chip
        size={size}
        icon={<VerifiedUserRounded />}
        label={large ? 'SAFE ARCHIVE' : 'Safe'}
        sx={{ bgcolor: 'success.light', color: 'success.main', '& .MuiChip-icon': { color: 'success.main' }, letterSpacing: large ? '0.06em' : 0 }}
      />
    );
  }
  if (status === 'FAILED') {
    return (
      <Chip
        size={size}
        icon={<ErrorOutlineRounded />}
        label="Failed"
        sx={{ bgcolor: 'error.light', color: 'error.main', '& .MuiChip-icon': { color: 'error.main' } }}
      />
    );
  }
  return (
    <Chip
      size={size}
      icon={<CircularProgress size={11} thickness={6} sx={{ color: 'info.main', ml: '6px !important' }} />}
      label={IN_PROGRESS_LABEL[status] ?? 'Processing'}
      sx={{ bgcolor: 'info.light', color: 'info.main' }}
    />
  );
}
