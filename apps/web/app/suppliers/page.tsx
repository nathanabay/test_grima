'use client';

import { useState } from 'react';
import { Shell, PageHeader } from '@/components/Shell';
import { useApi } from '@/lib/useApi';
import { api, can, money, shortDate, tokenStore } from '@/lib/api';
import { Card, Empty, ErrorBox, Loading, Pill, Table } from '@/components/ui';
import { DocumentsTab } from '@/components/DocumentsTab';

export default function SuppliersPage() {
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'Profile' | 'Products' | 'Orders' | 'Documents'>('Profile');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const user = typeof window !== 'undefined' ? tokenStore.user : null;
  const canEdit = can(user, 'procurement.supplier.CREATE');

  const list = useApi<any>(`/suppliers?pageSize=50${query ? `&q=${encodeURIComponent(query)}` : ''}`, [query]);
  const detail = useApi<any>(selectedId ? `/suppliers/${selectedId}` : null, [selectedId]);

  async function create(form: FormData) {
    setError(null);
    try {
      const created = await api('/suppliers', {
        method: 'POST',
        body: {
          code: String(form.get('code')),
          companyName: String(form.get('companyName')),
          contactName: String(form.get('contactName') || '') || null,
          phone: String(form.get('phone') || '') || null,
          email: String(form.get('email') || '') || null,
          city: String(form.get('city') || '') || null,
          country: 'ET',
          licenseNumber: String(form.get('licenseNumber') || '') || null,
          licenseExpiry: form.get('licenseExpiry') ? new Date(String(form.get('licenseExpiry'))) : null,
          paymentTerms: String(form.get('paymentTerms') || 'NET30'),
          leadTimeDays: Number(form.get('leadTimeDays') || 14),
        },
      });
      setCreating(false);
      list.refresh();
      setSelectedId(created.id);
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Suppliers"
        subtitle="Profiles, performance scores computed from actual receipts, and regulatory documents."
        action={
          canEdit && (
            <button className="btn-primary" onClick={() => setCreating((v) => !v)}>
              {creating ? 'Cancel' : 'Add supplier'}
            </button>
          )
        }
      />

      {error && <div className="mb-3"><ErrorBox message={error} /></div>}

      {creating && (
        <Card className="mb-4" title="New supplier">
          <form
            className="grid gap-3 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              void create(new FormData(e.currentTarget));
            }}
          >
            <div><label className="label">Code</label><input name="code" className="input" required /></div>
            <div className="sm:col-span-2"><label className="label">Company name</label><input name="companyName" className="input" required /></div>
            <div><label className="label">Contact</label><input name="contactName" className="input" /></div>
            <div><label className="label">Phone</label><input name="phone" className="input" /></div>
            <div><label className="label">Email</label><input name="email" type="email" className="input" /></div>
            <div><label className="label">City</label><input name="city" className="input" /></div>
            <div><label className="label">Import licence no.</label><input name="licenseNumber" className="input" /></div>
            <div><label className="label">Licence expiry</label><input name="licenseExpiry" type="date" className="input" /></div>
            <div><label className="label">Payment terms</label>
              <select name="paymentTerms" className="input">
                {['NET15', 'NET30', 'NET45', 'NET60'].map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div><label className="label">Lead time (days)</label><input name="leadTimeDays" type="number" min={1} defaultValue={14} className="input" /></div>
            <div className="sm:col-span-3"><button className="btn-primary">Create supplier</button></div>
          </form>
        </Card>
      )}

      <Card className="mb-4">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(term); }}>
          <input
            className="input flex-1"
            placeholder="Search by company, code or contact"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          <button className="btn-primary">Search</button>
        </form>
      </Card>

      {list.loading && <Loading />}
      {list.error && <ErrorBox message={list.error} />}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2" title={`${list.data?.total ?? 0} suppliers`}>
          {list.data?.data?.length ? (
            <div className="max-h-[70vh] space-y-1 overflow-y-auto">
              {list.data.data.map((s: any) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className={`w-full rounded-md border p-2 text-left text-sm ${
                    selectedId === s.id ? 'border-brand bg-brand-light' : 'border-transparent hover:bg-surface-sunken'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{s.companyName}</span>
                    <Pill tone={Number(s.supplierScore) >= 75 ? 'ok' : Number(s.supplierScore) >= 55 ? 'warn' : 'danger'}>
                      {Number(s.supplierScore).toFixed(0)}
                    </Pill>
                  </div>
                  <div className="text-xs text-ink-subtle">
                    {s.code} · {s.city ?? '-'} · lead {s.leadTimeDays}d
                    {!s.isApproved && ' · not approved'}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            !list.loading && <Empty>No suppliers match.</Empty>
          )}
        </Card>

        <div className="lg:col-span-3">
          {!selectedId && <Card><Empty>Select a supplier.</Empty></Card>}
          {detail.loading && <Loading />}
          {detail.data && (
            <Card title={detail.data.companyName}>
              <div className="mb-3 flex gap-1 border-b border-surface-border pb-2">
                {(['Profile', 'Products', 'Orders', 'Documents'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`rounded-md px-2 py-1 text-xs ${
                      tab === t ? 'bg-brand-light font-medium text-brand-dark' : 'text-ink-muted hover:bg-surface-sunken'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {tab === 'Profile' && (
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[
                    ['Code', detail.data.code],
                    ['Contact', detail.data.contactName],
                    ['Phone', detail.data.phone],
                    ['Email', detail.data.email],
                    ['City', detail.data.city],
                    ['Tax ID', detail.data.taxId],
                    ['Import licence', detail.data.licenseNumber],
                    ['Licence expiry', shortDate(detail.data.licenseExpiry)],
                    ['Payment terms', detail.data.paymentTerms],
                    ['Lead time', `${detail.data.leadTimeDays} days`],
                    ['Minimum order', money(detail.data.minimumOrderValue)],
                    ['Approved', detail.data.isApproved ? 'yes' : 'no'],
                  ].map(([k, v]) => (
                    <div key={String(k)}>
                      <dt className="text-xs text-ink-muted">{k}</dt>
                      <dd className="text-sm font-medium">{v || '-'}</dd>
                    </div>
                  ))}
                  <div className="col-span-2 sm:col-span-3 mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      ['Score', Number(detail.data.supplierScore).toFixed(1)],
                      ['On-time delivery', `${(Number(detail.data.onTimeDeliveryRate) * 100).toFixed(0)}%`],
                      ['Rejection rate', `${(Number(detail.data.rejectionRate) * 100).toFixed(1)}%`],
                      ['Quality incidents', detail.data.qualityIncidents],
                    ].map(([k, v]) => (
                      <div key={String(k)} className="rounded-md bg-surface-sunken p-2">
                        <div className="text-xs text-ink-muted">{k}</div>
                        <div className="text-lg font-semibold num">{v}</div>
                      </div>
                    ))}
                  </div>
                </dl>
              )}

              {tab === 'Products' && (
                <Table head={['SKU', 'Product', 'Unit price', 'MOQ', 'Preferred']}>
                  {detail.data.products.map((sp: any) => (
                    <tr key={sp.id}>
                      <td className="td text-ink-muted">{sp.product.sku}</td>
                      <td className="td">{sp.product.genericName}</td>
                      <td className="td num">{money(sp.unitPrice)}</td>
                      <td className="td num">{Number(sp.moq)}</td>
                      <td className="td">{sp.isPreferred ? <Pill tone="ok">preferred</Pill> : ''}</td>
                    </tr>
                  ))}
                </Table>
              )}

              {tab === 'Orders' && (
                <Table head={['PO', 'Status', 'Ordered', 'Total']}>
                  {detail.data.purchaseOrders.length ? (
                    detail.data.purchaseOrders.map((po: any) => (
                      <tr key={po.id}>
                        <td className="td font-medium">{po.poNo}</td>
                        <td className="td text-xs">{po.status.replace(/_/g, ' ')}</td>
                        <td className="td text-ink-muted">{shortDate(po.orderDate)}</td>
                        <td className="td num">{money(po.grandTotal)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr><td className="td text-ink-subtle" colSpan={4}>No purchase orders yet.</td></tr>
                  )}
                </Table>
              )}

              {tab === 'Documents' && <DocumentsTab entityType="SUPPLIER" entityId={detail.data.id} />}
            </Card>
          )}
        </div>
      </div>
    </Shell>
  );
}
