'use client';

import { useEffect, useState } from 'react';
import { Shell, PageHeader } from '@/components/Shell';
import { useApi } from '@/lib/useApi';
import { api, qty, shortDate, tokenStore } from '@/lib/api';
import { Card, Empty, ErrorBox, Loading, Pill, Table } from '@/components/ui';

const STATUS_TONE: Record<string, any> = {
  DRAFT: 'neutral', SUBMITTED: 'info', APPROVED: 'info', PICKING: 'info',
  DISPATCHED: 'warn', IN_TRANSIT: 'warn', PARTIALLY_RECEIVED: 'warn',
  RECEIVED: 'ok', COMPLETED: 'ok', CANCELLED: 'neutral',
};

export default function TransfersPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const list = useApi<any>('/transfers?pageSize=25', [message]);
  const detail = useApi<any>(selectedId ? `/transfers/${selectedId}` : null, [selectedId, message]);

  async function act(path: string, body: any, label: string) {
    setBusy(true); setError(null);
    try { await api(path, { method: 'POST', body }); setMessage(`${label} at ${new Date().toLocaleTimeString()}`); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Shell>
      <PageHeader
        title="Stock Transfers"
        subtitle="Dispatch removes stock from the origin; receipt adds it at the destination. Nothing is invisible in between."
        action={<button className="btn-primary" onClick={() => setCreating((v) => !v)}>{creating ? 'Cancel' : 'New transfer'}</button>}
      />

      {error && <div className="mb-3"><ErrorBox message={error} /></div>}
      {message && <div className="mb-3 rounded-md border border-ok/30 bg-ok-light px-3 py-2 text-sm text-ok">{message}</div>}

      {creating && <NewTransfer onDone={(t) => { setCreating(false); setSelectedId(t.id); setMessage(`Transfer ${t.transferNo} created.`); }} onError={setError} />}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2" title={`${list.data?.total ?? 0} transfers`}>
          {list.loading && <Loading />}
          {list.data?.data?.length ? (
            <div className="max-h-[60vh] space-y-1 overflow-y-auto">
              {list.data.data.map((t: any) => (
                <button key={t.id} onClick={() => setSelectedId(t.id)}
                  className={`w-full rounded-md border p-2 text-left text-sm ${selectedId === t.id ? 'border-brand bg-brand-light' : 'border-transparent hover:bg-surface-sunken'}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{t.transferNo}</span>
                    <Pill tone={STATUS_TONE[t.status]}>{t.status.replace(/_/g, ' ')}</Pill>
                  </div>
                  <div className="text-xs text-ink-subtle">
                    {t.items.length} line(s){t.isRecallMovement && ' · recall movement'}
                  </div>
                </button>
              ))}
            </div>
          ) : (!list.loading && <Empty>No transfers yet.</Empty>)}
        </Card>

        <div className="lg:col-span-3">
          {!selectedId && <Card><Empty>Select a transfer.</Empty></Card>}
          {detail.loading && <Loading />}
          {detail.data && (
            <Card
              title={<span>{detail.data.transferNo} <Pill tone={STATUS_TONE[detail.data.status]}>{detail.data.status.replace(/_/g,' ')}</Pill></span>}
              action={
                <a className="btn-ghost text-xs" target="_blank" rel="noreferrer"
                   href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/reports/documents/stock-transfer/${detail.data.id}`}>
                  Print note
                </a>
              }
            >
              <Table head={['Product', 'Batch', 'Requested', 'Dispatched', 'Received', 'Variance']}>
                {detail.data.items.map((i: any) => {
                  const variance = Number(i.dispatchedQty) - Number(i.receivedQty);
                  return (
                    <tr key={i.id}>
                      <td className="td text-xs">{i.productId.slice(0, 8)}</td>
                      <td className="td text-xs text-ink-muted">{i.batchId.slice(0, 8)}</td>
                      <td className="td num">{qty(i.requestedQty)}</td>
                      <td className="td num">{qty(i.dispatchedQty)}</td>
                      <td className="td num">{qty(i.receivedQty)}</td>
                      <td className={`td num ${variance > 0 ? 'text-warn font-medium' : 'text-ink-subtle'}`}>
                        {variance > 0 ? `${qty(variance)} in transit` : '-'}
                      </td>
                    </tr>
                  );
                })}
              </Table>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-surface-border pt-3">
                {detail.data.status === 'DRAFT' && (
                  <button className="btn-ghost" disabled={busy}
                    onClick={() => act(`/transfers/${detail.data.id}/submit`, {}, 'Submitted')}>Submit</button>
                )}
                {detail.data.status === 'SUBMITTED' && (
                  <button className="btn-primary" disabled={busy}
                    onClick={() => act(`/transfers/${detail.data.id}/approve`, {}, 'Approved')}>Approve</button>
                )}
                {['APPROVED', 'PICKING'].includes(detail.data.status) && (
                  <button className="btn-primary" disabled={busy}
                    onClick={() => {
                      const courier = window.prompt('Courier or vehicle:') ?? undefined;
                      act(`/transfers/${detail.data.id}/dispatch`, {
                        lines: detail.data.items.map((i: any) => ({ itemId: i.id, quantity: Number(i.requestedQty) - Number(i.dispatchedQty) })).filter((l: any) => l.quantity > 0),
                        vehicleOrCourier: courier,
                      }, 'Dispatched');
                    }}>Dispatch all</button>
                )}
                {['IN_TRANSIT', 'PARTIALLY_RECEIVED'].includes(detail.data.status) && (
                  <>
                    <button className="btn-primary" disabled={busy}
                      onClick={() => act(`/transfers/${detail.data.id}/receive`, {
                        lines: detail.data.items.map((i: any) => ({ itemId: i.id, quantity: Number(i.dispatchedQty) - Number(i.receivedQty) })).filter((l: any) => l.quantity > 0),
                      }, 'Received in full')}>Receive in full</button>
                    <button className="btn-ghost" disabled={busy}
                      onClick={() => {
                        const item = detail.data.items[0];
                        const inTransit = Number(item.dispatchedQty) - Number(item.receivedQty);
                        const got = window.prompt(`Quantity actually received of ${inTransit}:`, String(inTransit));
                        if (!got) return;
                        const reason = Number(got) < inTransit ? window.prompt('Variance reason (required for a shortfall):') : undefined;
                        if (Number(got) < inTransit && !reason) return;
                        act(`/transfers/${detail.data.id}/receive`, { lines: [{ itemId: item.id, quantity: Number(got), varianceReason: reason }] }, 'Partially received');
                      }}>Receive short</button>
                  </>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </Shell>
  );
}

function NewTransfer({ onDone, onError }: { onDone: (t: any) => void; onError: (m: string) => void }) {
  const org = useApi<any>('/admin/organization');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [lines, setLines] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  const warehouses = (org.data?.branches ?? []).flatMap((b: any) => b.warehouses.map((w: any) => ({ ...w, branchName: b.name })));

  useEffect(() => {
    if (!search || !from) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await api<any>(`/inventory/balances?warehouseId=${from}&search=${encodeURIComponent(search)}&pageSize=15`);
        setResults(r.data.filter((b: any) => b.batch && Number(b.onHand) > 0));
      } catch (e: any) { onError(e.message); }
    }, 250);
    return () => clearTimeout(t);
  }, [search, from, onError]);

  return (
    <Card className="mb-4" title="New transfer">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">From warehouse</label>
          <select className="input" value={from} onChange={(e) => { setFrom(e.target.value); setLines([]); }}>
            <option value="">Select origin</option>
            {warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.branchName} — {w.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">To warehouse</label>
          <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Select destination</option>
            {warehouses.filter((w: any) => w.id !== from).map((w: any) => <option key={w.id} value={w.id}>{w.branchName} — {w.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Reason</label>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Redistribution before expiry" />
        </div>
      </div>

      <div className="mt-3">
        <label className="label">Add stock from the origin</label>
        <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search product" disabled={!from} />
        {results.length > 0 && (
          <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-surface-border">
            {results.map((b) => (
              <button key={b.id} className="block w-full px-2 py-1.5 text-left text-sm hover:bg-surface-sunken"
                onClick={() => {
                  if (lines.some((l) => l.batchId === b.batch.id)) return;
                  setLines((p) => [...p, { productId: b.productId, batchId: b.batch.id, label: `${b.product.genericName} · ${b.batch.batchNumber}`, available: Number(b.onHand), quantity: '' }]);
                  setSearch(''); setResults([]);
                }}>
                {b.product.genericName} {b.product.strength} · {b.batch.batchNumber} · {qty(b.onHand)} available · exp {shortDate(b.batch.expiryDate)}
              </button>
            ))}
          </div>
        )}
      </div>

      {lines.length > 0 && (
        <Table head={['Item', 'Available', 'Quantity', '']}>
          {lines.map((l, i) => (
            <tr key={l.batchId}>
              <td className="td text-xs">{l.label}</td>
              <td className="td num">{qty(l.available)}</td>
              <td className="td">
                <input className="input w-24 num" type="number" max={l.available} value={l.quantity}
                  onChange={(e) => setLines((p) => p.map((x, xi) => xi === i ? { ...x, quantity: e.target.value } : x))} />
              </td>
              <td className="td"><button className="btn-ghost text-xs" onClick={() => setLines((p) => p.filter((_, xi) => xi !== i))}>Remove</button></td>
            </tr>
          ))}
        </Table>
      )}

      <button className="btn-primary mt-3" disabled={busy || !from || !to || !lines.length || lines.some((l) => !Number(l.quantity))}
        onClick={async () => {
          setBusy(true);
          try {
            onDone(await api('/transfers', { method: 'POST', body: {
              fromWarehouseId: from, toWarehouseId: to, reason,
              items: lines.map((l) => ({ productId: l.productId, batchId: l.batchId, quantity: Number(l.quantity) })),
            }}));
          } catch (e: any) { onError(e.message); } finally { setBusy(false); }
        }}>
        {busy ? 'Creating...' : 'Create transfer'}
      </button>
    </Card>
  );
}
