"use client";

import { useMemo, useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { api } from "@/lib/api";
import { Card, Empty, ErrorBox, Loading, Pill, Stat } from "@/components/ui";
import { DataTable } from "@/components/DataTable";
import { useFeedback } from "@/components/Feedback";

interface CatalogueColumn {
  key: string;
  label: string;
  type: "string" | "number" | "date" | "boolean";
  numeric: boolean;
  available: boolean;
  requires: string | null;
}

interface CatalogueSource {
  key: string;
  label: string;
  description: string;
  supportsBranchFilter: boolean;
  columns: CatalogueColumn[];
}

const OPERATORS: Array<{ value: string; label: string; values: 0 | 1 | 2 }> = [
  { value: "eq", label: "is", values: 1 },
  { value: "ne", label: "is not", values: 1 },
  { value: "lt", label: "is less than", values: 1 },
  { value: "lte", label: "is at most", values: 1 },
  { value: "gt", label: "is more than", values: 1 },
  { value: "gte", label: "is at least", values: 1 },
  { value: "contains", label: "contains", values: 1 },
  { value: "starts_with", label: "starts with", values: 1 },
  { value: "in", label: "is one of (comma separated)", values: 1 },
  { value: "not_in", label: "is none of (comma separated)", values: 1 },
  { value: "between", label: "is between", values: 2 },
  { value: "is_null", label: "is not set", values: 0 },
  { value: "is_not_null", label: "is set", values: 0 },
];

const AGGREGATES = ["COUNT", "SUM", "AVG", "MIN", "MAX"] as const;

interface FilterRow {
  field: string;
  operator: string;
  value: string;
  value2: string;
}

export default function ReportBuilderPage() {
  const { toast, confirm } = useFeedback();
  const [sourceKey, setSourceKey] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [filters, setFilters] = useState<FilterRow[]>([]);
  const [groupBy, setGroupBy] = useState("");
  const [aggregates, setAggregates] = useState<Record<string, string>>({});
  const [sortField, setSortField] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState("1000");
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedVersion, setSavedVersion] = useState(0);

  const catalogue = useApi<CatalogueSource[]>("/report-builder/sources");
  const saved = useApi<any[]>("/report-builder/saved", [savedVersion]);

  const source = useMemo(
    () => (catalogue.data ?? []).find((s) => s.key === sourceKey) ?? null,
    [catalogue.data, sourceKey],
  );

  function selectSource(key: string) {
    setSourceKey(key);
    // A definition built for one source means nothing against another, so it
    // is cleared rather than carried over half-valid.
    setChosen([]);
    setFilters([]);
    setGroupBy("");
    setAggregates({});
    setSortField("");
    setResult(null);
  }

  function definition() {
    return {
      dataSource: sourceKey,
      columns: chosen,
      filters: filters
        .filter((f) => f.field && f.operator)
        .map((f) => ({
          field: f.field,
          operator: f.operator,
          value:
            f.operator === "in" || f.operator === "not_in"
              ? f.value
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean)
              : f.value,
          value2: f.value2 || undefined,
        })),
      groupBy: groupBy || null,
      aggregates,
      sort: sortField ? [{ field: sortField, direction: sortDir }] : [],
      from: from || undefined,
      to: to || undefined,
      limit: Number(limit) || 1000,
    };
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api("/report-builder/run", {
          method: "POST",
          body: definition(),
        }),
      );
    } catch (e: any) {
      setError(e.message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv() {
    setBusy(true);
    setError(null);
    try {
      // The export endpoint needs its own permission and is audited when the
      // data is sensitive, so it is a real request rather than a client-side
      // dump of what is on screen.
      const csv = await api<string>("/report-builder/export", {
        method: "POST",
        body: definition(),
      });
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${sourceKey || "report"}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast("Exported", "ok");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveReport() {
    const name = window.prompt("Name this report");
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      await api("/report-builder/saved", {
        method: "POST",
        body: { ...definition(), name, visualization: "TABLE" },
      });
      toast("Report saved", "ok");
      setSavedVersion((v) => v + 1);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function runSaved(report: any) {
    setBusy(true);
    setError(null);
    try {
      const out = await api<any>(`/report-builder/saved/${report.id}/run`, {
        method: "POST",
        body: {},
      });
      setSourceKey(out.dataSource);
      setResult(out);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteSaved(report: any) {
    const { confirmed } = await confirm({
      title: `Delete "${report.name}"?`,
      body: "The definition is removed. No data is affected — a report only reads.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await api(`/report-builder/saved/${report.id}`, { method: "DELETE" });
      toast("Report deleted", "ok");
      setSavedVersion((v) => v + 1);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const resultColumns = (result?.columns ?? []).map((c: any) => ({
    key: c.key,
    label: c.label,
    numeric: c.numeric,
    align: c.numeric ? ("right" as const) : ("left" as const),
    value: (row: any) => row[c.key] ?? "",
  }));

  return (
    <Shell>
      <PageHeader
        title="Report builder"
        subtitle="Reports are assembled from a whitelist of sources and columns, never from typed SQL. Permissions are checked when a report runs, not when it is saved."
      />

      {error && <ErrorBox message={error} />}
      {catalogue.error && <ErrorBox message={catalogue.error} />}
      {catalogue.loading && <Loading label="Loading the catalogue" />}

      {catalogue.data && catalogue.data.length === 0 && (
        <Empty>
          You do not hold the read permission for any reportable data source.
        </Empty>
      )}

      {catalogue.data && catalogue.data.length > 0 && (
        <div className="space-y-5">
          <Card title="1 · Choose the data">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-xs text-ink-muted">
                Data source
                <select
                  className="input mt-1"
                  value={sourceKey}
                  onChange={(e) => selectSource(e.target.value)}
                >
                  <option value="">Choose a source</option>
                  {catalogue.data.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              {source && (
                <p className="self-end text-xs text-ink-muted">
                  {source.description}
                </p>
              )}
            </div>

            {source && (
              <div className="mt-4">
                <div className="text-xs font-medium text-ink">
                  Columns (
                  {chosen.length ? `${chosen.length} chosen` : "all available"})
                </div>
                <div className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                  {source.columns.map((c) => (
                    <label
                      key={c.key}
                      className={`flex items-center gap-2 text-xs ${c.available ? "text-ink-muted" : "text-ink-subtle"}`}
                      title={c.available ? undefined : `Needs ${c.requires}`}
                    >
                      <input
                        type="checkbox"
                        disabled={!c.available}
                        checked={chosen.includes(c.key)}
                        onChange={(e) =>
                          setChosen((s) =>
                            e.target.checked
                              ? [...s, c.key]
                              : s.filter((x) => x !== c.key),
                          )
                        }
                      />
                      {c.label}
                      {!c.available && (
                        <Pill tone="warn">Needs {c.requires}</Pill>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {source && (
            <>
              <Card
                title="2 · Narrow it down"
                action={
                  <button
                    className="btn-ghost"
                    onClick={() =>
                      setFilters((f) => [
                        ...f,
                        {
                          field: source.columns[0].key,
                          operator: "eq",
                          value: "",
                          value2: "",
                        },
                      ])
                    }
                  >
                    Add a condition
                  </button>
                }
              >
                {filters.length === 0 ? (
                  <p className="text-xs text-ink-muted">
                    No condition — every row the source returns is included.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {filters.map((f, i) => {
                      const op = OPERATORS.find((o) => o.value === f.operator);
                      return (
                        <div
                          key={i}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <select
                            className="input w-52"
                            value={f.field}
                            onChange={(e) =>
                              setFilters((rows) =>
                                rows.map((r, j) =>
                                  j === i ? { ...r, field: e.target.value } : r,
                                ),
                              )
                            }
                          >
                            {source.columns.map((c) => (
                              <option key={c.key} value={c.key}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                          <select
                            className="input w-56"
                            value={f.operator}
                            onChange={(e) =>
                              setFilters((rows) =>
                                rows.map((r, j) =>
                                  j === i
                                    ? { ...r, operator: e.target.value }
                                    : r,
                                ),
                              )
                            }
                          >
                            {OPERATORS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          {(op?.values ?? 1) >= 1 && (
                            <input
                              className="input w-40"
                              value={f.value}
                              placeholder="Value"
                              onChange={(e) =>
                                setFilters((rows) =>
                                  rows.map((r, j) =>
                                    j === i
                                      ? { ...r, value: e.target.value }
                                      : r,
                                  ),
                                )
                              }
                            />
                          )}
                          {(op?.values ?? 0) === 2 && (
                            <input
                              className="input w-40"
                              value={f.value2}
                              placeholder="and"
                              onChange={(e) =>
                                setFilters((rows) =>
                                  rows.map((r, j) =>
                                    j === i
                                      ? { ...r, value2: e.target.value }
                                      : r,
                                  ),
                                )
                              }
                            />
                          )}
                          <button
                            className="btn-ghost"
                            onClick={() =>
                              setFilters((rows) =>
                                rows.filter((_, j) => j !== i),
                              )
                            }
                          >
                            Remove
                          </button>
                        </div>
                      );
                    })}
                    <p className="text-xs text-ink-subtle">
                      All conditions must hold. A field the row does not carry
                      never matches.
                    </p>
                  </div>
                )}

                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <label className="text-xs text-ink-muted">
                    From
                    <input
                      type="date"
                      className="input mt-1"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </label>
                  <label className="text-xs text-ink-muted">
                    To
                    <input
                      type="date"
                      className="input mt-1"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </label>
                  <label className="text-xs text-ink-muted">
                    Row limit
                    <input
                      type="number"
                      min="1"
                      max="10000"
                      className="input mt-1"
                      value={limit}
                      onChange={(e) => setLimit(e.target.value)}
                    />
                  </label>
                </div>
              </Card>

              <Card title="3 · Group and sort">
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="text-xs text-ink-muted">
                    Group by
                    <select
                      className="input mt-1"
                      value={groupBy}
                      onChange={(e) => setGroupBy(e.target.value)}
                    >
                      <option value="">No grouping — one row per record</option>
                      {source.columns
                        .filter((c) => c.available)
                        .map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.label}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="text-xs text-ink-muted">
                    Sort by
                    <select
                      className="input mt-1"
                      value={sortField}
                      onChange={(e) => setSortField(e.target.value)}
                    >
                      <option value="">Source order</option>
                      {source.columns
                        .filter((c) => c.available)
                        .map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.label}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="text-xs text-ink-muted">
                    Direction
                    <select
                      className="input mt-1"
                      value={sortDir}
                      onChange={(e) => setSortDir(e.target.value as any)}
                    >
                      <option value="asc">Ascending</option>
                      <option value="desc">Descending</option>
                    </select>
                  </label>
                </div>

                {groupBy && (
                  <div className="mt-4">
                    <div className="text-xs font-medium text-ink">
                      How to summarise each numeric column
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {source.columns
                        .filter((c) => c.numeric && c.available)
                        .map((c) => (
                          <label
                            key={c.key}
                            className="flex items-center gap-2 text-xs text-ink-muted"
                          >
                            <span className="w-32 truncate">{c.label}</span>
                            <select
                              className="input"
                              value={aggregates[c.key] ?? ""}
                              onChange={(e) =>
                                setAggregates((a) => {
                                  const next = { ...a };
                                  if (e.target.value)
                                    next[c.key] = e.target.value;
                                  else delete next[c.key];
                                  return next;
                                })
                              }
                            >
                              <option value="">Leave out</option>
                              {AGGREGATES.map((a) => (
                                <option key={a} value={a}>
                                  {a}
                                </option>
                              ))}
                            </select>
                          </label>
                        ))}
                    </div>
                  </div>
                )}
              </Card>

              <div className="flex flex-wrap gap-2">
                <button
                  className="btn-primary"
                  disabled={busy || !sourceKey}
                  onClick={run}
                >
                  {busy ? "Running…" : "Run report"}
                </button>
                <button
                  className="btn-ghost"
                  disabled={busy || !result}
                  onClick={exportCsv}
                >
                  Export CSV
                </button>
                <button
                  className="btn-ghost"
                  disabled={busy || !sourceKey}
                  onClick={saveReport}
                >
                  Save definition
                </button>
              </div>
            </>
          )}

          {result && (
            <Card title={`${result.label} — result`}>
              <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Rows returned" value={result.rowCount} />
                <Stat label="Records scanned" value={result.scannedRows} />
                <Stat
                  label="Grouped"
                  value={result.grouped ? `By ${result.groupBy}` : "No"}
                />
                <Stat
                  label="Complete"
                  value={result.truncated ? "Truncated" : "Yes"}
                  tone={result.truncated ? "warn" : "neutral"}
                  sub={
                    result.truncated
                      ? "The row limit was reached — raise it to see the rest"
                      : undefined
                  }
                />
              </div>

              {result.withheldColumns?.length > 0 && (
                // Named rather than silently absent: a missing column must not
                // be mistaken for missing data.
                <div className="mb-3 rounded-md border border-warn/40 bg-warn-light p-3 text-xs text-warn">
                  {result.withheldColumns.length} column(s) were left out
                  because you do not hold the permission they need:{" "}
                  {result.withheldColumns
                    .map((w: any) => `${w.key} (needs ${w.requires})`)
                    .join(", ")}
                  .
                </div>
              )}

              {result.rows.length === 0 ? (
                <Empty>No record matched.</Empty>
              ) : (
                <DataTable
                  rows={result.rows}
                  getKey={(_row: any) => JSON.stringify(_row).slice(0, 120)}
                  columns={resultColumns}
                  pageSize={25}
                  searchPlaceholder="Search the result"
                />
              )}
            </Card>
          )}

          <Card title="Saved reports">
            {saved.error && <ErrorBox message={saved.error} />}
            {saved.data &&
              (saved.data.length === 0 ? (
                <Empty>Nothing saved yet.</Empty>
              ) : (
                <DataTable
                  rows={saved.data}
                  getKey={(r: any) => r.id}
                  pageSize={10}
                  columns={[
                    { key: "name", label: "Name", value: (r: any) => r.name },
                    {
                      key: "dataSource",
                      label: "Source",
                      value: (r: any) => r.dataSource,
                    },
                    {
                      key: "columns",
                      label: "Columns",
                      numeric: true,
                      align: "right",
                      value: (r: any) => r.columns.length,
                    },
                    {
                      key: "isShared",
                      label: "Shared",
                      value: (r: any) => (r.isShared ? "Yes" : "No"),
                      render: (r: any) => (
                        <Pill tone={r.isShared ? "info" : "neutral"}>
                          {r.isShared ? "Shared" : "Private"}
                        </Pill>
                      ),
                    },
                    {
                      key: "actions",
                      label: "",
                      render: (r: any) => (
                        <div className="flex gap-2">
                          <button
                            className="btn-ghost"
                            disabled={busy}
                            onClick={() => void runSaved(r)}
                          >
                            Run
                          </button>
                          <button
                            className="btn-ghost"
                            disabled={busy}
                            onClick={() => void deleteSaved(r)}
                          >
                            Delete
                          </button>
                        </div>
                      ),
                    },
                  ]}
                />
              ))}
          </Card>
        </div>
      )}
    </Shell>
  );
}
