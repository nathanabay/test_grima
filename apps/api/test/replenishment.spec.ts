import {
  calculateReplenishment,
  calculateSafetyStock,
  coefficientOfVariation,
  exponentialSmoothing,
  movingAverage,
  weightedMovingAverage,
} from '../../../packages/shared/src/replenishment';
import { classifyAbc, classifyXyz } from '../../../packages/shared/src/analytics';

describe('Replenishment (§12)', () => {
  it('scales safety stock with the square root of the lead time', () => {
    // Variance accumulates linearly over time, so stddev scales with sqrt(t).
    expect(calculateSafetyStock(10, 4, 1.65)).toBeCloseTo(33, 0);
    expect(calculateSafetyStock(10, 16, 1.65)).toBeCloseTo(66, 0);
  });

  it('recommends an order when the inventory position falls to the reorder point', () => {
    const result = calculateReplenishment({
      productId: 'p1',
      onHand: 100,
      reserved: 20,
      incomingConfirmed: 0,
      avgDailyConsumption: 20,
      demandStdDev: 6,
      leadTimeDays: 7,
      reorderLevel: 100,
      maximumStock: 5000,
    });

    expect(result.available).toBe(80);
    expect(result.shouldReorder).toBe(true);
    expect(result.suggestedQuantity).toBeGreaterThan(0);
    // The explanation must expose the arithmetic (§39).
    expect(result.explanation).toContain('Reorder point');
  });

  it('counts confirmed incoming stock so the same shortage is not ordered twice', () => {
    const base = {
      productId: 'p1',
      onHand: 50,
      reserved: 0,
      avgDailyConsumption: 10,
      demandStdDev: 2,
      leadTimeDays: 10,
      reorderLevel: 100,
      maximumStock: 5000,
    };

    const without = calculateReplenishment({ ...base, incomingConfirmed: 0 });
    const with500 = calculateReplenishment({ ...base, incomingConfirmed: 500 });

    expect(without.shouldReorder).toBe(true);
    expect(with500.shouldReorder).toBe(false);
    expect(with500.suggestedQuantity).toBe(0);
  });

  it('caps the suggestion at the maximum stock level', () => {
    const result = calculateReplenishment({
      productId: 'p1',
      onHand: 0,
      reserved: 0,
      incomingConfirmed: 0,
      avgDailyConsumption: 100,
      demandStdDev: 30,
      leadTimeDays: 30,
      reorderLevel: 500,
      maximumStock: 1000,
    });

    expect(result.cappedByMaximumStock).toBe(true);
    expect(result.suggestedQuantity).toBeLessThanOrEqual(1000);
  });
});

describe('Forecasting (§39)', () => {
  const history = [100, 120, 90, 130, 110, 140];

  it('computes a moving average over the trailing window', () => {
    expect(movingAverage(history, 3).forecast).toBeCloseTo(126.67, 1);
  });

  it('weights recent periods more heavily', () => {
    const wma = weightedMovingAverage(history, 3).forecast;
    const ma = movingAverage(history, 3).forecast;
    expect(wma).toBeGreaterThan(ma);
  });

  it('returns a confidence band around every forecast', () => {
    const result = exponentialSmoothing(history, 0.3);
    expect(result.confidenceLow).toBeLessThanOrEqual(result.forecast);
    expect(result.confidenceHigh).toBeGreaterThanOrEqual(result.forecast);
  });

  it('measures demand variability', () => {
    expect(coefficientOfVariation([100, 100, 100])).toBe(0);
    expect(coefficientOfVariation([10, 200, 5])).toBeGreaterThan(1);
  });
});

describe('ABC / XYZ classification (§37)', () => {
  it('puts the highest-value products in class A', () => {
    const result = classifyAbc([
      { productId: 'high', annualConsumptionValue: 800 },
      { productId: 'mid', annualConsumptionValue: 150 },
      { productId: 'low', annualConsumptionValue: 50 },
    ]);

    expect(result.find((r) => r.productId === 'high')!.abcClass).toBe('A');
    expect(result.find((r) => r.productId === 'low')!.abcClass).toBe('C');
  });

  it('classifies steady demand as X and erratic demand as Z', () => {
    expect(classifyXyz([100, 102, 98, 101]).xyzClass).toBe('X');
    expect(classifyXyz([5, 300, 2, 180]).xyzClass).toBe('Z');
  });
});
