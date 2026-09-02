import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { QualityIncidentStatus, QualityIncidentType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';
import { DocumentNumberService } from '../common-services/document-number.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Quality incidents and CAPA (§64).
 *
 * The workflow is a one-way ratchet: REPORT -> INVESTIGATE -> ROOT CAUSE ->
 * CORRECTIVE ACTION -> PREVENTIVE ACTION -> VERIFY -> CLOSE. Each step demands
 * the evidence that step is meant to produce, so an incident cannot be closed
 * with an empty investigation — which is the whole point of a CAPA record.
 */
const NEXT_STATUS: Record<QualityIncidentStatus, QualityIncidentStatus[]> = {
  REPORTED: [QualityIncidentStatus.INVESTIGATING, QualityIncidentStatus.CLOSED],
  INVESTIGATING: [QualityIncidentStatus.ROOT_CAUSE_IDENTIFIED],
  ROOT_CAUSE_IDENTIFIED: [QualityIncidentStatus.CORRECTIVE_ACTION],
  CORRECTIVE_ACTION: [QualityIncidentStatus.PREVENTIVE_ACTION],
  PREVENTIVE_ACTION: [QualityIncidentStatus.VERIFICATION],
  VERIFICATION: [QualityIncidentStatus.CLOSED, QualityIncidentStatus.CORRECTIVE_ACTION],
  CLOSED: [],
};

/** What each transition must supply before it is allowed. */
const REQUIRED_EVIDENCE: Partial<Record<QualityIncidentStatus, keyof EvidenceInput>> = {
  ROOT_CAUSE_IDENTIFIED: 'rootCause',
  CORRECTIVE_ACTION: 'correctiveAction',
  PREVENTIVE_ACTION: 'preventiveAction',
  VERIFICATION: 'verification',
};

export interface EvidenceInput {
  rootCause?: string;
  correctiveAction?: string;
  preventiveAction?: string;
  verification?: string;
}

export interface CreateIncidentInput extends EvidenceInput {
  type: QualityIncidentType;
  description: string;
  productId?: string;
  batchId?: string;
  supplierId?: string;
  branchId?: string;
  assignedToId?: string;
  /** Quarantine the named batch as part of raising the incident. */
  quarantineBatch?: boolean;
}

@Injectable()
export class IncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly docNumbers: DocumentNumberService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(input: CreateIncidentInput, user: AuthenticatedUser) {
    if (!input.description?.trim()) {
      throw new BadRequestException('An incident needs a description of what was observed');
    }

    const incident = await this.prisma.$transaction(async (tx) => {
      const incidentNo = await this.docNumbers.next(tx, 'QI');
      const created = await tx.qualityIncident.create({
        data: {
          incidentNo,
          type: input.type,
          status: QualityIncidentStatus.REPORTED,
          description: input.description,
          productId: input.productId ?? null,
          batchId: input.batchId ?? null,
          supplierId: input.supplierId ?? null,
          branchId: input.branchId ?? null,
          reportedById: user.id,
          assignedToId: input.assignedToId ?? null,
        },
      });

      // Raising an incident about a batch normally means it must stop moving.
      if (input.quarantineBatch && input.batchId) {
        const batch = await tx.batch.findUniqueOrThrow({ where: { id: input.batchId } });
        if (['AVAILABLE', 'RELEASED'].includes(batch.status)) {
          await tx.batch.update({
            where: { id: input.batchId },
            data: {
              status: 'QUARANTINED',
              quarantineReason: 'QUALITY_INVESTIGATION',
              qualityNotes: `Quarantined by quality incident ${incidentNo}`,
            },
          });
        }
      }

      return created;
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'quality',
      action: 'CREATE',
      entityType: 'QualityIncident',
      entityId: incident.id,
      newValue: {
        incidentNo: incident.incidentNo,
        type: input.type,
        batchQuarantined: !!input.quarantineBatch,
      },
      reason: input.description,
      branchId: input.branchId ?? null,
    });

    await this.notifications.emit({
      eventType: 'QUALITY_INCIDENT',
      severity:
        input.type === QualityIncidentType.SUSPECTED_COUNTERFEIT ||
        input.type === QualityIncidentType.RECALL
          ? 'CRITICAL'
          : 'WARNING',
      title: `Quality incident ${incident.incidentNo}: ${input.type.replace(/_/g, ' ').toLowerCase()}`,
      body: input.description,
      branchId: input.branchId ?? null,
      roleCodes: ['QA_OFFICER', 'PHARMACY_ADMIN'],
      linkUrl: `/quality/${incident.id}`,
    });

    // A supplier-attributed incident feeds their quality score.
    if (input.supplierId) {
      await this.prisma.supplier.update({
        where: { id: input.supplierId },
        data: { qualityIncidents: { increment: 1 } },
      });
    }

    return this.findOne(incident.id);
  }

  /** Advance the CAPA workflow, enforcing that each step brings its evidence. */
  async advance(
    id: string,
    next: QualityIncidentStatus,
    evidence: EvidenceInput,
    user: AuthenticatedUser,
    closureNote?: string,
  ) {
    const incident = await this.prisma.qualityIncident.findUniqueOrThrow({ where: { id } });

    if (incident.status === QualityIncidentStatus.CLOSED) {
      throw new ConflictException('This incident is closed. Raise a new one instead of reopening.');
    }
    if (!NEXT_STATUS[incident.status].includes(next)) {
      throw new BadRequestException(
        `Cannot move an incident from ${incident.status} to ${next}. ` +
          `Permitted: ${NEXT_STATUS[incident.status].join(', ') || 'none'}`,
      );
    }

    // The step being entered must supply its own evidence.
    const requiredField = REQUIRED_EVIDENCE[next];
    if (requiredField) {
      const provided = evidence[requiredField] ?? (incident as any)[requiredField];
      if (!provided?.trim()) {
        throw new BadRequestException(
          `Moving to ${next} requires "${requiredField}" to be recorded`,
        );
      }
    }

    // Closing from REPORTED means "no action needed", which still needs a reason.
    if (
      next === QualityIncidentStatus.CLOSED &&
      incident.status === QualityIncidentStatus.REPORTED &&
      !closureNote?.trim()
    ) {
      throw new BadRequestException(
        'Closing an incident without investigating requires a written justification',
      );
    }

    const updated = await this.prisma.qualityIncident.update({
      where: { id },
      data: {
        status: next,
        rootCause: evidence.rootCause ?? incident.rootCause,
        correctiveAction: evidence.correctiveAction ?? incident.correctiveAction,
        preventiveAction: evidence.preventiveAction ?? incident.preventiveAction,
        verification: evidence.verification ?? incident.verification,
        closedAt: next === QualityIncidentStatus.CLOSED ? new Date() : null,
        assignedToId: incident.assignedToId ?? user.id,
      },
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'quality',
      action: 'CAPA_TRANSITION',
      entityType: 'QualityIncident',
      entityId: id,
      previousValue: { status: incident.status },
      newValue: { status: next, ...evidence },
      reason: closureNote,
      branchId: incident.branchId,
    });

    if (next === QualityIncidentStatus.CLOSED) {
      await this.notifications.emit({
        eventType: 'QUALITY_INCIDENT_CLOSED',
        severity: 'INFO',
        title: `Quality incident ${incident.incidentNo} closed`,
        body:
          `Root cause: ${updated.rootCause ?? 'not recorded'}\n` +
          `Corrective action: ${updated.correctiveAction ?? 'not recorded'}\n` +
          `Preventive action: ${updated.preventiveAction ?? 'not recorded'}`,
        branchId: incident.branchId,
        roleCodes: ['QA_OFFICER'],
        linkUrl: `/quality/${id}`,
      });
    }

    return this.findOne(id);
  }

  async assign(id: string, assignedToId: string, user: AuthenticatedUser) {
    const incident = await this.prisma.qualityIncident.update({
      where: { id },
      data: { assignedToId },
    });
    await this.audit.record({
      userId: user.id,
      module: 'quality',
      action: 'ASSIGN',
      entityType: 'QualityIncident',
      entityId: id,
      newValue: { assignedToId },
    });
    await this.notifications.emit({
      eventType: 'QUALITY_INCIDENT',
      severity: 'INFO',
      userId: assignedToId,
      title: `Quality incident ${incident.incidentNo} assigned to you`,
      body: incident.description,
      linkUrl: `/quality/${id}`,
    });
    return incident;
  }

  async findOne(id: string) {
    const incident = await this.prisma.qualityIncident.findUniqueOrThrow({ where: { id } });

    // Resolve the linked records so the screen does not have to fan out.
    const [product, batch, supplier, reporter, assignee] = await Promise.all([
      incident.productId
        ? this.prisma.product.findUnique({
            where: { id: incident.productId },
            select: { sku: true, genericName: true, strength: true },
          })
        : null,
      incident.batchId
        ? this.prisma.batch.findUnique({
            where: { id: incident.batchId },
            select: { batchNumber: true, expiryDate: true, status: true },
          })
        : null,
      incident.supplierId
        ? this.prisma.supplier.findUnique({
            where: { id: incident.supplierId },
            select: { companyName: true },
          })
        : null,
      incident.reportedById
        ? this.prisma.user.findUnique({
            where: { id: incident.reportedById },
            select: { fullName: true },
          })
        : null,
      incident.assignedToId
        ? this.prisma.user.findUnique({
            where: { id: incident.assignedToId },
            select: { fullName: true },
          })
        : null,
    ]);

    return {
      ...incident,
      product,
      batch,
      supplier,
      reportedBy: reporter?.fullName ?? null,
      assignedTo: assignee?.fullName ?? null,
      nextStatuses: NEXT_STATUS[incident.status],
      // Tell the UI exactly what the next step needs, rather than making it guess.
      evidenceRequired: Object.fromEntries(
        NEXT_STATUS[incident.status].map((s) => [s, REQUIRED_EVIDENCE[s] ?? null]),
      ),
    };
  }

  async findAll(query: {
    status?: QualityIncidentStatus;
    type?: QualityIncidentType;
    supplierId?: string;
    openOnly?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, query.pageSize ?? 25);

    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.openOnly ? { status: { not: QualityIncidentStatus.CLOSED } } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.qualityIncident.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.qualityIncident.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  /** CAPA summary: how many incidents sit at each stage, and how long they take. */
  async summary() {
    const incidents = await this.prisma.qualityIncident.findMany();

    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};
    let closedCount = 0;
    let totalDaysToClose = 0;

    for (const i of incidents) {
      byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
      byType[i.type] = (byType[i.type] ?? 0) + 1;
      if (i.closedAt) {
        closedCount += 1;
        totalDaysToClose += (i.closedAt.getTime() - i.createdAt.getTime()) / 86_400_000;
      }
    }

    const open = incidents.filter((i) => i.status !== QualityIncidentStatus.CLOSED);
    const now = Date.now();

    return {
      total: incidents.length,
      open: open.length,
      byStatus,
      byType,
      averageDaysToClose: closedCount ? Math.round((totalDaysToClose / closedCount) * 10) / 10 : null,
      // Anything open beyond 30 days is overdue for a CAPA record.
      overdue: open
        .filter((i) => now - i.createdAt.getTime() > 30 * 86_400_000)
        .map((i) => ({
          id: i.id,
          incidentNo: i.incidentNo,
          type: i.type,
          status: i.status,
          ageDays: Math.floor((now - i.createdAt.getTime()) / 86_400_000),
        })),
    };
  }
}
