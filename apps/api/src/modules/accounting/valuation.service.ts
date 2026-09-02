import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, ValuationMethod } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface CostedIssue {
  method: ValuationMethod;
  quantity: string;
  totalCost: string;
  unitCost: string;
  /** Which layers were consumed, so the figure can be explained line by line. */
  layers: { layerId: string; quantity: string; unitCost: string; totalCost: string }[];
  /** Set when the layers could not cover the issue. */
  shortfall?: string;
  explanation: string[];
}

/**
 * Inventory valuation (§32).
 *
 * The physical pack that leaves the shelf is chosen by FEFO. What that movement
 * is *worth* is a separate, independently configurable decision — an
 * organization can run FEFO picking with weighted-average costing, and most do.
 * Conflating the two is the mistake this service exists to prevent, so nothing
 * here reads or writes stock; it only values movements the ledger has already
 * recorded.
 *
 * FIFO consumes cost layers in receipt order. Weighted average keeps a running
 * cost on the product, recomputed on each receipt.
 */
@Injectable()
export class ValuationService {
  private readonly logger = new Logger(ValuationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async method(): Promise<ValuationMethod> {
    const org = await this.prisma.organization.findFirstOrThrow({
      select: { valuationMethod: true },
    });
    return org.valuationMethod;
  }

  /**
   * Record a receipt.
   *
   * FIFO gets a new layer. Weighted average recomputes the product's running
   * cost across the stock it already holds — which is why it needs the
   * quantity on hand *before* this receipt.
   */
  async recordReceipt(
    tx: Prisma.TransactionClient,
    input: {
      productId: string;
      batchId?: string | null;
      warehouseId: string;
      quantity: number | Prisma.Decimal;
      unitCost: number | Prisma.Decimal;
      transactionId?: string;
      receivedAt?: Date;
    },
  ): Promise<void> {
    const quantity = new Prisma.Decimal(input.quantity);
    const unitCost = new Prisma.Decimal(input.unitCost);
    if (quantity.lessThanOrEqualTo(0)) return;

    // A layer is written whichever method is configured: switching an
    // organization from weighted average to FIFO later must not find an empty
    // history, and the layers are what make a cost audit possible.
    await tx.costLayer.create({
      data: {
        productId: input.productId,
        batchId: input.batchId ?? null,
        warehouseId: input.warehouseId,
        transactionId: input.transactionId ?? null,
        receivedAt: input.receivedAt ?? new Date(),
        quantity,
        remainingQuantity: quantity,
        unitCost,
      },
    });

    const product = await tx.product.findUniqueOrThrow({
      where: { id: input.productId },
      select: { averageCost: true },
    });

    const onHandBefore = await tx.inventoryBalance.aggregate({
      where: { productId: input.productId },
      _sum: { onHand: true },
    });
    // The balance already includes this receipt when the ledger posted first,
    // so the prior quantity is what it held before.
    const totalAfter = new Prisma.Decimal(onHandBefore._sum.onHand ?? 0);
    const priorQuantity = totalAfter.minus(quantity);

    const newAverage = priorQuantity.greaterThan(0)
      ? priorQuantity
          .times(product.averageCost)
          .plus(quantity.times(unitCost))
          .dividedBy(priorQuantity.plus(quantity))
      : unitCost;

    await tx.product.update({
      where: { id: input.productId },
      data: {
        averageCost: newAverage.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP),
        lastPurchaseCost: unitCost,
      },
    });
  }

  /**
   * Cost an issue and consume the layers it used.
   *
   * Returns the cost and the layers behind it, so a COGS figure on a report can
   * be drilled into rather than taken on trust.
   */
  async costIssue(
    tx: Prisma.TransactionClient,
    input: {
      productId: string;
      batchId?: string | null;
      warehouseId: string;
      quantity: number | Prisma.Decimal;
      transactionId: string;
    },
    method?: ValuationMethod,
  ): Promise<CostedIssue> {
    const quantity = new Prisma.Decimal(input.quantity);
    if (quantity.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Cannot cost a non-positive quantity');
    }

    const valuation = method ?? (await this.method());
    const explanation: string[] = [];

    if (valuation === ValuationMethod.WEIGHTED_AVERAGE) {
      const product = await tx.product.findUniqueOrThrow({
        where: { id: input.productId },
        select: { averageCost: true },
      });
      const totalCost = quantity
        .times(product.averageCost)
        .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);

      explanation.push(
        `Weighted average: ${quantity.toString()} x ${product.averageCost.toString()} = ${totalCost.toString()}`,
      );

      // Layers are still relieved so the on-hand valuation stays consistent
      // with the quantity on hand, even though the cost came from the average.
      await this.relieveLayers(tx, input, quantity);

      return {
        method: valuation,
        quantity: quantity.toString(),
        totalCost: totalCost.toString(),
        unitCost: product.averageCost.toString(),
        layers: [],
        explanation,
      };
    }

