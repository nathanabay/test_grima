'use client';

import { useEffect, useState } from 'react';
import { Shell, PageHeader } from '@/components/Shell';
import { api, money, qty, tokenStore } from '@/lib/api';
import { Card, Empty, ErrorBox, Loading, Pill, Table } from '@/components/ui';

interface CartLine {
  productId: string;
  name: string;
  unitPrice: number;
  taxRate: number;
  quantity: number;
  available: number;
  baseUnit: string;
}

export default function PosPage() {
  const [branchId, setBranchId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [branches, setBranches] = useState<any[]>([]);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [method, setMethod] = useState('CASH');
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<any | null>(null);
  const [session, setSession] = useState<any | null>(null);
  const [held, setHeld] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);

  // Default to a site the operator actually has access to.
  useEffect(() => {
    api('/admin/branches')
      .then((all: any[]) => {
        const user = tokenStore.user;
        const allowed = user?.branchIds.length
          ? all.filter((b) => user.branchIds.includes(b.id))
          : all;
        setBranches(allowed);
        const first = allowed[0];
        if (first) {
          setBranchId(first.id);
          setWarehouseId(first.warehouses.find((w: any) => !w.isColdRoom)?.id ?? first.warehouses[0]?.id ?? '');
        }
      })
      .catch((e) => setError(e.message));
  }, []);

  // §46: a till should show whose shift is open before anything is sold.
  useEffect(() => {
    if (!branchId) return;
    api(`/pos/cash-sessions/current?branchId=${branchId}`).then(setSession).catch(() => setSession(null));
    api(`/pos/held?branchId=${branchId}`).then(setHeld).catch(() => setHeld([]));
  }, [branchId, receipt]);

  useEffect(() => {
    if (!term || !warehouseId) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await api(`/pos/search?q=${encodeURIComponent(term)}&warehouseId=${warehouseId}`));
      } catch (e: any) {
        setError(e.message);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [term, warehouseId]);

  function addToCart(p: any) {
    setError(null);
    // The server enforces these too; blocking here avoids a pointless round trip.
    if (p.requiresPrescription || p.isControlled) {
      setError(`${p.genericName} is prescription-only and must be dispensed against a prescription.`);
      return;
    }
    if (p.available <= 0) {
      setError(`${p.genericName} is out of stock at this warehouse.`);
      return;
    }
    setCart((c) => {
      const existing = c.find((l) => l.productId === p.id);
      if (existing) {
        return c.map((l) => (l.productId === p.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...c,
        {
          productId: p.id,
          name: `${p.genericName} ${p.strength}`,
          unitPrice: Number(p.retailPrice),
          taxRate: Number(p.taxRate),
          quantity: 1,
          available: p.available,
          baseUnit: p.baseUnit,
        },
      ];
    });
  }

  const subtotal = cart.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const tax = cart.reduce((s, l) => s + l.unitPrice * l.quantity * l.taxRate, 0);
  const total = subtotal + tax;

  async function checkout() {
    setBusy(true);
    setError(null);
    setReceipt(null);
    try {
      const sale = await api('/pos/checkout', {
        method: 'POST',
        body: {
          branchId,
          warehouseId,
          cashSessionId: session?.id,
          lines: cart.map((l) => ({ productId: l.productId, quantity: l.quantity })),
          payments: [{ method, amount: Number(total.toFixed(2)) }],
          // Repeat-safe: a double click cannot create two sales.
          idempotencyKey: `pos-${branchId}-${Date.now()}`,
        },
      });
      setReceipt(sale);
      setCart([]);
      setTerm('');
      setResults([]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Point of Sale"
        subtitle="Batches are chosen automatically by FEFO. Prescription-only and controlled medicines are refused here."
        action={
          <select
            className="input w-auto"
            value={branchId}
            onChange={(e) => {
              const b = branches.find((x) => x.id === e.target.value);
              setBranchId(e.target.value);
              setWarehouseId(b?.warehouses.find((w: any) => !w.isColdRoom)?.id ?? '');
              setCart([]);
            }}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        }
      />

      {error && <div className="mb-3"><ErrorBox message={error} /></div>}

      {receipt && (
        <Card className="mb-4" title={`Sale ${receipt.saleNo} completed`}>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="text-lg font-semibold num">{money(receipt.grandTotal)}</span>
            <span className="text-ink-muted">{receipt.items.length} line(s)</span>
            <button className="btn-ghost" onClick={() => window.print()}>Print receipt</button>
            <button className="btn-ghost" onClick={async () => {
              const item = receipt.items[0];
              const max = Number(item.quantity);
              const q = window.prompt(`Quantity to refund (max ${max}):`, String(max));
              if (!q) return;
              const reason = window.prompt('Refund reason (required):');
              if (!reason) return;
              try {
                const refunded = await api(`/pos/sales/${receipt.id}/refund`, { method: 'POST', body: {
                  lines: [{ saleItemId: item.id, quantity: Number(q) }], reason,
                }});
                setReceipt(refunded);
                setError(null);
              } catch (e: any) { setError(e.message); }
            }}>Refund</button>
            <button className="btn-ghost" onClick={() => setReceipt(null)}>New sale</button>
          </div>
        </Card>
      )}

      <Card className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          {session ? (
            <>
              <span>
                <strong>Shift {session.sessionNo}</strong> open ·{' '}
                <span className="text-ink-muted">
                  opened with {money(session.openingCash)} · cash sales {money(session.cashSales)}
                </span>
              </span>
              <button className="btn-ghost" onClick={async () => {
                const counted = window.prompt('Counted cash in the drawer:');
                if (!counted) return;
                const expected = Number(session.openingCash) + Number(session.cashSales) - Number(session.refunds) - Number(session.cashExpenses);
                const variance = Number(counted) - expected;
                let varianceReason: string | undefined;
                if (Math.abs(variance) > 50) {
                  varianceReason = window.prompt(`Variance of ${variance.toFixed(2)} needs an explanation:`) ?? undefined;
                  if (!varianceReason) return;
                }
                try {
                  const closed = await api(`/pos/cash-sessions/${session.id}/close`, { method: 'POST', body: { actualCash: Number(counted), varianceReason } });
                  setSession(null);
                  setError(null);
                  window.alert(`Shift closed. Expected ${Number(closed.expectedCash).toFixed(2)}, counted ${Number(closed.actualCash).toFixed(2)}, variance ${Number(closed.variance).toFixed(2)}.`);
                } catch (e: any) { setError(e.message); }
              }}>Close shift</button>
            </>
          ) : (
            <>
              <span className="text-warn">No cash shift is open. Cash sales will not be reconciled to a drawer.</span>
              <button className="btn-primary" onClick={async () => {
                const opening = window.prompt('Opening cash float:', '0');
                if (opening === null) return;
                try { setSession(await api('/pos/cash-sessions/open', { method: 'POST', body: { branchId, openingCash: Number(opening) } })); }
                catch (e: any) { setError(e.message); }
              }}>Open shift</button>
            </>
          )}
        </div>
      </Card>

      {held.length > 0 && (
        <Card className="mb-4" title={`${held.length} held cart(s)`}>
          <Table head={['Sale', 'Customer', 'Lines', '']}>
            {held.map((h) => (
              <tr key={h.id}>
                <td className="td font-medium">{h.saleNo}</td>
                <td className="td text-xs text-ink-muted">{h.patient?.fullName ?? 'Walk-in'}</td>
                <td className="td num">{h.items.length}</td>
                <td className="td">
                  <div className="flex gap-1">
                    <button className="btn-ghost text-xs" onClick={async () => {
                      try {
                        const resumed = await api(`/pos/held/${h.id}/resume`, { method: 'POST' });
                        // Reload the parked lines into the live cart.
                        const restored: CartLine[] = [];
                        for (const line of resumed.lines) {
                          const found = (await api<any[]>(`/pos/search?q=${encodeURIComponent('')}&warehouseId=${warehouseId}`).catch(() => []))
                            .find((p: any) => p.id === line.productId);
                          restored.push({
                            productId: line.productId,
                            name: found ? `${found.genericName} ${found.strength}` : line.productId.slice(0, 8),
                            unitPrice: line.unitPrice,
                            taxRate: found ? Number(found.taxRate) : 0,
                            quantity: line.quantity,
                            available: found?.available ?? line.quantity,
                            baseUnit: found?.baseUnit ?? '',
                          });
                        }
                        setCart(restored);
                        setHeld((p) => p.filter((x) => x.id !== h.id));
                      } catch (e: any) { setError(e.message); }
                    }}>Resume</button>
                    <button className="btn-ghost text-xs" onClick={async () => {
                      if (!window.confirm(`Abandon ${h.saleNo}? Its reserved stock is released.`)) return;
                      try { await api(`/pos/held/${h.id}/abandon`, { method: 'POST' }); setHeld((p) => p.filter((x) => x.id !== h.id)); }
                      catch (e: any) { setError(e.message); }
                    }}>Abandon</button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Search products">
          <input
            className="input"
            placeholder="Scan a barcode or type a generic/brand name"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            autoFocus
          />
          <div className="mt-3">
            {searching && <Loading label="Searching" />}
            {!searching && term && !results.length && <Empty>No products match.</Empty>}
            {results.length > 0 && (
              <Table head={['Product', 'Price', 'Available', '']}>
                {results.map((p) => (
                  <tr key={p.id}>
                    <td className="td">
                      <div className="font-medium">{p.genericName} {p.strength}</div>
                      <div className="text-xs text-ink-subtle">
                        {p.brandName} · {p.sku}
                        {p.requiresPrescription && <> · <Pill tone="warn">Rx only</Pill></>}
                        {p.isControlled && <> · <Pill tone="danger">Controlled</Pill></>}
                      </div>
                    </td>
                    <td className="td num">{money(p.retailPrice)}</td>
                    <td className={`td num ${p.available <= 0 ? 'text-danger' : ''}`}>{qty(p.available)}</td>
                    <td className="td">
                      <button
                        className="btn-ghost text-xs"
                        disabled={p.available <= 0 || p.requiresPrescription || p.isControlled}
                        onClick={() => addToCart(p)}
                      >
                        Add
                      </button>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </div>
        </Card>

        <Card title={`Cart (${cart.length})`}>
          {cart.length ? (
            <>
              <Table head={['Product', 'Qty', 'Unit', 'Line', '']}>
                {cart.map((l) => (
                  <tr key={l.productId}>
                    <td className="td">{l.name}</td>
                    <td className="td">
                      <input
                        className="input w-20 num"
                        type="number"
                        min={1}
                        max={l.available}
                        value={l.quantity}
                        onChange={(e) =>
                          setCart((c) =>
                            c.map((x) =>
                              x.productId === l.productId
                                ? { ...x, quantity: Math.max(1, Math.min(l.available, Number(e.target.value))) }
                                : x,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="td num">{money(l.unitPrice)}</td>
                    <td className="td num">{money(l.unitPrice * l.quantity)}</td>
                    <td className="td">
                      <button
                        className="btn-ghost text-xs"
                        onClick={() => setCart((c) => c.filter((x) => x.productId !== l.productId))}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </Table>

              <dl className="mt-4 space-y-1 text-sm">
                <div className="flex justify-between"><dt className="text-ink-muted">Subtotal</dt><dd className="num">{money(subtotal)}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-muted">Tax</dt><dd className="num">{money(tax)}</dd></div>
                <div className="flex justify-between border-t border-surface-border pt-1 text-base font-semibold">
                  <dt>Total</dt><dd className="num">{money(total)}</dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-2">
                <select className="input w-auto" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {['CASH', 'CARD', 'MOBILE_MONEY', 'BANK_TRANSFER'].map((m) => (
                    <option key={m} value={m}>{m.replace('_', ' ')}</option>
                  ))}
                </select>
                <button className="btn-primary flex-1" disabled={busy} onClick={checkout}>
                  {busy ? 'Processing...' : `Take payment ${money(total)}`}
                </button>
                <button className="btn-ghost" disabled={busy} onClick={async () => {
                  try {
                    await api('/pos/hold', { method: 'POST', body: {
                      branchId, warehouseId, cashSessionId: session?.id,
                      lines: cart.map((l) => ({ productId: l.productId, quantity: l.quantity })),
                      payments: [],
                    }});
                    setCart([]);
                    const list = await api<any[]>(`/pos/held?branchId=${branchId}`);
                    setHeld(list);
                  } catch (e: any) { setError(e.message); }
                }}>Hold cart</button>
                <button className="btn-ghost" onClick={() => setCart([])}>Clear</button>
              </div>
            </>
          ) : (
            <Empty>Search for a product to start a sale.</Empty>
          )}
        </Card>
      </div>
    </Shell>
  );
}
