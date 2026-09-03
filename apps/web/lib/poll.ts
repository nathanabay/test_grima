'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Refresh a screen that other people change while it is open.
 *
 * `setInterval` appears nowhere in the product, and for most screens that is
 * right — a drug master does not change under the reader. For three it is not:
 * `/cold-chain` shows live sensor readings, `/notifications` is where
 * escalations land, and `/approvals` is a queue. All three were static until
 * somebody pressed reload, so a cold-chain excursion became visible whenever
 * the reader happened to refresh.
 *
 * Three things this is careful about:
 *  - it stops while the tab is hidden, so a screen left open overnight does
 *    not spend the night polling;
 *  - it does not start a second request while one is in flight;
 *  - it can be switched off, because a reader typing into a form does not want
 *    the page moving under them.
 */
export function usePolling(
  refresh: () => void | Promise<unknown>,
  intervalMs: number,
  enabled = true,
) {
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const running = useRef(false);
  const latest = useRef(refresh);
  latest.current = refresh;

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;

    let cancelled = false;
    async function tick() {
      if (cancelled || running.current) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      running.current = true;
      try {
        await latest.current();
        if (!cancelled) setLastRefreshedAt(new Date());
      } finally {
        running.current = false;
      }
    }

    const handle = setInterval(tick, intervalMs);
    // A tab coming back to the front is the moment its data is most stale.
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(handle);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, intervalMs]);

  return { lastRefreshedAt };
}

/** "updated 20 seconds ago", so a stale screen looks stale. */
export function sinceLabel(at: Date | null): string {
  if (!at) return 'not refreshed yet';
  const seconds = Math.max(0, Math.round((Date.now() - at.getTime()) / 1000));
  if (seconds < 60) return `updated ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return `updated ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
}
