'use client';

import { useState } from 'react';
import { Shell, PageHeader } from '@/components/Shell';
import { useApi } from '@/lib/useApi';
import { api, money, qty, shortDate } from '@/lib/api';
import { Card, Empty, ErrorBox, Loading, Pill, Table } from '@/components/ui';

const MATCH_TONE: Record<string, any> = {
  MATCHED: 'ok',
  UNMATCHED: 'neutral',
  PRICE_VARIANCE: 'warn',
  QUANTITY_VARIANCE: 'warn',
  BOTH_VARIANCE: 'danger',
};

const STATUS_TONE: Record<string, any> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  MATCHED: 'ok',
  DISPUTED: 'danger',
  APPROVED: 'info',
  PARTIALLY_PAID: 'warn',
  PAID: 'ok',
  CANCELLED: 'neutral',
};

export default function InvoicesPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const list = useApi<any>('/supplier-invoices?pageSize=25', [message]);
  const ageing = useApi<any>('/supplier-invoices/ageing', [message]);
  const detail = useApi<any>(selectedId ? `/supplier-invoices/${selectedId}` : null, [selectedId, message]);

  async function act(path: string, body: any, label: string) {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: 'POST', body });
      setMessage(`${label} at ${new Date().toLocaleTimeString()}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Supplier Invoices"
        subtitle="Three-way matched against the purchase order and the goods actually received. An invoice that does not reconcile cannot be approved without a written reason."
      />

      {error && <div className="mb-3"><ErrorBox message={error} /></div>}
      {message && (
        <div className="mb-3 rounded-md border border-ok/30 bg-ok-light px-3 py-2 text-sm text-ok">{message}</div>
      )}

      {ageing.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-6">
          {[
            ['Not yet due', ageing.data.buckets.current],
            ['1–30 days', ageing.data.buckets.days1_30],
            ['31–60 days', ageing.data.buckets.days31_60],
            ['61–90 days', ageing.data.buckets.days61_90],
            ['Over 90 days', ageing.data.buckets.over90],
            ['Total outstanding', ageing.data.totalOutstanding],
          ].map(([label, value], i) => (
            <div key={String(label)} className="card p-3">
              <div className="text-xs text-ink-muted">{label}</div>
              <div className={`text-lg font-semibold num ${i === 4 ? 'text-danger' : ''}`}>
                {money(value)}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2" title={`${list.data?.total ?? 0} invoices`}>
          {list.loading && <Loading />}
          {list.data?.data?.length ? (
            <div className="max-h-[60vh] space-y-1 overflow-y-auto">
              {list.data.data.map((inv: any) => (
                <button
                  key={inv.id}
                  onClick={() => setSelectedId(inv.id)}
                  className={`w-full rounded-md border p-2 text-left text-sm ${
                    selectedId === inv.id ? 'border-brand bg-brand-light' : 'border-transparent hover:bg-surface-sunken'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{inv.supplierInvoiceNo}</span>
                    <Pill tone={STATUS_TONE[inv.status]}>{inv.status.replace(/_/g, ' ')}</Pill>
                  </div>
                  <div className="text-xs text-ink-subtle">
                    {inv.supplier.companyName} · {money(inv.grandTotal)} · due {shortDate(inv.dueDate)}
                  </div>
                  <div className="mt-1">
                    <Pill tone={MATCH_TONE[inv.matchStatus]}>{inv.matchStatus.replace(/_/g, ' ')}</Pill>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            !list.loading && <Empty>No supplier invoices entered.</Empty>
          )}
        </Card>

        <div className="lg:col-span-3">
          {!selectedId && <Card><Empty>Select an invoice.</Empty></Card>}
          {detail.loading && <Loading />}
          {detail.data && (
            <Card
              title={
                <span>
                  {detail.data.supplierInvoiceNo}
                  <span className="ml-2 text-xs font-normal text-ink-subtle">
                    {detail.data.internalNo} · {detail.data.supplier.companyName}
                  </span>
                </span>
              }
            >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Pill tone={STATUS_TONE[detail.data.status]}>{detail.data.status.replace(/_/g, ' ')}</Pill>
                <Pill tone={MATCH_TONE[detail.data.matchStatus]}>
                  {detail.data.matchStatus.replace(/_/g, ' ')}
                </Pill>
                <span className="text-sm text-ink-muted">
                  {money(detail.data.amountPaid)} paid of {money(detail.data.grandTotal)}
                </span>
              </div>

              {detail.data.matchNotes && (
                <div
                  className={`mb-3 rounded-md px-3 py-2 text-xs whitespace-pre-line ${
                    detail.data.matchStatus === 'MATCHED'
                      ? 'bg-ok-light text-ok'
                      : 'bg-danger-light text-danger'
                  }`}
                >
                  {detail.data.matchNotes}
                </div>
              )}

              <Table head={['Product', 'Billed qty', 'Received', 'Billed price', 'PO price', 'Line total', 'Variance']}>
                {detail.data.items.map((i: any) => (
                  <tr key={i.id} className={i.variance ? 'bg-danger-light' : ''}>
                    <td className="td text-xs">{i.productId.slice(0, 8)}</td>
                    <td className="td num">{qty(i.quantity)}</td>
                    <td className="td num text-ink-muted">{i.receivedQty !== null ? qty(i.receivedQty) : '-'}</td>
                    <td className="td num">{money(i.unitPrice)}</td>
                    <td className="td num text-ink-muted">{i.poUnitPrice !== null ? money(i.poUnitPrice) : '-'}</td>
                    <td className="td num">{money(i.lineTotal)}</td>
                    <td className="td text-xs text-danger">{i.variance ?? ''}</td>
                  </tr>
                ))}
              </Table>

              {detail.data.payments.length > 0 && (
                <div className="mt-4">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Payments
                  </div>
                  <Table head={['Payment', 'When', 'Method', 'Reference', 'Amount']}>
                    {detail.data.payments.map((p: any) => (
                      <tr key={p.id}>
                        <td className="td text-xs">{p.paymentNo}</td>
                        <td className="td text-xs text-ink-muted">{shortDate(p.paidAt)}</td>
                        <td className="td text-xs">{p.method.replace(/_/g, ' ')}</td>
                        <td className="td text-xs text-ink-muted">{p.reference ?? '-'}</td>
                        <td className="td num">{money(p.amount)}</td>
                      </tr>
                    ))}
                  </Table>
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2 border-t border-surface-border pt-3">
                <button
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() => act(`/supplier-invoices/${detail.data.id}/match`, {}, 'Re-matched')}
                >
                  Re-run match
                </button>

                {['MATCHED', 'DISPUTED', 'SUBMITTED'].includes(detail.data.status) && (
                  <button
                    className="btn-primary"
                    disabled={busy}
                    onClick={() => {
                      const needsReason = detail.data.matchStatus !== 'MATCHED';
                      const reason = needsReason
                        ? window.prompt(
                            `This invoice does not reconcile (${detail.data.matchStatus}). Reason for approving anyway:`,
                          )
                        : undefined;
                      if (needsReason && !reason) return;
                      act(
                        `/supplier-invoices/${detail.data.id}/approve`,
                        { overrideReason: reason },
                        'Approved for payment',
                      );
                    }}
                  >
                    Approve for payment
                  </button>
                )}

                {['APPROVED', 'PARTIALLY_PAID'].includes(detail.data.status) && (
                  <button
                    className="btn-primary"
                    disabled={busy}
                    onClick={() => {
                      const outstanding =
                        Number(detail.data.grandTotal) - Number(detail.data.amountPaid);
                      const amount = window.prompt(
                        `Payment amount (outstanding ${outstanding.toFixed(2)}):`,
                        outstanding.toFixed(2),
                      );
                      if (!amount) return;
                      const reference = window.prompt('Payment reference:') ?? undefined;
                      act(
                        `/supplier-invoices/${detail.data.id}/pay`,
                        { amount: Number(amount), method: 'BANK_TRANSFER', reference },
                        'Payment recorded',
                      );
                    }}
                  >
                    Record payment
                  </button>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </Shell>
  );
}
