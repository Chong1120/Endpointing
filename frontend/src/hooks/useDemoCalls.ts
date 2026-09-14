import { useState } from 'react';
import { api, ApiError } from '../services/api';
import { useNotify } from './useNotify';

/** Runs every bundled synthetic sample through the real AssemblyAI pipeline. */
export function useDemoCalls(onDone?: () => void) {
  const [running, setRunning] = useState(false);
  const notify = useNotify();

  async function loadDemoCalls() {
    setRunning(true);
    try {
      const { samples } = await api.samples();
      for (const sample of samples) await api.runSample(sample.id, true);
      notify(`${samples.length} synthetic demo calls sent to AssemblyAI for protection.`);
      onDone?.();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not load demo calls.', 'error');
    } finally {
      setRunning(false);
    }
  }

  return { loadDemoCalls, running };
}
