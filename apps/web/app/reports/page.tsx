'use client';

import { useMemo, useState } from 'react';
import { Shell, PageHeader } from '@/components/Shell';
import { useApi } from '@/lib/useApi';
import { tokenStore } from '@/lib/api';
import { Card, Empty, ErrorBox, Loading, Table } from '@/components/ui';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Reporting centre (§41, §61).
 *
 * The same report definition drives the on-screen table and every download, so
 * what you see is exactly what exports. Downloads carry the bearer token, which
 * means they cannot be a plain <a href> — the file is fetched and handed to the
 * browser as a blob.
 */
export default function ReportsPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [days, setDays] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const catalog = useApi<any[]>('/reports');

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (days) p.set('days', days);
    return p.toString();
  }, [from, to, days]);

  const result = useApi<any>(
    selected ? `/reports/run/${selected}${query ? `?${query}` : ''}` : null,
    [selected, query],
  );

  const grouped = useMemo(() => {
    const g: Record<string, any[]> = {};
    for (const r of catalog.data ?? []) (g[r.group] ??= []).push(r);
    return g;
  }, [catalog.data]);

  async function download(format: 'csv' | 'xlsx' | 'print') {
    if (!selected) return;
    setDownloading(format);
    setError(null);
    try {
      const url = `${API_BASE}/api/reports/run/${selected}?format=${format}${query ? `&${query}` : ''}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${tokenStore.access}` } });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);

      if (format === 'print') {
        // Print opens in a window rather than downloading a file.
        const html = await res.text();
        const w = window.open('', '_blank');
        if (!w) throw new Error('Pop-up blocked — allow pop-ups to print reports');
        w.document.write(html);
        w.document.close();
        return;
      }

      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `${selected}-${new Date().toISOString().slice(0, 10)}.${format === 'csv' ? 'csv' : 'xls'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Reporting Centre"
        subtitle="Every report exports to CSV, Excel or print from the same definition, so the download always matches the screen."
      />

      {error && <div className="mb-3"><ErrorBox message={error} /></div>}

      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="lg:col-span-1" title={`${catalog.data?.length ?? 0} reports`}>
          {catalog.loading && <Loading />}
          <div className="max-h-[70vh] space-y-3 overflow-y-auto">
            {Object.entries(grouped).map(([group, reports]) => (
              <div key={group}>
                <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">{group}</div>
                {reports.map((r) => (
                  <button key={r.key} onClick={() => setSelected(r.key)}
                    className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${selected === r.key ? 'bg-brand-light font-medium text-brand-dark' : 'text-ink-muted hover:bg-surface-sunken'}`}
                    title={r.description}>
                    {r.title}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </Card>

        <div className="lg:col-span-3">
          {!selected && <Card><Empty>Choose a report.</Empty></Card>}

          {selected && (
            <Card
              title={result.data?.title ?? 'Loading'}
              action={
                <div className="flex flex-wrap gap-1">
                  <button className="btn-ghost text-xs" disabled={!!downloading} onClick={() => download('csv')}>
                    {downloading === 'csv' ? '...' : 'CSV'}
                  </button>
                  <button className="btn-ghost text-xs" disabled={!!downloading} onClick={() => download('xlsx')}>
                    {downloading === 'xlsx' ? '...' : 'Excel'}
                  </button>
                  <button className="btn-ghost text-xs" disabled={!!downloading} onClick={() => download('print')}>
                    {downloading === 'print' ? '...' : 'Print'}
                  </button>
                </div>
              }
            >
              <div className="mb-3 flex flex-wrap gap-2">
                <label className="text-xs">
                  <span className="label">From</span>
                  <input type="date" className="input w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
                </label>
                <label className="text-xs">
                  <span className="label">To</span>
                  <input type="date" className="input w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
                </label>
                <label className="text-xs">
                  <span className="label">Days window</span>
                  <input type="number" className="input w-28 num" value={days} onChange={(e) => setDays(e.target.value)} placeholder="e.g. 90" />
                </label>
                {(from || to || days) && (
                  <button className="btn-ghost self-end text-xs" onClick={() => { setFrom(''); setTo(''); setDays(''); }}>Clear filters</button>
                )}
              </div>

              {result.loading && <Loading label="Running" />}
              {result.error && <ErrorBox message={result.error} />}

              {result.data && (
                <>
                  {result.data.totals?.length > 0 && (
                    <div className="mb-3 flex flex-wrap gap-3">
                      {result.data.totals.map(([label, value]: [string, string]) => (
                        <div key={label} className="rounded-md bg-surface-sunken px-3 py-2">
                          <div className="text-xs text-ink-muted">{label}</div>
                          <div className="text-sm font-semibold num">{value}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {result.data.rows.length ? (
                    <>
                      <Table head={result.data.columns.map((c: any) => c.label)}>
                        {result.data.rows.slice(0, 200).map((row: any, i: number) => (
                          <tr key={i}>
                            {result.data.columns.map((c: any) => {
                              const raw = c.key.split('.').reduce((a: any, k: string) => a?.[k], row);
                              const numeric = ['number', 'money', 'integer'].includes(c.type);
                              const display =
                                raw === null || raw === undefined ? '-'
                                : c.type === 'money' ? Number(raw).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                : c.type === 'date' ? String(raw).slice(0, 10)
                                : String(raw);
                              return <td key={c.key} className={`td ${numeric ? 'num' : ''}`}>{display}</td>;
                            })}
                          </tr>
                        ))}
                      </Table>
                      {result.data.rows.length > 200 && (
                        <p className="mt-2 text-xs text-ink-subtle">
                          Showing the first 200 of {result.data.rows.length} rows. Export to see them all.
                        </p>
                      )}
                    </>
                  ) : (
                    <Empty>No rows match these filters.</Empty>
                  )}
                </>
              )}
            </Card>
          )}
        </div>
      </div>
    </Shell>
  );
}
