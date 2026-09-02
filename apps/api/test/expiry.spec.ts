import {
  classifyExpiry,
  daysUntil,
  expiryRiskScore,
} from '../../../packages/shared/src/expiry';

const NOW = new Date('2026-06-01T00:00:00Z');
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000);

describe('Expiry classification (§9)', () => {
  it.each([
    [-1, 'EXPIRED'],
    [0, 'DAYS_0_30'],
    [30, 'DAYS_0_30'],
    [31, 'DAYS_31_60'],
    [60, 'DAYS_31_60'],
    [61, 'DAYS_61_90'],
    [90, 'DAYS_61_90'],
    [91, 'DAYS_91_180'],
    [180, 'DAYS_91_180'],
    [181, 'DAYS_181_365'],
    [365, 'DAYS_181_365'],
    [366, 'OVER_365'],
  ])('classifies %i days remaining as %s', (days, expected) => {
    expect(classifyExpiry(inDays(days), NOW)).toBe(expected);
  });

  it('counts remaining days', () => {
    expect(daysUntil(inDays(45), NOW)).toBe(45);
  });
});

describe('Expiry risk score for redistribution (§10)', () => {
  it('scores the specification example as high risk', () => {
    // 71% of the stock cannot be consumed in time, with ~2 months of life left:
    // score lands around 60, i.e. HIGH. CRITICAL is reserved for shorter-dated
    // surpluses where almost nothing can be moved in time.
    // Branch A: 2,000 units, 60 days left, consumes 300/month -> ~600 usable
    const result = expiryRiskScore({
      quantityOnHand: 2000,
      daysToExpiry: 60,
      avgMonthlyConsumption: 300,
      transferLeadTimeDays: 3,
    });

    expect(Math.round(result.consumableBeforeExpiry)).toBe(570);
    expect(Math.round(result.surplusQuantity)).toBe(1430);
    expect(result.score).toBeGreaterThan(45);
    expect(result.riskLevel).toBe('HIGH');
  });

  it('escalates to CRITICAL when the surplus is short-dated', () => {
    const result = expiryRiskScore({
      quantityOnHand: 2000,
      daysToExpiry: 20,
      avgMonthlyConsumption: 300,
      transferLeadTimeDays: 3,
    });

    expect(result.riskLevel).toBe('CRITICAL');
  });

  it('scores a branch that can consume its stock as no risk', () => {
    const result = expiryRiskScore({
      quantityOnHand: 500,
      daysToExpiry: 180,
      avgMonthlyConsumption: 1500,
    });

    expect(result.surplusQuantity).toBe(0);
    expect(result.riskLevel).toBe('NONE');
  });

  it('treats a product with no consumption as entirely surplus', () => {
    const result = expiryRiskScore({
      quantityOnHand: 100,
      daysToExpiry: 20,
      avgMonthlyConsumption: 0,
    });

    expect(result.surplusQuantity).toBe(100);
    expect(result.score).toBeGreaterThan(90);
  });
});
