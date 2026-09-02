import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';
import { ScopeService } from '../../common/guards/scope.service';
import {
  SerialEventType,
  SerialStatus,
  allowedEvents,
  checkTransition,
  isSerialEventType,
} from './serial.state';

export interface SerialFilter {
  serial?: string;
  batchId?: string;
  productId?: string;
  status?: string;
  warehouseId?: string;
  page?: number;
  pageSize?: number;
}

export interface RecordEventInput {
  eventType: string;
  referenceType?: string;
  referenceId?: string;
  referenceNo?: string;
  warehouseId?: string;
  branchId?: string;
  reason?: string;
  /** Only meaningful for CORRECTED. */
  correctedTo?: string;
  occurredAt?: Date;
}

/** One row of a bulk serial registration, after parsing. */
export interface SerialImportRow {
  serial: string;
  batchId: string;
}

export interface SerialImportResult {
  created: number;
  duplicates: Array<{ serial: string; reason: string }>;
  invalid: Array<{ serial: string; reason: string }>;
}

/**
 * Serial-number lifecycle (§3: features 141-150).
 *
 * Two things are kept apart deliberately:
 *
 * - `SerialNumber.status` is the current answer to "where is this pack".
 * - `SerialEvent` is the append-only record of how it got there.
 *
 * Nothing in this service updates or deletes an event. A mistake is corrected
 * by recording a CORRECTED event that states the corrected status and why,
 * which leaves the wrong entry visible - that is the point of a trace.
 */
