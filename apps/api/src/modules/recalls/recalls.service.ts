import { BadRequestException, Injectable } from '@nestjs/common';
import {
  BatchStatus,
  Prisma,
  RecallSeverity,
  RecallStatus,
  RecallTaskStatus,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';
import { DocumentNumberService } from '../common-services/document-number.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface CreateRecallInput {
  productId?: string;
  manufacturerName?: string;
  batchIds: string[];
  severity: RecallSeverity;
  reason: string;
  regulatoryReference?: string;
  instructions?: string;
  serialRangeFrom?: string;
  serialRangeTo?: string;
}

/**
 * Recall Management Centre (§27).
 *
 * Activating a recall blocks the affected stock in the same transaction that
 * creates the recall, so there is no window in which a recalled batch can still
 * be dispensed. Blocking works because the ledger refuses outbound movements on
 * a RECALLED batch (§19) — the block is enforced at the stock layer, not by
 * hiding buttons in the UI.
 */
@Injectable()
export class RecallsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly docNumbers: DocumentNumberService,
    private readonly notifications: NotificationsService,
  ) {}

  async activate(input: CreateRecallInput, user: AuthenticatedUser) {
    if (!input.batchIds?.length) {
      throw new BadRequestException('A recall must name at least one batch');
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const recallNo = await this.docNumbers.next(tx, 'RCL');

        const recall = await tx.recall.create({
          data: {
            recallNo,
            productId: input.productId ?? null,
            manufacturerName: input.manufacturerName ?? null,
            severity: input.severity,
            status: RecallStatus.IN_PROGRESS,
            reason: input.reason,
            regulatoryReference: input.regulatoryReference ?? null,
            instructions: input.instructions ?? null,
            serialRangeFrom: input.serialRangeFrom ?? null,
            serialRangeTo: input.serialRangeTo ?? null,
            createdById: user.id,
          },
        });

        const affected: any[] = [];

        for (const batchId of input.batchIds) {
          const batch = await tx.batch.findUniqueOrThrow({
            where: { id: batchId },
            include: {
              balances: { include: { warehouse: { select: { branchId: true, name: true } } } },
              product: { select: { id: true, genericName: true, brandName: true } },
            },
          });

          // 7. Calculate affected quantity currently in stock.
          const inStock = batch.balances.reduce(
            (sum, b) => sum.plus(b.onHand),
            new Prisma.Decimal(0),
          );

          // 8. Identify historical dispensing/sale transactions for this batch.
          const historical = await tx.inventoryTransaction.aggregate({
            where: { batchId, type: { in: ['DISPENSING', 'SALE'] } },
            _sum: { quantityOut: true },
          });
          const dispensedHistorical = historical._sum.quantityOut ?? new Prisma.Decimal(0);

          await tx.recallBatch.create({
            data: {
              recallId: recall.id,
              batchId,
              quantityInStockAtActivation: inStock,
              quantityDispensedHistorical: dispensedHistorical,
              previousBatchStatus: batch.status,
            },
          });

          // 2-5. Block the stock. The ledger enforces this on every movement.
          await tx.batch.update({
            where: { id: batchId },
            data: {
              status: BatchStatus.RECALLED,
              qualityNotes: `Recalled under ${recallNo}: ${input.reason}`,
            },
          });

          // 6 + 9. One task per holding location, so each site has an owner.
          for (const balance of batch.balances) {
            if (balance.onHand.lessThanOrEqualTo(0)) continue;
            await tx.recallTask.create({
              data: {
                recallId: recall.id,
                batchId,
                branchId: balance.branchId,
                warehouseId: balance.warehouseId,
                taskType: 'BLOCK_STOCK',
                quantity: balance.onHand,
                status: RecallTaskStatus.PENDING,
                notes: `Quarantine ${balance.onHand.toString()} units held at ${balance.warehouse.name}`,
              },
            });
          }

          // Patient notification tasks for stock already dispensed.
          const dispensings = await tx.dispensingItem.findMany({
            where: { batchId },
            include: {
              dispensing: {
                select: { id: true, patientId: true, branchId: true, dispensedAt: true },
              },
            },
          });
          for (const item of dispensings) {
            if (!item.dispensing.patientId) continue;
            await tx.recallTask.create({
              data: {
                recallId: recall.id,
                batchId,
                branchId: item.dispensing.branchId,
                taskType: 'NOTIFY_PATIENT',
                patientId: item.dispensing.patientId,
                dispensingId: item.dispensing.id,
                quantity: item.quantity,
                status: RecallTaskStatus.PENDING,
              },
            });
          }

          affected.push({
            batchId,
            batchNumber: batch.batchNumber,
            productName: batch.product.genericName,
            inStock: inStock.toString(),
            dispensedHistorical: dispensedHistorical.toString(),
            locations: batch.balances.length,
          });
        }

        return { recall, affected, recallNo };
      },
      { timeout: 30_000 },
    );

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'quality',
      action: 'RECALL_ACTIVATED',
      entityType: 'Recall',
      entityId: result.recall.id,
      newValue: {
        recallNo: result.recallNo,
        severity: input.severity,
        batches: result.affected,
      },
      reason: input.reason,
    });

    await this.notifications.emit({
      eventType: 'RECALL',
      severity: 'CRITICAL',
      title: `${input.severity} recall ${result.recallNo} activated`,
      body:
        `${input.reason}\n\n` +
        result.affected
          .map(
            (a) =>
              `${a.productName} batch ${a.batchNumber}: ${a.inStock} in stock across ` +
              `${a.locations} location(s), ${a.dispensedHistorical} already dispensed`,
          )
          .join('\n'),
      roleCodes: ['QA_OFFICER', 'PHARMACY_ADMIN', 'BRANCH_MANAGER', 'PHARMACIST'],
      linkUrl: `/recalls/${result.recall.id}`,
    });

    return this.dashboard(result.recall.id);
  }

  /** Recall dashboard totals (§27). */
  async dashboard(recallId: string) {
    const recall = await this.prisma.recall.findUniqueOrThrow({
      where: { id: recallId },
      include: {
        batches: {
          include: {
            batch: {
              include: { product: { select: { genericName: true, brandName: true, sku: true } } },
            },
          },
        },
        tasks: true,
      },
    });

    const totals = recall.batches.reduce(
      (acc, rb) => {
        acc.totalAffected += Number(rb.quantityInStockAtActivation) + Number(rb.quantityDispensedHistorical);
        acc.inStock += Number(rb.quantityInStockAtActivation);
        acc.dispensed += Number(rb.quantityDispensedHistorical);
        acc.recovered += Number(rb.quantityRecovered);
        acc.returned += Number(rb.quantityReturned);
        acc.destroyed += Number(rb.quantityDestroyed);
        return acc;
      },
      { totalAffected: 0, inStock: 0, dispensed: 0, recovered: 0, returned: 0, destroyed: 0 },
    );

    return {
      recall: {
        id: recall.id,
        recallNo: recall.recallNo,
        severity: recall.severity,
        status: recall.status,
        reason: recall.reason,
        recallDate: recall.recallDate,
        regulatoryReference: recall.regulatoryReference,
        instructions: recall.instructions,
      },
      batches: recall.batches.map((rb) => ({
        batchId: rb.batchId,
        batchNumber: rb.batch.batchNumber,
        product: rb.batch.product.genericName,
        sku: rb.batch.product.sku,
        expiryDate: rb.batch.expiryDate,
        currentStatus: rb.batch.status,
        inStockAtActivation: rb.quantityInStockAtActivation,
        dispensedHistorical: rb.quantityDispensedHistorical,
        recovered: rb.quantityRecovered,
        returned: rb.quantityReturned,
        destroyed: rb.quantityDestroyed,
      })),
      totals: {
        ...totals,
        // §27 dashboard: what is still unaccounted for.
        outstanding:
          totals.totalAffected - totals.recovered - totals.returned - totals.destroyed,
      },
      tasks: {
        total: recall.tasks.length,
        pending: recall.tasks.filter((t) => t.status === RecallTaskStatus.PENDING).length,
        completed: recall.tasks.filter((t) =>
          ([RecallTaskStatus.RECOVERED, RecallTaskStatus.CLOSED] as RecallTaskStatus[]).includes(t.status),
        ).length,
        byType: recall.tasks.reduce<Record<string, number>>((acc, t) => {
          acc[t.taskType] = (acc[t.taskType] ?? 0) + 1;
          return acc;
        }, {}),
      },
    };
  }

  /** Record recovery progress against a task (§27 items 10-11). */
  async updateTask(
    taskId: string,
    input: { status: RecallTaskStatus; quantityRecovered?: number; notes?: string },
    user: AuthenticatedUser,
  ) {
    const task = await this.prisma.recallTask.findUniqueOrThrow({ where: { id: taskId } });

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.recallTask.update({
        where: { id: taskId },
        data: {
          status: input.status,
          quantityRecovered: input.quantityRecovered ?? task.quantityRecovered,
          notes: input.notes ?? task.notes,
          assignedToId: task.assignedToId ?? user.id,
          completedAt: ([RecallTaskStatus.RECOVERED, RecallTaskStatus.CLOSED, RecallTaskStatus.NOT_RECOVERABLE] as RecallTaskStatus[]).includes(
            input.status,
          )
            ? new Date()
            : null,
        },
      });

      if (input.quantityRecovered !== undefined) {
        const delta = new Prisma.Decimal(input.quantityRecovered).minus(task.quantityRecovered);
        await tx.recallBatch.updateMany({
          where: { recallId: task.recallId, batchId: task.batchId },
          data: { quantityRecovered: { increment: delta } },
        });
      }
      return result;
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'quality',
      action: 'RECALL_TASK_UPDATE',
      entityType: 'RecallTask',
      entityId: taskId,
      previousValue: { status: task.status, recovered: task.quantityRecovered },
      newValue: { status: input.status, recovered: input.quantityRecovered },
      branchId: task.branchId,
    });

    return updated;
  }

  async close(recallId: string, user: AuthenticatedUser) {
    const dash = await this.dashboard(recallId);
    if (dash.tasks.pending > 0) {
      throw new BadRequestException(
        `${dash.tasks.pending} recall task(s) are still pending. Close or mark them not-recoverable first.`,
      );
    }

    const recall = await this.prisma.recall.update({
      where: { id: recallId },
      data: { status: RecallStatus.CLOSED, closedAt: new Date() },
    });

    await this.audit.record({
      userId: user.id,
      module: 'quality',
      action: 'RECALL_CLOSED',
      entityType: 'Recall',
      entityId: recallId,
      newValue: { outstanding: dash.totals.outstanding },
    });

    return recall;
  }

  async findAll(query: { status?: RecallStatus; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, query.pageSize ?? 25);
    const where = query.status ? { status: query.status } : {};

    const [data, total] = await Promise.all([
      this.prisma.recall.findMany({
        where,
        include: { batches: true, tasks: { select: { status: true } } },
        orderBy: { recallDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.recall.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  /** Every location currently holding a recalled batch (§27 item 6). */
  async traceBatch(batchId: string) {
    const [balances, movements, dispensings] = await Promise.all([
      this.prisma.inventoryBalance.findMany({
        where: { batchId, onHand: { gt: 0 } },
        include: {
          warehouse: { select: { name: true, branch: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.inventoryTransaction.findMany({
        where: { batchId },
        orderBy: { occurredAt: 'desc' },
        take: 500,
      }),
      this.prisma.dispensingItem.findMany({
        where: { batchId },
        include: {
          dispensing: {
            select: { dispensingNo: true, patientId: true, dispensedAt: true, branchId: true },
          },
        },
      }),
    ]);

    return {
      currentLocations: balances.map((b) => ({
        branchId: b.branchId,
        branchName: b.warehouse.branch.name,
        warehouseName: b.warehouse.name,
        onHand: b.onHand,
      })),
      movementCount: movements.length,
      movements,
      dispensedTo: dispensings.map((d) => ({
        dispensingNo: d.dispensing.dispensingNo,
        patientId: d.dispensing.patientId,
        quantity: d.quantity,
        dispensedAt: d.dispensing.dispensedAt,
        branchId: d.dispensing.branchId,
      })),
    };
  }
}
