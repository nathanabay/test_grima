'use client';

import { Shell, PageHeader } from '@/components/Shell';
import { useApi } from '@/lib/useApi';
import { money, qty } from '@/lib/api';
import { BarChart, Card, ErrorBox, Loading, Stat, Table } from '@/components/ui';

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
