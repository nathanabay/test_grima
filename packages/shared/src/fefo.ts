/**
 * FEFO allocation engine (§8) - First Expiry, First Out.
 *
 * Pure and side-effect free so it can be exhaustively unit tested and reused by
 * the API, the POS screen and the transfer planner. The caller supplies
 * candidate batches; this module decides which ones may be used and in what
 * order, and never mutates anything.
 */

export type AllocatableBatchStatus =
  | 'AVAILABLE'
  | 'QUARANTINED'
  | 'RELEASED'
  | 'BLOCKED'
  | 'DAMAGED'
  | 'EXPIRED'
  | 'RECALLED'
  | 'RETURNED'
  | 'DESTROYED';

/** Only these two statuses represent stock that may leave the shelf (§7, §8). */
export const ALLOCATABLE_STATUSES: AllocatableBatchStatus[] = ['AVAILABLE', 'RELEASED'];

export interface FefoCandidate {
  batchId: string;
  batchNumber: string;
  expiryDate: Date;
  status: AllocatableBatchStatus;
  /** On-hand minus already-reserved, in base units. */
  availableQuantity: number;
  warehouseId: string;
  locationId?: string | null;
  unitCost?: number;
  /**
   * When the batch was received. Used only to break a tie between batches that
   * expire on the same day; it never overrides expiry order.
   */
  receivedDate?: Date;
}

export interface FefoAllocationLine {
  batchId: string;
  batchNumber: string;
  expiryDate: Date;
  quantity: number;
  warehouseId: string;
  locationId?: string | null;
  unitCost: number;
}

export interface FefoResult {
  /** Batches to draw from, nearest valid expiry first. */
  allocations: FefoAllocationLine[];
  allocatedQuantity: number;
  /** Requested minus allocated. Greater than zero means insufficient stock. */
  shortfall: number;
  fullyAllocated: boolean;
  /** Batches excluded from consideration, with the reason (audit + UI). */
  excluded: Array<{ batchId: string; batchNumber: string; reason: string }>;
}

/**
 * How to order batches that FEFO cannot separate.
 *
 * FEFO decides the order by expiry, and nothing here can change that. This
 * decides only what happens when two batches expire on the same day, which is
 * common for one production run received in several deliveries.
 *
 *  - FIFO  the batch received first goes first, so stock does not sit and age
 *          behind newer stock of the same expiry. This is what a pharmacy
 *          usually means by "first expiry, first out, then oldest first".
 *  - LIFO  the most recently received goes first. Chosen by operations that
 *          keep a deliberate aged reserve.
 *
 * A batch with no received date cannot be placed in the queue by age either
 * way, so it falls back to the smaller remaining quantity, which empties
 * part-used positions and frees the bin.
 */
export type FefoTieBreak = 'FIFO' | 'LIFO';

export interface FefoOptions {
  now?: Date;
  /** Tie-break for equal expiry dates. Defaults to FIFO. */
  tieBreak?: FefoTieBreak;
  /**
   * Refuse batches whose remaining shelf life is below this. Used when
   * dispensing a course of treatment that must outlive the pack.
   */
  minRemainingDays?: number;
  /** Restrict to a single warehouse. */
  warehouseId?: string;
}

function exclusionReason(
  candidate: FefoCandidate,
  now: Date,
  minRemainingDays: number | undefined,
): string | null {
  if (!ALLOCATABLE_STATUSES.includes(candidate.status)) {
    return `Batch status is ${candidate.status} and cannot be allocated`;
  }
  if (candidate.expiryDate.getTime() < now.getTime()) {
    return `Batch expired on ${candidate.expiryDate.toISOString().slice(0, 10)}`;
  }
  if (minRemainingDays !== undefined) {
    const remaining = Math.floor(
      (candidate.expiryDate.getTime() - now.getTime()) / 86400000,
    );
    if (remaining < minRemainingDays) {
      return `Only ${remaining} days of shelf life remain (minimum ${minRemainingDays})`;
    }
  }
  if (candidate.availableQuantity <= 0) {
    return 'No available quantity (all on-hand stock is reserved or zero)';
  }
  return null;
}

/**
 * Order candidates by nearest valid expiry, breaking ties as configured.
 */
export function sortFefo(
  candidates: FefoCandidate[],
  tieBreak: FefoTieBreak = 'FIFO',
): FefoCandidate[] {
  return [...candidates].sort((a, b) => {
    // Expiry always wins. The tie-break only decides between batches that
    // expire on the very same day, so no setting can put a longer-dated pack
    // in front of a shorter-dated one.
    const byExpiry = a.expiryDate.getTime() - b.expiryDate.getTime();
    if (byExpiry !== 0) return byExpiry;

    const aReceived = a.receivedDate?.getTime();
    const bReceived = b.receivedDate?.getTime();
    if (aReceived !== undefined && bReceived !== undefined && aReceived !== bReceived) {
      return tieBreak === 'LIFO' ? bReceived - aReceived : aReceived - bReceived;
    }
    // A batch with no received date cannot be placed in the queue by age, so it
    // sorts after one that can rather than being guessed at.
    if (aReceived !== undefined && bReceived === undefined) return -1;
    if (aReceived === undefined && bReceived !== undefined) return 1;

    return a.availableQuantity - b.availableQuantity;
  });
}

export function allocateFefo(
  requestedQuantity: number,
  candidates: FefoCandidate[],
  options: FefoOptions = {},
): FefoResult {
  const now = options.now ?? new Date();
  const excluded: FefoResult['excluded'] = [];

  if (requestedQuantity <= 0) {
    throw new Error('Requested quantity must be greater than zero');
  }

  const eligible: FefoCandidate[] = [];
  for (const candidate of candidates) {
    if (options.warehouseId && candidate.warehouseId !== options.warehouseId) continue;
    const reason = exclusionReason(candidate, now, options.minRemainingDays);
    if (reason) {
      excluded.push({
        batchId: candidate.batchId,
        batchNumber: candidate.batchNumber,
        reason,
      });
    } else {
      eligible.push(candidate);
    }
  }

  const allocations: FefoAllocationLine[] = [];
  let remaining = requestedQuantity;

  for (const candidate of sortFefo(eligible, options.tieBreak ?? 'FIFO')) {
    if (remaining <= 0) break;
    const take = Math.min(candidate.availableQuantity, remaining);
    if (take <= 0) continue;
    allocations.push({
      batchId: candidate.batchId,
      batchNumber: candidate.batchNumber,
      expiryDate: candidate.expiryDate,
      quantity: take,
      warehouseId: candidate.warehouseId,
      locationId: candidate.locationId ?? null,
      unitCost: candidate.unitCost ?? 0,
    });
    remaining -= take;
  }

  const allocatedQuantity = requestedQuantity - remaining;
  return {
    allocations,
    allocatedQuantity,
    shortfall: remaining,
    fullyAllocated: remaining <= 0,
    excluded,
  };
}

/** The single batch FEFO recommends, used to detect manual overrides (§8). */
export function recommendBatch(
  candidates: FefoCandidate[],
  options: FefoOptions = {},
): FefoCandidate | null {
  const now = options.now ?? new Date();
  const eligible = candidates.filter((c) => {
    if (options.warehouseId && c.warehouseId !== options.warehouseId) return false;
    return exclusionReason(c, now, options.minRemainingDays) === null;
  });
  return sortFefo(eligible, options.tieBreak ?? 'FIFO')[0] ?? null;
}