    // FIFO: oldest receipt first.
    const consumed = await this.relieveLayers(tx, input, quantity);

    const totalCost = consumed.reduce(
      (sum, c) => sum.plus(c.totalCost),
      new Prisma.Decimal(0),
    );
    const takenQuantity = consumed.reduce(
      (sum, c) => sum.plus(c.quantity),
      new Prisma.Decimal(0),
    );
    const shortfall = quantity.minus(takenQuantity);

    for (const c of consumed) {
      explanation.push(
        `FIFO layer received ${c.receivedAt.toISOString().slice(0, 10)}: ` +
          `${c.quantity.toString()} x ${c.unitCost.toString()} = ${c.totalCost.toString()}`,
      );
    }

    let finalCost = totalCost;
    if (shortfall.greaterThan(0)) {
      // No layer left to relieve. Rather than silently costing the remainder at
      // zero, fall back to the running average and say so — a zero-cost issue
      // would overstate margin without anyone noticing.
      const product = await tx.product.findUniqueOrThrow({
        where: { id: input.productId },
        select: { averageCost: true },
      });
      const gapCost = shortfall.times(product.averageCost);
      finalCost = finalCost.plus(gapCost);
      explanation.push(
        `${shortfall.toString()} unit(s) had no remaining cost layer and were valued at the ` +
          `running average of ${product.averageCost.toString()} (${gapCost.toString()}). ` +
          `This usually means stock was received before costing began, or a layer was consumed twice.`,
      );
      this.logger.warn(
        `FIFO shortfall of ${shortfall.toString()} for product ${input.productId}`,
      );
    }

