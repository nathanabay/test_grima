"use client";

import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "./primitives";
import { useFeedback } from "./Feedback";

export interface Column<T> {
  key: string;
  label: string;
  /** Value used for sorting, searching and export. */
  value?: (row: T) => string | number | null | undefined;
  /** What is rendered; falls back to the value. */
  render?: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  numeric?: boolean;
  /** Hidden by default; the reader can turn it on. */
  optional?: boolean;
  /** Kept visible while the table scrolls sideways. */
  sticky?: boolean;
  width?: string;
  /** Excluded from sorting and export, e.g. a column of buttons. */
  action?: boolean;
}

export interface BulkAction<T> {
  label: string;
  onRun: (rows: T[]) => void | Promise<void>;
  tone?: "primary" | "danger" | "ghost";
  /** Hidden when the reader lacks the permission. */
  disabled?: (rows: T[]) => string | null;
}

/**
 * What a screen passes when the server holds more rows than one page.
 *
 * Without this the table's Previous/Next walks the slice it was handed and
 * stops, which reads exactly like reaching the end of the data. With it the
 * same buttons ask the server for the next page, and the count says which
 * rows of how many are on screen.
 */
export interface ServerPage {
  page: number;
  pageSize: number;
  /** How many rows the server holds for the current filter. */
  total: number;
  onPage: (page: number) => void;
  onPageSize?: (pageSize: number) => void;
  /**
   * Passes the search box to the server. Without it the box filters only the
   * rows on screen, and the table says so rather than implying otherwise.
   */
  onQuery?: (query: string) => void;
  /** Dims the rows while the next page is in flight. */
  loading?: boolean;
}

interface SavedView {
  name: string;
  query: string;
  sortKey: string | null;
  sortDir: "asc" | "desc";
  hidden: string[];
}

/**
 * The table every list screen uses (§25–§26).
 *
 * Search, sort, pagination, column choice, sticky columns, bulk selection,
 * saved views, density and export in one place, so a new screen gets all of
 * them rather than each reimplementing a subset. Sorting and searching happen
 * over the rows already fetched; a screen with more rows than fit one page
 * fetches server-side and passes what it has, and says so through `total`.
 *
 * Row height follows the reader's density preference through the --row-py
 * token, so one setting changes every table in the product.
 */
