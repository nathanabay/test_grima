"use client";

import { ReactNode } from "react";
import {
  Card as BaseCard,
  EmptyState,
  ErrorState,
  Loading as BaseLoading,
  Skeleton,
  Stat as BaseStat,
} from "./primitives";
import {
  StatusBadge,
  SeverityBadge,
  ExpiryBadge,
  StatusTone,
  toneFor,
} from "./status";

/**
 * Compatibility surface for the pages written before the design system existed.
 *
 * Each of these now delegates to the shared primitives and the one status map,
 * so every screen picked up the new tokens, dark mode, density and consistent
 * status colours without forty separate rewrites. New screens should import
 * from `primitives` and `status` directly — this file exists so the old ones
 * are not left behind on a palette nothing else uses.
 */

export { Skeleton };

/** Old tone names mapped onto the semantic ones. */
const LEGACY_TONE: Record<string, StatusTone> = {
  neutral: "neutral",
  ok: "available",
  warn: "near",
  danger: "out",
  info: "info",
  brand: "info",
};

export function Card(props: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return <BaseCard {...props} />;
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: keyof typeof LEGACY_TONE;
}) {
  return (
    <StatusBadge tone={LEGACY_TONE[tone] ?? "neutral"}>{children}</StatusBadge>
  );
}

/** Batch status → colour, from the single product-wide map. */
export function BatchStatus({ status }: { status: string }) {
  return <StatusBadge status={status} />;
}

export function ExpiryPill({ days }: { days: number | null }) {
  return <ExpiryBadge days={days} />;
}

export function Severity({ level }: { level: string }) {
  return <SeverityBadge level={level} />;
}

export function Empty({ children }: { children: ReactNode }) {
  // An older call site passes one sentence; it becomes the title so the empty
  // state still reads as a deliberate message rather than "no data".
  return (
    <EmptyState
      title={typeof children === "string" ? children : "Nothing to show"}
      body={typeof children === "string" ? undefined : children}
    />
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return <BaseLoading label={label} />;
}

export function ErrorBox({ message }: { message: string }) {
  return <ErrorState message={message} />;
}

export function Table({
  head,
  children,
}: {
  head: ReactNode[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] table-hover">
        <thead>
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

export function Stat(props: {
  label: string;
  value: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "danger" | "info" | "brand";
  sub?: ReactNode;
  href?: string;
}) {
  const { tone, ...rest } = props;
  const mapped = tone === "brand" ? "info" : tone;
  return <BaseStat {...rest} tone={mapped as any} />;
}

/**
 * Horizontal bar chart — enough for trend and exposure without a chart library,
 * and it reads correctly in both themes because the bar is a token.
 */
export function BarChart({
  data,
  valueKey,
  labelKey,
  format = (v: number) => String(v),
  tone = "brand",
}: {
  data: any[];
  valueKey: string;
  labelKey: string;
  format?: (v: number) => string;
  tone?: "brand" | "warn" | "danger";
}) {
  const max = Math.max(...data.map((d) => Number(d[valueKey]) || 0), 1);
  const bar =
    tone === "danger"
      ? "bg-danger/70"
      : tone === "warn"
        ? "bg-warn/70"
        : "bg-brand/70";
  return (
    <div className="space-y-1.5">
      {data.map((d, i) => {
        const value = Number(d[valueKey]) || 0;
        return (
          <div key={i} className="flex items-center gap-3 text-small">
            <span
              className="w-32 shrink-0 truncate text-ink-muted"
              title={String(d[labelKey])}
            >
              {d[labelKey]}
            </span>
            <span className="h-4 flex-1 overflow-hidden rounded bg-surface-sunken">
              <span
                className={`block h-full rounded ${bar}`}
                style={{ width: `${Math.max(2, (value / max) * 100)}%` }}
              />
            </span>
            <span className="w-24 shrink-0 text-right num text-ink">
              {format(value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export { toneFor };
