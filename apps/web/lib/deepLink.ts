'use client';

import { useEffect, useState } from 'react';

/**
 * The query parameters a notification link carried.
 *
 * Forty-seven notification links named a record and then dropped the reader on
 * an unfiltered list, because the page never read the parameter the link put
 * in the URL. A notification that names a batch and lands you in a list of
 * every batch has moved the work halfway.
 *
 * This reads `window.location.search` rather than `useSearchParams`, so a
 * statically prerendered client page does not have to be wrapped in a Suspense
 * boundary to answer a question it can answer itself. It re-reads on Back and
 * Forward, so returning to a link's target reopens what the link pointed at.
 *
 * The values come from the address bar, so they are untrusted text like any
 * other input: pass them to an API that authorises the id, never render one as
 * markup, and treat "not found" as an ordinary answer.
 */
export function useDeepLink<K extends string>(
  ...keys: K[]
): Record<K, string | null> {
  const empty = Object.fromEntries(keys.map((k) => [k, null])) as Record<
    K,
    string | null
  >;
  const [values, setValues] = useState<Record<K, string | null>>(empty);

  useEffect(() => {
    function read() {
      const params = new URLSearchParams(window.location.search);
      setValues(
        Object.fromEntries(keys.map((k) => [k, params.get(k)])) as Record<
          K,
          string | null
        >,
      );
    }
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys.join(',')]);

  return values;
}

/**
 * Keep the address bar in step with what the reader has open.
 *
 * So a selection made on the page can be copied, bookmarked and sent to a
 * colleague the same way a notification link arrives. It replaces rather than
 * pushes, so Back leaves the page instead of walking every row the reader
 * clicked.
 */
export function syncDeepLink(params: Record<string, string | null>) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  if (url.toString() !== window.location.href) {
    window.history.replaceState(null, '', url.toString());
  }
}

/**
 * Bring the row a link named into view, and mark it.
 *
 * For the flat lists that have no selection to set — approvals, damage
 * reports, goods receipts. The link still names a record, so the page finds
 * the row carrying `data-row-id` and scrolls to it rather than leaving the
 * reader to search a page of near-identical lines. The mark fades, because a
 * highlight that never clears becomes part of the furniture.
 */
export function useLinkedRow(id: string | null, ready: boolean) {
  useEffect(() => {
    if (!id || !ready) return;
    const row = document.querySelector<HTMLElement>(
      `[data-row-id="${CSS.escape(id)}"]`,
    );
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('row-linked');
    const handle = setTimeout(() => row.classList.remove('row-linked'), 4000);
    return () => clearTimeout(handle);
  }, [id, ready]);
}
