"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import {
  PageHeader,
  Card,
  Stat,
  ErrorState,
  Loading,
  EmptyState,
} from "@/components/primitives";
import { useApi } from "@/lib/useApi";
import { money, qty, shortDate } from "@/lib/api";
import { useScope } from "@/lib/scope";
import { StatusBadge, ExpiryBadge, QuantityCell } from "@/components/status";
import { DataTable } from "@/components/DataTable";
import { Tabs } from "@/components/Timeline";
import { BarChart } from "@/components/ui";

/**
 * Expiry Risk Centre (§31).
 *
 * The question this screen answers is not "what expires when" but "what should
 * I do about it, and what does doing nothing cost". So every bucket carries its
 * value at risk, and every row offers the action that would save it.
 *
 * The bucket ladder comes back with the data rather than being hardcoded here,
 * because the horizons are administrator-configured. A pharmacy that watches 7
 * and 14 days sees 7- and 14-day buckets.
 */
export default function ExpiryPage() {
  return (
    <Shell>
      <ExpiryBody />
    </Shell>
  );
}

function ExpiryBody() {
  const scope = useScope();
  const [maxDays, setMaxDays] = useState(90);
  const [bucket, setBucket] = useState<string>("all");
  const [tab, setTab] = useState("risk");

  const query = new URLSearchParams({ maxDays: String(maxDays) });
  if (scope.warehouseId) query.set("warehouseId", scope.warehouseId);

  const { data, error, loading, refresh } = useApi<any>(
    `/inventory/expiry?${query}`,
    [maxDays, scope.warehouseId],
  );
  const redistribution = useApi<any[]>(
    "/inventory/expiry/redistribution?withinDays=120",
    [],
  );

  const buckets: any[] = data?.buckets ?? [];
  const rows: any[] = data?.rows ?? [];
  const shown =
    bucket === "all" ? rows : rows.filter((r) => r.bucket === bucket);

  const expiredValue = rows
    .filter((r) => r.daysRemaining < 0)
    .reduce((s, r) => s + Number(r.potentialLoss), 0);

  const summary = data?.summary ?? {};

  return (
    <>
      <PageHeader
        title="Expiry Risk Centre"
        subtitle="Potential loss is remaining quantity at inventory cost, per batch position. Every row offers the action that would save it."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="input w-auto py-1 text-small"
              value={maxDays}
              aria-label="Horizon"
              onChange={(e) => setMaxDays(Number(e.target.value))}
            >
              {[30, 60, 90, 180, 365, 3650].map((d) => (
                <option key={d} value={d}>
                  {d === 3650 ? "All stock" : `Within ${d} days`}
                </option>
              ))}
            </select>
            <button className="btn-ghost btn-sm" onClick={refresh}>
              Refresh
            </button>
          </div>
        }
      />

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "risk", label: "Risk now" },
          { key: "calendar", label: "Calendar" },
          { key: "trend", label: "What we actually lost" },
          { key: "comparison", label: "Compare" },
        ]}
      />

      {tab !== "risk" && <ExpiryTab tab={tab} />}

      {tab === "risk" && error && (
        <ErrorState message={error} onRetry={refresh} />
      )}
      {tab === "risk" && loading && !data && (
        <Loading label="Measuring exposure" />
      )}

      {tab === "risk" && data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Total at risk"
              value={money(data.totalValueAtRisk)}
              tone={data.totalValueAtRisk > 0 ? "warn" : "neutral"}
              sub={`${rows.length} batch position(s)`}
            />
            <Stat
              label="Already expired"
              value={money(expiredValue)}
              tone={expiredValue > 0 ? "danger" : "neutral"}
              sub="Cannot be sold or dispensed"
            />
            <Stat
              label="Positions in view"
              value={shown.length}
              sub={
                bucket === "all"
                  ? "Every bucket"
                  : `Bucket: ${buckets.find((b) => b.key === bucket)?.label ?? bucket}`
              }
            />
            <Stat
              label="Transfer suggestions"
              value={redistribution.data?.length ?? 0}
              tone={(redistribution.data?.length ?? 0) > 0 ? "info" : "neutral"}
              sub="Branches that would use it in time"
            />
          </div>

          {/* Buckets are the primary filter: click one to narrow the table. */}
          <Card
            title="Exposure by horizon"
            description="Click a bucket to filter the list. Horizons come from the configured expiry alert buckets, so this ladder follows your settings."
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
              <BucketTile
                label="Everything"
                count={rows.length}
                value={rows.reduce((s, r) => s + Number(r.potentialLoss), 0)}
                active={bucket === "all"}
                onClick={() => setBucket("all")}
              />
              {buckets.map((b) => {
                const s = summary[b.key];
                return (
                  <BucketTile
                    key={b.key}
                    label={b.label}
                    count={s?.count ?? 0}
                    value={s?.value ?? 0}
                    danger={b.key === "EXPIRED"}
                    active={bucket === b.key}
                    onClick={() => setBucket(bucket === b.key ? "all" : b.key)}
                  />
                );
              })}
            </div>
          </Card>

          <Card title="Stock at risk" padded={false}>
            <div className="p-4">
              {shown.length === 0 ? (
                <EmptyState
                  title={
                    rows.length === 0
                      ? "Nothing is near expiry in this horizon"
                      : "Nothing in this bucket"
                  }
                  body={
                    rows.length === 0
                      ? "Widen the horizon to look further ahead. Batch positions appear here as they approach the configured warning date."
                      : "Choose another bucket, or clear the filter to see everything."
                  }
                />
              ) : (
                <DataTable
                  rows={shown}
                  // expiryReport emits one row per InventoryBalance, which is
                  // per location — so batch + warehouse is not unique when a
                  // batch is split across bins.
                  getKey={(r: any) =>
                    `${r.batchId}-${r.warehouseId}-${r.locationId ?? "none"}`
                  }
                  pageSize={50}
                  exportName="expiry-risk"
                  viewKey="expiry"
                  searchPlaceholder="Search product, batch or warehouse"
                  rowTone={(r: any) =>
                    r.daysRemaining < 0
                      ? "danger"
                      : r.daysRemaining <= 30
                        ? "warn"
                        : null
                  }
                  columns={[
                    {
                      key: "product",
                      label: "Product",
                      sticky: true,
                      value: (r: any) => r.productName,
                      render: (r: any) => (
                        <Link
                          href={`/products/${r.productId}`}
                          className="text-brand-dark hover:underline"
                        >
                          {r.productName} {r.strength}
                        </Link>
                      ),
                    },
                    {
                      key: "sku",
                      label: "SKU",
                      optional: true,
                      value: (r: any) => r.sku,
                    },
                    {
                      key: "batch",
                      label: "Batch",
                      value: (r: any) => r.batchNumber,
                      render: (r: any) => (
                        <Link
                          href={`/batches/${r.batchId}`}
                          className="num text-brand-dark hover:underline"
                        >
                          {r.batchNumber}
                        </Link>
                      ),
                    },
                    {
                      key: "expiry",
                      label: "Expires",
                      value: (r: any) => r.expiryDate,
                      render: (r: any) => (
                        <span className="num">{shortDate(r.expiryDate)}</span>
                      ),
                    },
                    {
                      key: "days",
                      label: "Remaining",
                      numeric: true,
                      align: "right",
                      value: (r: any) => r.daysRemaining,
                      render: (r: any) => (
                        <ExpiryBadge days={r.daysRemaining} />
                      ),
                    },
                    {
                      key: "status",
                      label: "State",
                      value: (r: any) => r.batchStatus,
                      render: (r: any) => (
                        <StatusBadge status={r.batchStatus} />
                      ),
                    },
                    {
                      key: "quantity",
                      label: "Quantity",
                      numeric: true,
                      align: "right",
                      value: (r: any) => Number(r.quantity),
                      render: (r: any) => (
                        <QuantityCell value={r.quantity} unit={r.unit} />
                      ),
                    },
                    {
                      key: "loss",
                      label: "Value at risk",
                      numeric: true,
                      align: "right",
                      value: (r: any) => Number(r.potentialLoss),
                      render: (r: any) => (
                        <span
                          className={
                            Number(r.potentialLoss) > 0 ? "text-warn" : ""
                          }
                        >
                          {money(r.potentialLoss)}
                        </span>
                      ),
                    },
                    {
                      key: "warehouse",
                      label: "Warehouse",
                      value: (r: any) => r.warehouseName,
                    },
                    {
                      key: "act",
                      label: "",
                      action: true,
                      render: (r: any) =>
                        r.daysRemaining < 0 ? (
                          <Link href="/disposal" className="btn-ghost btn-sm">
                            Dispose
                          </Link>
                        ) : (
                          <Link href="/transfers" className="btn-ghost btn-sm">
                            Transfer
                          </Link>
                        ),
                    },
                  ]}
                />
              )}
            </div>
          </Card>

          <Card
            title="Where this stock would be used in time"
            description="Branches that consume fast enough to get through it before it expires. Ranked by risk saved, not by distance."
          >
            {redistribution.loading && <Loading />}
            {redistribution.data?.length ? (
              <DataTable
                rows={redistribution.data}
                getKey={(r: any) =>
                  `${r.batchId}-${r.toBranchId ?? r.suggestedBranchId}`
                }
                pageSize={15}
                exportName="expiry-redistribution"
                columns={[
                  {
                    key: "risk",
                    label: "Risk",
                    numeric: true,
                    align: "right",
                    value: (r: any) => r.riskScore,
                    render: (r: any) => (
                      <StatusBadge
                        tone={
                          r.riskScore >= 70
                            ? "out"
                            : r.riskScore >= 40
                              ? "near"
                              : "info"
                        }
                      >
                        {r.riskScore}
                      </StatusBadge>
                    ),
                  },
                  {
                    key: "product",
                    label: "Product",
                    value: (r: any) => r.productName ?? r.product,
                  },
                  {
                    key: "batch",
                    label: "Batch",
                    value: (r: any) => r.batchNumber,
                  },
                  {
                    key: "days",
                    label: "Days left",
                    numeric: true,
                    align: "right",
                    value: (r: any) => r.daysRemaining,
                    render: (r: any) => <ExpiryBadge days={r.daysRemaining} />,
                  },
                  {
                    key: "surplus",
                    label: "Surplus",
                    numeric: true,
                    align: "right",
                    value: (r: any) =>
                      Number(r.surplusQuantity ?? r.suggestedQuantity ?? 0),
                    render: (r: any) => (
                      <QuantityCell
                        value={r.surplusQuantity ?? r.suggestedQuantity}
                      />
                    ),
                  },
                  {
                    key: "value",
                    label: "Value saved",
                    numeric: true,
                    align: "right",
                    value: (r: any) => Number(r.valueAtRisk ?? 0),
                    render: (r: any) => money(r.valueAtRisk),
                  },
                  {
                    key: "to",
                    label: "Move to",
                    // The API returns a ranked `destinations` array; this column
                    // read `toBranchName`, which it has never sent, so the one
                    // actionable column on the screen always showed a dash.
                    value: (r: any) => r.destinations?.[0]?.branchName ?? "—",
                    render: (r: any) => {
                      const best = r.destinations?.[0];
                      if (!best) return "—";
                      return (
                        <div>
                          <div className="text-ink">{best.branchName}</div>
                          <div className="text-caption text-ink-subtle">
                            would use {qty(best.suggestedTransferQty)} in time
                            {r.destinations.length > 1
                              ? ` · ${r.destinations.length - 1} other option(s)`
                              : ""}
                          </div>
                        </div>
                      );
                    },
                  },
                  {
                    key: "why",
                    label: "Why",
                    optional: true,
                    value: (r: any) => r.reason ?? "",
                  },
                ]}
              />
            ) : (
              <EmptyState
                title="No transfer would help"
                body="A suggestion appears only when another branch consumes the medicine fast enough to use it before it expires. Moving stock that would expire there too costs freight and saves nothing."
              />
            )}
          </Card>
        </div>
      )}
    </>
  );
}

