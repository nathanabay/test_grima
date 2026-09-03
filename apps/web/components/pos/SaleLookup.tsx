'use client';

import { useEffect, useState } from 'react';
import { Drawer, EmptyState, ErrorState, Field, Loading } from '@/components/primitives';
import { StatusBadge } from '@/components/status';
import { api, money, shortDate } from '@/lib/api';
import { Receipt } from './Receipt';

/**
 * Finding a past sale (§22).
 *
 * A customer comes back with a bag and no receipt, or with a receipt and a
 * complaint. Until now the till could only act on the sale it had just made, so
 * anything from yesterday needed somebody with database access.
 */
export function SaleLookup({
  open,
  branchId,
  branchName,
  canVoid,
  canRefund,
  onClose,
  onChanged,
  initialTerm = '',
}: {
  open: boolean;
  branchId: string;
  branchName?: string;
  /** Prefills the search, so `/pos?saleId=…` opens on that sale. */
  initialTerm?: string;
  canVoid: boolean;
  canRefund: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refundLines, setRefundLines] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) return;
    setTerm(initialTerm);
    setSelected(null);
    setError(null);
    setReason('');
    setRefundLines({});
    void search(initialTerm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTerm]);

  async function search(q: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await api<any>(
        `/pos/sales?branchId=${branchId}&pageSize=25${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      );
      setResults(res.data ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function voidSale() {
    if (!reason.trim()) {
      setError('Voiding a sale needs a reason — it returns stock to the shelf.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/pos/sales/${selected.id}/void`, { method: 'POST', body: { reason } });
      await search(term);
      setSelected(null);
      setReason('');
      onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function refund() {
    const lines = Object.entries(refundLines)
      .map(([saleItemId, q]) => ({ saleItemId, quantity: Number(q) }))
      .filter((l) => l.quantity > 0);
    if (!lines.length) {
      setError('Enter a quantity on at least one line.');
      return;
    }
    if (!reason.trim()) {
      setError('A refund needs a reason.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await api<any>(`/pos/sales/${selected.id}/refund`, {
        method: 'POST',
        body: { lines, reason },
      });
      setSelected(updated);
      setRefundLines({});
      setReason('');
      await search(term);
      onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="xl"
      title={selected ? `Sale ${selected.saleNo}` : 'Find a sale'}
      description={
        selected
          ? 'Reprint the receipt, refund any line, or void the whole sale.'
          : 'Search by sale number, or pick from today.'
      }
    >
      {error && <div className="mb-3"><ErrorState message={error} /></div>}

      {!selected ? (
        <div className="space-y-3">
          <Field label="Sale number">
            <input
              className="input"
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search(term)}
              placeholder="e.g. SALE-2026-000129"
            />
          </Field>

          {loading && <Loading label="Searching" />}
          {!loading && results.length === 0 && (
            <EmptyState title="No sales match" body="Try a different number, or clear the search." />
          )}

          <ul className="divide-y divide-border">
            {results.map((s) => (
              <li key={s.id}>
                <button
                  className="flex w-full items-center justify-between gap-2 px-2 py-2 text-left hover:bg-surface-sunken"
                  onClick={() => setSelected(s)}
                >
                  <span>
                    <span className="text-small text-ink">{s.saleNo}</span>
                    <span className="block text-caption text-ink-subtle">
                      {shortDate(s.soldAt)} · {s.items.length} line(s)
                      {s.patient ? ` · ${s.patient.fullName}` : ''}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="num text-small">{money(s.grandTotal)}</span>
                    <StatusBadge status={s.status} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="space-y-4">
          <button className="btn-quiet btn-sm" onClick={() => setSelected(null)}>
            Back to the list
          </button>

          <Receipt sale={selected} branchName={branchName} />

          {selected.status === 'COMPLETED' && (canRefund || canVoid) && (
            <div className="no-print space-y-3 rounded-card border border-border p-3">
              {canRefund && (
                <>
                  <p className="text-small text-ink">Refund a line</p>
                  <table className="w-full text-small">
                    <thead>
                      <tr>
                        <th className="th">Line</th>
                        <th className="th text-right">Sold</th>
                        <th className="th text-right">Refund</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.items.map((i: any) => (
                        <tr key={i.id}>
                          <td className="td">{i.product?.genericName ?? i.productId.slice(0, 8)}</td>
                          <td className="td num text-right">{Number(i.quantity)}</td>
                          <td className="td text-right">
                            <input
                              className="input num w-20 text-right"
                              type="number"
                              min="0"
                              max={Number(i.quantity)}
                              aria-label={`Quantity to refund on line ${i.id}`}
                              value={refundLines[i.id] ?? ''}
                              onChange={(e) =>
                                setRefundLines((p) => ({ ...p, [i.id]: e.target.value }))
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              <Field label="Reason" required>
                <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>

              <div className="flex gap-2">
                {canRefund && (
                  <button className="btn-primary btn-sm" disabled={busy} onClick={refund}>
                    {busy ? 'Refunding...' : 'Refund selected lines'}
                  </button>
                )}
                {canVoid && (
                  <button className="btn-danger btn-sm" disabled={busy} onClick={voidSale}>
                    Void the whole sale
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
