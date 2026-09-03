"use client";

import { useEffect, useMemo, useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { api, money, qty, shortDate, tokenStore } from "@/lib/api";
import { Card, Empty, ErrorBox, Loading, Pill, Table } from "@/components/ui";
import {
  Card as Panel,
  EmptyState,
  ErrorState,
  Stat,
} from "@/components/primitives";
import { DataTable } from "@/components/DataTable";

interface Line {
  productId: string;
  batchId: string;
  label: string;
  onHand: number;
  quantityDelta: string;
  reason: string;
  /** Only meaningful on a write-off; the API refuses an unclassified loss. */
  lossType: string;
}

/**
 * Mirrors LOSS_TYPES on the API. The server is the authority - this list only
 * decides what the operator is offered.
 */
const LOSS_TYPES = [
  { value: "SHRINKAGE", label: "Shrinkage (unexplained)" },
  { value: "DAMAGE", label: "Damage" },
  { value: "THEFT", label: "Theft" },
  { value: "MISPLACEMENT", label: "Misplaced stock" },
  { value: "EXPIRY", label: "Expiry" },
  { value: "COUNTING_ERROR", label: "Counting error" },
  { value: "SUPPLIER_SHORTAGE", label: "Supplier shortage" },
  { value: "UNKNOWN", label: "Unknown" },
];

export default function AdjustmentsPage() {
  const [branches, setBranches] = useState<any[]>([]);
  const [branchId, setBranchId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const org = useApi<any>("/admin/organization");
  const ledger = useApi<any>(
    warehouseId
      ? `/inventory/ledger?warehouseId=${warehouseId}&pageSize=25`
      : null,
    [warehouseId, message],
  );

  useEffect(() => {
    if (!org.data) return;
    const user = tokenStore.user;
    const allowed = user?.branchIds.length
      ? org.data.branches.filter((b: any) => user.branchIds.includes(b.id))
      : org.data.branches;
    setBranches(allowed);
    const first = allowed[0];
    if (first) {
      setBranchId(first.id);
      setWarehouseId(first.warehouses[0]?.id ?? "");
    }
  }, [org.data]);

  useEffect(() => {
    if (!search || !warehouseId) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await api<any>(
          `/inventory/balances?warehouseId=${warehouseId}&search=${encodeURIComponent(search)}&pageSize=20`,
        );
        setResults(res.data);
      } catch (e: any) {
        setError(e.message);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [search, warehouseId]);

  function addLine(balance: any) {
    if (!balance.batch) {
      setError("Only batch-level positions can be adjusted.");
      return;
    }
    if (lines.some((l) => l.batchId === balance.batch.id)) return;
    setLines((l) => [
      ...l,
      {
        productId: balance.productId,
        batchId: balance.batch.id,
        label: `${balance.product.genericName} ${balance.product.strength} · ${balance.batch.batchNumber}`,
        onHand: Number(balance.onHand),
        quantityDelta: "",
        reason: "",
        lossType: "",
      },
    ]);
    setSearch("");
    setResults([]);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const payload = lines
        .filter((l) => l.quantityDelta !== "" && Number(l.quantityDelta) !== 0)
        .map((l) => ({
          productId: l.productId,
          batchId: l.batchId,
          quantityDelta: Number(l.quantityDelta),
          reason: l.reason || undefined,
          // A positive line is stock found, not a loss, and must carry no type.
          lossType:
            Number(l.quantityDelta) < 0 ? l.lossType || undefined : undefined,
        }));
      if (!payload.length) {
        setError("Enter a non-zero adjustment on at least one line.");
        return;
      }
      const unclassified = payload.filter(
        (l) => l.quantityDelta < 0 && !l.lossType,
      );
      if (unclassified.length) {
        setError(
          `${unclassified.length} write-off line(s) need a loss type before they can be posted.`,
        );
        return;
      }
      const result = await api("/stock-adjustments", {
        method: "POST",
        body: { warehouseId, branchId, reason, items: payload },
      });
      setMessage(`Adjustment ${result.adjustmentNo} posted to the ledger.`);
      setLines([]);
      setReason("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Stock Adjustments"
        subtitle="Adjustments are ledger movements, not edits: the original quantity stays in the history forever."
      />

      {error && (
        <div className="mb-3">
          <ErrorBox message={error} />
        </div>
      )}
      {message && (
        <div className="mb-3 rounded-md border border-ok/30 bg-ok-light px-3 py-2 text-sm text-ok">
          {message}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="New adjustment">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Branch</label>
              <select
                aria-label="Branch"
                className="input"
                value={branchId}
                onChange={(e) => {
                  setBranchId(e.target.value);
                  const b = branches.find((x) => x.id === e.target.value);
                  setWarehouseId(b?.warehouses[0]?.id ?? "");
                  setLines([]);
                }}
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Warehouse</label>
              <select
                aria-label="Warehouse"
                className="input"
                value={warehouseId}
                onChange={(e) => {
                  setWarehouseId(e.target.value);
                  setLines([]);
                }}
              >
                {branches
                  .find((b) => b.id === branchId)
                  ?.warehouses.map((w: any) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="mt-3">
            <label className="label">
              Reason for the adjustment (required)
            </label>
            <input
              aria-label="Reason for the adjustment (required)"
              className="input"
              placeholder="e.g. Breakage during handling, verified by warehouse manager"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <div className="mt-3">
            <label className="label">Find the batch to adjust</label>
            <input
              aria-label="Find the batch to adjust"
              className="input"
              placeholder="Search product name or SKU"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {results.length > 0 && (
              <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-surface-border">
                {results.map((b) => (
                  <button
                    key={b.id}
                    className="block w-full px-2 py-1.5 text-left text-sm hover:bg-surface-sunken"
                    onClick={() => addLine(b)}
                  >
                    <span className="font-medium">
                      {b.product.genericName} {b.product.strength}
                    </span>
                    <span className="text-xs text-ink-subtle">
                      {" "}
                      · {b.batch?.batchNumber ?? "no batch"} · on hand{" "}
                      {qty(b.onHand)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {lines.length > 0 && (
            <div className="mt-4">
              <Table
                head={[
                  "Batch",
                  "On hand",
                  "Adjust by",
                  "New",
                  "Loss type",
                  "Line reason",
                  "",
                ]}
              >
                {lines.map((l, i) => {
                  const delta = Number(l.quantityDelta || 0);
                  return (
                    <tr key={l.batchId}>
                      <td className="td text-xs">{l.label}</td>
                      <td className="td num">{qty(l.onHand)}</td>
                      <td className="td">
                        <input
                          className="input w-24 num"
                          type="number"
                          placeholder="+/-"
                          value={l.quantityDelta}
                          onChange={(e) =>
                            setLines((p) =>
                              p.map((x, xi) =>
                                xi === i
                                  ? { ...x, quantityDelta: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        />
                      </td>
                      <td
                        className={`td num ${l.onHand + delta < 0 ? "text-danger font-medium" : ""}`}
                      >
                        {qty(l.onHand + delta)}
                      </td>
                      <td className="td">
                        {delta < 0 ? (
                          <select
                            className="input text-xs"
                            value={l.lossType}
                            aria-label={`Loss type for ${l.label}`}
                            onChange={(e) =>
                              setLines((p) =>
                                p.map((x, xi) =>
                                  xi === i
                                    ? { ...x, lossType: e.target.value }
                                    : x,
                                ),
                              )
                            }
                          >
                            <option value="">Select a cause…</option>
                            {LOSS_TYPES.map((t) => (
                              <option key={t.value} value={t.value}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs text-ink-subtle">—</span>
                        )}
                      </td>
                      <td className="td">
                        <input
                          className="input text-xs"
                          value={l.reason}
                          onChange={(e) =>
                            setLines((p) =>
                              p.map((x, xi) =>
                                xi === i ? { ...x, reason: e.target.value } : x,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="td">
                        <button
                          className="btn-ghost text-xs"
                          onClick={() =>
                            setLines((p) => p.filter((_, xi) => xi !== i))
                          }
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </Table>

              {lines.some(
                (l) => l.onHand + Number(l.quantityDelta || 0) < 0,
              ) && (
                <p className="mt-2 text-xs text-danger">
                  A negative result will be refused by the ledger unless
                  negative stock is enabled for this organization.
                </p>
              )}

              <button
                className="btn-primary mt-3"
                disabled={busy || !reason.trim()}
                onClick={submit}
              >
                {busy ? "Posting..." : "Post adjustment"}
              </button>
              {!reason.trim() && (
                <p className="mt-1 text-xs text-ink-subtle">
                  A reason is required before posting.
                </p>
              )}
            </div>
          )}
        </Card>

        <Card title="Recent ledger movements">
          {ledger.loading && <Loading />}
          {ledger.data?.data?.length ? (
            <Table
              head={[
                "When",
                "Type",
                "Product",
                "In",
                "Out",
                "Balance",
                "Reference",
              ]}
            >
              {ledger.data.data.map((t: any) => (
                <tr key={t.id}>
                  <td className="td text-xs text-ink-muted">
                    {shortDate(t.occurredAt)}
                  </td>
                  <td className="td">
                    <Pill
                      tone={
                        t.type === "ADJUSTMENT" || t.type === "STOCK_COUNT"
                          ? "warn"
                          : t.type === "PURCHASE_RECEIPT"
                            ? "ok"
                            : "neutral"
                      }
                    >
                      {t.type.replace(/_/g, " ")}
                    </Pill>
                  </td>
                  <td className="td text-xs">{t.product.genericName}</td>
                  <td className="td num">{Number(t.quantityIn) || ""}</td>
                  <td className="td num">{Number(t.quantityOut) || ""}</td>
                  <td className="td num font-medium">{qty(t.balanceAfter)}</td>
                  <td className="td text-xs text-ink-muted">
                    {t.referenceNo ?? "-"}
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            !ledger.loading && (
              <Empty>No movements recorded in this warehouse.</Empty>
            )
          )}
        </Card>
      </div>

      <LossAnalysis warehouseId={warehouseId} refreshKey={message} />
    </Shell>
  );
}

/**
 * Where the stock actually went (§21: feature 180).
 *
 * Only negative movements are losses; a positive adjustment is stock found, and
 * netting the two would cancel real losses against clerical corrections. The
 * unclassified pile is shown as its own row rather than hidden, because its
 * size is itself the finding.
 */
function LossAnalysis({
  warehouseId,
  refreshKey,
}: {
  warehouseId: string;
  refreshKey: string | null;
}) {
  const [days, setDays] = useState(90);

  // Memoised on `days`, not recomputed each render.
  //
  // Building the URL from Date.now() inline made it different on every render,
  // so the fetch hook saw a new path each time, refetched, re-rendered, and
  // fetched again. The page never went idle — the browser sweep timed out on it
  // after thirty seconds — and it hammered the API the whole time it was open.
  const from = useMemo(
    () => new Date(Date.now() - days * 86_400_000).toISOString(),
    [days],
  );
  const query = new URLSearchParams({ from });
  if (warehouseId) query.set("warehouseId", warehouseId);

  const { data, error, loading, refresh } = useApi<any>(
    `/stock-adjustments/loss-analysis?${query}`,
    [warehouseId, days, refreshKey],
  );

  const byType: any[] = data?.byType ?? [];
  const topProducts: any[] = data?.topProducts ?? [];

  return (
    <div className="mt-4 space-y-4">
      {error && <ErrorState message={error} onRetry={refresh} />}
      {loading && !data && <Loading />}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat
              label="Value written off"
              value={money(data.totalValue)}
              tone={Number(data.totalValue) > 0 ? "danger" : "ok"}
              sub={`Last ${days} days`}
            />
            <Stat
              label="Write-off lines"
              value={data.totalLines}
              sub="Negative adjustment lines"
            />
            <Stat
              label="Unclassified"
              value={money(
                byType.find((t) => t.lossType === "UNCLASSIFIED")?.value ?? 0,
              )}
              tone={
                byType.some((t) => t.lossType === "UNCLASSIFIED")
                  ? "warn"
                  : "ok"
              }
              sub="Recorded before a cause was required"
            />
          </div>

          <Panel
            title="Loss by cause"
            description="Classification is what turns a shortfall into an action: breakage points at handling, theft at access control, expiry at ordering."
            action={
              <select
                className="input w-auto py-1 text-small"
                aria-label="Period"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                {[30, 90, 180, 365].map((d) => (
                  <option key={d} value={d}>
                    Last {d} days
                  </option>
                ))}
              </select>
            }
            padded={false}
          >
            <div className="p-4">
              {byType.length === 0 ? (
                <EmptyState
                  title="Nothing has been written off in this period"
                  body="Write-offs recorded through this screen or through a stock count appear here."
                />
              ) : (
                <DataTable
                  rows={byType}
                  getKey={(r: any) => r.lossType}
                  pageSize={10}
                  exportName="loss-by-cause"
                  searchPlaceholder="Search cause"
                  rowTone={(r: any) =>
                    r.lossType === "THEFT" ? "danger" : null
                  }
                  columns={[
                    {
                      key: "lossType",
                      label: "Cause",
                      value: (r: any) => r.lossType,
                      render: (r: any) =>
                        r.lossType
                          .replace(/_/g, " ")
                          .toLowerCase()
                          .replace(/^./, (c: string) => c.toUpperCase()),
                    },
                    {
                      key: "lines",
                      label: "Lines",
                      numeric: true,
                      value: (r: any) => r.lines,
                    },
                    {
                      key: "quantity",
                      label: "Quantity",
                      numeric: true,
                      value: (r: any) => Number(r.quantity),
                      render: (r: any) => qty(r.quantity),
                    },
                    {
                      key: "value",
                      label: "Value",
                      numeric: true,
                      value: (r: any) => Number(r.value),
                      render: (r: any) => money(r.value),
                    },
                    {
                      key: "share",
                      label: "Share",
                      numeric: true,
                      value: (r: any) => Number(r.sharePercent),
                      render: (r: any) => `${r.sharePercent}%`,
                    },
                  ]}
                />
              )}
            </div>
          </Panel>

          {topProducts.length > 0 && (
            <Panel title="Worst-affected products" padded={false}>
              <div className="p-4">
                <DataTable
                  rows={topProducts}
                  getKey={(r: any) => r.productId}
                  pageSize={10}
                  exportName="loss-by-product"
                  searchPlaceholder="Search product"
                  columns={[
                    { key: "sku", label: "SKU", value: (r: any) => r.sku },
                    {
                      key: "name",
                      label: "Product",
                      value: (r: any) => r.name,
                    },
                    {
                      key: "quantity",
                      label: "Quantity",
                      numeric: true,
                      value: (r: any) => Number(r.quantity),
                      render: (r: any) => qty(r.quantity),
                    },
                    {
                      key: "value",
                      label: "Value",
                      numeric: true,
                      value: (r: any) => Number(r.value),
                      render: (r: any) => money(r.value),
                    },
                  ]}
                />
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
