/** ABC / XYZ classification and inventory KPIs (§37, §40). */

import { coefficientOfVariation } from './replenishment';

export type AbcClass = 'A' | 'B' | 'C';
export type XyzClass = 'X' | 'Y' | 'Z';

export interface AbcInput {
  productId: string;
  annualConsumptionValue: number;
}

export interface AbcResult extends AbcInput {
  abcClass: AbcClass;
  cumulativePct: number;
  sharePct: number;
}

/**
 * Pareto classification: A = top 80% of consumption value, B = next 15%,
 * C = final 5%. Thresholds are the conventional defaults and configurable.
 */
export function classifyAbc(
  items: AbcInput[],
  thresholds: { a: number; b: number } = { a: 0.8, b: 0.95 },
): AbcResult[] {
  const total = items.reduce((sum, i) => sum + i.annualConsumptionValue, 0);
  if (total <= 0) {
    return items.map((i) => ({ ...i, abcClass: 'C', cumulativePct: 0, sharePct: 0 }));
  }

  const sorted = [...items].sort(
    (a, b) => b.annualConsumptionValue - a.annualConsumptionValue,
  );

  let cumulative = 0;
  return sorted.map((item) => {
    cumulative += item.annualConsumptionValue;
    const cumulativePct = cumulative / total;
    const abcClass: AbcClass =
      cumulativePct <= thresholds.a ? 'A' : cumulativePct <= thresholds.b ? 'B' : 'C';
    return {
      ...item,
      abcClass,
      cumulativePct: Math.round(cumulativePct * 10000) / 100,
      sharePct: Math.round((item.annualConsumptionValue / total) * 10000) / 100,
    };
  });
}

/**
 * XYZ by demand predictability, using the coefficient of variation:
 * X = stable (CV <= 0.5), Y = variable (<= 1.0), Z = erratic.
 */
export function classifyXyz(
  history: number[],
  thresholds: { x: number; y: number } = { x: 0.5, y: 1.0 },
): { xyzClass: XyzClass; coefficientOfVariation: number } {
  const cv = coefficientOfVariation(history);
  const xyzClass: XyzClass = cv <= thresholds.x ? 'X' : cv <= thresholds.y ? 'Y' : 'Z';
  return { xyzClass, coefficientOfVariation: Math.round(cv * 1000) / 1000 };
}

export type CombinedClass = `${AbcClass}${XyzClass}`;

/** Planning guidance for each of the nine combined classes (§37). */
export const COMBINED_CLASS_GUIDANCE: Record<CombinedClass, string> = {
  AX: 'High value, predictable. Tight continuous review, low safety stock, frequent small orders.',
  AY: 'High value, variable. Continuous review with a larger safety buffer.',
  AZ: 'High value, erratic. Order against confirmed demand; avoid speculative stock.',
  BX: 'Medium value, predictable. Periodic review with automated reorder points.',
  BY: 'Medium value, variable. Periodic review, moderate safety stock.',
  BZ: 'Medium value, erratic. Review manually before each order.',
  CX: 'Low value, predictable. Bulk order infrequently to cut ordering cost.',
  CY: 'Low value, variable. Bulk order with a generous buffer.',
  CZ: 'Low value, erratic. Candidate for delisting or order-on-demand only.',
};

// ---------------------------------------------------------------
// Inventory KPIs (§40)
// ---------------------------------------------------------------

export function stockTurnover(cogs: number, averageInventoryValue: number): number {
  if (averageInventoryValue <= 0) return 0;
  return Math.round((cogs / averageInventoryValue) * 100) / 100;
}

export function daysInventoryOutstanding(turnover: number, periodDays = 365): number {
  if (turnover <= 0) return 0;
  return Math.round((periodDays / turnover) * 10) / 10;
}

export function inventoryAccuracy(matchedLines: number, totalLines: number): number {
  if (totalLines <= 0) return 100;
  return Math.round((matchedLines / totalLines) * 10000) / 100;
}

export function stockOutRate(stockOutDays: number, totalDays: number): number {
  if (totalDays <= 0) return 0;
  return Math.round((stockOutDays / totalDays) * 10000) / 100;
}

export function fillRate(linesFullyServed: number, totalLines: number): number {
  if (totalLines <= 0) return 100;
  return Math.round((linesFullyServed / totalLines) * 10000) / 100;
}

export function expiryRate(expiredValue: number, totalPurchasedValue: number): number {
  if (totalPurchasedValue <= 0) return 0;
  return Math.round((expiredValue / totalPurchasedValue) * 10000) / 100;
}

export function grossMargin(revenue: number, cogs: number): number {
  if (revenue <= 0) return 0;
  return Math.round(((revenue - cogs) / revenue) * 10000) / 100;
}

export function shrinkage(adjustmentLossValue: number, averageInventoryValue: number): number {
  if (averageInventoryValue <= 0) return 0;
  return Math.round((adjustmentLossValue / averageInventoryValue) * 10000) / 100;
}