/** The three analytical views behind the risk list. */
function ExpiryTab({ tab }: { tab: string }) {
  if (tab === "calendar") return <CalendarPanel />;
  if (tab === "trend") return <TrendPanel />;
  return <ComparisonPanel />;
}

/**
 * When stock expires, month by month.
 *
 * The risk ladder answers "how urgent"; this answers "when", which is the
 * question a purchasing plan is built from.
 */
function CalendarPanel() {
  const scope = useScope();
  const [months, setMonths] = useState(12);
  const query = new URLSearchParams({ months: String(months) });
  if (scope.warehouseId) query.set("warehouseId", scope.warehouseId);

  const { data, error, loading, refresh } = useApi<any>(
    `/inventory/expiry/calendar?${query}`,
    [months, scope.warehouseId],
  );

  if (error) return <ErrorState message={error} onRetry={refresh} />;
  if (loading && !data) return <Loading label="Building the calendar" />;
  if (!data) return null;

  const rows: any[] = data.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat
          label="Value in the window"
          value={money(data.totalValue)}
          tone={Number(data.totalValue) > 0 ? "warn" : "neutral"}
          sub={`Next ${months} months`}
        />
        <Stat
          label="Worst month"
          value={data.peakMonth?.month ?? "—"}
          sub={
            data.peakMonth ? money(data.peakMonth.value) : "Nothing expiring"
          }
        />
        <Stat
          label="Months with exposure"
          value={rows.length}
          sub="Including anything already expired"
        />
      </div>

      <Card
        title="Expiry by month"
        description="Value is the available quantity at inventory cost. Stock already expired is shown in its own month — that is a disposal backlog, not a future risk."
        action={
          <select
            className="input w-auto py-1 text-small"
            aria-label="Horizon in months"
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
          >
            {[6, 12, 18, 24, 36].map((m) => (
              <option key={m} value={m}>
                {m} months
              </option>
            ))}
          </select>
        }
      >
        {rows.length === 0 ? (
          <EmptyState
            title="Nothing expires in this window"
            body="Widen the horizon to look further ahead."
          />
        ) : (
          <>
            <BarChart
              data={rows.map((r) => ({
                label: r.month,
                value: Number(r.value),
              }))}
              labelKey="label"
              valueKey="value"
              format={(v) => money(v)}
            />
            <div className="mt-4">
              <DataTable
                rows={rows}
                getKey={(r: any) => r.month}
                pageSize={24}
                exportName="expiry-calendar"
                searchPlaceholder="Search month"
                columns={[
                  { key: "month", label: "Month", value: (r: any) => r.month },
                  {
                    key: "batches",
                    label: "Batch positions",
                    numeric: true,
                    value: (r: any) => r.batches,
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
                    label: "Value at risk",
                    numeric: true,
                    value: (r: any) => Number(r.value),
                    render: (r: any) => money(r.value),
                  },
                  {
                    key: "state",
                    label: "State",
                    value: (r: any) =>
                      r.alreadyExpired ? "EXPIRED" : "AT_RISK",
                    render: (r: any) => (
                      <StatusBadge
                        status={r.alreadyExpired ? "EXPIRED" : "NEAR_EXPIRY"}
                      />
                    ),
                  },
                ]}
              />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

/**
 * What was actually written off, read from the ledger.
 *
 * This is history, not projection. Trending the projection would only measure
 * how the projection changed.
 */
function TrendPanel() {
  const scope = useScope();
  const [months, setMonths] = useState(12);
  const query = new URLSearchParams({ months: String(months) });
  if (scope.warehouseId) query.set("warehouseId", scope.warehouseId);

  const { data, error, loading, refresh } = useApi<any>(
    `/inventory/expiry/trend?${query}`,
    [months, scope.warehouseId],
  );

  if (error) return <ErrorState message={error} onRetry={refresh} />;
  if (loading && !data)
    return <Loading label="Reading the write-off history" />;
  if (!data) return null;

  const series: any[] = data.series ?? [];
  const worst: any[] = data.worstProducts ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat
          label="Written off"
          value={money(data.totalValue)}
          tone={Number(data.totalValue) > 0 ? "danger" : "ok"}
          sub={`Last ${months} months`}
        />
        <Stat
          label="Months with a write-off"
          value={series.length}
          sub="Expiry and disposal movements"
        />
        <Stat
          label="Products affected"
          value={worst.length}
          sub="Ranked by value lost"
        />
      </div>

      <Card
        title="Write-offs by month"
        description="Valued at the cost each movement was posted at, not today's average — restating history every time a price moves would make the trend meaningless."
        action={
          <select
            className="input w-auto py-1 text-small"
            aria-label="Period"
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
          >
            {[6, 12, 24, 36].map((m) => (
              <option key={m} value={m}>
                {m} months
              </option>
            ))}
          </select>
        }
      >
        {series.length === 0 ? (
          <EmptyState
            title="Nothing has been written off in this period"
            body="Expiry and disposal movements appear here as they are posted to the ledger."
          />
        ) : (
          <BarChart
            data={series.map((s) => ({
              label: s.month,
              value: Number(s.value),
            }))}
            labelKey="label"
            valueKey="value"
            format={(v) => money(v)}
          />
        )}
      </Card>

      {worst.length > 0 && (
        <Card title="Where the loss went" padded={false}>
          <div className="p-4">
            <DataTable
              rows={worst}
              getKey={(r: any) => r.productId}
              pageSize={20}
              exportName="expiry-losses-by-product"
              searchPlaceholder="Search product"
              columns={[
                { key: "sku", label: "SKU", value: (r: any) => r.sku },
                {
                  key: "product",
                  label: "Product",
                  value: (r: any) => r.product,
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
                  label: "Value lost",
                  numeric: true,
                  value: (r: any) => Number(r.value),
                  render: (r: any) => money(r.value),
                },
              ]}
            />
          </div>
        </Card>
      )}
    </div>
  );
}

/** Exposure compared across one dimension at a time. */
function ComparisonPanel() {
  const [dimension, setDimension] = useState<
    "branch" | "category" | "supplier"
  >("branch");
  const [withinDays, setWithinDays] = useState(180);

  const { data, error, loading, refresh } = useApi<any>(
    `/inventory/expiry/comparison?dimension=${dimension}&withinDays=${withinDays}`,
    [dimension, withinDays],
  );

  if (error) return <ErrorState message={error} onRetry={refresh} />;
  if (loading && !data) return <Loading label="Comparing exposure" />;
  if (!data) return null;

  const rows: any[] = data.rows ?? [];

  return (
    <Card
      title={`Expiry exposure by ${dimension}`}
      description="One dimension at a time: a table that crosses all three is unreadable and nobody acts on it. Value is compared rather than batch count, because counting batches ranks cheap sachets above insulin."
      action={
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input w-auto py-1 text-small"
            aria-label="Dimension"
            value={dimension}
            onChange={(e) => setDimension(e.target.value as any)}
          >
            <option value="branch">By branch</option>
            <option value="category">By category</option>
            <option value="supplier">By supplier</option>
          </select>
          <select
            className="input w-auto py-1 text-small"
            aria-label="Horizon"
            value={withinDays}
            onChange={(e) => setWithinDays(Number(e.target.value))}
          >
            {[30, 90, 180, 365].map((d) => (
              <option key={d} value={d}>
                Within {d} days
              </option>
            ))}
          </select>
        </div>
      }
      padded={false}
    >
      <div className="p-4">
        {rows.length === 0 ? (
          <EmptyState
            title="No exposure in this horizon"
            body="Widen the horizon, or switch dimension."
          />
        ) : (
          <>
            <BarChart
              data={rows
                .slice(0, 12)
                .map((r) => ({ label: r.label, value: Number(r.value) }))}
              labelKey="label"
              valueKey="value"
              format={(v) => money(v)}
            />
            <div className="mt-4">
              <DataTable
                rows={rows}
                getKey={(r: any) => r.id}
                pageSize={25}
                exportName={`expiry-by-${dimension}`}
                searchPlaceholder="Search"
                columns={[
                  {
                    key: "label",
                    label:
                      dimension === "branch"
                        ? "Branch"
                        : dimension === "category"
                          ? "Category"
                          : "Supplier",
                    sticky: true,
                    value: (r: any) => r.label,
                  },
                  {
                    key: "batches",
                    label: "Positions",
                    numeric: true,
                    value: (r: any) => r.batches,
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
                    label: "Value at risk",
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
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function BucketTile({
  label,
  count,
  value,
  active,
  danger,
  onClick,
}: {
  label: string;
  count: number;
  value: number;
  active: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded border p-2.5 text-left transition-colors duration-state
        ${active ? "border-brand bg-brand/10" : "border-border bg-surface hover:border-brand/40"}`}
    >
      <div
        className="truncate text-caption uppercase text-ink-muted"
        title={label}
      >
        {label}
      </div>
      <div
        className={`num text-lg font-semibold ${danger && count > 0 ? "text-danger" : "text-ink"}`}
      >
        {count}
      </div>
      <div className="num text-caption text-ink-muted">{money(value)}</div>
    </button>
  );
}
