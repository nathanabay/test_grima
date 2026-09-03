'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Shell, PageHeader } from '@/components/Shell';
import { useApi } from '@/lib/useApi';
import { usePaged } from '@/lib/paged';
import { useScope } from '@/lib/scope';
import { api, can, qty, shortDate, tokenStore } from '@/lib/api';
import { Card, Empty, ErrorBox, Loading, Pager, Pill, Table } from '@/components/ui';
import { StatusBadge } from '@/components/status';
import { Drawer, Field, Stat, Toolbar } from '@/components/primitives';
import {
  ClinicalWarnings,
  criticalWarningsAcknowledged,
  type ClinicalWarning,
} from '@/components/dispensing/ClinicalWarnings';
import { DispensingLabel, type LabelItem } from '@/components/dispensing/Label';
import { PrescriptionForm } from '@/components/dispensing/PrescriptionForm';
import { SubstitutePicker } from '@/components/dispensing/SubstitutePicker';

const STATUS_TONE: Record<string, any> = {
  NEW: 'info',
  UNDER_REVIEW: 'info',
  APPROVED: 'ok',
  PARTIALLY_DISPENSED: 'warn',
  READY_FOR_COLLECTION: 'ok',
  DISPENSED: 'neutral',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
  EXPIRED: 'danger',
};

const STATUSES = Object.keys(STATUS_TONE);

