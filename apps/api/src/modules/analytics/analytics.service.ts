import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  classifyAbc,
  classifyXyz,
  COMBINED_CLASS_GUIDANCE,
  daysInventoryOutstanding,
  daysUntil,
  expiryRate,
  grossMargin,
  stockTurnover,
} from '@pharmacore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthenticatedUser } from '../../common/decorators';
import { ScopeService } from '../../common/guards/scope.service';
import { CacheService } from '../../common/cache/cache.service';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly cache: CacheService,
  ) {}

  private branchWhere(user: AuthenticatedUser, branchId?: string) {
    if (branchId) return { branchId };
    return this.scope.isUnscoped(user) ? {} : { branchId: { in: user.branchIds } };
  }

  /**
   * Executive dashboard (§36).
   *
   * Cached for 60 seconds per user scope: it reads every balance in the branch,
   * which is far too heavy to recompute on each page load, and a figure a
   * minute old is fine for a dashboard. Stock DECISIONS never read this — they
   * go to the ledger under a lock (§48).
   */
  async dashboard(user: AuthenticatedUser, branchId?: string) {
    return this.cache.wrap(
      `dashboard:${branchId ?? (user.branchIds.join(',') || 'all')}`,
      60,
      () => this.computeDashboard(user, branchId),
    );
  }

  private async computeDashboard(user: AuthenticatedUser, branchId?: string) {
    const where = this.branchWhere(user, branchId);
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const balances = await this.prisma.inventoryBalance.findMany({
      where: { ...where, onHand: { gt: 0 } },
      include: {
        product: { select: { id: true, averageCost: true, reorderLevel: true } },
        batch: { select: { expiryDate: true, status: true } },
      },
    });

    let inventoryValue = 0;
    let nearExpiryValue = 0;
    let nearExpiryCount = 0;
    let expiredCount = 0;
    let quarantinedCount = 0;
    let recalledCount = 0;
    const perProduct = new Map<string, { onHand: number; reorderLevel: number }>();

    for (const b of balances) {
      const qty = Number(b.onHand);
      inventoryValue += qty * Number(b.product.averageCost);

      const agg = perProduct.get(b.productId) ?? {
        onHand: 0,
        reorderLevel: Number(b.product.reorderLevel),
      };
      agg.onHand += qty;
      perProduct.set(b.productId, agg);

      if (b.batch) {
        const days = daysUntil(b.batch.expiryDate, now);
        if (days < 0) expiredCount += 1;
        else if (days <= 90) {
          nearExpiryCount += 1;
          nearExpiryValue += qty * Number(b.product.averageCost);
        }
        if (b.batch.status === 'QUARANTINED') quarantinedCount += 1;
        if (b.batch.status === 'RECALLED') recalledCount += 1;
      }
    }

    const [totalSkus, allProducts, salesToday, salesMonth, pendingPos, openRecalls, openExcursions] =
      await Promise.all([
        this.prisma.product.count({ where: { isActive: true } }),
        this.prisma.product.count({ where: { isActive: true } }),
        this.prisma.sale.aggregate({
          where: { ...where, status: 'COMPLETED', soldAt: { gte: startOfDay } },
          _sum: { grandTotal: true, costTotal: true },
          _count: true,
        }),
        this.prisma.sale.aggregate({
          where: { ...where, status: 'COMPLETED', soldAt: { gte: startOfMonth } },
          _sum: { grandTotal: true, costTotal: true },
          _count: true,
        }),
        this.prisma.purchaseOrder.count({
          where: {
            status: { in: ['SUBMITTED', 'PROCUREMENT_REVIEW', 'FINANCE_REVIEW'] },
            ...(branchId ? { branchId } : {}),
          },
        }),
        this.prisma.recall.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
        this.prisma.temperatureExcursion.count({ where: { disposition: 'PENDING' } }),
      ]);

    const productsWithStock = new Set(perProduct.keys());
    const lowStock = Array.from(perProduct.values()).filter(
      (p) => p.reorderLevel > 0 && p.onHand <= p.reorderLevel,
    ).length;
    const outOfStock = allProducts - productsWithStock.size;

    const revenueMonth = Number(salesMonth._sum.grandTotal ?? 0);
    const cogsMonth = Number(salesMonth._sum.costTotal ?? 0);

    return {
      cards: {
        totalInventoryValue: Math.round(inventoryValue * 100) / 100,
        totalSkus,
        outOfStock,
        lowStock,
        nearExpiry: nearExpiryCount,
        expired: expiredCount,
        quarantined: quarantinedCount,
        recalled: recalledCount,
        purchaseOrdersPending: pendingPos,
        salesToday: Number(salesToday._sum.grandTotal ?? 0),
        salesTodayCount: salesToday._count,
        salesThisMonth: revenueMonth,
        grossProfit: Math.round((revenueMonth - cogsMonth) * 100) / 100,
        grossMarginPct: grossMargin(revenueMonth, cogsMonth),
        expiryValueAtRisk: Math.round(nearExpiryValue * 100) / 100,
        stockTurnover: stockTurnover(cogsMonth * 12, inventoryValue),
        openRecalls,
        openExcursions,
      },
      charts: {
        salesTrend: await this.salesTrend(user, branchId),
        expiryExposure: await this.expiryExposure(user, branchId),
        topMovers: await this.movementRanking(user, 'FAST', branchId),
        slowMovers: await this.movementRanking(user, 'SLOW', branchId),
      },
    };
  }

  /** Daily sales for the last 30 days. */
  private async salesTrend(user: AuthenticatedUser, branchId?: string) {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const sales = await this.prisma.sale.findMany({
      where: {
        ...this.branchWhere(user, branchId),
        status: 'COMPLETED',
        soldAt: { gte: since },
      },
      select: { soldAt: true, grandTotal: true, costTotal: true },
    });

    const byDay = new Map<string, { revenue: number; cost: number; count: number }>();
    for (const s of sales) {
      const key = s.soldAt!.toISOString().slice(0, 10);
      const entry = byDay.get(key) ?? { revenue: 0, cost: 0, count: 0 };
      entry.revenue += Number(s.grandTotal);
      entry.cost += Number(s.costTotal);
      entry.count += 1;
      byDay.set(key, entry);
    }

    return Array.from(byDay.entries())
      .map(([date, v]) => ({ date, ...v, profit: v.revenue - v.cost }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  private async expiryExposure(user: AuthenticatedUser, branchId?: string) {
    const balances = await this.prisma.inventoryBalance.findMany({
      where: { ...this.branchWhere(user, branchId), onHand: { gt: 0 }, batchId: { not: null } },
      include: {
        batch: { select: { expiryDate: true } },
        product: { select: { averageCost: true } },
      },
    });

    const buckets: Record<string, { count: number; value: number }> = {
      EXPIRED: { count: 0, value: 0 },
      DAYS_0_30: { count: 0, value: 0 },
      DAYS_31_60: { count: 0, value: 0 },
      DAYS_61_90: { count: 0, value: 0 },
      DAYS_91_180: { count: 0, value: 0 },
      DAYS_181_365: { count: 0, value: 0 },
      OVER_365: { count: 0, value: 0 },
    };

    for (const b of balances) {
      if (!b.batch) continue;
      const days = daysUntil(b.batch.expiryDate);
      const key =
        days < 0 ? 'EXPIRED'
        : days <= 30 ? 'DAYS_0_30'
        : days <= 60 ? 'DAYS_31_60'
        : days <= 90 ? 'DAYS_61_90'
        : days <= 180 ? 'DAYS_91_180'
        : days <= 365 ? 'DAYS_181_365'
        : 'OVER_365';
      buckets[key].count += 1;
      buckets[key].value += Number(b.onHand) * Number(b.product.averageCost);
    }

    return Object.entries(buckets).map(([bucket, v]) => ({
      bucket,
      count: v.count,
      value: Math.round(v.value * 100) / 100,
    }));
  }

  private async movementRanking(
    user: AuthenticatedUser,
    direction: 'FAST' | 'SLOW',
    branchId?: string,
    limit = 10,
  ) {
    const since = new Date(Date.now() - 90 * 86_400_000);
    const grouped = await this.prisma.inventoryTransaction.groupBy({
      by: ['productId'],
      where: {
        occurredAt: { gte: since },
        type: { in: ['SALE', 'DISPENSING'] },
        ...(branchId ? { branchId } : {}),
      },
      _sum: { quantityOut: true },
      orderBy: { _sum: { quantityOut: direction === 'FAST' ? 'desc' : 'asc' } },
      take: limit,
    });

    const products = await this.prisma.product.findMany({
      where: { id: { in: grouped.map((g) => g.productId) } },
      select: { id: true, sku: true, genericName: true, brandName: true, baseUnit: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    return grouped.map((g) => ({
      productId: g.productId,
      sku: byId.get(g.productId)?.sku,
      name: byId.get(g.productId)?.genericName,
      brand: byId.get(g.productId)?.brandName,
      unit: byId.get(g.productId)?.baseUnit,
      quantityMoved: Number(g._sum.quantityOut ?? 0),
    }));
  }

  /**
   * Inventory Command Center (§71). Each row carries severity, financial
   * impact and the recommended next action.
   */
  async commandCenter(user: AuthenticatedUser, branchId?: string) {
    const where = this.branchWhere(user, branchId);

    const [balances, recalls, excursions, pendingApprovals, quarantined, latePos] =
      await Promise.all([
        this.prisma.inventoryBalance.findMany({
          where,
          include: {
            product: {
              select: {
                id: true,
                sku: true,
                genericName: true,
                reorderLevel: true,
                averageCost: true,
              },
            },
            batch: { select: { expiryDate: true, status: true, batchNumber: true } },
            warehouse: { select: { name: true } },
          },
        }),
        this.prisma.recall.findMany({
          where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
          include: { tasks: { where: { status: 'PENDING' } }, batches: true },
        }),
        this.prisma.temperatureExcursion.findMany({
          where: { disposition: 'PENDING' },
          include: { sensor: { select: { name: true, warehouseId: true } } },
        }),
        this.prisma.purchaseOrder.findMany({
          where: {
            status: { in: ['SUBMITTED', 'PROCUREMENT_REVIEW', 'FINANCE_REVIEW'] },
            ...(branchId ? { branchId } : {}),
          },
          select: { id: true, poNo: true, grandTotal: true, status: true, createdAt: true },
        }),
        this.prisma.batch.findMany({
          where: { status: 'QUARANTINED' },
          include: {
            product: { select: { genericName: true, averageCost: true } },
            balances: { select: { onHand: true } },
          },
        }),
        this.prisma.purchaseOrder.findMany({
          where: {
            status: { in: ['ORDERED', 'PARTIALLY_RECEIVED'] },
            expectedDate: { lt: new Date() },
            ...(branchId ? { branchId } : {}),
          },
          include: { supplier: { select: { companyName: true } } },
        }),
      ]);

    // Critical stockouts and expiry risks derived from live balances.
    const stockByProduct = new Map<string, { onHand: number; product: any }>();
    const expiryRisks: any[] = [];

    for (const b of balances) {
      const entry = stockByProduct.get(b.productId) ?? { onHand: 0, product: b.product };
      entry.onHand += Number(b.onHand);
      stockByProduct.set(b.productId, entry);

      if (b.batch && Number(b.onHand) > 0) {
        const days = daysUntil(b.batch.expiryDate);
        if (days <= 90) {
          expiryRisks.push({
            severity: days < 0 ? 'CRITICAL' : days <= 30 ? 'HIGH' : 'MEDIUM',
            product: b.product.genericName,
            sku: b.product.sku,
            batch: b.batch.batchNumber,
            daysRemaining: days,
            quantity: Number(b.onHand),
            warehouse: b.warehouse.name,
            financialImpact: Number(b.onHand) * Number(b.product.averageCost),
            recommendedAction:
              days < 0 ? 'Quarantine and schedule disposal'
              : days <= 30 ? 'Transfer to a high-consumption branch or return to supplier'
              : 'Promote or plan redistribution',
          });
        }
      }
    }

    const criticalStockouts = Array.from(stockByProduct.values())
      .filter((s) => s.product.reorderLevel > 0 && s.onHand <= Number(s.product.reorderLevel))
      .map((s) => ({
        severity: s.onHand <= 0 ? 'CRITICAL' : 'HIGH',
        product: s.product.genericName,
        sku: s.product.sku,
        onHand: s.onHand,
        reorderLevel: Number(s.product.reorderLevel),
        financialImpact: 0,
        recommendedAction: s.onHand <= 0 ? 'Raise an urgent purchase request' : 'Reorder now',
      }))
      .sort((a, b) => a.onHand - b.onHand);

    return {
      criticalStockouts: criticalStockouts.slice(0, 25),
      expiryRisks: expiryRisks.sort((a, b) => a.daysRemaining - b.daysRemaining).slice(0, 25),
      coldChainAlerts: excursions.map((e) => ({
        severity: 'CRITICAL',
        excursionId: e.id,
        excursionNo: e.excursionNo,
        sensor: e.sensor.name,
        durationMinutes: e.durationMinutes,
        range: `${e.minTempC.toString()}C to ${e.maxTempC.toString()}C`,
        affectedBatches: e.affectedBatchIds.length,
        affectedQuantity: Number(e.affectedQuantity),
        recommendedAction: 'QA must investigate and record a disposition',
      })),
      recalls: recalls.map((r) => ({
        severity: r.severity === 'CLASS_I' ? 'CRITICAL' : 'HIGH',
        recallId: r.id,
        recallNo: r.recallNo,
        reason: r.reason,
        pendingTasks: r.tasks.length,
        affectedBatches: r.batches.length,
        recommendedAction: `Complete ${r.tasks.length} outstanding recall task(s)`,
      })),
      quarantinedInventory: quarantined.map((b) => {
        const qty = b.balances.reduce((s, x) => s + Number(x.onHand), 0);
        return {
          severity: 'MEDIUM',
          batchId: b.id,
          batch: b.batchNumber,
          product: b.product.genericName,
          reason: b.quarantineReason,
          quantity: qty,
          financialImpact: qty * Number(b.product.averageCost),
          recommendedAction: 'QA review: release, return or dispose',
        };
      }),
      pendingApprovals: pendingApprovals.map((po) => ({
        severity: 'MEDIUM',
        documentType: 'PURCHASE_ORDER',
        documentId: po.id,
        reference: po.poNo,
        status: po.status,
        financialImpact: Number(po.grandTotal),
        waitingDays: Math.floor((Date.now() - po.createdAt.getTime()) / 86_400_000),
        recommendedAction: 'Review and approve or reject',
      })),
      supplierDelays: latePos.map((po) => ({
        severity: 'MEDIUM',
        poNo: po.poNo,
        supplier: po.supplier.companyName,
        expectedDate: po.expectedDate,
        daysLate: po.expectedDate
          ? Math.floor((Date.now() - po.expectedDate.getTime()) / 86_400_000)
          : 0,
        financialImpact: Number(po.grandTotal),
        recommendedAction: 'Chase the supplier and update the expected date',
      })),
    };
  }

  /** ABC / XYZ classification (§37). Cached for 10 minutes: a year of
   * movements is expensive to scan and the classification barely moves. */
  async abcXyz(user: AuthenticatedUser, months = 12) {
    return this.cache.wrap(
      `abcxyz:${user.branchIds.join(',') || 'all'}:${months}`,
      600,
      () => this.computeAbcXyz(user, months),
    );
  }

  private async computeAbcXyz(user: AuthenticatedUser, months = 12) {
    const since = new Date(Date.now() - months * 30 * 86_400_000);

    const movements = await this.prisma.inventoryTransaction.findMany({
      where: { occurredAt: { gte: since }, type: { in: ['SALE', 'DISPENSING'] } },
      select: { productId: true, quantityOut: true, occurredAt: true },
    });

    const products = await this.prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, sku: true, genericName: true, brandName: true, averageCost: true },
    });
    const costById = new Map(products.map((p) => [p.id, Number(p.averageCost)]));

    // Monthly series per product, for the XYZ variability measure.
    const series = new Map<string, number[]>();
    const totals = new Map<string, number>();

    for (const m of movements) {
      const monthIndex = Math.floor(
        (m.occurredAt.getTime() - since.getTime()) / (30 * 86_400_000),
      );
      const arr = series.get(m.productId) ?? new Array(months).fill(0);
      if (monthIndex >= 0 && monthIndex < months) arr[monthIndex] += Number(m.quantityOut);
      series.set(m.productId, arr);
      totals.set(m.productId, (totals.get(m.productId) ?? 0) + Number(m.quantityOut));
    }

    const abcInput = products.map((p) => ({
      productId: p.id,
      annualConsumptionValue: (totals.get(p.id) ?? 0) * (costById.get(p.id) ?? 0),
    }));
    const abc = classifyAbc(abcInput);
    const abcById = new Map(abc.map((a) => [a.productId, a]));

    return products
      .map((p) => {
        const a = abcById.get(p.id);
        const xyz = classifyXyz(series.get(p.id) ?? []);
        const combined = `${a?.abcClass ?? 'C'}${xyz.xyzClass}` as keyof typeof COMBINED_CLASS_GUIDANCE;
        return {
          productId: p.id,
          sku: p.sku,
          name: p.genericName,
          brand: p.brandName,
          annualConsumptionValue: Math.round((a?.annualConsumptionValue ?? 0) * 100) / 100,
          sharePct: a?.sharePct ?? 0,
          abcClass: a?.abcClass ?? 'C',
          xyzClass: xyz.xyzClass,
          coefficientOfVariation: xyz.coefficientOfVariation,
          combinedClass: combined,
          guidance: COMBINED_CLASS_GUIDANCE[combined],
        };
      })
      .sort((a, b) => b.annualConsumptionValue - a.annualConsumptionValue);
  }

  /** Dead stock detection (§38). */
  async deadStock(user: AuthenticatedUser, days = 180) {
    const cutoff = new Date(Date.now() - days * 86_400_000);

    const balances = await this.prisma.inventoryBalance.findMany({
      where: {
        ...this.branchWhere(user),
        onHand: { gt: 0 },
        OR: [{ lastMovementAt: { lt: cutoff } }, { lastMovementAt: null }],
      },
      include: {
        product: { select: { sku: true, genericName: true, brandName: true, averageCost: true } },
        batch: { select: { batchNumber: true, expiryDate: true } },
        warehouse: { select: { name: true } },
      },
    });

    // Confirm there really has been no outbound movement in the window.
    const recentlyMoved = await this.prisma.inventoryTransaction.groupBy({
      by: ['productId'],
      where: { occurredAt: { gte: cutoff }, type: { in: ['SALE', 'DISPENSING'] } },
      _sum: { quantityOut: true },
    });
    const movedIds = new Set(recentlyMoved.filter((r) => Number(r._sum.quantityOut) > 0).map((r) => r.productId));

    return balances
      .filter((b) => !movedIds.has(b.productId))
      .map((b) => ({
        productId: b.productId,
        sku: b.product.sku,
        name: b.product.genericName,
        brand: b.product.brandName,
        batch: b.batch?.batchNumber ?? null,
        expiryDate: b.batch?.expiryDate ?? null,
        quantity: Number(b.onHand),
        value: Math.round(Number(b.onHand) * Number(b.product.averageCost) * 100) / 100,
        lastMovementAt: b.lastMovementAt,
        warehouse: b.warehouse.name,
        recommendedAction: b.batch && daysUntil(b.batch.expiryDate) < 180
          ? 'Redistribute or return before it expires'
          : 'Review for delisting or promotion',
      }))
      .sort((a, b) => b.value - a.value);
  }

  /** Inventory KPI set (§40). */
  async kpis(user: AuthenticatedUser, branchId?: string, periodDays = 365) {
    const since = new Date(Date.now() - periodDays * 86_400_000);
    const where = this.branchWhere(user, branchId);

    const [sales, balances, expiredValue, purchasedValue, counts, adjustments] = await Promise.all([
      this.prisma.sale.aggregate({
        where: { ...where, status: 'COMPLETED', soldAt: { gte: since } },
        _sum: { grandTotal: true, costTotal: true },
      }),
      this.prisma.inventoryBalance.findMany({
        where,
        include: { product: { select: { averageCost: true } } },
      }),
      this.prisma.inventoryTransaction.aggregate({
        where: { ...where, type: { in: ['EXPIRY', 'DISPOSAL'] }, occurredAt: { gte: since } },
        _sum: { quantityOut: true },
      }),
      this.prisma.inventoryTransaction.aggregate({
        where: { ...where, type: 'PURCHASE_RECEIPT', occurredAt: { gte: since } },
        _sum: { quantityIn: true },
      }),
      this.prisma.stockCountItem.findMany({
        where: { stockCount: { ...(branchId ? { branchId } : {}) } },
        select: { varianceQty: true },
      }),
      this.prisma.inventoryTransaction.aggregate({
        where: { ...where, type: 'ADJUSTMENT', occurredAt: { gte: since } },
        _sum: { quantityOut: true },
      }),
    ]);

    const inventoryValue = balances.reduce(
      (sum, b) => sum + Number(b.onHand) * Number(b.product.averageCost),
      0,
    );
    const revenue = Number(sales._sum.grandTotal ?? 0);
    const cogs = Number(sales._sum.costTotal ?? 0);
    const turnover = stockTurnover(cogs, inventoryValue);

    const matchedLines = counts.filter((c) => Number(c.varianceQty) === 0).length;

    return {
      periodDays,
      inventoryValue: Math.round(inventoryValue * 100) / 100,
      stockTurnover: turnover,
      daysInventoryOutstanding: daysInventoryOutstanding(turnover, periodDays),
      grossMarginPct: grossMargin(revenue, cogs),
      revenue,
      cogs,
      expiryRatePct: expiryRate(
        Number(expiredValue._sum.quantityOut ?? 0),
        Number(purchasedValue._sum.quantityIn ?? 0),
      ),
      inventoryAccuracyPct: counts.length
        ? Math.round((matchedLines / counts.length) * 10000) / 100
        : null,
      shrinkageUnits: Number(adjustments._sum.quantityOut ?? 0),
      countLinesChecked: counts.length,
    };
  }
}
