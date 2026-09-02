'use client';

import { useEffect, useState } from 'react';
import { Shell, PageHeader } from '@/components/Shell';
import { useApi } from '@/lib/useApi';
import { api, money, qty, shortDate, tokenStore } from '@/lib/api';
import { Card, Empty, ErrorBox, Loading, Pill, Table } from '@/components/ui';

interface Line {
  productId: string;
  batchId: string;
  label: string;
  onHand: number;
  quantityDelta: string;
  reason: string;
  /** Only meaningful on a write-off; the API refuses an unclassified loss. */
  lossType: string;
}

/**
 * Mirrors LOSS_TYPES on the API. The server is the authority - this list only
 * decides what the operator is offered.
 */
const LOSS_TYPES = [
  { value: 'SHRINKAGE', label: 'Shrinkage (unexplained)' },
  { value: 'DAMAGE', label: 'Damage' },
  { value: 'THEFT', label: 'Theft' },
  { value: 'MISPLACEMENT', label: 'Misplaced stock' },
  { value: 'EXPIRY', label: 'Expiry' },
  { value: 'COUNTING_ERROR', label: 'Counting error' },
  { value: 'SUPPLIER_SHORTAGE', label: 'Supplier shortage' },
  { value: 'UNKNOWN', label: 'Unknown' },
];

