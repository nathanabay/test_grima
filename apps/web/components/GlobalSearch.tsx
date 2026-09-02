'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Hit {
  type: string;
  id: string;
  title: string;
  subtitle: string;
  linkUrl: string;
  matchedOn: string;
  score: number;
  badge?: string;
}

interface Result {
  query: string;
  total: number;
  hits: Hit[];
  searched: string[];
  skipped: { type: string; reason: string }[];
}

const TYPE_LABELS: Record<string, string> = {
  product: 'Product',
  batch: 'Batch',
  serial: 'Serial',
  supplier: 'Supplier',
  purchase_order: 'Purchase order',
  goods_receipt: 'Goods receipt',
  transfer: 'Transfer',
  prescription: 'Prescription',
  patient: 'Patient',
  sale: 'Sale',
  invoice: 'Invoice',
  return: 'Return',
  recall: 'Recall',
  incident: 'Incident',
  user: 'User',
};

/**
 * One search box across everything the user is allowed to see (§62).
 *
 * Results come back already filtered by permission and branch, so nothing here
 * needs to hide anything — and nothing here could accidentally reveal it.
 */
export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced, so typing does not fire a query per keystroke.
  useEffect(() => {
    if (query.trim().length < 2) {
      setResult(null);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        setResult(await api<Result>(`/search?q=${encodeURIComponent(query)}&limit=5`));
        setHighlight(0);
      } catch {
        setResult(null);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // "/" focuses search from anywhere, the way every other tool does it.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName);
      if (event.key === '/' && !typing) {
        event.preventDefault();
        document.getElementById('global-search')?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  function go(hit: Hit) {
    setOpen(false);
    setQuery('');
    setResult(null);
    router.push(hit.linkUrl);
  }

  const hits = result?.hits ?? [];

  return (
    <div ref={containerRef} className="relative">
      <input
        id="global-search"
        className="input w-full"
        placeholder="Search everything  ( / )"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, hits.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter' && hits[highlight]) {
            go(hits[highlight]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        role="combobox"
        aria-expanded={open}
        aria-controls="global-search-results"
        aria-autocomplete="list"
      />

      {open && query.trim().length >= 2 && (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute z-40 mt-1 max-h-96 w-full overflow-y-auto rounded-md border border-surface-border bg-surface shadow-lg"
        >
          {loading && <div className="px-3 py-3 text-sm text-ink-muted">Searching…</div>}

          {!loading && hits.length === 0 && (
            <div className="px-3 py-3 text-sm text-ink-muted">
              Nothing matched “{query}”.
              {result && result.skipped.length > 0 && (
                <div className="mt-1 text-xs text-ink-subtle">
                  {/* Said plainly, so a user who expected a result understands why. */}
                  {result.skipped.length} record type
                  {result.skipped.length === 1 ? ' was' : 's were'} not searched because your role
                  does not include them.
                </div>
              )}
            </div>
          )}

          {hits.map((hit, index) => (
            <button
              key={`${hit.type}:${hit.id}`}
              type="button"
              role="option"
              aria-selected={index === highlight}
              className={`flex w-full items-start gap-3 border-b border-surface-border px-3 py-2 text-left last:border-0 ${
                index === highlight ? 'bg-brand-light' : 'hover:bg-surface-sunken'
              }`}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => go(hit)}
            >
              <span className="mt-0.5 w-24 shrink-0 text-xs font-medium uppercase tracking-wide text-ink-subtle">
                {TYPE_LABELS[hit.type] ?? hit.type}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{hit.title}</span>
                <span className="block truncate text-xs text-ink-muted">{hit.subtitle}</span>
              </span>
              {hit.badge && (
                <span className="shrink-0 rounded bg-surface-sunken px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
                  {hit.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
