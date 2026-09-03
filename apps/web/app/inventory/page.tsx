"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { useScope } from "@/lib/scope";
import { api, can, money, qty, shortDate, tokenStore } from "@/lib/api";
import { BatchStatus, Card, Empty, ErrorBox, Loading, Table } from "@/components/ui";
import { ExpiryBadge } from "@/components/status";
import { Field, Stat, Toolbar } from "@/components/primitives";
import { StockPositionDrawer } from "@/components/inventory/StockPositionDrawer";
import { ReservationsPanel } from "@/components/inventory/ReservationsPanel";
import { AnomaliesPanel } from "@/components/inventory/AnomaliesPanel";

const BATCH_STATUSES = [
  "QUARANTINED",
  "RELEASED",
  "AVAILABLE",
  "BLOCKED",
  "DAMAGED",
  "RECALLED",
  "RETURNED",
  "EXPIRED",
  "DESTROYED",
];

const EXPIRY_WINDOWS = [
  { label: "Any expiry", value: "" },
  { label: "Expiring in 30 days", value: "30" },
  { label: "Expiring in 90 days", value: "90" },
  { label: "Expiring in 180 days", value: "180" },
];

const SORTS = [
  { label: "Product", value: "product" },
  { label: "Expiry", value: "expiry" },
  { label: "On hand", value: "onHand" },
  { label: "Available", value: "available" },
  { label: "Value", value: "value" },
  { label: "Stock age", value: "age" },
];

/**
 * The filter set, kept in the URL.
 *
 * A storekeeper who has narrowed to "cold chain, expiring in 30 days, below
 * reorder" needs to be able to send that to somebody, and to still have it
 * after a refresh. Encoding it in the query string costs nothing and is the
 * only form of saved filter that survives a different browser.
 */
interface Filters {
  search: string;
  /** Set only by a link that named one product, e.g. a reorder alert. */
  productId: string;
  warehouseId: string;
  batchStatus: string;
  expiringWithinDays: string;
  onlyBelowReorder: boolean;
  onlyOutOfStock: boolean;
  onlyControlled: boolean;
  onlyColdChain: boolean;
  sort: string;
  direction: "asc" | "desc";
}

const EMPTY_FILTERS: Filters = {
  search: "",
  productId: "",
  warehouseId: "",
  batchStatus: "",
  expiringWithinDays: "",
  onlyBelowReorder: false,
  onlyOutOfStock: false,
  onlyControlled: false,
  onlyColdChain: false,
  sort: "product",
  direction: "asc",
};

function readFilters(): Filters {
  if (typeof window === "undefined") return EMPTY_FILTERS;
  const p = new URLSearchParams(window.location.search);
  return {
    search: p.get("search") ?? "",
    productId: p.get("productId") ?? "",
    warehouseId: p.get("warehouseId") ?? "",
    batchStatus: p.get("batchStatus") ?? "",
    expiringWithinDays: p.get("expiringWithinDays") ?? "",
    onlyBelowReorder: p.get("onlyBelowReorder") === "true",
    onlyOutOfStock: p.get("onlyOutOfStock") === "true",
    onlyControlled: p.get("onlyControlled") === "true",
    onlyColdChain: p.get("onlyColdChain") === "true",
    sort: p.get("sort") ?? "product",
    direction: p.get("direction") === "desc" ? "desc" : "asc",
  };
}

function toQuery(f: Filters, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  if (f.search.trim()) p.set("search", f.search.trim());
  if (f.productId) p.set("productId", f.productId);
  if (f.warehouseId) p.set("warehouseId", f.warehouseId);
  if (f.batchStatus) p.set("batchStatus", f.batchStatus);
  if (f.expiringWithinDays) p.set("expiringWithinDays", f.expiringWithinDays);
  if (f.onlyBelowReorder) p.set("onlyBelowReorder", "true");
  if (f.onlyOutOfStock) p.set("onlyOutOfStock", "true");
  if (f.onlyControlled) p.set("onlyControlled", "true");
  if (f.onlyColdChain) p.set("onlyColdChain", "true");
  if (f.sort !== "product") p.set("sort", f.sort);
  if (f.direction !== "asc") p.set("direction", f.direction);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p.toString();
}

export default function InventoryPage() {
  return (
    <Shell>
      <InventoryBody />
    </Shell>
  );
}

