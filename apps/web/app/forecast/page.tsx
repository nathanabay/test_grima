"use client";

import { useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { money, qty } from "@/lib/api";
import {
  BarChart,
  Card,
  Empty,
  ErrorBox,
  Loading,
  Pill,
  Table,
} from "@/components/ui";
import {
  Card as Panel,
  EmptyState,
  ErrorState,
  Stat,
} from "@/components/primitives";
import { DataTable } from "@/components/DataTable";

const METHODS = [
  { value: "AUTO", label: "Choose automatically" },
  { value: "MOVING_AVERAGE", label: "Moving average" },
  { value: "WEIGHTED_MOVING_AVERAGE", label: "Weighted moving average" },
  { value: "EXPONENTIAL_SMOOTHING", label: "Exponential smoothing" },
  { value: "SEASONAL_NAIVE", label: "Same month last year" },
];

/**
 * Demand forecasting (§39).
 *
 * Shows the history the forecast was built from, which method was used and
 * why, every alternative side by side, and the arithmetic behind the reorder
 * suggestion. §39 forbids hiding that logic, so none of it is collapsed away.
 */
export default function ForecastPage() {
  const [productId, setProductId] = useState<string | null>(null);
  const [method, setMethod] = useState("AUTO");
  const [months, setMonths] = useState(12);

  const top = useApi<any[]>("/analytics/forecast?limit=25&months=12");
  const detail = useApi<any>(
    productId
      ? `/analytics/forecast/${productId}?method=${method}&months=${months}&horizon=3`
      : null,
    [productId, method, months],
  );

  return (
    <Shell>
      <PageHeader
        title="Demand Forecasting"
        subtitle="Every forecast shows its history, its method and the reasoning behind the suggested order quantity."
      />

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2" title="Highest-moving products">
          {top.loading && <Loading label="Forecasting" />}
          {top.error && <ErrorBox message={top.error} />}
          {top.data?.length ? (
            <div className="max-h-[70vh] space-y-1 overflow-y-auto">
              {top.data.map((r) => (
                <button
                  key={r.productId}
                  onClick={() => setProductId(r.productId)}
                  className={`w-full rounded-md border p-2 text-left text-sm ${productId === r.productId ? "border-brand bg-brand-light" : "border-transparent hover:bg-surface-sunken"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{r.name}</span>
                    {r.shouldReorder && <Pill tone="warn">reorder</Pill>}
                  </div>
                  <div className="text-xs text-ink-subtle">
                    {r.historicalMonthly}/mo historical · forecast {r.forecast}{" "}
                    · cover{" "}
                    {r.monthsOfCover === null ? "—" : `${r.monthsOfCover}mo`}
                  </div>
                  {r.dataWarning && (
                    <div className="mt-0.5 text-xs text-warn">
                      {r.dataWarning.slice(0, 60)}...
                    </div>
                  )}
                </button>
              ))}
            </div>
          ) : (
            !top.loading && <Empty>No movement history to forecast from.</Empty>
          )}
        </Card>

        <div className="lg:col-span-3">
          {!productId && (
            <Card>
              <Empty>Select a product to see its forecast.</Empty>
            </Card>
          )}
          {detail.loading && <Loading label="Computing" />}
          {detail.error && <ErrorBox message={detail.error} />}

          {detail.data && (
            <div className="space-y-4">
              <Card
                title={`${detail.data.product.genericName} ${detail.data.product.strength}`}
                action={
                  <div className="flex gap-1">
                    <select
                      className="input text-xs"
                      value={method}
                      onChange={(e) => setMethod(e.target.value)}
                    >
                      {METHODS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    <select
                      className="input text-xs"
                      value={months}
                      onChange={(e) => setMonths(Number(e.target.value))}
                    >
                      {[6, 12, 24].map((m) => (
                        <option key={m} value={m}>
                          {m} months
                        </option>
                      ))}
                    </select>
                  </div>
                }
              >
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-md bg-surface-sunken p-3">
                    <div className="text-xs text-ink-muted">
                      Forecast / month
                    </div>
                    <div className="text-lg font-semibold num">
                      {qty(detail.data.forecast)}
                    </div>
                    <div className="text-xs text-ink-subtle num">
                      {qty(detail.data.confidenceLow)}–
                      {qty(detail.data.confidenceHigh)}
                    </div>
                  </div>
                  <div className="rounded-md bg-surface-sunken p-3">
                    <div className="text-xs text-ink-muted">Available</div>
                    <div className="text-lg font-semibold num">
                      {qty(detail.data.position.available)}
                    </div>
                  </div>
                  <div className="rounded-md bg-surface-sunken p-3">
                    <div className="text-xs text-ink-muted">
                      Months of cover
                    </div>
                    <div className="text-lg font-semibold num">
                      {detail.data.position.monthsOfCover ?? "—"}
                    </div>
                  </div>
                  <div
                    className={`rounded-md p-3 ${detail.data.replenishment.shouldReorder ? "bg-warn-light" : "bg-surface-sunken"}`}
                  >
                    <div className="text-xs text-ink-muted">
                      Suggested order
                    </div>
                    <div className="text-lg font-semibold num">
                      {qty(detail.data.replenishment.suggestedQuantity)}
                    </div>
                    <div className="text-xs text-ink-subtle">
                      {money(detail.data.replenishment.estimatedCost)}
                    </div>
                  </div>
                </div>

                <div className="mt-3 rounded-md bg-info-light px-3 py-2 text-xs text-info">
                  <strong>{detail.data.method.replace(/_/g, " ")}:</strong>{" "}
                  {detail.data.methodRationale}
                </div>

                {detail.data.dataQuality.warning && (
                  <div className="mt-2 rounded-md bg-warn-light px-3 py-2 text-xs text-warn">
                    {detail.data.dataQuality.warning}
                  </div>
                )}
              </Card>

              <Card title="History used">
                <BarChart
                  data={detail.data.history.map((h: any) => ({
                    label: `${h.period}${h.stockOut ? " *" : ""}`,
                    quantity: h.quantity,
                  }))}
                  labelKey="label"
                  valueKey="quantity"
                  format={(v) => qty(v)}
                />
                {detail.data.dataQuality.stockOutMonths > 0 && (
                  <p className="mt-2 text-xs text-ink-subtle">
                    * month included a stock-out, so recorded demand is lower
                    than real demand.
                  </p>
                )}
              </Card>

              <div className="grid gap-4 sm:grid-cols-2">
                <Card title="Every method, side by side">
                  <Table head={["Method", "Forecast", "Band"]}>
                    {detail.data.comparison.map((c: any) => (
                      <tr
                        key={c.method}
                        className={c.selected ? "bg-brand-light" : ""}
                      >
                        <td className="td text-xs">
                          {c.selected && (
                            <span className="mr-1 font-bold text-brand-dark">
                              ›
                            </span>
                          )}
                          {c.method.replace(/_/g, " ").toLowerCase()}
                        </td>
                        <td className="td num font-medium">
                          {qty(c.forecast)}
                        </td>
                        <td className="td num text-xs text-ink-muted">
                          {qty(c.confidenceLow)}–{qty(c.confidenceHigh)}
                        </td>
                      </tr>
                    ))}
                  </Table>
                </Card>

                <Card title="Projection">
                  <Table head={["Period", "Forecast", "Range"]}>
                    {detail.data.projection.map((p: any) => (
                      <tr key={p.period}>
                        <td className="td">{p.period}</td>
                        <td className="td num font-medium">
                          {qty(p.forecast)}
                        </td>
                        <td className="td num text-xs text-ink-muted">
                          {qty(p.low)}–{qty(p.high)}
                        </td>
                      </tr>
                    ))}
                  </Table>
                  <p className="mt-2 text-xs text-ink-subtle">
                    The band widens each period: confidence does not hold steady
                    months out.
                  </p>
                </Card>
              </div>

              <Card title="How the order quantity was reached">
                <p className="text-sm text-ink-muted">
                  {detail.data.replenishment.explanation}
                </p>
              </Card>

              <Accuracy productId={productId!} />
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}

/**
 * How good the forecast has actually been (§39: feature 852).
 *
 * A walk-forward backtest: for every month with enough history behind it, each
 * method is run on the months before it and compared with what really happened.
 * Scoring a forecast against the data it was fitted on always looks excellent
 * and means nothing.
 */
function Accuracy({ productId }: { productId: string }) {
  const { data, error, loading, refresh } = useApi<any>(
    `/analytics/forecast/${productId}/accuracy?months=24`,
    [productId],
  );

  if (error) return <ErrorState message={error} onRetry={refresh} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;

  if (!data.methods?.length) {
    return (
      <Panel title="Forecast accuracy">
        <EmptyState
          title="Not enough history to score a forecast"
          body={data.message}
        />
      </Panel>
    );
  }

  return (
    <Panel
      title="Forecast accuracy"
      description="Measured against what actually happened. Months the product was out of stock are excluded — a forecast should not be marked down for being right about demand nobody could buy."
      padded={false}
    >
      <div className="p-4">
        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat
            label="Best method"
            value={data.bestMethod?.method?.replace(/_/g, " ") ?? "n/a"}
            sub={
              data.bestMethod
                ? `${data.bestMethod.mapePercent}% average error`
                : "No scoreable month"
            }
          />
          <Stat
            label="Months scored"
            value={data.evaluatedPoints}
            sub={`Out of ${data.months} read`}
          />
          <Stat
            label="Minimum history"
            value={data.minHistory}
            sub="Months before the first score"
          />
        </div>

        <DataTable
          rows={data.methods}
          getKey={(m: any) => m.method}
          pageSize={10}
          exportName="forecast-accuracy"
          searchPlaceholder="Search method"
          columns={[
            {
              key: "method",
              label: "Method",
              value: (m: any) => m.method,
              render: (m: any) =>
                m.method
                  .replace(/_/g, " ")
                  .toLowerCase()
                  .replace(/^./, (c: string) => c.toUpperCase()),
            },
            {
              key: "mapePercent",
              label: "Average error",
              numeric: true,
              value: (m: any) => m.mapePercent ?? Number.MAX_SAFE_INTEGER,
              render: (m: any) =>
                m.mapePercent === null ? "not scoreable" : `${m.mapePercent}%`,
            },
            {
              key: "meanAbsoluteError",
              label: "Units out",
              numeric: true,
              value: (m: any) => m.meanAbsoluteError ?? 0,
              render: (m: any) =>
                m.meanAbsoluteError === null ? "-" : qty(m.meanAbsoluteError),
            },
            {
              key: "bias",
              label: "Bias",
              numeric: true,
              value: (m: any) => m.bias ?? 0,
              render: (m: any) =>
                m.bias === null ? (
                  "-"
                ) : (
                  <span
                    title={
                      Number(m.bias) > 0
                        ? "Runs high: shows up as overstocking"
                        : "Runs low: shows up as stock-outs"
                    }
                  >
                    {Number(m.bias) > 0 ? "+" : ""}
                    {m.bias}
                  </span>
                ),
            },
            {
              key: "zeroDemandMonths",
              label: "Zero-demand months",
              numeric: true,
              optional: true,
              value: (m: any) => m.zeroDemandMonths,
            },
            {
              key: "stockOutMonthsSkipped",
              label: "Stock-out months skipped",
              numeric: true,
              optional: true,
              value: (m: any) => m.stockOutMonthsSkipped,
            },
          ]}
        />
      </div>
    </Panel>
  );
}
