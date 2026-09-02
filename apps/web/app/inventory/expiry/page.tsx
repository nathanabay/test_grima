'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { PageHeader, Card, Stat, ErrorState, Loading, EmptyState } from '@/components/primitives';
import { useApi } from '@/lib/useApi';
import { money, qty, shortDate } from '@/lib/api';
import { useScope } from '@/lib/scope';
import { StatusBadge, ExpiryBadge, QuantityCell } from '@/components/status';
import { DataTable } from '@/components/DataTable';

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
  const [bucket, setBucket] = useState<string>('all');

  const query = new URLSearchParams({ maxDays: String(maxDays) });
  if (scope.warehouseId) query.set('warehouseId', scope.warehouseId);

  const { data, error, loading, refresh } = useApi<any>(
    `/inventory/expiry?${query}`,
    [maxDays, scope.warehouseId],
  );
  const redistribution = useApi<any[]>('/inventory/expiry/redistribution?withinDays=120', []);

  const buckets: any[] = data?.buckets ?? [];
  const rows: any[] = data?.rows ?? [];
  const shown = bucket === 'all' ? rows : rows.filter((r) => r.bucket === bucket);

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
                  {d === 3650 ? 'All stock' : `Within ${d} days`}
                </option>
              ))}
            </select>
            <button className="btn-ghost btn-sm" onClick={refresh}>Refresh</button>
          </div>
        }
      />

      {error && <ErrorState message={error} onRetry={refresh} />}
      {loading && !data && <Loading label="Measuring exposure" />}

      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total at risk" value={money(data.totalValueAtRisk)}
              tone={data.totalValueAtRisk > 0 ? 'warn' : 'neutral'}
              sub={`${rows.length} batch position(s)`} />
            <Stat label="Already expired" value={money(expiredValue)}
              tone={expiredValue > 0 ? 'danger' : 'neutral'}
              sub="Cannot be sold or dispensed" />
            <Stat label="Positions in view" value={shown.length}
              sub={bucket === 'all' ? 'Every bucket' : `Bucket: ${buckets.find((b) => b.key === bucket)?.label ?? bucket}`} />
            <Stat label="Transfer suggestions" value={redistribution.data?.length ?? 0}
              tone={(redistribution.data?.length ?? 0) > 0 ? 'info' : 'neutral'}
              sub="Branches that would use it in time" />
          </div>

          {/* Buckets are the primary filter: click one to narrow the table. */}
          <Card title="Exposure by horizon"
            description="Click a bucket to filter the list. Horizons come from the configured expiry alert buckets, so this ladder follows your settings.">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
              <BucketTile
                label="Everything" count={rows.length}
                value={rows.reduce((s, r) => s + Number(r.potentialLoss), 0)}
                active={bucket === 'all'} onClick={() => setBucket('all')}
              />
              {buckets.map((b) => {
                const s = summary[b.key];
                return (
                  <BucketTile
                    key={b.key}
                    label={b.label}
                    count={s?.count ?? 0}
                    value={s?.value ?? 0}
                    danger={b.key === 'EXPIRED'}
                    active={bucket === b.key}
                    onClick={() => setBucket(bucket === b.key ? 'all' : b.key)}
                  />
                );
              })}
            </div>
          </Card>

          <Card title="Stock at risk" padded={false}>
            <div className="p-4">
              {shown.length === 0 ? (
                <EmptyState
                  title={rows.length === 0 ? 'Nothing is near expiry in this horizon' : 'Nothing in this bucket'}
                  body={
                    rows.length === 0
                      ? 'Widen the horizon to look further ahead. Batch positions appear here as they approach the configured warning date.'
                      : 'Choose another bucket, or clear the filter to see everything.'
                  }
                />
              ) : (
                <DataTable
                  rows={shown}
                  getKey={(r: any) => `${r.batchId}-${r.warehouseId}`}
                  pageSize={50}
                  exportName="expiry-risk"
                  viewKey="expiry"
                  searchPlaceholder="Search product, batch or warehouse"
                  rowTone={(r: any) => (r.daysRemaining < 0 ? 'danger' : r.daysRemaining <= 30 ? 'warn' : null)}
                  columns={[
                    {
                      key: 'product', label: 'Product', sticky: true,
                      value: (r: any) => r.productName,
                      render: (r: any) => (
                        <Link href={`/products/${r.productId}`} className="text-brand-dark hover:underline">
                          {r.productName} {r.strength}
                        </Link>
                      ),
                    },
                    { key: 'sku', label: 'SKU', optional: true, value: (r: any) => r.sku },
                    {
                      key: 'batch', label: 'Batch', value: (r: any) => r.batchNumber,
                      render: (r: any) => (
                        <Link href={`/batches/${r.batchId}`} className="num text-brand-dark hover:underline">
                          {r.batchNumber}
                        </Link>
                      ),
                    },
                    {
                      key: 'expiry', label: 'Expires', value: (r: any) => r.expiryDate,
                      render: (r: any) => <span className="num">{shortDate(r.expiryDate)}</span>,
                    },
                    {
                      key: 'days', label: 'Remaining', numeric: true, align: 'right',
                      value: (r: any) => r.daysRemaining,
                      render: (r: any) => <ExpiryBadge days={r.daysRemaining} />,
                    },
                    {
                      key: 'status', label: 'State', value: (r: any) => r.batchStatus,
                      render: (r: any) => <StatusBadge status={r.batchStatus} />,
                    },
                    {
                      key: 'quantity', label: 'Quantity', numeric: true, align: 'right',
                      value: (r: any) => Number(r.quantity),
                      render: (r: any) => <QuantityCell value={r.quantity} unit={r.unit} />,
                    },
                    {
                      key: 'loss', label: 'Value at risk', numeric: true, align: 'right',
                      value: (r: any) => Number(r.potentialLoss),
                      render: (r: any) => (
                        <span className={Number(r.potentialLoss) > 0 ? 'text-warn' : ''}>
                          {money(r.potentialLoss)}
                        </span>
                      ),
                    },
                    { key: 'warehouse', label: 'Warehouse', value: (r: any) => r.warehouseName },
                    {
                      key: 'act', label: '', action: true,
                      render: (r: any) =>
                        r.daysRemaining < 0 ? (
                          <Link href="/disposal" className="btn-ghost btn-sm">Dispose</Link>
                        ) : (
                          <Link href="/transfers" className="btn-ghost btn-sm">Transfer</Link>
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
                getKey={(r: any) => `${r.batchId}-${r.toBranchId ?? r.suggestedBranchId}`}
                pageSize={15}
                exportName="expiry-redistribution"
                columns={[
                  {
                    key: 'risk', label: 'Risk', numeric: true, align: 'right',
                    value: (r: any) => r.riskScore,
                    render: (r: any) => (
                      <StatusBadge tone={r.riskScore >= 70 ? 'out' : r.riskScore >= 40 ? 'near' : 'info'}>
                        {r.riskScore}
                      </StatusBadge>
                    ),
                  },
                  { key: 'product', label: 'Product', value: (r: any) => r.productName ?? r.product },
                  { key: 'batch', label: 'Batch', value: (r: any) => r.batchNumber },
                  {
                    key: 'days', label: 'Days left', numeric: true, align: 'right',
                    value: (r: any) => r.daysRemaining,
                    render: (r: any) => <ExpiryBadge days={r.daysRemaining} />,
                  },
                  {
                    key: 'surplus', label: 'Surplus', numeric: true, align: 'right',
                    value: (r: any) => Number(r.surplusQuantity ?? r.suggestedQuantity ?? 0),
                    render: (r: any) => <QuantityCell value={r.surplusQuantity ?? r.suggestedQuantity} />,
                  },
                  {
                    key: 'value', label: 'Value saved', numeric: true, align: 'right',
                    value: (r: any) => Number(r.valueAtRisk ?? 0),
                    render: (r: any) => money(r.valueAtRisk),
                  },
                  { key: 'to', label: 'Move to', value: (r: any) => r.toBranchName ?? r.suggestedBranchName ?? '—' },
                  { key: 'why', label: 'Why', optional: true, value: (r: any) => r.reason ?? '' },
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

function BucketTile({
  label, count, value, active, danger, onClick,
}: {
  label: string; count: number; value: number; active: boolean; danger?: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded border p-2.5 text-left transition-colors duration-state
        ${active ? 'border-brand bg-brand/10' : 'border-border bg-surface hover:border-brand/40'}`}
    >
      <div className="truncate text-caption uppercase text-ink-muted" title={label}>{label}</div>
      <div className={`num text-lg font-semibold ${danger && count > 0 ? 'text-danger' : 'text-ink'}`}>
        {count}
      </div>
      <div className="num text-caption text-ink-subtle">{money(value)}</div>
    </button>
  );
}
