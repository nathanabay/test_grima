import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { ConfigService } from '../../common/config/config.service';
import { ScopeService } from '../../common/guards/scope.service';
import { AuthenticatedUser } from '../../common/decorators';

export interface HealthFactor {
  key: string;
  label: string;
  /** 0-100, where 100 is healthy. */
  score: number;
  weight: number;
  /** The measurement behind the score, in words. */
  measurement: string;
  /** What to do about it, when there is something to do. */
  recommendation: string | null;
  /** Where to go to act on it. */
  linkUrl: string;
}

export type HealthBand = 'EXCELLENT' | 'GOOD' | 'ATTENTION_REQUIRED' | 'HIGH_RISK' | 'CRITICAL';

/**
 * Inventory health score (§11).
 *
 * Ten weighted factors reduced to one number between 0 and 100. The number on
 * its own is close to useless, so every factor reports the measurement behind
 * it and what would improve it — a score that cannot be explained cannot be
 * acted on, and would invite the wrong action.
 *
 * A factor with nothing to measure scores null-neutral rather than zero: a
 * pharmacy that has never run a stock count should not be told its accuracy is
 * catastrophic, it should be told it is unknown.
 */
@Injectable()
export class HealthScoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly config: ConfigService,
    private readonly scope: ScopeService,
  ) {}

  private band(score: number): HealthBand {
    if (score >= 90) return 'EXCELLENT';
    if (score >= 75) return 'GOOD';
    if (score >= 60) return 'ATTENTION_REQUIRED';
    if (score >= 40) return 'HIGH_RISK';
    return 'CRITICAL';
  }

  async score(user: AuthenticatedUser, branchId?: string) {
    const key = `health:${branchId ?? 'all'}:${user.branchIds.join(',')}`;
    return this.cache.wrap(key, 300, () => this.compute(user, branchId));
  }

  private async compute(user: AuthenticatedUser, branchId?: string) {
    const branchFilter = branchId
      ? { branchId }
      : (this.scope.branchFilter(user) as { branchId?: { in: string[] } });

    const now = new Date();
    const [
      availability,
      expiry,
      deadStock,
      excess,
      accuracy,
      supplier,
      turnover,
      coldChain,
      forecast,
      stockouts,
    ] = await Promise.all([
      this.availabilityFactor(branchFilter),
      this.expiryFactor(branchFilter, now),
      this.deadStockFactor(branchFilter),
      this.excessStockFactor(branchFilter),
      this.accuracyFactor(),
      this.supplierFactor(),
      this.turnoverFactor(branchFilter),
      this.coldChainFactor(),
      this.forecastFactor(),
      this.stockoutFactor(branchFilter),
    ]);

    const factors = [
      availability,
      expiry,
      deadStock,
      excess,
      stockouts,
      accuracy,
      forecast,
      supplier,
      turnover,
      coldChain,
    ];

    // Only factors with something to measure contribute, so an unmeasurable
    // dimension neither flatters nor damns the score.
    const measured = factors.filter((f) => f.score >= 0);
    const totalWeight = measured.reduce((sum, f) => sum + f.weight, 0);
    const overall =
      totalWeight > 0
        ? Math.round(measured.reduce((sum, f) => sum + f.score * f.weight, 0) / totalWeight)
        : 0;

    const worst = [...measured].sort((a, b) => a.score - b.score).slice(0, 3);

    return {
      score: overall,
      band: this.band(overall),
      computedAt: now.toISOString(),
      branchId: branchId ?? null,
      factors,
      unmeasured: factors.filter((f) => f.score < 0).map((f) => f.key),
      // Stated plainly: the three things dragging the number down, and what to
      // do about each.
      summary:
        worst.length && worst[0].score < 90
          ? `Held back by ${worst
              .filter((w) => w.score < 90)
              .map((w) => `${w.label.toLowerCase()} (${w.score}/100)`)
              .join(', ')}.`
          : 'No factor is materially below target.',
      priorityActions: worst
        .filter((w) => w.recommendation && w.score < 80)
        .map((w) => ({ factor: w.label, action: w.recommendation, linkUrl: w.linkUrl })),
    };
  }

  private async availabilityFactor(branchFilter: object): Promise<HealthFactor> {
    const grouped = await this.prisma.inventoryBalance.groupBy({
      by: ['productId'],
      where: { ...branchFilter, batch: { status: { in: ['AVAILABLE', 'RELEASED'] } } },
      _sum: { onHand: true, reserved: true },
    });

    const active = await this.prisma.product.count({ where: { isActive: true } });
    if (!active) {
      return this.unmeasured('availability', 'Stock availability', 12, 'No active products', '/products');
    }

    const inStock = grouped.filter(
      (g) => Number(g._sum.onHand ?? 0) - Number(g._sum.reserved ?? 0) > 0,
    ).length;
    const percent = Math.round((inStock / active) * 100);

    return {
      key: 'availability',
      label: 'Stock availability',
      score: percent,
      weight: 12,
      measurement: `${inStock} of ${active} active products have sellable stock (${percent}%)`,
      recommendation:
        percent < 90
          ? `${active - inStock} product(s) have nothing sellable on the shelf. Review the replenishment list.`
          : null,
      linkUrl: '/inventory',
    };
  }

  private async expiryFactor(branchFilter: object, now: Date): Promise<HealthFactor> {
    const horizon = await this.config.getNumber('expiry.warningDays');
    const cutoff = new Date(now.getTime() + horizon * 86_400_000);

    const balances = await this.prisma.inventoryBalance.findMany({
      where: { ...branchFilter, onHand: { gt: 0 }, batchId: { not: null } },
      select: {
        onHand: true,
        batch: { select: { expiryDate: true } },
        product: { select: { averageCost: true } },
      },
    });

    if (!balances.length) {
      return this.unmeasured('expiry', 'Expiry risk', 15, 'No stock on hand', '/inventory/expiry');
    }

    let total = new Prisma.Decimal(0);
    let atRisk = new Prisma.Decimal(0);
    for (const b of balances) {
      const value = b.onHand.times(b.product.averageCost);
      total = total.plus(value);
      if (b.batch && b.batch.expiryDate <= cutoff) atRisk = atRisk.plus(value);
    }

    const percentAtRisk = total.greaterThan(0)
      ? Number(atRisk.dividedBy(total).times(100).toDecimalPlaces(1))
      : 0;
    // 10% of value within the warning horizon is treated as the point where
    // the score reaches zero; a pharmacy always carries some near-dated stock.
    const score = Math.max(0, Math.round(100 - percentAtRisk * 10));

    return {
      key: 'expiry',
      label: 'Expiry risk',
      score,
      weight: 15,
      measurement: `${atRisk.toDecimalPlaces(0).toString()} of ${total.toDecimalPlaces(0).toString()} in stock value expires within ${horizon} days (${percentAtRisk}%)`,
      recommendation:
        percentAtRisk > 3
          ? 'Redistribute or promote the near-dated stock before it has to be written off.'
          : null,
      linkUrl: '/inventory/expiry',
    };
  }

  private async deadStockFactor(branchFilter: object): Promise<HealthFactor> {
    const days = await this.config.getNumber('replenishment.deadStockDays');
    const cutoff = new Date(Date.now() - days * 86_400_000);

    const balances = await this.prisma.inventoryBalance.findMany({
      where: { ...branchFilter, onHand: { gt: 0 } },
      select: { onHand: true, lastMovementAt: true, product: { select: { averageCost: true } } },
    });

    if (!balances.length) {
      return this.unmeasured('deadStock', 'Dead stock', 10, 'No stock on hand', '/reports');
    }

    let total = new Prisma.Decimal(0);
    let dead = new Prisma.Decimal(0);
    for (const b of balances) {
      const value = b.onHand.times(b.product.averageCost);
      total = total.plus(value);
      if (!b.lastMovementAt || b.lastMovementAt < cutoff) dead = dead.plus(value);
    }

    const percent = total.greaterThan(0)
      ? Number(dead.dividedBy(total).times(100).toDecimalPlaces(1))
      : 0;
    const score = Math.max(0, Math.round(100 - percent * 4));

    return {
      key: 'deadStock',
      label: 'Dead stock',
      score,
      weight: 10,
      measurement: `${percent}% of stock value has not moved in ${days} days`,
      recommendation:
        percent > 10
          ? 'Review the dead-stock list: return, redistribute or discontinue what is not selling.'
          : null,
      linkUrl: '/reports',
    };
  }

  private async excessStockFactor(branchFilter: object): Promise<HealthFactor> {
    const grouped = await this.prisma.inventoryBalance.groupBy({
      by: ['productId'],
      where: { ...branchFilter, onHand: { gt: 0 } },
      _sum: { onHand: true },
    });
    if (!grouped.length) {
      return this.unmeasured('excess', 'Excess stock', 8, 'No stock on hand', '/inventory');
    }

    const products = await this.prisma.product.findMany({
      where: { id: { in: grouped.map((g) => g.productId) }, maximumStock: { gt: 0 } },
      select: { id: true, maximumStock: true },
    });
    if (!products.length) {
      return this.unmeasured(
        'excess',
        'Excess stock',
        8,
        'No product has a maximum stock level set',
        '/products',
      );
    }

    const byProduct = new Map(grouped.map((g) => [g.productId, Number(g._sum.onHand ?? 0)]));
    const over = products.filter((p) => (byProduct.get(p.id) ?? 0) > Number(p.maximumStock)).length;
    const percent = Math.round((over / products.length) * 100);

    return {
      key: 'excess',
      label: 'Excess stock',
      score: Math.max(0, 100 - percent * 3),
      weight: 8,
      measurement: `${over} of ${products.length} products with a maximum level are above it (${percent}%)`,
      recommendation:
        percent > 10 ? 'Hold off reordering the overstocked lines and redistribute where useful.' : null,
      linkUrl: '/inventory',
    };
  }

  private async stockoutFactor(branchFilter: object): Promise<HealthFactor> {
    const grouped = await this.prisma.inventoryBalance.groupBy({
      by: ['productId'],
      where: { ...branchFilter, batch: { status: { in: ['AVAILABLE', 'RELEASED'] } } },
      _sum: { onHand: true, reserved: true },
    });

    const tracked = await this.prisma.product.count({
      where: { isActive: true, reorderLevel: { gt: 0 } },
    });
    if (!tracked) {
      return this.unmeasured(
        'stockouts',
        'Stockouts',
        12,
        'No product has a reorder point set',
        '/products',
      );
    }

    const withStock = new Set(
      grouped
        .filter((g) => Number(g._sum.onHand ?? 0) - Number(g._sum.reserved ?? 0) > 0)
        .map((g) => g.productId),
    );
    const trackedProducts = await this.prisma.product.findMany({
      where: { isActive: true, reorderLevel: { gt: 0 } },
      select: { id: true },
    });
    const out = trackedProducts.filter((p) => !withStock.has(p.id)).length;
    const percent = Math.round((out / tracked) * 100);

    return {
      key: 'stockouts',
      label: 'Stockouts',
      score: Math.max(0, 100 - percent * 5),
      weight: 12,
      measurement: `${out} of ${tracked} planned products are out of stock (${percent}%)`,
      recommendation: out > 0 ? `Raise purchase orders for the ${out} product(s) out of stock.` : null,
      linkUrl: '/procurement',
    };
  }

  private async accuracyFactor(): Promise<HealthFactor> {
    const counts = await this.prisma.stockCountItem.findMany({
      where: { countedQty: { not: null }, stockCount: { status: 'APPROVED' } },
      select: { systemQty: true, varianceQty: true },
      take: 5000,
    });

    if (!counts.length) {
      // Unknown, not bad. A pharmacy that has never counted should be told so.
      return this.unmeasured(
        'accuracy',
        'Inventory accuracy',
        13,
        'No stock count has been approved yet, so accuracy is unknown',
        '/counts',
      );
    }

    const accurate = counts.filter((c) => Number(c.varianceQty) === 0).length;
    const percent = Math.round((accurate / counts.length) * 100);

    return {
      key: 'accuracy',
      label: 'Inventory accuracy',
      score: percent,
      weight: 13,
      measurement: `${accurate} of ${counts.length} counted lines matched the system exactly (${percent}%)`,
      recommendation:
        percent < 95 ? 'Investigate the recurring variances before they compound.' : null,
      linkUrl: '/counts',
    };
  }

  private async forecastFactor(): Promise<HealthFactor> {
    // Forecast accuracy needs a forecast-versus-actual history. Until one
    // exists this is reported as unmeasured rather than assumed.
    const movements = await this.prisma.inventoryTransaction.count({
      where: {
        type: { in: ['SALE', 'DISPENSING'] },
        occurredAt: { gte: new Date(Date.now() - 90 * 86_400_000) },
      },
    });

    if (movements < 100) {
      return this.unmeasured(
        'forecast',
        'Forecast reliability',
        8,
        `Only ${movements} issue movements in 90 days: too little history to forecast against`,
        '/forecast',
      );
    }

    // With enough history the forecast is usable; how well it performed is
    // reported by the forecast-versus-actual report rather than guessed here.
    return {
      key: 'forecast',
      label: 'Forecast reliability',
      score: 80,
      weight: 8,
      measurement: `${movements} issue movements in the last 90 days give the forecast enough history`,
      recommendation: 'Check the forecast-versus-actual report for per-product accuracy.',
      linkUrl: '/forecast',
    };
  }

  private async supplierFactor(): Promise<HealthFactor> {
    const suppliers = await this.prisma.supplier.findMany({
      where: { isActive: true },
      select: { onTimeDeliveryRate: true, supplierScore: true },
    });

    const scored = suppliers.filter((s) => Number(s.supplierScore) > 0);
    if (!scored.length) {
      return this.unmeasured(
        'supplier',
        'Supplier reliability',
        10,
        'No supplier has been scored yet',
        '/suppliers',
      );
    }

    const average = scored.reduce((sum, s) => sum + Number(s.supplierScore), 0) / scored.length;
    return {
      key: 'supplier',
      label: 'Supplier reliability',
      score: Math.round(Math.min(100, average)),
      weight: 10,
      measurement: `Average supplier score ${average.toFixed(1)}/100 across ${scored.length} scored supplier(s)`,
      recommendation:
        average < 75 ? 'Review the weakest suppliers and qualify an alternative.' : null,
      linkUrl: '/suppliers',
    };
  }

  private async turnoverFactor(branchFilter: object): Promise<HealthFactor> {
    const since = new Date(Date.now() - 365 * 86_400_000);
    const [issued, held] = await Promise.all([
      this.prisma.inventoryTransaction.aggregate({
        where: { ...branchFilter, type: { in: ['SALE', 'DISPENSING'] }, occurredAt: { gte: since } },
        _sum: { quantityOut: true },
      }),
      this.prisma.inventoryBalance.aggregate({
        where: { ...branchFilter, onHand: { gt: 0 } },
        _sum: { onHand: true },
      }),
    ]);

    const outQty = Number(issued._sum.quantityOut ?? 0);
    const onHand = Number(held._sum.onHand ?? 0);

    if (onHand <= 0 || outQty <= 0) {
      return this.unmeasured(
        'turnover',
        'Stock turnover',
        7,
        'Not enough movement to compute turnover',
        '/reports',
      );
    }

    const turns = outQty / onHand;
    // Four turns a year is a reasonable target for a community pharmacy; the
    // score is that target expressed as a percentage, capped.
    const score = Math.round(Math.min(100, (turns / 4) * 100));

    return {
      key: 'turnover',
      label: 'Stock turnover',
      score,
      weight: 7,
      measurement: `${turns.toFixed(2)} turns a year against a working target of 4`,
      recommendation: turns < 2 ? 'Stock is turning slowly; review order quantities.' : null,
      linkUrl: '/reports',
    };
  }

  private async coldChainFactor(): Promise<HealthFactor> {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [sensors, excursions, unresolved] = await Promise.all([
      this.prisma.temperatureSensor.count({ where: { isActive: true } }),
      this.prisma.temperatureExcursion.count({ where: { startedAt: { gte: since } } }),
      this.prisma.temperatureExcursion.count({ where: { disposition: 'PENDING' } }),
    ]);

    if (!sensors) {
      return this.unmeasured(
        'coldChain',
        'Cold-chain compliance',
        5,
        'No temperature sensors are registered',
        '/cold-chain',
      );
    }

    // Each excursion in the month costs 10 points, each still awaiting a QA
    // decision costs 15 — an unresolved excursion is worse than a closed one.
    const score = Math.max(0, 100 - excursions * 10 - unresolved * 15);

    return {
      key: 'coldChain',
      label: 'Cold-chain compliance',
      score,
      weight: 5,
      measurement: `${excursions} excursion(s) in 30 days across ${sensors} sensor(s), ${unresolved} still awaiting a QA decision`,
      recommendation:
        unresolved > 0
          ? `${unresolved} excursion(s) have no QA disposition; the affected stock stays unsellable until they do.`
          : excursions > 2
            ? 'Repeated excursions suggest an equipment problem rather than an incident.'
            : null,
      linkUrl: '/cold-chain',
    };
  }

  /** A factor with nothing to measure: excluded from the score, not scored zero. */
  private unmeasured(
    key: string,
    label: string,
    weight: number,
    measurement: string,
    linkUrl: string,
  ): HealthFactor {
    return {
      key,
      label,
      score: -1,
      weight,
      measurement,
      recommendation: null,
      linkUrl,
    };
  }
}
