'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useApi } from './useApi';
import type { ServerPage } from '@/components/DataTable';

/**
 * The envelope every paginated list endpoint returns.
 *
 * A few endpoints name the array `items` rather than `data`; both are read so
 * a screen does not have to know which one it is talking to.
 */
export interface Page<T> {
  data?: T[];
  items?: T[];
  total?: number;
  page?: number;
  pageSize?: number;
  /** `/serials` nests the same three fields; both shapes are read. */
  meta?: { total: number; page: number; pageSize: number };
}

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /** Hand this straight to `<DataTable server={…}>`. */
  server: ServerPage;
}

/**
 * A list that reads one page at a time from the server.
 *
 * Twenty-seven screens used to fetch a fixed first page and give the reader no
 * route to the rest, while the table's own pager walked that slice and stopped
 * — which reads exactly like reaching the end of the data. This owns the page
 * number, puts it in the query string, and hands `DataTable` what it needs to
 * ask for the next one.
 *
 * `filters` are the screen's own query parameters, already encoded. Changing
 * them returns to page one, because page four of the old filter is not page
 * four of the new one.
 */
export function usePaged<T>(
  path: string | null,
  options: { filters?: string; pageSize?: number } = {},
): Paged<T> {
  const { filters = '', pageSize: initialPageSize = 25 } = options;
  const [page, setPageState] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);

  // A changed filter invalidates the page number. Doing this during render
  // rather than in an effect avoids one fetch of a page that cannot exist.
  const lastFilters = useRef(filters);
  if (lastFilters.current !== filters) {
    lastFilters.current = filters;
    if (page !== 1) setPageState(1);
  }

  const url = path
    ? `${path}${path.includes('?') ? '&' : '?'}page=${page}&pageSize=${pageSize}${
        filters ? `&${filters.replace(/^[?&]/, '')}` : ''
      }`
    : null;

  const { data, error, loading, refresh } = useApi<Page<T> | T[]>(url);

  const rows = useMemo<T[]>(() => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return data.data ?? data.items ?? [];
  }, [data]);

  // The last known total, so the pager does not collapse to "0 rows" for the
  // moment between asking for page three and receiving it.
  const lastTotal = useRef(0);
  const total = useMemo(() => {
    if (data && !Array.isArray(data)) {
      const count = data.meta?.total ?? data.total;
      if (typeof count === 'number') {
        lastTotal.current = count;
        return count;
      }
    }
    if (Array.isArray(data)) {
      lastTotal.current = data.length;
      return data.length;
    }
    return lastTotal.current;
  }, [data]);

  const setPage = useCallback((next: number) => setPageState(Math.max(1, next)), []);
  const setPageSize = useCallback((next: number) => {
    setPageSizeState(next);
    setPageState(1);
  }, []);

  const server = useMemo<ServerPage>(
    () => ({ page, pageSize, total, onPage: setPage, onPageSize: setPageSize, loading }),
    [page, pageSize, total, setPage, setPageSize, loading],
  );

  return { rows, total, page, pageSize, setPage, setPageSize, loading, error, refresh, server };
}
