'use client';

import Link from 'next/link';
import { Shell, PageHeader } from '@/components/Shell';
import { useApi } from '@/lib/useApi';
import { money, qty } from '@/lib/api';
import { Card, ErrorBox, Empty, Loading, Severity, Table } from '@/components/ui';

export default function CommandCenterPage() {
  const { data, error, loading, refresh } = useApi<any>('/analytics/command-center');

  return (
    <Shell>
      <PageHeader
        title="Inventory Command Center"
        subtitle="Everything that needs a decision, ranked by severity and financial impact."
        action={
          <button className="btn-ghost" onClick={refresh}>
            Refresh
          </button>
        }
      />

      {error && <ErrorBox message={error} />}
      {loading && <Loading />}

      {data && (
        <div className="space-y-4">
          <Card title={`Critical stockouts (${data.criticalStockouts.length})`}>
            {data.criticalStockouts.length ? (
              <Table head={['Severity', 'Product', 'On hand', 'Reorder level', 'Recommended action']}>
                {data.criticalStockouts.map((r: any, i: number) => (
                  <tr key={i}>
                    <td className="td"><Severity level={r.severity} /></td>
                    <td className="td">{r.product}<div className="text-xs text-ink-subtle">{r.sku}</div></td>
                    <td className="td num">{qty(r.onHand)}</td>
                    <td className="td num text-ink-muted">{qty(r.reorderLevel)}</td>
                    <td className="td text-ink-muted">{r.recommendedAction}</td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty>No products are below their reorder level.</Empty>
            )}
          </Card>

          <Card title={`Expiry risks (${data.expiryRisks.length})`}>
            {data.expiryRisks.length ? (
              <Table head={['Severity', 'Product', 'Batch', 'Days left', 'Quantity', 'Value at risk', 'Action']}>
                {data.expiryRisks.map((r: any, i: number) => (
                  <tr key={i}>
                    <td className="td"><Severity level={r.severity} /></td>
                    <td className="td">{r.product}<div className="text-xs text-ink-subtle">{r.warehouse}</div></td>
                    <td className="td text-ink-muted">{r.batch}</td>
                    <td className="td num">{r.daysRemaining}</td>
                    <td className="td num">{qty(r.quantity)}</td>
                    <td className="td num">{money(r.financialImpact)}</td>
                    <td className="td text-ink-muted">{r.recommendedAction}</td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty>No stock is approaching expiry.</Empty>
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={`Cold chain alerts (${data.coldChainAlerts.length})`}>
              {data.coldChainAlerts.length ? (
                <Table head={['Sensor', 'Duration', 'Range', 'Affected', 'Action']}>
                  {data.coldChainAlerts.map((r: any) => (
                    <tr key={r.excursionId}>
                      <td className="td">{r.sensor}<div className="text-xs text-ink-subtle">{r.excursionNo}</div></td>
                      <td className="td num">{r.durationMinutes} min</td>
                      <td className="td text-ink-muted">{r.range}</td>
                      <td className="td num">{r.affectedBatches} batches / {qty(r.affectedQuantity)}</td>
                      <td className="td text-ink-muted">{r.recommendedAction}</td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Empty>All cold-chain sensors are in range.</Empty>
              )}
            </Card>

            <Card title={`Active recalls (${data.recalls.length})`}>
              {data.recalls.length ? (
                <Table head={['Recall', 'Pending tasks', 'Action']}>
                  {data.recalls.map((r: any) => (
                    <tr key={r.recallId}>
                      <td className="td">
                        <Link className="text-brand-dark underline" href={`/recalls?id=${r.recallId}`}>
                          {r.recallNo}
                        </Link>
                        <div className="text-xs text-ink-subtle">{r.reason.slice(0, 60)}</div>
                      </td>
                      <td className="td num">{r.pendingTasks}</td>
                      <td className="td text-ink-muted">{r.recommendedAction}</td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Empty>No active recalls.</Empty>
              )}
            </Card>

            <Card title={`Quarantined inventory (${data.quarantinedInventory.length})`}>
              {data.quarantinedInventory.length ? (
                <Table head={['Product', 'Batch', 'Reason', 'Quantity', 'Value']}>
                  {data.quarantinedInventory.slice(0, 12).map((r: any) => (
                    <tr key={r.batchId}>
                      <td className="td">{r.product}</td>
                      <td className="td text-ink-muted">{r.batch}</td>
                      <td className="td text-ink-muted">{r.reason ?? '-'}</td>
                      <td className="td num">{qty(r.quantity)}</td>
                      <td className="td num">{money(r.financialImpact)}</td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Empty>Nothing is in quarantine.</Empty>
              )}
            </Card>

            <Card title={`Pending approvals (${data.pendingApprovals.length})`}>
              {data.pendingApprovals.length ? (
                <Table head={['Document', 'Status', 'Value', 'Waiting']}>
                  {data.pendingApprovals.map((r: any) => (
                    <tr key={r.documentId}>
                      <td className="td">{r.reference}</td>
                      <td className="td text-ink-muted">{r.status}</td>
                      <td className="td num">{money(r.financialImpact)}</td>
                      <td className="td num">{r.waitingDays}d</td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Empty>Nothing is waiting for approval.</Empty>
              )}
            </Card>

            <Card title={`Supplier delays (${data.supplierDelays.length})`}>
              {data.supplierDelays.length ? (
                <Table head={['PO', 'Supplier', 'Days late', 'Value']}>
                  {data.supplierDelays.map((r: any, i: number) => (
                    <tr key={i}>
                      <td className="td">{r.poNo}</td>
                      <td className="td">{r.supplier}</td>
                      <td className="td num text-danger">{r.daysLate}</td>
                      <td className="td num">{money(r.financialImpact)}</td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Empty>No overdue purchase orders.</Empty>
              )}
            </Card>
          </div>
        </div>
      )}
    </Shell>
  );
}
