/**
 * Pricing engine against a real database (§32).
 *
 * The resolution order is the whole point of having one pricing service, so it
 * is proven end to end rather than unit-tested against a mock that could agree
 * with a wrong implementation.
 */

import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AuditService } from '../src/common/audit/audit.service';
import { ConfigService } from '../src/common/config/config.service';
import { PricingService } from '../src/modules/catalog/pricing.service';

const prisma = new PrismaService();
const config = new ConfigService(prisma);
const pricing = new PricingService(prisma, config, new AuditService(prisma));

const FIXTURE = {
  productId: '',
  branchId: '',
  groupId: '',
  otherGroupId: '',
  listIds: [] as string[],
};

const PREFIX = 'PRICETEST';

beforeAll(async () => {
  await prisma.$connect();

  const branch = await prisma.branch.findFirstOrThrow();
  FIXTURE.branchId = branch.id;

  const product = await prisma.product.create({
    data: {
      sku: `${PREFIX}-SKU`,
      genericName: 'Pricing fixture',
      activeIngredient: 'Fixture',
      strength: '1 mg',
      dosageForm: 'Tablet',
      retailPrice: new Prisma.Decimal(100),
      wholesalePrice: new Prisma.Decimal(80),
      insurancePrice: new Prisma.Decimal(70),
      taxRate: new Prisma.Decimal('0.15'),
    },
  });
  FIXTURE.productId = product.id;

  const group = await prisma.customerGroup.create({
    data: { code: `${PREFIX}-G1`, name: 'Fixture group', discountPercent: new Prisma.Decimal('0.10') },
  });
  FIXTURE.groupId = group.id;

  const otherGroup = await prisma.customerGroup.create({
    data: { code: `${PREFIX}-G2`, name: 'Other group', discountPercent: new Prisma.Decimal(0) },
  });
  FIXTURE.otherGroupId = otherGroup.id;
});

