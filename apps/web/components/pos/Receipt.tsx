'use client';

import { money, qty, shortDate } from '@/lib/api';

/**
 * A receipt that prints as a receipt (§22).
 *
 * The old till called `window.print()` on the whole page, so a customer's
 * receipt came out as a screenshot of the application — sidebar, navigation and
 * all. This renders a receipt-shaped document and the print stylesheet hides
 * everything else, so what comes out of the printer is what a customer expects.
 *
 * The batch each line came from is printed deliberately: a recall reaches a
 * customer through the receipt in their bag long before it reaches them any
 * other way.
 */
export function Receipt({
  sale,
  branchName,
  onClose,
}: {
  sale: any;
  branchName?: string;
  onClose?: () => void;
}) {
  const paid = (sale.payments ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0);
  const change =
    sale.changeDue !== undefined
      ? Number(sale.changeDue)
      : Math.max(0, paid - Number(sale.grandTotal));

  return (
    <div className="receipt mx-auto max-w-sm bg-surface p-4 text-small text-ink">
      <header className="border-b border-dashed border-border pb-2 text-center">
        <div className="text-section font-semibold">{branchName ?? 'Pharmacy'}</div>
        <div className="text-caption text-ink-muted">Sale {sale.saleNo}</div>
        <div className="text-caption text-ink-muted">
          {shortDate(sale.soldAt ?? sale.createdAt)}
        </div>
      </header>

      <table className="mt-2 w-full">
        <tbody>
          {(sale.items ?? []).map((i: any) => (
            <tr key={i.id} className="align-top">
              <td className="py-0.5">
                <div>{i.product?.genericName ?? i.productName ?? i.productId.slice(0, 8)}</div>
                <div className="text-caption text-ink-muted">
                  {qty(i.quantity)} × {money(i.unitPrice)}
                  {Number(i.discountPct) > 0 &&
                    ` · −${(Number(i.discountPct) * 100).toFixed(0)}%`}
                  {i.batch?.batchNumber && ` · batch ${i.batch.batchNumber}`}
                </div>
              </td>
              <td className="num py-0.5 text-right align-top">{money(i.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="mt-2 space-y-0.5 border-t border-dashed border-border pt-2">
        <Row label="Subtotal" value={money(sale.subtotal)} />
        {Number(sale.discountTotal) > 0 && (
          <Row label="Discount" value={`-${money(sale.discountTotal)}`} />
        )}
        <Row label="Tax" value={money(sale.taxTotal)} />
        <Row label="Total" value={money(sale.grandTotal)} strong />
        {(sale.payments ?? []).map((p: any) => (
          <Row
            key={p.id}
            label={p.method.replace(/_/g, ' ').toLowerCase()}
            value={money(p.amount)}
          />
        ))}
        {change > 0 && <Row label="Change" value={money(change)} strong />}
      </dl>

      {(sale.warnings ?? []).length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 border-t border-dashed border-border pl-4 pt-2 text-caption text-ink-muted">
          {sale.warnings.map((w: string) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <footer className="mt-3 border-t border-dashed border-border pt-2 text-center text-caption text-ink-muted">
        <p>Keep this receipt. It identifies the batch you were supplied.</p>
      </footer>

      {onClose && (
        <div className="no-print mt-3 flex justify-center gap-2">
          <button className="btn-primary btn-sm" onClick={() => window.print()}>
            Print
          </button>
          <button className="btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'font-semibold' : ''}`}>
      <dt className={strong ? '' : 'text-ink-muted'}>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}
