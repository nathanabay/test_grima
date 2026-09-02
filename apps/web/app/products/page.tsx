'use client';

import { useState } from 'react';
import { Shell, PageHeader } from '@/components/Shell';
import { useApi } from '@/lib/useApi';
import { api, can, money, qty, shortDate, tokenStore } from '@/lib/api';
import { Card, Empty, ErrorBox, Loading, Pill, Table } from '@/components/ui';
import { DocumentsTab } from '@/components/DocumentsTab';

const TABS = ['Overview', 'Units', 'Barcodes', 'Stock', 'Price history', 'Documents'] as const;
type Tab = (typeof TABS)[number];

export default function ProductsPage() {
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('Overview');

  const list = useApi<any>(
    `/products?pageSize=25${query ? `&q=${encodeURIComponent(query)}` : ''}`,
    [query],
  );
  const detail = useApi<any>(selectedId ? `/products/${selectedId}` : null, [selectedId]);

  return (
    <Shell>
      <PageHeader
        title="Drug Master"
        subtitle="Every medicine with its units, barcodes, handling flags and regulatory documents."
      />

      <Card className="mb-4">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(term);
          }}
        >
          <input
            className="input flex-1 min-w-[240px]"
            placeholder="Generic name, brand, active ingredient, SKU, GTIN, ATC code or barcode"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          <button className="btn-primary">Search</button>
        </form>
      </Card>

      {list.error && <ErrorBox message={list.error} />}
      {list.loading && <Loading />}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2" title={`${list.data?.total ?? 0} products`}>
          {list.data?.data?.length ? (
            <div className="max-h-[70vh] space-y-1 overflow-y-auto">
              {list.data.data.map((p: any) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full rounded-md border p-2 text-left text-sm ${
                    selectedId === p.id
                      ? 'border-brand bg-brand-light'
                      : 'border-transparent hover:bg-surface-sunken'
                  }`}
                >
                  <div className="font-medium">
                    {p.genericName} {p.strength}
                  </div>
                  <div className="text-xs text-ink-subtle">
                    {p.brandName ? `${p.brandName} · ` : ''}
                    {p.sku} · {p.dosageForm}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {p.requiresPrescription && <Pill tone="warn">Rx</Pill>}
                    {p.isControlled && <Pill tone="danger">Controlled</Pill>}
                    {p.isColdChain && <Pill tone="info">Cold chain</Pill>}
                    {p.isHighAlert && <Pill tone="danger">High alert</Pill>}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            !list.loading && <Empty>No products match that search.</Empty>
          )}
        </Card>

        <div className="lg:col-span-3">
          {!selectedId && (
            <Card>
              <Empty>Select a product to see its full record.</Empty>
            </Card>
          )}
          {detail.loading && <Loading />}
          {detail.data && (
            <Card
              title={
                <span>
                  {detail.data.genericName} {detail.data.strength}
                  <span className="ml-2 text-xs font-normal text-ink-subtle">
                    {detail.data.sku} · GTIN {detail.data.gtin ?? '-'}
                  </span>
                </span>
              }
            >
              <div className="mb-3 flex flex-wrap gap-1 border-b border-surface-border pb-2">
                {TABS.map((t) => (
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

              {tab === 'Overview' && <Overview product={detail.data} />}
              {tab === 'Units' && (
                <Table head={['Code', 'Name', 'Base units each', 'Role']}>
                  {detail.data.units.map((u: any) => (
                    <tr key={u.id}>
                      <td className="td font-medium">{u.code}</td>
                      <td className="td">{u.name}</td>
                      <td className="td num">{qty(u.factorToBase)}</td>
                      <td className="td text-xs text-ink-muted">
                        {[u.isBaseUnit && 'base', u.isPurchaseUnit && 'purchase', u.isDispenseUnit && 'dispensing']
                          .filter(Boolean)
                          .join(', ') || '-'}
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
              {tab === 'Barcodes' && (
                <Table head={['Barcode', 'Symbology', 'Unit', 'Primary']}>
                  {detail.data.barcodes.map((b: any) => (
                    <tr key={b.id}>
                      <td className="td num font-medium">{b.barcode}</td>
                      <td className="td">{b.symbology}</td>
                      <td className="td text-ink-muted">{b.unitCode ?? '-'}</td>
                      <td className="td">{b.isPrimary ? 'yes' : ''}</td>
                    </tr>
                  ))}
                </Table>
              )}
              {tab === 'Stock' && <StockTab productId={detail.data.id} />}
              {tab === 'Price history' && (
                <Table head={['When', 'Type', 'From', 'To', 'Reason']}>
                  {detail.data.priceHistory.length ? (
                    detail.data.priceHistory.map((h: any) => (
                      <tr key={h.id}>
                        <td className="td text-ink-muted">{shortDate(h.createdAt)}</td>
                        <td className="td">{h.priceType}</td>
                        <td className="td num">{money(h.oldValue)}</td>
                        <td className="td num font-medium">{money(h.newValue)}</td>
                        <td className="td text-xs text-ink-muted">{h.reason ?? '-'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="td text-ink-subtle" colSpan={5}>
                        No price changes recorded.
                      </td>
                    </tr>
                  )}
                </Table>
              )}
              {tab === 'Documents' && <DocumentsTab entityType="PRODUCT" entityId={detail.data.id} />}
            </Card>
          )}
        </div>
      </div>
    </Shell>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="text-sm font-medium">{value ?? '-'}</dd>
    </div>
  );
}

function Overview({ product }: { product: any }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <Field label="Active ingredient" value={product.activeIngredient} />
      <Field label="Dosage form" value={product.dosageForm} />
      <Field label="Route" value={product.routeOfAdmin} />
      <Field label="Manufacturer" value={product.manufacturer?.name} />
      <Field label="Country of origin" value={product.countryOfOrigin} />
      <Field label="Category" value={product.category?.name} />
      <Field label="Therapeutic class" value={product.therapeuticClass} />
      <Field label="ATC code" value={product.atcCode} />
      <Field label="Storage" value={product.storageCondition?.replace(/_/g, ' ')} />
      <Field
        label="Temperature range"
        value={product.minTempC !== null ? `${product.minTempC}C – ${product.maxTempC}C` : 'Ambient'}
      />
      <Field label="Min shelf life on receipt" value={`${product.minShelfLifeDaysOnReceipt} days`} />
      <Field label="Lead time" value={`${product.leadTimeDays} days`} />
      <Field label="Reorder level" value={qty(product.reorderLevel)} />
      <Field label="Safety stock" value={qty(product.safetyStock)} />
      <Field label="Maximum stock" value={qty(product.maximumStock)} />
      <Field label="Purchase cost" value={money(product.purchaseCost)} />
      <Field label="Average cost" value={money(product.averageCost)} />
      <Field label="Retail price" value={money(product.retailPrice)} />
      <Field label="Tax rate" value={`${(Number(product.taxRate) * 100).toFixed(0)}%`} />
      <Field
        label="Margin"
        value={
          Number(product.retailPrice) > 0
            ? `${(((Number(product.retailPrice) - Number(product.averageCost)) / Number(product.retailPrice)) * 100).toFixed(1)}%`
            : 'n/a'
        }
      />
      <Field
        label="Handling"
        value={
          <span className="flex flex-wrap gap-1">
            {product.requiresPrescription && <Pill tone="warn">Rx only</Pill>}
            {product.isControlled && <Pill tone="danger">Controlled</Pill>}
            {product.isColdChain && <Pill tone="info">Cold chain</Pill>}
            {product.isHighAlert && <Pill tone="danger">High alert</Pill>}
            {product.isHazardous && <Pill tone="warn">Hazardous</Pill>}
            {product.lightSensitive && <Pill>Light sensitive</Pill>}
            {!product.requiresPrescription && !product.isControlled && <Pill tone="ok">OTC</Pill>}
          </span>
        }
      />
    </dl>
  );
}

function StockTab({ productId }: { productId: string }) {
  const { data, loading } = useApi<any>(`/inventory/products/${productId}/stock`, [productId]);
  if (loading) return <Loading />;
  if (!data) return null;

  return (
    <div>
      <div className="mb-3 grid grid-cols-3 gap-2">
        <div className="rounded-md bg-surface-sunken p-2">
          <div className="text-xs text-ink-muted">On hand</div>
          <div className="text-lg font-semibold num">{qty(data.totalOnHand)}</div>
        </div>
        <div className="rounded-md bg-surface-sunken p-2">
          <div className="text-xs text-ink-muted">Reserved</div>
          <div className="text-lg font-semibold num">{qty(data.totalReserved)}</div>
        </div>
        <div className="rounded-md bg-surface-sunken p-2">
          <div className="text-xs text-ink-muted">Available</div>
          <div className="text-lg font-semibold num">{qty(data.totalAvailable)}</div>
        </div>
      </div>
      <Table head={['Warehouse', 'Batch', 'Status', 'Expiry', 'On hand']}>
        {data.positions.map((p: any) => (
          <tr key={p.id}>
            <td className="td">{p.warehouse.name}</td>
            <td className="td text-ink-muted">{p.batch?.batchNumber ?? '-'}</td>
            <td className="td text-xs">{p.batch?.status ?? '-'}</td>
            <td className="td text-ink-muted">{shortDate(p.batch?.expiryDate)}</td>
            <td className="td num">{qty(p.onHand)}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
