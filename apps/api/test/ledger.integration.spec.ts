/**
 * Integration tests against a real PostgreSQL database (§68).
 *
 * These exercise the guarantees that cannot be proven with unit tests: row
 * locking under concurrency, the append-only ledger, and the stock-status rules
 * that block expired and recalled medicine from leaving the shelf.
 */

import { BatchStatus, Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AuditService } from '../src/common/audit/audit.service';
import { LedgerService } from '../src/modules/inventory/ledger.service';
import { CacheService } from '../src/common/cache/cache.service';
import { FefoService } from '../src/modules/inventory/fefo.service';

const prisma = new PrismaService();
const audit = new AuditService(prisma);
const ledger = new LedgerService(prisma, audit, new CacheService());
const fefo = new FefoService(prisma);

// Fixture ids, so the tests never touch seeded demo data.
const FIXTURE = {
  orgId: '',
  branchId: '',
  warehouseId: '',
  productId: '',
  batchId: '',
};

async function resetStock(quantity: number, status: BatchStatus = BatchStatus.RELEASED) {
  await prisma.inventoryTransaction.deleteMany({ where: { productId: FIXTURE.productId } });
  await prisma.inventoryBalance.deleteMany({ where: { productId: FIXTURE.productId } });
  await prisma.batch.update({ where: { id: FIXTURE.batchId }, data: { status } });
  await prisma.inventoryBalance.create({
    data: {
      productId: FIXTURE.productId,
      batchId: FIXTURE.batchId,
      warehouseId: FIXTURE.warehouseId,
      branchId: FIXTURE.branchId,
      onHand: new Prisma.Decimal(quantity),
    },
  });
}

beforeAll(async () => {
  await prisma.$connect();

  const org =
    (await prisma.organization.findFirst()) ??
    (await prisma.organization.create({ data: { name: 'Test Org' } }));
  FIXTURE.orgId = org.id;

  const branch = await prisma.branch.create({
    data: { organizationId: org.id, code: `TEST-${Date.now()}`, name: 'Ledger Test Branch' },
  });
  FIXTURE.branchId = branch.id;

  const warehouse = await prisma.warehouse.create({
    data: { branchId: branch.id, code: `TEST-WH-${Date.now()}`, name: 'Ledger Test Warehouse' },
  });
  FIXTURE.warehouseId = warehouse.id;

  const product = await prisma.product.create({
    data: {
      sku: `TEST-SKU-${Date.now()}`,
      genericName: 'Test Amoxicillin',
      activeIngredient: 'Amoxicillin trihydrate',
      strength: '500 mg',
      dosageForm: 'Capsule',
      baseUnit: 'CAPSULE',
      purchaseCost: new Prisma.Decimal(2),
      averageCost: new Prisma.Decimal(2),
      retailPrice: new Prisma.Decimal(4),
    },
  });
  FIXTURE.productId = product.id;

  const batch = await prisma.batch.create({
    data: {
      batchNumber: `TEST-BATCH-${Date.now()}`,
      productId: product.id,
      expiryDate: new Date(Date.now() + 365 * 86_400_000),
      receivedQuantity: new Prisma.Decimal(1000),
      purchaseCost: new Prisma.Decimal(2),
      status: BatchStatus.RELEASED,
    },
  });
  FIXTURE.batchId = batch.id;
});

afterAll(async () => {
  await prisma.inventoryTransaction.deleteMany({ where: { productId: FIXTURE.productId } });
  await prisma.inventoryBalance.deleteMany({ where: { productId: FIXTURE.productId } });
  await prisma.stockReservation.deleteMany({ where: { productId: FIXTURE.productId } });
  await prisma.batch.deleteMany({ where: { productId: FIXTURE.productId } });
  await prisma.product.delete({ where: { id: FIXTURE.productId } });
  await prisma.warehouse.delete({ where: { id: FIXTURE.warehouseId } });
  await prisma.branch.delete({ where: { id: FIXTURE.branchId } });
  await prisma.$disconnect();
});

function dispenseMovement(quantity: number, key?: string) {
  return {
    type: TransactionType.DISPENSING,
    direction: 'OUT' as const,
    productId: FIXTURE.productId,
    batchId: FIXTURE.batchId,
    warehouseId: FIXTURE.warehouseId,
    branchId: FIXTURE.branchId,
    quantity,
    idempotencyKey: key,
  };
}

