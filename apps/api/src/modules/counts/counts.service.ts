import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { CountType, DocumentStatus, Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';
import { ScopeService } from '../../common/guards/scope.service';
import { LedgerService } from '../inventory/ledger.service';
import { DocumentNumberService } from '../common-services/document-number.service';

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
  ) {}

  /** Open a count and snapshot the system quantities at that moment. */
  async create(
    data: { warehouseId: string; branchId: string; countType: CountType; productIds?: string[]; locationId?: string },
    user: AuthenticatedUser,
  ) {
    // §4: counts are restricted to warehouses within the user's scope.
    this.scope.assertBranch(user, data.branchId);
    await this.scope.assertWarehouse(user, data.warehouseId);

    const balances = await this.prisma.inventoryBalance.findMany({
      where: {
        warehouseId: data.warehouseId,
        ...(data.productIds?.length ? { productId: { in: data.productIds } } : {}),
        ...(data.locationId ? { locationId: data.locationId } : {}),
      },
    });

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
