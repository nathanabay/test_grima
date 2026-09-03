import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BatchStatus, Prisma, QuarantineReason, TransactionType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';
import { LedgerService } from './ledger.service';
import { ScopeService } from '../../common/guards/scope.service';
import { SeparationOfDutiesService } from '../../common/approval/separation.service';

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
    private readonly scope: ScopeService,
    private readonly separation: SeparationOfDutiesService,
  ) {}

  /**
   * A batch is reachable when the reader holds stock of it (§4, §33).
   *
   * A batch row itself carries no branch — stock does. A reader scoped to one
   * branch may see the batches that branch holds or has held, and no others.
   * Returning "not found" rather than "forbidden" keeps an id from being a
   * probe for what other branches carry.
   */
  private reachable(user: AuthenticatedUser): Prisma.BatchWhereInput {
    if (this.scope.isUnscoped(user)) return {};
    return {
      OR: [
        { balances: { some: { branchId: { in: user.branchIds } } } },
        { transactions: { some: { branchId: { in: user.branchIds } } } },
      ],
    };
  }

  private async assertReachable(user: AuthenticatedUser, batchId: string): Promise<void> {
    if (this.scope.isUnscoped(user)) return;
    const found = await this.prisma.batch.findFirst({
      where: { id: batchId, ...this.reachable(user) },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Batch not found');
  }

  async findAll(
    user: AuthenticatedUser,
    query: {
      productId?: string;
      status?: BatchStatus;
      search?: string;
      supplierId?: string;
      expiringWithinDays?: number;
      onlyInStock?: boolean;
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, query.pageSize ?? 50);

    const where: Prisma.BatchWhereInput = {
      ...this.reachable(user),
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.onlyInStock
        ? { balances: { some: { onHand: { gt: 0 }, ...this.scope.branchFilter(user) } } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { batchNumber: { contains: query.search, mode: 'insensitive' } },
              { lotNumber: { contains: query.search, mode: 'insensitive' } },
              { supplierInvoiceNo: { contains: query.search, mode: 'insensitive' } },
              { product: { genericName: { contains: query.search, mode: 'insensitive' } } },
              { product: { sku: { contains: query.search, mode: 'insensitive' } } },
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
          product: {
            select: {
              id: true,
              sku: true,
              genericName: true,
              brandName: true,
              strength: true,
              averageCost: true,
              isControlled: true,
              isColdChain: true,
            },
          },
          supplier: { select: { id: true, companyName: true } },
          balances: {
            // Only the reader's own stock: a batch reachable because one branch
            // holds it must not reveal how much every other branch holds.
            where: this.scope.branchFilter(user),
            select: {
              onHand: true,
              reserved: true,
              warehouseId: true,
              warehouse: { select: { name: true } },
            },
          },
          _count: { select: { childBatches: true, recallLinks: true, serials: true } },
        },
        orderBy: { expiryDate: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.batch.count({ where }),
    ]);

    return {
      data: data.map((batch) => this.summarise(batch)),
      total,
      page,
      pageSize,
    };
  }

  /** On-hand, reserved and value for a batch, from the positions supplied. */
  private summarise<
    T extends {
      purchaseCost: Prisma.Decimal;
      expiryDate: Date;
      balances: { onHand: Prisma.Decimal; reserved: Prisma.Decimal }[];
    },
  >(batch: T) {
    const onHand = batch.balances.reduce((s, b) => s.plus(b.onHand), new Prisma.Decimal(0));
    const reserved = batch.balances.reduce((s, b) => s.plus(b.reserved), new Prisma.Decimal(0));
    return {
      ...batch,
      onHand,
      reserved,
      available: onHand.minus(reserved),
      // Valued at what the batch cost, which is what a batch write-off costs.
      stockValue: onHand.times(batch.purchaseCost),
      daysToExpiry: Math.floor((batch.expiryDate.getTime() - Date.now()) / 86_400_000),
    };
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const batch = await this.prisma.batch.findFirst({
      where: { id, ...this.reachable(user) },
      include: {
        product: true,
        supplier: true,
        balances: {
          where: this.scope.branchFilter(user),
          include: { warehouse: true, location: true },
        },
        transactions: {
          where: this.scope.branchFilter(user),
          orderBy: { occurredAt: 'desc' },
          take: 100,
        },
        recallLinks: { include: { recall: true } },
        parentBatch: {
          select: { id: true, batchNumber: true, expiryDate: true, status: true },
        },
        childBatches: {
          select: { id: true, batchNumber: true, expiryDate: true, status: true, receivedQuantity: true },
        },
        serials: {
          select: { id: true, serial: true, status: true, warehouseId: true },
          orderBy: { serial: 'asc' },
          take: 200,
        },
      },
    });
    if (!batch) throw new NotFoundException('Batch not found');

    // The status history lives in the audit chain, which is where it belongs —
    // a second copy on the batch row could disagree with it.
    const history = await this.prisma.auditLog.findMany({
      where: {
        entityType: 'Batch',
        entityId: id,
        action: { in: ['BATCH_STATUS_CHANGE', 'BATCH_SPLIT', 'CREATE'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        createdAt: true,
        action: true,
        userLabel: true,
        previousValue: true,
        newValue: true,
        reason: true,
      },
    });

    return { ...this.summarise(batch), history, ...(await this.movementTotals(id, user)) };
  }

  /**
   * What has happened to this batch, by movement type (§7).
   *
   * How much of a batch was damaged, disposed of or returned was derivable from
   * the ledger and reported nowhere, so answering it meant writing a query. The
   * ledger is still the authority — these are read from it, not stored beside
   * it, so they cannot drift from the movements they summarise.
   *
   * Consumption velocity looks only at supply — dispensing and sale — because
   * a batch written off to damage was not consumed by anybody, and counting it
   * would make the days of cover optimistic exactly when it matters.
   */
  private async movementTotals(batchId: string, user: AuthenticatedUser) {
    // Aggregated in the database, not over the hundred movements the record
    // happens to display: a batch with more history than that would otherwise
    // report totals that quietly stop at the page boundary.
    const scope = this.scope.branchFilter(user);
    const grouped = await this.prisma.inventoryTransaction.groupBy({
      by: ['type'],
      where: { batchId, ...scope },
      _sum: { quantityOut: true },
    });
    const byType = new Map(grouped.map((g) => [g.type, g._sum.quantityOut ?? new Prisma.Decimal(0)]));
    const out = (type: TransactionType) => byType.get(type) ?? new Prisma.Decimal(0);

    const supplied: TransactionType[] = [TransactionType.DISPENSING, TransactionType.SALE];
    const since = new Date(Date.now() - 90 * 86_400_000);
    const recent = await this.prisma.inventoryTransaction.findMany({
      where: { batchId, ...scope, type: { in: supplied }, occurredAt: { gte: since } },
      select: { quantityOut: true, occurredAt: true },
    });
    const recentUnits = recent.reduce(
      (sum, t) => sum.plus(t.quantityOut),
      new Prisma.Decimal(0),
    );

    // Measured from the first supply, not from a flat ninety days: a batch
    // received a fortnight ago has a fortnight of history, and dividing it by
    // ninety would say it will last for ever.
    const firstSupply = recent.length
      ? Math.min(...recent.map((t) => t.occurredAt.getTime()))
      : null;
    const days = firstSupply ? Math.max(1, Math.round((Date.now() - firstSupply) / 86_400_000)) : 0;
    const perDay = days > 0 ? recentUnits.dividedBy(days) : new Prisma.Decimal(0);

    return {
      movementTotals: {
        dispensed: out(TransactionType.DISPENSING).toString(),
        sold: out(TransactionType.SALE).toString(),
        damaged: out(TransactionType.DAMAGE).toString(),
        disposed: out(TransactionType.DISPOSAL).toString(),
        expired: out(TransactionType.EXPIRY).toString(),
        recalled: out(TransactionType.RECALL).toString(),
        returned: out(TransactionType.RETURN_OUT).toString(),
        transferredOut: out(TransactionType.TRANSFER_OUT).toString(),
        adjustedOut: out(TransactionType.ADJUSTMENT).toString(),
      },
      consumption: {
        windowDays: days,
        unitsSupplied: recentUnits.toString(),
        perDay: perDay.toDecimalPlaces(4).toString(),
        note:
          days === 0
            ? 'Nothing has been supplied from this batch, so there is no velocity to report.'
            : `Measured over the ${days} day(s) since the first supply from this batch, ` +
              'counting only what went to a patient or a customer.',
      },
    };
  }

  /** Move a batch between statuses, with the transition rules enforced. */
  async changeStatus(
    id: string,
    next: BatchStatus,
    user: AuthenticatedUser,
    options: {
      reason?: string;
      quarantineReason?: QuarantineReason;
      /** Certificate of analysis or other evidence a release was decided on. */
      evidenceRef?: string;
      /** Set false only by an automated sweep, which has no document to cite. */
      requireEvidence?: boolean;
    } = {},
  ) {
    await this.assertReachable(user, id);
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
    if (!options.reason?.trim()) {
      throw new BadRequestException(
        `Say why this batch is being moved to ${next}. The reason is the record.`,
      );
    }
    // §16: a release is a quality decision. What it was decided on — the
    // certificate of analysis, the deviation report — is the thing an inspector
    // asks for, so it is recorded rather than left in somebody's memory.
    if (
      (next === BatchStatus.RELEASED || next === BatchStatus.AVAILABLE) &&
      options.requireEvidence !== false &&
      !options.evidenceRef?.trim()
    ) {
      throw new BadRequestException(
        'Releasing a batch needs the reference of the evidence it was released on ' +
          '(certificate of analysis, deviation closure, or the inspection record).',
      );
    }
    if (
      (next === BatchStatus.RELEASED || next === BatchStatus.AVAILABLE) &&
      batch.expiryDate.getTime() < Date.now()
    ) {
      throw new BadRequestException('An expired batch can never be released to available stock');
    }
    // A batch has no single raiser — it is received, quarantined and released
    // over its life — so the meaningful rule is narrower than "anyone who ever
    // touched it": whoever quarantined a batch cannot be the one who clears it.
    if (
      (next === BatchStatus.RELEASED || next === BatchStatus.AVAILABLE) &&
      batch.status === BatchStatus.QUARANTINED &&
      (await this.separation.enforced())
    ) {
      const quarantinedBy = await this.separation.whoMovedTo(
        'Batch',
        id,
        BatchStatus.QUARANTINED,
      );
      if (quarantinedBy && quarantinedBy === user.id) {
        throw new ForbiddenException(
          'You quarantined this batch, so you cannot release it yourself. ' +
            'A second quality decision is required.',
        );
      }
    }

    const updated = await this.prisma.batch.update({
      where: { id },
      data: {
        status: next,
        quarantineReason:
          next === BatchStatus.QUARANTINED ? options.quarantineReason ?? null : null,
        qualityNotes: options.evidenceRef?.trim()
          ? `${options.reason!.trim()} [evidence: ${options.evidenceRef.trim()}]`
          : options.reason?.trim() ?? batch.qualityNotes,
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
      newValue: {
        status: next,
        quarantineReason: options.quarantineReason ?? null,
        evidenceRef: options.evidenceRef?.trim() ?? null,
      },
      reason: options.reason,
    });

    return updated;
  }

  /**
   * Split a batch, or repack part of it under a new number (§7).
   *
   * The schema has carried `parentBatchId` since the beginning and nothing
   * could write it, so genealogy was a column that recorded nothing. A split
   * moves quantity from the parent to a child batch that keeps the parent's
   * expiry, cost and supplier — the medicine has not changed, only the
   * container it is counted in.
   *
   * Two movements, in one transaction, both against the ledger: the parent goes
   * out and the child comes in. Stock is never created; a split that could not
   * take the quantity out of the parent does not put it into the child.
   */
  async split(
    input: {
      batchId: string;
      warehouseId: string;
      quantity: number;
      newBatchNumber?: string;
      locationId?: string;
      reason: string;
    },
    user: AuthenticatedUser,
  ) {
    if (!input.reason?.trim()) {
      throw new BadRequestException('Say why the batch is being split');
    }
    if (!(input.quantity > 0)) {
      throw new BadRequestException('Split a quantity greater than zero');
    }
    await this.assertReachable(user, input.batchId);
    await this.scope.assertWarehouse(user, input.warehouseId);

    const parent = await this.prisma.batch.findUniqueOrThrow({
      where: { id: input.batchId },
      include: { product: { select: { id: true, genericName: true } } },
    });

    if (TERMINAL_STATUSES.includes(parent.status)) {
      throw new ConflictException(
        `Batch ${parent.batchNumber} is ${parent.status}; a terminal batch cannot be split`,
      );
    }

    const warehouse = await this.prisma.warehouse.findUniqueOrThrow({
      where: { id: input.warehouseId },
      select: { branchId: true },
    });

    const child = await this.prisma.$transaction(
      async (tx) => {
        const position = await tx.inventoryBalance.findFirst({
          where: {
            batchId: parent.id,
            warehouseId: input.warehouseId,
            ...(input.locationId ? { locationId: input.locationId } : {}),
          },
          orderBy: { onHand: 'desc' },
        });
        if (!position) {
          throw new ConflictException('This batch holds no stock in that warehouse');
        }
        const available = position.onHand.minus(position.reserved);
        if (available.lessThan(input.quantity)) {
          throw new ConflictException(
            `Cannot split ${input.quantity}: only ${available.toString()} is unreserved there`,
          );
        }

        // A split keeps the parent's identity visible in the child's number:
        // AMX26001-2 is obviously the second split of AMX26001, which is what
        // somebody reading a shelf label needs.
        let batchNumber = input.newBatchNumber?.trim() ?? '';
        if (!batchNumber) {
          const siblings = await tx.batch.count({ where: { parentBatchId: parent.id } });
          batchNumber = `${parent.batchNumber}-${siblings + 1}`;
        }

        const clash = await tx.batch.findFirst({
          where: { productId: parent.productId, batchNumber },
          select: { id: true },
        });
        if (clash) {
          throw new ConflictException(
            `Batch number ${batchNumber} already exists for ${parent.product.genericName}`,
          );
        }

        const created = await tx.batch.create({
          data: {
            batchNumber,
            lotNumber: parent.lotNumber,
            productId: parent.productId,
            supplierId: parent.supplierId,
            manufacturerName: parent.manufacturerName,
            manufacturingDate: parent.manufacturingDate,
            // The child is the same medicine: it expires when the parent does
            // and it cost what the parent cost. Anything else would launder an
            // expiry date or a cost through a repack.
            expiryDate: parent.expiryDate,
            purchaseCost: parent.purchaseCost,
            receivedQuantity: new Prisma.Decimal(input.quantity),
            status: parent.status,
            quarantineReason: parent.quarantineReason,
            supplierInvoiceNo: parent.supplierInvoiceNo,
            purchaseOrderId: parent.purchaseOrderId,
            goodsReceiptId: parent.goodsReceiptId,
            parentBatchId: parent.id,
          },
        });

        await this.ledger.post(tx, {
          type: TransactionType.ADJUSTMENT,
          direction: 'OUT',
          productId: parent.productId,
          batchId: parent.id,
          warehouseId: input.warehouseId,
          locationId: position.locationId,
          branchId: warehouse.branchId,
          quantity: input.quantity,
          unitCost: parent.purchaseCost,
          referenceType: 'BATCH_SPLIT',
          referenceId: created.id,
          referenceNo: batchNumber,
          performedById: user.id,
          reason: `Split to ${batchNumber}: ${input.reason.trim()}`,
          idempotencyKey: `split:out:${created.id}`,
          allowBlockedStatus: true,
        });

        await this.ledger.post(tx, {
          type: TransactionType.ADJUSTMENT,
          direction: 'IN',
          productId: parent.productId,
          batchId: created.id,
          warehouseId: input.warehouseId,
          locationId: input.locationId ?? position.locationId,
          branchId: warehouse.branchId,
          quantity: input.quantity,
          unitCost: parent.purchaseCost,
          referenceType: 'BATCH_SPLIT',
          referenceId: created.id,
          referenceNo: batchNumber,
          performedById: user.id,
          reason: `Split from ${parent.batchNumber}: ${input.reason.trim()}`,
          idempotencyKey: `split:in:${created.id}`,
          allowBlockedStatus: true,
        });

        return created;
      },
      { timeout: 30_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'inventory',
      action: 'BATCH_SPLIT',
      entityType: 'Batch',
      entityId: child.id,
      previousValue: { parentBatch: parent.batchNumber, parentBatchId: parent.id },
      newValue: {
        batchNumber: child.batchNumber,
        quantity: input.quantity,
        expiryDate: child.expiryDate,
      },
      reason: input.reason.trim(),
      branchId: warehouse.branchId,
    });

    return child;
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