function InventoryBody() {
  const user = typeof window !== "undefined" ? tokenStore.user : null;
  const canExport = can(user, "inventory.balance.EXPORT");
  const canRelease = can(user, "inventory.balance.EDIT");
  const canCount = can(user, "inventory.count.CREATE");
  const canAdjust = can(user, "inventory.adjustment.CREATE");
  const canTransfer = can(user, "inventory.transfer.CREATE");

  const { branch, warehouses: scopeWarehouses } = useScope();

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draftSearch, setDraftSearch] = useState("");
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<"stock" | "reservations" | "anomalies">("stock");
  const [selected, setSelected] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read the URL once on mount, so a shared link opens on the same filter.
  useEffect(() => {
    const initial = readFilters();
    setFilters(initial);
    setDraftSearch(initial.search);
  }, []);

  const query = useMemo(() => toQuery(filters), [filters]);

  // Write the filter back to the URL without adding a history entry per
  // keystroke: the reader wants Back to leave the screen, not to undo a filter.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const next = `${window.location.pathname}${query ? `?${query}` : ""}`;
    window.history.replaceState(null, "", next);
  }, [query]);

  // Every warehouse the reader reaches, not only those of a selected branch:
  // a storekeeper with no branch chosen still has warehouses to filter by.
  const warehouses = scopeWarehouses;

  const { data, error: loadError, loading, refresh } = useApi<any>(
    `/inventory/balances?pageSize=50&page=${page}${query ? `&${query}` : ""}`,
    [query, page],
  );

  const update = useCallback((patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  }, []);

  const [exporting, setExporting] = useState(false);

  /**
   * Fetched with the Authorization header and saved from a blob.
   *
   * Deliberately not a plain link with the token in the query string: that
   * writes an access token into browser history, the referrer and every proxy
   * log between here and the server. The export is the same scoped read behind
   * the same permission, and the server caps how much it returns.
   */
  async function exportCsv() {
    setError(null);
    setExporting(true);
    try {
      const csv = await api<string>(`/inventory/balances.csv?${query}`, { raw: true });
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `stock-balances-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  }

  const summary = data?.summary;

  return (
    <>
      <PageHeader
        title="Stock Balances"
        subtitle="Batch-level positions, scoped to your branches. Value is what is held, at average cost — the same basis the ledger uses."
        action={
          canExport ? (
            <button className="btn-ghost" onClick={exportCsv} disabled={exporting}>
              {exporting ? "Exporting…" : "Export CSV"}
            </button>
          ) : undefined
        }
      />

      {error && (
        <div className="mb-3">
          <ErrorBox message={error} />
        </div>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Positions" value={summary ? summary.positions.toLocaleString() : "—"} />
        <Stat label="Products" value={summary ? summary.products.toLocaleString() : "—"} />
        <Stat label="Units on hand" value={summary ? qty(summary.units) : "—"} />
        <Stat label="Value at cost" value={summary ? money(summary.value) : "—"} />
        <Stat
          label="Expiring in 90 days"
          value={summary ? summary.expiringWithin90Days.toLocaleString() : "—"}
        />
      </div>

      <Toolbar>
        <div className="flex gap-1" role="tablist" aria-label="Inventory view">
          <button
            role="tab"
            aria-selected={tab === "stock"}
            className={tab === "stock" ? "btn-primary btn-sm" : "btn-ghost btn-sm"}
            onClick={() => setTab("stock")}
          >
            Stock
          </button>
          <button
            role="tab"
            aria-selected={tab === "reservations"}
            className={tab === "reservations" ? "btn-primary btn-sm" : "btn-ghost btn-sm"}
            onClick={() => setTab("reservations")}
          >
            Reserved{summary && Number(summary.reserved) > 0 ? ` · ${qty(summary.reserved)}` : ""}
          </button>
          <button
            role="tab"
            aria-selected={tab === "anomalies"}
            className={tab === "anomalies" ? "btn-primary btn-sm" : "btn-ghost btn-sm"}
            onClick={() => setTab("anomalies")}
          >
            Needs a look
            {summary && summary.negative > 0 ? ` · ${summary.negative}` : ""}
          </button>
        </div>
      </Toolbar>

      {tab === "reservations" && (
        <ReservationsPanel canRelease={canRelease} onChanged={refresh} onError={setError} />
      )}

      {tab === "anomalies" && <AnomaliesPanel warehouseId={filters.warehouseId} />}

      {tab === "stock" && (
        <>
          <Card className="mb-4">
            <form
              className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault();
                update({ search: draftSearch });
              }}
            >
              <Field label="Search">
                <input
                  className="input"
                  placeholder="Product, brand, SKU or batch number"
                  value={draftSearch}
                  onChange={(e) => setDraftSearch(e.target.value)}
                />
              </Field>

              <Field label="Warehouse">
                <select
                  className="input"
                  value={filters.warehouseId}
                  onChange={(e) => update({ warehouseId: e.target.value })}
                >
                  <option value="">Every warehouse I can see</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Batch status">
                <select
                  className="input"
                  value={filters.batchStatus}
                  onChange={(e) => update({ batchStatus: e.target.value })}
                >
                  <option value="">Any status</option>
                  {BATCH_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Expiry">
                <select
                  className="input"
                  value={filters.expiringWithinDays}
                  onChange={(e) => update({ expiringWithinDays: e.target.value })}
                >
                  {EXPIRY_WINDOWS.map((w) => (
                    <option key={w.value} value={w.value}>
                      {w.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Order by">
                <div className="flex gap-2">
                  <select
                    className="input"
                    value={filters.sort}
                    onChange={(e) => update({ sort: e.target.value })}
                  >
                    {SORTS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() =>
                      update({ direction: filters.direction === "asc" ? "desc" : "asc" })
                    }
                    aria-label={`Sorting ${filters.direction === "asc" ? "ascending" : "descending"}`}
                  >
                    {filters.direction === "asc" ? "↑" : "↓"}
                  </button>
                </div>
              </Field>

              <fieldset className="sm:col-span-2 lg:col-span-3">
                <legend className="label">Only show</legend>
                <div className="flex flex-wrap gap-3 pt-1 text-small">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={filters.onlyBelowReorder}
                      onChange={(e) => update({ onlyBelowReorder: e.target.checked })}
                    />
                    At or below reorder level
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={filters.onlyOutOfStock}
                      onChange={(e) => update({ onlyOutOfStock: e.target.checked })}
                    />
                    Out of stock
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={filters.onlyControlled}
                      onChange={(e) => update({ onlyControlled: e.target.checked })}
                    />
                    Controlled
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={filters.onlyColdChain}
                      onChange={(e) => update({ onlyColdChain: e.target.checked })}
                    />
                    Cold chain
                  </label>
                </div>
              </fieldset>

              <div className="flex items-end gap-2">
                <button className="btn-primary">Search</button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setFilters(EMPTY_FILTERS);
                    setDraftSearch("");
                    setPage(1);
                  }}
                >
                  Clear
                </button>
              </div>
            </form>

            {filters.productId && (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-caption text-ink-muted">
                Showing one product, because a link named it.
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    update({ productId: "" });
                    setPage(1);
                  }}
                >
                  Show every product
                </button>
              </p>
            )}

            {filters.onlyBelowReorder && (
              <p className="mt-2 text-caption text-ink-muted">
                Reorder is judged on the branch-wide total for each product, not on one shelf.
              </p>
            )}
            {data && data.sortedAcrossAllPages === false && (
              <p className="mt-2 text-caption text-ink-muted">
                This ordering applies within the page. Narrow the filter to order the whole set.
              </p>
            )}
          </Card>

          {loadError && <ErrorBox message={loadError} />}
          {loading && <Loading />}

          {data && (
            <Card
              title={`${data.total.toLocaleString()} stock position${data.total === 1 ? "" : "s"}`}
              action={
                <div className="flex items-center gap-2 text-sm">
                  <button
                    className="btn-ghost"
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </button>
                  <span className="text-ink-muted">Page {data.page}</span>
                  <button
                    className="btn-ghost"
                    disabled={data.page * data.pageSize >= data.total}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              }
            >
              {data.data.length ? (
                <Table
                  head={[
                    "Product",
                    "Batch",
                    "Status",
                    "Expiry",
                    "Age",
                    "On hand",
                    "Reserved",
                    "Available",
                    "Value",
                    "Location",
                    "",
                  ]}
                >
                  {data.data.map((row: any) => (
                    <tr
                      key={row.id}
                      className={Number(row.onHand) < 0 ? "bg-danger-light" : undefined}
                    >
                      <td className="td">
                        <div className="font-medium">
                          {row.product.genericName} {row.product.strength}
                        </div>
                        <div className="text-xs text-ink-subtle">
                          {row.product.brandName ? `${row.product.brandName} · ` : ""}
                          {row.product.sku}
                          {row.product.isControlled && " · CONTROLLED"}
                          {row.product.isColdChain && " · COLD CHAIN"}
                        </div>
                      </td>
                      <td className="td text-ink-muted">{row.batch?.batchNumber ?? "—"}</td>
                      <td className="td">
                        {row.batch ? <BatchStatus status={row.batch.status} /> : "—"}
                      </td>
                      <td className="td">
                        <div className="text-xs text-ink-muted">
                          {shortDate(row.batch?.expiryDate)}
                        </div>
                        <ExpiryBadge days={row.daysToExpiry} />
                      </td>
                      <td className="td num text-ink-muted">
                        {row.ageDays === null ? "—" : `${row.ageDays}d`}
                      </td>
                      <td className="td num">{qty(row.onHand)}</td>
                      <td className="td num text-ink-muted">{qty(row.reserved)}</td>
                      <td className="td num font-medium">{qty(row.available)}</td>
                      <td className="td num">{money(row.stockValue)}</td>
                      <td className="td text-xs text-ink-muted">
                        {row.warehouse.name}
                        {row.location && <div>{row.location.code}</div>}
                      </td>
                      <td className="td">
                        <button className="btn-ghost text-xs" onClick={() => setSelected(row)}>
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Empty>No stock positions match this filter.</Empty>
              )}
            </Card>
          )}
        </>
      )}

      <StockPositionDrawer
        position={selected}
        onClose={() => setSelected(null)}
        canRelease={canRelease}
        canCount={canCount}
        canAdjust={canAdjust}
        canTransfer={canTransfer}
        onChanged={() => {
          refresh();
          setSelected(null);
        }}
        onError={setError}
      />
    </>
  );
}
