import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConfigService } from '../../common/config/config.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';

export interface PriceQuery {
  productId: string;
  quantity?: number;
  branchId?: string | null;
  customerGroupId?: string | null;
  patientId?: string | null;
  /** RETAIL | WHOLESALE | INSURANCE — the base price when no list matches. */
  channel?: 'RETAIL' | 'WHOLESALE' | 'INSURANCE';
  at?: Date;
}

export interface ResolvedPrice {
  productId: string;
  unitPrice: string;
  currency: string;
  taxRate: string;
  /** Where the price came from, so a cashier can see why it is what it is. */
  source: 'PRICE_LIST' | 'PRODUCT_WHOLESALE' | 'PRODUCT_INSURANCE' | 'PRODUCT_RETAIL';
  priceListId: string | null;
  priceListName: string | null;
  listType: string | null;
  /** Group discount applied after the list price, as a fraction. */
  groupDiscount: string;
  basePrice: string;
  /** Every candidate considered, in the order they were ranked. */
  explanation: string[];
}

/**
 * The single authority on what a product costs (§32).
 *
 * POS, dispensing, quotations and invoicing all resolve price here rather than
 * reading `product.retailPrice` directly, for the same reason FEFO lives in one
 * service: a second implementation is a second set of rules that will drift.
 *
 * Resolution order, highest priority first:
 *   1. An active price list whose scope matches (branch and/or customer group),
 *      inside its effective window, with a quantity break at or below the line
 *      quantity. Ties break on the list's own `priority`, then on the tightest
 *      scope, then on the most recent start date.
 *   2. The product's channel price — wholesale or insurance when that channel
 *      was asked for and a price is set.
 *   3. The product's retail price.
 *
 * A customer group's blanket discount applies *after* a list price, because a
 * contract list is already the negotiated number; the group discount is the
 * segment's standing arrangement on top of ordinary pricing.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private round(value: Prisma.Decimal, decimals: number): Prisma.Decimal {
    return value.toDecimalPlaces(decimals, Prisma.Decimal.ROUND_HALF_UP);
  }

  async resolve(query: PriceQuery): Promise<ResolvedPrice> {
    const at = query.at ?? new Date();
    const quantity = new Prisma.Decimal(query.quantity ?? 1);
    const decimals = await this.config.getNumber('finance.roundingDecimals');

    const product = await this.prisma.product.findUnique({
      where: { id: query.productId },
      select: {
        id: true,
        retailPrice: true,
        wholesalePrice: true,
        insurancePrice: true,
        taxRate: true,
      },
    });
    if (!product) throw new NotFoundException('Product not found');

    // A patient carries their group, so callers can pass either.
    let customerGroupId = query.customerGroupId ?? null;
    if (!customerGroupId && query.patientId) {
      const patient = await this.prisma.patient.findUnique({
        where: { id: query.patientId },
        select: { customerGroupId: true },
      });
      customerGroupId = patient?.customerGroupId ?? null;
    }

    const explanation: string[] = [];
    const channel = query.channel ?? 'RETAIL';

    const candidates = await this.prisma.priceListItem.findMany({
      where: {
        productId: query.productId,
        minQuantity: { lte: quantity },
        AND: [
          { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: at } }] },
          { OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }] },
        ],
        priceList: {
          isActive: true,
          effectiveFrom: { lte: at },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
          // A list scoped to a branch or group only applies there; an unscoped
          // list applies everywhere.
          AND: [
            { OR: [{ branchId: null }, ...(query.branchId ? [{ branchId: query.branchId }] : [])] },
            {
              OR: [
                { customerGroupId: null },
                ...(customerGroupId ? [{ customerGroupId }] : []),
              ],
            },
          ],
        },
      },
      include: { priceList: true },
    });

    // Rank: explicit priority, then scope specificity, then latest start, then
    // the highest quantity break that still qualifies.
    const scored = candidates
      .map((item) => ({
        item,
        specificity:
          (item.priceList.branchId ? 2 : 0) + (item.priceList.customerGroupId ? 1 : 0),
      }))
      .sort((a, b) => {
        if (b.item.priceList.priority !== a.item.priceList.priority) {
          return b.item.priceList.priority - a.item.priceList.priority;
        }
        if (b.specificity !== a.specificity) return b.specificity - a.specificity;
        const aFrom = (a.item.effectiveFrom ?? a.item.priceList.effectiveFrom).getTime();
        const bFrom = (b.item.effectiveFrom ?? b.item.priceList.effectiveFrom).getTime();
        if (bFrom !== aFrom) return bFrom - aFrom;
        return Number(b.item.minQuantity) - Number(a.item.minQuantity);
      });

    for (const { item } of scored.slice(0, 5)) {
      explanation.push(
        `Considered "${item.priceList.name}" (${item.priceList.listType}, priority ${item.priceList.priority}` +
          `${item.priceList.branchId ? ', branch-scoped' : ''}` +
          `${item.priceList.customerGroupId ? ', group-scoped' : ''}` +
          `) at ${item.unitPrice.toString()} from quantity ${item.minQuantity.toString()}`,
      );
    }

    let basePrice: Prisma.Decimal;
    let source: ResolvedPrice['source'];
    let priceListId: string | null = null;
    let priceListName: string | null = null;
    let listType: string | null = null;
    let currency = 'ETB';

    const winner = scored[0]?.item;
    if (winner) {
      basePrice = winner.unitPrice;
      source = 'PRICE_LIST';
      priceListId = winner.priceListId;
      priceListName = winner.priceList.name;
      listType = winner.priceList.listType;
      currency = winner.priceList.currency;
      explanation.push(`Selected "${winner.priceList.name}" at ${basePrice.toString()}.`);
    } else if (channel === 'WHOLESALE' && product.wholesalePrice.greaterThan(0)) {
      basePrice = product.wholesalePrice;
      source = 'PRODUCT_WHOLESALE';
      explanation.push('No price list matched; using the product wholesale price.');
    } else if (channel === 'INSURANCE' && product.insurancePrice?.greaterThan(0)) {
      basePrice = product.insurancePrice;
      source = 'PRODUCT_INSURANCE';
      explanation.push('No price list matched; using the product insurance price.');
    } else {
      basePrice = product.retailPrice;
      source = 'PRODUCT_RETAIL';
      explanation.push('No price list matched; using the product retail price.');
    }

    let groupDiscount = new Prisma.Decimal(0);
    if (customerGroupId) {
      const group = await this.prisma.customerGroup.findUnique({
        where: { id: customerGroupId },
        select: { name: true, discountPercent: true, isActive: true },
      });
      if (group?.isActive && group.discountPercent.greaterThan(0)) {
        groupDiscount = group.discountPercent;
        explanation.push(
          `Customer group "${group.name}" discount of ${group.discountPercent.times(100).toString()}% applied.`,
        );
      }
    }

    const unitPrice = this.round(
      basePrice.times(new Prisma.Decimal(1).minus(groupDiscount)),
      decimals,
    );

    return {
      productId: product.id,
      unitPrice: unitPrice.toString(),
      currency,
      taxRate: product.taxRate.toString(),
      source,
      priceListId,
      priceListName,
      listType,
      groupDiscount: groupDiscount.toString(),
      basePrice: basePrice.toString(),
      explanation,
    };
  }

  /** Resolve many products at once — the POS cart and quotation paths. */
  async resolveMany(
    productIds: string[],
    context: Omit<PriceQuery, 'productId'>,
  ): Promise<Map<string, ResolvedPrice>> {
    const results = await Promise.all(
      productIds.map((productId) => this.resolve({ ...context, productId })),
    );
    return new Map(results.map((r) => [r.productId, r]));
  }

  // ---- Price list administration ----

  async listPriceLists(filter: { listType?: string; branchId?: string } = {}) {
    return this.prisma.priceList.findMany({
      where: {
        ...(filter.listType ? { listType: filter.listType } : {}),
        ...(filter.branchId ? { branchId: filter.branchId } : {}),
      },
      include: {
        customerGroup: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
      orderBy: [{ priority: 'desc' }, { name: 'asc' }],
    });
  }

  async getPriceList(id: string) {
    const list = await this.prisma.priceList.findUnique({
      where: { id },
      include: {
        customerGroup: true,
        items: {
          include: {
            product: { select: { id: true, sku: true, genericName: true, brandName: true, strength: true } },
          },
          orderBy: { minQuantity: 'asc' },
        },
      },
    });
    if (!list) throw new NotFoundException('Price list not found');
    return list;
  }

  async createPriceList(data: Record<string, unknown>, user: AuthenticatedUser) {
    const created = await this.prisma.priceList.create({
      data: { ...(data as any), createdById: user.id },
    });
    await this.audit.record({
      userId: user.id,
      module: 'catalog',
      action: 'CREATE',
      entityType: 'PriceList',
      entityId: created.id,
      newValue: created,
    });
    return created;
  }

  async updatePriceList(id: string, data: Record<string, unknown>, user: AuthenticatedUser) {
    const before = await this.prisma.priceList.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Price list not found');

    const updated = await this.prisma.priceList.update({ where: { id }, data });
    await this.audit.record({
      userId: user.id,
      module: 'catalog',
      action: 'EDIT',
      entityType: 'PriceList',
      entityId: id,
      previousValue: before,
      newValue: updated,
    });
    return updated;
  }

  /**
   * Set the price of one product on a list.
   *
   * Every change writes a PriceHistory row with the old and new value and the
   * actor, which is the §71 audit example verbatim.
   */
  async setPrice(
    priceListId: string,
    data: {
      productId: string;
      unitPrice: number | string;
      minQuantity?: number | string;
      effectiveFrom?: string;
      effectiveTo?: string;
      reason?: string;
    },
    user: AuthenticatedUser,
  ) {
    const list = await this.prisma.priceList.findUnique({ where: { id: priceListId } });
    if (!list) throw new NotFoundException('Price list not found');

    const minQuantity = new Prisma.Decimal(data.minQuantity ?? 0);
    const unitPrice = new Prisma.Decimal(data.unitPrice);

    const existing = await this.prisma.priceListItem.findUnique({
      where: {
        priceListId_productId_minQuantity: { priceListId, productId: data.productId, minQuantity },
      },
    });

    const item = await this.prisma.$transaction(async (tx) => {
      const saved = existing
        ? await tx.priceListItem.update({
            where: { id: existing.id },
            data: {
              unitPrice,
              effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : null,
              effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null,
            },
          })
        : await tx.priceListItem.create({
            data: {
              priceListId,
              productId: data.productId,
              unitPrice,
              minQuantity,
              effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : null,
              effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null,
            },
          });

      await tx.priceHistory.create({
        data: {
          productId: data.productId,
          branchId: list.branchId,
          priceType: list.listType,
          oldValue: existing?.unitPrice ?? new Prisma.Decimal(0),
          newValue: unitPrice,
          reason: data.reason ?? `Price list "${list.name}"`,
          changedById: user.id,
        },
      });

      return saved;
    });

    await this.audit.record({
      userId: user.id,
      module: 'catalog',
      action: existing ? 'EDIT' : 'CREATE',
      entityType: 'PriceListItem',
      entityId: item.id,
      previousValue: existing ? { unitPrice: existing.unitPrice.toString() } : undefined,
      newValue: { unitPrice: unitPrice.toString(), minQuantity: minQuantity.toString() },
      reason: data.reason,
    });

    return item;
  }

  async removePrice(itemId: string, user: AuthenticatedUser) {
    const item = await this.prisma.priceListItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Price list line not found');

    await this.prisma.priceListItem.delete({ where: { id: itemId } });
    await this.audit.record({
      userId: user.id,
      module: 'catalog',
      action: 'DELETE',
      entityType: 'PriceListItem',
      entityId: itemId,
      previousValue: item,
    });
    return { removed: true };
  }

  /** Full price history for a product, newest first (§2: feature 100). */
  async priceHistory(productId: string, limit = 100) {
    return this.prisma.priceHistory.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 500),
    });
  }

  // ---- Customer groups ----

  async listCustomerGroups() {
    return this.prisma.customerGroup.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { patients: true, priceLists: true } } },
    });
  }

  async createCustomerGroup(data: Record<string, unknown>, user: AuthenticatedUser) {
    const created = await this.prisma.customerGroup.create({ data: data as any });
    await this.audit.record({
      userId: user.id,
      module: 'catalog',
      action: 'CREATE',
      entityType: 'CustomerGroup',
      entityId: created.id,
      newValue: created,
    });
    return created;
  }

  async updateCustomerGroup(id: string, data: Record<string, unknown>, user: AuthenticatedUser) {
    const before = await this.prisma.customerGroup.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Customer group not found');

    const updated = await this.prisma.customerGroup.update({ where: { id }, data });
    await this.audit.record({
      userId: user.id,
      module: 'catalog',
      action: 'EDIT',
      entityType: 'CustomerGroup',
      entityId: id,
      previousValue: before,
      newValue: updated,
    });
    return updated;
  }
}