    const rounded = finalCost.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);

    await tx.costConsumption.createMany({
      data: consumed.map((c) => ({
        layerId: c.layerId,
        transactionId: input.transactionId,
        productId: input.productId,
        quantity: c.quantity,
        unitCost: c.unitCost,
        totalCost: c.totalCost,
      })),
    });

    return {
      method: valuation,
      quantity: quantity.toString(),
      totalCost: rounded.toString(),
      unitCost: quantity.greaterThan(0)
        ? rounded.dividedBy(quantity).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP).toString()
        : '0',
      layers: consumed.map((c) => ({
        layerId: c.layerId,
        quantity: c.quantity.toString(),
        unitCost: c.unitCost.toString(),
        totalCost: c.totalCost.toString(),
      })),
      ...(shortfall.greaterThan(0) ? { shortfall: shortfall.toString() } : {}),
      explanation,
    };
  }

  /** Consume layers oldest first, returning what was taken from each. */
  private async relieveLayers(
    tx: Prisma.TransactionClient,
    input: { productId: string; batchId?: string | null; warehouseId: string },
    quantity: Prisma.Decimal,
  ) {
    const layers = await tx.costLayer.findMany({
      where: {
        productId: input.productId,
        warehouseId: input.warehouseId,
        ...(input.batchId ? { batchId: input.batchId } : {}),
        remainingQuantity: { gt: 0 },
      },
      orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
    });

    let outstanding = quantity;
    const consumed: {
      layerId: string;
      quantity: Prisma.Decimal;
      unitCost: Prisma.Decimal;
      totalCost: Prisma.Decimal;
      receivedAt: Date;
    }[] = [];

    for (const layer of layers) {
      if (outstanding.lessThanOrEqualTo(0)) break;

      const take = Prisma.Decimal.min(outstanding, layer.remainingQuantity);
      const totalCost = take.times(layer.unitCost).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);

      await tx.costLayer.update({
        where: { id: layer.id },
        data: { remainingQuantity: layer.remainingQuantity.minus(take) },
      });

      consumed.push({
        layerId: layer.id,
        quantity: take,
        unitCost: layer.unitCost,
        totalCost,
        receivedAt: layer.receivedAt,
      });
      outstanding = outstanding.minus(take);
    }

    return consumed;
  }

  /**
   * Value the stock on hand (§32: inventory asset).
   *
   * FIFO values remaining layers; weighted average values quantity at the
   * running cost. The two legitimately differ, which is why the method used is
   * always reported alongside the number.
   */
  async inventoryValue(filter: { warehouseId?: string; branchId?: string } = {}) {
    const method = await this.method();

    if (method === ValuationMethod.FIFO) {
      const layers = await this.prisma.costLayer.findMany({
        where: {
          remainingQuantity: { gt: 0 },
          ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
        },
        select: { productId: true, remainingQuantity: true, unitCost: true },
      });

      const byProduct = new Map<string, { quantity: Prisma.Decimal; value: Prisma.Decimal }>();
      for (const layer of layers) {
        const entry = byProduct.get(layer.productId) ?? {
          quantity: new Prisma.Decimal(0),
          value: new Prisma.Decimal(0),
        };
        entry.quantity = entry.quantity.plus(layer.remainingQuantity);
        entry.value = entry.value.plus(layer.remainingQuantity.times(layer.unitCost));
        byProduct.set(layer.productId, entry);
      }

      const total = [...byProduct.values()].reduce(
        (sum, e) => sum.plus(e.value),
        new Prisma.Decimal(0),
      );

      return {
        method,
        totalValue: total.toDecimalPlaces(2).toString(),
        products: byProduct.size,
        basis: 'Remaining FIFO cost layers',
      };
    }

    const balances = await this.prisma.inventoryBalance.findMany({
      where: {
        onHand: { gt: 0 },
        ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
        ...(filter.branchId ? { branchId: filter.branchId } : {}),
      },
      select: { onHand: true, product: { select: { id: true, averageCost: true } } },
    });

    const total = balances.reduce(
      (sum, b) => sum.plus(b.onHand.times(b.product.averageCost)),
      new Prisma.Decimal(0),
    );

    return {
      method,
      totalValue: total.toDecimalPlaces(2).toString(),
      products: new Set(balances.map((b) => b.product.id)).size,
      basis: 'Quantity on hand at the running weighted-average cost',
    };
  }

  /**
   * Reconcile the inventory asset account against the physical valuation.
   *
   * These are two different questions — what the ledger accumulated from
   * movements, and what the stock on hand is worth today — and they legitimately
   * drift when costs change. Reporting the gap is the point: a silent
   * divergence between the accounts and the shelf is exactly what a stock audit
   * is meant to catch, so this states the number rather than reconciling it
   * away.
   */
  async reconcileToLedger(): Promise<{
    ledgerBalance: string;
    physicalValue: string;
    difference: string;
    differencePercent: number | null;
    method: ValuationMethod;
    withinTolerance: boolean;
    note: string;
  }> {
    const account = await this.prisma.account.findUnique({
      where: { systemKey: 'INVENTORY_ASSET' },
      select: { id: true },
    });

    if (!account) {
      throw new BadRequestException(
        'No account is mapped to INVENTORY_ASSET, so there is nothing to reconcile against.',
      );
    }

    const [totals, physical] = await Promise.all([
      this.prisma.journalLine.aggregate({
        where: { accountId: account.id, entry: { status: 'POSTED' } },
        _sum: { debit: true, credit: true },
      }),
      this.inventoryValue(),
    ]);

    const ledgerBalance = new Prisma.Decimal(totals._sum.debit ?? 0).minus(
      new Prisma.Decimal(totals._sum.credit ?? 0),
    );
    const physicalValue = new Prisma.Decimal(physical.totalValue);
    const difference = ledgerBalance.minus(physicalValue);

    const percent = ledgerBalance.isZero()
      ? null
      : Number(difference.dividedBy(ledgerBalance).times(100).toDecimalPlaces(4));

    // One percent is a working tolerance for rounding and cost drift, not a
    // statement that anything below it is correct.
    const withinTolerance = percent === null || Math.abs(percent) <= 1;

    return {
      ledgerBalance: ledgerBalance.toDecimalPlaces(2).toString(),
      physicalValue: physicalValue.toDecimalPlaces(2).toString(),
      difference: difference.toDecimalPlaces(2).toString(),
      differencePercent: percent,
      method: physical.method,
      withinTolerance,
      note: withinTolerance
        ? 'The inventory account and the stock valuation agree within the working tolerance.'
        : 'The inventory account and the stock valuation disagree by more than 1%. ' +
          'Check for movements posted at a cost that has since changed, or for unposted documents.',
    };
  }

  /** The layers behind one product's valuation, for a cost audit. */
  async layersFor(productId: string, warehouseId?: string) {
    return this.prisma.costLayer.findMany({
      where: {
        productId,
        ...(warehouseId ? { warehouseId } : {}),
      },
      orderBy: { receivedAt: 'asc' },
      take: 500,
    });
  }

  /** What one issue actually cost, layer by layer. */
  async consumptionFor(transactionId: string) {
    return this.prisma.costConsumption.findMany({
      where: { transactionId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
