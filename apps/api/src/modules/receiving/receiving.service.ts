import { BadRequestException, Injectable } from '@nestjs/common';
import {
  BatchStatus,
  DocumentStatus,
  Prisma,
  PurchaseOrderStatus,
  TransactionType,
} from '@prisma/client';
import { daysUntil } from '@pharmacore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';
import { ScopeService } from '../../common/guards/scope.service';
import { ValuationService } from '../accounting/valuation.service';
import { ConfigService } from '../../common/config/config.service';
import { LedgerService } from '../inventory/ledger.service';
import { DocumentNumberService } from '../common-services/document-number.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface ReceiveLineInput {
  productId: string;
  batchNumber: string;
  expiryDate: string | Date;
  manufacturingDate?: string | Date;
  /** Quantity in `unitCode`; converted to base units before anything is stored. */
  quantity: number;
  unitCode?: string;
  unitCost: number;
  locationId?: string;
  packagingDamaged?: boolean;
  serials?: string[];
  /**
   * Quantity refused at the door (§15). Only the accepted remainder enters
   * stock; the rejected portion is recorded on the receipt for the supplier
   * claim and feeds the supplier rejection-rate KPI.
   */
  rejectedQty?: number;
  rejectionReason?: string;
}

export interface ReceiveInput {
  purchaseOrderId?: string;
  supplierId: string;
  warehouseId: string;
  branchId: string;
  supplierInvoiceNo?: string;
  lines: ReceiveLineInput[];
  notes?: string;
}

/**
 * Goods receiving (§15).
 *
 * Received stock lands in the warehouse but every new batch starts
 * QUARANTINED, so FEFO will not allocate it until QA releases it (§16, §72).
 * Receiving exceptions are flagged, never silently accepted.
 */
