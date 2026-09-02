/** Expiry classification and redistribution scoring (§9, §10). */

export const DEFAULT_EXPIRY_BUCKETS = [30, 60, 90, 180, 365] as const;

export type ExpiryBucket =
  | 'EXPIRED'
  | 'DAYS_0_30'
  | 'DAYS_31_60'
  | 'DAYS_61_90'
  | 'DAYS_91_180'
  | 'DAYS_181_365'
  | 'OVER_365';

export const EXPIRY_BUCKET_LABELS: Record<ExpiryBucket, string> = {
  EXPIRED: 'Expired',
  DAYS_0_30: '0-30 days',
  DAYS_31_60: '31-60 days',
  DAYS_61_90: '61-90 days',
  DAYS_91_180: '91-180 days',
  DAYS_181_365: '181-365 days',
  OVER_365: 'More than 365 days',
};

/** One horizon in a configured bucket ladder, with the label to show for it. */
export interface ExpiryBucketDefinition {
  key: string;
  label: string;
  /** Inclusive upper bound in days; null for the final open-ended bucket. */
  upToDays: number | null;
}

/**
 * Turn a configured list of day horizons into an ordered ladder of buckets.
 *
 * The horizons are administrator-configured (`expiry.alertBuckets`), so the
 * ladder cannot be a fixed set of labels: a pharmacy that watches 7 and 14 days
 * must see 7- and 14-day buckets, and one that only cares about quarters must
 * not be shown empty weekly ones. Duplicates and non-positive values are
 * dropped rather than producing a bucket that can never match.
 */
export function expiryBuckets(
  horizons: readonly number[] = DEFAULT_EXPIRY_BUCKETS,
): ExpiryBucketDefinition[] {
  const sorted = [...new Set(horizons.filter((d) => Number.isFinite(d) && d > 0))].sort(
    (a, b) => a - b,
  );
  const ladder: ExpiryBucketDefinition[] = [
    { key: 'EXPIRED', label: 'Expired', upToDays: -1 },
  ];

  let lower = 0;
  for (const upper of sorted) {
    ladder.push({
      key: `DAYS_${lower}_${upper}`,
      label: `${lower}-${upper} days`,
      upToDays: upper,
    });
    lower = upper + 1;
  }
  ladder.push({
    key: sorted.length ? `OVER_${sorted[sorted.length - 1]}` : 'ALL',
    label: sorted.length ? `More than ${sorted[sorted.length - 1]} days` : 'All stock',
    upToDays: null,
  });

  return ladder;
}

/**
 * Which configured bucket a batch falls into.
 *
 * Returns the bucket definition rather than a bare key so a caller can render
 * the label without keeping its own copy of the ladder, which is how the two
 * would drift apart when an administrator changes the horizons.
 */
export function bucketFor(
  expiry: Date,
  ladder: ExpiryBucketDefinition[],
  now: Date = new Date(),
): ExpiryBucketDefinition {
  const days = daysUntil(expiry, now);
  if (days < 0) return ladder[0];
  for (const bucket of ladder.slice(1)) {
    if (bucket.upToDays === null || days <= bucket.upToDays) return bucket;
  }
  return ladder[ladder.length - 1];
}

export function daysUntil(expiry: Date, now: Date = new Date()): number {
  return Math.floor((expiry.getTime() - now.getTime()) / 86400000);
}

export function classifyExpiry(
  expiry: Date,
  now: Date = new Date(),
  buckets: readonly number[] = DEFAULT_EXPIRY_BUCKETS,
): ExpiryBucket {
  const days = daysUntil(expiry, now);
  if (days < 0) return 'EXPIRED';
  const [b30, b60, b90, b180, b365] = buckets;
  if (days <= b30) return 'DAYS_0_30';
  if (days <= b60) return 'DAYS_31_60';
  if (days <= b90) return 'DAYS_61_90';
  if (days <= b180) return 'DAYS_91_180';
  if (days <= b365) return 'DAYS_181_365';
  return 'OVER_365';
}

export function isExpired(expiry: Date, now: Date = new Date()): boolean {
  return expiry.getTime() < now.getTime();
}

/**
 * Expiry Risk Score for chain redistribution (§10). Higher = more urgent.
 *
 * Combines how much of the stock a branch can realistically consume before
 * expiry with how little shelf life remains. A branch holding 2,000 units that
 * burns 300/month with 60 days left can consume ~600 - the rest is at risk.
 */
export interface ExpiryRiskInput {
  quantityOnHand: number;
  daysToExpiry: number;
  avgMonthlyConsumption: number;
  transferLeadTimeDays?: number;
}

export interface ExpiryRiskResult {
  score: number; // 0-100
  consumableBeforeExpiry: number;
  surplusQuantity: number;
  riskLevel: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export function expiryRiskScore(input: ExpiryRiskInput): ExpiryRiskResult {
  const { quantityOnHand, daysToExpiry, avgMonthlyConsumption } = input;
  const leadTime = input.transferLeadTimeDays ?? 0;

  // Days actually usable at the receiving end if we moved it today.
  const usableDays = Math.max(0, daysToExpiry - leadTime);
  const dailyConsumption = avgMonthlyConsumption / 30;
  const consumableBeforeExpiry = dailyConsumption * usableDays;
  const surplusQuantity = Math.max(0, quantityOnHand - consumableBeforeExpiry);

  if (quantityOnHand <= 0) {
    return { score: 0, consumableBeforeExpiry, surplusQuantity: 0, riskLevel: 'NONE' };
  }

  const surplusRatio = surplusQuantity / quantityOnHand;
  // Urgency rises sharply as shelf life shrinks: 1.0 at expiry, ~0 beyond a year.
  const urgency = Math.max(0, Math.min(1, 1 - usableDays / 365));
  const score = Math.round(surplusRatio * urgency * 100);

  let riskLevel: ExpiryRiskResult['riskLevel'] = 'NONE';
  if (score >= 70) riskLevel = 'CRITICAL';
  else if (score >= 45) riskLevel = 'HIGH';
  else if (score >= 20) riskLevel = 'MEDIUM';
  else if (score > 0) riskLevel = 'LOW';

  return { score, consumableBeforeExpiry, surplusQuantity, riskLevel };
}
