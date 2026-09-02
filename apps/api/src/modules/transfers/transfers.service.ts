import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma, TransferStatus, TransactionType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';
import { ScopeService } from '../../common/guards/scope.service';
import { LedgerService } from '../inventory/ledger.service';
import { DocumentNumberService } from '../common-services/document-number.service';

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
    vehicleOrCourier?: string,
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
            vehicleOrCourier: vehicleOrCourier ?? null,
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
      newValue: { lines: lines.length, vehicleOrCourier },
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