afterAll(async () => {
  await prisma.priceListItem.deleteMany({ where: { productId: FIXTURE.productId } });
  await prisma.priceList.deleteMany({ where: { code: { startsWith: PREFIX } } });
  await prisma.priceHistory.deleteMany({ where: { productId: FIXTURE.productId } });
  await prisma.patient.deleteMany({ where: { patientCode: { startsWith: PREFIX } } });
  await prisma.customerGroup.deleteMany({ where: { code: { startsWith: PREFIX } } });
  await prisma.product.deleteMany({ where: { sku: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

afterEach(async () => {
  await prisma.priceListItem.deleteMany({ where: { productId: FIXTURE.productId } });
  await prisma.priceList.deleteMany({ where: { code: { startsWith: PREFIX } } });
});

async function makeList(
  code: string,
  data: Partial<Prisma.PriceListUncheckedCreateInput>,
  price: number,
  minQuantity = 0,
) {
  const list = await prisma.priceList.create({
    data: {
      code: `${PREFIX}-${code}`,
      name: `Fixture ${code}`,
      listType: 'RETAIL',
      ...data,
    } as Prisma.PriceListUncheckedCreateInput,
  });
  await prisma.priceListItem.create({
    data: {
      priceListId: list.id,
      productId: FIXTURE.productId,
      unitPrice: new Prisma.Decimal(price),
      minQuantity: new Prisma.Decimal(minQuantity),
    },
  });
  return list;
}

describe('Price resolution order (§32)', () => {
  it('falls back to the product retail price when nothing matches', async () => {
    const result = await pricing.resolve({ productId: FIXTURE.productId });
    expect(result.source).toBe('PRODUCT_RETAIL');
    expect(Number(result.unitPrice)).toBe(100);
  });

  it('uses the wholesale price when that channel is requested', async () => {
    const result = await pricing.resolve({ productId: FIXTURE.productId, channel: 'WHOLESALE' });
    expect(result.source).toBe('PRODUCT_WHOLESALE');
    expect(Number(result.unitPrice)).toBe(80);
  });

  it('uses the insurance price when that channel is requested', async () => {
    const result = await pricing.resolve({ productId: FIXTURE.productId, channel: 'INSURANCE' });
    expect(result.source).toBe('PRODUCT_INSURANCE');
    expect(Number(result.unitPrice)).toBe(70);
  });

  it('prefers a matching price list over the product price', async () => {
    await makeList('BASE', {}, 90);
    const result = await pricing.resolve({ productId: FIXTURE.productId });
    expect(result.source).toBe('PRICE_LIST');
    expect(Number(result.unitPrice)).toBe(90);
  });

  it('ranks a higher-priority list above a lower one', async () => {
    await makeList('LOW', { priority: 10 }, 90);
    await makeList('HIGH', { priority: 90 }, 75);
    const result = await pricing.resolve({ productId: FIXTURE.productId });
    expect(Number(result.unitPrice)).toBe(75);
    expect(result.priceListName).toContain('HIGH');
  });

  it('prefers the tighter scope when priorities tie', async () => {
    await makeList('GLOBAL', { priority: 50 }, 90);
    await makeList('BRANCH', { priority: 50, branchId: FIXTURE.branchId }, 85);
    const result = await pricing.resolve({
      productId: FIXTURE.productId,
      branchId: FIXTURE.branchId,
    });
    expect(Number(result.unitPrice)).toBe(85);
  });

  it('ignores a list scoped to a different branch', async () => {
    const otherBranch = await prisma.branch.findFirst({ where: { id: { not: FIXTURE.branchId } } });
    if (!otherBranch) return;
    await makeList('OTHERBRANCH', { priority: 99, branchId: otherBranch.id }, 10);
    const result = await pricing.resolve({
      productId: FIXTURE.productId,
      branchId: FIXTURE.branchId,
    });
    expect(result.source).toBe('PRODUCT_RETAIL');
    expect(Number(result.unitPrice)).toBe(100);
  });

  it('ignores a list scoped to a different customer group', async () => {
    await makeList('OTHERGROUP', { priority: 99, customerGroupId: FIXTURE.otherGroupId }, 10);
    const result = await pricing.resolve({
      productId: FIXTURE.productId,
      customerGroupId: FIXTURE.groupId,
    });
    expect(result.source).toBe('PRODUCT_RETAIL');
  });
});

describe('Quantity breaks', () => {
  it('takes the highest break at or below the line quantity', async () => {
    const list = await makeList('QTY', { priority: 10 }, 90, 0);
    await prisma.priceListItem.createMany({
      data: [
        {
          priceListId: list.id,
          productId: FIXTURE.productId,
          unitPrice: new Prisma.Decimal(80),
          minQuantity: new Prisma.Decimal(100),
        },
        {
          priceListId: list.id,
          productId: FIXTURE.productId,
          unitPrice: new Prisma.Decimal(70),
          minQuantity: new Prisma.Decimal(500),
        },
      ],
    });

    expect(Number((await pricing.resolve({ productId: FIXTURE.productId, quantity: 1 })).unitPrice)).toBe(90);
    expect(Number((await pricing.resolve({ productId: FIXTURE.productId, quantity: 100 })).unitPrice)).toBe(80);
    expect(Number((await pricing.resolve({ productId: FIXTURE.productId, quantity: 499 })).unitPrice)).toBe(80);
    expect(Number((await pricing.resolve({ productId: FIXTURE.productId, quantity: 500 })).unitPrice)).toBe(70);
    expect(Number((await pricing.resolve({ productId: FIXTURE.productId, quantity: 10_000 })).unitPrice)).toBe(70);
  });
});

describe('Effective windows', () => {
  it('ignores a list that has not started', async () => {
    await makeList('FUTURE', { priority: 99, effectiveFrom: new Date(Date.now() + 86_400_000) }, 10);
    const result = await pricing.resolve({ productId: FIXTURE.productId });
    expect(result.source).toBe('PRODUCT_RETAIL');
  });

  it('ignores a list that has ended', async () => {
    await makeList(
      'PAST',
      {
        priority: 99,
        effectiveFrom: new Date(Date.now() - 20 * 86_400_000),
        effectiveTo: new Date(Date.now() - 86_400_000),
      },
      10,
    );
    const result = await pricing.resolve({ productId: FIXTURE.productId });
    expect(result.source).toBe('PRODUCT_RETAIL');
  });

  it('honours a per-line window that ends before the list does', async () => {
    const list = await makeList('LINEWINDOW', { priority: 99 }, 50);
    await prisma.priceListItem.updateMany({
      where: { priceListId: list.id },
      data: { effectiveTo: new Date(Date.now() - 86_400_000) },
    });
    const result = await pricing.resolve({ productId: FIXTURE.productId });
    expect(result.source).toBe('PRODUCT_RETAIL');
  });

  it('applies a promotion that is currently running', async () => {
    await makeList(
      'PROMO',
      {
        priority: 99,
        listType: 'PROMOTIONAL',
        effectiveFrom: new Date(Date.now() - 86_400_000),
        effectiveTo: new Date(Date.now() + 86_400_000),
      },
      60,
    );
    const result = await pricing.resolve({ productId: FIXTURE.productId });
    expect(Number(result.unitPrice)).toBe(60);
    expect(result.listType).toBe('PROMOTIONAL');
  });
});

describe('Customer group discount', () => {
  it('applies the group discount on top of the list price', async () => {
    await makeList('GROUPBASE', { priority: 10, customerGroupId: FIXTURE.groupId }, 90);
    const result = await pricing.resolve({
      productId: FIXTURE.productId,
      customerGroupId: FIXTURE.groupId,
    });
    // 90 less the group's 10% standing discount.
    expect(Number(result.unitPrice)).toBe(81);
    expect(Number(result.basePrice)).toBe(90);
  });

  it('applies the group discount to the product price when no list matches', async () => {
    const result = await pricing.resolve({
      productId: FIXTURE.productId,
      customerGroupId: FIXTURE.groupId,
    });
    expect(Number(result.unitPrice)).toBe(90);
  });

  it('reads the group from the patient when only a patient is given', async () => {
    const patient = await prisma.patient.create({
      data: {
        patientCode: `${PREFIX}-PT1`,
        fullName: 'Fixture Patient',
        customerGroupId: FIXTURE.groupId,
      },
    });

    const result = await pricing.resolve({
      productId: FIXTURE.productId,
      patientId: patient.id,
    });
    expect(Number(result.unitPrice)).toBe(90);
    expect(result.explanation.some((e) => e.includes('Fixture group'))).toBe(true);
  });
});

describe('Transparency', () => {
  it('always explains where the price came from', async () => {
    const result = await pricing.resolve({ productId: FIXTURE.productId });
    expect(result.explanation.length).toBeGreaterThan(0);
    expect(result.explanation.join(' ')).toMatch(/price/i);
  });

  it('rounds to the configured number of decimals', async () => {
    await makeList('ROUND', { priority: 10, customerGroupId: FIXTURE.groupId }, 33.333);
    const result = await pricing.resolve({
      productId: FIXTURE.productId,
      customerGroupId: FIXTURE.groupId,
    });
    // 33.333 * 0.9 = 29.9997 -> 30.00 at two decimals.
    expect(result.unitPrice).toBe('30');
  });
});
