'use client';

import { ReactNode, useMemo, useState } from 'react';
import { Empty } from './ui';

export interface Column<T> {
  key: string;
  label: string;
  /** Value used for sorting, searching and export. */
  value?: (row: T) => string | number | null | undefined;
  /** What is rendered; falls back to the value. */
  render?: (row: T) => ReactNode;
  align?: 'left' | 'right';
  numeric?: boolean;
  /** Hidden by default; the user can turn it on. */
  optional?: boolean;
}

/**
 * The table every list screen uses (§69).
 *
 * Search, sort, pagination, column choice and CSV export in one place, so a new
 * screen gets all of them rather than each reimplementing a subset. Sorting and
 * searching happen on data already fetched; a screen with more rows than fit in
 * one page fetches server-side and passes what it has.
 */
export function DataTable<T>({
  rows,
  columns,
  getKey,
  searchPlaceholder = 'Search',
  pageSize = 25,
  empty = 'Nothing to show',
  exportName,
  onRowClick,
  toolbar,
  selectedKey,
}: {
  rows: T[];
  columns: Column<T>[];
  getKey: (row: T) => string;
  searchPlaceholder?: string;
  pageSize?: number;
  empty?: ReactNode;
  /** When set, an export button appears and writes this file name. */
  exportName?: string;
  onRowClick?: (row: T) => void;
  toolbar?: ReactNode;
  selectedKey?: string | null;
}) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(columns.filter((c) => c.optional).map((c) => c.key)),
  );
  const [showColumns, setShowColumns] = useState(false);

  const valueOf = (row: T, column: Column<T>) => {
    if (column.value) return column.value(row);
    return (row as Record<string, unknown>)[column.key] as string | number | null | undefined;
  };

  const visible = columns.filter((c) => !hidden.has(c.key));

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) =>
      visible.some((column) => {
        const value = valueOf(row, column);
        return value !== null && value !== undefined && String(value).toLowerCase().includes(term);
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, hidden]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const column = columns.find((c) => c.key === sortKey);
    if (!column) return filtered;

    return [...filtered].sort((a, b) => {
      const left = valueOf(a, column);
      const right = valueOf(b, column);
      if (left === right) return 0;
      // Empty values sort last whichever direction is chosen, so a column of
      // mostly-blank cells does not bury the rows that have data.
      if (left === null || left === undefined || left === '') return 1;
      if (right === null || right === undefined || right === '') return -1;

      const comparison = column.numeric
        ? Number(left) - Number(right)
        : String(left).localeCompare(String(right));
      return sortDir === 'desc' ? -comparison : comparison;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pageCount);
  const pageRows = sorted.slice((current - 1) * pageSize, current * pageSize);

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(1);
  }

  function exportCsv() {
    const escape = (value: unknown) => {
      const text = value === null || value === undefined ? '' : String(value);
      // Neutralise anything a spreadsheet would run as a formula.
      const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
      return /[",\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
    };

    const lines = [
      visible.map((c) => escape(c.label)).join(','),
      ...sorted.map((row) => visible.map((c) => escape(valueOf(row, c))).join(',')),
    ];

    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${exportName}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder={searchPlaceholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          aria-label={searchPlaceholder}
        />
        {toolbar}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-ink-muted">
            {sorted.length === rows.length
              ? `${rows.length} row${rows.length === 1 ? '' : 's'}`
              : `${sorted.length} of ${rows.length}`}
          </span>
          {columns.some((c) => c.optional) && (
            <div className="relative">
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => setShowColumns((v) => !v)}
                aria-expanded={showColumns}
              >
                Columns
              </button>
              {showColumns && (
                <div className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-surface-border bg-surface p-2 shadow-lg">
                  {columns.map((column) => (
                    <label key={column.key} className="flex items-center gap-2 px-1 py-1 text-sm">
                      <input
                        type="checkbox"
                        checked={!hidden.has(column.key)}
                        onChange={() =>
                          setHidden((previous) => {
                            const next = new Set(previous);
                            if (next.has(column.key)) next.delete(column.key);
                            else next.add(column.key);
                            return next;
                          })
                        }
                      />
                      {column.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          {exportName && (
            <button type="button" className="btn-ghost text-xs" onClick={exportCsv}>
              Export CSV
            </button>
          )}
        </div>
      </div>

      {sorted.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="sticky top-0 z-10 bg-surface-sunken">
                <tr>
                  {visible.map((column) => (
                    <th
                      key={column.key}
                      className={`th cursor-pointer select-none ${column.align === 'right' || column.numeric ? 'text-right' : ''}`}
                      onClick={() => toggleSort(column.key)}
                      aria-sort={
                        sortKey === column.key
                          ? sortDir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      {column.label}
                      {sortKey === column.key && (
                        <span className="ml-1 text-ink-subtle">{sortDir === 'asc' ? '▲' : '▼'}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => {
                  const key = getKey(row);
                  return (
                    <tr
                      key={key}
                      className={`${onRowClick ? 'cursor-pointer hover:bg-surface-sunken' : ''} ${
                        selectedKey === key ? 'bg-brand-light' : ''
                      }`}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                    >
                      {visible.map((column) => (
                        <td
                          key={column.key}
                          className={`td ${column.align === 'right' || column.numeric ? 'text-right num' : ''}`}
                        >
                          {column.render ? column.render(row) : (valueOf(row, column) ?? '—')}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm">
              <button
                type="button"
                className="btn-ghost"
                disabled={current === 1}
                onClick={() => setPage(current - 1)}
              >
                Previous
              </button>
              <span className="text-ink-muted">
                Page {current} of {pageCount}
              </span>
              <button
                type="button"
                className="btn-ghost"
                disabled={current === pageCount}
                onClick={() => setPage(current + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
