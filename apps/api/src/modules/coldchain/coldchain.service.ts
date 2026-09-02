import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  BatchStatus,
  ExcursionDisposition,
  Prisma,
  QualityIncidentType,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';
import { DocumentNumberService } from '../common-services/document-number.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ConfigService } from '../../common/config/config.service';

/**
 * Cold chain monitoring (§29, §30).
 *
 * A reading outside the configured range opens an excursion. Once the breach
 * has lasted longer than the sensor tolerance, the affected cold-chain stock is
 * QUARANTINED automatically and a QA decision is required. The system never
 * declares temperature-exposed medicine safe on its own (§29, §73).
 */
@Injectable()
export class ColdChainService {
  private readonly logger = new Logger(ColdChainService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly docNumbers: DocumentNumberService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  /** Ingest a sensor reading (IoT integration point, §53). */
  async recordReading(input: {
    sensorCode: string;
    temperature: number;
    humidity?: number;
    recordedAt?: string | Date;
  }) {
    // §65: an administrator who turns ingestion off must stop readings being
    // accepted, not merely see a different label on a screen.
    if (!(await this.config.isEnabled('feature.iotIngestion'))) {
      throw new BadRequestException(
        'Sensor ingestion is turned off (feature.iotIngestion). Readings are not being accepted.',
      );
    }

    const sensor = await this.prisma.temperatureSensor.findUniqueOrThrow({
      where: { code: input.sensorCode },
    });

    const recordedAt = input.recordedAt ? new Date(input.recordedAt) : new Date();
    const temp = new Prisma.Decimal(input.temperature);
    const isBreach = temp.lessThan(sensor.minTempC) || temp.greaterThan(sensor.maxTempC);

    await this.prisma.temperatureLog.create({
      data: {
        sensorId: sensor.id,
        temperature: temp,
        humidity: input.humidity !== undefined ? new Prisma.Decimal(input.humidity) : null,
        recordedAt,
        isBreach,
      },
    });
    await this.prisma.temperatureSensor.update({
      where: { id: sensor.id },
      data: { lastReadingAt: recordedAt },
    });

    const open = await this.prisma.temperatureExcursion.findFirst({
      where: { sensorId: sensor.id, endedAt: null },
    });

    if (isBreach) {
      if (!open) {
        return this.openExcursion(sensor.id, temp, recordedAt);
      }
      // Extend the running excursion and re-evaluate whether it now warrants
      // quarantining stock.
      const durationMinutes = Math.round(
        (recordedAt.getTime() - open.startedAt.getTime()) / 60000,
      );
      const updated = await this.prisma.temperatureExcursion.update({
        where: { id: open.id },
        data: {
          durationMinutes,
          minTempC: temp.lessThan(open.minTempC) ? temp : open.minTempC,
          maxTempC: temp.greaterThan(open.maxTempC) ? temp : open.maxTempC,
        },
      });

      // The sensor's own tolerance wins where it is set, because a vaccine
      // fridge is not a cool room; the organisation setting is the fallback for
      // a sensor that does not state one (§65).
      const tolerance =
        sensor.maxExcursionMinutes ??
        (await this.config.getNumber('coldchain.excursionToleranceMinutes'));
      const autoQuarantine = await this.config.getBoolean('coldchain.autoQuarantineOnExcursion');

      if (durationMinutes >= tolerance && updated.affectedBatchIds.length === 0) {
        if (autoQuarantine) {
          await this.quarantineAffectedStock(updated.id, sensor.id, sensor.warehouseId);
        } else {
          // Turning automatic quarantine off does not make the breach go away:
          // it means a person decides, so the excursion is still raised and
          // still sits PENDING for QA.
          this.logger.warn(
            `Excursion ${updated.excursionNo} passed ${tolerance} minutes but ` +
              'coldchain.autoQuarantineOnExcursion is off, so stock was left for QA to decide.',
          );
        }
      }
      return updated;
    }

    if (open) {
      // Reading is back in range: close the excursion, leaving the disposition
      // PENDING until QA decides (§30).
      const durationMinutes = Math.round(
        (recordedAt.getTime() - open.startedAt.getTime()) / 60000,
      );
      return this.prisma.temperatureExcursion.update({
        where: { id: open.id },
        data: { endedAt: recordedAt, durationMinutes },
      });
    }

    return { ok: true, isBreach: false };
  }

  private async openExcursion(sensorId: string, temp: Prisma.Decimal, at: Date) {
    const sensor = await this.prisma.temperatureSensor.findUniqueOrThrow({
      where: { id: sensorId },
      include: { warehouse: { select: { name: true, branchId: true } } },
    });

    const excursion = await this.prisma.$transaction(async (tx) => {
      const excursionNo = await this.docNumbers.next(tx, 'EXC');
      return tx.temperatureExcursion.create({
        data: {
          excursionNo,
          sensorId,
          startedAt: at,
          minTempC: temp,
          maxTempC: temp,
          disposition: ExcursionDisposition.PENDING,
        },
      });
    });

    await this.notifications.emit({
      eventType: 'TEMPERATURE_EXCURSION',
      severity: 'CRITICAL',
      title: `Temperature alert: ${sensor.name}`,
      body:
        `Reading ${temp.toString()}C is outside the required range ` +
        `${sensor.minTempC.toString()}C to ${sensor.maxTempC.toString()}C at ${sensor.warehouse.name}. ` +
        `Stock will be quarantined automatically if the breach lasts more than ${sensor.maxExcursionMinutes} minutes.`,
      branchId: sensor.warehouse.branchId,
      roleCodes: ['QA_OFFICER', 'WAREHOUSE_MANAGER', 'PHARMACY_ADMIN'],
      linkUrl: `/cold-chain/excursions/${excursion.id}`,
    });

    return excursion;
  }

  /**
   * Quarantine cold-chain stock exposed to the excursion. Deliberately
   * conservative: everything cold-chain in the affected warehouse is held until
   * a pharmacist or QA officer rules on it.
   */
  private async quarantineAffectedStock(
    excursionId: string,
    sensorId: string,
    warehouseId: string,
  ) {
    const balances = await this.prisma.inventoryBalance.findMany({
      where: {
        warehouseId,
        onHand: { gt: 0 },
        product: { isColdChain: true },
        batch: { status: { in: [BatchStatus.AVAILABLE, BatchStatus.RELEASED] } },
      },
      include: { batch: true, product: { select: { genericName: true } } },
    });

    const batchIds = Array.from(new Set(balances.map((b) => b.batchId!).filter(Boolean)));
    const affectedQuantity = balances.reduce(
      (sum, b) => sum.plus(b.onHand),
      new Prisma.Decimal(0),
    );

    if (!batchIds.length) {
      this.logger.log(`Excursion ${excursionId}: no cold-chain stock in this warehouse`);
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.batch.updateMany({
        where: { id: { in: batchIds } },
        data: {
          status: BatchStatus.QUARANTINED,
          quarantineReason: 'TEMPERATURE_EXCURSION',
          qualityNotes: `Quarantined automatically by temperature excursion ${excursionId}`,
        },
      });
      await tx.temperatureExcursion.update({
        where: { id: excursionId },
        data: { affectedBatchIds: batchIds, affectedQuantity },
      });

      const incidentNo = await this.docNumbers.next(tx, 'QI');
      await tx.qualityIncident.create({
        data: {
          incidentNo,
          type: QualityIncidentType.TEMPERATURE_EXCURSION,
          description:
            `Automatic quarantine of ${batchIds.length} cold-chain batch(es) ` +
            `(${affectedQuantity.toString()} units) following temperature excursion ${excursionId}. ` +
            `QA decision required before any of this stock is released.`,
        },
      });
    });

    await this.audit.record({
      userId: null,
      userLabel: 'System (cold chain monitor)',
      module: 'quality',
      action: 'AUTO_QUARANTINE',
      entityType: 'TemperatureExcursion',
      entityId: excursionId,
      newValue: { batches: batchIds.length, quantity: affectedQuantity.toString() },
      reason: 'Temperature excursion exceeded the permitted duration',
    });

    await this.notifications.emit({
      eventType: 'COLD_CHAIN_QUARANTINE',
      severity: 'CRITICAL',
      title: `${batchIds.length} cold-chain batch(es) quarantined`,
      body:
        `${affectedQuantity.toString()} units were quarantined after a temperature excursion. ` +
        `A QA officer must review and record a disposition before this stock can be used.`,
      roleCodes: ['QA_OFFICER', 'PHARMACY_ADMIN'],
      linkUrl: `/cold-chain/excursions/${excursionId}`,
    });
  }

