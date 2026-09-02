'use client';

import { useState } from 'react';
import { Shell, PageHeader } from '@/components/Shell';
import { useApi } from '@/lib/useApi';
import { api, qty, shortDate } from '@/lib/api';
import { Card, Empty, ErrorBox, Loading, Pill, Table } from '@/components/ui';

/**
 * Controlled medicines register (§28).
 *
 * Append-only with a running balance. Nothing here can be edited or deleted —
 * a correction appends a REVERSAL entry pointing at the one it cancels, which
 * is what lets the register be reconciled against physical stock.
 */
export default function ControlledPage() {
  const [productId, setProductId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const org = useApi<any>('/admin/organization');
  const products = useApi<any>('/products?isControlled=true&pageSize=50');
  const register = useApi<any>(
    `/controlled-register?pageSize=200${productId ? `&productId=${productId}` : ''}${branchId ? `&branchId=${branchId}` : ''}`,
    [productId, branchId, message],
  );
  const reconciliation = useApi<any>(
    productId && branchId ? `/controlled-register/reconcile?productId=${productId}&branchId=${branchId}` : null,
    [productId, branchId, message],
  );

  async function reverse(entryId: string) {
    const reason = window.prompt('Why is this entry being reversed? A reversal is appended; nothing is edited.');
    if (!reason) return;
    setBusy(true); setError(null);
    try {
      await api(`/controlled-register/${entryId}/reverse`, { method: 'POST', body: { reason } });
      setMessage('Reversal entry appended.');
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <Shell>
      <PageHeader
        title="Controlled Medicines Register"
        subtitle="Statutory register. Append-only: corrections are reversal entries, never edits or deletions."
        action={
          <a className="btn-ghost" target="_blank" rel="noreferrer"
             href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/reports/run/controlled-register?format=print${productId ? `&productId=${productId}` : ''}`}>
            Print register
          </a>
        }
      />

      {error && <div className="mb-3"><ErrorBox message={error} /></div>}
      {message && <div className="mb-3 rounded-md border border-ok/30 bg-ok-light px-3 py-2 text-sm text-ok">{message}</div>}

      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Controlled medicine</label>
            <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">All controlled medicines</option>
              {(products.data?.data ?? []).map((p: any) => (
                <option key={p.id} value={p.id}>{p.genericName} {p.strength}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Branch</label>
            <select className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">All branches</option>
              {(org.data?.branches ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        </div>
        {(!productId || !branchId) && (
          <p className="mt-2 text-xs text-ink-subtle">
            Choose both a medicine and a branch to reconcile the register against physical stock.
          </p>
        )}
      </Card>

      {reconciliation.data && (
        <Card
          className="mb-4"
          title="Reconciliation"
          action={
            <Pill tone={reconciliation.data.reconciled ? 'ok' : 'danger'}>
              {reconciliation.data.reconciled ? 'balanced' : 'VARIANCE — investigate'}
            </Pill>
          }
        >
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-md bg-surface-sunken p-3">
              <div className="text-xs text-ink-muted">Register balance</div>
              <div className="text-lg font-semibold num">{qty(reconciliation.data.registerBalance)}</div>
            </div>
            <div className="rounded-md bg-surface-sunken p-3">
              <div className="text-xs text-ink-muted">Physical stock</div>
              <div className="text-lg font-semibold num">{qty(reconciliation.data.physicalBalance)}</div>
            </div>
            <div className={`rounded-md p-3 ${reconciliation.data.reconciled ? 'bg-surface-sunken' : 'bg-danger-light'}`}>
              <div className="text-xs text-ink-muted">Variance</div>
              <div className={`text-lg font-semibold num ${reconciliation.data.reconciled ? '' : 'text-danger'}`}>
                {qty(reconciliation.data.variance)}
              </div>
            </div>
          </div>
          {reconciliation.data.requiresInvestigation && (
            <p className="mt-3 text-sm text-danger">
              The register and the shelf disagree. This must be investigated and explained — the
              system will not adjust either side on its own.
            </p>
          )}
        </Card>
      )}

      <Card title={`${register.data?.total ?? 0} register entries`}>
        {register.loading && <Loading />}
        {register.data?.data?.length ? (
          <Table head={['Entry', 'Date', 'Type', 'Received', 'Issued', 'Balance', 'Prescriber', 'Reversal', '']}>
            {register.data.data.map((e: any) => (
              <tr key={e.id} className={e.entryType === 'REVERSAL' ? 'bg-warn-light' : ''}>
                <td className="td num font-medium">{e.entryNo}</td>
                <td className="td text-xs text-ink-muted">{shortDate(e.occurredAt)}</td>
                <td className="td"><Pill tone={e.entryType === 'REVERSAL' ? 'warn' : e.entryType === 'DISPENSE' ? 'info' : 'neutral'}>{e.entryType}</Pill></td>
                <td className="td num">{Number(e.quantityIn) || ''}</td>
                <td className="td num">{Number(e.quantityOut) || ''}</td>
                <td className="td num font-medium">{qty(e.runningBalance)}</td>
                <td className="td text-xs text-ink-muted">{e.prescriberName ?? '-'}</td>
                <td className="td text-xs text-warn">{e.reversalReason ?? ''}</td>
                <td className="td">
                  {e.entryType !== 'REVERSAL' && !e.reversalOfId && (
                    <button className="btn-ghost text-xs" disabled={busy} onClick={() => reverse(e.id)}>Reverse</button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ) : (!register.loading && <Empty>No register entries. Controlled medicines appear here once received or dispensed.</Empty>)}
      </Card>
    </Shell>
  );
}
