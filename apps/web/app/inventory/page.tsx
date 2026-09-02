'use client';

import { useState } from 'react';
import { Shell, PageHeader } from '@/components/Shell';
import { useApi } from '@/lib/useApi';
import { money, qty, shortDate } from '@/lib/api';
import { BatchStatus, Card, Empty, ErrorBox, ExpiryPill, Loading, Table } from '@/components/ui';

export default function InventoryPage() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const { data, error, loading } = useApi<any>(
    `/inventory/balances?pageSize=50&page=${page}${query ? `&search=${encodeURIComponent(query)}` : ''}`,
  );

  return (
    <Shell>
      <PageHeader
        title="Stock Balances"
        subtitle="Batch-level on-hand and available quantities, scoped to your branches."
      />

      <Card className="mb-4">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQuery(search);
          }}
        >
          <input
            className="input flex-1 min-w-[220px]"
            placeholder="Search by generic name, brand or SKU"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn-primary">Search</button>
          {query && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setSearch('');
                setQuery('');
                setPage(1);
              }}
            >
              Clear
            </button>
          )}
        </form>
      </Card>

      {error && <ErrorBox message={error} />}
      {loading && <Loading />}

      {data && (
        <Card
          title={`${data.total.toLocaleString()} stock position${data.total === 1 ? '' : 's'}`}
          action={
            <div className="flex items-center gap-2 text-sm">
              <button className="btn-ghost" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <span className="text-ink-muted">Page {data.page}</span>
              <button
                className="btn-ghost"
                disabled={data.page * data.pageSize >= data.total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          }
        >
          {data.data.length ? (
            <Table
              head={['Product', 'Batch', 'Status', 'Expiry', 'On hand', 'Reserved', 'Available', 'Value', 'Location']}
            >
              {data.data.map((row: any) => (
                <tr key={row.id}>
                  <td className="td">
                    <div className="font-medium">
                      {row.product.genericName} {row.product.strength}
                    </div>
                    <div className="text-xs text-ink-subtle">
                      {row.product.brandName ? `${row.product.brandName} · ` : ''}
                      {row.product.sku}
                      {row.product.isControlled && ' · CONTROLLED'}
                      {row.product.isColdChain && ' · COLD CHAIN'}
                    </div>
                  </td>
                  <td className="td text-ink-muted">{row.batch?.batchNumber ?? '-'}</td>
                  <td className="td">{row.batch ? <BatchStatus status={row.batch.status} /> : '-'}</td>
                  <td className="td">
                    <div className="text-xs text-ink-muted">{shortDate(row.batch?.expiryDate)}</div>
                    <ExpiryPill days={row.daysToExpiry} />
                  </td>
                  <td className="td num">{qty(row.onHand)}</td>
                  <td className="td num text-ink-muted">{qty(row.reserved)}</td>
                  <td className="td num font-medium">{qty(row.available)}</td>
                  <td className="td num">{money(row.stockValue)}</td>
                  <td className="td text-xs text-ink-muted">
                    {row.warehouse.name}
                    {row.location && <div>{row.location.code}</div>}
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty>No stock positions match this search.</Empty>
          )}
        </Card>
      )}
    </Shell>
  );
}
