'use client';

import { useState } from 'react';
import { Shell, PageHeader } from '@/components/Shell';
import { useApi } from '@/lib/useApi';
import { api, money, shortDate } from '@/lib/api';
import { Card, Empty, ErrorBox, Loading, Pill } from '@/components/ui';
import { DataTable } from '@/components/DataTable';
import { useFeedback } from '@/components/Feedback';

const LIST_TYPES = ['RETAIL', 'WHOLESALE', 'INSURANCE', 'CONTRACT', 'PROMOTIONAL'];

const TYPE_TONE: Record<string, 'brand' | 'info' | 'warn' | 'neutral'> = {
  RETAIL: 'brand',
  WHOLESALE: 'info',
  INSURANCE: 'info',
  CONTRACT: 'neutral',
  PROMOTIONAL: 'warn',
};

function productLabel(p: any) {
  if (!p) return '—';
  return [p.brandName || p.genericName, p.strength].filter(Boolean).join(' ');
}

export default function PricingPage() {
  const { toast, confirm } = useFeedback();
  const [version, setVersion] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [addingPrice, setAddingPrice] = useState(false);
  const [quoteProduct, setQuoteProduct] = useState('');
  const [quoteQuantity, setQuoteQuantity] = useState('1');
  const [quoteGroup, setQuoteGroup] = useState('');
  const [quote, setQuote] = useState<any | null>(null);

  const lists = useApi<any[]>('/price-lists', [version]);
  const groups = useApi<any[]>('/customer-groups', [version]);
  const detail = useApi<any>(selectedId ? `/price-lists/${selectedId}` : null, [selectedId, version]);
  const products = useApi<any>('/products?pageSize=200', []);

  const productRows: any[] = products.data?.data ?? products.data?.items ?? [];

  async function submit(path: string, body: unknown, done: string, method = 'POST') {
    setBusy(true);
    setError(null);
    try {
      const result = await api<any>(path, { method, body });
      toast(done, 'ok');
      setVersion((v) => v + 1);
      return result;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createList(form: HTMLFormElement) {
    const f = new FormData(form);
    const created = await submit(
      '/price-lists',
      {
        code: String(f.get('code') || '').trim(),
        name: String(f.get('name') || '').trim(),
        listType: f.get('listType'),
        priority: Number(f.get('priority') || 0),
        customerGroupId: f.get('customerGroupId') || null,
        effectiveFrom: f.get('effectiveFrom') ? new Date(String(f.get('effectiveFrom'))).toISOString() : undefined,
        effectiveTo: f.get('effectiveTo') ? new Date(String(f.get('effectiveTo'))).toISOString() : null,
        notes: String(f.get('notes') || '') || null,
      },
      'Price list created',
    );
    if (created) {
      setCreating(false);
      setSelectedId(created.id);
      form.reset();
    }
  }

  async function addPrice(form: HTMLFormElement) {
    const f = new FormData(form);
    const ok = await submit(
      `/price-lists/${selectedId}/items`,
      {
        productId: f.get('productId'),
        unitPrice: String(f.get('unitPrice')),
        minQuantity: String(f.get('minQuantity') || '0'),
      },
      'Price set — a price-history row was written',
    );
    if (ok) {
      setAddingPrice(false);
      form.reset();
    }
  }

  async function removeItem(item: any) {
    const { confirmed } = await confirm({
      title: `Remove the price for ${productLabel(item.product)}?`,
      body: 'The line is deleted from this list. Prices already charged on past sales are unaffected — they are stored on the sale itself.',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!confirmed) return;
    await submit(`/price-lists/items/${item.id}`, undefined, 'Price removed', 'DELETE');
  }

  async function toggleList(list: any) {
    const next = !list.isActive;
    const { confirmed } = await confirm({
      title: next ? `Activate ${list.name}?` : `Deactivate ${list.name}?`,
      body: next
        ? 'Sales made from now on will consider this list.'
        : 'The list stops applying immediately. Its lines are kept, so it can be switched back on.',
      confirmLabel: next ? 'Activate' : 'Deactivate',
      tone: next ? 'primary' : 'danger',
    });
    if (!confirmed) return;
    await submit(`/price-lists/${list.id}`, { isActive: next }, next ? 'List activated' : 'List deactivated', 'PATCH');
  }

  async function runQuote() {
    if (!quoteProduct) return;
    setBusy(true);
    setError(null);
    setQuote(null);
    try {
      const result = await api<Record<string, any>>('/price-lists/quote', {
        method: 'POST',
        body: {
          productIds: [quoteProduct],
          quantity: Number(quoteQuantity || 1),
          customerGroupId: quoteGroup || undefined,
        },
      });
      setQuote(result[quoteProduct] ?? null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function createGroup(form: HTMLFormElement) {
    const f = new FormData(form);
    const ok = await submit(
      '/customer-groups',
      {
        code: String(f.get('code') || '').trim(),
        name: String(f.get('name') || '').trim(),
        description: String(f.get('description') || '') || null,
        // Stored as a fraction, so 5% is entered as 5 and sent as 0.05.
        discountPercent: String(Number(f.get('discountPercent') || 0) / 100),
      },
      'Customer group created',
    );
    if (ok) form.reset();
  }

  return (
    <Shell>
      <PageHeader
        title="Pricing"
        subtitle="One authority decides what a product costs. The till, dispensing and invoicing all resolve through these lists — none of them reads a product price directly."
        action={
          <button className="btn-primary" onClick={() => setCreating((v) => !v)}>
            {creating ? 'Cancel' : 'New price list'}
          </button>
        }
      />

      {error && <ErrorBox message={error} />}

      {creating && (
        <Card title="New price list" className="mb-5">
          <form
            className="grid gap-3 md:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              void createList(e.currentTarget);
            }}
          >
            <label className="text-xs text-ink-muted">
              Code
              <input name="code" required className="input mt-1" placeholder="WHOLESALE-2026" />
            </label>
            <label className="text-xs text-ink-muted">
              Name
              <input name="name" required className="input mt-1" placeholder="Wholesale 2026" />
            </label>
            <label className="text-xs text-ink-muted">
              Type
              <select name="listType" className="input mt-1">
                {LIST_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-ink-muted">
              Priority (higher wins)
              <input name="priority" type="number" defaultValue={0} className="input mt-1" />
            </label>
            <label className="text-xs text-ink-muted">
              Customer group (optional)
              <select name="customerGroupId" className="input mt-1">
                <option value="">Applies to everyone</option>
                {(groups.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-ink-muted">
              Effective from
              <input name="effectiveFrom" type="date" className="input mt-1" />
            </label>
            <label className="text-xs text-ink-muted">
              Effective to (optional)
              <input name="effectiveTo" type="date" className="input mt-1" />
            </label>
            <label className="text-xs text-ink-muted md:col-span-2">
              Notes
              <input name="notes" className="input mt-1" placeholder="Why this list exists" />
            </label>
            <div className="md:col-span-3">
              <button className="btn-primary" disabled={busy}>
                Create list
              </button>
            </div>
          </form>
        </Card>
      )}

      <div className="space-y-5">
        <Card title="Price lists">
          {lists.error && <ErrorBox message={lists.error} />}
          {lists.loading && !lists.data && <Loading />}
          {lists.data && (
            <DataTable
              rows={lists.data}
              getKey={(l: any) => l.id}
              exportName="price-lists"
              searchPlaceholder="Search price lists"
              selectedKey={selectedId}
              onRowClick={(l: any) => setSelectedId((s) => (s === l.id ? null : l.id))}
              empty="No price list has been created. Until one exists, every sale falls back to the product's own retail price."
              columns={[
                { key: 'code', label: 'Code', value: (l: any) => l.code },
                { key: 'name', label: 'Name', value: (l: any) => l.name },
                {
                  key: 'listType',
                  label: 'Type',
                  value: (l: any) => l.listType,
                  render: (l: any) => <Pill tone={TYPE_TONE[l.listType] ?? 'neutral'}>{l.listType}</Pill>,
                },
                {
                  key: 'scope',
                  label: 'Scope',
                  value: (l: any) => l.customerGroup?.name ?? 'Everyone',
                  render: (l: any) => (
                    <span className="text-xs text-ink-muted">
                      {l.customerGroup?.name ?? 'Everyone'}
                      {l.branchId ? ' · one branch' : ''}
                    </span>
                  ),
                },
                { key: 'priority', label: 'Priority', numeric: true, align: 'right', value: (l: any) => l.priority },
                { key: 'items', label: 'Lines', numeric: true, align: 'right', value: (l: any) => l._count?.items ?? 0 },
                {
                  key: 'window',
                  label: 'Window',
                  optional: true,
                  value: (l: any) => l.effectiveFrom,
                  render: (l: any) => (
                    <span className="text-xs">
                      {shortDate(l.effectiveFrom)} → {l.effectiveTo ? shortDate(l.effectiveTo) : 'open'}
                    </span>
                  ),
                },
                {
                  key: 'active',
                  label: 'Status',
                  value: (l: any) => (l.isActive ? 'Active' : 'Inactive'),
                  render: (l: any) => (
                    <Pill tone={l.isActive ? 'ok' : 'neutral'}>{l.isActive ? 'Active' : 'Inactive'}</Pill>
                  ),
                },
                {
                  key: 'toggle',
                  label: '',
                  render: (l: any) => (
                    <button
                      className="btn-ghost"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        void toggleList(l);
                      }}
                    >
                      {l.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  ),
                },
              ]}
            />
          )}
        </Card>

        {selectedId && (
          <Card
            title={detail.data ? `${detail.data.name} — lines` : 'Lines'}
            action={
              <div className="flex gap-2">
                <button className="btn-ghost" onClick={() => setAddingPrice((v) => !v)}>
                  {addingPrice ? 'Cancel' : 'Add a price'}
                </button>
                <button className="btn-ghost" onClick={() => setSelectedId(null)}>
                  Close
                </button>
              </div>
            }
          >
            {detail.error && <ErrorBox message={detail.error} />}
            {detail.loading && <Loading />}

            {addingPrice && (
              <form
                className="mb-4 grid gap-3 rounded-md border border-surface-border p-3 md:grid-cols-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void addPrice(e.currentTarget);
                }}
              >
                <label className="text-xs text-ink-muted md:col-span-2">
                  Product
                  <select name="productId" required className="input mt-1">
                    <option value="">Choose a product</option>
                    {productRows.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {productLabel(p)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-ink-muted">
                  Unit price
                  <input name="unitPrice" required type="number" step="0.0001" min="0" className="input mt-1" />
                </label>
                <label className="text-xs text-ink-muted">
                  From quantity
                  <input name="minQuantity" type="number" step="0.0001" min="0" defaultValue="0" className="input mt-1" />
                </label>
                <div className="md:col-span-4">
                  <button className="btn-primary" disabled={busy}>
                    Set price
                  </button>
                  <span className="ml-3 text-xs text-ink-subtle">
                    A quantity break applies from that quantity upward; several lines on one product are ranked by the
                    highest break that still qualifies.
                  </span>
                </div>
              </form>
            )}

            {detail.data &&
              (detail.data.items.length === 0 ? (
                <Empty>This list has no prices yet, so it never wins a quote.</Empty>
              ) : (
                <DataTable
                  rows={detail.data.items}
                  getKey={(i: any) => i.id}
                  pageSize={20}
                  exportName={`price-list-${detail.data.code}`}
                  columns={[
                    { key: 'sku', label: 'SKU', value: (i: any) => i.product?.sku ?? '' },
                    { key: 'product', label: 'Product', value: (i: any) => productLabel(i.product) },
                    {
                      key: 'unitPrice',
                      label: 'Unit price',
                      numeric: true,
                      align: 'right',
                      value: (i: any) => Number(i.unitPrice),
                      render: (i: any) => money(i.unitPrice, detail.data.currency),
                    },
                    {
                      key: 'minQuantity',
                      label: 'From qty',
                      numeric: true,
                      align: 'right',
                      value: (i: any) => Number(i.minQuantity),
                    },
                    {
                      key: 'window',
                      label: 'Own window',
                      optional: true,
                      value: (i: any) => i.effectiveFrom ?? '',
                      render: (i: any) =>
                        i.effectiveFrom || i.effectiveTo ? (
                          <span className="text-xs">
                            {i.effectiveFrom ? shortDate(i.effectiveFrom) : 'list start'} →{' '}
                            {i.effectiveTo ? shortDate(i.effectiveTo) : 'list end'}
                          </span>
                        ) : (
                          <span className="text-xs text-ink-subtle">Follows the list</span>
                        ),
                    },
                    {
                      key: 'remove',
                      label: '',
                      render: (i: any) => (
                        <button className="btn-ghost" disabled={busy} onClick={() => void removeItem(i)}>
                          Remove
                        </button>
                      ),
                    },
                  ]}
                />
              ))}
          </Card>
        )}

        <Card title="Explain a price">
          <p className="mb-3 text-xs text-ink-muted">
            Resolve a price exactly as the till would, and see every candidate that was considered and why it won or lost.
          </p>
          <div className="grid gap-3 md:grid-cols-4">
            <label className="text-xs text-ink-muted md:col-span-2">
              Product
              <select className="input mt-1" value={quoteProduct} onChange={(e) => setQuoteProduct(e.target.value)}>
                <option value="">Choose a product</option>
                {productRows.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} — {productLabel(p)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-ink-muted">
              Quantity
              <input
                className="input mt-1"
                type="number"
                min="1"
                value={quoteQuantity}
                onChange={(e) => setQuoteQuantity(e.target.value)}
              />
            </label>
            <label className="text-xs text-ink-muted">
              Customer group
              <select className="input mt-1" value={quoteGroup} onChange={(e) => setQuoteGroup(e.target.value)}>
                <option value="">None</option>
                {(groups.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button className="btn-primary mt-3" disabled={!quoteProduct || busy} onClick={runQuote}>
            Resolve price
          </button>

          {quote && (
            <div className="mt-4 rounded-md border border-surface-border p-3">
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="text-2xl font-semibold num text-ink">{money(quote.unitPrice, quote.currency)}</span>
                <Pill tone="info">{quote.source.replace(/_/g, ' ').toLowerCase()}</Pill>
                {quote.priceListName && <span className="text-sm text-ink-muted">{quote.priceListName}</span>}
              </div>
              <div className="mt-1 text-xs text-ink-subtle">
                Base {money(quote.basePrice, quote.currency)} · tax rate {(Number(quote.taxRate) * 100).toFixed(2)}% ·
                group discount {(Number(quote.groupDiscount) * 100).toFixed(2)}%
              </div>
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-ink-muted">
                {quote.explanation.map((line: string, i: number) => (
                  <li key={i}>{line}</li>
                ))}
              </ol>
            </div>
          )}
        </Card>

        <Card title="Customer groups">
          {groups.error && <ErrorBox message={groups.error} />}
          <form
            className="mb-4 grid gap-3 rounded-md border border-surface-border p-3 md:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              void createGroup(e.currentTarget);
            }}
          >
            <label className="text-xs text-ink-muted">
              Code
              <input name="code" required className="input mt-1" placeholder="INSURED" />
            </label>
            <label className="text-xs text-ink-muted">
              Name
              <input name="name" required className="input mt-1" placeholder="Insured patients" />
            </label>
            <label className="text-xs text-ink-muted">
              Standing discount (%)
              <input name="discountPercent" type="number" step="0.01" min="0" max="100" defaultValue="0" className="input mt-1" />
            </label>
            <label className="text-xs text-ink-muted">
              Description
              <input name="description" className="input mt-1" />
            </label>
            <div className="md:col-span-4">
              <button className="btn-primary" disabled={busy}>
                Add group
              </button>
            </div>
          </form>

          {groups.data && (
            <DataTable
              rows={groups.data}
              getKey={(g: any) => g.id}
              pageSize={10}
              exportName="customer-groups"
              empty="No customer groups yet."
              columns={[
                { key: 'code', label: 'Code', value: (g: any) => g.code },
                { key: 'name', label: 'Name', value: (g: any) => g.name },
                {
                  key: 'discount',
                  label: 'Standing discount',
                  numeric: true,
                  align: 'right',
                  value: (g: any) => Number(g.discountPercent),
                  render: (g: any) => `${(Number(g.discountPercent) * 100).toFixed(2)}%`,
                },
                { key: 'patients', label: 'Patients', numeric: true, align: 'right', value: (g: any) => g._count?.patients ?? 0 },
                { key: 'lists', label: 'Price lists', numeric: true, align: 'right', value: (g: any) => g._count?.priceLists ?? 0 },
                {
                  key: 'active',
                  label: 'Status',
                  value: (g: any) => (g.isActive ? 'Active' : 'Inactive'),
                  render: (g: any) => <Pill tone={g.isActive ? 'ok' : 'neutral'}>{g.isActive ? 'Active' : 'Inactive'}</Pill>,
                },
              ]}
            />
          )}
        </Card>
      </div>
    </Shell>
  );
}
