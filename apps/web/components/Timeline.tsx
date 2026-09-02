'use client';

import Link from 'next/link';
import { useApi } from '@/lib/useApi';
import { Empty, ErrorBox, Loading, Pill } from '@/components/ui';

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
const KIND_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'info' | 'brand' | 'neutral'> = {
  CREATED: 'brand',
  RECEIVED: 'ok',
  DISPENSED: 'info',
  SOLD: 'info',
  TRANSFERRED: 'info',
  ADJUSTED: 'warn',
  COUNTED: 'warn',
  QUARANTINED: 'warn',
  RECALLED: 'danger',
  DISPOSED: 'danger',
  PRICE_CHANGED: 'warn',
  DOCUMENT: 'neutral',
  EDITED: 'neutral',
  APPROVED: 'ok',
};

/**
 * Everything that happened to one record (§63).
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
  entityType: 'PRODUCT' | 'BATCH' | 'PATIENT' | 'SUPPLIER';
  entityId: string;
  limit?: number;
}) {
  const { data, error, loading } = useApi<{ events: TimelineEvent[] }>(
    entityId ? `/timeline/${entityType}/${entityId}?limit=${limit}` : null,
    [entityType, entityId],
  );

  if (loading) return <Loading label="Assembling history" />;
  if (error) return <ErrorBox message={error} />;
  if (!data) return null;
  if (!data.events.length) {
    return <Empty>Nothing has happened to this record yet.</Empty>;
  }

  return (
    <ol className="relative space-y-3 border-l border-surface-border pl-4">
      {data.events.map((event, i) => (
        <li key={`${event.sourceType}-${event.sourceId ?? i}-${event.at}`} className="relative">
          <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand" aria-hidden />
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={KIND_TONE[event.kind] ?? 'neutral'}>{event.kind.replace(/_/g, ' ').toLowerCase()}</Pill>
            <span className="text-sm font-medium text-ink">{event.title}</span>
            <time className="text-xs text-ink-subtle" dateTime={event.at}>
              {new Date(event.at).toLocaleString()}
            </time>
          </div>
          {event.detail && <p className="mt-0.5 text-xs text-ink-muted">{event.detail}</p>}
          <div className="mt-0.5 flex flex-wrap items-center gap-3 text-[11px] text-ink-subtle">
            <span>{event.actor ? `by ${event.actor}` : 'no actor recorded'}</span>
            <span>&middot; {event.sourceType.replace(/_/g, ' ').toLowerCase()}</span>
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
