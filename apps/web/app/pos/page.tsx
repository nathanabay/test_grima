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
            <button className="btn-ghost" onClick={() => setReceipt(null)}>New sale</button>
          </div>
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
