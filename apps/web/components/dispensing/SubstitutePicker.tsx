'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Choosing an equivalent when the prescribed brand is not what is being handed
 * over (§23).
 *
 * The candidates come from the product's curated substitute list, not from a
 * name search: "same first word" is not a clinical equivalence, and a picker
 * that offers one is a picker that will eventually be believed. If the catalogue
 * records no equivalents, the pharmacist supplies what was prescribed, and this
 * says so rather than offering a text box.
 */
export function SubstitutePicker({
  prescribedProductId,
  currentProductId,
  onPick,
}: {
  prescribedProductId: string;
  currentProductId: string;
  onPick: (productId: string, name: string) => void;
}) {
  const [options, setOptions] = useState<any[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || options) return;
    let cancelled = false;
    api<any>(`/products/${prescribedProductId}/substitutes`)
      .then((result) => {
        if (cancelled) return;
        setOptions(Array.isArray(result) ? result : (result?.data ?? []));
      })
      .catch(() => !cancelled && setOptions([]));
    return () => {
      cancelled = true;
    };
  }, [open, options, prescribedProductId]);

  if (!open) {
    return (
      <button className="btn-quiet btn-sm" onClick={() => setOpen(true)}>
        {currentProductId === prescribedProductId ? 'Substitute…' : 'Change substitute…'}
      </button>
    );
  }

  return (
    <div className="rounded-md border border-border p-2">
      <div className="flex items-center justify-between">
        <span className="text-caption font-medium">Recorded equivalents</span>
        <button className="btn-quiet btn-sm" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      {options === null && <p className="mt-1 text-caption text-ink-muted">Loading…</p>}

      {options?.length === 0 && (
        <p className="mt-1 text-caption text-ink-muted">
          The catalogue records no equivalent for this medicine. Supply what was prescribed, or
          add the equivalence to the product record first.
        </p>
      )}

      {!!options?.length && (
        <ul className="mt-1 space-y-0.5">
          {currentProductId !== prescribedProductId && (
            <li>
              <button
                className="w-full rounded px-2 py-1 text-left text-small hover:bg-surface-sunken"
                onClick={() => {
                  onPick(prescribedProductId, 'the prescribed product');
                  setOpen(false);
                }}
              >
                Back to what was prescribed
              </button>
            </li>
          )}
          {options.map((o) => {
            const product = o.product ?? o.relatedProduct ?? o;
            const id = product.id ?? o.relatedProductId;
            const name = [product.genericName, product.strength, product.brandName]
              .filter(Boolean)
              .join(' ');
            if (!id) return null;
            return (
              <li key={id}>
                <button
                  className="w-full rounded px-2 py-1 text-left text-small hover:bg-surface-sunken disabled:opacity-50"
                  disabled={id === currentProductId}
                  onClick={() => {
                    onPick(id, name || 'Equivalent');
                    setOpen(false);
                  }}
                >
                  {name || id.slice(0, 8)}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
