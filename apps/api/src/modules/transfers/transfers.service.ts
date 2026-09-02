import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma, TransferStatus, TransactionType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';
import { ScopeService } from '../../common/guards/scope.service';
import { LedgerService } from '../inventory/ledger.service';
import { DocumentNumberService } from '../common-services/document-number.service';
import { ConfigService } from '../../common/config/config.service';

/**
 * Stock transfers (§20).
 *
 * Dispatch moves stock out of the origin and into an in-transit position;
 * receipt moves it into the destination. Modelling transit explicitly means
 * stock is never invisible and never double-counted, and partial shipments
 * reconcile naturally.
 */
@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly docNumbers: DocumentNumberService,
    private readonly scope: ScopeService,
    private readonly config: ConfigService,
  ) {}

  async create(data: any, user: AuthenticatedUser) {
    if (!data.items?.length) throw new BadRequestException('A transfer needs at least one line');

    const [from, to] = await Promise.all([
      this.prisma.warehouse.findUniqueOrThrow({ where: { id: data.fromWarehouseId } }),
      this.prisma.warehouse.findUniqueOrThrow({ where: { id: data.toWarehouseId } }),
    ]);
    if (from.id === to.id) {
      throw new BadRequestException('Origin and destination warehouses must differ');
    }

    // §4: stock may only be sent FROM a warehouse the user can reach. The
    // destination is deliberately unrestricted so branches can request stock
    // from each other.
    await this.scope.assertWarehouse(user, from.id);

    const transfer = await this.prisma.$transaction(async (tx) => {
      const transferNo = await this.docNumbers.next(tx, 'TRF');
      return tx.stockTransfer.create({
        data: {
          transferNo,
          fromWarehouseId: from.id,
          toWarehouseId: to.id,
          fromBranchId: from.branchId,
          toBranchId: to.branchId,
          status: TransferStatus.DRAFT,
          reason: data.reason ?? null,
          requestedById: user.id,
          isRecallMovement: data.isRecallMovement ?? false,
          items: {
            create: data.items.map((i: any) => ({
              productId: i.productId,
              batchId: i.batchId,
              requestedQty: new Prisma.Decimal(i.quantity),
            })),
          },
        },
        include: { items: true },
      });
    });

    await this.audit.record({
      userId: user.id,
      module: 'inventory',
      action: 'CREATE',
      entityType: 'StockTransfer',
      entityId: transfer.id,
      newValue: { transferNo: transfer.transferNo, lines: transfer.items.length },
      branchId: from.branchId,
    });

    return transfer;
  }

  async submit(id: string, user: AuthenticatedUser) {
    return this.setStatus(id, TransferStatus.SUBMITTED, user);
  }

  async approve(id: string, user: AuthenticatedUser) {
    const transfer = await this.prisma.stockTransfer.findUniqueOrThrow({ where: { id } });
    if (transfer.status !== TransferStatus.SUBMITTED) {
      throw new ConflictException(`Only submitted transfers can be approved; this is ${transfer.status}`);
    }
    const updated = await this.prisma.stockTransfer.update({
      where: { id },
      data: { status: TransferStatus.APPROVED, approvedById: user.id },
    });
    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'inventory',
      action: 'APPROVE',
      entityType: 'StockTransfer',
      entityId: id,
      previousValue: { status: transfer.status },
      newValue: { status: TransferStatus.APPROVED },
      branchId: transfer.fromBranchId,
    });
    return updated;
  }

  /** Dispatch: stock leaves the origin warehouse. Supports partial shipment. */
  async dispatch(
    id: string,
    lines: Array<{ itemId: string; quantity: number }>,
    user: AuthenticatedUser,
    logistics: {
      vehicleOrCourier?: string;
      driverName?: string;
      driverPhone?: string;
      trackingNumber?: string;
      /** When the destination should expect it; drives the overdue alert. */
      expectedArrival?: string | Date;
    } = {},
  ) {
    const transfer = await this.prisma.stockTransfer.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });
    if (!([TransferStatus.APPROVED, TransferStatus.PICKING] as TransferStatus[]).includes(transfer.status)) {
      throw new ConflictException(
        `Transfer must be APPROVED before dispatch; it is ${transfer.status}`,
      );
    }

    let expectedArrival: Date | null = null;
    if (logistics.expectedArrival) {
      expectedArrival = new Date(logistics.expectedArrival);
      if (Number.isNaN(expectedArrival.getTime())) {
        throw new BadRequestException('The expected arrival is not a valid date');
      }
      if (expectedArrival.getTime() < Date.now() - 60_000) {
        // An arrival already in the past would make the transfer overdue the
        // moment it left, which tells the destination nothing.
        throw new BadRequestException('The expected arrival must be in the future');
      }
    }

    await this.prisma.$transaction(
      async (tx) => {
        for (const line of lines) {
          const item = transfer.items.find((i) => i.id === line.itemId);
          if (!item) throw new BadRequestException(`Line ${line.itemId} is not on this transfer`);

          const outstanding = item.requestedQty.minus(item.dispatchedQty);
          if (new Prisma.Decimal(line.quantity).greaterThan(outstanding)) {
            throw new ConflictException(
              `Cannot dispatch ${line.quantity}: only ${outstanding.toString()} outstanding on this line`,
            );
          }

          await this.ledger.post(tx, {
            type: TransactionType.TRANSFER_OUT,
            direction: 'OUT',
            productId: item.productId,
            batchId: item.batchId,
            warehouseId: transfer.fromWarehouseId,
            branchId: transfer.fromBranchId,
            quantity: line.quantity,
            referenceType: 'STOCK_TRANSFER',
            referenceId: transfer.id,
            referenceNo: transfer.transferNo,
            performedById: user.id,
            // A recall movement is the one case where blocked stock may move.
            allowBlockedStatus: transfer.isRecallMovement,
            idempotencyKey: `transfer-out:${transfer.id}:${item.id}:${item.dispatchedQty.toString()}`,
          });

          await tx.stockTransferItem.update({
            where: { id: item.id },
            data: { dispatchedQty: { increment: new Prisma.Decimal(line.quantity) } },
          });
        }

        await tx.stockTransfer.update({
          where: { id },
          data: {
            status: TransferStatus.IN_TRANSIT,
            dispatchedById: user.id,
            dispatchedAt: new Date(),
            vehicleOrCourier: logistics.vehicleOrCourier ?? null,
            driverName: logistics.driverName ?? null,
            driverPhone: logistics.driverPhone ?? null,
            trackingNumber: logistics.trackingNumber ?? null,
            expectedArrival: expectedArrival ?? null,
          },
        });
      },
      { timeout: 30_000 },
    );

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'inventory',
      action: 'TRANSFER_DISPATCH',
      entityType: 'StockTransfer',
      entityId: id,
      newValue: {
        lines: lines.length,
        vehicleOrCourier: logistics.vehicleOrCourier ?? null,
        trackingNumber: logistics.trackingNumber ?? null,
        // The driver's phone is deliberately not written to the audit payload:
        // it is personal data, and the transfer row already holds it (§73).
        driverName: logistics.driverName ?? null,
        expectedArrival: expectedArrival?.toISOString() ?? null,
      },
      branchId: transfer.fromBranchId,
    });

    return this.findOne(id);
  }

  /** Receipt at the destination. Differences are recorded, not hidden. */
  async receive(
    id: string,
    lines: Array<{ itemId: string; quantity: number; varianceReason?: string }>,
    user: AuthenticatedUser,
  ) {
    const transfer = await this.prisma.stockTransfer.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });
    if (!([TransferStatus.IN_TRANSIT, TransferStatus.PARTIALLY_RECEIVED] as TransferStatus[]).includes(transfer.status)) {
      throw new ConflictException(`Transfer is ${transfer.status} and cannot be received`);
    }

    await this.prisma.$transaction(
      async (tx) => {
        for (const line of lines) {
          const item = transfer.items.find((i) => i.id === line.itemId);
          if (!item) throw new BadRequestException(`Line ${line.itemId} is not on this transfer`);

          const inTransit = item.dispatchedQty.minus(item.receivedQty);
          if (new Prisma.Decimal(line.quantity).greaterThan(inTransit)) {
            throw new ConflictException(
              `Cannot receive ${line.quantity}: only ${inTransit.toString()} is in transit on this line`,
            );
          }
          // A shortfall on arrival must be explained (§20).
          if (
            new Prisma.Decimal(line.quantity).lessThan(inTransit) &&
            !line.varianceReason?.trim()
          ) {
            throw new BadRequestException(
              `Receiving ${line.quantity} of ${inTransit.toString()} in transit requires a variance reason`,
            );
          }

          await this.ledger.post(tx, {
            type: TransactionType.TRANSFER_IN,
            direction: 'IN',
            productId: item.productId,
            batchId: item.batchId,
            warehouseId: transfer.toWarehouseId,
            branchId: transfer.toBranchId,
            quantity: line.quantity,
            referenceType: 'STOCK_TRANSFER',
            referenceId: transfer.id,
            referenceNo: transfer.transferNo,
            performedById: user.id,
            idempotencyKey: `transfer-in:${transfer.id}:${item.id}:${item.receivedQty.toString()}`,
          });

          await tx.stockTransferItem.update({
            where: { id: item.id },
            data: {
              receivedQty: { increment: new Prisma.Decimal(line.quantity) },
              varianceReason: line.varianceReason ?? item.varianceReason,
            },
          });
        }

        const refreshed = await tx.stockTransferItem.findMany({ where: { transferId: id } });
        const complete = refreshed.every((i) => i.receivedQty.greaterThanOrEqualTo(i.dispatchedQty));

        await tx.stockTransfer.update({
          where: { id },
          data: {
            status: complete ? TransferStatus.COMPLETED : TransferStatus.PARTIALLY_RECEIVED,
            receivedById: user.id,
            receivedAt: complete ? new Date() : null,
          },
        });
      },
      { timeout: 30_000 },
    );

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'inventory',
      action: 'TRANSFER_RECEIVE',
      entityType: 'StockTransfer',
      entityId: id,
      newValue: { lines: lines.length },
      branchId: transfer.toBranchId,
    });

    return this.findOne(id);
  }

  private async setStatus(id: string, status: TransferStatus, user: AuthenticatedUser) {
    const transfer = await this.prisma.stockTransfer.update({ where: { id }, data: { status } });
    await this.audit.record({
      userId: user.id,
      module: 'inventory',
      action: 'STATUS_CHANGE',
      entityType: 'StockTransfer',
      entityId: id,
      newValue: { status },
    });
    return transfer;
  }

  async findOne(id: string) {
    return this.prisma.stockTransfer.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });
  }

  /**
   * Transfers that should have arrived and have not (§20: feature 233).
   *
   * Stock in transit is stock nobody can sell and nobody has counted. A
   * transfer that quietly stays IN_TRANSIT is either lost, stolen, or sitting
   * in a receiving bay unrecorded, and all three need somebody to look.
   *
   * Where no expected arrival was given, the configured transit allowance is
   * used, so a dispatch made without logistics detail is still watched.
   */
  async overdueInTransit(defaultTransitDays?: number) {
    const allowanceDays =
      defaultTransitDays ?? (await this.config.getNumber('inventory.transferTransitDays'));
    const now = Date.now();
    const fallbackCutoff = new Date(now - allowanceDays * 86_400_000);

    const transfers = await this.prisma.stockTransfer.findMany({
      where: {
        status: { in: [TransferStatus.IN_TRANSIT, TransferStatus.PARTIALLY_RECEIVED] },
        OR: [
          { expectedArrival: { lt: new Date(now) } },
          { expectedArrival: null, dispatchedAt: { lt: fallbackCutoff } },
        ],
      },
      include: { items: true },
      orderBy: [{ dispatchedAt: 'asc' }],
    });

    const warehouseIds = [
      ...new Set(transfers.flatMap((t) => [t.fromWarehouseId, t.toWarehouseId])),
    ];
    const warehouses = warehouseIds.length
      ? await this.prisma.warehouse.findMany({
          where: { id: { in: warehouseIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(warehouses.map((w) => [w.id, w.name]));

    return transfers.map((t) => {
      const due = t.expectedArrival ?? new Date((t.dispatchedAt?.getTime() ?? now) + allowanceDays * 86_400_000);
      const daysLate = Math.floor((now - due.getTime()) / 86_400_000);
      const inTransitQty = t.items.reduce(
        (sum, i) => sum.plus(i.dispatchedQty.minus(i.receivedQty)),
        new Prisma.Decimal(0),
      );

      return {
        id: t.id,
        transferNo: t.transferNo,
        status: t.status,
        fromWarehouse: nameById.get(t.fromWarehouseId) ?? t.fromWarehouseId,
        toWarehouse: nameById.get(t.toWarehouseId) ?? t.toWarehouseId,
        dispatchedAt: t.dispatchedAt,
        expectedArrival: t.expectedArrival,
        expectedBasis: t.expectedArrival ? 'STATED' : 'DEFAULT_TRANSIT_ALLOWANCE',
        daysLate,
        inTransitQuantity: inTransitQty.toString(),
        vehicleOrCourier: t.vehicleOrCourier,
        trackingNumber: t.trackingNumber,
        driverName: t.driverName,
        // Escalation is by lateness, because a day late is a phone call and a
        // week late is an investigation.
        severity: daysLate >= 7 ? 'CRITICAL' : daysLate >= 3 ? 'HIGH' : 'MEDIUM',
      };
    });
  }

  async findAll(query: { status?: TransferStatus; warehouseId?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, query.pageSize ?? 25);
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.warehouseId
        ? { OR: [{ fromWarehouseId: query.warehouseId }, { toWarehouseId: query.warehouseId }] }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.stockTransfer.findMany({
        where,
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.stockTransfer.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }
}
