'use client';

import { useState } from 'react';
import { Shell, PageHeader } from '@/components/Shell';
import { useApi } from '@/lib/useApi';
import { api, can, qty, shortDate, tokenStore } from '@/lib/api';
import { Card, Empty, ErrorBox, Loading, Pill, Table } from '@/components/ui';

/**
 * Patients and customers (§25).
 *
 * Clinical fields and dispensing history are withheld from roles without a
 * clinical reason to see them — the server enforces that, and this screen
 * simply does not render what it is not sent. Every record opened is audited.
 */
export default function PatientsPage() {
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const user = typeof window !== 'undefined' ? tokenStore.user : null;
  const canEdit = can(user, 'sales.patient.CREATE');
  const canSeeHistory = can(user, 'dispensing.dispensing.READ');

  const list = useApi<any>(`/patients?pageSize=50${query ? `&q=${encodeURIComponent(query)}` : ''}`, [query, message]);
  const detail = useApi<any>(selectedId ? `/patients/${selectedId}` : null, [selectedId]);
  const history = useApi<any[]>(selectedId && canSeeHistory ? `/patients/${selectedId}/history` : null, [selectedId]);

  return (
    <Shell>
      <PageHeader
        title="Patients & Customers"
        subtitle="Only what the pharmacy needs to operate. Clinical notes are restricted by role, and opening a record is audited."
        action={canEdit && <button className="btn-primary" onClick={() => setCreating((v) => !v)}>{creating ? 'Cancel' : 'Add patient'}</button>}
      />

      {error && <div className="mb-3"><ErrorBox message={error} /></div>}
      {message && <div className="mb-3 rounded-md border border-ok/30 bg-ok-light px-3 py-2 text-sm text-ok">{message}</div>}

      {creating && (
        <Card className="mb-4" title="New patient">
          <form className="grid gap-3 sm:grid-cols-3" onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              const created = await api('/patients', { method: 'POST', body: {
                fullName: f.get('fullName'), dateOfBirth: f.get('dateOfBirth') || undefined,
                sex: f.get('sex') || undefined, phone: f.get('phone') || undefined,
                city: f.get('city') || undefined, allergies: f.get('allergies') || undefined,
                emergencyContactName: f.get('ecName') || undefined,
                emergencyContactPhone: f.get('ecPhone') || undefined,
              }});
              setCreating(false); setSelectedId(created.id); setMessage(`Patient ${created.patientCode} created.`);
            } catch (e: any) { setError(e.message); }
          }}>
            <div className="sm:col-span-2"><label className="label">Full name</label><input name="fullName" className="input" required /></div>
            <div><label className="label">Date of birth</label><input name="dateOfBirth" type="date" className="input" /></div>
            <div><label className="label">Sex</label><select name="sex" className="input"><option value="">—</option><option>M</option><option>F</option></select></div>
            <div><label className="label">Phone</label><input name="phone" className="input" /></div>
            <div><label className="label">City</label><input name="city" className="input" /></div>
            <div><label className="label">Emergency contact</label><input name="ecName" className="input" /></div>
            <div><label className="label">Emergency phone</label><input name="ecPhone" className="input" /></div>
            <div><label className="label">Known allergies</label><input name="allergies" className="input" placeholder="e.g. Penicillin" /></div>
            <div className="sm:col-span-3"><button className="btn-primary">Create patient</button></div>
          </form>
        </Card>
      )}

      <Card className="mb-4">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(term); }}>
          <input className="input flex-1" placeholder="Search name, patient code or phone" value={term} onChange={(e) => setTerm(e.target.value)} />
          <button className="btn-primary">Search</button>
        </form>
      </Card>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2" title={`${list.data?.total ?? 0} patients`}>
          {list.loading && <Loading />}
          {list.data?.data?.length ? (
            <div className="max-h-[60vh] space-y-1 overflow-y-auto">
              {list.data.data.map((p: any) => (
                <button key={p.id} onClick={() => setSelectedId(p.id)}
                  className={`w-full rounded-md border p-2 text-left text-sm ${selectedId === p.id ? 'border-brand bg-brand-light' : 'border-transparent hover:bg-surface-sunken'}`}>
                  <div className="font-medium">{p.fullName}</div>
                  <div className="text-xs text-ink-subtle">
                    {p.patientCode}{p.phone ? ` · ${p.phone}` : ''}{p.city ? ` · ${p.city}` : ''}
                  </div>
                  {p.allergies && <Pill tone="danger">allergies</Pill>}
                </button>
              ))}
            </div>
          ) : (!list.loading && <Empty>No patients match.</Empty>)}
        </Card>

        <div className="lg:col-span-3">
          {!selectedId && <Card><Empty>Select a patient.</Empty></Card>}
          {detail.loading && <Loading />}
          {detail.data && (
            <div className="space-y-4">
              <Card title={detail.data.fullName}>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[['Patient code', detail.data.patientCode], ['Date of birth', shortDate(detail.data.dateOfBirth)],
                    ['Sex', detail.data.sex], ['Phone', detail.data.phone], ['City', detail.data.city],
                    ['Emergency contact', detail.data.emergencyContactName]].map(([k, v]) => (
                    <div key={String(k)}><dt className="text-xs text-ink-muted">{k}</dt><dd className="text-sm font-medium">{v || '-'}</dd></div>
                  ))}
                </dl>

                {detail.data.allergies !== undefined && (
                  <div className={`mt-3 rounded-md px-3 py-2 text-sm ${detail.data.allergies ? 'bg-danger-light text-danger' : 'bg-surface-sunken text-ink-muted'}`}>
                    <strong>Allergies:</strong> {detail.data.allergies || 'none recorded'}
                  </div>
                )}
                {detail.data.allergies === undefined && (
                  <p className="mt-3 text-xs text-ink-subtle">
                    Clinical information is not shown for your role.
                  </p>
                )}
              </Card>

              {detail.data.prescriptions && (
                <Card title={`Prescriptions (${detail.data.prescriptions.length})`}>
                  <Table head={['Number', 'Date', 'Prescriber', 'Status', 'Items']}>
                    {detail.data.prescriptions.map((p: any) => (
                      <tr key={p.id}>
                        <td className="td font-medium">{p.prescriptionNo}</td>
                        <td className="td text-ink-muted">{shortDate(p.prescriptionDate)}</td>
                        <td className="td text-xs">{p.prescriberName}</td>
                        <td className="td"><Pill tone={p.status === 'DISPENSED' ? 'ok' : 'info'}>{p.status.replace(/_/g, ' ')}</Pill></td>
                        <td className="td num">{p.items.length}</td>
                      </tr>
                    ))}
                  </Table>
                </Card>
              )}

              {canSeeHistory && history.data && (
                <Card title={`Dispensing history (${history.data.length})`}>
                  {history.data.length ? (
                    <Table head={['Dispensing', 'When', 'Prescriber', 'Items']}>
                      {history.data.map((d) => (
                        <tr key={d.id}>
                          <td className="td font-medium">{d.dispensingNo}</td>
                          <td className="td text-ink-muted">{shortDate(d.dispensedAt)}</td>
                          <td className="td text-xs">{d.prescription?.prescriberName ?? '-'}</td>
                          <td className="td num">{d.items.length}</td>
                        </tr>
                      ))}
                    </Table>
                  ) : <Empty>Nothing dispensed to this patient yet.</Empty>}
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
