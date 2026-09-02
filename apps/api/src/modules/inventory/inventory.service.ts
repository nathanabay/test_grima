import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
