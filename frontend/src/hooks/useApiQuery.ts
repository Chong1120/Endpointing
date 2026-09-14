import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import { ApiError } from '../services/api';

interface Options<T> {
  /** Poll interval in ms, or a function of the latest data returning false to stop. */
  poll?: number | ((data: T | undefined) => number | false);
}

/** Minimal data-fetching hook with stale-response protection and optional polling. */
export function useApiQuery<T>(fetcher: () => Promise<T>, deps: DependencyList, options: Options<T> = {}) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const requestId = useRef(0);

  const load = useCallback(async (silent: boolean) => {
    const id = ++requestId.current;
    if (!silent) setLoading(true);
    try {
      const result = await fetcherRef.current();
      if (id !== requestId.current) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof ApiError ? err : new ApiError(err instanceof Error ? err.message : 'Request failed.', 0));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const poll = options.poll;
  const interval = typeof poll === 'function' ? poll(data) : poll;
  useEffect(() => {
    if (!interval || loading) return;
    const timer = setTimeout(() => void load(true), interval);
    return () => clearTimeout(timer);
  }, [interval, loading, data, load]);

  return { data, error, loading, reload: () => load(true), setData };
}
