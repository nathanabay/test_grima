import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  BatchStatus,
  DisposalMethod,
  DocumentStatus,
  Prisma,
  TransactionType,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';
import { LedgerService } from '../inventory/ledger.service';
import { DocumentNumberService } from '../common-services/document-number.service';

/**
 * Waste and disposal (§31).
 *
 * Identify -> quarantine -> verify -> approve -> dispose -> certificate.
 * The stock movement happens only at the disposal step, after approval, and the
 * historical ledger rows are never deleted.
 */
@Injectable()
export class DisposalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly docNumbers: DocumentNumberService,
  ) {}

  async create(data: any, user: AuthenticatedUser) {
    if (!data.items?.length) throw new BadRequestException('A disposal needs at least one line');
    if (!data.reason?.trim()) throw new BadRequestException('A disposal reason is required');
    // Without these the create fell through to Prisma and came back as a bare
    // 500 — no field named, nothing the caller could correct. A missing
    // required field is the caller's to fix, so say which one.
    if (!data.branchId) throw new BadRequestException('branchId is required');
    if (!data.warehouseId) throw new BadRequestException('warehouseId is required');
    if (!data.method || !Object.values(DisposalMethod).includes(data.method)) {
      throw new BadRequestException(
        `method must be one of ${Object.values(DisposalMethod).join(', ')}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const disposalNo = await this.docNumbers.next(tx, 'DIS');

      let totalValue = new Prisma.Decimal(0);
      const items: any[] = [];
      for (const i of data.items) {
        const batch = await tx.batch.findUniqueOrThrow({ where: { id: i.batchId } });
        const value = new Prisma.Decimal(i.quantity).times(batch.purchaseCost);
        totalValue = totalValue.plus(value);
        items.push({
          productId: i.productId,
          batchId: i.batchId,
          quantity: new Prisma.Decimal(i.quantity),
          unitCost: batch.purchaseCost,
          reason: i.reason ?? null,
        });
      }

      return tx.disposal.create({
        data: {
          disposalNo,
          branchId: data.branchId,
          warehouseId: data.warehouseId,
          status: DocumentStatus.SUBMITTED,
          method: data.method as DisposalMethod,
          reason: data.reason,
          createdById: user.id,
          totalCostValue: totalValue,
          items: { create: items },
        },
        include: { items: true },
      });
    });
  }

  async approve(id: string, user: AuthenticatedUser) {
    const disposal = await this.prisma.disposal.findUniqueOrThrow({ where: { id } });
    if (disposal.status !== DocumentStatus.SUBMITTED) {
      throw new ConflictException(`Disposal is ${disposal.status} and cannot be approved`);
    }
    const updated = await this.prisma.disposal.update({
      where: { id },
      data: { status: DocumentStatus.APPROVED, approvedById: user.id, approvedAt: new Date() },
    });
    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'quality',
      action: 'APPROVE',
      entityType: 'Disposal',
      entityId: id,
      previousValue: { status: disposal.status },
      newValue: { status: DocumentStatus.APPROVED },
      branchId: disposal.branchId,
    });
    return updated;
  }

  /** Execute the disposal: stock leaves, certificate is recorded. */
  async execute(
    id: string,
    data: { witnessName: string; certificateNo: string; certificateUrl?: string },
    user: AuthenticatedUser,
  ) {
    const disposal = await this.prisma.disposal.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });
    if (disposal.status !== DocumentStatus.APPROVED) {
      throw new ConflictException('Disposal must be approved before it is carried out');
    }
    if (!data.witnessName?.trim() || !data.certificateNo?.trim()) {
      throw new BadRequestException('A witness and a disposal certificate number are required (§31)');
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of disposal.items) {
        await this.ledger.post(tx, {
          type: TransactionType.DISPOSAL,
          direction: 'OUT',
          productId: item.productId,
          batchId: item.batchId,
          warehouseId: disposal.warehouseId,
          branchId: disposal.branchId,
          quantity: item.quantity,
          unitCost: item.unitCost,
          referenceType: 'DISPOSAL',
          referenceId: disposal.id,
          referenceNo: disposal.disposalNo,
          reason: `${disposal.method}: ${disposal.reason}`,
          performedById: user.id,
          allowBlockedStatus: true,
          idempotencyKey: `disposal:${disposal.id}:${item.id}`,
        });

        const remaining = await tx.inventoryBalance.aggregate({
          where: { batchId: item.batchId },
          _sum: { onHand: true },
        });
        if (Number(remaining._sum.onHand ?? 0) <= 0) {
          await tx.batch.update({
            where: { id: item.batchId },
            data: { status: BatchStatus.DESTROYED },
          });
        }
      }

      await tx.disposal.update({
        where: { id },
        data: {
          status: DocumentStatus.CLOSED,
          disposedAt: new Date(),
          witnessName: data.witnessName,
          certificateNo: data.certificateNo,
          certificateUrl: data.certificateUrl ?? null,
        },
      });
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'quality',
      action: 'DISPOSAL_EXECUTED',
      entityType: 'Disposal',
      entityId: id,
      newValue: {
        disposalNo: disposal.disposalNo,
        certificateNo: data.certificateNo,
        witness: data.witnessName,
        value: disposal.totalCostValue.toString(),
      },
      branchId: disposal.branchId,
    });

    return this.prisma.disposal.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });
  }

  async findAll(query: { page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, query.pageSize ?? 25);
    const [data, total] = await Promise.all([
      this.prisma.disposal.findMany({
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.disposal.count(),
    ]);
    return { data, total, page, pageSize };
  }
}
