'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card as Panel, Drawer, EmptyState, ErrorState, Field, Loading, Stat } from '@/components/primitives';
import { useApi } from '@/lib/useApi';
import { api, money, shortDate } from '@/lib/api';
import { Receipt } from './Receipt';

/** The notes and coins a drawer is counted in. */
const DENOMINATIONS = [200, 100, 50, 10, 5, 1, 0.5, 0.25];

const MOVEMENT_TYPES = [
  { value: 'DROP', label: 'Drop to safe', out: true },
  { value: 'PAYOUT', label: 'Payout', out: true },
  { value: 'PICKUP', label: 'Pickup by manager', out: true },
  { value: 'FLOAT_IN', label: 'Float top-up', out: false },
];

/**
 * The cash drawer: what is in it, what has moved, and closing it honestly
 * (§46).
 *
 * The count is entered note by note rather than as one figure. "The drawer was
 * 200 short" and "there were no fifties in it" are different investigations,
 * and only the second one points at where the money went.
 */
export function ShiftDrawer({
  open,
  session,
  onClose,
  onChanged,
}: {
  open: boolean;
  session: any | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<'report' | 'movement' | 'close'>('report');
  const [version, setVersion] = useState(0);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [varianceReason, setVarianceReason] = useState('');
  const [movementType, setMovementType] = useState('DROP');
  const [movementAmount, setMovementAmount] = useState('');
  const [movementReason, setMovementReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState<any | null>(null);

  const report = useApi<any>(
    open && session ? `/pos/cash-sessions/${session.id}/report` : null,
    [session?.id, version],
  );

  useEffect(() => {
    if (!open) return;
    setTab('report');
    setCounts({});
    setVarianceReason('');
    setMovementAmount('');
    setMovementReason('');
    setError(null);
    setClosed(null);
  }, [open, session?.id]);

  const counted = useMemo(
    () =>
      DENOMINATIONS.reduce(
        (sum, note) => sum + note * (Number(counts[String(note)]) || 0),
        0,
      ),
    [counts],
  );

  // A blind close withholds the expected figure until the count is submitted,
  // so the cashier counts the drawer rather than the screen.
  const blind = session?.isBlindClose === true;
  const expected = report.data ? Number(report.data.expectedCash) : null;
  const variance = expected === null ? null : Number((counted - expected).toFixed(2));

  async function recordMovement() {
    setBusy(true);
    setError(null);
    try {
      await api(`/pos/cash-sessions/${session.id}/movements`, {
        method: 'POST',
        body: {
          movementType,
          amount: Number(movementAmount),
          reason: movementReason,
        },
      });
      setMovementAmount('');
      setMovementReason('');
      setVersion((v) => v + 1);
      onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function closeShift() {
    setBusy(true);
    setError(null);
    try {
      const denominations: Record<string, number> = {};
      for (const note of DENOMINATIONS) {
        const n = Number(counts[String(note)]) || 0;
        if (n > 0) denominations[String(note)] = n;
      }
      const result = await api(`/pos/cash-sessions/${session.id}/close`, {
        method: 'POST',
        body: {
          actualCash: Number(counted.toFixed(2)),
          varianceReason: varianceReason.trim() || undefined,
          denominations: Object.keys(denominations).length ? denominations : undefined,
        },
      });
      setClosed(result);
      setVersion((v) => v + 1);
      onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!session) return null;
  const r = report.data;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title={`Shift ${session.sessionNo}`}
      description={
        closed
          ? 'Closed. The Z-report below is the record of the shift.'
          : blind
            ? 'Blind close: the expected figure is withheld until you submit the count.'
            : 'Open since ' + shortDate(session.openedAt)
      }
    >
      {error && <div className="mb-3"><ErrorState message={error} /></div>}
      {report.loading && !r && <Loading label="Reading the drawer" />}

      {r && (
        <>
          <div className="mb-4 flex gap-1 border-b border-border pb-2" role="tablist">
            {([
              ['report', closed ? 'Z-report' : 'X-report'],
              ['movement', 'Cash movement'],
              ['close', 'Close shift'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                disabled={closed && key !== 'report'}
                onClick={() => setTab(key)}
                className={`rounded px-2 py-1 text-small disabled:opacity-40 ${
                  tab === key
                    ? 'bg-brand/10 font-medium text-brand-dark'
                    : 'text-ink-muted hover:bg-surface-sunken'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'report' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Sales" value={r.salesCount} sub={`${r.lineCount} line(s)`} />
                <Stat label="Takings" value={money(r.grossSales)} sub="Gross, all methods" />
                <Stat label="Margin" value={money(r.margin)} sub="After tax and cost" />
                <Stat
                  label="Expected in drawer"
                  value={blind && !closed ? 'withheld' : money(r.expectedCash)}
                  sub={blind && !closed ? 'Blind close' : 'Float, cash sales and movements'}
                />
              </div>

              <Panel title="By payment method" padded={false}>
                {r.byPaymentMethod.length === 0 ? (
                  <div className="p-4">
                    <EmptyState title="Nothing taken yet" body="Payments appear here as sales complete." />
                  </div>
                ) : (
                  <ul className="divide-y divide-border">
                    {r.byPaymentMethod.map((m: any) => (
                      <li key={m.method} className="flex justify-between px-4 py-2 text-small">
                        <span>{m.method.replace(/_/g, ' ').toLowerCase()}</span>
                        <span className="num">{money(m.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel title={`Drawer movements (${r.movements.length})`} padded={false}>
                {r.movements.length === 0 ? (
                  <div className="p-4">
                    <EmptyState
                      title="No cash has moved outside a sale"
                      body="Drops, payouts and float top-ups appear here and adjust what should be in the drawer."
                    />
                  </div>
                ) : (
                  <ul className="divide-y divide-border">
                    {r.movements.map((m: any) => (
                      <li key={m.id} className="px-4 py-2 text-small">
                        <div className="flex justify-between">
                          <span>{m.movementType.replace(/_/g, ' ').toLowerCase()}</span>
                          <span className="num">{money(m.amount)}</span>
                        </div>
                        <div className="text-caption text-ink-muted">{m.reason}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              {closed && (
                <Panel title="Reconciliation">
                  <dl className="space-y-1 text-small">
                    <Line label="Expected" value={money(r.expectedCash)} />
                    <Line label="Counted" value={money(r.countedCash ?? 0)} />
                    <Line label="Variance" value={money(r.variance ?? 0)} strong />
                  </dl>
                </Panel>
              )}
            </div>
          )}

          {tab === 'movement' && (
            <div className="space-y-3">
              <p className="text-small text-ink-muted">
                Cash that leaves or enters the drawer outside a sale. Recording it here is what keeps
                the expected figure right — without it, the variance at close lands on whoever was on
                the till rather than on whoever took the money.
              </p>
              <Field label="What happened">
                <select className="input" value={movementType} onChange={(e) => setMovementType(e.target.value)}>
                  {MOVEMENT_TYPES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Amount" required>
                <input
                  className="input num"
                  type="number"
                  step="0.01"
                  min="0"
                  value={movementAmount}
                  onChange={(e) => setMovementAmount(e.target.value)}
                />
              </Field>
              <Field label="Reason" required hint="Recorded in the audit trail.">
                <input
                  className="input"
                  value={movementReason}
                  onChange={(e) => setMovementReason(e.target.value)}
                  placeholder="e.g. Banked to the safe, counted with the branch manager"
                />
              </Field>
              <button
                className="btn-primary btn-sm"
                disabled={busy || !Number(movementAmount) || !movementReason.trim()}
                onClick={recordMovement}
              >
                {busy ? 'Recording...' : 'Record movement'}
              </button>
            </div>
          )}

          {tab === 'close' && (
            <div className="space-y-3">
              <p className="text-small text-ink-muted">
                Count the drawer note by note. The total below is what will be declared.
              </p>
              <div className="rounded-card border border-border">
                <table className="w-full text-small">
                  <thead>
                    <tr>
                      <th className="th">Note</th>
                      <th className="th text-right">Count</th>
                      <th className="th text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DENOMINATIONS.map((note) => (
                      <tr key={note}>
                        <td className="td num">{money(note)}</td>
                        <td className="td text-right">
                          <input
                            className="input num w-20 text-right"
                            type="number"
                            min="0"
                            aria-label={`Count of ${note}`}
                            value={counts[String(note)] ?? ''}
                            onChange={(e) =>
                              setCounts((c) => ({ ...c, [String(note)]: e.target.value }))
                            }
                          />
                        </td>
                        <td className="td num text-right">
                          {money(note * (Number(counts[String(note)]) || 0))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <dl className="space-y-1 rounded-card bg-surface-sunken p-3 text-small">
                <Line label="Counted" value={money(counted)} strong />
                {!blind && expected !== null && <Line label="Expected" value={money(expected)} />}
                {!blind && variance !== null && (
                  <Line
                    label="Variance"
                    value={money(variance)}
                    tone={Math.abs(variance) > 0 ? 'danger' : undefined}
                  />
                )}
                {blind && (
                  <p className="text-caption text-ink-muted">
                    The expected figure is withheld until you submit. Count what is there.
                  </p>
                )}
              </dl>

              <Field
                label="Explanation"
                hint="Required when the variance is beyond the configured tolerance."
              >
                <input
                  className="input"
                  value={varianceReason}
                  onChange={(e) => setVarianceReason(e.target.value)}
                />
              </Field>

              <button
                className="btn-primary btn-sm"
                disabled={busy || counted <= 0}
                onClick={closeShift}
              >
                {busy ? 'Closing...' : `Close shift declaring ${money(counted)}`}
              </button>
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}

function Line({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'danger';
}) {
  return (
    <div className={`flex justify-between ${strong ? 'font-semibold' : ''}`}>
      <dt className={strong ? '' : 'text-ink-muted'}>{label}</dt>
      <dd className={`num ${tone === 'danger' ? 'text-danger' : ''}`}>{value}</dd>
    </div>
  );
}