export default function AdjustmentsPage() {
  const [branches, setBranches] = useState<any[]>([]);
  const [branchId, setBranchId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const org = useApi<any>('/admin/organization');
  const ledger = useApi<any>(
    warehouseId ? `/inventory/ledger?warehouseId=${warehouseId}&pageSize=25` : null,
    [warehouseId, message],
  );

  useEffect(() => {
    if (!org.data) return;
    const user = tokenStore.user;
    const allowed = user?.branchIds.length
      ? org.data.branches.filter((b: any) => user.branchIds.includes(b.id))
      : org.data.branches;
    setBranches(allowed);
    const first = allowed[0];
    if (first) {
      setBranchId(first.id);
      setWarehouseId(first.warehouses[0]?.id ?? '');
    }
  }, [org.data]);

  useEffect(() => {
    if (!search || !warehouseId) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await api<any>(
          `/inventory/balances?warehouseId=${warehouseId}&search=${encodeURIComponent(search)}&pageSize=20`,
        );
        setResults(res.data);
      } catch (e: any) {
        setError(e.message);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [search, warehouseId]);

  function addLine(balance: any) {
    if (!balance.batch) {
      setError('Only batch-level positions can be adjusted.');
      return;
    }
    if (lines.some((l) => l.batchId === balance.batch.id)) return;
    setLines((l) => [
      ...l,
      {
        productId: balance.productId,
        batchId: balance.batch.id,
        label: `${balance.product.genericName} ${balance.product.strength} · ${balance.batch.batchNumber}`,
        onHand: Number(balance.onHand),
        quantityDelta: '',
        reason: '',
        lossType: '',
      },
    ]);
    setSearch('');
    setResults([]);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const payload = lines
        .filter((l) => l.quantityDelta !== '' && Number(l.quantityDelta) !== 0)
        .map((l) => ({
          productId: l.productId,
          batchId: l.batchId,
          quantityDelta: Number(l.quantityDelta),
          reason: l.reason || undefined,
          // A positive line is stock found, not a loss, and must carry no type.
          lossType: Number(l.quantityDelta) < 0 ? l.lossType || undefined : undefined,
        }));
      if (!payload.length) {
        setError('Enter a non-zero adjustment on at least one line.');
        return;
      }
      const unclassified = payload.filter((l) => l.quantityDelta < 0 && !l.lossType);
      if (unclassified.length) {
        setError(
          `${unclassified.length} write-off line(s) need a loss type before they can be posted.`,
        );
        return;
      }
      const result = await api('/stock-adjustments', {
        method: 'POST',
        body: { warehouseId, branchId, reason, items: payload },
      });
      setMessage(`Adjustment ${result.adjustmentNo} posted to the ledger.`);
      setLines([]);
      setReason('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Stock Adjustments"
        subtitle="Adjustments are ledger movements, not edits: the original quantity stays in the history forever."
      />

      {error && <div className="mb-3"><ErrorBox message={error} /></div>}
      {message && (
        <div className="mb-3 rounded-md border border-ok/30 bg-ok-light px-3 py-2 text-sm text-ok">{message}</div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="New adjustment">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Branch</label>
              <select
                className="input"
                value={branchId}
                onChange={(e) => {
                  setBranchId(e.target.value);
                  const b = branches.find((x) => x.id === e.target.value);
                  setWarehouseId(b?.warehouses[0]?.id ?? '');
                  setLines([]);
                }}
              >
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Warehouse</label>
              <select
                className="input"
                value={warehouseId}
                onChange={(e) => { setWarehouseId(e.target.value); setLines([]); }}
              >
                {branches.find((b) => b.id === branchId)?.warehouses.map((w: any) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-3">
            <label className="label">Reason for the adjustment (required)</label>
            <input
              className="input"
              placeholder="e.g. Breakage during handling, verified by warehouse manager"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <div className="mt-3">
            <label className="label">Find the batch to adjust</label>
            <input
              className="input"
              placeholder="Search product name or SKU"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {results.length > 0 && (
              <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-surface-border">
                {results.map((b) => (
                  <button
                    key={b.id}
                    className="block w-full px-2 py-1.5 text-left text-sm hover:bg-surface-sunken"
                    onClick={() => addLine(b)}
                  >
                    <span className="font-medium">
                      {b.product.genericName} {b.product.strength}
                    </span>
                    <span className="text-xs text-ink-subtle">
                      {' '}· {b.batch?.batchNumber ?? 'no batch'} · on hand {qty(b.onHand)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {lines.length > 0 && (
            <div className="mt-4">
              <Table head={['Batch', 'On hand', 'Adjust by', 'New', 'Loss type', 'Line reason', '']}>
                {lines.map((l, i) => {
                  const delta = Number(l.quantityDelta || 0);
                  return (
                    <tr key={l.batchId}>
                      <td className="td text-xs">{l.label}</td>
                      <td className="td num">{qty(l.onHand)}</td>
                      <td className="td">
                        <input
                          className="input w-24 num"
                          type="number"
                          placeholder="+/-"
                          value={l.quantityDelta}
                          onChange={(e) =>
                            setLines((p) =>
                              p.map((x, xi) => (xi === i ? { ...x, quantityDelta: e.target.value } : x)),
                            )
                          }
                        />
                      </td>
                      <td className={`td num ${l.onHand + delta < 0 ? 'text-danger font-medium' : ''}`}>
                        {qty(l.onHand + delta)}
                      </td>
                      <td className="td">
                        {delta < 0 ? (
                          <select
                            className="input text-xs"
                            value={l.lossType}
                            aria-label={`Loss type for ${l.label}`}
                            onChange={(e) =>
                              setLines((p) =>
                                p.map((x, xi) => (xi === i ? { ...x, lossType: e.target.value } : x)),
                              )
                            }
                          >
                            <option value="">Select a cause…</option>
                            {LOSS_TYPES.map((t) => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs text-ink-subtle">—</span>
                        )}
                      </td>
                      <td className="td">
                        <input
                          className="input text-xs"
                          value={l.reason}
                          onChange={(e) =>
                            setLines((p) => p.map((x, xi) => (xi === i ? { ...x, reason: e.target.value } : x)))
                          }
                        />
                      </td>
                      <td className="td">
                        <button
                          className="btn-ghost text-xs"
                          onClick={() => setLines((p) => p.filter((_, xi) => xi !== i))}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </Table>

              {lines.some((l) => l.onHand + Number(l.quantityDelta || 0) < 0) && (
                <p className="mt-2 text-xs text-danger">
                  A negative result will be refused by the ledger unless negative stock is enabled
                  for this organization.
                </p>
              )}

              <button
                className="btn-primary mt-3"
                disabled={busy || !reason.trim()}
                onClick={submit}
              >
                {busy ? 'Posting...' : 'Post adjustment'}
              </button>
              {!reason.trim() && (
                <p className="mt-1 text-xs text-ink-subtle">A reason is required before posting.</p>
              )}
            </div>
          )}
        </Card>

        <Card title="Recent ledger movements">
          {ledger.loading && <Loading />}
          {ledger.data?.data?.length ? (
            <Table head={['When', 'Type', 'Product', 'In', 'Out', 'Balance', 'Reference']}>
              {ledger.data.data.map((t: any) => (
                <tr key={t.id}>
                  <td className="td text-xs text-ink-muted">{shortDate(t.occurredAt)}</td>
                  <td className="td">
                    <Pill
                      tone={
                        t.type === 'ADJUSTMENT' || t.type === 'STOCK_COUNT'
                          ? 'warn'
                          : t.type === 'PURCHASE_RECEIPT'
                            ? 'ok'
                            : 'neutral'
                      }
                    >
                      {t.type.replace(/_/g, ' ')}
                    </Pill>
                  </td>
                  <td className="td text-xs">{t.product.genericName}</td>
                  <td className="td num">{Number(t.quantityIn) || ''}</td>
                  <td className="td num">{Number(t.quantityOut) || ''}</td>
                  <td className="td num font-medium">{qty(t.balanceAfter)}</td>
                  <td className="td text-xs text-ink-muted">{t.referenceNo ?? '-'}</td>
                </tr>
              ))}
            </Table>
          ) : (
            !ledger.loading && <Empty>No movements recorded in this warehouse.</Empty>
          )}
        </Card>
      </div>
    </Shell>
  );
}
