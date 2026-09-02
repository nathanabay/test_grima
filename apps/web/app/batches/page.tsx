'use client';

import { useState } from 'react';
import { Shell, PageHeader } from '@/components/Shell';
import { useApi } from '@/lib/useApi';
import { api, can, qty, shortDate, tokenStore } from '@/lib/api';
import { BatchStatus, Card, Empty, ErrorBox, Loading, Table } from '@/components/ui';

const QUARANTINE_REASONS = [
  'QUALITY_INVESTIGATION',
  'DAMAGED_PACKAGING',
  'TEMPERATURE_EXCURSION',
  'SUSPECTED_COUNTERFEIT',
  'RECALL',
  'DOCUMENTATION_ISSUE',
  'SHORT_SHELF_LIFE',
  'REGULATORY_HOLD',
];

export default function BatchesPage() {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const user = typeof window !== 'undefined' ? tokenStore.user : null;
  const canRelease = can(user, 'quality.quarantine.APPROVE');
  const canQuarantine = can(user, 'quality.quarantine.CREATE');

  const { data, error: loadError, loading, refresh } = useApi<any>(
    `/inventory/batches?pageSize=50${status ? `&status=${status}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`,
    [status, search],
  );

  async function act(batchId: string, action: 'release' | 'quarantine') {
    setError(null);
    setMessage(null);
    const reason =
      action === 'release'
        ? window.prompt('Release reason (recorded in the audit trail):', 'Certificate of analysis reviewed')
        : window.prompt('Quarantine reason (recorded in the audit trail):', 'Quality investigation');
    if (!reason) return;

    let quarantineReason = 'QUALITY_INVESTIGATION';
    if (action === 'quarantine') {
      const chosen = window.prompt(
        `Quarantine category — one of:\n${QUARANTINE_REASONS.join('\n')}`,
        'QUALITY_INVESTIGATION',
      );
      if (!chosen) return;
      quarantineReason = chosen;
    }

    setBusy(batchId);
    try {
      await api(`/inventory/batches/${batchId}/${action}`, {
        method: 'POST',
        body: action === 'release' ? { reason } : { reason, quarantineReason },
      });
      setMessage(`Batch ${action === 'release' ? 'released — now allocatable by FEFO' : 'quarantined — FEFO will skip it'}.`);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Batches & Quarantine"
        subtitle="Only AVAILABLE and RELEASED batches can be dispensed, sold or transferred."
      />

      <Card className="mb-4">
        <div className="flex flex-wrap gap-2">
          <input
            className="input flex-1 min-w-[200px]"
            placeholder="Search batch number or product"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {['AVAILABLE', 'RELEASED', 'QUARANTINED', 'BLOCKED', 'DAMAGED', 'EXPIRED', 'RECALLED', 'RETURNED', 'DESTROYED'].map(
              (s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ),
            )}
          </select>
        </div>
      </Card>

      {message && (
        <div className="mb-3 rounded-md border border-ok/30 bg-ok-light px-3 py-2 text-sm text-ok">{message}</div>
      )}
      {error && <div className="mb-3"><ErrorBox message={error} /></div>}
      {loadError && <ErrorBox message={loadError} />}
      {loading && <Loading />}

      {data && (
        <Card title={`${data.total} batch${data.total === 1 ? '' : 'es'}`}>
          {data.data.length ? (
            <Table head={['Batch', 'Product', 'Status', 'Expiry', 'On hand', 'Supplier', 'Actions']}>
              {data.data.map((b: any) => {
                const onHand = b.balances.reduce((s: number, x: any) => s + Number(x.onHand), 0);
                return (
                  <tr key={b.id}>
                    <td className="td font-medium">{b.batchNumber}</td>
                    <td className="td">
                      {b.product.genericName} {b.product.strength}
                      <div className="text-xs text-ink-subtle">{b.product.sku}</div>
                    </td>
                    <td className="td">
                      <BatchStatus status={b.status} />
                      {b.quarantineReason && (
                        <div className="mt-0.5 text-xs text-ink-subtle">{b.quarantineReason}</div>
                      )}
                    </td>
                    <td className="td text-ink-muted">{shortDate(b.expiryDate)}</td>
                    <td className="td num">{qty(onHand)}</td>
                    <td className="td text-xs text-ink-muted">{b.supplier?.companyName ?? '-'}</td>
                    <td className="td">
                      <div className="flex gap-1">
                        {canRelease && ['QUARANTINED', 'BLOCKED', 'RETURNED'].includes(b.status) && (
                          <button
                            className="btn-ghost text-xs"
                            disabled={busy === b.id}
                            onClick={() => act(b.id, 'release')}
                          >
                            Release
                          </button>
                        )}
                        {canQuarantine && ['AVAILABLE', 'RELEASED'].includes(b.status) && (
                          <button
                            className="btn-ghost text-xs"
                            disabled={busy === b.id}
                            onClick={() => act(b.id, 'quarantine')}
                          >
                            Quarantine
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </Table>
          ) : (
            <Empty>No batches match these filters.</Empty>
          )}
        </Card>
      )}
    </Shell>
  );
}
