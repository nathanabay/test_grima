'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Drawer, Field } from '@/components/primitives';
import { money } from '@/lib/api';

export interface Tender {
  method: string;
  amount: number;
  reference?: string;
}

const METHODS = [
  { value: 'CASH', label: 'Cash', needsReference: false },
  { value: 'CARD', label: 'Card', needsReference: true },
  { value: 'MOBILE_MONEY', label: 'Mobile money', needsReference: true },
  { value: 'BANK_TRANSFER', label: 'Bank transfer', needsReference: true },
  { value: 'CREDIT', label: 'On account', needsReference: false },
];

/** Notes and coins a cashier reaches for, so the common tender is one tap. */
const QUICK_CASH = [50, 100, 200, 500, 1000];

/**
 * Taking payment (§22).
 *
 * This replaces a dropdown that could not work: the server requires the
 * terminal reference for card, mobile money and bank transfer — because no
 * gateway is connected and a settlement it cannot confirm must not be recorded
 * as confirmed — and the old screen never collected one, so every card payment
 * failed.
 *
 * It also does the arithmetic a till is for. A cashier needs to know the change
 * before the customer does, and a total split across two tenders is ordinary at
 * a pharmacy counter.
 */
export function PaymentDialog({
  open,
  total,
  customerName,
  creditAvailable,
  onClose,
  onConfirm,
  busy,
  error,
}: {
  open: boolean;
  total: number;
  customerName?: string | null;
  creditAvailable?: number | null;
  onClose: () => void;
  onConfirm: (tenders: Tender[]) => void;
  busy?: boolean;
  error?: string | null;
}) {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [method, setMethod] = useState('CASH');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const amountRef = useRef<HTMLInputElement>(null);

  const taken = tenders.reduce((s, t) => s + t.amount, 0);
  const outstanding = Math.max(0, Number((total - taken).toFixed(2)));
  const change = Math.max(0, Number((taken - total).toFixed(2)));
  const definition = METHODS.find((m) => m.value === method)!;

  useEffect(() => {
    if (!open) return;
    setTenders([]);
    setMethod('CASH');
    setAmount(total.toFixed(2));
    setReference('');
    // The cashier's hands are on the keypad, not the mouse.
    setTimeout(() => amountRef.current?.select(), 50);
  }, [open, total]);

  const canAdd = useMemo(() => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return false;
    if (definition.needsReference && !reference.trim()) return false;
    if (method === 'CREDIT' && !customerName) return false;
    return true;
  }, [amount, reference, definition, method, customerName]);

  function addTender() {
    if (!canAdd) return;
    setTenders((t) => [
      ...t,
      { method, amount: Number(Number(amount).toFixed(2)), reference: reference.trim() || undefined },
    ]);
    setReference('');
    const remaining = Math.max(0, Number((outstanding - Number(amount)).toFixed(2)));
    setAmount(remaining ? remaining.toFixed(2) : '');
    setTimeout(() => amountRef.current?.select(), 50);
  }

  function confirm() {
    // One tender covering the whole total is the common case; adding it
    // explicitly first would be a step the cashier does not need.
    const finalTenders =
      tenders.length === 0 && canAdd
        ? [{ method, amount: Number(Number(amount).toFixed(2)), reference: reference.trim() || undefined }]
        : tenders;
    if (!finalTenders.length) return;
    onConfirm(finalTenders);
  }

  const settled = tenders.length ? taken >= total - 0.01 : Number(amount) >= total - 0.01;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="md"
      title={`Take ${money(total)}`}
      description={customerName ? `Customer: ${customerName}` : 'Walk-in customer'}
    >
      {error && (
        <div className="mb-3 rounded-card border border-danger/30 bg-danger/5 px-3 py-2 text-small text-danger">
          {error}
        </div>
      )}

      <div className="space-y-3">
        <Field label="Method">
          <select
            className="input"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            {METHODS.map((m) => (
              <option
                key={m.value}
                value={m.value}
                disabled={m.value === 'CREDIT' && !customerName}
              >
                {m.label}
                {m.value === 'CREDIT' && !customerName ? ' — attach a customer first' : ''}
              </option>
            ))}
          </select>
        </Field>

        {method === 'CREDIT' && creditAvailable !== null && creditAvailable !== undefined && (
          <p className="text-caption text-ink-muted">
            {money(creditAvailable)} of credit available on this account.
          </p>
        )}

        <Field label={method === 'CASH' ? 'Cash tendered' : 'Amount'}>
          <input
            ref={amountRef}
            className="input num text-right text-title"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={amount}
            aria-label={method === 'CASH' ? 'Cash tendered' : 'Amount'}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (outstanding > 0 && Number(amount) < outstanding) addTender();
                else confirm();
              }
            }}
          />
        </Field>

        {method === 'CASH' && (
          <div className="flex flex-wrap gap-1.5">
            <button className="btn-quiet btn-sm" onClick={() => setAmount(outstanding.toFixed(2))}>
              Exact {money(outstanding)}
            </button>
            {QUICK_CASH.filter((n) => n >= outstanding).slice(0, 4).map((n) => (
              <button key={n} className="btn-quiet btn-sm" onClick={() => setAmount(n.toFixed(2))}>
                {money(n)}
              </button>
            ))}
          </div>
        )}

        {definition.needsReference && (
          <Field
            label="Terminal reference"
            required
            hint="No payment gateway is connected, so this system cannot confirm the settlement itself. The reference from the card machine or transfer is what makes it reconcilable."
          >
            <input
              className="input"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. the approval code on the terminal slip"
            />
          </Field>
        )}

        {tenders.length > 0 && (
          <div className="rounded-card border border-border">
            <ul className="divide-y divide-border">
              {tenders.map((t, i) => (
                <li key={i} className="flex items-center justify-between px-3 py-1.5 text-small">
                  <span>
                    {METHODS.find((m) => m.value === t.method)?.label ?? t.method}
                    {t.reference && (
                      <span className="text-caption text-ink-muted"> · {t.reference}</span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="num">{money(t.amount)}</span>
                    <button
                      className="btn-quiet btn-sm"
                      aria-label={`Remove ${t.method} tender`}
                      onClick={() => setTenders((p) => p.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <dl className="space-y-1 rounded-card bg-surface-sunken p-3 text-small">
          <div className="flex justify-between">
            <dt className="text-ink-muted">Total</dt>
            <dd className="num">{money(total)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-muted">Taken</dt>
            <dd className="num">{money(tenders.length ? taken : Number(amount) || 0)}</dd>
          </div>
          <div className="flex justify-between border-t border-border pt-1 text-body font-semibold">
            <dt>{change > 0 || Number(amount) > total ? 'Change due' : 'Outstanding'}</dt>
            <dd className="num">
              {money(
                tenders.length
                  ? change > 0
                    ? change
                    : outstanding
                  : Math.max(0, (Number(amount) || 0) - total) || Math.max(0, total - (Number(amount) || 0)),
              )}
            </dd>
          </div>
        </dl>

        <div className="flex gap-2">
          {outstanding > 0 && (
            <button className="btn-ghost btn-sm" disabled={!canAdd || busy} onClick={addTender}>
              Add this tender
            </button>
          )}
          <button
            className="btn-primary btn-sm flex-1"
            disabled={busy || !settled}
            onClick={confirm}
          >
            {busy ? 'Taking payment...' : `Complete sale${change > 0 ? ` · change ${money(change)}` : ''}`}
          </button>
        </div>
      </div>
    </Drawer>
  );
}
