import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ScopeService } from '../../common/guards/scope.service';
import { DocumentNumberService } from '../common-services/document-number.service';
import { LedgerService } from '../inventory/ledger.service';
import { AuthenticatedUser } from '../../common/decorators';
import { LocationsService } from './locations.service';

const OPEN_STATUSES = ['PENDING', 'ASSIGNED', 'IN_PROGRESS'];

/**
 * Warehouse task lifecycle: put-away, picking, replenishment and moves
 * (§5: features 225-249).
 *
 * A task is a plan; completing one posts a real stock movement through the
 * ledger, so warehouse work and inventory never disagree. Nothing here writes
 * a balance directly.
 */
@Injectable()
export class WarehouseTasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly docNumbers: DocumentNumberService,
    private readonly ledger: LedgerService,
    private readonly locations: LocationsService,
  ) {}

  async list(filter: {
    warehouseId?: string;
    status?: string;
    taskType?: string;
    assignedToId?: string;
    waveId?: string;
    open?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(200, filter.pageSize ?? 50);

    const where: Prisma.WarehouseTaskWhereInput = {
      ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.taskType ? { taskType: filter.taskType } : {}),
      ...(filter.assignedToId ? { assignedToId: filter.assignedToId } : {}),
      ...(filter.waveId ? { waveId: filter.waveId } : {}),
      ...(filter.open ? { status: { in: OPEN_STATUSES } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.warehouseTask.findMany({
        where,
        include: {
          fromLocation: { select: { id: true, code: true, name: true } },
          toLocation: { select: { id: true, code: true, name: true } },
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.warehouseTask.count({ where }),
    ]);

    // Task rows carry ids, not names; resolve the few we need in one query
    // rather than joining a product on every row.
    const productIds = [...new Set(rows.map((r) => r.productId).filter(Boolean) as string[])];
    const products = productIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, sku: true, genericName: true, strength: true, baseUnit: true },
        })
      : [];
    const byProduct = new Map(products.map((p) => [p.id, p]));

    return {
      data: rows.map((r) => ({ ...r, product: r.productId ? byProduct.get(r.productId) ?? null : null })),
      total,
      page,
      pageSize,
    };
  }

  async get(id: string) {
    const task = await this.prisma.warehouseTask.findUnique({
      where: { id },
      include: {
        fromLocation: true,
        toLocation: true,
        wave: { select: { id: true, waveNo: true, status: true } },
      },
    });
    if (!task) throw new NotFoundException('Task not found');

    const product = task.productId
      ? await this.prisma.product.findUnique({
          where: { id: task.productId },
          select: { id: true, sku: true, genericName: true, strength: true, baseUnit: true },
        })
      : null;

    const batch = task.batchId
      ? await this.prisma.batch.findUnique({
          where: { id: task.batchId },
          select: { id: true, batchNumber: true, expiryDate: true, status: true },
        })
      : null;

    return { ...task, product, batch };
  }

  private async createTask(
    tx: Prisma.TransactionClient,
    data: Omit<Prisma.WarehouseTaskUncheckedCreateInput, 'taskNo'>,
  ) {
    const taskNo = await this.docNumbers.next(tx, 'TSK');
    return tx.warehouseTask.create({ data: { ...data, taskNo } });
  }

  /**
   * Generate put-away tasks for a goods receipt (§5: features 225-226, 390).
   *
   * Each receipt line gets a task carrying the recommended bin. The
   * recommendation is stored alongside where the stock actually ended up, so
   * directed put-away can be measured rather than assumed.
   */
  async generatePutawayTasks(goodsReceiptId: string, user: AuthenticatedUser) {
    const receipt = await this.prisma.goodsReceipt.findUnique({
      where: { id: goodsReceiptId },
      include: { items: true },
    });
    if (!receipt) throw new NotFoundException('Goods receipt not found');

    const existing = await this.prisma.warehouseTask.count({
      where: { referenceType: 'GOODS_RECEIPT', referenceId: goodsReceiptId },
    });
    if (existing > 0) {
      throw new ConflictException(
        `Put-away tasks already exist for ${receipt.grnNo}; re-generating would double the work`,
      );
    }

    const warehouse = await this.prisma.warehouse.findUniqueOrThrow({
      where: { id: receipt.warehouseId },
      select: { id: true, branchId: true },
    });

    const receivingLocation = await this.prisma.warehouseLocation.findFirst({
      where: { warehouseId: receipt.warehouseId, locationType: 'RECEIVING', isActive: true },
    });

    const created: Prisma.WarehouseTaskGetPayload<object>[] = [];
    for (const item of receipt.items) {
      const accepted = Number(item.acceptedQty ?? item.receivedQty ?? 0);
      if (accepted <= 0) continue;

      const suggestions = await this.locations.suggestBins(
        item.productId,
        receipt.warehouseId,
        accepted,
        1,
      );

      const task = await this.prisma.$transaction((tx) =>
        this.createTask(tx, {
          warehouseId: receipt.warehouseId,
          branchId: warehouse.branchId,
          taskType: 'PUTAWAY',
          status: 'PENDING',
          priority: 70,
          productId: item.productId,
          batchId: item.batchId,
          fromLocationId: receivingLocation?.id ?? null,
          suggestedLocationId: suggestions[0]?.locationId ?? null,
          quantity: new Prisma.Decimal(accepted),
          referenceType: 'GOODS_RECEIPT',
          referenceId: goodsReceiptId,
          createdById: user.id,
          notes: suggestions[0]
            ? `Suggested ${suggestions[0].code}: ${suggestions[0].reasons[0]}`
            : 'No bin could be recommended; choose a location manually',
        }),
      );
      created.push(task);
    }

    await this.audit.record({
      userId: user.id,
      module: 'inventory',
      action: 'CREATE',
      entityType: 'WarehouseTask',
      entityId: goodsReceiptId,
      newValue: { generated: created.length, referenceType: 'GOODS_RECEIPT' },
    });

    return { generated: created.length, tasks: created };
  }

  async assign(id: string, assignedToId: string, user: AuthenticatedUser) {
    const task = await this.prisma.warehouseTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Task not found');
    if (!OPEN_STATUSES.includes(task.status)) {
      throw new BadRequestException(`Task ${task.taskNo} is ${task.status} and cannot be assigned`);
    }

    const assignee = await this.prisma.user.findUnique({
      where: { id: assignedToId },
      select: { id: true, fullName: true, status: true },
    });
    if (!assignee) throw new BadRequestException('User not found');
    if (assignee.status !== 'ACTIVE') {
      throw new BadRequestException(`${assignee.fullName} is not an active user`);
    }

    const updated = await this.prisma.warehouseTask.update({
      where: { id },
      data: { assignedToId, assignedAt: new Date(), status: 'ASSIGNED' },
    });

    await this.audit.record({
      userId: user.id,
      module: 'inventory',
      action: 'EDIT',
      entityType: 'WarehouseTask',
      entityId: id,
      previousValue: { assignedToId: task.assignedToId, status: task.status },
      newValue: { assignedToId, status: 'ASSIGNED' },
    });

    return updated;
  }

  async start(id: string, user: AuthenticatedUser) {
    const task = await this.prisma.warehouseTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Task not found');
    if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
      throw new BadRequestException(`Task ${task.taskNo} is already ${task.status}`);
    }

    return this.prisma.warehouseTask.update({
      where: { id },
      data: {
        status: 'IN_PROGRESS',
        startedAt: task.startedAt ?? new Date(),
        assignedToId: task.assignedToId ?? user.id,
      },
    });
  }

  /**
   * Complete a task, posting the stock movement it represents.
   *
   * The scan fields exist so a device can prove it was at the right bin with
   * the right product: if they are supplied they are checked, and a mismatch
   * refuses the completion rather than warning about it.
   */
  async complete(
    id: string,
    input: {
      quantity?: number;
      toLocationId?: string;
      scannedLocationBarcode?: string;
      scannedProductBarcode?: string;
      shortReason?: string;
      notes?: string;
    },
    user: AuthenticatedUser,
  ) {
    const task = await this.prisma.warehouseTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Task not found');
    if (task.status === 'COMPLETED') {
      throw new ConflictException(`Task ${task.taskNo} is already completed`);
    }
    if (task.status === 'CANCELLED') {
      throw new BadRequestException(`Task ${task.taskNo} was cancelled`);
    }

    await this.scope.assertWarehouse(user, task.warehouseId);

    const quantity = new Prisma.Decimal(input.quantity ?? Number(task.quantity));
    if (quantity.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Completed quantity must be greater than zero');
    }
    if (quantity.greaterThan(task.quantity)) {
      throw new BadRequestException(
        `Cannot complete ${quantity.toString()} against a task for ${task.quantity.toString()}`,
      );
    }

    const targetLocationId = input.toLocationId ?? task.suggestedLocationId ?? task.toLocationId;
    if (!targetLocationId && task.taskType !== 'PICK') {
      throw new BadRequestException('A destination location is required to complete this task');
    }

    // Scan verification (§5: features 227, 241).
    if (input.scannedLocationBarcode) {
      const scanned = await this.locations.findByBarcode(input.scannedLocationBarcode);
      const expected = task.taskType === 'PICK' ? task.fromLocationId : targetLocationId;
      if (expected && scanned.id !== expected) {
        throw new BadRequestException(
          `Scanned location ${scanned.code} does not match the task location`,
        );
      }
    }

    if (input.scannedProductBarcode && task.productId) {
      const barcode = await this.prisma.productBarcode.findFirst({
        where: { barcode: input.scannedProductBarcode },
        select: { productId: true },
      });
      if (!barcode || barcode.productId !== task.productId) {
        throw new BadRequestException(
          'The scanned product is not the product this task is for',
        );
      }
    }

    if (targetLocationId && task.productId) {
      const validation = await this.locations.validatePutaway(
        task.productId,
        targetLocationId,
        Number(quantity),
      );
      if (!validation.allowed) {
        throw new BadRequestException(validation.problems.join('; '));
      }
    }

    const isShort = quantity.lessThan(task.quantity);
    if (isShort && !input.shortReason?.trim()) {
      throw new BadRequestException(
        `Completing ${quantity.toString()} of ${task.quantity.toString()} needs a reason`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Put-away, replenishment and moves relocate stock that is already on
      // hand, so they post a location transfer rather than a receipt.
      if (task.productId && targetLocationId && task.fromLocationId !== targetLocationId) {
        await this.ledger.post(tx, {
          type: TransactionType.TRANSFER_OUT,
          direction: 'OUT',
          productId: task.productId,
          batchId: task.batchId ?? undefined,
          warehouseId: task.warehouseId,
          locationId: task.fromLocationId ?? undefined,
          branchId: task.branchId,
          quantity: Number(quantity),
          referenceType: 'WAREHOUSE_TASK',
          referenceId: task.id,
          referenceNo: task.taskNo,
          performedById: user.id,
          reason: `${task.taskType} out of ${task.fromLocationId ? 'source bin' : 'receiving'}`,
          idempotencyKey: `task:${task.id}:out`,
        });

        await this.ledger.post(tx, {
          type: TransactionType.TRANSFER_IN,
          direction: 'IN',
          productId: task.productId,
          batchId: task.batchId ?? undefined,
          warehouseId: task.warehouseId,
          locationId: targetLocationId,
          branchId: task.branchId,
          quantity: Number(quantity),
          referenceType: 'WAREHOUSE_TASK',
          referenceId: task.id,
          referenceNo: task.taskNo,
          performedById: user.id,
          reason: `${task.taskType} into bin`,
          idempotencyKey: `task:${task.id}:in`,
        });
      }

      return tx.warehouseTask.update({
        where: { id },
        data: {
          status: isShort ? 'SHORT' : 'COMPLETED',
          quantityDone: quantity,
          toLocationId: targetLocationId ?? task.toLocationId,
          completedAt: new Date(),
          completedById: user.id,
          shortReason: isShort ? input.shortReason?.trim() : null,
          notes: input.notes ?? task.notes,
        },
      });
    });

    await this.audit.record({
      userId: user.id,
      module: 'inventory',
      action: 'EDIT',
      entityType: 'WarehouseTask',
      entityId: id,
      previousValue: { status: task.status, quantityDone: task.quantityDone },
      newValue: {
        status: updated.status,
        quantityDone: quantity.toString(),
        toLocationId: targetLocationId,
        // Recorded so directed put-away compliance can be reported.
        followedSuggestion: targetLocationId === task.suggestedLocationId,
      },
      reason: input.shortReason,
    });

    return updated;
  }

  async cancel(id: string, reason: string, user: AuthenticatedUser) {
    const task = await this.prisma.warehouseTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Task not found');
    if (task.status === 'COMPLETED') {
      throw new BadRequestException('A completed task cannot be cancelled; reverse the movement instead');
    }
    if (!reason?.trim()) throw new BadRequestException('A cancellation reason is required');

    const updated = await this.prisma.warehouseTask.update({
      where: { id },
      data: { status: 'CANCELLED', notes: reason.trim() },
    });

    await this.audit.record({
      userId: user.id,
      module: 'inventory',
      action: 'CANCEL',
      entityType: 'WarehouseTask',
      entityId: id,
      previousValue: { status: task.status },
      newValue: { status: 'CANCELLED' },
      reason,
    });

    return updated;
  }

  /** Create a bin-to-bin move or a pick-face replenishment (§5: features 234-236). */
  async createMove(
    input: {
      warehouseId: string;
      productId: string;
      batchId?: string;
      fromLocationId: string;
      toLocationId: string;
      quantity: number;
      taskType?: 'MOVE' | 'REPLENISH';
      priority?: number;
    },
    user: AuthenticatedUser,
  ) {
    await this.scope.assertWarehouse(user, input.warehouseId);

    const warehouse = await this.prisma.warehouse.findUniqueOrThrow({
      where: { id: input.warehouseId },
      select: { branchId: true },
    });

    const available = await this.prisma.inventoryBalance.findFirst({
      where: {
        productId: input.productId,
        warehouseId: input.warehouseId,
        locationId: input.fromLocationId,
        ...(input.batchId ? { batchId: input.batchId } : {}),
      },
    });
    const free = Number(available?.onHand ?? 0) - Number(available?.reserved ?? 0);
    if (free < input.quantity) {
      throw new BadRequestException(
        `The source bin holds ${free} available unit(s), less than the ${input.quantity} requested`,
      );
    }

    const validation = await this.locations.validatePutaway(
      input.productId,
      input.toLocationId,
      input.quantity,
    );
    if (!validation.allowed) throw new BadRequestException(validation.problems.join('; '));

    const task = await this.prisma.$transaction((tx) =>
      this.createTask(tx, {
        warehouseId: input.warehouseId,
        branchId: warehouse.branchId,
        taskType: input.taskType ?? 'MOVE',
        status: 'PENDING',
        priority: input.priority ?? 50,
        productId: input.productId,
        batchId: input.batchId ?? null,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        suggestedLocationId: input.toLocationId,
        quantity: new Prisma.Decimal(input.quantity),
        referenceType: 'REPLENISHMENT',
        createdById: user.id,
      }),
    );

    await this.audit.record({
      userId: user.id,
      module: 'inventory',
      action: 'CREATE',
      entityType: 'WarehouseTask',
      entityId: task.id,
      newValue: task,
    });

    return task;
  }

  /**
   * Productivity and cycle time by user (§5: features 248-249).
   *
   * Counts completed work only; an assigned task that never finished is not
   * productivity, and including it would flatter whoever hoards tasks.
   */
  async productivity(warehouseId: string, days = 30) {
    const since = new Date(Date.now() - days * 86_400_000);
    const tasks = await this.prisma.warehouseTask.findMany({
      where: {
        warehouseId,
        status: { in: ['COMPLETED', 'SHORT'] },
        completedAt: { gte: since },
        startedAt: { not: null },
      },
      select: {
        taskType: true,
        completedById: true,
        startedAt: true,
        completedAt: true,
        quantityDone: true,
        suggestedLocationId: true,
        toLocationId: true,
      },
    });

    const userIds = [...new Set(tasks.map((t) => t.completedById).filter(Boolean) as string[])];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, fullName: true },
        })
      : [];
    const byUser = new Map(users.map((u) => [u.id, u.fullName]));

    const grouped = new Map<
      string,
      { userId: string; userName: string; tasks: number; units: number; totalMs: number; followedSuggestion: number; directed: number }
    >();

    for (const task of tasks) {
      if (!task.completedById || !task.startedAt || !task.completedAt) continue;
      const key = task.completedById;
      const entry = grouped.get(key) ?? {
        userId: key,
        userName: byUser.get(key) ?? 'Unknown',
        tasks: 0,
        units: 0,
        totalMs: 0,
        followedSuggestion: 0,
        directed: 0,
      };
      entry.tasks += 1;
      entry.units += Number(task.quantityDone);
      entry.totalMs += task.completedAt.getTime() - task.startedAt.getTime();
      if (task.suggestedLocationId) {
        entry.directed += 1;
        if (task.suggestedLocationId === task.toLocationId) entry.followedSuggestion += 1;
      }
      grouped.set(key, entry);
    }

    const byType = new Map<string, { taskType: string; count: number; totalMs: number }>();
    for (const task of tasks) {
      if (!task.startedAt || !task.completedAt) continue;
      const entry = byType.get(task.taskType) ?? { taskType: task.taskType, count: 0, totalMs: 0 };
      entry.count += 1;
      entry.totalMs += task.completedAt.getTime() - task.startedAt.getTime();
      byType.set(task.taskType, entry);
    }

    return {
      windowDays: days,
      byUser: [...grouped.values()]
        .map((e) => ({
          userId: e.userId,
          userName: e.userName,
          tasksCompleted: e.tasks,
          unitsHandled: Math.round(e.units),
          averageMinutes: Math.round(e.totalMs / e.tasks / 60_000),
          // How often the storekeeper accepted the recommended bin. A low
          // figure means the recommendations are wrong, not that the person is.
          directedCompliancePercent: e.directed
            ? Math.round((e.followedSuggestion / e.directed) * 100)
            : null,
        }))
        .sort((a, b) => b.tasksCompleted - a.tasksCompleted),
      byType: [...byType.values()].map((e) => ({
        taskType: e.taskType,
        count: e.count,
        averageMinutes: Math.round(e.totalMs / e.count / 60_000),
      })),
    };
  }

  /** Open work that has stalled — the warehouse exception list (§5: feature 250). */
  async exceptions(warehouseId: string) {
    const [stale, short, unassigned, overCapacity] = await Promise.all([
      this.prisma.warehouseTask.findMany({
        where: {
          warehouseId,
          status: { in: OPEN_STATUSES },
          createdAt: { lt: new Date(Date.now() - 24 * 3_600_000) },
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
      }),
      this.prisma.warehouseTask.findMany({
        where: { warehouseId, status: 'SHORT' },
        orderBy: { completedAt: 'desc' },
        take: 50,
      }),
      this.prisma.warehouseTask.count({ where: { warehouseId, status: 'PENDING', assignedToId: null } }),
      this.locations.occupancy(warehouseId).then((o) => o.locations.filter((l) => (l.occupancyPercent ?? 0) > 100)),
    ]);

    return {
      staleTasks: stale,
      shortPicks: short,
      unassignedCount: unassigned,
      overCapacityLocations: overCapacity,
    };
  }
}
