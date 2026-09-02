"use client";

import Link from "next/link";
import { useApi } from "@/lib/useApi";
import { EmptyState, ErrorState, Loading } from "@/components/primitives";
import { StatusBadge, StatusTone } from "@/components/status";

interface TimelineEvent {
  at: string;
  kind: string;
  title: string;
  detail: string | null;
  actor: string | null;
  linkUrl: string | null;
  sourceType: string;
  sourceId: string | null;
}

/** Colour by what happened, so a recall reads differently from a receipt. */
const KIND_TONE: Record<string, StatusTone> = {
  CREATED: "info",
  RECEIVED: "available",
  DISPENSED: "info",
  SOLD: "info",
  TRANSFERRED: "transit",
  ADJUSTED: "near",
  COUNTED: "near",
  QUARANTINED: "quarantine",
  RECALLED: "recall",
  DISPOSED: "expired",
  PRICE_CHANGED: "near",
  DOCUMENT: "neutral",
  EDITED: "neutral",
  APPROVED: "approved",
};

/**
 * Everything that happened to one record (§44, §63).
 *
 * Assembled server-side from the ledger, the audit trail, price history and
 * documents — so it is a way into the evidence, not a summary written beside
 * it. Every entry that has a source links to it.
 */
export function Timeline({
  entityType,
  entityId,
  limit = 100,
}: {
  entityType: "PRODUCT" | "BATCH" | "PATIENT" | "SUPPLIER";
  entityId: string;
  limit?: number;
}) {
  const { data, error, loading, refresh } = useApi<{ events: TimelineEvent[] }>(
    entityId ? `/timeline/${entityType}/${entityId}?limit=${limit}` : null,
    [entityType, entityId],
  );

  if (loading) return <Loading label="Assembling history" />;
  if (error) return <ErrorState message={error} onRetry={refresh} />;
  if (!data) return null;
  if (!data.events.length) {
    return (
      <EmptyState
        title="Nothing has happened to this record yet"
        body="Receipts, movements, price changes and edits all appear here as they happen, each linking to the document behind it."
      />
    );
  }

  return (
    <ol className="relative space-y-3 border-l border-border pl-4">
      {data.events.map((event, i) => (
        <li
          key={`${event.sourceType}-${event.sourceId ?? i}-${event.at}`}
          className="relative"
        >
          <span
            className="absolute -left-[21px] top-2 h-2 w-2 rounded-pill bg-brand ring-4 ring-surface"
            aria-hidden
          />
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={KIND_TONE[event.kind] ?? "neutral"}>
              {event.kind.replace(/_/g, " ").toLowerCase()}
            </StatusBadge>
            <span className="text-body font-medium text-ink">
              {event.title}
            </span>
            <time
              className="num text-caption text-ink-subtle"
              dateTime={event.at}
            >
              {new Date(event.at).toLocaleString()}
            </time>
          </div>
          {event.detail && (
            <p className="mt-0.5 text-small text-ink-muted">{event.detail}</p>
          )}
          <div className="mt-0.5 flex flex-wrap items-center gap-3 text-caption text-ink-subtle">
            <span>
              {event.actor ? `by ${event.actor}` : "no actor recorded"}
            </span>
            <span>
              &middot; {event.sourceType.replace(/_/g, " ").toLowerCase()}
            </span>
            {event.linkUrl && (
              <Link className="text-brand-dark underline" href={event.linkUrl}>
                Open the record
              </Link>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Tabs for a 360 page. Keyboard-navigable and URL-free, so state stays local. */
export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string; count?: number }[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="mb-4 overflow-x-auto border-b border-border" role="tablist">
      <div className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const on = tab.key === active;
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={on}
              onClick={() => onChange(tab.key)}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-body transition-colors duration-state
                ${
                  on
                    ? "border-brand font-medium text-brand-dark"
                    : "border-transparent text-ink-muted hover:text-ink"
                }`}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className="ml-1.5 num text-caption text-ink-subtle">
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
