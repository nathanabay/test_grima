import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  BatchStatus,
  DamageStatus,
  Prisma,
  QualityIncidentType,
  TransactionType,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';
import { ScopeService } from '../../common/guards/scope.service';
import { LedgerService } from '../inventory/ledger.service';
import { DocumentNumberService } from '../common-services/document-number.service';
import { NotificationsService } from '../notifications/notifications.service';
import { IncidentsService } from './incidents.service';

export const DAMAGE_TYPES = [
  'BREAKAGE',
  'CONTAMINATION',
  'PACKAGING',
  'HANDLING',
  'TEMPERATURE',
  'PEST',
  'OTHER',
] as const;

export interface ReportDamageInput {
  productId: string;
  batchId: string;
  warehouseId: string;
  branchId: string;
  quantity: number;
  reason: string;
  damageType: (typeof DAMAGE_TYPES)[number];
  /** Raise a linked quality incident, e.g. when a supplier is at fault. */
  raiseIncident?: boolean;
  supplierId?: string;
}

/**
 * Damaged stock (§31).
 *
 * "Damaged medicine must be separated from available stock" — so reporting
 * damage moves those units out of inventory immediately via a DAMAGE ledger
 * movement, rather than leaving them on hand where FEFO or a stock count could
 * still pick them up. The report then carries them through verification to a
 * disposal certificate.
 *
 * The units are never deleted: the DAMAGE movement stays in the ledger forever,
 * which is what makes the write-off auditable.
 */