@Injectable()
export class ReceivingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly docNumbers: DocumentNumberService,
    private readonly notifications: NotificationsService,
    private readonly scope: ScopeService,
    private readonly valuation: ValuationService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Verification rules from §15. Returns a flag list per line; the caller
   * decides whether to accept, and QA sees the flags on the batch.
   */
  private async evaluateLine(
    line: ReceiveLineInput,
    baseQuantity: number,
    purchaseOrderId: string | undefined,
    tx: Prisma.TransactionClient,
  ): Promise<{ flags: string[]; orderedQty?: Prisma.Decimal; expectedPrice?: Prisma.Decimal }> {
    const flags: string[] = [];
    const product = await tx.product.findUnique({
      where: { id: line.productId },
      select: { minShelfLifeDaysOnReceipt: true, genericName: true, purchaseCost: true },
    });
    if (!product) {
      return { flags: ['UNKNOWN_PRODUCT'] };
    }

    // A product that states its own minimum keeps it; anything left at the
    // schema default falls back to the organisation setting.
    const orgMinimum = await this.config.getNumber('expiry.minShelfLifeOnReceiptDays');
    const requiredShelfLife = Math.max(product.minShelfLifeDaysOnReceipt, orgMinimum);

    const expiry = new Date(line.expiryDate);
    if (Number.isNaN(expiry.getTime())) flags.push('INVALID_EXPIRY');
    else {
      const remaining = daysUntil(expiry);
      if (remaining < 0) flags.push('EXPIRED_ON_ARRIVAL');
      // The product's own rule wins where it is set; the organisation setting
      // is the floor for everything else (§65).
      else if (remaining < requiredShelfLife) {
        flags.push(
          `SHORT_SHELF_LIFE:${remaining}d_of_${requiredShelfLife}d_required`,
        );
      }
    }

    if (line.packagingDamaged) flags.push('DAMAGED_PACKAGING');

    let orderedQty: Prisma.Decimal | undefined;
    let expectedPrice: Prisma.Decimal | undefined;

    if (purchaseOrderId) {
      const poItem = await tx.purchaseOrderItem.findFirst({
        where: { purchaseOrderId, productId: line.productId },
      });
      if (!poItem) {
        flags.push('NOT_ON_PURCHASE_ORDER');
      } else {
        orderedQty = poItem.orderedQty;
        expectedPrice = poItem.unitPrice;
        const outstanding = poItem.orderedQty.minus(poItem.receivedQty);
        if (new Prisma.Decimal(baseQuantity).greaterThan(outstanding)) {
          flags.push(
            `OVER_DELIVERY:received_${baseQuantity}_outstanding_${outstanding.toString()}`,
          );
        } else if (new Prisma.Decimal(baseQuantity).lessThan(outstanding)) {
          flags.push(`UNDER_DELIVERY:received_${baseQuantity}_outstanding_${outstanding.toString()}`);
        }
        // Tolerate rounding, flag genuine price differences.
        const priceDelta = new Prisma.Decimal(line.unitCost).minus(poItem.unitPrice).abs();
        if (priceDelta.greaterThan(poItem.unitPrice.times(0.01))) {
          flags.push(
            `PRICE_VARIANCE:received_${line.unitCost}_expected_${poItem.unitPrice.toString()}`,
          );
        }
      }
    }

    const existingBatch = await tx.batch.findFirst({
      where: { productId: line.productId, batchNumber: line.batchNumber },
    });
    if (existingBatch) flags.push('EXISTING_BATCH_NUMBER');

    return { flags, orderedQty, expectedPrice };
  }

  async receive(input: ReceiveInput, user: AuthenticatedUser) {
    if (!input.lines?.length) {
      throw new BadRequestException('A goods receipt must contain at least one line');
    }

    // §4: goods may only be received into a warehouse the user can reach.
    this.scope.assertBranch(user, input.branchId);
    await this.scope.assertWarehouse(user, input.warehouseId);

    const result = await this.prisma.$transaction(
      async (tx) => {
        const grnNo = await this.docNumbers.next(tx, 'GRN');

        const receipt = await tx.goodsReceipt.create({
          data: {
            grnNo,
            purchaseOrderId: input.purchaseOrderId ?? null,
            supplierId: input.supplierId,
            warehouseId: input.warehouseId,
            branchId: input.branchId,
            supplierInvoiceNo: input.supplierInvoiceNo ?? null,
            status: DocumentStatus.SUBMITTED,
            receivedById: user.id,
            notes: input.notes ?? null,
          },
        });

        const createdBatches: Array<{ id: string; batchNumber: string; flags: string[] }> = [];

        for (const line of input.lines) {
          // §6: convert to base units exactly once, here.
          const units = await tx.productUnit.findMany({ where: { productId: line.productId } });
          const unit = line.unitCode
            ? units.find((u) => u.code === line.unitCode)
            : units.find((u) => u.isBaseUnit);
          if (line.unitCode && !unit) {
            throw new BadRequestException(
              `Unit "${line.unitCode}" is not defined for product ${line.productId}`,
            );
          }
          const factor = unit ? Number(unit.factorToBase) : 1;
          const deliveredQuantity = line.quantity * factor;
          if (deliveredQuantity <= 0) {
            throw new BadRequestException('Received quantity must be greater than zero');
          }

          // §15: a rejected portion never enters stock.
          const rejectedQuantity = (line.rejectedQty ?? 0) * factor;
          if (rejectedQuantity < 0 || rejectedQuantity > deliveredQuantity) {
            throw new BadRequestException(
              `Rejected quantity must be between 0 and the delivered quantity (${line.quantity})`,
            );
          }
          if (rejectedQuantity > 0 && !line.rejectionReason?.trim()) {
            throw new BadRequestException(
              'Rejecting part of a delivery requires a reason',
            );
          }
          const baseQuantity = deliveredQuantity - rejectedQuantity;
          if (baseQuantity <= 0) {
            throw new BadRequestException(
              'The whole delivery line was rejected; record it as a supplier return instead of a receipt',
            );
          }
          // Cost is given per purchase unit; the ledger stores cost per base unit.
          const baseUnitCost = line.unitCost / factor;

          const { flags } = await this.evaluateLine(
            line,
            baseQuantity,
            input.purchaseOrderId,
            tx,
          );

          if (flags.includes('EXPIRED_ON_ARRIVAL')) {
            throw new BadRequestException(
              `Line for batch ${line.batchNumber} is already expired and cannot be received into stock`,
            );
          }

          // A batch number may repeat across receipts; reuse the row if the
          // product+batch already exists, otherwise create it quarantined.
          let batch = await tx.batch.findFirst({
            where: { productId: line.productId, batchNumber: line.batchNumber },
          });

          if (!batch) {
            batch = await tx.batch.create({
              data: {
                batchNumber: line.batchNumber,
                productId: line.productId,
                supplierId: input.supplierId,
                expiryDate: new Date(line.expiryDate),
                manufacturingDate: line.manufacturingDate
                  ? new Date(line.manufacturingDate)
                  : null,
                receivedQuantity: new Prisma.Decimal(baseQuantity),
                purchaseCost: new Prisma.Decimal(baseUnitCost),
                status: BatchStatus.QUARANTINED,
                quarantineReason: 'QUALITY_INVESTIGATION',
                qualityNotes: flags.length
                  ? `Receiving flags: ${flags.join('; ')}`
                  : 'Awaiting routine QA release',
                supplierInvoiceNo: input.supplierInvoiceNo ?? null,
                purchaseOrderId: input.purchaseOrderId ?? null,
                goodsReceiptId: receipt.id,
              },
            });
          } else {
            batch = await tx.batch.update({
              where: { id: batch.id },
              data: {
                receivedQuantity: batch.receivedQuantity.plus(baseQuantity),
              },
            });
          }

          await tx.goodsReceiptItem.create({
            data: {
              goodsReceiptId: receipt.id,
              productId: line.productId,
              batchId: batch.id,
              batchNumber: line.batchNumber,
              expiryDate: new Date(line.expiryDate),
              manufacturingDate: line.manufacturingDate ? new Date(line.manufacturingDate) : null,
              // Delivered, accepted and rejected are three different numbers
              // (§15); only the accepted quantity reached stock above.
              receivedQty: new Prisma.Decimal(deliveredQuantity),
              acceptedQty: new Prisma.Decimal(baseQuantity),
              rejectedQty: new Prisma.Decimal(rejectedQuantity),
              rejectionReason: line.rejectionReason ?? null,
              unitCost: new Prisma.Decimal(baseUnitCost),
              locationId: line.locationId ?? null,
              flags,
            },
          });

          if (line.serials?.length) {
            // Each pack is registered with the warehouse it landed in and an
            // opening RECEIVED event, so its history starts at the door rather
            // than at the first time somebody happened to move it (§3: 145).
            const receivedAt = new Date();
            for (const serial of line.serials) {
              const existing = await tx.serialNumber.findUnique({
                where: { batchId_serial: { batchId: batch!.id, serial } },
                select: { id: true },
              });
              if (existing) continue;

              const created = await tx.serialNumber.create({
                data: {
                  batchId: batch!.id,
                  serial,
                  status: 'IN_STOCK',
                  warehouseId: input.warehouseId,
                  lastReferenceType: 'GOODS_RECEIPT',
                  lastReferenceId: receipt.id,
                  lastMovedAt: receivedAt,
                },
              });
              await tx.serialEvent.create({
                data: {
                  serialId: created.id,
                  eventType: 'RECEIVED',
                  toStatus: 'IN_STOCK',
                  referenceType: 'GOODS_RECEIPT',
                  referenceId: receipt.id,
                  referenceNo: grnNo,
                  warehouseId: input.warehouseId,
                  performedById: user.id,
                  occurredAt: receivedAt,
                },
              });
            }
          }

          // Stock physically arrives now; the QUARANTINED batch status is what
          // keeps FEFO from allocating it until QA releases (§16).
          await this.ledger.post(tx, {
            type: TransactionType.PURCHASE_RECEIPT,
            direction: 'IN',
            productId: line.productId,
            batchId: batch.id,
            warehouseId: input.warehouseId,
            locationId: line.locationId ?? null,
            branchId: input.branchId,
            quantity: baseQuantity,
            unitCost: baseUnitCost,
            referenceType: 'GOODS_RECEIPT',
            referenceId: receipt.id,
            referenceNo: grnNo,
            performedById: user.id,
            idempotencyKey: `grn:${receipt.id}:${line.productId}:${line.batchNumber}`,
          });

          if (input.purchaseOrderId) {
            await tx.purchaseOrderItem.updateMany({
              where: { purchaseOrderId: input.purchaseOrderId, productId: line.productId },
              data: { receivedQty: { increment: new Prisma.Decimal(baseQuantity) } },
            });
          }

          // Costing (§32). Delegated to the valuation service, which writes the
          // FIFO cost layer and recomputes the weighted average in decimal
          // arithmetic. This used to be done inline in floating point, which
          // §51 forbids for money and which drifted by fractions of a cent on
          // every receipt.
          await this.valuation.recordReceipt(tx, {
            productId: line.productId,
            batchId: batch.id,
            warehouseId: input.warehouseId,
            quantity: baseQuantity,
            unitCost: baseUnitCost,
            receivedAt: receipt.receivedAt ?? new Date(),
          });

          createdBatches.push({ id: batch.id, batchNumber: batch.batchNumber, flags });
        }

        if (input.purchaseOrderId) {
          const po = await tx.purchaseOrder.findUniqueOrThrow({
            where: { id: input.purchaseOrderId },
            include: { items: true },
          });
          const fullyReceived = po.items.every((i) => i.receivedQty.greaterThanOrEqualTo(i.orderedQty));
          await tx.purchaseOrder.update({
            where: { id: po.id },
            data: {
              status: fullyReceived
                ? PurchaseOrderStatus.RECEIVED
                : PurchaseOrderStatus.PARTIALLY_RECEIVED,
            },
          });
        }

        return { receipt, createdBatches, grnNo };
      },
      { timeout: 30_000 },
    );

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'inventory',
      action: 'GOODS_RECEIPT',
      entityType: 'GoodsReceipt',
      entityId: result.receipt.id,
      newValue: {
        grnNo: result.grnNo,
        lines: input.lines.length,
        batches: result.createdBatches.map((b) => b.batchNumber),
      },
      branchId: input.branchId,
    });

    const flagged = result.createdBatches.filter((b) => b.flags.length);
    if (flagged.length) {
      await this.notifications.emit({
        eventType: 'RECEIVING_EXCEPTION',
        severity: 'WARNING',
        title: `Goods receipt ${result.grnNo} raised ${flagged.length} exception(s)`,
        body: flagged
          .map((b) => `Batch ${b.batchNumber}: ${b.flags.join(', ')}`)
          .join('\n'),
        branchId: input.branchId,
        roleCodes: ['QA_OFFICER', 'WAREHOUSE_MANAGER'],
        linkUrl: `/receiving?id=${result.receipt.id}`,
      });
    } else if (result.createdBatches.length) {
      // A clean delivery used to notify nobody. Every batch lands QUARANTINED,
      // so a normal delivery was unsellable and silent until the fourteen-day
      // quarantine-ageing rule fired — two weeks of stock on a shelf that
      // nothing could dispense and nobody had been asked to release.
      await this.notifications.emit({
        eventType: 'BATCH_AWAITING_RELEASE',
        severity: 'INFO',
        title: `${result.createdBatches.length} batch(es) awaiting release from ${result.grnNo}`,
        body:
          `Received without exception and quarantined pending a quality decision: ` +
          result.createdBatches.map((b) => b.batchNumber).join(', '),
        branchId: input.branchId,
        roleCodes: ['QA_OFFICER'],
        linkUrl: `/batches/${result.createdBatches[0].id}`,
      });
    }

    return this.findOne(result.receipt.id);
  }

  async findOne(id: string) {
    return this.prisma.goodsReceipt.findUniqueOrThrow({
      where: { id },
      include: {
        items: true,
        purchaseOrder: { select: { poNo: true, supplierId: true } },
      },
    });
  }

  async findAll(query: { warehouseId?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, query.pageSize ?? 25);
    const where = query.warehouseId ? { warehouseId: query.warehouseId } : {};

    const [data, total] = await Promise.all([
      this.prisma.goodsReceipt.findMany({
        where,
        include: { items: true },
        orderBy: { receivedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.goodsReceipt.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }
}
