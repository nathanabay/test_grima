'use client';

import { ReactNode } from 'react';

export function Card({
  title,
  action,
  children,
  className = '',
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-surface-border">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const TONES = {
  neutral: 'bg-slate-100 text-slate-700',
  ok: 'bg-ok-light text-ok',
  warn: 'bg-warn-light text-warn',
  danger: 'bg-danger-light text-danger',
  info: 'bg-info-light text-info',
  brand: 'bg-brand-light text-brand-dark',
} as const;

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: keyof typeof TONES;
}) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

/** Batch status -> colour, so unusable stock is obvious at a glance. */
export function BatchStatus({ status }: { status: string }) {
  const tone: keyof typeof TONES =
    status === 'AVAILABLE' || status === 'RELEASED'
      ? 'ok'
      : status === 'QUARANTINED'
        ? 'warn'
        : status === 'EXPIRED' || status === 'RECALLED' || status === 'DESTROYED'
          ? 'danger'
          : 'neutral';
  return <Pill tone={tone}>{status}</Pill>;
}

export function ExpiryPill({ days }: { days: number | null }) {
  if (days === null) return <span className="text-ink-subtle">-</span>;
  const tone: keyof typeof TONES =
    days < 0 ? 'danger' : days <= 30 ? 'danger' : days <= 90 ? 'warn' : days <= 180 ? 'info' : 'ok';
  return <Pill tone={tone}>{days < 0 ? `expired ${Math.abs(days)}d ago` : `${days} days`}</Pill>;
}

export function Severity({ level }: { level: string }) {
  const tone: keyof typeof TONES =
    level === 'CRITICAL' ? 'danger' : level === 'HIGH' ? 'warn' : level === 'MEDIUM' ? 'info' : 'neutral';
  return <Pill tone={tone}>{level}</Pill>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-ink-subtle">{children}</p>;
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 justify-center text-sm text-ink-muted">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      {label}...
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-danger/30 bg-danger-light px-3 py-2 text-sm text-danger">
      {message}
    </div>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px]">
        <thead className="bg-surface-sunken">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="th">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Stat({
  label,
  value,
  tone = 'neutral',
  sub,
  href,
}: {
  label: string;
  value: ReactNode;
  tone?: keyof typeof TONES;
  sub?: ReactNode;
  href?: string;
}) {
  const body = (
    <div className="card p-4 h-full transition-shadow hover:shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold num ${tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-ink'}`}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-ink-subtle">{sub}</div>}
    </div>
  );
  // §70: dashboard figures are entry points, not decoration.
  return href ? (
    <a href={href} className="block">
      {body}
    </a>
  ) : (
    body
  );
}

/** Horizontal bar chart — enough for trend and exposure without a chart library. */
export function BarChart({
  data,
  valueKey,
  labelKey,
  format = (v: number) => String(v),
}: {
  data: any[];
  valueKey: string;
  labelKey: string;
  format?: (v: number) => string;
}) {
  const max = Math.max(...data.map((d) => Number(d[valueKey]) || 0), 1);
  return (
    <div className="space-y-1.5">
      {data.map((d, i) => {
        const value = Number(d[valueKey]) || 0;
        return (
          <div key={i} className="flex items-center gap-3 text-xs">
            <span className="w-32 shrink-0 truncate text-ink-muted" title={String(d[labelKey])}>
              {d[labelKey]}
            </span>
            <span className="flex-1 h-4 rounded bg-surface-sunken overflow-hidden">
              <span
                className="block h-full rounded bg-brand/70"
                style={{ width: `${Math.max(2, (value / max) * 100)}%` }}
              />
            </span>
            <span className="w-24 shrink-0 text-right num text-ink">{format(value)}</span>
          </div>
        );
      })}
    </div>
  );
}