/** Minutes → "2h 05m", because "125" makes a queue unreadable. */
function waiting(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

interface LineState {
  /** The prescription line this supplies. */
  prescriptionItemId: string;
  /** What is actually being handed over — may differ from what was prescribed. */
  productId: string;
  productLabel: string;
  prescribedProductId: string;
  prescribedName: string;
  /** Whether the prescriber allowed an equivalent for this line. */
  allowSubstitution: boolean;
  directions: string;
  quantity: string;
  substitutionReason: string;
  include: boolean;
}

/** "Amoxicillin 500 mg (Amoxil)" — as much as fits, in the order a pharmacist reads it. */
function productLabel(product: any): string | null {
  if (!product) return null;
  return [product.genericName, product.strength, product.brandName ? `(${product.brandName})` : null]
    .filter(Boolean)
    .join(' ');
}

export default function DispensingPage() {
  // The branch context lives inside the Shell's provider, so the body has to be
  // a child of it rather than the page component itself.
  return (
    <Shell>
      <DispensingBody />
    </Shell>
  );
}

function DispensingBody() {
  const user = typeof window !== 'undefined' ? tokenStore.user : null;
  const canReview = can(user, 'dispensing.prescription.APPROVE');
  const canDispense = can(user, 'dispensing.dispensing.CREATE');
  const canCreate = can(user, 'dispensing.prescription.CREATE');
  const canCancel = can(user, 'dispensing.prescription.CANCEL');
  const canReverse = can(user, 'dispensing.dispensing.CANCEL');
  const canPrint = can(user, 'dispensing.dispensing.PRINT');

  const { branchId, branch, branches, warehouses, defaultWarehouseId } = useScope();

  const [view, setView] = useState<'queue' | 'all'>('queue');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [creating, setCreating] = useState(false);
  const [dispensingOpen, setDispensingOpen] = useState(false);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [label, setLabel] = useState<any | null>(null);

  // Dispensing form state
  const [lines, setLines] = useState<LineState[]>([]);
  const [warnings, setWarnings] = useState<ClinicalWarning[] | null>(null);
  const [allocation, setAllocation] = useState<any[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [counselling, setCounselling] = useState('');
  const [witnessId, setWitnessId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [previewing, setPreviewing] = useState(false);

  /**
   * One key per attempt at one dispensing, generated when the panel opens.
   *
   * The old screen used `dsp-${id}-${Date.now()}`, which is a different key on
   * every click — so a retry after a network error that had in fact succeeded
   * dispensed the medicine to the patient a second time. The key is stable for
   * as long as the pharmacist is working on this supply, and only a completed
   * dispensing clears it.
   */
  const idempotencyKey = useRef<string>('');

  const queue = useApi<any>(
    view === 'queue' ? `/prescriptions/queue${branchId ? `?branchId=${branchId}` : ''}` : null,
    [view, branchId],
  );
  // The All tab reads one page at a time. It used to fetch the first 25 and
  // stop, so a pharmacist looking for a prescription filed last week was told,
  // silently, that it did not exist.
  const list = usePaged<any>(view === 'all' ? '/prescriptions' : null, {
    filters: [
      status ? `status=${status}` : '',
      search.trim() ? `search=${encodeURIComponent(search.trim())}` : '',
      branchId ? `branchId=${branchId}` : '',
    ]
      .filter(Boolean)
      .join('&'),
    pageSize: 25,
  });
  const today = useApi<any>(
    `/dispensing/summary/today${branchId ? `?branchId=${branchId}` : ''}`,
    [branchId],
  );
  const selected = useApi<any>(selectedId ? `/prescriptions/${selectedId}` : null, [selectedId]);
  const history = useApi<any>(historyFor ? `/dispensing/patient/${historyFor}` : null, [
    historyFor,
  ]);

  const rows = view === 'queue' ? (queue.data?.data ?? []) : list.rows;
  const loading = view === 'queue' ? queue.loading : list.loading;
  const listError = view === 'queue' ? queue.error : list.error;

  const refreshLists = useCallback(() => {
    queue.refresh();
    list.refresh();
    today.refresh();
    selected.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.refresh, list.refresh, today.refresh, selected.refresh]);

  const prescription = selected.data;

  // The warehouse to pick from. A cold room is not the default: most supplies
  // come off the general shelf, and picking the wrong store shows an empty
  // batch list rather than an error anybody can act on.
  const branchWarehouses = useMemo(() => {
    // The prescription's own branch wins: a pharmacist covering two sites
    // dispenses from the branch the prescription was taken in, not from
    // whichever branch the header happens to be showing.
    const b = branches.find((x) => x.id === (prescription?.branchId ?? branchId)) ?? branch;
    return b?.warehouses ?? warehouses;
  }, [branches, branch, branchId, warehouses, prescription?.branchId]);

  useEffect(() => {
    if (warehouseId && branchWarehouses.some((w) => w.id === warehouseId)) return;
    // Never a cold room by default: most supplies come off the general shelf,
    // and defaulting to the freezer shows an empty batch list.
    setWarehouseId(
      branchWarehouses.find((w) => !w.isColdRoom)?.id ??
        branchWarehouses[0]?.id ??
        defaultWarehouseId ??
        "",
    );
  }, [branchWarehouses, warehouseId, defaultWarehouseId]);

  function openDispensing() {
    if (!prescription) return;
    setError(null);
    setMessage(null);
    setWarnings(null);
    setAllocation([]);
    setOverrides({});
    setCounselling('');
    setWitnessId('');
    idempotencyKey.current = `dsp-${prescription.id}-${
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2)
    }`;
    setLines(
      (prescription.items ?? [])
        .filter((i: any) => Number(i.prescribedQty) > Number(i.dispensedQty))
        .map((i: any) => {
          const name = productLabel(i.product) ?? 'Medicine';
          return {
            prescriptionItemId: i.id,
            productId: i.productId,
            productLabel: name,
            prescribedProductId: i.productId,
            prescribedName: name,
            allowSubstitution: i.allowSubstitution !== false,
            directions:
              [i.dosage, i.frequency].filter(Boolean).join(' · ') || 'No directions given',
            quantity: String(Number(i.prescribedQty) - Number(i.dispensedQty)),
            substitutionReason: '',
            include: true,
          };
        }),
    );
    setDispensingOpen(true);
  }

  const activeLines = lines.filter((l) => l.include && Number(l.quantity) > 0);

  function dispensePayload() {
    return {
      prescriptionId: prescription.id,
      patientId: prescription.patientId,
      branchId: prescription.branchId,
      warehouseId,
      counsellingNotes: counselling.trim() || undefined,
      witnessedById: witnessId.trim() || undefined,
      overrides: Object.entries(overrides)
        .filter(([, reason]) => reason.trim())
        .map(([code, reason]) => ({ code, reason: reason.trim() })),
      lines: activeLines.map((l) => ({
        productId: l.productId,
        prescriptionItemId: l.prescriptionItemId,
        quantity: Number(l.quantity),
        substitutionReason:
          l.productId !== l.prescribedProductId ? l.substitutionReason.trim() : undefined,
      })),
    };
  }

  async function runPreview() {
    if (!prescription || !activeLines.length) return;
    setError(null);
    setPreviewing(true);
    try {
      const result = await api<any>('/dispensing/preview', {
        method: 'POST',
        body: dispensePayload(),
      });
      setWarnings(result.warnings ?? []);
      setAllocation(result.allocation ?? []);
    } catch (e: any) {
      setError(e.message);
      setWarnings(null);
    } finally {
      setPreviewing(false);
    }
  }

  async function dispense() {
    if (!prescription) return;
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const result = await api<any>('/dispensing', {
        method: 'POST',
        body: { ...dispensePayload(), idempotencyKey: idempotencyKey.current },
      });
      setMessage(`Dispensed as ${result.dispensingNo}.`);
      setDispensingOpen(false);
      idempotencyKey.current = '';
      refreshLists();
      void showLabel(result.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * The label is assembled by the server in one read, so the product, batch and
   * expiry on it always belong to the same row.
   */
  async function showLabel(dispensingId: string) {
    try {
      setLabel(await api<any>(`/dispensing/${dispensingId}/label`));
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function act(path: string, body?: any, note?: string) {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const result = await api<any>(path, { method: 'POST', body });
      setMessage(note ?? 'Done.');
      refreshLists();
      return result;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  const canSubmitDispense =
    !!warnings && criticalWarningsAcknowledged(warnings, overrides) && activeLines.length > 0;

  return (
    <>
      <PageHeader
        title="Prescriptions & Dispensing"
        subtitle="FEFO picks the nearest valid expiry. The clinical checks are advisory — the pharmacist decides, and the decision is recorded."
        action={
          canCreate ? (
            <button className="btn-primary" onClick={() => setCreating(true)}>
              New prescription
            </button>
          ) : undefined
        }
      />

      {message && (
        <div
          className="mb-3 rounded-md border border-ok/30 bg-ok-light px-3 py-2 text-sm text-ok"
          role="status"
        >
          {message}
        </div>
      )}
      {error && (
        <div className="mb-3">
          <ErrorBox message={error} />
        </div>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Waiting" value={String(queue.data?.counts?.total ?? '—')} />
        <Stat label="Urgent" value={String(queue.data?.counts?.urgent ?? '—')} />
        <Stat
          label="Awaiting collection"
          value={String(queue.data?.counts?.awaitingCollection ?? '—')}
        />
        <Stat label="Dispensed today" value={String(today.data?.dispensings ?? '—')} />
      </div>

      <Toolbar
        actions={
          view === 'all' ? (
            <>
              <input
                className="input w-auto"
                placeholder="Number, patient or prescriber"
                aria-label="Search prescriptions"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                className="input w-auto"
                aria-label="Status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">All statuses</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </>
          ) : undefined
        }
      >
        <div className="flex gap-1" role="tablist" aria-label="Prescription view">
          <button
            role="tab"
            aria-selected={view === 'queue'}
            className={view === 'queue' ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}
            onClick={() => setView('queue')}
          >
            Queue
          </button>
          <button
            role="tab"
            aria-selected={view === 'all'}
            className={view === 'all' ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}
            onClick={() => setView('all')}
          >
            All prescriptions
          </button>
        </div>
      </Toolbar>

      {listError && <ErrorBox message={listError} />}
      {loading && <Loading />}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={view === 'queue' ? 'Dispensing queue' : 'Prescriptions'} className="lg:col-span-2">
          {rows.length ? (
            <Table
              head={[
                'Number',
                'Patient',
                'Prescriber',
                view === 'queue' ? 'Waiting' : 'Date',
                'Status',
                'Items',
                '',
              ]}
            >
              {rows.map((p: any) => (
                <tr key={p.id} className={p.isUrgent ? 'bg-warn-light' : undefined}>
                  <td className="td font-medium">
                    {p.prescriptionNo}
                    {p.isUrgent && (
                      <span className="ml-1">
                        <StatusBadge tone="near">Urgent</StatusBadge>
                      </span>
                    )}
                  </td>
                  <td className="td">
                    {p.patient?.fullName}
                    <div className="text-xs text-ink-subtle">{p.patient?.patientCode}</div>
                  </td>
                  <td className="td text-ink-muted">{p.prescriberName}</td>
                  <td className="td text-ink-muted">
                    {view === 'queue' ? waiting(p.waitingMinutes) : shortDate(p.prescriptionDate)}
                  </td>
                  <td className="td">
                    <Pill tone={p.isExpired ? 'danger' : STATUS_TONE[p.status]}>
                      {p.isExpired ? 'EXPIRED' : p.status.replace(/_/g, ' ')}
                    </Pill>
                  </td>
                  <td className="td num">
                    {view === 'queue' && p.outstandingItems !== undefined
                      ? `${p.outstandingItems}/${p.items.length}`
                      : p.items.length}
                  </td>
                  <td className="td">
                    <button className="btn-ghost text-xs" onClick={() => setSelectedId(p.id)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            !loading && (
              <Empty>
                {view === 'queue'
                  ? 'Nothing is waiting. The queue is clear.'
                  : 'No prescriptions match this filter.'}
              </Empty>
            )
          )}
          {view === 'all' && (
            <Pager
              page={list.page}
              pageSize={list.pageSize}
              total={list.total}
              onPage={list.setPage}
              loading={list.loading}
              noun="prescription"
            />
          )}
        </Card>

        <Card title="Selected prescription">
          {!selectedId && <Empty>Choose a prescription to review or dispense.</Empty>}
          {selected.loading && <Loading />}
          {selected.error && <ErrorBox message={selected.error} />}
          {prescription && (
            <div className="space-y-3 text-sm">
              <div>
                <div className="font-semibold">{prescription.prescriptionNo}</div>
                <div className="text-ink-muted">{prescription.patient?.fullName}</div>
                <div className="text-xs text-ink-subtle">
                  {prescription.prescriberName}
                  {prescription.facilityName ? ` · ${prescription.facilityName}` : ''}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <Pill tone={STATUS_TONE[prescription.status]}>
                    {prescription.status.replace(/_/g, ' ')}
                  </Pill>
                  {prescription.isExpired && <Pill tone="danger">EXPIRED</Pill>}
                  {prescription.isUrgent && <Pill tone="warn">URGENT</Pill>}
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-2 text-xs text-ink-muted">
                  <dt>Written</dt>
                  <dd className="text-right">{shortDate(prescription.prescriptionDate)}</dd>
                  <dt>Valid until</dt>
                  <dd className="text-right">
                    {prescription.validUntil ? shortDate(prescription.validUntil) : '—'}
                  </dd>
                  <dt>Repeats left</dt>
                  <dd className="text-right">{prescription.refillsRemaining ?? 0}</dd>
                  {prescription.collectedAt && (
                    <>
                      <dt>Collected</dt>
                      <dd className="text-right">
                        {shortDate(prescription.collectedAt)} · {prescription.collectedBy}
                      </dd>
                    </>
                  )}
                </dl>
              </div>

              <div className="space-y-2">
                {prescription.items.map((i: any) => (
                  <div key={i.id} className="rounded-md bg-surface-sunken p-2">
                    <div className="font-medium">{productLabel(i.product) ?? 'Medicine'}</div>
                    <div className="text-xs">
                      {[i.dosage, i.frequency].filter(Boolean).join(' · ') || 'No directions given'}
                    </div>
                    <div className="text-xs text-ink-muted">
                      Prescribed {qty(i.prescribedQty)} · dispensed {qty(i.dispensedQty)}
                      {i.durationDays ? ` · ${i.durationDays} days` : ''}
                    </div>
                    {i.instructions && (
                      <div className="mt-0.5 text-xs text-ink-subtle">{i.instructions}</div>
                    )}
                    {!i.allowSubstitution && (
                      <div className="mt-0.5 text-xs font-medium text-warn">Do not substitute</div>
                    )}
                  </div>
                ))}
              </div>

              {prescription.dispensings?.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase text-ink-subtle">Supplies</h3>
                  <ul className="mt-1 space-y-1">
                    {prescription.dispensings.map((d: any) => (
                      <li
                        key={d.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1 text-xs"
                      >
                        <span>
                          {d.dispensingNo} · {shortDate(d.dispensedAt)}
                          {d.reversedAt && (
                            <span className="ml-1 font-medium text-danger">reversed</span>
                          )}
                        </span>
                        <span className="flex gap-1">
                          {canPrint && (
                            <button className="btn-quiet btn-sm" onClick={() => showLabel(d.id)}>
                              Label
                            </button>
                          )}
                          {canReverse && !d.reversedAt && (
                            <button
                              className="btn-quiet btn-sm"
                              disabled={busy}
                              onClick={() => {
                                const reason = window.prompt('Why is this supply being reversed?');
                                if (!reason?.trim()) return;
                                void act(
                                  `/dispensing/${d.id}/reverse`,
                                  { reason: reason.trim(), returnToStock: true },
                                  `${d.dispensingNo} reversed and the stock put back.`,
                                );
                              }}
                            >
                              Reverse
                            </button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {canReview && ['NEW', 'UNDER_REVIEW'].includes(prescription.status) && (
                  <>
                    <button
                      className="btn-primary"
                      disabled={busy}
                      onClick={() =>
                        act(
                          `/prescriptions/${prescription.id}/review`,
                          { decision: 'APPROVE' },
                          'Prescription approved.',
                        )
                      }
                    >
                      Approve
                    </button>
                    <button
                      className="btn-ghost"
                      disabled={busy}
                      onClick={() => {
                        const reason = window.prompt('Rejection reason:');
                        if (!reason?.trim()) return;
                        void act(
                          `/prescriptions/${prescription.id}/review`,
                          { decision: 'REJECT', reason: reason.trim() },
                          'Prescription rejected.',
                        );
                      }}
                    >
                      Reject
                    </button>
                  </>
                )}

                {canDispense &&
                  ['APPROVED', 'PARTIALLY_DISPENSED'].includes(prescription.status) && (
                    <button className="btn-primary" disabled={busy} onClick={openDispensing}>
                      Dispense
                    </button>
                  )}

                {canDispense &&
                  ['PARTIALLY_DISPENSED', 'DISPENSED'].includes(prescription.status) &&
                  !prescription.readyAt && (
                    <button
                      className="btn-ghost"
                      disabled={busy}
                      onClick={() =>
                        act(
                          `/prescriptions/${prescription.id}/ready`,
                          undefined,
                          'Marked ready for collection.',
                        )
                      }
                    >
                      Ready for collection
                    </button>
                  )}

                {canDispense &&
                  ['READY_FOR_COLLECTION', 'DISPENSED', 'PARTIALLY_DISPENSED'].includes(
                    prescription.status,
                  ) &&
                  !prescription.collectedAt && (
                    <button
                      className="btn-ghost"
                      disabled={busy}
                      onClick={() => {
                        const who = window.prompt('Who is collecting? (name)');
                        if (!who?.trim()) return;
                        void act(
                          `/prescriptions/${prescription.id}/collect`,
                          { collectedBy: who.trim() },
                          'Collection recorded.',
                        );
                      }}
                    >
                      Record collection
                    </button>
                  )}

                {canCreate &&
                  (prescription.refillsRemaining ?? 0) > 0 &&
                  ['DISPENSED', 'READY_FOR_COLLECTION'].includes(prescription.status) && (
                    <button
                      className="btn-ghost"
                      disabled={busy}
                      onClick={async () => {
                        const created = await act(
                          `/prescriptions/${prescription.id}/refill`,
                          undefined,
                          'Repeat issued as a new prescription.',
                        );
                        if (created?.id) setSelectedId(created.id);
                      }}
                    >
                      Issue repeat
                    </button>
                  )}

                {canCancel &&
                  ['NEW', 'UNDER_REVIEW', 'APPROVED'].includes(prescription.status) && (
                    <button
                      className="btn-ghost"
                      disabled={busy}
                      onClick={() => {
                        const reason = window.prompt('Why is it being cancelled?');
                        if (!reason?.trim()) return;
                        void act(
                          `/prescriptions/${prescription.id}/cancel`,
                          { reason: reason.trim() },
                          'Prescription cancelled.',
                        );
                      }}
                    >
                      Cancel
                    </button>
                  )}

                <button
                  className="btn-ghost"
                  onClick={() => setHistoryFor(prescription.patientId)}
                >
                  Patient history
                </button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* ---- Dispensing panel ---- */}
      <Drawer
        open={dispensingOpen}
        onClose={() => setDispensingOpen(false)}
        title={`Dispense ${prescription?.prescriptionNo ?? ''}`}
        description="Check what will be supplied, run the clinical checks, then confirm."
        width="xl"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-caption text-ink-muted">
              {warnings
                ? canSubmitDispense
                  ? 'Ready to supply'
                  : 'Every critical warning needs a reason'
                : 'Run the checks before supplying'}
            </span>
            <span className="flex gap-2">
              <button className="btn-ghost" onClick={() => setDispensingOpen(false)} disabled={busy}>
                Cancel
              </button>
              <button
                className="btn-ghost"
                onClick={runPreview}
                disabled={previewing || !activeLines.length}
              >
                {previewing ? 'Checking…' : 'Run checks'}
              </button>
              <button
                className="btn-primary"
                onClick={dispense}
                disabled={busy || !canSubmitDispense}
              >
                {busy ? 'Dispensing…' : 'Dispense'}
              </button>
            </span>
          </div>
        }
      >
        <div className="space-y-4">
          {error && <ErrorBox message={error} />}

          <Field label="Pick from" required>
            <select
              className="input"
              value={warehouseId}
              onChange={(e) => {
                setWarehouseId(e.target.value);
                setWarnings(null);
              }}
            >
              {branchWarehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>

          <section className="space-y-2">
            <h3 className="text-small font-semibold">What is being supplied</h3>
            {lines.length === 0 && (
              <Empty>Everything on this prescription has already been supplied.</Empty>
            )}
            {lines.map((line, index) => (
              <div key={line.prescriptionItemId} className="rounded-md border border-border p-3">
                <label className="flex items-start gap-2 text-small font-medium">
                  <input
                    className="mt-1"
                    type="checkbox"
                    checked={line.include}
                    onChange={(e) => {
                      setLines((c) =>
                        c.map((l, i) => (i === index ? { ...l, include: e.target.checked } : l)),
                      );
                      setWarnings(null);
                    }}
                  />
                  <span>
                    {line.productLabel}
                    <span className="block text-caption font-normal text-ink-muted">
                      {line.directions}
                    </span>
                    {line.productId !== line.prescribedProductId && (
                      <span className="block text-caption font-normal text-warn">
                        Substituted for {line.prescribedName}
                      </span>
                    )}
                    {!line.allowSubstitution && (
                      <span className="block text-caption font-normal text-warn">
                        Do not substitute
                      </span>
                    )}
                  </span>
                </label>

                {line.allowSubstitution && (
                  <div className="mt-2">
                    <SubstitutePicker
                      prescribedProductId={line.prescribedProductId}
                      currentProductId={line.productId}
                      onPick={(productId, name) => {
                        setLines((c) =>
                          c.map((l, i) =>
                            i === index
                              ? {
                                  ...l,
                                  productId,
                                  productLabel: name,
                                  substitutionReason:
                                    productId === l.prescribedProductId
                                      ? ''
                                      : l.substitutionReason,
                                }
                              : l,
                          ),
                        );
                        setWarnings(null);
                      }}
                    />
                  </div>
                )}
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <Field label="Quantity">
                    <input
                      className="input"
                      type="number"
                      min={0}
                      step="any"
                      value={line.quantity}
                      onChange={(e) => {
                        setLines((c) =>
                          c.map((l, i) => (i === index ? { ...l, quantity: e.target.value } : l)),
                        );
                        setWarnings(null);
                      }}
                    />
                  </Field>
                  {line.productId !== line.prescribedProductId && (
                    <Field label="Substitution reason" required>
                      <input
                        className="input"
                        value={line.substitutionReason}
                        onChange={(e) =>
                          setLines((c) =>
                            c.map((l, i) =>
                              i === index ? { ...l, substitutionReason: e.target.value } : l,
                            ),
                          )
                        }
                      />
                    </Field>
                  )}
                </div>

                {allocation
                  .filter((a) => a.productId === line.productId)
                  .map((a) => (
                    <div key={a.productId} className="mt-2 text-caption">
                      {a.fullyAllocated ? (
                        <ul className="space-y-0.5">
                          {a.batches.map((b: any) => (
                            <li key={b.batchId} className="flex justify-between">
                              <span>
                                Batch {b.batchNumber ?? b.batchId.slice(0, 8)}
                                {b.expiryDate && ` · expires ${shortDate(b.expiryDate)}`}
                              </span>
                              <span className="num">{qty(b.quantity)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-danger">
                          Only {qty(a.allocatedQuantity)} of {qty(a.requested)} can be allocated
                          from this warehouse.
                        </p>
                      )}
                    </div>
                  ))}
              </div>
            ))}
          </section>

          {warnings && (
            <section>
              <ClinicalWarnings
                warnings={warnings}
                overrides={overrides}
                onOverrideChange={(code, reason) =>
                  setOverrides((c) => ({ ...c, [code]: reason }))
                }
              />
            </section>
          )}

          <Field
            label="Counselling"
            hint="What you actually told the patient. A note that only says “counselled” records nothing."
          >
            <textarea
              className="input min-h-[64px]"
              value={counselling}
              onChange={(e) => setCounselling(e.target.value)}
            />
          </Field>

          <Field
            label="Witness (user id)"
            hint="Required for a controlled supply where this pharmacy asks for one. It cannot be you."
          >
            <input
              className="input"
              value={witnessId}
              onChange={(e) => setWitnessId(e.target.value)}
            />
          </Field>
        </div>
      </Drawer>

      {/* ---- Label ---- */}
      {label && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-4">
          <div className="mt-8">
            <DispensingLabel
              items={label.items as LabelItem[]}
              patientName={label.patientName}
              patientCode={label.patientCode}
              dispensingNo={label.dispensingNo}
              dispensedAt={label.dispensedAt}
              pharmacistName={label.pharmacistName}
              branchName={label.branchName}
              branchPhone={label.branchPhone}
              printCount={label.labelPrintCount}
              onPrint={async () => {
                // Counted server-side first: a reprint that the record does not
                // know about is exactly the one worth knowing about.
                if (canPrint) {
                  await api(`/dispensing/${label.dispensingId}/label`, { method: 'POST' }).catch(
                    () => undefined,
                  );
                  setLabel((c: any) =>
                    c ? { ...c, labelPrintCount: (c.labelPrintCount ?? 0) + 1 } : c,
                  );
                }
                window.print();
              }}
              onClose={() => setLabel(null)}
            />
          </div>
        </div>
      )}

      {/* ---- Patient history ---- */}
      <Drawer
        open={!!historyFor}
        onClose={() => setHistoryFor(null)}
        title="Medication history"
        description="Everything supplied to this patient from the branches you can see."
        width="lg"
      >
        {history.loading && <Loading />}
        {history.error && <ErrorBox message={history.error} />}
        {history.data?.data?.length ? (
          <ul className="space-y-2">
            {history.data.data.map((d: any) => (
              <li key={d.id} className="rounded-md border border-border p-3 text-small">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{d.dispensingNo}</span>
                  <span className="text-caption text-ink-muted">{shortDate(d.dispensedAt)}</span>
                </div>
                {d.reversedAt && (
                  <p className="text-caption font-medium text-danger">
                    Reversed {shortDate(d.reversedAt)}
                  </p>
                )}
                <ul className="mt-1 space-y-0.5 text-caption text-ink-muted">
                  {d.items.map((i: any, n: number) => (
                    <li key={n}>
                      {i.product?.genericName ?? i.productId.slice(0, 8)} {i.product?.strength} ·{' '}
                      {qty(i.quantity)}
                    </li>
                  ))}
                </ul>
                {d.counsellingNotes && (
                  <p className="mt-1 text-caption text-ink-subtle">{d.counsellingNotes}</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          !history.loading && <Empty>Nothing has been supplied to this patient yet.</Empty>
        )}
      </Drawer>

      <PrescriptionForm
        open={creating}
        onClose={() => setCreating(false)}
        branchId={branchId ?? prescription?.branchId ?? null}
        onCreated={(created) => {
          setCreating(false);
          setMessage(`Prescription ${created.prescriptionNo} recorded. It still needs validation.`);
          setSelectedId(created.id);
          refreshLists();
        }}
      />
    </>
  );
}
