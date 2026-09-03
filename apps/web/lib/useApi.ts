'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

/** Fetch-on-mount with loading/error state and a manual refresh. */
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);

  /**
   * Which request is current.
   *
   * Two problems this solves, and both of them are worse than a flicker. The
   * hook used to keep the previous response while the next path loaded, so a
   * drawer opened on record B rendered record A's name, status and actions
   * while its buttons posted to B — an operator could act on a record the
   * screen was not showing. And a slow first response could land after a fast
   * second one and win.
   */
  const current = useRef(0);

  const load = useCallback(async () => {
    if (!path) return;
    const ticket = ++current.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api<T>(path);
      if (ticket === current.current) setData(result);
    } catch (e: any) {
      if (ticket === current.current) setError(e.message ?? 'Request failed');
    } finally {
      if (ticket === current.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    // Clear first: showing the previous path's data under the new path's
    // heading is how the wrong record gets acted on.
    current.current += 1;
    setData(null);
    setError(null);
    setLoading(!!path);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // A refresh (same path, changed deps) keeps what is on screen while it
  // reloads: there is no identity change, so there is nothing to get wrong.
  useEffect(() => {
    if (deps.length) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, refresh: load, setData };
}
