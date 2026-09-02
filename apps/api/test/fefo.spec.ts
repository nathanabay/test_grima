import {
  allocateFefo,
  recommendBatch,
  sortFefo,
  FefoCandidate,
} from '../../../packages/shared/src/fefo';

const NOW = new Date('2026-06-01T00:00:00Z');

function candidate(overrides: Partial<FefoCandidate> & { batchId: string; expiryDate: Date }): FefoCandidate {
  return {
    batchNumber: overrides.batchId,
    status: 'AVAILABLE',
    availableQuantity: 100,
    warehouseId: 'WH1',
    unitCost: 4,
    ...overrides,
  } as FefoCandidate;
}

describe('FEFO allocation engine (§8)', () => {
  it('orders batches by nearest expiry, not by receipt order', () => {
    // The worked example from the specification: A=2027-05, B=2026-11, C=2028-01
    const batches = [
      candidate({ batchId: 'A', expiryDate: new Date('2027-05-31') }),
      candidate({ batchId: 'B', expiryDate: new Date('2026-11-30') }),
      candidate({ batchId: 'C', expiryDate: new Date('2028-01-31') }),
    ];

    expect(sortFefo(batches).map((b) => b.batchId)).toEqual(['B', 'A', 'C']);
    expect(recommendBatch(batches, { now: NOW })?.batchId).toBe('B');
  });

  it('draws from multiple batches in expiry order when one cannot cover the demand', () => {
    const result = allocateFefo(
      250,
      [
        candidate({ batchId: 'A', expiryDate: new Date('2027-05-31'), availableQuantity: 100 }),
        candidate({ batchId: 'B', expiryDate: new Date('2026-11-30'), availableQuantity: 100 }),
        candidate({ batchId: 'C', expiryDate: new Date('2028-01-31'), availableQuantity: 100 }),
      ],
      { now: NOW },
    );

    expect(result.fullyAllocated).toBe(true);
    expect(result.allocations.map((a) => [a.batchId, a.quantity])).toEqual([
      ['B', 100],
      ['A', 100],
      ['C', 50],
    ]);
  });

  it('never allocates expired stock', () => {
    const result = allocateFefo(
      10,
      [
        candidate({ batchId: 'EXPIRED', expiryDate: new Date('2026-05-01'), availableQuantity: 500 }),
        candidate({ batchId: 'GOOD', expiryDate: new Date('2027-01-01') }),
      ],
      { now: NOW },
    );

    expect(result.allocations.map((a) => a.batchId)).toEqual(['GOOD']);
    expect(result.excluded[0]).toMatchObject({ batchId: 'EXPIRED' });
    expect(result.excluded[0].reason).toContain('expired');
  });

  it.each(['QUARANTINED', 'BLOCKED', 'DAMAGED', 'RECALLED', 'DESTROYED', 'RETURNED'] as const)(
    'never allocates %s stock',
    (status) => {
      const result = allocateFefo(
        10,
        [
          candidate({ batchId: 'BAD', expiryDate: new Date('2027-01-01'), status }),
          candidate({ batchId: 'GOOD', expiryDate: new Date('2028-01-01') }),
        ],
        { now: NOW },
      );

      expect(result.allocations.map((a) => a.batchId)).toEqual(['GOOD']);
      expect(result.excluded).toHaveLength(1);
      expect(result.excluded[0].reason).toContain(status);
    },
  );

  it('reports a shortfall rather than over-allocating', () => {
    const result = allocateFefo(
      500,
      [candidate({ batchId: 'A', expiryDate: new Date('2027-01-01'), availableQuantity: 120 })],
      { now: NOW },
    );

    expect(result.fullyAllocated).toBe(false);
    expect(result.allocatedQuantity).toBe(120);
    expect(result.shortfall).toBe(380);
  });

  it('excludes batches whose remaining shelf life is below the minimum required', () => {
    const result = allocateFefo(
      10,
      [
        candidate({ batchId: 'SHORT', expiryDate: new Date('2026-06-20') }), // 19 days
        candidate({ batchId: 'LONG', expiryDate: new Date('2027-06-01') }),
      ],
      { now: NOW, minRemainingDays: 90 },
    );

    expect(result.allocations.map((a) => a.batchId)).toEqual(['LONG']);
    expect(result.excluded[0].reason).toContain('shelf life');
  });

  it('ignores stock that is entirely reserved for other documents', () => {
    const result = allocateFefo(
      10,
      [
        candidate({ batchId: 'RESERVED', expiryDate: new Date('2026-07-01'), availableQuantity: 0 }),
        candidate({ batchId: 'FREE', expiryDate: new Date('2027-01-01') }),
      ],
      { now: NOW },
    );

    expect(result.allocations.map((a) => a.batchId)).toEqual(['FREE']);
    expect(result.excluded[0].reason).toContain('reserved');
  });

  it('empties partially-drawn batches first when expiry dates tie', () => {
    const sameDay = new Date('2027-01-01');
    const result = allocateFefo(
      50,
      [
        candidate({ batchId: 'FULL', expiryDate: sameDay, availableQuantity: 100 }),
        candidate({ batchId: 'PARTIAL', expiryDate: sameDay, availableQuantity: 30 }),
      ],
      { now: NOW },
    );

    expect(result.allocations.map((a) => a.batchId)).toEqual(['PARTIAL', 'FULL']);
  });

  it('rejects a non-positive request rather than silently returning nothing', () => {
    expect(() => allocateFefo(0, [], { now: NOW })).toThrow('greater than zero');
  });

  it('returns no recommendation when nothing is allocatable', () => {
    expect(
      recommendBatch(
        [candidate({ batchId: 'X', expiryDate: new Date('2026-01-01') })],
        { now: NOW },
      ),
    ).toBeNull();
  });
});