describe('Stock ledger (§19)', () => {
  it('records every movement and keeps a running balance', async () => {
    await resetStock(100);

    await prisma.$transaction((tx) => ledger.post(tx, dispenseMovement(30)));
    await prisma.$transaction((tx) => ledger.post(tx, dispenseMovement(20)));

    const rows = await prisma.inventoryTransaction.findMany({
      where: { productId: FIXTURE.productId },
      orderBy: { occurredAt: 'asc' },
    });

    expect(rows).toHaveLength(2);
    expect(Number(rows[0].balanceAfter)).toBe(70);
    expect(Number(rows[1].balanceAfter)).toBe(50);

    const balance = await prisma.inventoryBalance.findFirst({
      where: { batchId: FIXTURE.batchId },
    });
    expect(Number(balance!.onHand)).toBe(50);
  });

  it('can reconstruct any balance by replaying the ledger', async () => {
    await resetStock(100);
    await prisma.$transaction((tx) => ledger.post(tx, dispenseMovement(40)));

    // Replay ignores the cached balance entirely.
    const replayed = await ledger.reconstructBalance(
      FIXTURE.productId,
      FIXTURE.warehouseId,
      FIXTURE.batchId,
    );
    expect(Number(replayed)).toBe(-40); // only the outbound movement is in the ledger

    const integrity = await ledger.verifyIntegrity(FIXTURE.warehouseId);
    // The opening balance was inserted directly by the fixture rather than
    // through the ledger, so this position is reported as drifted - which is
    // exactly what the integrity check is for.
    expect(integrity.mismatches.length).toBeGreaterThan(0);
  });

  it('refuses to drive a balance negative', async () => {
    await resetStock(10);

    await expect(
      prisma.$transaction((tx) => ledger.post(tx, dispenseMovement(11))),
    ).rejects.toThrow(/Insufficient stock/);

    const balance = await prisma.inventoryBalance.findFirst({
      where: { batchId: FIXTURE.batchId },
    });
    expect(Number(balance!.onHand)).toBe(10);
  });

  it('treats a replayed idempotency key as the same movement, not a second one', async () => {
    await resetStock(100);
    const key = `test-idem-${Date.now()}`;

    const first = await prisma.$transaction((tx) => ledger.post(tx, dispenseMovement(25, key)));
    const second = await prisma.$transaction((tx) => ledger.post(tx, dispenseMovement(25, key)));

    expect(second.transactionId).toBe(first.transactionId);

    const balance = await prisma.inventoryBalance.findFirst({
      where: { batchId: FIXTURE.batchId },
    });
    expect(Number(balance!.onHand)).toBe(75);
  });
});

