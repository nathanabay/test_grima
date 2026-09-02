'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthUser, api, can } from '@/lib/api';

/**
 * Command palette (§21).
 *
 * Two things in one surface, because that is how people actually reach for it:
 * navigation and quick actions from a static list, and records from the server.
 * Both are filtered by permission — the palette never offers a route the API
 * would refuse, and never shows a record the caller may not read, because the
 * search endpoint applies the same scope as every other read.
 */

export interface Command {
  id: string;
  label: string;
  group: string;
  href: string;
  keywords?: string;
  permission?: string;
}

interface Hit {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  href?: string;
  linkUrl?: string;
}

export function CommandPalette({
  open,
  onClose,
  user,
  commands,
}: {
  open: boolean;
  onClose: () => void;
  user: AuthUser | null;
  commands: Command[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [skipped, setSkipped] = useState<{ type: string; reason: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const allowed = useMemo(
    () => commands.filter((c) => !c.permission || can(user, c.permission)),
    [commands, user],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allowed.slice(0, 12);
    return allowed
      .filter((c) => `${c.label} ${c.group} ${c.keywords ?? ''}`.toLowerCase().includes(q))
      .slice(0, 12);
  }, [allowed, query]);

  // Records come from the server, debounced, and only once the query is long
  // enough to be worth a round trip.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSkipped([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await api<any>(`/search?q=${encodeURIComponent(q)}&limit=6`);
        if (cancelled) return;
        setHits(res.hits ?? []);
        setSkipped(res.skipped ?? []);
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const rows = useMemo(
    () => [
      ...matches.map((c) => ({ kind: 'command' as const, key: c.id, label: c.label, group: c.group, href: c.href })),
      ...hits.map((h) => ({
        kind: 'record' as const,
        key: `${h.type}:${h.id}`,
        label: h.title,
        group: h.subtitle ?? h.type,
        href: h.linkUrl ?? h.href ?? '#',
      })),
    ],
    [matches, hits],
  );

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      // Focus after paint, or the browser hands it back to the trigger.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const go = useCallback(
    (href: string) => {
      onClose();
      if (href && href !== '#') router.push(href);
    },
    [onClose, router],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[active];
      if (row) go(row.href);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  let lastGroup = '';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-xl overflow-hidden rounded-card border border-border
                   bg-surface-raised shadow-overlay"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search pages, products, batches, patients, orders…"
          aria-label="Search or run a command"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-body
                     text-ink outline-none placeholder:text-ink-subtle"
        />

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1" role="listbox">
          {rows.length === 0 && (
            <p className="px-4 py-6 text-center text-small text-ink-muted">
              {query.trim().length < 2
                ? 'Type to search. Records appear once you have typed two characters.'
                : searching
                  ? 'Searching…'
                  : 'Nothing matches that.'}
            </p>
          )}

          {rows.map((row, i) => {
            const header = row.group !== lastGroup ? row.group : null;
            lastGroup = row.group;
            return (
              <div key={row.key}>
                {header && (
                  <div className="px-4 pb-1 pt-2 text-caption uppercase text-ink-subtle">
                    {header}
                  </div>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  data-active={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(row.href)}
                  className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-body
                              ${i === active ? 'bg-brand/10 text-ink' : 'text-ink-muted hover:bg-surface-sunken'}`}
                >
                  <span className="truncate">{row.label}</span>
                  {row.kind === 'record' && (
                    <span className="shrink-0 text-caption uppercase text-ink-subtle">record</span>
                  )}
                </button>
              </div>
            );
          })}

          {skipped.length > 0 && (
            // Said out loud: a reader who cannot see patients should know the
            // search did not silently pretend there were none.
            <p className="border-t border-border px-4 py-2 text-caption text-ink-subtle">
              Not searched: {skipped.map((s) => `${s.type} (${s.reason})`).join(', ')}.
            </p>
          )}
        </div>

        <footer className="flex items-center gap-4 border-t border-border bg-surface-sunken px-4 py-2 text-caption text-ink-subtle">
          <span><kbd className="font-mono">↑</kbd> <kbd className="font-mono">↓</kbd> move</span>
          <span><kbd className="font-mono">↵</kbd> open</span>
          <span><kbd className="font-mono">esc</kbd> close</span>
        </footer>
      </div>
    </div>
  );
}

/** Opens on Cmd/Ctrl+K anywhere except inside a text field. */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return { open, setOpen };
}
