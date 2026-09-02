'use client';

import { useMemo } from 'react';
import { Shell } from '@/components/Shell';
import { PageHeader, Card, Stat, ErrorState, Loading, EmptyState } from '@/components/primitives';
import { useApi } from '@/lib/useApi';
import { api, money, qty, tokenStore, can, AuthUser } from '@/lib/api';
import { useScope } from '@/lib/scope';
import { BarChart, Table } from '@/components/ui';
import { StatusBadge, ExpiryBadge } from '@/components/status';
import { HealthScoreCard } from '@/components/HealthScore';

/**
 * Role-aware dashboards (§23).
 *
 * A pharmacist opening the morning does not want the same nine cards as the
 * finance officer. The role decides which panels appear and in what order;
 * everyone still sees only what their permissions allow, because each panel
 * reads an endpoint that scopes itself.
 */

type Persona = 'pharmacist' | 'warehouse' | 'procurement' | 'executive' | 'general';

function personaFor(user: AuthUser | null): Persona {
  const roles = user?.roles ?? [];
  if (roles.some((r) => ['PHARMACIST', 'PHARMACY_TECHNICIAN'].includes(r))) return 'pharmacist';
  if (roles.some((r) => ['WAREHOUSE_MANAGER', 'STOREKEEPER'].includes(r))) return 'warehouse';
  if (roles.includes('PROCUREMENT_OFFICER')) return 'procurement';
  if (roles.some((r) => ['SUPER_ADMIN', 'PHARMACY_ADMIN', 'BRANCH_MANAGER', 'FINANCE_OFFICER'].includes(r)))
    return 'executive';
  return 'general';
}

const PERSONA_TITLE: Record<Persona, string> = {
  pharmacist: 'Pharmacy dashboard',
  warehouse: 'Warehouse dashboard',
  procurement: 'Procurement dashboard',
  executive: 'Executive dashboard',
  general: 'Dashboard',
};

const PERSONA_SUB: Record<Persona, string> = {
  pharmacist: 'Dispensing, stock warnings and anything that would stop you handing medicine over safely.',
  warehouse: 'The work waiting on the floor, and the bins and batches behind it.',
  procurement: 'What needs ordering, what is late, and how suppliers are performing.',
  executive: 'Value, margin and the exposures worth knowing about this morning.',
  general: 'Every figure is computed live from the stock ledger. Click a card to act on it.',
};

export default function DashboardPage() {
  const user = tokenStore.user;
  const persona = personaFor(user);

  return (
    <Shell>
      <DashboardBody persona={persona} user={user} />
    </Shell>
  );
}

