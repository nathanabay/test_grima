'use client';

import { StatusBadge, type StatusTone } from '@/components/status';

/**
 * The clinical warnings panel (§24).
 *
 * Three rules shape this component, and each of them is there because the
 * opposite gets somebody hurt:
 *
 * 1. Nothing here refuses a supply. The pharmacist is the clinician and can see
 *    the patient; a screen that blocks a legitimate supply is a screen people
 *    learn to click through.
 * 2. A CRITICAL warning cannot be passed silently. It needs a typed reason, and
 *    the Dispense button stays disabled until every one of them has one. The
 *    server enforces the same rule, so this is a courtesy, not the control.
 * 3. Severity decides order and emphasis, never whether a warning is shown.
 *    A collapsed "3 more" that hides an allergy is worse than a long list.
 */

export interface ClinicalWarning {
  code: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  productId: string;
  product: string;
  message: string;
  action: string;
}

const RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

const TONE: Record<string, string> = {
  CRITICAL: 'border-danger/40 bg-danger-light',
  HIGH: 'border-warn/40 bg-warn-light',
  MEDIUM: 'border-border bg-surface-sunken',
  LOW: 'border-border bg-surface-sunken',
};

/**
 * Severity to the product's own status tones.
 *
 * Deliberately not white-on-saturated-fill: the design system tints the
 * background and keeps the text in the accent colour, which is the only
 * treatment that holds its contrast in both themes.
 */
const BADGE_TONE: Record<string, StatusTone> = {
  CRITICAL: 'out',
  HIGH: 'expired',
  MEDIUM: 'near',
  LOW: 'info',
};

export function ClinicalWarnings({
  warnings,
  overrides,
  onOverrideChange,
  readOnly,
}: {
  warnings: ClinicalWarning[];
  /** code → reason typed by the pharmacist. */
  overrides: Record<string, string>;
  onOverrideChange: (code: string, reason: string) => void;
  readOnly?: boolean;
}) {
  if (!warnings.length) {
    return (
      <p className="rounded-md border border-ok/30 bg-ok-light px-3 py-2 text-small text-ok">
        No clinical warnings were raised. The checks are a safety net, not a substitute for
        reading the prescription.
      </p>
    );
  }

  const sorted = [...warnings].sort(
    (a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9),
  );
  const critical = sorted.filter((w) => w.severity === 'CRITICAL');
  const outstanding = critical.filter((w) => !overrides[w.code]?.trim()).length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-small font-semibold">
          {warnings.length} clinical warning{warnings.length === 1 ? '' : 's'}
        </h3>
        {critical.length > 0 && !readOnly && (
          <span
            className={`text-caption font-medium ${outstanding ? 'text-danger' : 'text-ok'}`}
            role="status"
          >
            {outstanding
              ? `${outstanding} of ${critical.length} critical warning${
                  critical.length === 1 ? '' : 's'
                } still need a reason`
              : 'Every critical warning has been acknowledged'}
          </span>
        )}
      </div>

      <ul className="space-y-2">
        {sorted.map((w) => (
          <li key={w.code} className={`rounded-md border p-2.5 ${TONE[w.severity] ?? TONE.LOW}`}>
            <div className="flex flex-wrap items-baseline gap-2">
              <StatusBadge tone={BADGE_TONE[w.severity] ?? 'info'}>{w.severity}</StatusBadge>
              <span className="text-small font-medium">{w.product}</span>
            </div>
            <p className="mt-1 text-small">{w.message}</p>
            <p className="mt-0.5 text-caption text-ink-muted">{w.action}</p>

            {w.severity === 'CRITICAL' && !readOnly && (
              <label className="mt-2 block">
                <span className="text-caption font-medium">
                  Why are you supplying anyway? (required)
                </span>
                <input
                  className="input mt-1"
                  value={overrides[w.code] ?? ''}
                  onChange={(e) => onOverrideChange(w.code, e.target.value)}
                  placeholder="e.g. prescriber confirmed by phone; patient has tolerated this before"
                />
              </label>
            )}

            {w.severity === 'CRITICAL' && readOnly && overrides[w.code] && (
              <p className="mt-1 text-caption">
                <span className="font-medium">Overridden:</span> {overrides[w.code]}
              </p>
            )}
          </li>
        ))}
      </ul>

      <p className="text-caption text-ink-subtle">
        These checks are advisory. None of them refuses a supply — they are a prompt to look, and
        the decision, with its reason, is recorded against the dispensing.
      </p>
    </div>
  );
}

/** True when every CRITICAL warning carries a typed reason. */
export function criticalWarningsAcknowledged(
  warnings: ClinicalWarning[],
  overrides: Record<string, string>,
): boolean {
  return warnings
    .filter((w) => w.severity === 'CRITICAL')
    .every((w) => !!overrides[w.code]?.trim());
}
