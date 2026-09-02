"use client";

import { ReactNode } from "react";

/**
 * The one place a pharmaceutical status becomes a colour (§27).
 *
 * Every screen reads from this map, so AVAILABLE looks the same on the batch
 * list, the product page, a report and the command centre. A status that is not
 * in the map renders neutral with its own text rather than being silently
 * dropped or mis-coloured as something it is not.
 *
 * Colour is never the only carrier: each badge shows the word as well, because
 * a colour-blind pharmacist has to read the same meaning.
 */
export type StatusTone =
  | "available"
  | "low"
  | "out"
  | "near"
  | "expired"
  | "quarantine"
  | "recall"
  | "blocked"
  | "cold"
  | "controlled"
  | "transit"
  | "pending"
  | "approved"
  | "rejected"
  | "info"
  | "neutral";

const TONE_CLASS: Record<StatusTone, string> = {
  available: "bg-st-available/10 text-st-available ring-st-available/25",
  low: "bg-st-low/10 text-st-low ring-st-low/25",
  out: "bg-st-out/10 text-st-out ring-st-out/30",
  near: "bg-st-near/10 text-st-near ring-st-near/25",
  expired: "bg-st-expired/12 text-st-expired ring-st-expired/35",
  quarantine: "bg-st-quarantine/10 text-st-quarantine ring-st-quarantine/30",
  recall: "bg-st-recall/12 text-st-recall ring-st-recall/40",
  blocked: "bg-st-blocked/10 text-st-blocked ring-st-blocked/25",
  cold: "bg-st-cold/10 text-st-cold ring-st-cold/25",
  controlled: "bg-st-controlled/10 text-st-controlled ring-st-controlled/30",
  transit: "bg-st-transit/10 text-st-transit ring-st-transit/25",
  pending: "bg-st-pending/10 text-st-pending ring-st-pending/25",
  approved: "bg-st-available/10 text-st-available ring-st-available/25",
  rejected: "bg-st-out/10 text-st-out ring-st-out/30",
  info: "bg-info/10 text-info ring-info/25",
  neutral: "bg-ink-subtle/10 text-ink-muted ring-ink-subtle/25",
};

/**
 * Status string → tone. Keys are the values the API actually returns, so a
 * screen passes the raw status through without translating it first.
 */
const STATUS_TONE: Record<string, StatusTone> = {
  // Stock and batch
  AVAILABLE: "available",
  RELEASED: "available",
  IN_STOCK: "available",
  LOW_STOCK: "low",
  LOW: "low",
  OUT_OF_STOCK: "out",
  OUT: "out",
  NEAR_EXPIRY: "near",
  EXPIRING: "near",
  EXPIRED: "expired",
  QUARANTINED: "quarantine",
  QUARANTINE: "quarantine",
  UNDER_REVIEW: "quarantine",
  RECALLED: "recall",
  RECALL: "recall",
  BLOCKED: "blocked",
  DAMAGED: "blocked",
  DESTROYED: "blocked",
  RETURNED: "blocked",
  DISPOSED: "blocked",
  INACTIVE: "blocked",
  // Movement
  IN_TRANSIT: "transit",
  DISPATCHED: "transit",
  SHIPPED: "transit",
  PARTIALLY_RECEIVED: "transit",
  PICKING: "transit",
  PACKED: "transit",
  // Decisions
  DRAFT: "pending",
  SUBMITTED: "pending",
  PENDING: "pending",
  PROCUREMENT_REVIEW: "pending",
  FINANCE_REVIEW: "pending",
  NEW: "pending",
  APPROVED: "approved",
  COMPLETED: "approved",
  RECEIVED: "approved",
  CLOSED: "approved",
  POSTED: "approved",
  DISPENSED: "approved",
  DELIVERED: "approved",
  VERIFIED: "approved",
  ACTIVE: "approved",
  REJECTED: "rejected",
  CANCELLED: "blocked",
  FAILED: "rejected",
  REVERSED: "rejected",
  VOID: "rejected",
  // Regulatory
  CONTROLLED: "controlled",
  COLD_CHAIN: "cold",
  // Severity, shared by incidents, recalls and excursions
  CRITICAL: "out",
  HIGH: "expired",
  MEDIUM: "near",
  LOW_SEVERITY: "info",
  CLASS_I: "recall",
  CLASS_II: "expired",
  CLASS_III: "near",
};

export function toneFor(status: string | null | undefined): StatusTone {
  if (!status) return "neutral";
  return STATUS_TONE[status.toUpperCase().replace(/[\s-]/g, "_")] ?? "neutral";
}

/** Human wording for a machine status, without shouting in SCREAMING_CASE. */
export function statusLabel(status: string): string {
  return status
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
}

export function StatusBadge({
  status,
  tone,
  children,
  title,
}: {
  status?: string | null;
  /** Override when the caller knows the meaning better than the string does. */
  tone?: StatusTone;
  children?: ReactNode;
  title?: string;
}) {
  const t = tone ?? toneFor(status);
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-caption
                  uppercase ring-1 ring-inset ${TONE_CLASS[t]}`}
    >
      {children ?? (status ? statusLabel(status) : "—")}
    </span>
  );
}

/**
 * Severity for operational lists, where the point is triage order rather than
 * the state of a record.
 */
export function SeverityBadge({ level }: { level: string }) {
  const up = level.toUpperCase();
  const tone: StatusTone =
    up === "CRITICAL"
      ? "out"
      : up === "HIGH"
        ? "expired"
        : up === "MEDIUM"
          ? "near"
          : "info";
  return <StatusBadge tone={tone}>{statusLabel(up)}</StatusBadge>;
}

/**
 * Days-to-expiry as a badge. Past expiry reads differently from close to it,
 * because the two demand different actions.
 */
export function ExpiryBadge({ days }: { days: number | null | undefined }) {
  if (days === null || days === undefined)
    return <span className="text-ink-subtle">—</span>;
  if (days < 0) {
    return (
      <StatusBadge tone="expired">Expired {Math.abs(days)}d ago</StatusBadge>
    );
  }
  const tone: StatusTone =
    days <= 30 ? "near" : days <= 90 ? "low" : "available";
  return <StatusBadge tone={tone}>{days}d left</StatusBadge>;
}

/** A quantity that carries meaning: zero and negative must not read as normal. */
export function QuantityCell({
  value,
  unit,
}: {
  value: unknown;
  unit?: string;
}) {
  const n = Number(value ?? 0);
  const tone = n < 0 ? "text-danger" : n === 0 ? "text-ink-subtle" : "text-ink";
  return (
    <span className={`num ${tone}`}>
      {n.toLocaleString(undefined, { maximumFractionDigits: 4 })}
      {unit && <span className="ml-1 text-ink-subtle">{unit}</span>}
    </span>
  );
}