function DashboardBody({ persona, user }: { persona: Persona; user: AuthUser | null }) {
  const scope = useScope();
  const suffix = scope.branchId ? `?branchId=${scope.branchId}` : '';
  const { data, error, loading, refresh } = useApi<any>(`/analytics/dashboard${suffix}`, [scope.branchId]);

  return (
    <>
      <PageHeader
        title={PERSONA_TITLE[persona]}
        subtitle={PERSONA_SUB[persona]}
        action={
          scope.branch && (
            <span className="text-small text-ink-muted">
              Showing <span className="font-medium text-ink">{scope.branch.name}</span>
            </span>
          )
        }
      />

      {error && <ErrorState message={error} onRetry={refresh} />}
      {loading && !data && <Loading label="Computing" />}

      {data && (
        <div className="space-y-4">
          {persona === 'pharmacist' && <PharmacistPanels data={data} user={user} />}
          {persona === 'warehouse' && <WarehousePanels data={data} scope={scope} />}
          {persona === 'procurement' && <ProcurementPanels data={data} />}
          {(persona === 'executive' || persona === 'general') && (
            <ExecutivePanels data={data} branchId={scope.branchId} />
          )}
        </div>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- pharmacist */

function PharmacistPanels({ data, user }: { data: any; user: AuthUser | null }) {
  const queue = useApi<any>('/dispensing/prescriptions?status=VERIFIED&pageSize=8', []);
  const c = data.cards;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Awaiting dispensing" value={qty(queue.data?.total ?? 0)} href="/dispensing"
          sub="Verified prescriptions in the queue" tone={(queue.data?.total ?? 0) > 0 ? 'info' : 'neutral'} />
        <Stat label="Expiring soon" value={qty(c.nearExpiry)} tone={c.nearExpiry > 0 ? 'warn' : 'neutral'}
          sub={`${money(c.expiryValueAtRisk)} at risk`} href="/inventory/expiry" />
        <Stat label="Quarantined" value={qty(c.quarantined)} tone={c.quarantined > 0 ? 'warn' : 'neutral'}
          sub="Held pending a QA decision" href="/batches" />
        <Stat label="Under recall" value={qty(c.recalled)} tone={c.recalled > 0 ? 'danger' : 'neutral'}
          sub={c.openRecalls ? `${c.openRecalls} open recall(s)` : 'No open recall'} href="/recalls" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Dispensing queue" description="Oldest first — a prescription waiting is a patient waiting.">
          {queue.loading && <Loading />}
          {queue.data && (queue.data.data?.length ? (
            <Table head={['Prescription', 'Patient', 'Items', 'Status']}>
              {queue.data.data.slice(0, 8).map((p: any) => (
                <tr key={p.id}>
                  <td className="td num">{p.prescriptionNo}</td>
                  <td className="td">{p.patient?.fullName ?? '—'}</td>
                  <td className="td num text-right">{p.items?.length ?? 0}</td>
                  <td className="td"><StatusBadge status={p.status} /></td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState title="The queue is clear"
              body="Verified prescriptions appear here as they are approved for dispensing." />
          ))}
        </Card>

        <Card title="Stock that would stop you dispensing"
          description="Out of stock or below the reorder point, for the medicines that move.">
          {data.charts.topMovers?.length ? (
            <BarChart data={data.charts.topMovers.slice(0, 8)} labelKey="name" valueKey="quantityMoved"
              format={(v) => qty(v)} />
          ) : (
            <EmptyState title="No movement recorded yet" />
          )}
        </Card>
      </div>

      <ExpiryExposure data={data} />
    </>
  );
}

/* ----------------------------------------------------------------- warehouse */

function WarehousePanels({ data, scope }: { data: any; scope: ReturnType<typeof useScope> }) {
  const warehouseId = scope.warehouseId ?? scope.branch?.warehouses[0]?.id ?? null;
  const tasks = useApi<any>(warehouseId ? `/warehouse/tasks?warehouseId=${warehouseId}&open=true&pageSize=100` : null, [warehouseId]);
  const exceptions = useApi<any>(warehouseId ? `/warehouse/tasks/exceptions?warehouseId=${warehouseId}` : null, [warehouseId]);
  const occupancy = useApi<any>(warehouseId ? `/warehouse/occupancy?warehouseId=${warehouseId}` : null, [warehouseId]);

  const byType = useMemo(() => {
    const rows: Record<string, number> = {};
    for (const t of tasks.data?.data ?? []) rows[t.taskType] = (rows[t.taskType] ?? 0) + 1;
    return Object.entries(rows).map(([taskType, count]) => ({ taskType, count }));
  }, [tasks.data]);

  const ex = exceptions.data;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open tasks" value={qty(tasks.data?.total ?? 0)} href="/warehouse"
          sub="Put-away, picking, replenishment and moves" />
        <Stat label="Stalled over 24h" value={qty(ex?.staleTasks?.length ?? 0)}
          tone={(ex?.staleTasks?.length ?? 0) > 0 ? 'warn' : 'neutral'} href="/warehouse" />
        <Stat label="Short picks" value={qty(ex?.shortPicks?.length ?? 0)}
          tone={(ex?.shortPicks?.length ?? 0) > 0 ? 'danger' : 'neutral'}
          sub="Picked less than asked for" href="/warehouse" />
        <Stat label="Average fullness"
          value={occupancy.data?.summary?.averageOccupancyPercent === null
            ? 'Not measured'
            : `${occupancy.data?.summary?.averageOccupancyPercent ?? 0}%`}
          sub={`${occupancy.data?.summary?.empty ?? 0} empty bins`} href="/warehouse" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Work waiting, by type">
          {byType.length ? (
            <BarChart data={byType} labelKey="taskType" valueKey="count" />
          ) : (
            <EmptyState title="The floor is clear" body="No open put-away, pick or replenishment task." />
          )}
        </Card>
        <Card title="Bins over capacity" description="A bin holding more than it declares will misdirect the next put-away.">
          {ex?.overCapacityLocations?.length ? (
            <Table head={['Bin', 'Held', 'Capacity', 'Fullness']}>
              {ex.overCapacityLocations.slice(0, 8).map((l: any) => (
                <tr key={l.id}>
                  <td className="td">{l.code}</td>
                  <td className="td num text-right">{qty(l.usedUnits)}</td>
                  <td className="td num text-right">{qty(l.capacityUnits)}</td>
                  <td className="td"><StatusBadge tone="out">{l.occupancyPercent}%</StatusBadge></td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState title="Every bin is within its declared capacity" />
          )}
        </Card>
      </div>
    </>
  );
}

/* --------------------------------------------------------------- procurement */

function ProcurementPanels({ data }: { data: any }) {
  const suppliers = useApi<any>('/suppliers/performance', []);
  const c = data.cards;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Orders awaiting approval" value={qty(c.purchaseOrdersPending)}
          tone={c.purchaseOrdersPending > 0 ? 'info' : 'neutral'} href="/procurement" />
        <Stat label="Out of stock" value={qty(c.outOfStock)} tone={c.outOfStock > 0 ? 'danger' : 'neutral'}
          sub="Nothing on hand to sell or dispense" href="/inventory" />
        <Stat label="Below reorder point" value={qty(c.lowStock)} tone={c.lowStock > 0 ? 'warn' : 'neutral'}
          sub="Reorder recommendations are ready" href="/forecast" />
        <Stat label="Stock value" value={money(c.totalInventoryValue)}
          sub={`Turnover ${Number(c.stockTurnover ?? 0).toFixed(2)}×`} href="/accounting" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Supplier performance" description="Scored from delivery, rejection and short-shipment history, not from opinion.">
          {suppliers.loading && <Loading />}
          {suppliers.data?.length ? (
            <Table head={['Supplier', 'On time', 'Rejection', 'Score']}>
              {suppliers.data.slice(0, 8).map((s: any) => (
                <tr key={s.id}>
                  <td className="td">{s.companyName}</td>
                  <td className="td num text-right">{(Number(s.onTimeDeliveryRate) * 100).toFixed(0)}%</td>
                  <td className="td num text-right">{(Number(s.rejectionRate) * 100).toFixed(1)}%</td>
                  <td className="td">
                    <StatusBadge tone={Number(s.supplierScore) >= 75 ? 'available' : Number(s.supplierScore) >= 50 ? 'near' : 'out'}>
                      {Number(s.supplierScore).toFixed(0)}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState title="No supplier has been scored yet"
              body="Scores are recomputed nightly from delivery and quality history." />
          )}
        </Card>
        <Card title="Slow movers" description="Stock that is not turning. Ordering more of it costs twice.">
          {data.charts.slowMovers?.length ? (
            <BarChart data={data.charts.slowMovers.slice(0, 8)} labelKey="name" valueKey="quantityMoved"
              format={(v) => qty(v)} tone="warn" />
          ) : (
            <EmptyState title="Nothing recorded in this window" />
          )}
        </Card>
      </div>
    </>
  );
}

/* ----------------------------------------------------------------- executive */

function ExecutivePanels({ data, branchId }: { data: any; branchId: string | null }) {
  const c = data.cards;
  return (
    <>
      <HealthScoreCard branchId={branchId} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        <Stat label="Inventory value" value={money(c.totalInventoryValue)} href="/accounting"
          sub={`${qty(c.totalSkus)} active SKUs`} />
        <Stat label="Sales this month" value={money(c.salesThisMonth)} href="/reports"
          sub={`${money(c.grossProfit)} gross profit`} />
        <Stat label="Gross margin" value={`${Number(c.grossMarginPct ?? 0).toFixed(1)}%`} href="/reports" />
        <Stat label="Stock turnover" value={`${Number(c.stockTurnover ?? 0).toFixed(2)}×`} href="/reports" />
        <Stat label="Out of stock" value={qty(c.outOfStock)} tone={c.outOfStock > 0 ? 'danger' : 'neutral'} href="/command-center" />
        <Stat label="Low stock" value={qty(c.lowStock)} tone={c.lowStock > 0 ? 'warn' : 'neutral'} href="/procurement" />
        <Stat label="Expiry at risk" value={money(c.expiryValueAtRisk)} tone={c.nearExpiry > 0 ? 'warn' : 'neutral'}
          sub={`${qty(c.nearExpiry)} batch positions`} href="/inventory/expiry" />
        <Stat label="Open recalls" value={qty(c.openRecalls)} tone={c.openRecalls > 0 ? 'danger' : 'neutral'}
          sub={c.openExcursions ? `${c.openExcursions} cold-chain excursion(s)` : 'Cold chain steady'}
          href="/recalls" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Sales trend">
          {data.charts.salesTrend?.length ? (
            <BarChart data={data.charts.salesTrend} labelKey="period" valueKey="revenue" format={(v) => money(v)} />
          ) : <EmptyState title="No sales recorded yet" />}
        </Card>
        <ExpiryExposure data={data} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Fast movers (90 days)">
          <Table head={['Product', 'SKU', 'Quantity moved']}>
            {(data.charts.topMovers ?? []).map((p: any) => (
              <tr key={p.productId}>
                <td className="td">{p.name}</td>
                <td className="td text-ink-muted">{p.sku}</td>
                <td className="td num text-right">{qty(p.quantityMoved)} {p.unit}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Slow movers (90 days)">
          <Table head={['Product', 'SKU', 'Quantity moved']}>
            {(data.charts.slowMovers ?? []).map((p: any) => (
              <tr key={p.productId}>
                <td className="td">{p.name}</td>
                <td className="td text-ink-muted">{p.sku}</td>
                <td className="td num text-right">{qty(p.quantityMoved)} {p.unit}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
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

function ExpiryExposure({ data }: { data: any }) {
  const rows = (data.charts.expiryExposure ?? []).map((b: any) => ({
    ...b,
    label: BUCKET_LABELS[b.bucket] ?? b.bucket.replace(/_/g, ' ').toLowerCase(),
  }));
  return (
    <Card title="Expiry exposure" description="Value that leaves the balance sheet if nothing is done.">
      {rows.length ? (
        <BarChart data={rows} labelKey="label" valueKey="value" format={(v) => money(v)} tone="warn" />
      ) : (
        <EmptyState title="No stock is near expiry" />
      )}
    </Card>
  );
}
