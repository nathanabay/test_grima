/**
 * Accounting against a real database (§32).
 *
 * The guarantees worth proving are that journals balance, that a posted entry
 * can only be corrected by reversal, that posting is idempotent, and that FIFO
 * and weighted average genuinely value the same movement differently — which is
 * the whole reason valuation is configurable separately from FEFO.
 */

import { Prisma, ValuationMethod } from '@prisma/client';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AuditService } from '../src/common/audit/audit.service';
import { ConfigService } from '../src/common/config/config.service';
import { JournalService } from '../src/modules/accounting/journal.service';
import { ValuationService } from '../src/modules/accounting/valuation.service';
import { DEFAULT_ACCOUNTS } from '../src/modules/accounting/chart-of-accounts';

const prisma = new PrismaService();
const audit = new AuditService(prisma);
const config = new ConfigService(prisma);
const journal = new JournalService(prisma, audit);
const valuation = new ValuationService(prisma);

const PREFIX = 'ACCTEST';
const FIXTURE = {
  productId: '',
  warehouseId: '',
  branchId: '',
  cashId: '',
  revenueId: '',
  userId: '',
};

beforeAll(async () => {
  await prisma.$connect();

  const warehouse = await prisma.warehouse.findFirstOrThrow({ include: { branch: true } });
  FIXTURE.warehouseId = warehouse.id;
  FIXTURE.branchId = warehouse.branchId;

  const user = await prisma.user.findFirstOrThrow();
  FIXTURE.userId = user.id;

  // The chart of accounts must exist for anything to post.
  for (const account of DEFAULT_ACCOUNTS) {
    await prisma.account.upsert({
      where: { code: account.code },
      create: { ...account, isSystem: Boolean(account.systemKey) },
      update: {},
    });
  }

  FIXTURE.cashId = (await prisma.account.findFirstOrThrow({ where: { systemKey: 'CASH' } })).id;
  FIXTURE.revenueId = (
    await prisma.account.findFirstOrThrow({ where: { systemKey: 'SALES_REVENUE' } })
  ).id;

  const product = await prisma.product.create({
    data: {
      sku: `${PREFIX}-SKU`,
      genericName: 'Accounting fixture',
      activeIngredient: 'Fixture',
      strength: '1 mg',
      dosageForm: 'Tablet',
      averageCost: new Prisma.Decimal(0),
    },
  });
  FIXTURE.productId = product.id;
});