  /** QA disposition for an excursion (§30). Release requires a justification. */
  async decideExcursion(
    id: string,
    input: {
      disposition: ExcursionDisposition;
      investigation: string;
      correctiveAction?: string;
    },
    user: AuthenticatedUser,
  ) {
    const excursion = await this.prisma.temperatureExcursion.findUniqueOrThrow({
      where: { id },
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.temperatureExcursion.update({
        where: { id },
        data: {
          disposition: input.disposition,
          investigation: input.investigation,
          correctiveAction: input.correctiveAction ?? null,
          decidedById: user.id,
          decidedAt: new Date(),
        },
      });

      if (excursion.affectedBatchIds.length) {
        if (input.disposition === ExcursionDisposition.RELEASED) {
          await tx.batch.updateMany({
            where: { id: { in: excursion.affectedBatchIds } },
            data: {
              status: BatchStatus.RELEASED,
              quarantineReason: null,
              qualityNotes: `Released by QA after excursion ${excursion.excursionNo}: ${input.investigation}`,
              releasedById: user.id,
              releasedAt: new Date(),
            },
          });
        } else if (input.disposition === ExcursionDisposition.DESTROYED) {
          await tx.batch.updateMany({
            where: { id: { in: excursion.affectedBatchIds } },
            data: { status: BatchStatus.DAMAGED },
          });
        } else if (input.disposition === ExcursionDisposition.RETURNED) {
          await tx.batch.updateMany({
            where: { id: { in: excursion.affectedBatchIds } },
            data: { status: BatchStatus.RETURNED },
          });
        }
      }
      return result;
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'quality',
      action: 'EXCURSION_DISPOSITION',
      entityType: 'TemperatureExcursion',
      entityId: id,
      previousValue: { disposition: excursion.disposition },
      newValue: { disposition: input.disposition },
      reason: input.investigation,
    });

    return updated;
  }

