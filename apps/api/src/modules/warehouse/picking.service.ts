import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { allocateFefo } from '@pharmacore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ScopeService } from '../../common/guards/scope.service';
import { DocumentNumberService } from '../common-services/document-number.service';
import { FefoService } from '../inventory/fefo.service';
import { LedgerService } from '../inventory/ledger.service';
import { AuthenticatedUser } from '../../common/decorators';

export interface WaveLineInput {
  productId: string;
  quantity: number;
  referenceType?: string;
  referenceId?: string;
}

/**
 * Picking waves, packing and dispatch (§5: features 237-245).
 *
 * A wave turns demand into a walk order: FEFO chooses the batch, the batch's
 * bin decides where the picker goes, and the list is sorted by pick sequence
 * so one pass down the aisle collects everything.
 *
 * Batch selection goes through FefoService like every other allocation path —
 * a picking-specific rule would be a second FEFO implementation, which is
 * exactly what §75 forbids.
 */
@Injectable()
export class PickingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly docNumbers: DocumentNumberService,
    private readonly fefo: FefoService,
    private readonly ledger: LedgerService,
  ) {}

  async listWaves(warehouseId: string, status?: string) {
    return this.prisma.pickWave.findMany({
      where: { warehouseId, ...(status ? { status } : {}) },
      include: { _count: { select: { tasks: true, packages: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getWave(id: string) {
    const wave = await this.prisma.pickWave.findUnique({
      where: { id },
      include: {
        tasks: {
          include: {
            fromLocation: { select: { id: true, code: true, name: true, pickSequence: true } },
          },
          orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        },
        packages: { include: { lines: true } },
      },
    });
    if (!wave) throw new NotFoundException('Pick wave not found');

    const productIds = [...new Set(wave.tasks.map((t) => t.productId).filter(Boolean) as string[])];
    const batchIds = [...new Set(wave.tasks.map((t) => t.batchId).filter(Boolean) as string[])];

    const [products, batches] = await Promise.all([
      productIds.length
        ? this.prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, sku: true, genericName: true, strength: true, baseUnit: true },
          })
        : [],
      batchIds.length
        ? this.prisma.batch.findMany({
            where: { id: { in: batchIds } },
            select: { id: true, batchNumber: true, expiryDate: true },
          })
        : [],
    ]);
    const byProduct = new Map(products.map((p) => [p.id, p] as const));
    const byBatch = new Map(batches.map((b) => [b.id, b] as const));

    return {
      ...wave,
      tasks: wave.tasks
        .map((t) => ({
          ...t,
          product: t.productId ? byProduct.get(t.productId) ?? null : null,
          batch: t.batchId ? byBatch.get(t.batchId) ?? null : null,
        }))
        // Walk the aisle in sequence: an unsequenced bin sorts last rather than
        // first, so it does not send the picker back on themselves.
        .sort(
          (a, b) =>
            (a.fromLocation?.pickSequence ?? Number.MAX_SAFE_INTEGER) -
            (b.fromLocation?.pickSequence ?? Number.MAX_SAFE_INTEGER),
        ),
    };
  }

  /**
   * Plan a wave: allocate each demand line by FEFO and create one pick task per
   * batch the allocation touched.
   *
   * Nothing is reserved at planning time; the reservation happens when the wave
   * is released, so a plan that is never released does not lock stock away.
   */
  async createWave(
    input: {
      warehouseId: string;
      strategy?: 'WAVE' | 'ZONE' | 'BATCH';
      zoneId?: string;
      lines: WaveLineInput[];
    },
    user: AuthenticatedUser,
  ) {
    await this.scope.assertWarehouse(user, input.warehouseId);
    if (!input.lines?.length) throw new BadRequestException('A wave needs at least one line');

    const warehouse = await this.prisma.warehouse.findUniqueOrThrow({
      where: { id: input.warehouseId },
      select: { id: true, branchId: true },
    });

    return this.prisma.$transaction(async (tx) => {
      const waveNo = await this.docNumbers.next(tx, 'WAV');
      const wave = await tx.pickWave.create({
        data: {
          waveNo,
          warehouseId: input.warehouseId,
          strategy: input.strategy ?? 'WAVE',
          zoneId: input.zoneId ?? null,
          status: 'PLANNED',
          createdById: user.id,
        },
      });

      const shortages: { productId: string; requested: number; allocated: number; reason: string }[] = [];

      for (const line of input.lines) {
        if (line.quantity <= 0) {
          throw new BadRequestException('Every wave line needs a quantity greater than zero');
        }

        const candidates = await this.fefo.loadCandidates(line.productId, input.warehouseId, tx);
        const allocation = allocateFefo(line.quantity, candidates, {
          warehouseId: input.warehouseId,
        });

        if (!allocation.fullyAllocated) {
          // Record the shortage and still create tasks for what can be picked:
          // a partly pickable wave is more useful than none, provided the gap
          // is stated rather than hidden.
          shortages.push({
            productId: line.productId,
            requested: line.quantity,
            allocated: allocation.allocatedQuantity,
            reason: allocation.excluded[0]?.reason ?? 'insufficient available stock',
          });
        }

        for (const part of allocation.allocations) {
          const taskNo = await this.docNumbers.next(tx, 'TSK');
          await tx.warehouseTask.create({
            data: {
              taskNo,
              warehouseId: input.warehouseId,
              branchId: warehouse.branchId,
              taskType: 'PICK',
              status: 'PENDING',
              priority: 60,
              productId: line.productId,
              batchId: part.batchId,
              fromLocationId: part.locationId ?? null,
              quantity: new Prisma.Decimal(part.quantity),
              referenceType: line.referenceType ?? 'WAVE',
              referenceId: line.referenceId ?? wave.id,
              waveId: wave.id,
              createdById: user.id,
            },
          });
        }
      }

      const taskCount = await tx.warehouseTask.count({ where: { waveId: wave.id } });
      if (taskCount === 0) {
        throw new BadRequestException(
          `Nothing could be allocated for this wave: ${shortages
            .map((s) => `${s.requested} requested, ${s.allocated} available (${s.reason})`)
            .join('; ')}`,
        );
      }

      await this.audit.record({
        userId: user.id,
        module: 'inventory',
        action: 'CREATE',
        entityType: 'PickWave',
        entityId: wave.id,
        newValue: { waveNo, tasks: taskCount, shortages },
      });

      return { wave, taskCount, shortages };
    });
  }

  /** Release a wave to the floor, reserving the stock it will consume. */
  async releaseWave(id: string, user: AuthenticatedUser) {
    const wave = await this.prisma.pickWave.findUnique({
      where: { id },
      include: { tasks: true },
    });
    if (!wave) throw new NotFoundException('Pick wave not found');
    if (wave.status !== 'PLANNED') {
      throw new ConflictException(`Wave ${wave.waveNo} is ${wave.status} and cannot be released again`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      for (const task of wave.tasks) {
        if (task.status === 'CANCELLED' || !task.productId || !task.batchId) continue;

        // Reserving is what stops the till selling stock a picker is walking
        // towards. It goes through the ledger's reservation path, which takes
        // the balance row lock and refuses to over-reserve — a second
        // implementation here would be a second set of rules (§75).
        await this.ledger.reserve(tx, {
          productId: task.productId,
          batchId: task.batchId,
          warehouseId: task.warehouseId,
          quantity: task.quantity,
          referenceType: 'PICK_WAVE',
          referenceId: wave.id,
          createdById: user.id,
        });
      }

      return tx.pickWave.update({
        where: { id },
        data: { status: 'RELEASED', releasedAt: new Date() },
      });
    });

    await this.audit.record({
      userId: user.id,
      module: 'inventory',
      action: 'EDIT',
      entityType: 'PickWave',
      entityId: id,
      previousValue: { status: 'PLANNED' },
      newValue: { status: 'RELEASED', tasks: wave.tasks.length },
    });

    return updated;
  }

  /** Cancel a wave and release anything it had reserved. */
  async cancelWave(id: string, reason: string, user: AuthenticatedUser) {
    const wave = await this.prisma.pickWave.findUnique({ where: { id }, include: { tasks: true } });
    if (!wave) throw new NotFoundException('Pick wave not found');
    if (['DISPATCHED', 'CANCELLED'].includes(wave.status)) {
      throw new BadRequestException(`Wave ${wave.waveNo} is ${wave.status}`);
    }
    if (!reason?.trim()) throw new BadRequestException('A cancellation reason is required');

    const updated = await this.prisma.$transaction(async (tx) => {
      // Released through the same path that took the reservation, so the two
      // can never disagree about which balance row was touched.
      await this.ledger.releaseReservations(tx, 'PICK_WAVE', id);

      await tx.warehouseTask.updateMany({
        where: { waveId: id, status: { in: ['PENDING', 'ASSIGNED', 'IN_PROGRESS'] } },
        data: { status: 'CANCELLED', notes: reason.trim() },
      });

      return tx.pickWave.update({ where: { id }, data: { status: 'CANCELLED' } });
    });

    await this.audit.record({
      userId: user.id,
      module: 'inventory',
      action: 'CANCEL',
      entityType: 'PickWave',
      entityId: id,
      previousValue: { status: wave.status },
      newValue: { status: 'CANCELLED' },
      reason,
    });

    return updated;
  }

  // ---- Packing and dispatch ----

  async createPackage(
    input: {
      warehouseId: string;
      waveId?: string;
      referenceType?: string;
      referenceId?: string;
      lines: { productId: string; batchId?: string; quantity: number }[];
      weightKg?: number;
      sealNumber?: string;
      stagingLocationId?: string;
    },
    user: AuthenticatedUser,
  ) {
    await this.scope.assertWarehouse(user, input.warehouseId);
    if (!input.lines?.length) throw new BadRequestException('A package needs at least one line');

    return this.prisma.$transaction(async (tx) => {
      const packageNo = await this.docNumbers.next(tx, 'PKG');
      const pkg = await tx.shipmentPackage.create({
        data: {
          packageNo,
          warehouseId: input.warehouseId,
          waveId: input.waveId ?? null,
          referenceType: input.referenceType ?? null,
          referenceId: input.referenceId ?? null,
          status: 'PACKED',
          weightKg: input.weightKg ? new Prisma.Decimal(input.weightKg) : null,
          sealNumber: input.sealNumber ?? null,
          stagingLocationId: input.stagingLocationId ?? null,
          packedById: user.id,
          packedAt: new Date(),
          lines: {
            create: input.lines.map((l) => ({
              productId: l.productId,
              batchId: l.batchId ?? null,
              quantity: new Prisma.Decimal(l.quantity),
            })),
          },
        },
        include: { lines: true },
      });

      await this.audit.record({
        userId: user.id,
        module: 'inventory',
        action: 'CREATE',
        entityType: 'ShipmentPackage',
        entityId: pkg.id,
        newValue: { packageNo, lines: pkg.lines.length },
      });

      return pkg;
    });
  }

  /**
   * Verify a packed carton by scanning its contents (§5: feature 243).
   *
   * Verification is line-by-line and refuses to pass a package whose scanned
   * contents do not match what it says it holds — a package verified on a
   * glance is not verified.
   */
  async verifyPackage(
    id: string,
    scans: { productId: string; batchId?: string; quantity: number }[],
    user: AuthenticatedUser,
  ) {
    const pkg = await this.prisma.shipmentPackage.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!pkg) throw new NotFoundException('Package not found');
    if (pkg.status === 'DISPATCHED') {
      throw new BadRequestException(`Package ${pkg.packageNo} has already been dispatched`);
    }

    const scanned = new Map<string, number>();
    for (const scan of scans ?? []) {
      const key = `${scan.productId}|${scan.batchId ?? ''}`;
      scanned.set(key, (scanned.get(key) ?? 0) + scan.quantity);
    }

    const discrepancies: string[] = [];
    for (const line of pkg.lines) {
      const key = `${line.productId}|${line.batchId ?? ''}`;
      const counted = scanned.get(key) ?? 0;
      if (counted !== Number(line.quantity)) {
        discrepancies.push(
          `Line expects ${line.quantity.toString()} but ${counted} were scanned`,
        );
      }
      scanned.delete(key);
    }
    for (const [key, quantity] of scanned) {
      discrepancies.push(`${quantity} unit(s) of ${key.split('|')[0]} scanned but not on the packing list`);
    }

    if (discrepancies.length) {
      // Not recorded as verified: a failed verification must not leave the
      // package looking checked.
      return { verified: false, discrepancies, package: pkg };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      for (const line of pkg.lines) {
        await tx.shipmentPackageLine.update({
          where: { id: line.id },
          data: { verifiedQuantity: line.quantity },
        });
      }
      return tx.shipmentPackage.update({
        where: { id },
        data: { status: 'VERIFIED', verifiedById: user.id, verifiedAt: new Date() },
        include: { lines: true },
      });
    });

    await this.audit.record({
      userId: user.id,
      module: 'inventory',
      action: 'APPROVE',
      entityType: 'ShipmentPackage',
      entityId: id,
      previousValue: { status: pkg.status },
      newValue: { status: 'VERIFIED' },
    });

    return { verified: true, discrepancies: [], package: updated };
  }

  /** Dispatch a verified package, recording the departure temperature if relevant. */
  async dispatchPackage(
    id: string,
    input: { dockId?: string; departureTempC?: number; notes?: string },
    user: AuthenticatedUser,
  ) {
    const pkg = await this.prisma.shipmentPackage.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!pkg) throw new NotFoundException('Package not found');
    if (pkg.status === 'DISPATCHED') {
      throw new ConflictException(`Package ${pkg.packageNo} has already been dispatched`);
    }
    if (pkg.status !== 'VERIFIED' && pkg.status !== 'STAGED') {
      throw new BadRequestException(
        `Package ${pkg.packageNo} is ${pkg.status}; verify its contents before dispatch`,
      );
    }

    // A cold-chain package needs a departure temperature, or the receiving end
    // has no baseline to judge the journey against (§29).
    const productIds = pkg.lines.map((l) => l.productId);
    const coldChain = await this.prisma.product.count({
      where: { id: { in: productIds }, isColdChain: true },
    });
    if (coldChain > 0 && input.departureTempC === undefined) {
      throw new BadRequestException(
        'This package contains cold-chain stock; record the departure temperature before dispatch',
      );
    }

    const updated = await this.prisma.shipmentPackage.update({
      where: { id },
      data: {
        status: 'DISPATCHED',
        dockId: input.dockId ?? null,
        departureTempC:
          input.departureTempC === undefined ? null : new Prisma.Decimal(input.departureTempC),
        dispatchedAt: new Date(),
        notes: input.notes ?? pkg.notes,
      },
    });

    await this.audit.record({
      userId: user.id,
      module: 'inventory',
      action: 'EDIT',
      entityType: 'ShipmentPackage',
      entityId: id,
      previousValue: { status: pkg.status },
      newValue: { status: 'DISPATCHED', departureTempC: input.departureTempC ?? null },
    });

    return updated;
  }

  async listPackages(warehouseId: string, status?: string) {
    return this.prisma.shipmentPackage.findMany({
      where: { warehouseId, ...(status ? { status } : {}) },
      include: { lines: true, wave: { select: { id: true, waveNo: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  // ---- Docks ----

  async listDocks(warehouseId: string) {
    return this.prisma.dock.findMany({
      where: { warehouseId },
      orderBy: { code: 'asc' },
    });
  }

  async createDock(data: Record<string, unknown>, user: AuthenticatedUser) {
    const dock = await this.prisma.dock.create({ data: data as any });
    await this.audit.record({
      userId: user.id,
      module: 'inventory',
      action: 'CREATE',
      entityType: 'Dock',
      entityId: dock.id,
      newValue: dock,
    });
    return dock;
  }
}
