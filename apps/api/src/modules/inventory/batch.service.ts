import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { BatchStatus, Prisma, QuarantineReason, TransactionType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';
import { LedgerService } from './ledger.service';

/**
 * Batch lifecycle and the quarantine workflow (§7, §16).
 *
 * Status changes are the only way stock becomes sellable or stops being
 * sellable. Every transition is audited with the previous status, and the
 * terminal states (DESTROYED, EXPIRED) cannot be walked back.
 */
const TERMINAL_STATUSES: BatchStatus[] = [
  BatchStatus.DESTROYED,
  BatchStatus.EXPIRED,
];

/** Which transitions the workflow permits. */
const ALLOWED_TRANSITIONS: Record<BatchStatus, BatchStatus[]> = {
  QUARANTINED: [
    BatchStatus.RELEASED,
    BatchStatus.BLOCKED,
    BatchStatus.DAMAGED,
    BatchStatus.RETURNED,
    BatchStatus.DESTROYED,
    BatchStatus.RECALLED,
  ],
  AVAILABLE: [
    BatchStatus.QUARANTINED,
    BatchStatus.BLOCKED,
    BatchStatus.DAMAGED,
    BatchStatus.RECALLED,
    BatchStatus.EXPIRED,
    BatchStatus.RETURNED,
  ],
  RELEASED: [
    BatchStatus.AVAILABLE,
    BatchStatus.QUARANTINED,
    BatchStatus.BLOCKED,
    BatchStatus.DAMAGED,
    BatchStatus.RECALLED,
    BatchStatus.EXPIRED,
    BatchStatus.RETURNED,
  ],
  BLOCKED: [BatchStatus.QUARANTINED, BatchStatus.RELEASED, BatchStatus.DESTROYED, BatchStatus.RETURNED],
  DAMAGED: [BatchStatus.DESTROYED, BatchStatus.RETURNED, BatchStatus.QUARANTINED],
  RECALLED: [BatchStatus.RETURNED, BatchStatus.DESTROYED, BatchStatus.QUARANTINED],
  RETURNED: [BatchStatus.QUARANTINED, BatchStatus.DESTROYED, BatchStatus.RELEASED],
  EXPIRED: [BatchStatus.DESTROYED],
  DESTROYED: [],
};

@Injectable()
export class BatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
  ) {}

  async findAll(query: {
    productId?: string;
    status?: BatchStatus;
    search?: string;
    expiringWithinDays?: number;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, query.pageSize ?? 50);

    const where: Prisma.BatchWhereInput = {
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { batchNumber: { contains: query.search, mode: 'insensitive' } },
              { product: { genericName: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
      ...(query.expiringWithinDays !== undefined
        ? {
            expiryDate: {
              lte: new Date(Date.now() + query.expiringWithinDays * 86_400_000),
            },
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.batch.findMany({
        where,
        include: {
          product: { select: { sku: true, genericName: true, brandName: true, strength: true } },
          supplier: { select: { companyName: true } },
          balances: { select: { onHand: true, reserved: true, warehouseId: true } },
        },
        orderBy: { expiryDate: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.batch.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  async findOne(id: string) {
    return this.prisma.batch.findUniqueOrThrow({
      where: { id },
      include: {
        product: true,
        supplier: true,
        balances: { include: { warehouse: true, location: true } },
        transactions: { orderBy: { occurredAt: 'desc' }, take: 100 },
        recallLinks: { include: { recall: true } },
        parentBatch: { select: { id: true, batchNumber: true } },
        childBatches: { select: { id: true, batchNumber: true } },
      },
    });
  }

  /** Move a batch between statuses, with the transition rules enforced. */
  async changeStatus(
    id: string,
    next: BatchStatus,
    user: AuthenticatedUser,
    options: { reason?: string; quarantineReason?: QuarantineReason } = {},
  ) {
    const batch = await this.prisma.batch.findUniqueOrThrow({
      where: { id },
      include: { product: { select: { genericName: true } } },
    });

    if (batch.status === next) {
      throw new BadRequestException(`Batch is already ${next}`);
    }
    if (TERMINAL_STATUSES.includes(batch.status) && next !== BatchStatus.DESTROYED) {
      throw new ForbiddenException(
        `Batch is ${batch.status}, which is a terminal state and cannot be reversed`,
      );
    }
    if (!ALLOWED_TRANSITIONS[batch.status].includes(next)) {
      throw new BadRequestException(
        `Cannot move a batch from ${batch.status} to ${next}. ` +
          `Permitted: ${ALLOWED_TRANSITIONS[batch.status].join(', ') || 'none'}`,
      );
    }
    if (next === BatchStatus.QUARANTINED && !options.quarantineReason) {
      throw new BadRequestException('A quarantine reason is required (§16)');
    }
    if (
      (next === BatchStatus.RELEASED || next === BatchStatus.AVAILABLE) &&
      batch.expiryDate.getTime() < Date.now()
    ) {
      throw new BadRequestException('An expired batch can never be released to available stock');
    }

    const updated = await this.prisma.batch.update({
      where: { id },
      data: {
        status: next,
        quarantineReason:
          next === BatchStatus.QUARANTINED ? options.quarantineReason ?? null : null,
        qualityNotes: options.reason ?? batch.qualityNotes,
        releasedById:
          next === BatchStatus.RELEASED || next === BatchStatus.AVAILABLE ? user.id : batch.releasedById,
        releasedAt:
          next === BatchStatus.RELEASED || next === BatchStatus.AVAILABLE ? new Date() : batch.releasedAt,
      },
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'inventory',
      action: 'BATCH_STATUS_CHANGE',
      entityType: 'Batch',
      entityId: id,
      previousValue: { status: batch.status },
      newValue: { status: next, quarantineReason: options.quarantineReason ?? null },
      reason: options.reason,
    });

    return updated;
  }

  /**
   * Sweep expired batches (§9). Runs nightly: flags the batch EXPIRED so FEFO
   * stops offering it, and posts an EXPIRY movement that takes the stock out of
   * available inventory while leaving the full history intact (§31).
   */
  async processExpiredBatches(systemUserId?: string): Promise<{
    batchesExpired: number;
    quantityRemoved: number;
    valueRemoved: number;
  }> {
    const expired = await this.prisma.batch.findMany({
      where: {
        expiryDate: { lt: new Date() },
        status: { in: [BatchStatus.AVAILABLE, BatchStatus.RELEASED, BatchStatus.QUARANTINED] },
      },
      include: { balances: true },
    });

    let quantityRemoved = 0;
    let valueRemoved = 0;

    for (const batch of expired) {
      await this.prisma.$transaction(async (tx) => {
        for (const balance of batch.balances) {
          if (balance.onHand.lessThanOrEqualTo(0)) continue;
          await this.ledger.post(tx, {
            type: TransactionType.EXPIRY,
            direction: 'OUT',
            productId: batch.productId,
            batchId: batch.id,
            warehouseId: balance.warehouseId,
            locationId: balance.locationId,
            branchId: balance.branchId,
            quantity: balance.onHand,
            unitCost: batch.purchaseCost,
            referenceType: 'EXPIRY_SWEEP',
            reason: `Batch ${batch.batchNumber} expired on ${batch.expiryDate.toISOString().slice(0, 10)}`,
            performedById: systemUserId,
            allowBlockedStatus: true,
          });
          quantityRemoved += Number(balance.onHand);
          valueRemoved += Number(balance.onHand.times(batch.purchaseCost));
        }
        await tx.batch.update({
          where: { id: batch.id },
          data: { status: BatchStatus.EXPIRED },
        });
      });

      await this.audit.record({
        userId: systemUserId ?? null,
        userLabel: 'System (expiry sweep)',
        module: 'inventory',
        action: 'BATCH_EXPIRED',
        entityType: 'Batch',
        entityId: batch.id,
        previousValue: { status: batch.status },
        newValue: { status: BatchStatus.EXPIRED },
        reason: 'Automatic expiry sweep',
      });
    }

    return { batchesExpired: expired.length, quantityRemoved, valueRemoved };
  }

  /** Inter-branch availability search (§34). */
  async findAcrossBranches(productId: string, excludeBranchId?: string) {
    const balances = await this.prisma.inventoryBalance.findMany({
      where: {
        productId,
        onHand: { gt: 0 },
        ...(excludeBranchId ? { branchId: { not: excludeBranchId } } : {}),
        batch: { status: { in: [BatchStatus.AVAILABLE, BatchStatus.RELEASED] } },
      },
      include: {
        batch: { select: { batchNumber: true, expiryDate: true, status: true } },
        warehouse: {
          select: {
            id: true,
            name: true,
            branch: { select: { id: true, name: true, city: true, latitude: true, longitude: true } },
          },
        },
      },
      orderBy: { batch: { expiryDate: 'asc' } },
    });

    return balances
      .filter((b) => b.batch && b.batch.expiryDate > new Date())
      .map((b) => ({
        branchId: b.warehouse.branch.id,
        branchName: b.warehouse.branch.name,
        city: b.warehouse.branch.city,
        warehouseId: b.warehouseId,
        warehouseName: b.warehouse.name,
        batchNumber: b.batch!.batchNumber,
        expiryDate: b.batch!.expiryDate,
        available: b.onHand.minus(b.reserved),
      }));
  }
}