afterAll(async () => {
  await prisma.costConsumption.deleteMany({ where: { productId: FIXTURE.productId } });
  await prisma.costLayer.deleteMany({ where: { productId: FIXTURE.productId } });
  await prisma.journalLine.deleteMany({ where: { entry: { sourceType: `${PREFIX}_SOURCE` } } });
  await prisma.journalEntry.deleteMany({ where: { sourceType: { startsWith: PREFIX } } });
  await prisma.product.deleteMany({ where: { sku: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

afterEach(async () => {
  await prisma.costConsumption.deleteMany({ where: { productId: FIXTURE.productId } });
  await prisma.costLayer.deleteMany({ where: { productId: FIXTURE.productId } });
});

describe('Double entry (§32)', () => {
  const source = () => `${PREFIX}_SOURCE`;

  it('posts a balanced entry', async () => {
    const entry = await journal.postStandalone(
      {
        description: 'Balanced test entry',
        sourceType: source(),
        sourceId: crypto.randomUUID(),
        branchId: FIXTURE.branchId,
        lines: [
          { accountId: FIXTURE.cashId, debit: 100 },
          { accountId: FIXTURE.revenueId, credit: 100 },
        ],
      },
      { id: FIXTURE.userId },
    );

    expect(entry.lines).toHaveLength(2);
    expect(entry.totalDebit.toString()).toBe('100');
    expect(entry.totalCredit.toString()).toBe('100');
    expect(entry.status).toBe('POSTED');
  });

  it('refuses an entry that does not balance', async () => {
    await expect(
      journal.postStandalone({
        description: 'Unbalanced',
        sourceType: source(),
        sourceId: crypto.randomUUID(),
        lines: [
          { accountId: FIXTURE.cashId, debit: 100 },
          { accountId: FIXTURE.revenueId, credit: 90 },
        ],
      }),
    ).rejects.toThrow(/does not balance/);
  });

  it('refuses a line that is both a debit and a credit', async () => {
    await expect(
      journal.postStandalone({
        description: 'Both sides',
        sourceType: source(),
        sourceId: crypto.randomUUID(),
        lines: [
          { accountId: FIXTURE.cashId, debit: 100, credit: 100 },
          { accountId: FIXTURE.revenueId, credit: 100 },
        ],
      }),
    ).rejects.toThrow(/either a debit or a credit/);
  });

  it('refuses a negative amount rather than flipping it silently', async () => {
    await expect(
      journal.postStandalone({
        description: 'Negative',
        sourceType: source(),
        sourceId: crypto.randomUUID(),
        lines: [
          { accountId: FIXTURE.cashId, debit: -100 },
          { accountId: FIXTURE.revenueId, credit: -100 },
        ],
      }),
    ).rejects.toThrow(/negative/);
  });

  it('refuses a one-sided entry', async () => {
    await expect(
      journal.postStandalone({
        description: 'One line',
        sourceType: source(),
        sourceId: crypto.randomUUID(),
        lines: [{ accountId: FIXTURE.cashId, debit: 100 }],
      }),
    ).rejects.toThrow(/at least two lines/);
  });

  it('refuses an entry for zero', async () => {
    await expect(
      journal.postStandalone({
        description: 'Zero',
        sourceType: source(),
        sourceId: crypto.randomUUID(),
        lines: [
          { accountId: FIXTURE.cashId, debit: 0 },
          { accountId: FIXTURE.revenueId, credit: 0 },
        ],
      }),
    ).rejects.toThrow(/at least two lines|cannot be for zero/);
  });

  it('will not post twice for the same source document', async () => {
    const sourceId = crypto.randomUUID();
    const input = {
      description: 'Idempotency check',
      sourceType: source(),
      sourceId,
      lines: [
        { accountId: FIXTURE.cashId, debit: 50 },
        { accountId: FIXTURE.revenueId, credit: 50 },
      ],
    };

    await journal.postStandalone(input);
    // The unique constraint on (sourceType, sourceId) is what makes a replayed
    // posting run safe.
    await expect(journal.postStandalone(input)).rejects.toThrow();
  });

  it('refuses a line naming neither an account nor a system key', async () => {
    // A malformed line must come back as a client error with a usable message.
    // Left unchecked, `where: { systemKey: undefined }` reaches Prisma and the
    // caller gets a 500 that says nothing about what was wrong.
    await expect(
      journal.postStandalone({
        description: 'Line with no account',
        sourceType: source(),
        sourceId: crypto.randomUUID(),
        lines: [
          { debit: 100 },
          { accountId: FIXTURE.revenueId, credit: 100 },
        ],
      }),
    ).rejects.toThrow(/must name an account/);
  });

  it('resolves an account by its stable system key', async () => {
    const entry = await journal.postStandalone({
      description: 'By system key',
      sourceType: source(),
      sourceId: crypto.randomUUID(),
      lines: [
        { systemKey: 'CASH', debit: 25 },
        { systemKey: 'SALES_REVENUE', credit: 25 },
      ],
    });
    expect(entry.lines.map((l) => l.accountId).sort()).toEqual(
      [FIXTURE.cashId, FIXTURE.revenueId].sort(),
    );
  });

  it('reports a missing account mapping instead of posting to nowhere', async () => {
    await expect(
      journal.postStandalone({
        description: 'Missing key',
        sourceType: source(),
        sourceId: crypto.randomUUID(),
        lines: [
          { systemKey: 'NO_SUCH_KEY', debit: 10 },
          { systemKey: 'CASH', credit: 10 },
        ],
      }),
    ).rejects.toThrow(/No account is mapped/);
  });
});

describe('Reversal (§53: correct, never delete)', () => {
  it('mirrors the original and marks it reversed', async () => {
    const original = await journal.postStandalone({
      description: 'To be reversed',
      sourceType: `${PREFIX}_SOURCE`,
      sourceId: crypto.randomUUID(),
      lines: [
        { accountId: FIXTURE.cashId, debit: 250 },
        { accountId: FIXTURE.revenueId, credit: 250 },
      ],
    });

    const reversal = await journal.reverse(original.id, 'Posted to the wrong branch', {
      id: FIXTURE.userId,
    } as never);

    expect(reversal.totalDebit.toString()).toBe(original.totalCredit.toString());
    expect(reversal.reversalOfId).toBe(original.id);

    const cashLine = reversal.lines.find((l) => l.accountId === FIXTURE.cashId)!;
    // The mirror image: what was a debit is now a credit.
    expect(cashLine.credit.toString()).toBe('250');
    expect(cashLine.debit.toString()).toBe('0');

    const after = await prisma.journalEntry.findUniqueOrThrow({ where: { id: original.id } });
    expect(after.status).toBe('REVERSED');
    // The original is still there, unedited.
    expect(after.totalDebit.toString()).toBe('250');
  });

  it('refuses to reverse the same entry twice', async () => {
    const entry = await journal.postStandalone({
      description: 'Double reversal',
      sourceType: `${PREFIX}_SOURCE`,
      sourceId: crypto.randomUUID(),
      lines: [
        { accountId: FIXTURE.cashId, debit: 10 },
        { accountId: FIXTURE.revenueId, credit: 10 },
      ],
    });

    await journal.reverse(entry.id, 'First', { id: FIXTURE.userId } as never);
    await expect(
      journal.reverse(entry.id, 'Second', { id: FIXTURE.userId } as never),
    ).rejects.toThrow(/already been reversed/);
  });

  it('requires a reason', async () => {
    const entry = await journal.postStandalone({
      description: 'No reason',
      sourceType: `${PREFIX}_SOURCE`,
      sourceId: crypto.randomUUID(),
      lines: [
        { accountId: FIXTURE.cashId, debit: 10 },
        { accountId: FIXTURE.revenueId, credit: 10 },
      ],
    });
    await expect(journal.reverse(entry.id, '  ', { id: FIXTURE.userId } as never)).rejects.toThrow(
      /reason/,
    );
  });
});

describe('Valuation (§32: FEFO picks the pack, valuation prices it)', () => {
  async function receive(quantity: number, unitCost: number, daysAgo: number) {
    await prisma.$transaction((tx) =>
      valuation.recordReceipt(tx, {
        productId: FIXTURE.productId,
        warehouseId: FIXTURE.warehouseId,
        quantity,
        unitCost,
        receivedAt: new Date(Date.now() - daysAgo * 86_400_000),
      }),
    );
  }

  it('consumes FIFO layers oldest first', async () => {
    await receive(100, 10, 30);
    await receive(100, 20, 20);

    const result = await prisma.$transaction((tx) =>
      valuation.costIssue(
        tx,
        {
          productId: FIXTURE.productId,
          warehouseId: FIXTURE.warehouseId,
          quantity: 150,
          transactionId: crypto.randomUUID(),
        },
        ValuationMethod.FIFO,
      ),
    );

    // 100 at 10 plus 50 at 20 = 2000.
    expect(result.totalCost).toBe('2000');
    expect(result.layers).toHaveLength(2);
    expect(result.layers[0].unitCost).toBe('10');
    expect(result.layers[1].quantity).toBe('50');
    expect(result.explanation.length).toBeGreaterThan(0);
  });

  it('leaves the untouched part of a partly consumed layer', async () => {
    await receive(100, 10, 30);
    await receive(100, 20, 20);

    await prisma.$transaction((tx) =>
      valuation.costIssue(
        tx,
        {
          productId: FIXTURE.productId,
          warehouseId: FIXTURE.warehouseId,
          quantity: 150,
          transactionId: crypto.randomUUID(),
        },
        ValuationMethod.FIFO,
      ),
    );

    const layers = await prisma.costLayer.findMany({
      where: { productId: FIXTURE.productId },
      orderBy: { receivedAt: 'asc' },
    });
    expect(layers[0].remainingQuantity.toString()).toBe('0');
    expect(layers[1].remainingQuantity.toString()).toBe('50');
  });

  it('values the same issue differently under weighted average', async () => {
    await receive(100, 10, 30);
    await receive(100, 20, 20);

    // The receipts set the running average to 15 across 200 units.
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: FIXTURE.productId },
      select: { averageCost: true },
    });

    const result = await prisma.$transaction((tx) =>
      valuation.costIssue(
        tx,
        {
          productId: FIXTURE.productId,
          warehouseId: FIXTURE.warehouseId,
          quantity: 150,
          transactionId: crypto.randomUUID(),
        },
        ValuationMethod.WEIGHTED_AVERAGE,
      ),
    );

    expect(result.method).toBe(ValuationMethod.WEIGHTED_AVERAGE);
    // 150 at the running average, which is not the 2000 FIFO would have given.
    const expected = new Prisma.Decimal(150).times(product.averageCost).toString();
    expect(result.totalCost).toBe(expected);
    expect(result.totalCost).not.toBe('2000');
  });

  it('falls back to the running average when layers run out, and says so', async () => {
    await receive(50, 10, 30);

    const result = await prisma.$transaction((tx) =>
      valuation.costIssue(
        tx,
        {
          productId: FIXTURE.productId,
          warehouseId: FIXTURE.warehouseId,
          quantity: 80,
          transactionId: crypto.randomUUID(),
        },
        ValuationMethod.FIFO,
      ),
    );

    expect(result.shortfall).toBe('30');
    // A zero-cost remainder would overstate margin without anyone noticing.
    expect(Number(result.totalCost)).toBeGreaterThan(500);
    expect(result.explanation.join(' ')).toMatch(/no remaining cost layer/);
  });

  it('records which layers an issue consumed, so COGS can be explained', async () => {
    await receive(100, 10, 30);
    const transactionId = crypto.randomUUID();

    await prisma.$transaction((tx) =>
      valuation.costIssue(
        tx,
        {
          productId: FIXTURE.productId,
          warehouseId: FIXTURE.warehouseId,
          quantity: 40,
          transactionId,
        },
        ValuationMethod.FIFO,
      ),
    );

    const consumption = await valuation.consumptionFor(transactionId);
    expect(consumption).toHaveLength(1);
    expect(consumption[0].quantity.toString()).toBe('40');
    expect(consumption[0].totalCost.toString()).toBe('400');
  });

  it('rejects costing a non-positive quantity', async () => {
    await expect(
      prisma.$transaction((tx) =>
        valuation.costIssue(tx, {
          productId: FIXTURE.productId,
          warehouseId: FIXTURE.warehouseId,
          quantity: 0,
          transactionId: crypto.randomUUID(),
        }),
      ),
    ).rejects.toThrow(/non-positive/);
  });
});

describe('Trial balance', () => {
  it('balances and reports the difference explicitly', async () => {
    const result = await journal.trialBalance();
    expect(result.balanced).toBe(true);
    expect(result.difference).toBe('0');
    expect(result.rows.every((r) => ['DEBIT', 'CREDIT'].includes(r.normalSide))).toBe(true);
  });
});
