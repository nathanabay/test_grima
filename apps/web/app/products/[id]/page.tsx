'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { PageHeader, Card, Stat, ErrorState, Loading, EmptyState } from '@/components/primitives';
import { useApi } from '@/lib/useApi';
import { money, qty, shortDate } from '@/lib/api';
import { StatusBadge, ExpiryBadge, QuantityCell } from '@/components/status';
import { DataTable } from '@/components/DataTable';
import { Timeline, Tabs } from '@/components/Timeline';

/**
 * Product 360 (§28).
 *
 * One page that answers everything about a medicine: what it is, where it is,
 * what state it is in, what it costs, and everything that has happened to it.
 * The header carries the identity and the numbers that decide whether it can be
 * dispensed at all; the tabs carry the detail.
 */
export default function ProductPage() {
  return (
    <Shell>
      <ProductBody />
    </Shell>
  );
}

function ProductBody() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [tab, setTab] = useState('overview');

  const product = useApi<any>(id ? `/products/${id}` : null, [id]);
  const stock = useApi<any>(id ? `/inventory/products/${id}/stock` : null, [id]);
  const branches = useApi<any>(
    id && tab === 'inventory' ? `/inventory/products/${id}/branches` : null,
    [id, tab],
  );
  const ingredients = useApi<any>(id && tab === 'overview' ? `/products/${id}/ingredients` : null, [id, tab]);
  const relations = useApi<any>(id && tab === 'overview' ? `/products/${id}/relations` : null, [id, tab]);
  const attributes = useApi<any>(id && tab === 'overview' ? `/products/${id}/attributes` : null, [id, tab]);
  const prices = useApi<any>(id && tab === 'pricing' ? `/products/${id}/price-history` : null, [id, tab]);

  if (product.loading) return <Loading label="Loading product" />;
  if (product.error) return <ErrorState message={product.error} onRetry={product.refresh} />;
  if (!product.data) return null;

  const p = product.data;
  const positions: any[] = stock.data?.positions ?? stock.data?.balances ?? [];

  const totals = positions.reduce(
    (acc, b) => {
      const onHand = Number(b.onHand ?? 0);
      const reserved = Number(b.reserved ?? 0);
      const status = b.batch?.status ?? b.batchStatus;
      acc.onHand += onHand;
      acc.reserved += reserved;
      if (status === 'QUARANTINED') acc.quarantined += onHand;
      else if (status === 'RECALLED') acc.recalled += onHand;
      else if (status === 'EXPIRED') acc.expired += onHand;
      else acc.available += Math.max(0, onHand - reserved);
      return acc;
    },
    { onHand: 0, reserved: 0, available: 0, quarantined: 0, recalled: 0, expired: 0 },
  );

  return (
    <>
      <PageHeader
        breadcrumb={<Link href="/products" className="hover:underline">Drug master</Link>}
        title={[p.brandName || p.genericName, p.strength].filter(Boolean).join(' ')}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{p.genericName}</span>
            {p.dosageForm && <span>· {p.dosageForm}</span>}
            {p.manufacturer?.name && <span>· {p.manufacturer.name}</span>}
            <span className="num">· SKU {p.sku}</span>
            {p.gtin && <span className="num">· GTIN {p.gtin}</span>}
          </span>
        }
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={p.isActive ? 'ACTIVE' : 'INACTIVE'} />
            {p.requiresPrescription && <StatusBadge tone="info">Prescription only</StatusBadge>}
            {p.isControlled && <StatusBadge tone="controlled">Controlled{p.controlledSchedule ? ` · ${p.controlledSchedule}` : ''}</StatusBadge>}
            {p.isColdChain && <StatusBadge tone="cold">Cold chain</StatusBadge>}
            {p.isHighAlert && <StatusBadge tone="out">High alert</StatusBadge>}
            {p.isLookAlikeSoundAlike && <StatusBadge tone="near">Look-alike</StatusBadge>}
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Available" value={qty(totals.available)} tone={totals.available > 0 ? 'ok' : 'danger'}
          sub={`of ${qty(totals.onHand)} on hand`} />
        <Stat label="Reserved" value={qty(totals.reserved)} sub="Held for open documents" />
        <Stat label="Quarantined" value={qty(totals.quarantined)} tone={totals.quarantined > 0 ? 'warn' : 'neutral'} />
        <Stat label="Recalled" value={qty(totals.recalled)} tone={totals.recalled > 0 ? 'danger' : 'neutral'} />
        <Stat label="Expired" value={qty(totals.expired)} tone={totals.expired > 0 ? 'danger' : 'neutral'} />
        <Stat label="Retail price" value={money(p.retailPrice)}
          sub={`Cost ${money(p.averageCost)}`} />
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'inventory', label: 'Inventory', count: positions.length },
          { key: 'planning', label: 'Planning' },
          { key: 'pricing', label: 'Pricing' },
          { key: 'activity', label: 'Activity' },
        ]}
      />

      {tab === 'overview' && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Identity and classification">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-body">
              <Detail label="Generic name" value={p.genericName} />
              <Detail label="Brand" value={p.brandName} />
              <Detail label="Strength" value={p.strength} />
              <Detail label="Dosage form" value={p.dosageForm} />
              <Detail label="Route" value={p.routeOfAdmin} />
              <Detail label="Therapeutic class" value={p.therapeuticClass} />
              <Detail label="ATC code" value={p.atcCode} mono />
              <Detail label="Category" value={p.category?.name} />
              <Detail label="Manufacturer" value={p.manufacturer?.name} />
              <Detail label="Marketing authorization" value={p.marketingAuthHolder} />
              <Detail label="Country of origin" value={p.countryOfOrigin} />
              <Detail label="Registration" value={p.registrationNumber} mono />
              <Detail label="Registration expires" value={p.registrationExpiry ? shortDate(p.registrationExpiry) : null} />
              <Detail label="Base unit" value={p.baseUnit} />
            </dl>
          </Card>

          <Card title="Storage and handling">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-body">
              <Detail label="Storage condition" value={p.storageCondition?.replace(/_/g, ' ')} />
              <Detail label="Temperature range"
                value={p.minTempC !== null && p.maxTempC !== null ? `${p.minTempC}–${p.maxTempC} °C` : null} />
              <Detail label="Humidity range"
                value={p.minHumidityPercent !== null && p.maxHumidityPercent !== null
                  ? `${p.minHumidityPercent}–${p.maxHumidityPercent} %` : null} />
              <Detail label="Max excursion" value={p.maxExcursionMinutes ? `${p.maxExcursionMinutes} min` : null} />
              <Detail label="Minimum shelf life on receipt" value={`${p.minShelfLifeDaysOnReceipt} days`} />
              <Detail label="Sale classification" value={p.saleClassification?.replace(/_/g, ' ')} />
            </dl>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {p.isCytotoxic && <StatusBadge tone="out">Cytotoxic</StatusBadge>}
              {p.isHazardous && <StatusBadge tone="out">Hazardous</StatusBadge>}
              {p.isNarcotic && <StatusBadge tone="controlled">Narcotic</StatusBadge>}
              {p.lightSensitive && <StatusBadge tone="near">Light sensitive</StatusBadge>}
              {p.isFragile && <StatusBadge tone="near">Fragile</StatusBadge>}
              {p.isFlammable && <StatusBadge tone="out">Flammable</StatusBadge>}
              {p.isFrozen && <StatusBadge tone="cold">Frozen</StatusBadge>}
              {p.isVeterinary && <StatusBadge tone="info">Veterinary</StatusBadge>}
              {p.isPediatric && <StatusBadge tone="info">Paediatric</StatusBadge>}
            </div>
          </Card>

          <Card title="Active ingredients">
            {ingredients.loading && <Loading />}
            {ingredients.data?.length ? (
              <ul className="space-y-1 text-body">
                {ingredients.data.map((i: any) => (
                  <li key={i.id} className="flex items-center justify-between gap-3">
                    <span className="text-ink">{i.name}</span>
                    <span className="num text-ink-muted">
                      {i.strengthValue ? `${i.strengthValue} ${i.strengthUnit ?? ''}` : '—'}
                      {i.role !== 'ACTIVE' && <span className="ml-2 text-caption">{i.role.toLowerCase()}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No ingredients recorded"
                body="A combination product lists each active ingredient with its own strength." />
            )}
            {(p.pregnancyInfo || p.lactationInfo) && (
              <div className="mt-3 space-y-1 border-t border-border pt-3 text-small text-ink-muted">
                {p.pregnancyInfo && <p><span className="font-medium text-ink">Pregnancy: </span>{p.pregnancyInfo}</p>}
                {p.lactationInfo && <p><span className="font-medium text-ink">Lactation: </span>{p.lactationInfo}</p>}
                <p className="text-caption text-ink-subtle">
                  Free text from the approved product information. Nothing here is generated.
                </p>
              </div>
            )}
          </Card>

          <Card title="Related products">
            {relations.loading && <Loading />}
            {relations.data?.length ? (
              <ul className="space-y-1.5 text-body">
                {relations.data.map((r: any) => (
                  <li key={r.id} className="flex items-center justify-between gap-3">
                    <Link href={`/products/${r.relatedProductId}`} className="text-brand-dark hover:underline">
                      {r.relatedProduct?.genericName ?? r.relatedProductId}
                    </Link>
                    <StatusBadge tone="info">{r.relationType.replace(/_/g, ' ').toLowerCase()}</StatusBadge>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No related products"
                body="Generic equivalents, substitutes, variants and alternative brands appear here." />
            )}
            {attributes.data?.length > 0 && (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border pt-3 text-body">
                {attributes.data.map((a: any) => (
                  <Detail key={a.id} label={a.definition?.label ?? a.definitionId} value={a.value} />
                ))}
              </dl>
            )}
          </Card>
        </div>
      )}

      {tab === 'inventory' && (
        <div className="space-y-4">
          <Card title="Stock positions" description="Every batch, in every warehouse and bin, with the state that decides whether it can be picked.">
            {stock.loading && <Loading />}
            {positions.length === 0 ? (
              <EmptyState title="No stock on hand"
                body="Positions appear here as soon as a goods receipt is posted." />
            ) : (
              <DataTable
                rows={positions}
                getKey={(b: any) => b.id ?? `${b.batchId}-${b.warehouseId}-${b.locationId ?? 'wh'}`}
                exportName={`product-${p.sku}-stock`}
                pageSize={25}
                viewKey="product-stock"
                rowTone={(b: any) => {
                  const s = b.batch?.status ?? b.batchStatus;
                  return s === 'EXPIRED' || s === 'RECALLED' ? 'danger' : s === 'QUARANTINED' ? 'warn' : null;
                }}
                columns={[
                  {
                    key: 'batch', label: 'Batch', sticky: true,
                    value: (b: any) => b.batch?.batchNumber ?? b.batchNumber ?? '',
                    render: (b: any) => (
                      <Link href={`/batches?batch=${b.batchId}`} className="num text-brand-dark hover:underline">
                        {b.batch?.batchNumber ?? b.batchNumber ?? '—'}
                      </Link>
                    ),
                  },
                  {
                    key: 'expiry', label: 'Expiry',
                    value: (b: any) => b.batch?.expiryDate ?? b.expiryDate ?? '',
                    render: (b: any) => {
                      const d = b.batch?.expiryDate ?? b.expiryDate;
                      if (!d) return '—';
                      const days = Math.floor((new Date(d).getTime() - Date.now()) / 86400000);
                      return (
                        <span className="flex items-center gap-2">
                          <span className="num">{shortDate(d)}</span>
                          <ExpiryBadge days={days} />
                        </span>
                      );
                    },
                  },
                  {
                    key: 'status', label: 'State',
                    value: (b: any) => b.batch?.status ?? b.batchStatus ?? '',
                    render: (b: any) => <StatusBadge status={b.batch?.status ?? b.batchStatus} />,
                  },
                  { key: 'warehouse', label: 'Warehouse', value: (b: any) => b.warehouse?.name ?? '' },
                  { key: 'location', label: 'Bin', optional: true, value: (b: any) => b.location?.code ?? '' },
                  {
                    key: 'onHand', label: 'On hand', numeric: true, align: 'right',
                    value: (b: any) => Number(b.onHand ?? 0),
                    render: (b: any) => <QuantityCell value={b.onHand} />,
                  },
                  {
                    key: 'reserved', label: 'Reserved', numeric: true, align: 'right',
                    value: (b: any) => Number(b.reserved ?? 0),
                    render: (b: any) => <QuantityCell value={b.reserved} />,
                  },
                  {
                    key: 'available', label: 'Available', numeric: true, align: 'right',
                    value: (b: any) => Number(b.onHand ?? 0) - Number(b.reserved ?? 0),
                    render: (b: any) => <QuantityCell value={Number(b.onHand ?? 0) - Number(b.reserved ?? 0)} />,
                  },
                ]}
              />
            )}
          </Card>

          <Card title="Across branches" description="Where else this medicine is held, so a shortage here can be met from there.">
            {branches.loading && <Loading />}
            {branches.data?.length ? (
              <DataTable
                rows={branches.data}
                getKey={(b: any) => `${b.branchId}-${b.warehouseId}-${b.batchNumber}`}
                pageSize={10}
                exportName={`product-${p.sku}-branches`}
                columns={[
                  { key: 'branch', label: 'Branch', value: (b: any) => b.branchName },
                  { key: 'city', label: 'City', optional: true, value: (b: any) => b.city ?? '' },
                  { key: 'warehouse', label: 'Warehouse', value: (b: any) => b.warehouseName },
                  { key: 'batch', label: 'Batch', value: (b: any) => b.batchNumber },
                  {
                    key: 'expiry', label: 'Expiry', value: (b: any) => b.expiryDate,
                    render: (b: any) => shortDate(b.expiryDate),
                  },
                  {
                    key: 'available', label: 'Available', numeric: true, align: 'right',
                    value: (b: any) => Number(b.available ?? 0),
                    render: (b: any) => <QuantityCell value={b.available} />,
                  },
                ]}
              />
            ) : (
              <EmptyState
                title="Not held anywhere else"
                body="Unexpired stock in other branches appears here, so a shortage in one can be met from another."
              />
            )}
          </Card>
        </div>
      )}

      {tab === 'planning' && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Replenishment levels" description="What the reorder engine reads. These are configuration, not observations.">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-body">
              <Detail label="Reorder level" value={qty(p.reorderLevel)} />
              <Detail label="Safety stock" value={qty(p.safetyStock)} />
              <Detail label="Maximum stock" value={qty(p.maximumStock)} />
              <Detail label="Economic order quantity" value={qty(p.economicOrderQty)} />
              <Detail label="Lead time" value={`${p.leadTimeDays} days`} />
              <Detail label="Minimum purchase" value={qty(p.minPurchaseQty)} />
              <Detail label="Purchase multiple" value={p.purchaseMultiple ? qty(p.purchaseMultiple) : 'None'} />
              <Detail label="Maximum dispense" value={p.maxDispenseQty ? qty(p.maxDispenseQty) : 'No cap'} />
            </dl>
            {p.procurementRestricted && (
              <p className="mt-3 rounded border border-warn/30 bg-warn-light px-3 py-2 text-small text-warn">
                Procurement of this product is restricted. It cannot be ordered outside the emergency workflow.
              </p>
            )}
          </Card>
          <Card title="Forecast" description="Demand projected from the movement history, with its method stated.">
            <p className="text-small text-ink-muted">
              Open <Link href="/forecast" className="text-brand-dark underline">Forecasting</Link> for the
              projection, the method that produced it and its confidence range. Nothing here presents a
              prediction as a certainty.
            </p>
          </Card>
        </div>
      )}

      {tab === 'pricing' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Retail" value={money(p.retailPrice)} />
            <Stat label="Wholesale" value={money(p.wholesalePrice)} />
            <Stat label="Insurance" value={p.insurancePrice ? money(p.insurancePrice) : '—'} />
            <Stat label="Average cost" value={money(p.averageCost)}
              sub={`Last purchase ${money(p.lastPurchaseCost)}`} />
          </div>
          <Card title="Price history" description="Every change, with who made it and when.">
            {prices.loading && <Loading />}
            {prices.data?.length ? (
              <DataTable
                rows={prices.data}
                getKey={(h: any) => h.id}
                pageSize={20}
                exportName={`product-${p.sku}-prices`}
                columns={[
                  { key: 'changedAt', label: 'When', value: (h: any) => h.changedAt ?? h.createdAt,
                    render: (h: any) => shortDate(h.changedAt ?? h.createdAt) },
                  { key: 'priceType', label: 'Price', value: (h: any) => h.priceType ?? 'RETAIL' },
                  { key: 'oldPrice', label: 'From', numeric: true, align: 'right',
                    value: (h: any) => Number(h.oldPrice ?? 0), render: (h: any) => money(h.oldPrice) },
                  { key: 'newPrice', label: 'To', numeric: true, align: 'right',
                    value: (h: any) => Number(h.newPrice ?? 0), render: (h: any) => money(h.newPrice) },
                  { key: 'reason', label: 'Reason', value: (h: any) => h.reason ?? '' },
                ]}
              />
            ) : (
              <EmptyState title="No price change recorded"
                body="Every change to a price is written here with its old and new value." />
            )}
          </Card>
        </div>
      )}

      {tab === 'activity' && (
        <Card title="Everything that has happened to this product"
          description="Assembled from the stock ledger, the audit trail, price history and documents — each entry links to the record behind it.">
          <Timeline entityType="PRODUCT" entityId={p.id} />
        </Card>
      )}
    </>
  );
}

function Detail({ label, value, mono }: { label: string; value?: ReactNodeish; mono?: boolean }) {
  return (
    <>
      <dt className="text-caption uppercase text-ink-subtle">{label}</dt>
      <dd className={`text-ink ${mono ? 'num' : ''}`}>{value || <span className="text-ink-subtle">—</span>}</dd>
    </>
  );
}

type ReactNodeish = string | number | null | undefined | React.ReactNode;