export function DataTable<T>({
  rows,
  columns,
  getKey,
  searchPlaceholder = "Search",
  pageSize: initialPageSize = 25,
  empty = "Nothing to show",
  emptyBody,
  exportName,
  onRowClick,
  toolbar,
  selectedKey,
  bulkActions,
  viewKey,
  total,
  server,
  rowTone,
}: {
  rows: T[];
  columns: Column<T>[];
  getKey: (row: T) => string;
  searchPlaceholder?: string;
  pageSize?: number;
  empty?: ReactNode;
  emptyBody?: ReactNode;
  /** When set, an export button appears and writes this file name. */
  exportName?: string;
  onRowClick?: (row: T) => void;
  toolbar?: ReactNode;
  selectedKey?: string | null;
  /** Actions over the checked rows. Selection only appears when set. */
  bulkActions?: BulkAction<T>[];
  /** Enables saved views, stored per screen under this key. */
  viewKey?: string;
  /** Server-side total, when the screen paginates on the server. */
  total?: number;
  /** Set when the pager should fetch from the server instead of slicing. */
  server?: ServerPage;
  /** Tints a row that needs attention, e.g. expired stock. */
  rowTone?: (row: T) => "danger" | "warn" | null;
}) {
  const { prompt } = useFeedback();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(columns.filter((c) => c.optional).map((c) => c.key)),
  );
  const [showColumns, setShowColumns] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [views, setViews] = useState<SavedView[]>([]);
  const [busy, setBusy] = useState(false);

  const storeKey = viewKey ? `pharmacore.views.${viewKey}` : null;

  useEffect(() => {
    if (!storeKey) return;
    try {
      setViews(JSON.parse(localStorage.getItem(storeKey) ?? "[]"));
    } catch {
      setViews([]);
    }
  }, [storeKey]);

  const valueOf = useCallback((row: T, column: Column<T>) => {
    if (column.value) return column.value(row);
    return (row as Record<string, unknown>)[column.key] as
      | string
      | number
      | null
      | undefined;
  }, []);

  const visible = columns.filter((c) => !hidden.has(c.key));
  const searchable = visible.filter((c) => !c.action);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) =>
      searchable.some((column) => {
        const value = valueOf(row, column);
        return (
          value !== null &&
          value !== undefined &&
          String(value).toLowerCase().includes(term)
        );
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
      if (left === null || left === undefined || left === "") return 1;
      if (right === null || right === undefined || right === "") return -1;

      const comparison = column.numeric
        ? Number(left) - Number(right)
        : String(left).localeCompare(String(right));
      return sortDir === "desc" ? -comparison : comparison;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey, sortDir]);

  // In server mode the screen has already fetched exactly one page, so the
  // table renders what it was handed and the pager asks for the next one.
  // In local mode it slices the rows it holds.
  const size = server ? server.pageSize : pageSize;
  const pageCount = server
    ? Math.max(1, Math.ceil(server.total / size))
    : Math.max(1, Math.ceil(sorted.length / size));
  const current = server ? server.page : Math.min(page, pageCount);
  const pageRows = server
    ? sorted
    : sorted.slice((current - 1) * size, current * size);
  const firstOnPage = server ? (current - 1) * size + 1 : 0;

  const checkedRows = useMemo(
    () => sorted.filter((r) => checked.has(getKey(r))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sorted, checked],
  );

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  }

  function toggleColumn(key: string) {
    setHidden((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const allOnPageChecked =
    pageRows.length > 0 && pageRows.every((r) => checked.has(getKey(r)));

  function toggleAllOnPage() {
    setChecked((previous) => {
      const next = new Set(previous);
      // The header box acts on the page in view, not on rows the reader cannot
      // see; selecting 4,000 hidden rows by accident is how mistakes happen.
      if (allOnPageChecked) pageRows.forEach((r) => next.delete(getKey(r)));
      else pageRows.forEach((r) => next.add(getKey(r)));
      return next;
    });
  }

  function exportCsv() {
    const escape = (value: unknown) => {
      const text = value === null || value === undefined ? "" : String(value);
      // Neutralise anything a spreadsheet would run as a formula.
      const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
      return /[",\n]/.test(guarded)
        ? `"${guarded.replace(/"/g, '""')}"`
        : guarded;
    };
    const cols = visible.filter((c) => !c.action);
    const source = checkedRows.length ? checkedRows : sorted;
    const lines = [
      cols.map((c) => escape(c.label)).join(","),
      ...source.map((row) =>
        cols.map((c) => escape(valueOf(row, c))).join(","),
      ),
    ];
    const blob = new Blob([lines.join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${exportName}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function saveView() {
    if (!storeKey) return;
    const answer = await prompt({
      title: "Name this view",
      body: "The search, sort and column choice on screen are saved under this name, in this browser.",
      confirmLabel: "Save view",
      fields: [
        {
          name: "name",
          label: "Name",
          required: true,
          placeholder: "Controlled drugs, expiring first",
          validate: (v: string) =>
            views.some((existing) => existing.name === v)
              ? "A view with that name already exists here."
              : null,
        },
      ],
    });
    if (!answer) return;
    const name = answer.name;
    const view: SavedView = {
      name: name.trim(),
      query,
      sortKey,
      sortDir,
      hidden: [...hidden],
    };
    const next = [...views.filter((v) => v.name !== view.name), view];
    setViews(next);
    try {
      localStorage.setItem(storeKey, JSON.stringify(next));
    } catch {
      /* not fatal */
    }
  }

  function applyView(view: SavedView) {
    setQuery(view.query);
    setSortKey(view.sortKey);
    setSortDir(view.sortDir);
    setHidden(new Set(view.hidden));
    setPage(1);
  }

  async function runBulk(action: BulkAction<T>) {
    setBusy(true);
    try {
      await action.onRun(checkedRows);
      setChecked(new Set());
    } finally {
      setBusy(false);
    }
  }

  const align = (c: Column<T>) =>
    c.align === "right"
      ? "text-right"
      : c.align === "center"
        ? "text-center"
        : "text-left";

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder={searchPlaceholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
            server?.onQuery?.(e.target.value);
          }}
          aria-label={searchPlaceholder}
          title={
            server && !server.onQuery
              ? "Filters the rows on this page. Use the filters above to narrow the whole set."
              : undefined
          }
        />
        {toolbar}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-small text-ink-muted num">
            {server
              ? server.total === 0
                ? "No rows"
                : `${firstOnPage.toLocaleString()}\u2013${(firstOnPage + pageRows.length - 1).toLocaleString()} of ${server.total.toLocaleString()}`
              : total !== undefined && total > rows.length
                ? `${sorted.length} of ${total.toLocaleString()}`
                : sorted.length === rows.length
                  ? `${rows.length.toLocaleString()} row${rows.length === 1 ? "" : "s"}`
                  : `${sorted.length.toLocaleString()} of ${rows.length.toLocaleString()}`}
          </span>

          {storeKey && (
            <>
              {views.length > 0 && (
                <select
                  className="input w-auto py-1 text-small"
                  aria-label="Saved views"
                  defaultValue=""
                  onChange={(e) => {
                    const v = views.find((x) => x.name === e.target.value);
                    if (v) applyView(v);
                  }}
                >
                  <option value="">Saved views…</option>
                  {views.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={saveView}
              >
                Save view
              </button>
            </>
          )}

          {columns.some((c) => c.optional) && (
            <div className="relative">
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setShowColumns((v) => !v)}
                aria-expanded={showColumns}
              >
                Columns
              </button>
              {showColumns && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowColumns(false)}
                    aria-hidden
                  />
                  <div className="absolute right-0 z-20 mt-1 max-h-72 w-56 overflow-y-auto rounded-card border border-border bg-surface-raised p-2 shadow-overlay">
                    {columns
                      .filter((c) => !c.action)
                      .map((column) => (
                        <label
                          key={column.key}
                          className="flex items-center gap-2 px-1 py-1 text-body"
                        >
                          <input
                            type="checkbox"
                            checked={!hidden.has(column.key)}
                            onChange={() => toggleColumn(column.key)}
                          />
                          {column.label}
                        </label>
                      ))}
                  </div>
                </>
              )}
            </div>
          )}

          {exportName && (
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={exportCsv}
            >
              Export{checkedRows.length ? ` (${checkedRows.length})` : ""}
            </button>
          )}
        </div>
      </div>

      {/* Bulk bar appears only once something is selected, so it costs no space. */}
      {bulkActions && checkedRows.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded border border-brand/30 bg-brand/8 px-3 py-2">
          <span className="text-body text-ink">
            <span className="num font-medium">{checkedRows.length}</span>{" "}
            selected
          </span>
          <button
            className="btn-quiet btn-sm"
            onClick={() => setChecked(new Set())}
          >
            Clear
          </button>
          <div className="ml-auto flex flex-wrap gap-2">
            {bulkActions.map((a) => {
              const why = a.disabled?.(checkedRows) ?? null;
              const cls =
                a.tone === "danger"
                  ? "btn-danger"
                  : a.tone === "primary"
                    ? "btn-primary"
                    : "btn-ghost";
              return (
                <button
                  key={a.label}
                  className={`${cls} btn-sm`}
                  disabled={busy || !!why}
                  title={why ?? undefined}
                  onClick={() => runBulk(a)}
                >
                  {a.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <EmptyState
          title={typeof empty === "string" ? empty : "Nothing to show"}
          body={emptyBody ?? (typeof empty === "string" ? undefined : empty)}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full border-collapse table-hover">
              <thead className="sticky top-0 z-10">
                <tr>
                  {bulkActions && (
                    <th className="th w-9">
                      <input
                        type="checkbox"
                        checked={allOnPageChecked}
                        onChange={toggleAllOnPage}
                        aria-label="Select all rows on this page"
                      />
                    </th>
                  )}
                  {visible.map((column) => {
                    const isSorted = sortKey === column.key;
                    return (
                      <th
                        key={column.key}
                        style={
                          column.width ? { width: column.width } : undefined
                        }
                        className={`th ${align(column)} ${column.sticky ? "sticky left-0 z-10 bg-surface-sunken" : ""}`}
                        aria-sort={
                          isSorted
                            ? sortDir === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                      >
                        {column.action ? (
                          <span className="sr-only">
                            {column.label || "Actions"}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 hover:text-ink"
                            onClick={() => toggleSort(column.key)}
                          >
                            {column.label}
                            <span
                              aria-hidden
                              className={
                                isSorted ? "opacity-100" : "opacity-25"
                              }
                            >
                              {isSorted && sortDir === "desc" ? "↓" : "↑"}
                            </span>
                          </button>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => {
                  const key = getKey(row);
                  const isSelected = selectedKey === key;
                  const tone = rowTone?.(row) ?? null;
                  return (
                    <tr
                      key={key}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={`${onRowClick ? "cursor-pointer" : ""}
                        ${isSelected ? "bg-brand/10" : ""}
                        ${tone === "danger" ? "bg-danger/[0.06]" : tone === "warn" ? "bg-warn/[0.06]" : ""}`}
                    >
                      {bulkActions && (
                        <td
                          className="td w-9"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={checked.has(key)}
                            onChange={() =>
                              setChecked((previous) => {
                                const next = new Set(previous);
                                if (next.has(key)) next.delete(key);
                                else next.add(key);
                                return next;
                              })
                            }
                            aria-label="Select row"
                          />
                        </td>
                      )}
                      {visible.map((column) => (
                        <td
                          key={column.key}
                          className={`td ${align(column)} ${column.numeric ? "num" : ""}
                            ${column.sticky ? "sticky left-0 bg-surface" : ""}`}
                        >
                          {column.render
                            ? column.render(row)
                            : (valueOf(row, column) ?? "—")}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {(pageCount > 1 || sorted.length > 25) && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-small text-ink-muted">
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1">
                  Rows
                  <select
                    className="input w-auto py-0.5 text-small"
                    value={size}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      if (server) server.onPageSize?.(next);
                      else setPageSize(next);
                      setPage(1);
                    }}
                    aria-label="Rows per page"
                    disabled={!!server && !server.onPageSize}
                  >
                    {[25, 50, 100, 250].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                {server && !server.onQuery && query.trim() !== "" && (
                  <span>
                    Searching this page only, not all{" "}
                    <span className="num">{server.total.toLocaleString()}</span>{" "}
                    rows.
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="btn-ghost btn-sm"
                  disabled={current === 1 || server?.loading}
                  onClick={() =>
                    server
                      ? server.onPage(Math.max(1, current - 1))
                      : setPage((p) => Math.max(1, p - 1))
                  }
                >
                  Previous
                </button>
                <span className="num">
                  {current} / {pageCount}
                </span>
                <button
                  className="btn-ghost btn-sm"
                  disabled={current === pageCount || server?.loading}
                  onClick={() =>
                    server
                      ? server.onPage(Math.min(pageCount, current + 1))
                      : setPage((p) => Math.min(pageCount, p + 1))
                  }
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
