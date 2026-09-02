'use client';

import Link from 'next/link';
import { Shell, PageHeader } from '@/components/Shell';
import { useApi } from '@/lib/useApi';
import { money, qty } from '@/lib/api';
import { BarChart, Card, ErrorBox, Loading, Pill, Stat, Table } from '@/components/ui';

/** Band colour, so the number reads the same way everywhere it appears. */
const BAND_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'brand' | 'neutral'> = {
  EXCELLENT: 'ok',
  GOOD: 'ok',
  ATTENTION_REQUIRED: 'warn',
  HIGH_RISK: 'danger',
  CRITICAL: 'danger',
};

function scoreColour(score: number) {
  if (score >= 75) return 'text-ok';
  if (score >= 60) return 'text-warn';
  return 'text-danger';
}

function HealthScoreCard() {
  const { data, error, loading } = useApi<any>('/analytics/health-score');

  if (loading) return <Loading label="Scoring inventory health" />;
  if (error) return <ErrorBox message={error} />;
  if (!data) return null;

  return (
    <Card
      title="Inventory health"
      action={
        <span className="text-xs text-ink-subtle">
          Computed {new Date(data.computedAt).toLocaleString()}
        </span>
      }
    >
      <div className="flex flex-wrap items-center gap-6">
        <div>
          <div className={`text-4xl font-semibold num ${scoreColour(data.score)}`}>{data.score}</div>
          <div className="text-xs text-ink-subtle">out of 100</div>
        </div>
        <div className="min-w-0 flex-1">
          <Pill tone={BAND_TONE[data.band] ?? 'neutral'}>{data.band.replace(/_/g, ' ')}</Pill>
          <p className="mt-1 text-sm text-ink-muted">{data.summary}</p>
          {data.unmeasured.length > 0 && (
            // A factor with nothing to measure is named rather than counted as
            // zero, which would damn a score for data that does not exist yet.
            <p className="mt-1 text-xs text-ink-subtle">
              Not measured, and left out of the average: {data.unmeasured.join(', ')}.
            </p>
          )}
        </div>
      </div>

      {data.priorityActions.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-medium text-ink">What would move the number most</div>
          <ul className="mt-1 space-y-1">
            {data.priorityActions.map((a: any) => (
              <li key={a.factor} className="text-xs text-ink-muted">
                <Link className="text-brand-dark underline" href={a.linkUrl}>
                  {a.factor}
                </Link>{' '}
                — {a.action}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 space-y-1.5">
        {data.factors.map((f: any) => (
          <div key={f.key} className="flex flex-wrap items-center gap-3 text-xs">
            <Link href={f.linkUrl} className="w-44 shrink-0 truncate text-ink-muted hover:underline">
              {f.label}
            </Link>
            <span className="h-3 flex-1 overflow-hidden rounded bg-surface-sunken">
              {f.score >= 0 && (
                <span
                  className={`block h-full rounded ${f.score >= 75 ? 'bg-ok' : f.score >= 60 ? 'bg-warn' : 'bg-danger'}`}
                  style={{ width: `${Math.max(2, f.score)}%` }}
                />
              )}
            </span>
            <span className="w-14 shrink-0 text-right num text-ink">
              {f.score >= 0 ? `${f.score}/100` : 'n/a'}
            </span>
            <span className="w-full text-ink-subtle sm:w-auto sm:flex-[2] sm:truncate" title={f.measurement}>
              {f.measurement}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

const BUCKET_LABELS: Record<string, string> = {
  EXPIRED: 'Expired',
  DAYS_0_30: '0-30 days',
  DAYS_31_60: '31-60 days',
  DAYS_61_90: '61-90 days',
  DAYS_91_180: '91-180 days',
  DAYS_181_365: '181-365 days',
  OVER_365: 'Over 365 days',
};

export default function DashboardPage() {
  const { data, error, loading } = useApi<any>('/analytics/dashboard');

  return (
    <Shell>
      <PageHeader
        title="Dashboard"
        subtitle="Every figure is computed live from the stock ledger. Click a card to act on it."
      />

      {error && <ErrorBox message={error} />}
      {loading && <Loading label="Computing" />}

      <div className="mb-5">
        <HealthScoreCard />
      </div>

      {data && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            <Stat label="Inventory value" value={money(data.cards.totalInventoryValue)} href="/inventory" />
            <Stat label="Active SKUs" value={qty(data.cards.totalSkus)} href="/inventory" />
            <Stat
              label="Near expiry"
              value={qty(data.cards.nearExpiry)}
              tone={data.cards.nearExpiry > 0 ? 'warn' : 'neutral'}
              sub={`${money(data.cards.expiryValueAtRisk)} at risk`}
              href="/inventory/expiry"
            />
            <Stat
              label="Expired"
              value={qty(data.cards.expired)}
              tone={data.cards.expired > 0 ? 'danger' : 'neutral'}
              href="/inventory/expiry"
            />
            <Stat
              label="Out of stock"
              value={qty(data.cards.outOfStock)}
              tone={data.cards.outOfStock > 0 ? 'danger' : 'neutral'}
              href="/command-center"
            />
            <Stat
              label="Low stock"
              value={qty(data.cards.lowStock)}
              tone={data.cards.lowStock > 0 ? 'warn' : 'neutral'}
              href="/procurement"
            />
            <Stat
              label="Quarantined"
              value={qty(data.cards.quarantined)}
              tone={data.cards.quarantined > 0 ? 'warn' : 'neutral'}
              href="/batches?status=QUARANTINED"
            />
            <Stat
              label="Recalled batches"
              value={qty(data.cards.recalled)}
              tone={data.cards.recalled > 0 ? 'danger' : 'neutral'}
              href="/recalls"
            />
            <Stat label="Sales today" value={money(data.cards.salesToday)} sub={`${data.cards.salesTodayCount} transactions`} />
            <Stat label="Sales this month" value={money(data.cards.salesThisMonth)} />
            <Stat
              label="Gross profit (month)"
              value={money(data.cards.grossProfit)}
              sub={`${data.cards.grossMarginPct}% margin`}
            />
            <Stat
              label="Pending approvals"
              value={qty(data.cards.purchaseOrdersPending)}
              href="/procurement"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Expiry exposure by bucket">
              <BarChart
                data={data.charts.expiryExposure.map((b: any) => ({
                  ...b,
                  label: BUCKET_LABELS[b.bucket] ?? b.bucket,
                }))}
                labelKey="label"
                valueKey="value"
                format={(v) => money(v)}
              />
            </Card>

            <Card title="Sales trend (30 days)">
              {data.charts.salesTrend.length ? (
                <BarChart
                  data={data.charts.salesTrend.slice(-14)}
                  labelKey="date"
                  valueKey="revenue"
                  format={(v) => money(v)}
                />
              ) : (
                <p className="text-sm text-ink-subtle">No sales recorded in the last 30 days.</p>
              )}
            </Card>

            <Card title="Fast-moving products (90 days)">
              <Table head={['Product', 'SKU', 'Quantity moved']}>
                {data.charts.topMovers.map((p: any) => (
                  <tr key={p.productId}>
                    <td className="td">{p.name}</td>
                    <td className="td text-ink-muted">{p.sku}</td>
                    <td className="td num">{qty(p.quantityMoved)} {p.unit}</td>
                  </tr>
                ))}
              </Table>
            </Card>

            <Card title="Slow-moving products (90 days)">
              <Table head={['Product', 'SKU', 'Quantity moved']}>
                {data.charts.slowMovers.map((p: any) => (
                  <tr key={p.productId}>
                    <td className="td">{p.name}</td>
                    <td className="td text-ink-muted">{p.sku}</td>
                    <td className="td num">{qty(p.quantityMoved)} {p.unit}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          </div>
        </div>
      )}
    </Shell>
  );
}
