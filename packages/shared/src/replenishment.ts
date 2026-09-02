/**
 * Replenishment and forecasting (§12, §39).
 *
 * Every recommendation returns its own inputs so the UI can show exactly why a
 * number was suggested - §39 forbids hiding the logic behind a recommendation.
 */

export interface ReplenishmentInput {
  productId: string;
  onHand: number;
  reserved: number;
  incomingConfirmed: number; // approved POs not yet received
  avgDailyConsumption: number;
  demandStdDev: number;
  leadTimeDays: number;
  safetyStock?: number; // explicit override from product master
  reorderLevel: number;
  maximumStock: number;
  serviceLevelZ?: number; // 1.65 = 95%
  seasonalFactor?: number; // 1.0 = no seasonality
}

export interface ReplenishmentResult {
  productId: string;
  available: number;
  inventoryPosition: number;
  forecastDemandDuringLeadTime: number;
  safetyStock: number;
  reorderPoint: number;
  shouldReorder: boolean;
  suggestedQuantity: number;
  cappedByMaximumStock: boolean;
  explanation: string;
}

/**
 * Safety stock covering demand variability across the lead time.
 * Variance accumulates linearly over time, so the standard deviation scales
 * with the square root of the lead time.
 */
export function calculateSafetyStock(
  demandStdDev: number,
  leadTimeDays: number,
  serviceLevelZ = 1.65,
): number {
  return serviceLevelZ * demandStdDev * Math.sqrt(Math.max(0, leadTimeDays));
}

export function calculateReplenishment(input: ReplenishmentInput): ReplenishmentResult {
  const seasonal = input.seasonalFactor ?? 1;
  const available = input.onHand - input.reserved;
  const inventoryPosition = available + input.incomingConfirmed;

  const forecastDemandDuringLeadTime =
    input.avgDailyConsumption * input.leadTimeDays * seasonal;

  const safetyStock =
    input.safetyStock ??
    calculateSafetyStock(input.demandStdDev, input.leadTimeDays, input.serviceLevelZ);

  // Reorder point from demand, but never below the manually configured floor.
  const reorderPoint = Math.max(
    forecastDemandDuringLeadTime + safetyStock,
    input.reorderLevel,
  );

  const shouldReorder = inventoryPosition <= reorderPoint;

  // §12: forecast demand during lead time + safety stock - available - incoming
  let suggestedQuantity = Math.max(
    0,
    Math.ceil(forecastDemandDuringLeadTime + safetyStock - inventoryPosition),
  );

  let cappedByMaximumStock = false;
  if (input.maximumStock > 0 && inventoryPosition + suggestedQuantity > input.maximumStock) {
    suggestedQuantity = Math.max(0, Math.floor(input.maximumStock - inventoryPosition));
    cappedByMaximumStock = true;
  }

  const explanation = [
    `Available ${available.toFixed(0)} (on hand ${input.onHand.toFixed(0)} - reserved ${input.reserved.toFixed(0)})`,
    `+ incoming ${input.incomingConfirmed.toFixed(0)} = position ${inventoryPosition.toFixed(0)}`,
    `Forecast demand over ${input.leadTimeDays}d lead time: ${forecastDemandDuringLeadTime.toFixed(0)}`,
    `Safety stock: ${safetyStock.toFixed(0)}`,
    `Reorder point: ${reorderPoint.toFixed(0)}`,
    shouldReorder
      ? `Position is at or below the reorder point, so ${suggestedQuantity} units are suggested${cappedByMaximumStock ? ' (capped by maximum stock)' : ''}.`
      : 'Position is above the reorder point; no order suggested.',
  ].join('. ');

  return {
    productId: input.productId,
    available,
    inventoryPosition,
    forecastDemandDuringLeadTime,
    safetyStock,
    reorderPoint,
    shouldReorder,
    suggestedQuantity: shouldReorder ? suggestedQuantity : 0,
    cappedByMaximumStock,
    explanation,
  };
}

// ---------------------------------------------------------------
// Forecasting (§39)
// ---------------------------------------------------------------

export interface ForecastPoint {
  periodStart: Date;
  quantity: number;
}

export interface ForecastResult {
  method: 'MOVING_AVERAGE' | 'WEIGHTED_MOVING_AVERAGE' | 'EXPONENTIAL_SMOOTHING' | 'SEASONAL_NAIVE';
  forecast: number;
  /** Plus/minus band at roughly one standard deviation of historical error. */
  confidenceLow: number;
  confidenceHigh: number;
  basedOnPeriods: number;
  history: number[];
}

export function movingAverage(history: number[], window = 3): ForecastResult {
  const slice = history.slice(-window);
  const forecast = slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
  return withConfidence('MOVING_AVERAGE', forecast, slice, history);
}

export function weightedMovingAverage(history: number[], window = 3): ForecastResult {
  const slice = history.slice(-window);
  // Most recent period carries the greatest weight.
  const weights = slice.map((_, i) => i + 1);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const forecast = weightSum
    ? slice.reduce((sum, value, i) => sum + value * weights[i], 0) / weightSum
    : 0;
  return withConfidence('WEIGHTED_MOVING_AVERAGE', forecast, slice, history);
}

export function exponentialSmoothing(history: number[], alpha = 0.3): ForecastResult {
  if (!history.length) return withConfidence('EXPONENTIAL_SMOOTHING', 0, [], history);
  let level = history[0];
  for (let i = 1; i < history.length; i++) {
    level = alpha * history[i] + (1 - alpha) * level;
  }
  return withConfidence('EXPONENTIAL_SMOOTHING', level, history, history);
}

/** Same period last year, for products with annual seasonality. */
export function seasonalNaive(history: number[], seasonLength = 12): ForecastResult {
  const forecast =
    history.length >= seasonLength ? history[history.length - seasonLength] : movingAverage(history).forecast;
  return withConfidence('SEASONAL_NAIVE', forecast, history.slice(-seasonLength), history);
}

function withConfidence(
  method: ForecastResult['method'],
  forecast: number,
  slice: number[],
  history: number[],
): ForecastResult {
  const mean = slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
  const variance = slice.length
    ? slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / slice.length
    : 0;
  const stdDev = Math.sqrt(variance);
  return {
    method,
    forecast: Math.max(0, Math.round(forecast * 100) / 100),
    confidenceLow: Math.max(0, Math.round((forecast - stdDev) * 100) / 100),
    confidenceHigh: Math.round((forecast + stdDev) * 100) / 100,
    basedOnPeriods: slice.length,
    history,
  };
}

/** Coefficient of variation, the input to XYZ classification. */
export function coefficientOfVariation(history: number[]): number {
  if (history.length < 2) return 0;
  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  if (mean === 0) return 0;
  const variance =
    history.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (history.length - 1);
  return Math.sqrt(variance) / mean;
}
