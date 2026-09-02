import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  BatchStatus,
  DocumentStatus,
  Prisma,
  ReturnDisposition,
  ReturnType,
  TransactionType,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';
import { LedgerService } from '../inventory/ledger.service';
import { DocumentNumberService } from '../common-services/document-number.service';

/**
 * Returns (§26).
 *
 * Returned medicine NEVER goes straight back to sellable stock. It comes in
 * against a quarantine batch status and waits for an inspection decision;
 * only a RESTOCK disposition puts it back into circulation.
 */
@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly docNumbers: DocumentNumberService,
  ) {}

  async create(data: any, user: AuthenticatedUser) {
    if (!data.items?.length) throw new BadRequestException('A return needs at least one line');
    if (!data.reason?.trim()) throw new BadRequestException('A return reason is required');

    const doc = await this.prisma.$transaction(
      async (tx) => {
        const returnNo = await this.docNumbers.next(tx, 'RET');
        const created = await tx.returnDocument.create({
          data: {
            returnNo,
            type: data.type as ReturnType,
            branchId: data.branchId,
            warehouseId: data.warehouseId,
            saleId: data.saleId ?? null,
            dispensingId: data.dispensingId ?? null,
            purchaseOrderId: data.purchaseOrderId ?? null,
            supplierId: data.supplierId ?? null,
            patientId: data.patientId ?? null,
            status: DocumentStatus.SUBMITTED,
            reason: data.reason,
            createdById: user.id,
            items: {
              create: data.items.map((i: any) => ({
                productId: i.productId,
                batchId: i.batchId,
                quantity: new Prisma.Decimal(i.quantity),
                condition: i.condition ?? null,
                disposition: ReturnDisposition.PENDING_INSPECTION,
              })),
            },
          },
          include: { items: true },
        });

        // Customer and branch returns bring stock physically back; supplier
        // returns send it out. Either way the batch cannot be sold until a
        // disposition is recorded.
        if (data.type !== ReturnType.SUPPLIER) {
          for (const item of created.items) {
            await this.ledger.post(tx, {
              type: TransactionType.RETURN_IN,
              direction: 'IN',
              productId: item.productId,
              batchId: item.batchId,
              warehouseId: data.warehouseId,
              branchId: data.branchId,
              quantity: item.quantity,
              referenceType: 'RETURN',
              referenceId: created.id,
              referenceNo: returnNo,
              reason: data.reason,
              performedById: user.id,
              allowBlockedStatus: true,
            });

            // §26: returned stock is not sellable until inspected.
            const batch = await tx.batch.findUniqueOrThrow({ where: { id: item.batchId } });
            if (([BatchStatus.AVAILABLE, BatchStatus.RELEASED] as BatchStatus[]).includes(batch.status)) {
              await tx.batch.update({
                where: { id: item.batchId },
                data: {
                  status: BatchStatus.QUARANTINED,
                  quarantineReason: 'QUALITY_INVESTIGATION',
                  qualityNotes: `Quarantined pending inspection of return ${returnNo}`,
                },
              });
            }
          }
        }

        return created;
      },
      { timeout: 30_000 },
    );

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'quality',
      action: 'RETURN',
      entityType: 'ReturnDocument',
      entityId: doc.id,
      newValue: { returnNo: doc.returnNo, type: data.type, lines: doc.items.length },
      reason: data.reason,
      branchId: data.branchId,
    });

    return doc;
  }

  /** Inspection decision per line (§26). */
  async inspect(
    id: string,
    decisions: Array<{ itemId: string; disposition: ReturnDisposition; notes?: string }>,
    user: AuthenticatedUser,
  ) {
    const doc = await this.prisma.returnDocument.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });
    if (doc.status === DocumentStatus.CLOSED) {
      throw new ConflictException('This return has already been closed');
    }

    await this.prisma.$transaction(async (tx) => {
      for (const decision of decisions) {
        const item = doc.items.find((i) => i.id === decision.itemId);
        if (!item) throw new BadRequestException(`Line ${decision.itemId} is not on this return`);
        if (decision.disposition === ReturnDisposition.PENDING_INSPECTION) {
          throw new BadRequestException('Inspection must reach a decision');
        }

        await tx.returnItem.update({
          where: { id: item.id },
          data: { disposition: decision.disposition, dispositionNotes: decision.notes ?? null },
        });

        switch (decision.disposition) {
          case ReturnDisposition.RESTOCK: {
            const batch = await tx.batch.findUniqueOrThrow({ where: { id: item.batchId } });
            if (batch.expiryDate.getTime() < Date.now()) {
              throw new BadRequestException(
                `Batch ${batch.batchNumber} has expired and cannot be restocked`,
              );
            }
            await tx.batch.update({
              where: { id: item.batchId },
              data: {
                status: BatchStatus.RELEASED,
                quarantineReason: null,
                qualityNotes: `Released after inspection of return ${doc.returnNo}`,
                releasedById: user.id,
                releasedAt: new Date(),
              },
            });
            break;
          }
          case ReturnDisposition.DESTROY: {
            await this.ledger.post(tx, {
              type: TransactionType.DISPOSAL,
              direction: 'OUT',
              productId: item.productId,
              batchId: item.batchId,
              warehouseId: doc.warehouseId,
              branchId: doc.branchId,
              quantity: item.quantity,
              referenceType: 'RETURN_DISPOSAL',
              referenceId: doc.id,
              referenceNo: doc.returnNo,
              reason: decision.notes ?? 'Destroyed after return inspection',
              performedById: user.id,
              allowBlockedStatus: true,
            });
            await tx.batch.update({
              where: { id: item.batchId },
              data: { status: BatchStatus.DAMAGED },
            });
            break;
          }
          case ReturnDisposition.RETURN_SUPPLIER: {
            await this.ledger.post(tx, {
              type: TransactionType.RETURN_OUT,
              direction: 'OUT',
              productId: item.productId,
              batchId: item.batchId,
              warehouseId: doc.warehouseId,
              branchId: doc.branchId,
              quantity: item.quantity,
              referenceType: 'SUPPLIER_RETURN',
              referenceId: doc.id,
              referenceNo: doc.returnNo,
              reason: decision.notes ?? 'Returned to supplier',
              performedById: user.id,
              allowBlockedStatus: true,
            });
            await tx.batch.update({
              where: { id: item.batchId },
              data: { status: BatchStatus.RETURNED },
            });
            break;
          }
          case ReturnDisposition.QUARANTINE:
          default:
            // Already quarantined on intake; nothing further to move.
            break;
        }
      }

      await tx.returnDocument.update({
        where: { id },
        data: {
          status: DocumentStatus.CLOSED,
          inspectedById: user.id,
          inspectedAt: new Date(),
        },
      });
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'quality',
      action: 'RETURN_INSPECTION',
      entityType: 'ReturnDocument',
      entityId: id,
      newValue: { decisions },
      branchId: doc.branchId,
    });

    return this.findOne(id);
  }

  async findOne(id: string) {
    return this.prisma.returnDocument.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });
  }

  async findAll(query: { type?: ReturnType; branchId?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, query.pageSize ?? 25);
    const where = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.returnDocument.findMany({
        where,
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.returnDocument.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }
}
