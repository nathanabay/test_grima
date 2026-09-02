'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { PageHeader, Card, Stat, ErrorState, Loading, EmptyState } from '@/components/primitives';
import { useApi } from '@/lib/useApi';
import { api, money, qty, shortDate } from '@/lib/api';
import { StatusBadge, ExpiryBadge, QuantityCell } from '@/components/status';
import { DataTable } from '@/components/DataTable';
import { Timeline, Tabs } from '@/components/Timeline';
import { useFeedback } from '@/components/Feedback';

/**
 * Batch 360 (§29).
 *
 * A batch is the unit a recall, a quarantine and an expiry all act on, so this
 * page has to answer "where is it, what state is it in, and everything that has
 * happened to it" without the reader going anywhere else.
 */
export default function BatchPage() {
  return (
    <Shell>
      <BatchBody />
    </Shell>
  );
}

function BatchBody() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { toast, confirm } = useFeedback();
  const [tab, setTab] = useState('overview');
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const batch = useApi<any>(id ? `/batches/${id}` : null, [id, version]);
  const trace = useApi<any>(id && tab === 'trace' ? `/batches/${id}/trace` : null, [id, tab, version]);

  if (batch.loading) return <Loading label="Loading batch" />;
  if (batch.error) return <ErrorState message={batch.error} onRetry={batch.refresh} />;
  if (!batch.data) return null;

  const b = batch.data;
  const days = Math.floor((new Date(b.expiryDate).getTime() - Date.now()) / 86400000);
  const positions: any[] = b.balances ?? [];
  const onHand = positions.reduce((s, p) => s + Number(p.onHand ?? 0), 0);
  const reserved = positions.reduce((s, p) => s + Number(p.reserved ?? 0), 0);
  const value = onHand * Number(b.purchaseCost ?? 0);

  // Dispensings and retail sales both put medicine in somebody's hands, so a
  // recall has to see them in one list rather than two.
  const recipients = [
    ...(trace.data?.dispensedTo ?? []).map((d: any, i: number) => ({
      key: `disp-${d.dispensingNo ?? i}`,
      route: 'Dispensed',
      name: d.patientName ?? 'Patient record not linked',
      phone: d.patientPhone ?? null,
      quantity: d.quantity,
      at: d.dispensedAt,
      reference: d.dispensingNo ?? null,
    })),
    ...(trace.data?.soldTo ?? []).map((s2: any, i: number) => ({
      key: `sale-${s2.saleNo ?? i}`,
      route: 'Sold',
      name: s2.patientName ?? 'Walk-in customer',
      phone: s2.patientPhone ?? null,
      quantity: s2.quantity,
      at: s2.soldAt,
      reference: s2.saleNo ?? null,
    })),
  ];

  async function act(path: string, body: unknown, done: string) {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: 'POST', body });
      toast(done, 'ok');
      setVersion((v) => v + 1);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function release() {
    const { confirmed, reason } = await confirm({
      title: `Release batch ${b.batchNumber}?`,
      body: 'Released stock becomes available to sell, dispense and transfer. The investigation note is kept against the batch.',
      confirmLabel: 'Release',
      requireReason: 'What did the investigation find?',
    });
    if (!confirmed) return;
    await act(`/batches/${b.id}/release`, { notes: reason }, 'Batch released');
  }

  async function quarantine() {
    const { confirmed, reason } = await confirm({
      title: `Quarantine batch ${b.batchNumber}?`,
      body: 'The batch stops being allocatable immediately. Stock already reserved on open documents is unaffected until those documents are cancelled.',
      confirmLabel: 'Quarantine',
      tone: 'danger',
      requireReason: 'Why is this batch being quarantined?',
    });
    if (!confirmed) return;
    await act(`/batches/${b.id}/quarantine`, { reason }, 'Batch quarantined');
  }

  async function block() {
    const { confirmed, reason } = await confirm({
      title: `Block batch ${b.batchNumber}?`,
      body: 'Blocking stops every movement of this batch. Use it when the stock must not move at all until somebody decides what happens to it.',
      confirmLabel: 'Block',
      tone: 'danger',
      requireReason: 'Why is this batch being blocked?',
    });
    if (!confirmed) return;
    await act(`/batches/${b.id}/block`, { reason }, 'Batch blocked');
  }

  return (
    <>
      <PageHeader
        breadcrumb={<Link href="/batches" className="hover:underline">Batches</Link>}
        title={`Batch ${b.batchNumber}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link href={`/products/${b.productId}`} className="text-brand-dark hover:underline">
              {b.product?.genericName} {b.product?.strength}
            </Link>
            {b.lotNumber && <span className="num">· Lot {b.lotNumber}</span>}
            {b.supplier && <span>· {b.supplier.companyName}</span>}
            {b.manufacturerName && <span>· {b.manufacturerName}</span>}
          </span>
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={b.status} />
            <ExpiryBadge days={days} />
            {b.status === 'QUARANTINED' && (
              <button className="btn-primary btn-sm" disabled={busy} onClick={release}>Release</button>
            )}
            {['AVAILABLE', 'RELEASED'].includes(b.status) && (
              <button className="btn-ghost btn-sm" disabled={busy} onClick={quarantine}>Quarantine</button>
            )}
            {b.status !== 'BLOCKED' && b.status !== 'RECALLED' && (
              <button className="btn-ghost btn-sm" disabled={busy} onClick={block}>Block</button>
            )}
          </div>
        }
      />

      {error && <div className="mb-3"><ErrorState message={error} /></div>}

      {b.recallLinks?.length > 0 && (
        <div className="mb-4 rounded border border-st-recall/40 bg-st-recall/10 px-4 py-3">
          <p className="text-body font-medium text-st-recall">
            This batch is subject to {b.recallLinks.length} recall
            {b.recallLinks.length === 1 ? '' : 's'}. It cannot be sold or dispensed.
          </p>
          <ul className="mt-1 space-y-0.5 text-small text-ink-muted">
            {b.recallLinks.map((r: any) => (
              <li key={r.id}>
                <Link href="/recalls" className="text-brand-dark underline">
                  {r.recall?.recallNo}
                </Link>{' '}
                — {r.recall?.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="On hand" value={qty(onHand)} tone={onHand > 0 ? 'neutral' : 'warn'} />
        <Stat label="Reserved" value={qty(reserved)} sub="Held for open documents" />
        <Stat label="Available" value={qty(Math.max(0, onHand - reserved))}
          tone={['AVAILABLE', 'RELEASED'].includes(b.status) ? 'ok' : 'danger'}
          sub={['AVAILABLE', 'RELEASED'].includes(b.status) ? 'Allocatable' : `${b.status.toLowerCase()} — not allocatable`} />
        <Stat label="Received" value={qty(b.receivedQuantity)} sub={shortDate(b.receivedDate)} />
        <Stat label="Days remaining" value={days < 0 ? `${Math.abs(days)} past` : days}
          tone={days < 0 ? 'danger' : days <= 30 ? 'warn' : 'neutral'} sub={shortDate(b.expiryDate)} />
        <Stat label="Value at cost" value={money(value)} sub={`${money(b.purchaseCost)} per unit`} />
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'positions', label: 'Where it is', count: positions.length },
          { key: 'movements', label: 'Movements', count: b.transactions?.length ?? 0 },
          { key: 'trace', label: 'Trace' },
          { key: 'activity', label: 'Activity' },
        ]}
      />

      {tab === 'overview' && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Batch identity">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-body">
              <D label="Batch number" value={b.batchNumber} mono />
              <D label="Lot number" value={b.lotNumber} mono />
              <D label="Manufactured" value={b.manufacturingDate ? shortDate(b.manufacturingDate) : null} />
              <D label="Expires" value={shortDate(b.expiryDate)} />
              <D label="Received" value={shortDate(b.receivedDate)} />
              <D label="Supplier" value={b.supplier?.companyName} />
              <D label="Manufacturer" value={b.manufacturerName} />
              <D label="Supplier invoice" value={b.supplierInvoiceNo} mono />
              <D label="Purchase cost" value={money(b.purchaseCost)} />
            </dl>
          </Card>

          <Card title="Quality state">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-body">
              <D label="Status" value={<StatusBadge status={b.status} />} />
              <D label="Quarantine reason" value={b.quarantineReason?.replace(/_/g, ' ')} />
              <D label="Released at" value={b.releasedAt ? shortDate(b.releasedAt) : null} />
            </dl>
            {b.qualityNotes && (
              <p className="mt-3 rounded border border-border bg-surface-sunken px-3 py-2 text-small text-ink-muted">
                {b.qualityNotes}
              </p>
            )}
            {(b.parentBatch || b.childBatches?.length > 0) && (
              <div className="mt-3 border-t border-border pt-3">
                <p className="label">Genealogy</p>
                {b.parentBatch && (
                  <p className="text-small">
                    Repacked from{' '}
                    <Link href={`/batches/${b.parentBatch.id}`} className="text-brand-dark underline num">
                      {b.parentBatch.batchNumber}
                    </Link>
                  </p>
                )}
                {b.childBatches?.map((c: any) => (
                  <p key={c.id} className="text-small">
                    Repacked into{' '}
                    <Link href={`/batches/${c.id}`} className="text-brand-dark underline num">
                      {c.batchNumber}
                    </Link>
                  </p>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'positions' && (
        <Card title="Where this batch is" description="Every warehouse and bin holding it right now.">
          {positions.length === 0 ? (
            <EmptyState title="No stock of this batch remains"
              body="It has been fully consumed, transferred out, or disposed of. The movements tab shows where it went." />
          ) : (
            <DataTable
              rows={positions}
              getKey={(p: any) => p.id}
              exportName={`batch-${b.batchNumber}-positions`}
              columns={[
                { key: 'warehouse', label: 'Warehouse', value: (p: any) => p.warehouse?.name ?? '' },
                { key: 'location', label: 'Bin', value: (p: any) => p.location?.code ?? '—' },
                { key: 'onHand', label: 'On hand', numeric: true, align: 'right',
                  value: (p: any) => Number(p.onHand), render: (p: any) => <QuantityCell value={p.onHand} /> },
                { key: 'reserved', label: 'Reserved', numeric: true, align: 'right',
                  value: (p: any) => Number(p.reserved), render: (p: any) => <QuantityCell value={p.reserved} /> },
                { key: 'available', label: 'Available', numeric: true, align: 'right',
                  value: (p: any) => Number(p.onHand) - Number(p.reserved),
                  render: (p: any) => <QuantityCell value={Number(p.onHand) - Number(p.reserved)} /> },
                { key: 'lastMovementAt', label: 'Last moved', optional: true,
                  value: (p: any) => p.lastMovementAt ?? '',
                  render: (p: any) => (p.lastMovementAt ? shortDate(p.lastMovementAt) : '—') },
              ]}
            />
          )}
        </Card>
      )}

      {tab === 'movements' && (
        <Card title="Movement history" description="Append-only. Every row is a ledger entry that cannot be edited.">
          {b.transactions?.length ? (
            <DataTable
              rows={b.transactions}
              getKey={(t: any) => t.id}
              pageSize={50}
              exportName={`batch-${b.batchNumber}-ledger`}
              columns={[
                { key: 'occurredAt', label: 'When', value: (t: any) => t.occurredAt,
                  render: (t: any) => shortDate(t.occurredAt) },
                { key: 'type', label: 'Movement', value: (t: any) => t.type,
                  render: (t: any) => <StatusBadge tone="info">{t.type.replace(/_/g, ' ').toLowerCase()}</StatusBadge> },
                { key: 'in', label: 'In', numeric: true, align: 'right',
                  value: (t: any) => Number(t.quantityIn),
                  render: (t: any) => (Number(t.quantityIn) ? <QuantityCell value={t.quantityIn} /> : '') },
                { key: 'out', label: 'Out', numeric: true, align: 'right',
                  value: (t: any) => Number(t.quantityOut),
                  render: (t: any) => (Number(t.quantityOut) ? <QuantityCell value={t.quantityOut} /> : '') },
                { key: 'balanceAfter', label: 'Balance', numeric: true, align: 'right',
                  value: (t: any) => Number(t.balanceAfter),
                  render: (t: any) => <QuantityCell value={t.balanceAfter} /> },
                { key: 'referenceNo', label: 'Document', value: (t: any) => t.referenceNo ?? '' },
                { key: 'reason', label: 'Reason', optional: true, value: (t: any) => t.reason ?? '' },
              ]}
            />
          ) : (
            <EmptyState title="No movement recorded" />
          )}
        </Card>
      )}

      {tab === 'trace' && (
        <div className="space-y-4">
          <Card title="Where this batch went"
            description="Who received medicine from it, so a recall can reach them. Walk-in retail customers appear where the sale recorded one.">
            {trace.loading && <Loading label="Tracing" />}
            {trace.error && <ErrorState message={trace.error} onRetry={trace.refresh} />}
            {trace.data && (
              <>
                <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Dispensed to patients" value={trace.data.recipientSummary.dispensings} />
                  <Stat label="Sold over the counter" value={trace.data.recipientSummary.sales} />
                  <Stat label="Contactable" value={trace.data.recipientSummary.contactable}
                    tone="ok" sub="Have a patient record" />
                  <Stat label="Un-contactable"
                    value={trace.data.recipientSummary.anonymousSales}
                    tone={trace.data.recipientSummary.anonymousSales > 0 ? 'warn' : 'neutral'}
                    sub="Walk-in, no record" />
                </div>

                {trace.data.recipientSummary.note && (
                  // Said out loud, because a recall that reaches 80% of
                  // recipients is a different situation from one that reaches
                  // everybody, and the difference must not be inferred.
                  <p className="mb-3 rounded border border-warn/30 bg-warn-light px-3 py-2 text-small text-warn">
                    {trace.data.recipientSummary.note}
                  </p>
                )}

                {trace.data.currentLocations?.length > 0 && (
                  <div className="mb-4">
                    <p className="label">Still held here</p>
                    <DataTable
                      rows={trace.data.currentLocations}
                      getKey={(l: any) => `${l.branchId}-${l.warehouseName}`}
                      pageSize={10}
                      columns={[
                        { key: 'branch', label: 'Branch', value: (l: any) => l.branchName },
                        { key: 'warehouse', label: 'Warehouse', value: (l: any) => l.warehouseName },
                        { key: 'onHand', label: 'On hand', numeric: true, align: 'right',
                          value: (l: any) => Number(l.onHand),
                          render: (l: any) => <QuantityCell value={l.onHand} /> },
                      ]}
                    />
                  </div>
                )}

                {recipients.length ? (
                  <>
                    <p className="label">Who received medicine from this batch</p>
                    <DataTable
                      rows={recipients}
                      getKey={(r) => r.key}
                      pageSize={25}
                      exportName={`batch-${b.batchNumber}-trace`}
                      columns={[
                        { key: 'route', label: 'Route', value: (r) => r.route,
                          render: (r) => (
                            <StatusBadge tone={r.route === 'Dispensed' ? 'info' : 'neutral'}>
                              {r.route}
                            </StatusBadge>
                          ) },
                        { key: 'recipient', label: 'Recipient', value: (r) => r.name },
                        { key: 'contact', label: 'Contact', value: (r) => r.phone ?? '' ,
                          render: (r) => r.phone ?? <span className="text-ink-subtle">no contact recorded</span> },
                        { key: 'quantity', label: 'Quantity', numeric: true, align: 'right',
                          value: (r) => Number(r.quantity ?? 0),
                          render: (r) => <QuantityCell value={r.quantity} /> },
                        { key: 'when', label: 'When', value: (r) => r.at ?? '',
                          render: (r) => (r.at ? shortDate(r.at) : '—') },
                        { key: 'document', label: 'Document', value: (r) => r.reference ?? '' },
                      ]}
                    />
                  </>
                ) : (
                  <EmptyState title="Nothing from this batch has left the pharmacy"
                    body="Once it is dispensed or sold, every recipient the system can identify appears here." />
                )}
              </>
            )}
          </Card>
        </div>
      )}

      {tab === 'activity' && (
        <Card title="Everything that has happened to this batch">
          <Timeline entityType="BATCH" entityId={b.id} />
        </Card>
      )}
    </>
  );
}

function D({ label, value, mono }: { label: string; value?: React.ReactNode; mono?: boolean }) {
  return (
    <>
      <dt className="text-caption uppercase text-ink-subtle">{label}</dt>
      <dd className={`text-ink ${mono ? 'num' : ''}`}>{value || <span className="text-ink-subtle">—</span>}</dd>
    </>
  );
}
