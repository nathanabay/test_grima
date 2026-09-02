import { Injectable } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import {
  bucketFor,
  classifyExpiry,
  daysUntil,
  expiryBuckets,
  expiryRiskScore,
} from '@pharmacore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthenticatedUser } from '../../common/decorators';
import { ScopeService } from '../../common/guards/scope.service';
import { ConfigService } from '../../common/config/config.service';

export interface StockQuery {
  productId?: string;
  warehouseId?: string;
  branchId?: string;
  search?: string;
  onlyBelowReorder?: boolean;
  onlyOutOfStock?: boolean;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly config: ConfigService,
  ) {}

  /** Paginated stock balances, always scoped to what the user may see. */
  async listBalances(user: AuthenticatedUser, query: StockQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, query.pageSize ?? 50);

    const where: Prisma.InventoryBalanceWhereInput = {
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(this.scope.isUnscoped(user) ? {} : { branchId: { in: user.branchIds } }),
      ...(query.onlyOutOfStock ? { onHand: { lte: 0 } } : {}),
      ...(query.search
        ? {
            product: {
              OR: [
                { genericName: { contains: query.search, mode: 'insensitive' } },
                { brandName: { contains: query.search, mode: 'insensitive' } },
                { sku: { contains: query.search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.inventoryBalance.findMany({
        where,
        include: {
          product: {
            select: {
              id: true,
              sku: true,
              genericName: true,
              brandName: true,
              strength: true,
              dosageForm: true,
              baseUnit: true,
              reorderLevel: true,
              isControlled: true,
              isColdChain: true,
              averageCost: true,
              retailPrice: true,
            },
          },
          batch: {
            select: { id: true, batchNumber: true, expiryDate: true, status: true },
          },
          warehouse: { select: { id: true, name: true, code: true, branchId: true } },
          location: { select: { id: true, code: true, name: true } },
        },
        orderBy: [{ product: { genericName: 'asc' } }, { batch: { expiryDate: 'asc' } }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.inventoryBalance.count({ where }),
    ]);

    const data = rows.map((row) => {
      const available = row.onHand.minus(row.reserved);
      return {
        ...row,
        available,
        expiryBucket: row.batch ? classifyExpiry(row.batch.expiryDate) : null,
        daysToExpiry: row.batch ? daysUntil(row.batch.expiryDate) : null,
        stockValue: available.times(row.product.averageCost),
      };
    });

    const filtered = query.onlyBelowReorder
      ? data.filter((d) => d.available.lessThanOrEqualTo(d.product.reorderLevel))
      : data;

    return { data: filtered, total, page, pageSize };
  }

  /** Aggregate on-hand across batches for one product (the "do we have it" view). */
  async productStock(productId: string, user: AuthenticatedUser) {
    const balances = await this.prisma.inventoryBalance.findMany({
      where: {
        productId,
        ...(this.scope.isUnscoped(user) ? {} : { branchId: { in: user.branchIds } }),
      },
      include: {
        batch: { select: { batchNumber: true, expiryDate: true, status: true } },
        warehouse: { select: { id: true, name: true, branchId: true } },
      },
    });

    const totalOnHand = balances.reduce(
      (sum, b) => sum.plus(b.onHand),
      new Prisma.Decimal(0),
    );
    const totalReserved = balances.reduce(
      (sum, b) => sum.plus(b.reserved),
      new Prisma.Decimal(0),
    );

    return {
      productId,
      totalOnHand,
      totalReserved,
      totalAvailable: totalOnHand.minus(totalReserved),
      positions: balances,
    };
  }

  /** Stock ledger for a product/batch, newest first (§19). */
  async ledger(query: {
    productId?: string;
    batchId?: string;
    warehouseId?: string;
    from?: Date;
    to?: Date;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(500, query.pageSize ?? 100);

    const where: Prisma.InventoryTransactionWhereInput = {
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.batchId ? { batchId: query.batchId } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.from || query.to
        ? { occurredAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.inventoryTransaction.findMany({
        where,
        include: {
          product: { select: { sku: true, genericName: true, brandName: true } },
          batch: { select: { batchNumber: true, expiryDate: true } },
        },
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.inventoryTransaction.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  /**
   * Expiry dashboard (§9): every batch position bucketed by remaining shelf
   * life, with the value that would be lost if it is not moved.
   */
  async expiryReport(
    user: AuthenticatedUser,
    options: { warehouseId?: string; maxDays?: number } = {},
  ) {
    const balances = await this.prisma.inventoryBalance.findMany({
      where: {
        onHand: { gt: 0 },
        batchId: { not: null },
        ...(options.warehouseId ? { warehouseId: options.warehouseId } : {}),
        ...(this.scope.isUnscoped(user) ? {} : { branchId: { in: user.branchIds } }),
      },
      include: {
        batch: true,
        product: {
          select: {
            id: true,
            sku: true,
            genericName: true,
            brandName: true,
            strength: true,
            averageCost: true,
            baseUnit: true,
          },
        },
        warehouse: { select: { id: true, name: true, branchId: true } },
      },
    });

    const now = new Date();
    // §65: the horizons are administrator-configured, so the ladder is built
    // from the setting rather than from constants in this file. Before this,
    // expiry.alertBuckets could be changed and nothing happened.
    const ladder = expiryBuckets(await this.config.getNumberArray('expiry.alertBuckets'));

    const rows = balances
      .filter((b) => b.batch)
      .map((b) => {
        const days = daysUntil(b.batch!.expiryDate, now);
        const available = b.onHand.minus(b.reserved);
        return {
          productId: b.product.id,
          sku: b.product.sku,
          productName: `${b.product.genericName}${b.product.brandName ? ` (${b.product.brandName})` : ''}`,
          strength: b.product.strength,
          batchId: b.batch!.id,
          batchNumber: b.batch!.batchNumber,
          batchStatus: b.batch!.status,
          expiryDate: b.batch!.expiryDate,
          daysRemaining: days,
          bucket: bucketFor(b.batch!.expiryDate, ladder, now).key,
          quantity: available,
          unit: b.product.baseUnit,
          warehouseId: b.warehouseId,
          warehouseName: b.warehouse.name,
          branchId: b.branchId,
          // §9: Potential Expiry Loss = remaining quantity x inventory cost
          potentialLoss: available.times(b.product.averageCost),
        };
      })
      .filter((r) => options.maxDays === undefined || r.daysRemaining <= options.maxDays)
      .sort((a, b) => a.daysRemaining - b.daysRemaining);

    const summary = rows.reduce<Record<string, { count: number; quantity: number; value: number }>>(
      (acc, row) => {
        const key = row.bucket;
        acc[key] ??= { count: 0, quantity: 0, value: 0 };
        acc[key].count += 1;
        acc[key].quantity += Number(row.quantity);
        acc[key].value += Number(row.potentialLoss);
        return acc;
      },
      {},
    );

    return {
      rows,
      // The ladder travels with the data so a screen renders the configured
      // labels instead of keeping its own copy, which is exactly how the two
      // drift apart when an administrator changes the horizons.
      buckets: ladder,
      summary,
      totalValueAtRisk: rows.reduce((sum, r) => sum + Number(r.potentialLoss), 0),
    };
  }

  /**
   * Month-by-month expiry calendar (§9: feature 108).
   *
   * The bucket ladder answers "how urgent"; the calendar answers "when", which
   * is the question a purchasing plan is built from. Value at risk is the
   * quantity that is actually available - stock already reserved against an
   * order is not going to sit on the shelf and expire.
   */
  async expiryCalendar(
    user: AuthenticatedUser,
    options: { warehouseId?: string; months?: number } = {},
  ) {
    const months = Math.min(36, Math.max(1, options.months ?? 12));
    const now = new Date();
    const horizon = new Date(now.getFullYear(), now.getMonth() + months, 1);

    const balances = await this.prisma.inventoryBalance.findMany({
      where: {
        onHand: { gt: 0 },
        batchId: { not: null },
        ...(options.warehouseId ? { warehouseId: options.warehouseId } : {}),
        ...(this.scope.isUnscoped(user) ? {} : { branchId: { in: user.branchIds } }),
        batch: { expiryDate: { lt: horizon } },
      },
      include: {
        batch: { select: { id: true, batchNumber: true, expiryDate: true } },
        product: { select: { id: true, sku: true, genericName: true, averageCost: true } },
      },
    });

    const cells = new Map<
      string,
      { month: string; batches: number; quantity: Prisma.Decimal; value: Prisma.Decimal; alreadyExpired: boolean }
    >();

    for (const b of balances) {
      if (!b.batch) continue;
      const expiry = b.batch.expiryDate;
      const month = `${expiry.getFullYear()}-${String(expiry.getMonth() + 1).padStart(2, '0')}`;
      const available = b.onHand.minus(b.reserved);
      if (available.lessThanOrEqualTo(0)) continue;

      const cell = cells.get(month) ?? {
        month,
        batches: 0,
        quantity: new Prisma.Decimal(0),
        value: new Prisma.Decimal(0),
        // Stock that has already expired is shown in its own month rather than
        // folded into "this month": it is a disposal backlog, not a risk.
        alreadyExpired: expiry.getTime() < now.getTime(),
      };
      cells.set(month, {
        ...cell,
        batches: cell.batches + 1,
        quantity: cell.quantity.plus(available),
        value: cell.value.plus(available.times(b.product.averageCost)),
      });
    }

    const rows = [...cells.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((c) => ({
        month: c.month,
        batches: c.batches,
        quantity: c.quantity.toFixed(2),
        value: c.value.toFixed(2),
        alreadyExpired: c.alreadyExpired,
      }));

    return {
      months,
      generatedAt: now,
      rows,
      peakMonth: rows.reduce<null | (typeof rows)[number]>(
        (peak, r) => (!peak || Number(r.value) > Number(peak.value) ? r : peak),
        null,
      ),
      totalValue: rows.reduce((sum, r) => sum + Number(r.value), 0).toFixed(2),
    };
  }

  /**
   * How much stock we actually lost to expiry, month by month (§9: feature 109).
   *
   * This is history, not projection: it reads the EXPIRY_WRITE_OFF and DISPOSAL
   * movements the ledger already holds. Trending what was projected would only
   * measure how the projection changed.
   */
  async expiryTrend(user: AuthenticatedUser, options: { months?: number; warehouseId?: string } = {}) {
    const months = Math.min(36, Math.max(1, options.months ?? 12));
    const since = new Date();
    since.setMonth(since.getMonth() - months);
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    const movements = await this.prisma.inventoryTransaction.findMany({
      where: {
        type: { in: [TransactionType.EXPIRY, TransactionType.DISPOSAL] },
        occurredAt: { gte: since },
        ...(options.warehouseId ? { warehouseId: options.warehouseId } : {}),
        ...(this.scope.isUnscoped(user) ? {} : { branchId: { in: user.branchIds } }),
      },
      select: {
        type: true,
        occurredAt: true,
        quantityOut: true,
        unitCost: true,
        productId: true,
      },
    });

    const byMonth = new Map<string, { quantity: Prisma.Decimal; value: Prisma.Decimal; lines: number }>();
    const byProduct = new Map<string, { quantity: Prisma.Decimal; value: Prisma.Decimal }>();

    for (const m of movements) {
      const key = `${m.occurredAt.getFullYear()}-${String(m.occurredAt.getMonth() + 1).padStart(2, '0')}`;
      const cell = byMonth.get(key) ?? {
        quantity: new Prisma.Decimal(0),
        value: new Prisma.Decimal(0),
        lines: 0,
      };
      // Value is quantity x the cost the movement was actually posted at, not
      // today's average cost: writing off last year's stock at this year's
      // price would restate history every time a price moved.
      const quantity = m.quantityOut;
      const cost = quantity.times(m.unitCost);
      byMonth.set(key, {
        quantity: cell.quantity.plus(quantity),
        value: cell.value.plus(cost),
        lines: cell.lines + 1,
      });

      const p = byProduct.get(m.productId) ?? {
        quantity: new Prisma.Decimal(0),
        value: new Prisma.Decimal(0),
      };
      byProduct.set(m.productId, {
        quantity: p.quantity.plus(quantity),
        value: p.value.plus(cost),
      });
    }

    const productIds = [...byProduct.keys()];
    const products = productIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, sku: true, genericName: true, strength: true },
        })
      : [];
    const productById = new Map(products.map((p) => [p.id, p]));

    const series = [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, v]) => ({
        month,
        lines: v.lines,
        quantity: v.quantity.toFixed(2),
        value: v.value.toFixed(2),
      }));

    return {
      months,
      series,
      totalValue: series.reduce((sum, s) => sum + Number(s.value), 0).toFixed(2),
      worstProducts: [...byProduct.entries()]
        .map(([productId, v]) => ({
          productId,
          sku: productById.get(productId)?.sku ?? productId,
          product: productById.get(productId)
            ? `${productById.get(productId)!.genericName} ${productById.get(productId)!.strength}`.trim()
            : productId,
          quantity: v.quantity.toFixed(2),
          value: v.value.toFixed(2),
        }))
        .sort((a, b) => Number(b.value) - Number(a.value))
        .slice(0, 20),
    };
  }

  /**
   * Expiry exposure compared across branches, categories or suppliers
   * (§9: features 110-112).
   *
   * One dimension per call, because a table that crosses all three at once is
   * unreadable and nobody acts on it. Value at risk is what is compared -
   * counting batches would rank a branch holding cheap sachets above one
   * holding insulin.
   */
  async expiryComparison(
    user: AuthenticatedUser,
    dimension: 'branch' | 'category' | 'supplier',
    options: { withinDays?: number } = {},
  ) {
    const withinDays = Math.min(730, Math.max(1, options.withinDays ?? 180));
    const horizon = new Date(Date.now() + withinDays * 86_400_000);

    const balances = await this.prisma.inventoryBalance.findMany({
      where: {
        onHand: { gt: 0 },
        batchId: { not: null },
        batch: { expiryDate: { lt: horizon } },
        ...(this.scope.isUnscoped(user) ? {} : { branchId: { in: user.branchIds } }),
      },
      include: {
        batch: { select: { expiryDate: true, supplierId: true } },
        product: { select: { id: true, categoryId: true, averageCost: true } },
      },
    });

    const groups = new Map<
      string,
      { key: string; batches: number; quantity: Prisma.Decimal; value: Prisma.Decimal }
    >();

    for (const b of balances) {
      if (!b.batch) continue;
      const available = b.onHand.minus(b.reserved);
      if (available.lessThanOrEqualTo(0)) continue;

      const key =
        dimension === 'branch'
          ? b.branchId
          : dimension === 'category'
            ? b.product.categoryId ?? 'UNCATEGORISED'
            : b.batch.supplierId ?? 'UNKNOWN_SUPPLIER';

      const cell = groups.get(key) ?? {
        key,
        batches: 0,
        quantity: new Prisma.Decimal(0),
        value: new Prisma.Decimal(0),
      };
      groups.set(key, {
        key,
        batches: cell.batches + 1,
        quantity: cell.quantity.plus(available),
        value: cell.value.plus(available.times(b.product.averageCost)),
      });
    }

    const keys = [...groups.keys()].filter((k) => !['UNCATEGORISED', 'UNKNOWN_SUPPLIER'].includes(k));
    const labels = new Map<string, string>();
    if (dimension === 'branch' && keys.length) {
      const branches = await this.prisma.branch.findMany({
        where: { id: { in: keys } },
        select: { id: true, name: true },
      });
      branches.forEach((b) => labels.set(b.id, b.name));
    } else if (dimension === 'category' && keys.length) {
      const categories = await this.prisma.productCategory.findMany({
        where: { id: { in: keys } },
        select: { id: true, name: true },
      });
      categories.forEach((c) => labels.set(c.id, c.name));
    } else if (dimension === 'supplier' && keys.length) {
      const suppliers = await this.prisma.supplier.findMany({
        where: { id: { in: keys } },
        select: { id: true, companyName: true },
      });
      suppliers.forEach((s) => labels.set(s.id, s.companyName));
    }

    const rows = [...groups.values()]
      .map((g) => ({
        id: g.key,
        // An unlabelled group is named for what it is rather than dropped: a
        // large pile of uncategorised expiry is itself a finding.
        label:
          labels.get(g.key) ??
          (g.key === 'UNCATEGORISED'
            ? 'Uncategorised'
            : g.key === 'UNKNOWN_SUPPLIER'
              ? 'No supplier recorded'
              : g.key),
        batches: g.batches,
        quantity: g.quantity.toFixed(2),
        value: g.value.toFixed(2),
      }))
      .sort((a, b) => Number(b.value) - Number(a.value));

    const total = rows.reduce((sum, r) => sum + Number(r.value), 0);
    return {
      dimension,
      withinDays,
      totalValue: total.toFixed(2),
      rows: rows.map((r) => ({
        ...r,
        sharePercent: total ? ((Number(r.value) / total) * 100).toFixed(1) : '0.0',
      })),
    };
  }

  /**
   * Smart expiry redistribution (§10). For each at-risk batch position, find
   * branches that consume fast enough to actually use the stock before it
   * expires, and rank the resulting transfer suggestions.
   */
  async redistributionSuggestions(
    user: AuthenticatedUser,
    options: { withinDays?: number; transferLeadTimeDays?: number } = {},
  ) {
    const withinDays = options.withinDays ?? 120;
    const leadTime = options.transferLeadTimeDays ?? 3;
    const expiry = await this.expiryReport(user, { maxDays: withinDays });

    // Average monthly consumption per product per branch over the last 180 days.
    const since = new Date(Date.now() - 180 * 86_400_000);
    const consumption = await this.prisma.inventoryTransaction.groupBy({
      by: ['productId', 'branchId'],
      where: {
        occurredAt: { gte: since },
        type: { in: ['SALE', 'DISPENSING'] },
      },
      _sum: { quantityOut: true },
    });

    const monthlyRate = new Map<string, number>();
    for (const row of consumption) {
      const perMonth = Number(row._sum.quantityOut ?? 0) / 6; // 180 days ~ 6 months
      monthlyRate.set(`${row.productId}:${row.branchId}`, perMonth);
    }

    const branches = await this.prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true },
    });

    const suggestions: any[] = [];
    for (const row of expiry.rows) {
      if (row.batchStatus !== 'AVAILABLE' && row.batchStatus !== 'RELEASED') continue;

      const sourceRate = monthlyRate.get(`${row.productId}:${row.branchId}`) ?? 0;
      const risk = expiryRiskScore({
        quantityOnHand: Number(row.quantity),
        daysToExpiry: row.daysRemaining,
        avgMonthlyConsumption: sourceRate,
        transferLeadTimeDays: leadTime,
      });
      if (risk.riskLevel === 'NONE' || risk.surplusQuantity < 1) continue;

      // Rank candidate destinations by how much of the surplus they can absorb.
      const destinations = branches
        .filter((b) => b.id !== row.branchId)
        .map((b) => {
          const rate = monthlyRate.get(`${row.productId}:${b.id}`) ?? 0;
          const usableDays = Math.max(0, row.daysRemaining - leadTime);
          const canConsume = (rate / 30) * usableDays;
          return {
            branchId: b.id,
            branchName: b.name,
            avgMonthlyConsumption: Math.round(rate),
            canConsumeBeforeExpiry: Math.floor(canConsume),
            suggestedTransferQty: Math.floor(Math.min(canConsume, risk.surplusQuantity)),
          };
        })
        .filter((d) => d.suggestedTransferQty >= 1)
        .sort((a, b) => b.suggestedTransferQty - a.suggestedTransferQty);

      if (!destinations.length) continue;

      suggestions.push({
        productId: row.productId,
        productName: row.productName,
        batchId: row.batchId,
        batchNumber: row.batchNumber,
        expiryDate: row.expiryDate,
        daysRemaining: row.daysRemaining,
        sourceBranchId: row.branchId,
        sourceWarehouseId: row.warehouseId,
        quantityOnHand: Number(row.quantity),
        sourceMonthlyConsumption: Math.round(sourceRate),
        riskScore: risk.score,
        riskLevel: risk.riskLevel,
        surplusQuantity: Math.floor(risk.surplusQuantity),
        valueAtRisk: Number(row.potentialLoss),
        destinations: destinations.slice(0, 3),
      });
    }

    return suggestions.sort((a, b) => b.riskScore - a.riskScore);
  }
}
