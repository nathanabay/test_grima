'use client';

import { useState } from 'react';
import { Shell, PageHeader } from '@/components/Shell';
import { useApi } from '@/lib/useApi';
import { money, qty, shortDate } from '@/lib/api';
import { Card, Empty, ErrorBox, ExpiryPill, Loading, Pill, Table } from '@/components/ui';

export default function ExpiryPage() {
  const [maxDays, setMaxDays] = useState(90);
  const { data, error, loading } = useApi<any>(`/inventory/expiry?maxDays=${maxDays}`, [maxDays]);
  const redistribution = useApi<any[]>('/inventory/expiry/redistribution?withinDays=120');

  return (
    <Shell>
      <PageHeader
        title="Expiry Management"
        subtitle="Potential loss = remaining quantity × inventory cost, per batch position."
        action={
          <select
            className="input w-auto"
            value={maxDays}
            onChange={(e) => setMaxDays(Number(e.target.value))}
          >
            {[30, 60, 90, 180, 365].map((d) => (
              <option key={d} value={d}>
                Within {d} days
              </option>
            ))}
          </select>
        }
      />

      {error && <ErrorBox message={error} />}
      {loading && <Loading />}

      {data && (
        <div className="space-y-4">
          {/* The ladder comes back with the data, so the cards follow the
              configured horizons instead of a copy kept here. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {(data.buckets ?? []).map((b: any) => {
              const s = data.summary[b.key];
              return (
                <div key={b.key} className="card p-3">
                  <div className="text-xs font-medium text-ink-muted">{b.label}</div>
                  <div className="mt-0.5 text-lg font-semibold num">{s?.count ?? 0}</div>
                  <div className="text-xs text-ink-subtle num">{money(s?.value ?? 0)}</div>
                </div>
              );
            })}
          </div>

          <Card
            title="Stock at risk"
            action={
              <span className="text-sm font-medium text-danger num">
                {money(data.totalValueAtRisk)} total exposure
              </span>
            }
          >
            {data.rows.length ? (
              <Table head={['Product', 'Batch', 'Expiry', 'Days', 'Quantity', 'Potential loss', 'Warehouse']}>
                {data.rows.slice(0, 100).map((r: any, i: number) => (
                  <tr key={i}>
                    <td className="td">
                      <div className="font-medium">{r.productName}</div>
                      <div className="text-xs text-ink-subtle">{r.sku} · {r.strength}</div>
                    </td>
                    <td className="td text-ink-muted">
                      {r.batchNumber}
                      <div><Pill tone={r.batchStatus === 'RELEASED' || r.batchStatus === 'AVAILABLE' ? 'ok' : 'warn'}>{r.batchStatus}</Pill></div>
                    </td>
                    <td className="td text-ink-muted">{shortDate(r.expiryDate)}</td>
                    <td className="td"><ExpiryPill days={r.daysRemaining} /></td>
                    <td className="td num">{qty(r.quantity)} {r.unit}</td>
                    <td className="td num font-medium">{money(r.potentialLoss)}</td>
                    <td className="td text-xs text-ink-muted">{r.warehouseName}</td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty>No stock expires within {maxDays} days.</Empty>
            )}
          </Card>

          <Card
            title="Smart redistribution suggestions"
            action={<span className="text-xs text-ink-subtle">Ranked by expiry risk score</span>}
          >
            {redistribution.loading && <Loading />}
            {redistribution.data?.length ? (
              <Table head={['Risk', 'Product', 'Batch', 'Days', 'Surplus', 'Value', 'Move to']}>
                {redistribution.data.slice(0, 25).map((r: any, i: number) => (
                  <tr key={i}>
                    <td className="td">
                      <Pill tone={r.riskLevel === 'CRITICAL' ? 'danger' : r.riskLevel === 'HIGH' ? 'warn' : 'info'}>
                        {r.riskScore}
                      </Pill>
                    </td>
                    <td className="td">{r.productName}</td>
                    <td className="td text-ink-muted">{r.batchNumber}</td>
                    <td className="td num">{r.daysRemaining}</td>
                    <td className="td num">
                      {qty(r.surplusQuantity)}
                      <div className="text-xs text-ink-subtle">of {qty(r.quantityOnHand)} on hand</div>
                    </td>
                    <td className="td num">{money(r.valueAtRisk)}</td>
                    <td className="td text-xs">
                      {r.destinations.map((d: any) => (
                        <div key={d.branchId}>
                          <span className="font-medium">{d.branchName}</span>
                          <span className="text-ink-subtle">
                            {' '}— send {qty(d.suggestedTransferQty)} (uses {qty(d.avgMonthlyConsumption)}/mo)
                          </span>
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              !redistribution.loading && <Empty>No redistribution opportunities found.</Empty>
            )}
          </Card>
        </div>
      )}
    </Shell>
  );
}