describe('Concurrency protection (§48, §68)', () => {
  it('lets only one of two pharmacists dispense the last 10 units', async () => {
    await resetStock(10);

    // Both transactions start before either commits.
    const results = await Promise.allSettled([
      prisma.$transaction((tx) => ledger.post(tx, dispenseMovement(10)), { timeout: 15_000 }),
      prisma.$transaction((tx) => ledger.post(tx, dispenseMovement(10)), { timeout: 15_000 }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/Insufficient stock/);

    const balance = await prisma.inventoryBalance.findFirst({
      where: { batchId: FIXTURE.batchId },
    });
    expect(Number(balance!.onHand)).toBe(0);

    // Exactly one ledger row, so the stock was never double-committed.
    const rows = await prisma.inventoryTransaction.count({
      where: { productId: FIXTURE.productId },
    });
    expect(rows).toBe(1);
  });

  it('serializes many concurrent small dispenses without overselling', async () => {
    await resetStock(50);

    const attempts = Array.from({ length: 20 }, () =>
      prisma.$transaction((tx) => ledger.post(tx, dispenseMovement(5)), { timeout: 20_000 }),
    );
    const results = await Promise.allSettled(attempts);

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    // 50 units at 5 per dispense = exactly 10 can succeed.
    expect(succeeded).toBe(10);

    const balance = await prisma.inventoryBalance.findFirst({
      where: { batchId: FIXTURE.batchId },
    });
    expect(Number(balance!.onHand)).toBe(0);
  });

  it('does not let a reservation be double-spent', async () => {
    await resetStock(100);

    await prisma.$transaction((tx) =>
      ledger.reserve(tx, {
        productId: FIXTURE.productId,
        batchId: FIXTURE.batchId,
        warehouseId: FIXTURE.warehouseId,
        quantity: 80,
        referenceType: 'TEST',
        referenceId: FIXTURE.batchId,
      }),
    );

    // 100 on hand, 80 reserved -> only 20 may actually move.
    await expect(
      prisma.$transaction((tx) => ledger.post(tx, dispenseMovement(30))),
    ).rejects.toThrow(/reserved/);

    await expect(
      prisma.$transaction((tx) => ledger.post(tx, dispenseMovement(20))),
    ).resolves.toBeDefined();

    await prisma.$transaction((tx) =>
      ledger.releaseReservations(tx, 'TEST', FIXTURE.batchId),
    );

    const balance = await prisma.inventoryBalance.findFirst({
      where: { batchId: FIXTURE.batchId },
    });
    expect(Number(balance!.reserved)).toBe(0);
  });
});

describe('Stock status enforcement (§8, §27, §73)', () => {
  it.each([
    [BatchStatus.RECALLED, /RECALLED/],
    [BatchStatus.QUARANTINED, /QUARANTINED/],
    [BatchStatus.BLOCKED, /BLOCKED/],
    [BatchStatus.DAMAGED, /DAMAGED/],
  ])('blocks dispensing from a %s batch', async (status, pattern) => {
    await resetStock(100, status);

    await expect(
      prisma.$transaction((tx) => ledger.post(tx, dispenseMovement(1))),
    ).rejects.toThrow(pattern);
  });

  it('blocks dispensing an expired batch even when the status still says released', async () => {
    await resetStock(100);
    await prisma.batch.update({
      where: { id: FIXTURE.batchId },
      data: { expiryDate: new Date(Date.now() - 86_400_000) },
    });

    await expect(
      prisma.$transaction((tx) => ledger.post(tx, dispenseMovement(1))),
    ).rejects.toThrow(/expired/);

    // Restore for later tests.
    await prisma.batch.update({
      where: { id: FIXTURE.batchId },
      data: { expiryDate: new Date(Date.now() + 365 * 86_400_000) },
    });
  });

  it('still allows a recall movement to shift blocked stock', async () => {
    await resetStock(100, BatchStatus.RECALLED);

    await expect(
      prisma.$transaction((tx) =>
        ledger.post(tx, {
          ...dispenseMovement(100),
          type: TransactionType.RECALL,
          allowBlockedStatus: true,
        }),
      ),
    ).resolves.toBeDefined();
  });

  it('excludes non-allocatable batches from FEFO candidates', async () => {
    await resetStock(100, BatchStatus.RECALLED);

    const result = await fefo.allocate({
      productId: FIXTURE.productId,
      warehouseId: FIXTURE.warehouseId,
      quantity: 1,
    });

    expect(result.fullyAllocated).toBe(false);
    expect(result.excluded[0].reason).toContain('RECALLED');
  });
});

describe('Audit trail (§42)', () => {
  it('chains hashes so a rewritten row can be detected', async () => {
    await audit.record({
      module: 'test',
      action: 'CREATE',
      entityType: 'Test',
      entityId: FIXTURE.productId,
      newValue: { check: 1 },
    });

    const before = await audit.verifyChain();
    expect(before.valid).toBe(true);

    // Tamper with the most recent row, as an attacker with database access would.
    const latest = await prisma.auditLog.findFirst({ orderBy: { sequence: 'desc' } });
    await prisma.auditLog.update({
      where: { id: latest!.id },
      data: { action: 'DELETE' },
    });

    const after = await audit.verifyChain();
    expect(after.valid).toBe(false);
    expect(after.brokenAtSequence).toBe(latest!.sequence);

    // Put it back so the chain verifies for later runs.
    await prisma.auditLog.update({
      where: { id: latest!.id },
      data: { action: latest!.action },
    });
    expect((await audit.verifyChain()).valid).toBe(true);
  });

  it('verifies a payload carrying Decimals, Dates and nested objects', async () => {
    // A Prisma Decimal is an object in memory and a string in jsonb. Hashing
    // the in-memory shape produced a chain that could never verify, on rows
    // nobody had touched -- which would make a real tamper indistinguishable
    // from a false alarm.
    await audit.record({
      module: 'test',
      action: 'EDIT',
      entityType: 'Test',
      entityId: FIXTURE.productId,
      previousValue: { unitPrice: new Prisma.Decimal('12.3400'), qty: new Prisma.Decimal(5) },
      newValue: {
        unitPrice: new Prisma.Decimal('99.9999'),
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        nested: { deep: { value: new Prisma.Decimal('0.15') } },
        list: [new Prisma.Decimal(1), new Prisma.Decimal(2)],
      },
    });

    const result = await audit.verifyChain();
    expect(result.valid).toBe(true);
  });

  it('verifies a payload whose keys were written out of order', async () => {
    await audit.record({
      module: 'test',
      action: 'EDIT',
      entityType: 'Test',
      entityId: FIXTURE.productId,
      newValue: { zebra: 1, alpha: 2, middle: { yankee: 3, bravo: 4 } },
    });

    expect((await audit.verifyChain()).valid).toBe(true);
  });
});
