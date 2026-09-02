'use client';

import { useState } from 'react';
import { Shell, PageHeader } from '@/components/Shell';
import { useApi } from '@/lib/useApi';
import { api, can, qty, shortDate, tokenStore } from '@/lib/api';
import { Card, Empty, ErrorBox, Loading, Pill, Table } from '@/components/ui';

const STATUS_TONE: Record<string, any> = {
  NEW: 'info',
  UNDER_REVIEW: 'info',
  APPROVED: 'ok',
  PARTIALLY_DISPENSED: 'warn',
  DISPENSED: 'neutral',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
};

export default function DispensingPage() {
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const user = typeof window !== 'undefined' ? tokenStore.user : null;
  const canReview = can(user, 'dispensing.prescription.APPROVE');
  const canDispense = can(user, 'dispensing.dispensing.CREATE');

  const list = useApi<any>(`/prescriptions?pageSize=25${status ? `&status=${status}` : ''}`, [status]);

  async function review(id: string, decision: 'APPROVE' | 'REJECT') {
    setError(null);
    setMessage(null);
    const reason = decision === 'REJECT' ? window.prompt('Rejection reason:') : undefined;
    if (decision === 'REJECT' && !reason) return;
    setBusy(true);
    try {
      await api(`/prescriptions/${id}/review`, { method: 'POST', body: { decision, reason } });
      setMessage(`Prescription ${decision === 'APPROVE' ? 'approved' : 'rejected'}.`);
      list.refresh();
      setSelected(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function dispense(prescription: any) {
    setError(null);
    setMessage(null);
    const branches = await api<any[]>('/admin/branches').catch(() => []);
    const branch = branches.find((b) => b.id === prescription.branchId) ?? branches[0];
    const warehouseId = branch?.warehouses.find((w: any) => !w.isColdRoom)?.id;
    if (!warehouseId) {
      setError('No warehouse is available for this branch.');
      return;
    }

    const outstanding = prescription.items
      .filter((i: any) => Number(i.prescribedQty) > Number(i.dispensedQty))
      .map((i: any) => ({
        productId: i.productId,
        prescriptionItemId: i.id,
        quantity: Number(i.prescribedQty) - Number(i.dispensedQty),
      }));

    if (!outstanding.length) {
      setError('Everything on this prescription has already been dispensed.');
      return;
    }

    setBusy(true);
    try {
      // Batches are left to FEFO: no batchId is supplied.
      const result = await api('/dispensing', {
        method: 'POST',
        body: {
          prescriptionId: prescription.id,
          patientId: prescription.patientId,
          branchId: prescription.branchId,
          warehouseId,
          lines: outstanding,
          idempotencyKey: `dsp-${prescription.id}-${Date.now()}`,
        },
      });
      setMessage(
        `Dispensed as ${result.dispensingNo}. FEFO selected ${result.items.length} batch line(s).`,
      );
      list.refresh();
      setSelected(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Prescriptions & Dispensing"
        subtitle="Dispensing allocates the nearest valid expiry automatically and records the batch against the patient."
        action={
          <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {Object.keys(STATUS_TONE).map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
            ))}
          </select>
        }
      />

      {message && (
        <div className="mb-3 rounded-md border border-ok/30 bg-ok-light px-3 py-2 text-sm text-ok">{message}</div>
      )}
      {error && <div className="mb-3"><ErrorBox message={error} /></div>}
      {list.error && <ErrorBox message={list.error} />}
      {list.loading && <Loading />}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Prescriptions" className="lg:col-span-2">
          {list.data?.data?.length ? (
            <Table head={['Number', 'Patient', 'Prescriber', 'Date', 'Status', 'Items', '']}>
              {list.data.data.map((p: any) => (
                <tr key={p.id}>
                  <td className="td font-medium">{p.prescriptionNo}</td>
                  <td className="td">
                    {p.patient?.fullName}
                    <div className="text-xs text-ink-subtle">{p.patient?.patientCode}</div>
                  </td>
                  <td className="td text-ink-muted">{p.prescriberName}</td>
                  <td className="td text-ink-muted">{shortDate(p.prescriptionDate)}</td>
                  <td className="td"><Pill tone={STATUS_TONE[p.status]}>{p.status.replace(/_/g, ' ')}</Pill></td>
                  <td className="td num">{p.items.length}</td>
                  <td className="td">
                    <button className="btn-ghost text-xs" onClick={() => setSelected(p)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            !list.loading && <Empty>No prescriptions match this filter.</Empty>
          )}
        </Card>

        <Card title="Selected prescription">
          {!selected && <Empty>Choose a prescription to review or dispense.</Empty>}
          {selected && (
            <div className="space-y-3 text-sm">
              <div>
                <div className="font-semibold">{selected.prescriptionNo}</div>
                <div className="text-ink-muted">{selected.patient?.fullName}</div>
                <div className="text-xs text-ink-subtle">
                  {selected.prescriberName}
                  {selected.facilityName ? ` · ${selected.facilityName}` : ''}
                </div>
                <div className="mt-1"><Pill tone={STATUS_TONE[selected.status]}>{selected.status.replace(/_/g, ' ')}</Pill></div>
              </div>

              <div className="space-y-2">
                {selected.items.map((i: any) => (
                  <div key={i.id} className="rounded-md bg-surface-sunken p-2">
                    <div className="font-medium">{i.dosage} · {i.frequency}</div>
                    <div className="text-xs text-ink-muted">
                      Prescribed {qty(i.prescribedQty)} · dispensed {qty(i.dispensedQty)}
                      {i.durationDays ? ` · ${i.durationDays} days` : ''}
                    </div>
                    {i.instructions && <div className="mt-0.5 text-xs text-ink-subtle">{i.instructions}</div>}
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                {canReview && ['NEW', 'UNDER_REVIEW'].includes(selected.status) && (
                  <>
                    <button className="btn-primary" disabled={busy} onClick={() => review(selected.id, 'APPROVE')}>
                      Approve
                    </button>
                    <button className="btn-ghost" disabled={busy} onClick={() => review(selected.id, 'REJECT')}>
                      Reject
                    </button>
                  </>
                )}
                {canDispense && ['APPROVED', 'PARTIALLY_DISPENSED'].includes(selected.status) && (
                  <button className="btn-primary" disabled={busy} onClick={() => dispense(selected)}>
                    {busy ? 'Dispensing...' : 'Dispense with FEFO'}
                  </button>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </Shell>
  );
}
