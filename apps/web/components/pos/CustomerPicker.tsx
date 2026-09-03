'use client';

import { useEffect, useState } from 'react';
import { Drawer, EmptyState, ErrorState, Field, Loading } from '@/components/primitives';
import { api, money } from '@/lib/api';

export interface PosCustomer {
  id: string;
  patientCode: string;
  fullName: string;
  phone: string | null;
  creditLimit?: string | number;
  creditBalance?: string | number;
  loyaltyPoints?: number;
}

/**
 * Attaching a customer to a sale (§14, §22).
 *
 * The till needs this for three different reasons and they are easy to
 * conflate: customer pricing, selling on account, and loyalty. All three
 * require knowing who is buying, so the picker shows the credit position
 * alongside the name — a cashier about to offer "on account" needs to see the
 * headroom before they offer it, not after the sale is refused.
 */
export function CustomerPicker({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (customer: PosCustomer | null) => void;
}) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<PosCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    if (!open) return;
    setTerm('');
    setResults([]);
    setError(null);
    setCreating(false);
    setName('');
    setPhone('');
  }, [open]);

  useEffect(() => {
    if (!open || !term.trim()) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        // A pharmacy counter searches by phone more often than by name, and the
        // patient search already matches either.
        const res = await api<any>(`/patients?q=${encodeURIComponent(term.trim())}&pageSize=15`);
        setResults(res.data ?? []);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [term, open]);

  async function createWalkIn() {
    setError(null);
    try {
      const created = await api<PosCustomer>('/patients', {
        method: 'POST',
        body: { fullName: name.trim(), phone: phone.trim() || undefined },
      });
      onSelect(created);
      onClose();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Attach a customer"
      description="For customer pricing, selling on account, and loyalty."
    >
      {error && <div className="mb-3"><ErrorState message={error} /></div>}

      {!creating ? (
        <div className="space-y-3">
          <Field label="Search by name, phone or code">
            <input
              className="input"
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="e.g. 0911 234 567"
            />
          </Field>

          {loading && <Loading label="Searching" />}

          {!loading && term && results.length === 0 && (
            <EmptyState
              title="Nobody matches"
              body="Create a walk-in record, or continue without a customer."
            />
          )}

          <ul className="divide-y divide-border">
            {results.map((c) => {
              const limit = Number(c.creditLimit ?? 0);
              const balance = Number(c.creditBalance ?? 0);
              return (
                <li key={c.id}>
                  <button
                    className="w-full px-2 py-2 text-left hover:bg-surface-sunken"
                    onClick={() => {
                      onSelect(c);
                      onClose();
                    }}
                  >
                    <div className="text-small text-ink">{c.fullName}</div>
                    <div className="text-caption text-ink-subtle">
                      {c.patientCode}
                      {c.phone ? ` · ${c.phone}` : ''}
                      {limit > 0
                        ? ` · ${money(Math.max(0, limit - balance))} credit available`
                        : balance > 0
                          ? ` · owes ${money(balance)}`
                          : ''}
                      {c.loyaltyPoints ? ` · ${c.loyaltyPoints} points` : ''}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="flex gap-2 border-t border-border pt-3">
            <button className="btn-ghost btn-sm" onClick={() => setCreating(true)}>
              New walk-in customer
            </button>
            <button
              className="btn-quiet btn-sm"
              onClick={() => {
                onSelect(null);
                onClose();
              }}
            >
              Continue without one
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Full name" required>
            <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Phone" hint="How a recall would reach them.">
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <button className="btn-primary btn-sm" disabled={!name.trim()} onClick={createWalkIn}>
              Create and attach
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setCreating(false)}>
              Back to search
            </button>
          </div>
        </div>
      )}
    </Drawer>
  );
}