  async liveReadings(warehouseId?: string) {
    const sensors = await this.prisma.temperatureSensor.findMany({
      where: { isActive: true, ...(warehouseId ? { warehouseId } : {}) },
      include: {
        warehouse: { select: { name: true, branchId: true } },
        logs: { orderBy: { recordedAt: 'desc' }, take: 1 },
        excursions: { where: { endedAt: null }, take: 1 },
      },
    });

    return sensors.map((s) => {
      const latest = s.logs[0];
      return {
        sensorId: s.id,
        code: s.code,
        name: s.name,
        warehouseName: s.warehouse.name,
        requiredRange: `${s.minTempC.toString()}C to ${s.maxTempC.toString()}C`,
        currentTemperature: latest?.temperature ?? null,
        currentHumidity: latest?.humidity ?? null,
        lastReadingAt: latest?.recordedAt ?? null,
        // A sensor that has stopped reporting is itself a cold-chain risk.
        status: !latest
          ? 'NO_DATA'
          : s.excursions.length
            ? 'EXCURSION'
            : Date.now() - latest.recordedAt.getTime() > 3_600_000
              ? 'STALE'
              : 'OK',
        openExcursionId: s.excursions[0]?.id ?? null,
      };
    });
  }

  async listExcursions(query: { disposition?: ExcursionDisposition; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, query.pageSize ?? 25);
    const where = query.disposition ? { disposition: query.disposition } : {};
    const [data, total] = await Promise.all([
      this.prisma.temperatureExcursion.findMany({
        where,
        include: { sensor: { select: { code: true, name: true, warehouseId: true } } },
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.temperatureExcursion.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }
}
