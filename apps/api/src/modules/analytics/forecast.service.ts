import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ForecastResult,
  calculateReplenishment,
  coefficientOfVariation,
  exponentialSmoothing,
  movingAverage,
  seasonalNaive,
  weightedMovingAverage,
} from '@pharmacore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthenticatedUser } from '../../common/decorators';
import { ScopeService } from '../../common/guards/scope.service';
import { ConfigService } from '../../common/config/config.service';

export type ForecastMethod =
  | 'MOVING_AVERAGE'
  | 'WEIGHTED_MOVING_AVERAGE'
  | 'EXPONENTIAL_SMOOTHING'
  | 'SEASONAL_NAIVE'
  | 'AUTO';

export interface ForecastRequest {
  productId: string;
  branchId?: string;
  method?: ForecastMethod;
  /** Months of history to read. */
  months?: number;
  /** Periods to project forward. */
  horizon?: number;
}

/**
 * Demand forecasting (§39).
 *
 * Every forecast returns its own history, method, confidence band and the
 * arithmetic behind the reorder suggestion — §39 forbids hiding the logic
 * behind a replenishment recommendation. Stock-out periods are flagged rather
 * than treated as genuine zero demand, because a month with no stock is not a
 * month with no demand and averaging it in understates future need.
 */
@Injectable()
export class ForecastService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly config: ConfigService,
  ) {}

  /** Monthly outbound quantity, oldest first, with stock-out months marked. */
  private async monthlySeries(
    productId: string,
    months: number,
    branchId?: string,
    user?: AuthenticatedUser,
  ): Promise<{ series: number[]; labels: string[]; stockOutMonths: number[] }> {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);

    const movements = await this.prisma.inventoryTransaction.findMany({
      where: {
        productId,
        occurredAt: { gte: start },
        type: { in: ['SALE', 'DISPENSING'] },
        ...(branchId
          ? { branchId }
          : user && !this.scope.isUnscoped(user)
            ? { branchId: { in: user.branchIds } }
            : {}),
      },
      select: { occurredAt: true, quantityOut: true },
    });

    const series = new Array(months).fill(0);
    const labels: string[] = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      labels.push(d.toISOString().slice(0, 7));
    }

    for (const m of movements) {
      const index =
        (m.occurredAt.getFullYear() - start.getFullYear()) * 12 +
        (m.occurredAt.getMonth() - start.getMonth());
      if (index >= 0 && index < months) series[index] += Number(m.quantityOut);
    }

    // A month that ended with no stock cannot show true demand.
    const stockOuts = await this.prisma.inventoryTransaction.findMany({
      where: {
        productId,
        occurredAt: { gte: start },
        balanceAfter: { lte: 0 },
        ...(branchId ? { branchId } : {}),
      },
      select: { occurredAt: true },
    });
    const stockOutMonths = Array.from(
      new Set(
        stockOuts
          .map(
            (s) =>
              (s.occurredAt.getFullYear() - start.getFullYear()) * 12 +
              (s.occurredAt.getMonth() - start.getMonth()),
          )
          .filter((i) => i >= 0 && i < months),
      ),
    ).sort((a, b) => a - b);

    return { series, labels, stockOutMonths };
  }

  private runMethod(method: Exclude<ForecastMethod, 'AUTO'>, series: number[]): ForecastResult {
    switch (method) {
      case 'WEIGHTED_MOVING_AVERAGE':
        return weightedMovingAverage(series, 3);
      case 'EXPONENTIAL_SMOOTHING':
        return exponentialSmoothing(series, 0.3);
      case 'SEASONAL_NAIVE':
        return seasonalNaive(series, 12);
      default:
        return movingAverage(series, 3);
    }
  }

  /**
   * Pick a method from the shape of the data rather than making the user guess:
   * steady demand suits a moving average, drifting demand suits smoothing, and
   * a full year of history with strong month-to-month swing suits a seasonal
   * comparison.
   */
  private chooseMethod(series: number[]): {
    method: Exclude<ForecastMethod, 'AUTO'>;
    rationale: string;
  } {
    const nonZero = series.filter((v) => v > 0);
    if (nonZero.length < 3) {
      return {
        method: 'MOVING_AVERAGE',
        rationale: 'Too little history for anything more elaborate; a simple average is honest here.',
      };
    }

    const cv = coefficientOfVariation(series);

    // Seasonal comparison needs a real value at the same month last year.
    // Requesting a 12-month window does NOT mean twelve months of trading
    // happened — on a young dataset the seasonal lag is zero, and using it
    // would forecast zero demand for a product that is selling steadily.
    const seasonalLag = series.length >= 13 ? series[series.length - 13] : undefined;
    const hasUsableSeason =
      seasonalLag !== undefined && seasonalLag > 0 && nonZero.length >= 12;

    if (hasUsableSeason && cv > 0.5) {
      return {
        method: 'SEASONAL_NAIVE',
        rationale: `A full year of trading with variable demand (CV ${cv.toFixed(2)}), so the same month last year is the better guide.`,
      };
    }
    if (cv > 0.35) {
      return {
        method: 'EXPONENTIAL_SMOOTHING',
        rationale: `Demand is drifting (CV ${cv.toFixed(2)}), so recent periods are weighted more heavily.`,
      };
    }
    return {
      method: 'MOVING_AVERAGE',
      rationale: `Demand is stable (CV ${cv.toFixed(2)}), so a moving average is sufficient.`,
    };
  }

  async forecast(request: ForecastRequest, user: AuthenticatedUser) {
    const months = Math.min(Math.max(request.months ?? 12, 3), 36);
    // A caller may ask for a specific horizon; otherwise the configured one.
    const configuredHorizon = Math.max(
      1,
      Math.round((await this.config.getNumber('replenishment.forecastHorizonDays')) / 30),
    );
    const horizon = Math.min(Math.max(request.horizon ?? configuredHorizon, 1), 12);

    const product = await this.prisma.product.findUniqueOrThrow({
      where: { id: request.productId },
      select: {
        id: true,
        sku: true,
        genericName: true,
        strength: true,
        baseUnit: true,
        leadTimeDays: true,
        reorderLevel: true,
        safetyStock: true,
        maximumStock: true,
        purchaseCost: true,
      },
    });

    const { series, labels, stockOutMonths } = await this.monthlySeries(
      request.productId,
      months,
      request.branchId,
      user,
    );

    const chosen =
      !request.method || request.method === 'AUTO'
        ? this.chooseMethod(series)
        : { method: request.method, rationale: 'Method selected manually.' };

    let result = this.runMethod(chosen.method, series);
    let fallbackNote: string | null = null;

    // Sanity guard: never return a zero forecast for a product that is plainly
    // still moving. A zero here would silently suppress replenishment, which is
    // how a pharmacy runs out of something it sells every week.
    const recent = series.slice(-3);
    const recentAverage = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
    if (result.forecast === 0 && recentAverage > 0) {
      const alternative = weightedMovingAverage(series, 3);
      fallbackNote =
        `${chosen.method} forecast zero while the last three months averaged ` +
        `${recentAverage.toFixed(1)}, so a weighted moving average was used instead.`;
      chosen.method = 'WEIGHTED_MOVING_AVERAGE';
      chosen.rationale = fallbackNote;
      result = alternative;
    }

    // Show every method side by side so the choice is inspectable, not magic.
    const comparison = (
      ['MOVING_AVERAGE', 'WEIGHTED_MOVING_AVERAGE', 'EXPONENTIAL_SMOOTHING', 'SEASONAL_NAIVE'] as const
    ).map((m) => {
      const r = this.runMethod(m, series);
      return {
        method: m,
        forecast: r.forecast,
        confidenceLow: r.confidenceLow,
        confidenceHigh: r.confidenceHigh,
        selected: m === chosen.method,
      };
    });

    // Project the horizon. These are flat projections of one monthly figure,
    // widening the band each period to reflect compounding uncertainty rather
    // than pretending confidence holds steady months out.
    const projection = Array.from({ length: horizon }, (_, i) => {
      const d = new Date();
      d.setMonth(d.getMonth() + i + 1, 1);
      const widening = 1 + i * 0.35;
      const spread = (result.confidenceHigh - result.forecast) * widening;
      return {
        period: d.toISOString().slice(0, 7),
        forecast: Math.round(result.forecast),
        low: Math.max(0, Math.round(result.forecast - spread)),
        high: Math.round(result.forecast + spread),
      };
    });

    // Current position, so the forecast leads somewhere actionable.
    const balances = await this.prisma.inventoryBalance.aggregate({
      where: {
        productId: request.productId,
        ...(request.branchId ? { branchId: request.branchId } : {}),
      },
      _sum: { onHand: true, reserved: true },
    });
    const incoming = await this.prisma.purchaseOrderItem.aggregate({
      where: {
        productId: request.productId,
        purchaseOrder: { status: { in: ['APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED'] } },
      },
      _sum: { orderedQty: true, receivedQty: true },
    });

    const onHand = Number(balances._sum.onHand ?? 0);
    const reserved = Number(balances._sum.reserved ?? 0);
    const incomingConfirmed =
      Number(incoming._sum.orderedQty ?? 0) - Number(incoming._sum.receivedQty ?? 0);

    const monthlyForecast = result.forecast;
    // §65: the service level decides how much safety stock is held, and it is
    // a commercial choice - a 99% target on everything ties up a lot of cash.
    const serviceLevel = await this.config.getNumber('replenishment.serviceLevel');
    const replenishment = calculateReplenishment({
      serviceLevel,
      productId: product.id,
      onHand,
      reserved,
      incomingConfirmed,
      avgDailyConsumption: monthlyForecast / 30,
      demandStdDev: (result.confidenceHigh - result.forecast) / 30,
      leadTimeDays: product.leadTimeDays,
      reorderLevel: Number(product.reorderLevel),
      maximumStock: Number(product.maximumStock),
      safetyStock: Number(product.safetyStock) || undefined,
    });

    const monthsOfCover = monthlyForecast > 0 ? (onHand - reserved) / monthlyForecast : null;

    return {
      product,
      history: labels.map((label, i) => ({
        period: label,
        quantity: series[i],
        stockOut: stockOutMonths.includes(i),
      })),
      // Stated plainly: a stock-out month understates real demand.
      dataQuality: {
        monthsOfHistory: months,
        monthsWithSales: series.filter((v) => v > 0).length,
        stockOutMonths: stockOutMonths.length,
        warning: stockOutMonths.length
          ? `${stockOutMonths.length} month(s) had a stock-out, so recorded demand is lower than real demand and this forecast is conservative.`
          : null,
        coefficientOfVariation: Math.round(coefficientOfVariation(series) * 1000) / 1000,
      },
      method: chosen.method,
      methodRationale: chosen.rationale,
      fallbackApplied: fallbackNote,
      forecast: result.forecast,
      confidenceLow: result.confidenceLow,
      confidenceHigh: result.confidenceHigh,
      comparison,
      projection,
      position: {
        onHand,
        reserved,
        available: onHand - reserved,
        incomingConfirmed,
        monthsOfCover: monthsOfCover === null ? null : Math.round(monthsOfCover * 10) / 10,
      },
      replenishment: {
        ...replenishment,
        estimatedCost: replenishment.suggestedQuantity * Number(product.purchaseCost),
      },
    };
  }

  /** Forecast the products that matter most, for the planning screen. */
  /**
   * How good the forecast actually was (§39: feature 852).
   *
   * Walk-forward backtest: for every month with enough history behind it, the
   * method is run on the months before it and compared with what really
   * happened. That is the only honest way to score a forecast - scoring it
   * against the same data it was fitted on always looks excellent.
   *
   * MAPE is undefined for a month of zero demand (division by zero), so those
   * months are counted separately rather than dropped silently or fudged to 1.
   */
  async accuracy(
    request: { productId: string; branchId?: string; months?: number; minHistory?: number },
    user: AuthenticatedUser,
  ) {
    const months = Math.min(Math.max(request.months ?? 24, 6), 48);
    const minHistory = Math.min(Math.max(request.minHistory ?? 6, 3), 12);

    const product = await this.prisma.product.findUniqueOrThrow({
      where: { id: request.productId },
      select: { id: true, sku: true, genericName: true, strength: true, baseUnit: true },
    });

    const { series, labels, stockOutMonths } = await this.monthlySeries(
      request.productId,
      months,
      request.branchId,
      user,
    );

    if (series.length <= minHistory) {
      return {
        product,
        months,
        evaluatedPoints: 0,
        // Reported as insufficient data rather than as a perfect score, which
        // is what an empty average would otherwise produce.
        message: `Only ${series.length} months of history; at least ${minHistory + 1} are needed to score a forecast.`,
        methods: [],
      };
    }

    const METHODS = [
      'MOVING_AVERAGE',
      'WEIGHTED_MOVING_AVERAGE',
      'EXPONENTIAL_SMOOTHING',
      'SEASONAL_NAIVE',
    ] as const;

    const methods = METHODS.map((method) => {
      const points: Array<{ month: string; actual: number; predicted: number; error: number }> = [];
      let absoluteErrorSum = 0;
      let percentageErrorSum = 0;
      let percentageCount = 0;
      let biasSum = 0;
      let zeroDemandMonths = 0;
      let stockOutSkipped = 0;

      for (let i = minHistory; i < series.length; i++) {
        // A month the product was out of stock is not evidence about demand,
        // so scoring against it would penalise a forecast for being right.
        if (stockOutMonths.includes(i)) {
          stockOutSkipped += 1;
          continue;
        }
        const history = series.slice(0, i);
        const predicted = this.runMethod(method, history).forecast;
        const actual = series[i];
        const error = predicted - actual;

        points.push({ month: labels[i], actual, predicted: Number(predicted.toFixed(2)), error: Number(error.toFixed(2)) });
        absoluteErrorSum += Math.abs(error);
        biasSum += error;
        if (actual !== 0) {
          percentageErrorSum += Math.abs(error) / actual;
          percentageCount += 1;
        } else {
          zeroDemandMonths += 1;
        }
      }

      const n = points.length;
      return {
        method,
        evaluatedPoints: n,
        stockOutMonthsSkipped: stockOutSkipped,
        zeroDemandMonths,
        meanAbsoluteError: n ? Number((absoluteErrorSum / n).toFixed(2)) : null,
        mapePercent: percentageCount
          ? Number(((percentageErrorSum / percentageCount) * 100).toFixed(1))
          : null,
        // Positive bias means the forecast runs high, which shows up as
        // overstocking; negative bias shows up as stock-outs.
        bias: n ? Number((biasSum / n).toFixed(2)) : null,
        points,
      };
    });

    const scored = methods.filter((m) => m.mapePercent !== null);
    const best = scored.length
      ? scored.reduce((a, b) => (a.mapePercent! <= b.mapePercent! ? a : b))
      : null;

    return {
      product,
      months,
      minHistory,
      evaluatedPoints: methods[0]?.evaluatedPoints ?? 0,
      bestMethod: best ? { method: best.method, mapePercent: best.mapePercent } : null,
      methods,
    };
  }

  async topProducts(user: AuthenticatedUser, limit = 20, months = 12) {
    const since = new Date(Date.now() - months * 30 * 86_400_000);
    const grouped = await this.prisma.inventoryTransaction.groupBy({
      by: ['productId'],
      where: {
        occurredAt: { gte: since },
        type: { in: ['SALE', 'DISPENSING'] },
        ...(this.scope.isUnscoped(user) ? {} : { branchId: { in: user.branchIds } }),
      },
      _sum: { quantityOut: true },
      orderBy: { _sum: { quantityOut: 'desc' } },
      take: Math.min(limit, 50),
    });

    const results: any[] = [];
    for (const g of grouped) {
      const f = await this.forecast({ productId: g.productId, months, horizon: 1 }, user);
      results.push({
        productId: g.productId,
        sku: f.product.sku,
        name: `${f.product.genericName} ${f.product.strength}`,
        unit: f.product.baseUnit,
        historicalMonthly: Math.round(Number(g._sum.quantityOut ?? 0) / months),
        forecast: f.forecast,
        confidenceLow: f.confidenceLow,
        confidenceHigh: f.confidenceHigh,
        method: f.method,
        monthsOfCover: f.position.monthsOfCover,
        shouldReorder: f.replenishment.shouldReorder,
        suggestedQuantity: f.replenishment.suggestedQuantity,
        dataWarning: f.dataQuality.warning,
      });
    }

    return results.sort((a, b) => {
      // Anything needing a reorder first, then by shortest cover.
      if (a.shouldReorder !== b.shouldReorder) return a.shouldReorder ? -1 : 1;
      return (a.monthsOfCover ?? 999) - (b.monthsOfCover ?? 999);
    });
  }
}
