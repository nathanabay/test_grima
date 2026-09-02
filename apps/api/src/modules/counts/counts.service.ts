import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { CountType, DocumentStatus, Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';
import { ScopeService } from '../../common/guards/scope.service';
import { LedgerService } from '../inventory/ledger.service';
import { DocumentNumberService } from '../common-services/document-number.service';
import { ScanningService } from '../scanning/scanning.service';

/** Variance above this needs a supervisor to approve the adjustment (§21). */
const SUPERVISOR_THRESHOLD_UNITS = 10;
const SUPERVISOR_THRESHOLD_VALUE = 1000;

/**
 * Physical inventory counts and adjustments (§21).
 *
 * Counting never writes stock directly: the count records what was found, and
 * posting it produces ADJUSTMENT ledger movements so the discrepancy stays
 * visible in the history forever.
 */
@Injectable()
export class CountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly docNumbers: DocumentNumberService,
    private readonly scope: ScopeService,
    private readonly scanning: ScanningService,
  ) {}

  /**
   * Open a count and snapshot the system quantities at that moment (§21).
   *
   * The scope depends on the count type, so every declared type is actually
   * usable rather than being an enum value with no behaviour behind it:
   *
   *   FULL      every position in the branch
   *   WAREHOUSE every position in one warehouse
   *   CATEGORY  one product category within a warehouse
   *   BIN       one storage location
   *   CYCLE     the positions least recently counted (rolling coverage)
   *   RANDOM    an unbiased sample, for spot checks
   */
  async create(
    data: {
      warehouseId: string;
      branchId: string;
      countType: CountType;
      productIds?: string[];
      locationId?: string;
      categoryId?: string;
      sampleSize?: number;
    },
    user: AuthenticatedUser,
  ) {
    // §4: counts are restricted to warehouses within the user's scope.
    this.scope.assertBranch(user, data.branchId);
    await this.scope.assertWarehouse(user, data.warehouseId);

    const where: Prisma.InventoryBalanceWhereInput = {
      // A FULL count covers the branch; every other type is warehouse-scoped.
      ...(data.countType === CountType.FULL
        ? { branchId: data.branchId }
        : { warehouseId: data.warehouseId }),
      ...(data.productIds?.length ? { productId: { in: data.productIds } } : {}),
    };

    if (data.countType === CountType.BIN) {
      if (!data.locationId) {
        throw new BadRequestException('A bin count needs a storage location');
      }
      where.locationId = data.locationId;
    } else if (data.locationId) {
      where.locationId = data.locationId;
    }

    if (data.countType === CountType.CATEGORY) {
      if (!data.categoryId) {
        throw new BadRequestException('A category count needs a product category');
      }
      where.product = { categoryId: data.categoryId };
    }

    let balances = await this.prisma.inventoryBalance.findMany({
      where,
      // Least recently counted first, which is what makes a cycle count roll.
      orderBy: [{ lastMovementAt: 'asc' }],
    });

    if (data.countType === CountType.CYCLE) {
      const size = data.sampleSize ?? 50;
      // Positions never counted, or counted longest ago, come first.
      const counted = await this.prisma.stockCountItem.findMany({
        where: { stockCount: { warehouseId: data.warehouseId, status: DocumentStatus.CLOSED } },
        select: { productId: true, batchId: true, stockCount: { select: { completedAt: true } } },
      });
      const lastCounted = new Map<string, number>();
      for (const c of counted) {
        const key = `${c.productId}:${c.batchId ?? ''}`;
        const at = c.stockCount.completedAt?.getTime() ?? 0;
        if (at > (lastCounted.get(key) ?? 0)) lastCounted.set(key, at);
      }
      balances = balances
        .sort(
          (a, b) =>
            (lastCounted.get(`${a.productId}:${a.batchId ?? ''}`) ?? 0) -
            (lastCounted.get(`${b.productId}:${b.batchId ?? ''}`) ?? 0),
        )
        .slice(0, size);
    }

    if (data.countType === CountType.RANDOM) {
      const size = data.sampleSize ?? 25;
      // Fisher-Yates over a copy: an unbiased sample, unlike sort(() => 0.5 - random()).
      const pool = [...balances];
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      balances = pool.slice(0, size);
    }

    if (!balances.length) {
      throw new BadRequestException('No stock positions match this count scope');
    }

    return this.prisma.$transaction(async (tx) => {
      const countNo = await this.docNumbers.next(tx, 'CNT');
      return tx.stockCount.create({
        data: {
          countNo,
          warehouseId: data.warehouseId,
          branchId: data.branchId,
          countType: data.countType,
          status: DocumentStatus.DRAFT,
          startedAt: new Date(),
          countedById: user.id,
          items: {
            create: balances.map((b) => ({
              productId: b.productId,
              batchId: b.batchId,
              locationId: b.locationId,
              systemQty: b.onHand,
            })),
          },
        },
        include: { items: true },
      });
    });
  }

  /**
   * Record a counted quantity from a scan (§21). Resolves the scanned code to a
   * line on this count, so a counter never types a product or batch id.
   */
  async recordByScan(
    id: string,
    input: { code: string; countedQty: number; reason?: string },
    user: AuthenticatedUser,
  ) {
    const resolution = await this.scanning.resolve(input.code);
    if (!resolution.product) {
      throw new BadRequestException(
        `Scanned code does not match any product in the drug master`,
      );
    }

    const count = await this.prisma.stockCount.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });

    // Prefer the exact batch when the pack carried a GS1 batch number.
    const candidates = count.items.filter((i) => i.productId === resolution.product!.id);
    if (!candidates.length) {
      throw new BadRequestException(
        `${resolution.product.genericName} is not in the scope of count ${count.countNo}`,
      );
    }

    let line = candidates[0];
    if (resolution.batch) {
      const exact = candidates.find((i) => i.batchId === resolution.batch!.id);
      if (exact) line = exact;
      else {
        throw new BadRequestException(
          `Batch ${resolution.batch.batchNumber} is not on count ${count.countNo}. ` +
            `Found stock that is not on the count sheet — record it as an adjustment instead.`,
        );
      }
    } else if (candidates.length > 1) {
      throw new BadRequestException(
        `${resolution.product.genericName} has ${candidates.length} batches on this count. ` +
          `Scan the GS1 DataMatrix so the batch is identified, or select the line manually.`,
      );
    }

    return this.recordCounts(
      id,
      [{ itemId: line.id, countedQty: input.countedQty, reason: input.reason }],
      user,
    );
  }

  /** Record counted quantities and compute the variances. */
  async recordCounts(
    id: string,
    lines: Array<{ itemId: string; countedQty: number; reason?: string }>,
    user: AuthenticatedUser,
  ) {
    const count = await this.prisma.stockCount.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });
    if (count.status === DocumentStatus.CLOSED) {
      throw new BadRequestException('This count has already been posted');
    }

    await this.prisma.$transaction(async (tx) => {
      for (const line of lines) {
        const item = count.items.find((i) => i.id === line.itemId);
        if (!item) throw new BadRequestException(`Line ${line.itemId} is not on this count`);

        const counted = new Prisma.Decimal(line.countedQty);
        const variance = counted.minus(item.systemQty);

        const product = await tx.product.findUniqueOrThrow({
          where: { id: item.productId },
          select: { averageCost: true },
        });
        const varianceValue = variance.times(product.averageCost);

        const requiresApproval =
          variance.abs().greaterThan(SUPERVISOR_THRESHOLD_UNITS) ||
          varianceValue.abs().greaterThan(SUPERVISOR_THRESHOLD_VALUE);

        await tx.stockCountItem.update({
          where: { id: item.id },
          data: {
            countedQty: counted,
            varianceQty: variance,
            varianceValue,
            requiresApproval,
            reason: line.reason ?? null,
          },
        });
      }

      await tx.stockCount.update({
        where: { id },
        data: { status: DocumentStatus.SUBMITTED },
      });
    });

    return this.findOne(id);
  }

  /**
   * Post the count: writes ADJUSTMENT movements for every variance.
   * Lines flagged `requiresApproval` need the approver permission (§21).
   */
  async post(id: string, user: AuthenticatedUser) {
    const count = await this.prisma.stockCount.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });
    if (count.status === DocumentStatus.CLOSED) {
      throw new BadRequestException('This count has already been posted');
    }

    const uncounted = count.items.filter((i) => i.countedQty === null);
    if (uncounted.length) {
      throw new BadRequestException(
        `${uncounted.length} line(s) have not been counted yet`,
      );
    }

    const needsApproval = count.items.some((i) => i.requiresApproval);
    if (needsApproval && !user.permissions.includes('inventory.count.APPROVE')) {
      throw new ForbiddenException(
        'This count contains variances above the threshold and requires supervisor approval',
      );
    }
    const unexplained = count.items.filter(
      (i) => i.requiresApproval && !i.reason?.trim(),
    );
    if (unexplained.length) {
      throw new BadRequestException(
        `${unexplained.length} large variance(s) need an explanation before posting`,
      );
    }

    await this.prisma.$transaction(
      async (tx) => {
        for (const item of count.items) {
          if (item.varianceQty.equals(0)) continue;
          const isGain = item.varianceQty.greaterThan(0);

          await this.ledger.post(tx, {
            type: TransactionType.STOCK_COUNT,
            direction: isGain ? 'IN' : 'OUT',
            productId: item.productId,
            batchId: item.batchId,
            warehouseId: count.warehouseId,
            locationId: item.locationId,
            branchId: count.branchId,
            quantity: item.varianceQty.abs(),
            referenceType: 'STOCK_COUNT',
            referenceId: count.id,
            referenceNo: count.countNo,
            reason: item.reason ?? `Physical count variance on ${count.countNo}`,
            performedById: user.id,
            allowBlockedStatus: true,
            idempotencyKey: `count:${count.id}:${item.id}`,
          });
        }

        await tx.stockCount.update({
          where: { id },
          data: {
            status: DocumentStatus.CLOSED,
            completedAt: new Date(),
            approvedById: needsApproval ? user.id : null,
          },
        });
      },
      { timeout: 60_000 },
    );

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'inventory',
      action: 'STOCK_ADJUSTMENT',
      entityType: 'StockCount',
      entityId: id,
      newValue: {
        countNo: count.countNo,
        linesAdjusted: count.items.filter((i) => !i.varianceQty.equals(0)).length,
        netVariance: count.items
          .reduce((sum, i) => sum.plus(i.varianceQty), new Prisma.Decimal(0))
          .toString(),
      },
      branchId: count.branchId,
    });

    return this.findOne(id);
  }

  async findOne(id: string) {
    return this.prisma.stockCount.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });
  }

  async findAll(query: { warehouseId?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, query.pageSize ?? 25);
    const where = query.warehouseId ? { warehouseId: query.warehouseId } : {};
    const [data, total] = await Promise.all([
      this.prisma.stockCount.findMany({
        where,
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.stockCount.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  /** Direct stock adjustment outside a count (§21). Always needs a reason. */
  async adjust(
    data: {
      warehouseId: string;
      branchId: string;
      reason: string;
      items: Array<{ productId: string; batchId: string; quantityDelta: number; reason?: string }>;
    },
    user: AuthenticatedUser,
  ) {
    if (!data.reason?.trim()) throw new BadRequestException('An adjustment reason is required');
    if (!data.items?.length) throw new BadRequestException('Nothing to adjust');

    const adjustment = await this.prisma.$transaction(async (tx) => {
      const adjustmentNo = await this.docNumbers.next(tx, 'ADJ');
      const created = await tx.stockAdjustment.create({
        data: {
          adjustmentNo,
          warehouseId: data.warehouseId,
          branchId: data.branchId,
          status: DocumentStatus.APPROVED,
          reason: data.reason,
          createdById: user.id,
          approvedById: user.id,
          approvedAt: new Date(),
          items: {
            create: data.items.map((i) => ({
              productId: i.productId,
              batchId: i.batchId,
              quantityDelta: new Prisma.Decimal(i.quantityDelta),
              reason: i.reason ?? null,
            })),
          },
        },
        include: { items: true },
      });

      for (const item of created.items) {
        if (item.quantityDelta.equals(0)) continue;
        await this.ledger.post(tx, {
          type: TransactionType.ADJUSTMENT,
          direction: item.quantityDelta.greaterThan(0) ? 'IN' : 'OUT',
          productId: item.productId,
          batchId: item.batchId,
          warehouseId: data.warehouseId,
          branchId: data.branchId,
          quantity: item.quantityDelta.abs(),
          referenceType: 'STOCK_ADJUSTMENT',
          referenceId: created.id,
          referenceNo: adjustmentNo,
          reason: item.reason ?? data.reason,
          performedById: user.id,
          allowBlockedStatus: true,
          idempotencyKey: `adj:${created.id}:${item.id}`,
        });
      }

      return created;
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'inventory',
      action: 'STOCK_ADJUSTMENT',
      entityType: 'StockAdjustment',
      entityId: adjustment.id,
      newValue: { adjustmentNo: adjustment.adjustmentNo, lines: adjustment.items.length },
      reason: data.reason,
      branchId: data.branchId,
    });

    return adjustment;
  }
}
