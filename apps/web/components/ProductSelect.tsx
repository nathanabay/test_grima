"use client";

import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/api";

/**
 * Choosing one record out of a set too large to render.
 *
 * The forms that price, count, register and import used to put every option
 * into a `<select>`, fetched with a cap of 50 to 200 rows. A `<select>` cannot
 * page, so a pharmacy past that many products or batches simply could not pick
 * the rest — and nothing on screen said so. This asks the server as the reader
 * types, which is the only shape of this control that stays correct as the
 * catalogue grows.
 *
 * It renders a hidden input under `name`, so it drops into the existing
 * `FormData` forms without changing how they submit.
 */
export function RemoteSelect<T extends { id: string }>({
  name,
  value,
  onChange,
  path,
  searchKey = "q",
  extraQuery = "",
  primary,
  secondary,
  placeholder,
  emptyHint,
  required,
  disabled,
}: {
  /** Hidden field name, for forms read through FormData. */
  name?: string;
  value: string;
  onChange: (id: string, record: T | null) => void;
  /** List endpoint, which must accept `pageSize` and the search key. */
  path: string;
  searchKey?: string;
  /** Extra query parameters, e.g. "isControlled=true". */
  extraQuery?: string;
  primary: (record: T) => string;
  secondary?: (record: T) => ReactNode;
  placeholder?: string;
  emptyHint?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<T[]>([]);
  const [picked, setPicked] = useState<T | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);

  // The parent may clear the selection after a successful submit.
  useEffect(() => {
    if (!value) setPicked(null);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const handle = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const search = term.trim()
          ? `&${searchKey}=${encodeURIComponent(term.trim())}`
          : "";
        const res = await api<any>(
          `${path}?pageSize=20${search}${extraQuery ? `&${extraQuery}` : ""}`,
        );
        if (live) setResults(res?.data ?? res?.items ?? []);
      } catch (e: any) {
        if (live) setError(e.message ?? "Could not search");
      } finally {
        if (live) setLoading(false);
      }
    }, 200);
    return () => {
      live = false;
      clearTimeout(handle);
    };
  }, [term, open, path, searchKey, extraQuery]);

  useEffect(() => {
    function away(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  function choose(record: T) {
    setPicked(record);
    setOpen(false);
    setTerm("");
    onChange(record.id, record);
  }

  return (
    <div className="relative" ref={box}>
      {name && <input type="hidden" name={name} value={value} />}
      {picked && value ? (
        <div className="input mt-1 flex items-center justify-between gap-2">
          <span className="truncate">
            <span className="font-medium">{primary(picked)}</span>
            {secondary && (
              <span className="ml-1 text-xs text-ink-subtle">
                {secondary(picked)}
              </span>
            )}
          </span>
          <button
            type="button"
            className="btn-ghost btn-sm shrink-0"
            disabled={disabled}
            onClick={() => {
              setPicked(null);
              onChange("", null);
              setOpen(true);
            }}
          >
            Change
          </button>
        </div>
      ) : (
        <input
          className="input mt-1"
          placeholder={placeholder}
          value={term}
          disabled={disabled}
          required={required && !value}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
        />
      )}

      {open && !picked && (
        <div
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-surface-border bg-surface shadow-lg"
        >
          {loading && (
            <div className="px-3 py-2 text-xs text-ink-muted">Searching</div>
          )}
          {error && <div className="px-3 py-2 text-xs text-danger">{error}</div>}
          {!loading && !error && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-ink-muted">
              {term.trim() ? "Nothing matches that." : emptyHint}
            </div>
          )}
          {results.map((record) => (
            <button
              key={record.id}
              type="button"
              role="option"
              aria-selected={false}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-sunken"
              onClick={() => choose(record)}
            >
              <div className="font-medium">{primary(record)}</div>
              {secondary && (
                <div className="text-xs text-ink-subtle">
                  {secondary(record)}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface PickedProduct {
  id: string;
  sku: string;
  genericName: string;
  strength?: string | null;
  brandName?: string | null;
  baseUnit?: string | null;
}

/** Choosing a product from the whole drug master, not from the first page. */
export function ProductSelect({
  name,
  value,
  onChange,
  query: extraQuery = "",
  placeholder = "Search by name, brand or SKU",
  required,
  disabled,
}: {
  name?: string;
  value: string;
  onChange: (productId: string, product: PickedProduct | null) => void;
  query?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <RemoteSelect<PickedProduct>
      name={name}
      value={value}
      onChange={onChange}
      path="/products"
      searchKey="q"
      extraQuery={extraQuery}
      placeholder={placeholder}
      required={required}
      disabled={disabled}
      primary={(p) => [p.genericName, p.strength].filter(Boolean).join(" ")}
      secondary={(p) => `${p.brandName ? `${p.brandName} · ` : ""}${p.sku}`}
      emptyHint="Type to search the drug master."
    />
  );
}

export interface PickedBatch {
  id: string;
  batchNumber: string;
  lotNumber?: string | null;
  expiryDate?: string | null;
  product?: { genericName?: string; strength?: string | null } | null;
}

/** Choosing a batch from every batch, not from the first hundred. */
export function BatchSelect({
  name,
  value,
  onChange,
  query: extraQuery = "",
  placeholder = "Search batch number, lot or product",
  required,
  disabled,
}: {
  name?: string;
  value: string;
  onChange: (batchId: string, batch: PickedBatch | null) => void;
  query?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <RemoteSelect<PickedBatch>
      name={name}
      value={value}
      onChange={onChange}
      path="/inventory/batches"
      searchKey="search"
      extraQuery={extraQuery}
      placeholder={placeholder}
      required={required}
      disabled={disabled}
      primary={(b) =>
        [b.product?.genericName, b.product?.strength]
          .filter(Boolean)
          .join(" ") || b.batchNumber
      }
      secondary={(b) =>
        [b.batchNumber, b.lotNumber, b.expiryDate?.slice(0, 10)]
          .filter(Boolean)
          .join(" · ")
      }
      emptyHint="Type to search batches."
    />
  );
}
