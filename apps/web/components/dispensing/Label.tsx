'use client';

import { qty, shortDate } from '@/lib/api';

/**
 * The dispensing label that goes on the box (§24).
 *
 * A pharmacy label is not a receipt. It has to carry, on the pack the patient
 * takes home: who it is for, what it is, how much to take and when, the batch
 * and expiry it came from, and the cautionary wording for that medicine. A
 * dispensing record that cannot produce one is only half a dispensing.
 *
 * Every field here comes from the dispensing record and the prescription.
 * Nothing is invented: where the prescriber wrote no directions, the label says
 * so in words the patient can act on ("as directed by your prescriber") rather
 * than printing a blank line that reads as though there is nothing to take.
 */

export interface LabelItem {
  productName: string;
  strength?: string | null;
  form?: string | null;
  quantity: unknown;
  unit?: string | null;
  directions?: string | null;
  batchNumber?: string | null;
  expiryDate?: unknown;
  auxiliaryLabels?: string[];
  isColdChain?: boolean;
  substitutedFor?: string | null;
}

export function DispensingLabel({
  items,
  patientName,
  patientCode,
  dispensingNo,
  dispensedAt,
  pharmacistName,
  branchName,
  branchPhone,
  printCount,
  onPrint,
  onClose,
}: {
  items: LabelItem[];
  patientName: string;
  patientCode?: string | null;
  dispensingNo: string;
  dispensedAt: unknown;
  pharmacistName?: string | null;
  branchName?: string | null;
  branchPhone?: string | null;
  /** How many times this label has already been printed. */
  printCount?: number;
  onPrint?: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="receipt label-sheet mx-auto max-w-xs bg-surface text-small text-ink">
      {items.map((item, index) => (
        <article
          key={`${item.productName}-${item.batchNumber ?? index}`}
          className="label-page border-b border-dashed border-border pb-3 pt-3 first:pt-0 last:border-b-0"
        >
          <header className="flex items-baseline justify-between gap-2">
            <span className="text-caption font-semibold uppercase tracking-wide">
              {branchName ?? 'Pharmacy'}
            </span>
            <span className="text-caption text-ink-muted">{shortDate(dispensedAt)}</span>
          </header>

          <p className="mt-1 text-body font-semibold">{patientName}</p>
          {patientCode && <p className="text-caption text-ink-muted">{patientCode}</p>}

          <p className="mt-2 text-body font-semibold">
            {item.productName}
            {item.strength ? ` ${item.strength}` : ''}
          </p>
          <p className="text-caption text-ink-muted">
            {qty(item.quantity)} {item.unit ?? ''}
            {item.form ? ` · ${item.form}` : ''}
          </p>

          {/*
            The directions are the point of the label. They are set larger than
            everything else because they are what the patient reads, often
            without their glasses.
          */}
          <p className="mt-2 border-y border-border py-1.5 text-section font-semibold leading-snug">
            {item.directions?.trim() || 'Take as directed by your prescriber'}
          </p>

          {item.substitutedFor && (
            <p className="mt-1 text-caption font-medium">
              Supplied in place of {item.substitutedFor}. Same medicine, different brand.
            </p>
          )}

          {(item.auxiliaryLabels?.length || item.isColdChain) && (
            <ul className="mt-1.5 space-y-0.5 text-caption font-medium">
              {item.isColdChain && <li>Keep refrigerated between 2°C and 8°C. Do not freeze.</li>}
              {(item.auxiliaryLabels ?? []).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}

          <dl className="mt-2 grid grid-cols-2 gap-x-2 text-caption text-ink-muted">
            <dt>Batch</dt>
            <dd className="num text-right">{item.batchNumber ?? '—'}</dd>
            <dt>Expires</dt>
            <dd className="num text-right">
              {item.expiryDate ? shortDate(item.expiryDate) : '—'}
            </dd>
            <dt>Ref</dt>
            <dd className="num text-right">{dispensingNo}</dd>
          </dl>

          <footer className="mt-2 text-caption text-ink-muted">
            <p>Keep out of the reach of children.</p>
            {pharmacistName && <p>Dispensed by {pharmacistName}</p>}
            {branchPhone && <p>Questions? {branchPhone}</p>}
          </footer>
        </article>
      ))}

      {(onPrint || onClose) && (
        <div className="no-print mt-3 flex items-center justify-center gap-2">
          {typeof printCount === 'number' && printCount > 0 && (
            <span className="text-caption text-ink-muted">
              Printed {printCount} time{printCount === 1 ? '' : 's'}
            </span>
          )}
          {onPrint && (
            <button className="btn-primary btn-sm" onClick={onPrint}>
              Print label{items.length > 1 ? 's' : ''}
            </button>
          )}
          {onClose && (
            <button className="btn-ghost btn-sm" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      )}
    </div>
  );
}
