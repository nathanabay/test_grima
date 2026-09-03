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

/**
 * Previous / Next for a list that reads one page at a time from the server.
 *
 * The hand-rolled lists — the ones that do not use `DataTable` — used to fetch
 * a fixed first page and stop, with nothing on screen to say the rest existed.
 * This is the smallest honest thing: which rows are showing, how many there
 * are, and a way to the next ones.
 */
export function Pager({
  page,
  pageSize,
  total,
  onPage,
  loading,
  noun = "row",
  plural,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  loading?: boolean;
  /** Singular noun for the count, e.g. "product". */
  noun?: string;
  /** Given when adding an "s" would be wrong, e.g. "entry" / "entries". */
  plural?: string;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  if (total === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-surface-border pt-2 text-small text-ink-muted">
      <span className="num">
        {first.toLocaleString()}&ndash;{last.toLocaleString()} of{" "}
        {total.toLocaleString()} {total === 1 ? noun : (plural ?? `${noun}s`)}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-ghost btn-sm"
          disabled={page <= 1 || loading}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
        <span className="num">
          {page} / {pageCount}
        </span>
        <button
          type="button"
          className="btn-ghost btn-sm"
          disabled={page >= pageCount || loading}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

/**
 * The line a search-as-you-type picker owes its reader when it caps.
 *
 * These pickers ask the server for the first fifteen or twenty matches. That
 * is the right shape for a dropdown, but only if the reader is told when their
 * search matched more than they can see — otherwise a batch that exists reads
 * as a batch that does not.
 */
export function MoreMatches({
  shown,
  total,
}: {
  shown: number;
  total: number | undefined;
}) {
  if (!total || total <= shown) return null;
  return (
    <div className="border-t border-surface-border px-2 py-1.5 text-xs text-ink-muted">
      Showing <span className="num">{shown}</span> of{" "}
      <span className="num">{total.toLocaleString()}</span> matches. Narrow the
      search to see the rest.
    </div>
  );
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