@Injectable()
export class SerialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  private readonly batchSummary = {
    select: {
      id: true,
      batchNumber: true,
      expiryDate: true,
      status: true,
      product: { select: { id: true, sku: true, genericName: true, brandName: true, strength: true } },
    },
  };

  async findAll(user: AuthenticatedUser, filter: SerialFilter) {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filter.pageSize ?? 50));

    const where: Prisma.SerialNumberWhereInput = {};
    if (filter.serial) where.serial = { contains: filter.serial, mode: 'insensitive' };
    if (filter.batchId) where.batchId = filter.batchId;
    if (filter.status) where.status = filter.status;
    if (filter.warehouseId) {
      await this.scope.assertWarehouse(user, filter.warehouseId);
      where.warehouseId = filter.warehouseId;
    }
    if (filter.productId) where.batch = { productId: filter.productId };

    const [rows, total] = await Promise.all([
      this.prisma.serialNumber.findMany({
        where,
        include: { batch: this.batchSummary },
        orderBy: [{ lastMovedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.serialNumber.count({ where }),
    ]);

    return {
      data: rows.map((r) => ({ ...r, allowedEvents: allowedEvents(r.status) })),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 1 },
    };
  }

  /** Status breakdown, for the serial register header. */
  async summary(filter: { batchId?: string; productId?: string }) {
    const where: Prisma.SerialNumberWhereInput = {};
    if (filter.batchId) where.batchId = filter.batchId;
    if (filter.productId) where.batch = { productId: filter.productId };

    const grouped = await this.prisma.serialNumber.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });

    return {
      total: grouped.reduce((sum, g) => sum + g._count._all, 0),
      byStatus: grouped
        .map((g) => ({ status: g.status, count: g._count._all }))
        .sort((a, b) => b.count - a.count),
    };
  }

  /** Full history of one pack: the question a recall or an audit actually asks. */
  async history(id: string) {
    const serial = await this.prisma.serialNumber.findUnique({
      where: { id },
      include: {
        batch: this.batchSummary,
        events: { orderBy: [{ occurredAt: 'asc' }] },
      },
    });
    if (!serial) throw new NotFoundException('Serial not found');

    const userIds = [
      ...new Set(serial.events.map((e) => e.performedById).filter((v): v is string => !!v)),
    ];
    // Users are resolved separately because SerialEvent stores the actor as a
    // plain id: the event has to survive the user row being deactivated.
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, fullName: true },
        })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.fullName]));

    return {
      ...serial,
      allowedEvents: allowedEvents(serial.status),
      events: serial.events.map((e) => ({
        ...e,
        performedByName: e.performedById ? nameById.get(e.performedById) ?? null : null,
      })),
    };
  }

  /** Look a pack up by the serial printed on it, which is what a scanner gives. */
  async findBySerial(serial: string) {
    const row = await this.prisma.serialNumber.findFirst({
      where: { serial },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) throw new NotFoundException(`No serial "${serial}" is registered`);
    return this.history(row.id);
  }

  /**
   * Bulk registration of the serials on a delivery (§3: feature 148).
   *
   * Rows that already exist are reported rather than overwritten: a serial that
   * is already in the system either arrived twice - which is a counterfeit
   * signal worth surfacing - or the file was uploaded twice. Neither is fixed
   * by silently updating the existing row.
   */
  async importSerials(
    batchId: string,
    serials: string[],
    user: AuthenticatedUser,
    options: { warehouseId?: string; referenceType?: string; referenceId?: string; referenceNo?: string } = {},
  ): Promise<SerialImportResult> {
    const batch = await this.prisma.batch.findUnique({
      where: { id: batchId },
      select: { id: true, batchNumber: true, productId: true },
    });
    if (!batch) throw new NotFoundException('Batch not found');
    if (options.warehouseId) await this.scope.assertWarehouse(user, options.warehouseId);

    const result: SerialImportResult = { created: 0, duplicates: [], invalid: [] };
    const seen = new Set<string>();
    const clean: string[] = [];

    for (const raw of serials) {
      const serial = String(raw ?? '').trim();
      if (!serial) {
        result.invalid.push({ serial: String(raw ?? ''), reason: 'Empty value' });
        continue;
      }
      if (serial.length > 64) {
        result.invalid.push({ serial, reason: 'Longer than 64 characters' });
        continue;
      }
      if (seen.has(serial)) {
        result.duplicates.push({ serial, reason: 'Repeated in this upload' });
        continue;
      }
      seen.add(serial);
      clean.push(serial);
    }

    if (clean.length) {
      const existing = await this.prisma.serialNumber.findMany({
        where: { batchId, serial: { in: clean } },
        select: { serial: true },
      });
      const existingSet = new Set(existing.map((e) => e.serial));

      const toCreate = clean.filter((s) => {
        if (existingSet.has(s)) {
          result.duplicates.push({ serial: s, reason: 'Already registered against this batch' });
          return false;
        }
        return true;
      });

      if (toCreate.length) {
        const now = new Date();
        await this.prisma.$transaction(async (tx) => {
          for (const serial of toCreate) {
            const created = await tx.serialNumber.create({
              data: {
                batchId,
                serial,
                status: 'IN_STOCK',
                warehouseId: options.warehouseId ?? null,
                lastReferenceType: options.referenceType ?? 'SERIAL_IMPORT',
                lastReferenceId: options.referenceId ?? null,
                lastMovedAt: now,
              },
            });
            await tx.serialEvent.create({
              data: {
                serialId: created.id,
                eventType: 'RECEIVED',
                fromStatus: null,
                toStatus: 'IN_STOCK',
                referenceType: options.referenceType ?? 'SERIAL_IMPORT',
                referenceId: options.referenceId ?? null,
                referenceNo: options.referenceNo ?? null,
                warehouseId: options.warehouseId ?? null,
                performedById: user.id,
                occurredAt: now,
              },
            });
          }
        });
        result.created = toCreate.length;
      }
    }

    await this.audit.record({
      userId: user.id,
      module: 'inventory',
      action: 'IMPORT',
      entityType: 'SerialNumber',
      entityId: batchId,
      newValue: {
        batchNumber: batch.batchNumber,
        submitted: serials.length,
        created: result.created,
        duplicates: result.duplicates.length,
        invalid: result.invalid.length,
      },
    });

    return result;
  }

  /**
   * Record one movement of one pack.
   *
   * Both the status update and the event are written in the same transaction:
   * a status that moved without a matching event would be exactly the silent
   * gap the register exists to prevent.
   */
  async recordEvent(id: string, input: RecordEventInput, user: AuthenticatedUser) {
    if (!isSerialEventType(input.eventType)) {
      throw new BadRequestException(`Unknown serial event "${input.eventType}"`);
    }
    const eventType = input.eventType as SerialEventType;

    const serial = await this.prisma.serialNumber.findUnique({
      where: { id },
      include: { batch: { select: { batchNumber: true, productId: true } } },
    });
    if (!serial) throw new NotFoundException('Serial not found');

    const check = checkTransition(serial.status, eventType, input.correctedTo);
    if (!check.ok) throw new ConflictException(check.reason);

    if (eventType === 'CORRECTED' && !input.reason?.trim()) {
      throw new BadRequestException('A correction must state why the record was wrong');
    }
    if (input.warehouseId) await this.scope.assertWarehouse(user, input.warehouseId);

    const toStatus = check.toStatus as SerialStatus;
    const occurredAt = input.occurredAt ?? new Date();

    // A pack that has left stock is not sitting in a warehouse any more, so the
    // location is cleared rather than left pointing at where it used to be.
    const settled: SerialStatus[] = ['DISPENSED', 'SOLD', 'DESTROYED'];
    const warehouseId = settled.includes(toStatus)
      ? null
      : input.warehouseId ?? serial.warehouseId;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.serialNumber.update({
        where: { id },
        data: {
          status: toStatus,
          warehouseId,
          lastReferenceType: input.referenceType ?? eventType,
          lastReferenceId: input.referenceId ?? null,
          lastMovedAt: occurredAt,
        },
      });
      await tx.serialEvent.create({
        data: {
          serialId: id,
          eventType,
          fromStatus: serial.status,
          toStatus,
          referenceType: input.referenceType ?? null,
          referenceId: input.referenceId ?? null,
          referenceNo: input.referenceNo ?? null,
          warehouseId: warehouseId ?? null,
          branchId: input.branchId ?? null,
          performedById: user.id,
          reason: input.reason ?? null,
          occurredAt,
        },
      });
      return row;
    });

    await this.audit.record({
      userId: user.id,
      module: 'inventory',
      action: eventType === 'CORRECTED' ? 'EDIT' : 'CREATE',
      entityType: 'SerialNumber',
      entityId: id,
      previousValue: { status: serial.status },
      newValue: {
        status: toStatus,
        eventType,
        serial: serial.serial,
        batchNumber: serial.batch.batchNumber,
        referenceNo: input.referenceNo ?? null,
      },
      reason: input.reason,
      branchId: input.branchId ?? null,
    });

    return { ...updated, allowedEvents: allowedEvents(updated.status) };
  }

  /**
   * Mark every serial of a batch recalled (§3: feature 147).
   *
   * Packs already destroyed are left alone - a recall cannot reach ash - and
   * the count of what could not be reached is returned rather than hidden,
   * because that is the number the recall report has to state.
   */
  async recallBatch(batchId: string, user: AuthenticatedUser, reason: string, referenceNo?: string) {
    const serials = await this.prisma.serialNumber.findMany({
      where: { batchId, status: { notIn: ['RECALLED', 'DESTROYED'] } },
      select: { id: true, status: true, serial: true },
    });

    let recalled = 0;
    const skipped: Array<{ serial: string; reason: string }> = [];
    for (const s of serials) {
      const check = checkTransition(s.status, 'RECALLED');
      if (!check.ok) {
        skipped.push({ serial: s.serial, reason: check.reason ?? 'Not recallable' });
        continue;
      }
      await this.recordEvent(
        s.id,
        { eventType: 'RECALLED', reason, referenceType: 'RECALL', referenceNo },
        user,
      );
      recalled += 1;
    }

    const destroyed = await this.prisma.serialNumber.count({
      where: { batchId, status: 'DESTROYED' },
    });

    return { batchId, recalled, alreadyDestroyed: destroyed, skipped };
  }
}