@Injectable()
export class DamageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly docNumbers: DocumentNumberService,
    private readonly notifications: NotificationsService,
    private readonly incidents: IncidentsService,
  ) {}

  async report(input: ReportDamageInput, user: AuthenticatedUser) {
    if (!input.reason?.trim()) {
      throw new BadRequestException('Reporting damage requires a description of what happened');
    }
    if (input.quantity <= 0) {
      throw new BadRequestException('Damaged quantity must be greater than zero');
    }
    this.scope.assertBranch(user, input.branchId);
    await this.scope.assertWarehouse(user, input.warehouseId);

    const batch = await this.prisma.batch.findUniqueOrThrow({
      where: { id: input.batchId },
      include: { product: { select: { genericName: true, strength: true } } },
    });

    const result = await this.prisma.$transaction(
      async (tx) => {
        const reportNo = await this.docNumbers.next(tx, 'DMG');

        // Move the damaged units out of sellable stock straight away.
        await this.ledger.post(tx, {
          type: TransactionType.DAMAGE,
          direction: 'OUT',
          productId: input.productId,
          batchId: input.batchId,
          warehouseId: input.warehouseId,
          branchId: input.branchId,
          quantity: input.quantity,
          unitCost: batch.purchaseCost,
          referenceType: 'DAMAGE_REPORT',
          referenceNo: reportNo,
          reason: `${input.damageType}: ${input.reason}`,
          performedById: user.id,
          // Damage can be found on stock that is already quarantined or blocked.
          allowBlockedStatus: true,
        });

        const totalValue = new Prisma.Decimal(input.quantity).times(batch.purchaseCost);

        const report = await tx.damageReport.create({
          data: {
            reportNo,
            productId: input.productId,
            batchId: input.batchId,
            warehouseId: input.warehouseId,
            branchId: input.branchId,
            quantity: new Prisma.Decimal(input.quantity),
            unitCost: batch.purchaseCost,
            totalValue,
            reason: input.reason,
            damageType: input.damageType,
            status: DamageStatus.REPORTED,
            reportedById: user.id,
          },
        });

        // If nothing sellable is left, the batch itself is damaged.
        const remaining = await tx.inventoryBalance.aggregate({
          where: { batchId: input.batchId },
          _sum: { onHand: true },
        });
        if (
          Number(remaining._sum.onHand ?? 0) <= 0 &&
          ![BatchStatus.DESTROYED, BatchStatus.EXPIRED].includes(batch.status as any)
        ) {
          await tx.batch.update({
            where: { id: input.batchId },
            data: {
              status: BatchStatus.DAMAGED,
              qualityNotes: `All remaining stock damaged — report ${reportNo}`,
            },
          });
        }

        return report;
      },
      { timeout: 20_000 },
    );

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'quality',
      action: 'DAMAGE_REPORTED',
      entityType: 'DamageReport',
      entityId: result.id,
      newValue: {
        reportNo: result.reportNo,
        batch: batch.batchNumber,
        quantity: input.quantity,
        value: result.totalValue.toString(),
        damageType: input.damageType,
      },
      reason: input.reason,
      branchId: input.branchId,
    });

    if (input.raiseIncident) {
      const incident = await this.incidents.create(
        {
          type:
            input.damageType === 'TEMPERATURE'
              ? QualityIncidentType.TEMPERATURE_EXCURSION
              : QualityIncidentType.DAMAGED_PRODUCT,
          description: `Damage report ${result.reportNo}: ${input.quantity} unit(s) of ${batch.product.genericName} ${batch.product.strength}, batch ${batch.batchNumber}. ${input.reason}`,
          productId: input.productId,
          batchId: input.batchId,
          supplierId: input.supplierId,
          branchId: input.branchId,
        },
        user,
      );
      await this.prisma.damageReport.update({
        where: { id: result.id },
        data: { incidentId: incident.id },
      });
    }

    await this.notifications.emit({
      eventType: 'STOCK_DAMAGE',
      severity: Number(result.totalValue) > 5000 ? 'CRITICAL' : 'WARNING',
      title: `Damage reported: ${batch.product.genericName} batch ${batch.batchNumber}`,
      body:
        `${input.quantity} unit(s) written off, value ${result.totalValue.toString()}.\n` +
        `${input.damageType}: ${input.reason}\n` +
        `Needs verification before disposal.`,
      branchId: input.branchId,
      roleCodes: ['QA_OFFICER', 'WAREHOUSE_MANAGER'],
      linkUrl: `/damage?id=${result.id}`,
    });

    return this.findOne(result.id);
  }

  /** QA verification. Rejecting returns the units to stock (§31 "Verify"). */
  async verify(
    id: string,
    decision: 'VERIFY' | 'REJECT',
    user: AuthenticatedUser,
    notes?: string,
  ) {
    const report = await this.prisma.damageReport.findUniqueOrThrow({ where: { id } });

    if (report.status !== DamageStatus.REPORTED) {
      throw new ConflictException(`Damage report is ${report.status} and cannot be verified again`);
    }
    if (decision === 'REJECT' && !notes?.trim()) {
      throw new BadRequestException(
        'Rejecting a damage report requires a reason — the stock is being returned to inventory',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      if (decision === 'REJECT') {
        // The units were not actually damaged: put them back.
        await this.ledger.post(tx, {
          type: TransactionType.ADJUSTMENT,
          direction: 'IN',
          productId: report.productId,
          batchId: report.batchId,
          warehouseId: report.warehouseId,
          branchId: report.branchId,
          quantity: report.quantity,
          unitCost: report.unitCost,
          referenceType: 'DAMAGE_REPORT_REJECTED',
          referenceId: report.id,
          referenceNo: report.reportNo,
          reason: `Damage report rejected on verification: ${notes}`,
          performedById: user.id,
          allowBlockedStatus: true,
        });

        // Restore a batch that was closed out only because of this report.
        const batch = await tx.batch.findUniqueOrThrow({ where: { id: report.batchId } });
        if (batch.status === BatchStatus.DAMAGED && batch.expiryDate > new Date()) {
          await tx.batch.update({
            where: { id: report.batchId },
            data: {
              status: BatchStatus.QUARANTINED,
              quarantineReason: 'QUALITY_INVESTIGATION',
              qualityNotes: `Damage report ${report.reportNo} rejected; awaiting QA release`,
            },
          });
        }
      }

      await tx.damageReport.update({
        where: { id },
        data: {
          status: decision === 'VERIFY' ? DamageStatus.VERIFIED : DamageStatus.REJECTED,
          verifiedById: user.id,
          verifiedAt: new Date(),
          verificationNotes: decision === 'VERIFY' ? (notes ?? null) : null,
          rejectionReason: decision === 'REJECT' ? notes! : null,
        },
      });
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'quality',
      action: decision === 'VERIFY' ? 'DAMAGE_VERIFIED' : 'DAMAGE_REJECTED',
      entityType: 'DamageReport',
      entityId: id,
      previousValue: { status: report.status },
      newValue: { status: decision === 'VERIFY' ? 'VERIFIED' : 'REJECTED' },
      reason: notes,
      branchId: report.branchId,
    });

    return this.findOne(id);
  }

  /** Link verified damage to the disposal that destroyed it. */
  async attachToDisposal(ids: string[], disposalId: string, user: AuthenticatedUser) {
    const reports = await this.prisma.damageReport.findMany({ where: { id: { in: ids } } });
    const notVerified = reports.filter((r) => r.status !== DamageStatus.VERIFIED);
    if (notVerified.length) {
      throw new BadRequestException(
        `${notVerified.length} report(s) are not verified yet: ${notVerified.map((r) => r.reportNo).join(', ')}`,
      );
    }

    await this.prisma.damageReport.updateMany({
      where: { id: { in: ids } },
      data: { disposalId, status: DamageStatus.DISPOSED },
    });

    await this.audit.record({
      userId: user.id,
      module: 'quality',
      action: 'DAMAGE_DISPOSED',
      entityType: 'Disposal',
      entityId: disposalId,
      newValue: { reports: reports.map((r) => r.reportNo) },
    });

    return { attached: ids.length };
  }

  async findOne(id: string) {
    const report = await this.prisma.damageReport.findUniqueOrThrow({ where: { id } });
    const [product, batch, warehouse] = await Promise.all([
      this.prisma.product.findUnique({
        where: { id: report.productId },
        select: { sku: true, genericName: true, strength: true },
      }),
      this.prisma.batch.findUnique({
        where: { id: report.batchId },
        select: { batchNumber: true, expiryDate: true, status: true },
      }),
      this.prisma.warehouse.findUnique({
        where: { id: report.warehouseId },
        select: { name: true },
      }),
    ]);
    return { ...report, product, batch, warehouse };
  }

  async findAll(query: {
    status?: DamageStatus;
    warehouseId?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, query.pageSize ?? 25);
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.damageReport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.damageReport.count({ where }),
    ]);

    // Resolve names in two queries rather than per row.
    const products = await this.prisma.product.findMany({
      where: { id: { in: rows.map((r) => r.productId) } },
      select: { id: true, genericName: true, strength: true, sku: true },
    });
    const batches = await this.prisma.batch.findMany({
      where: { id: { in: rows.map((r) => r.batchId) } },
      select: { id: true, batchNumber: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));
    const batchById = new Map(batches.map((b) => [b.id, b]));

    return {
      data: rows.map((r) => ({
        ...r,
        product: productById.get(r.productId) ?? null,
        batchNumber: batchById.get(r.batchId)?.batchNumber ?? null,
      })),
      total,
      page,
      pageSize,
    };
  }

  /** Damage write-off summary, for the loss KPIs (§40). */
  async summary(days = 90) {
    const since = new Date(Date.now() - days * 86_400_000);
    const reports = await this.prisma.damageReport.findMany({
      where: { createdAt: { gte: since }, status: { not: DamageStatus.REJECTED } },
    });

    const byType: Record<string, { count: number; value: number }> = {};
    let totalValue = 0;
    let totalUnits = 0;

    for (const r of reports) {
      byType[r.damageType] ??= { count: 0, value: 0 };
      byType[r.damageType].count += 1;
      byType[r.damageType].value += Number(r.totalValue);
      totalValue += Number(r.totalValue);
      totalUnits += Number(r.quantity);
    }

    return {
      periodDays: days,
      reports: reports.length,
      totalUnits,
      totalValue: Math.round(totalValue * 100) / 100,
      awaitingVerification: reports.filter((r) => r.status === DamageStatus.REPORTED).length,
      byType,
    };
  }
}
