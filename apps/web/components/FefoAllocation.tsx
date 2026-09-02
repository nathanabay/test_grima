"use client";

import { useCallback, useEffect, useState } from "react";
import { api, qty, shortDate } from "@/lib/api";
import { Card, EmptyState, ErrorState, Loading } from "@/components/primitives";
import { StatusBadge, ExpiryBadge, QuantityCell } from "@/components/status";

/**
 * FEFO allocation, shown rather than assumed (§32).
 *
 * Whoever is about to move stock sees which batches the engine chose, in what
 * order, and — just as important — which ones it refused and why. A batch that
 * is excluded because it is recalled reads very differently from one excluded
 * because it is empty, and both matter to the person deciding whether to
 * override.
 *
 * This is a dry run. It reserves nothing and moves nothing.
 */

interface Allocation {
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
  warehouseId: string;
  locationId?: string | null;
  unitCost: number;
}

interface FefoResult {
  allocations: Allocation[];
  allocatedQuantity: number;
  shortfall: number;
  fullyAllocated: boolean;
  excluded: { batchId: string; batchNumber: string; reason: string }[];
}

function daysTo(date: string) {
  return Math.floor((new Date(date).getTime() - Date.now()) / 86400000);
}

/** Why a batch was refused, as a tone — a recall is not the same as an empty bin. */
function exclusionTone(reason: string) {
  const r = reason.toLowerCase();
  if (r.includes("recall")) return "recall" as const;
  if (r.includes("expired")) return "expired" as const;
  if (r.includes("quarantin")) return "quarantine" as const;
  if (r.includes("status")) return "blocked" as const;
  if (r.includes("shelf life")) return "near" as const;
  return "neutral" as const;
}

export function FefoAllocation({
  productId,
  warehouseId,
  quantity,
  minRemainingDays,
  onChoose,
  chosenBatchId,
}: {
  productId: string | null;
  warehouseId: string | null;
  quantity: number;
  minRemainingDays?: number;
  /** Offered when the screen allows a manual override. */
  onChoose?: (batchId: string) => void;
  chosenBatchId?: string | null;
}) {
  const [result, setResult] = useState<FefoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    if (!productId || !warehouseId || quantity <= 0) {
      setResult(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setResult(
        await api<FefoResult>("/inventory/fefo/allocate", {
          method: "POST",
          body: { productId, warehouseId, quantity, minRemainingDays },
        }),
      );
    } catch (e: any) {
      setError(e.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [productId, warehouseId, quantity, minRemainingDays]);

  useEffect(() => {
    void run();
  }, [run]);

  if (!productId || !warehouseId) return null;
  if (loading) return <Loading label="Choosing batches" />;
  if (error) return <ErrorState message={error} onRetry={run} />;
  if (!result) return null;

  const recommended = result.allocations[0];

  return (
    <Card
      title="What FEFO would take"
      description="First expiry, first out. This is a dry run — nothing is reserved or moved."
    >
      {!result.fullyAllocated && (
        <div className="mb-3 rounded border border-warn/30 bg-warn-light px-3 py-2 text-small text-warn">
          Only{" "}
          <span className="num font-medium">
            {qty(result.allocatedQuantity)}
          </span>{" "}
          of <span className="num font-medium">{qty(quantity)}</span> can be
          allocated from stock that may be picked. The shortfall is{" "}
          <span className="num font-medium">{qty(result.shortfall)}</span>.
        </div>
      )}

      {result.allocations.length === 0 ? (
        <EmptyState
          title="No batch may be picked"
          body="Every batch of this product in this warehouse is excluded. The reasons are listed below."
        />
      ) : (
        <ul className="space-y-1.5">
          {result.allocations.map((a, i) => {
            const days = daysTo(a.expiryDate);
            const isRecommended = i === 0;
            const isChosen = chosenBatchId === a.batchId;
            return (
              <li
                key={a.batchId}
                className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded border px-3 py-2
                  ${
                    isChosen
                      ? "border-brand bg-brand/10"
                      : isRecommended
                        ? "border-ok/40 bg-ok/[0.06]"
                        : "border-border bg-surface"
                  }`}
              >
                <StatusBadge tone={isRecommended ? "available" : "info"}>
                  {isRecommended ? "Recommended" : `Alternative ${i}`}
                </StatusBadge>
                <span className="num font-medium text-ink">
                  {a.batchNumber}
                </span>
                <span className="num text-small text-ink-muted">
                  {shortDate(a.expiryDate)}
                </span>
                <ExpiryBadge days={days} />
                <span className="ml-auto flex items-center gap-3">
                  <QuantityCell value={a.quantity} />
                  {onChoose && (
                    <button
                      type="button"
                      className={
                        isChosen ? "btn-primary btn-sm" : "btn-ghost btn-sm"
                      }
                      onClick={() => onChoose(a.batchId)}
                    >
                      {isChosen ? "Chosen" : "Use this"}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {result.excluded.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="label">Refused, and why</p>
          <ul className="space-y-1">
            {result.excluded.map((e) => (
              <li
                key={e.batchId}
                className="flex flex-wrap items-center gap-2 text-small"
              >
                <StatusBadge tone={exclusionTone(e.reason)}>
                  Blocked
                </StatusBadge>
                <span className="num text-ink">{e.batchNumber}</span>
                <span className="text-ink-muted">{e.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {onChoose && recommended && (
        <p className="mt-3 text-caption text-ink-subtle">
          Taking anything other than the recommendation needs the override
          permission and a written reason. The batch FEFO chose is stored beside
          the one taken, so the decision stays visible.
        </p>
      )}
    </Card>
  );
}
