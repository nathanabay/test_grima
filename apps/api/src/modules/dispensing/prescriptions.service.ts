import { BadRequestException, Injectable } from '@nestjs/common';
import { PrescriptionStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';
import { DocumentNumberService } from '../common-services/document-number.service';

@Injectable()
export class PrescriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly docNumbers: DocumentNumberService,
  ) {}

  async create(data: any, user: AuthenticatedUser) {
    const prescription = await this.prisma.$transaction(async (tx) => {
      const prescriptionNo = await this.docNumbers.next(tx, 'RX');
      return tx.prescription.create({
        data: {
          prescriptionNo,
          patientId: data.patientId,
          branchId: data.branchId,
          prescriberName: data.prescriberName,
          prescriberLicense: data.prescriberLicense ?? null,
          facilityName: data.facilityName ?? null,
          prescriptionDate: new Date(data.prescriptionDate ?? Date.now()),
          documentUrl: data.documentUrl ?? null,
          refillsAllowed: data.refillsAllowed ?? 0,
          items: {
            create: (data.items ?? []).map((i: any) => ({
              productId: i.productId,
              strength: i.strength ?? null,
              dosage: i.dosage ?? null,
              frequency: i.frequency ?? null,
              durationDays: i.durationDays ?? null,
              prescribedQty: i.prescribedQty,
              instructions: i.instructions ?? null,
            })),
          },
        },
        include: { items: true },
      });
    });

    await this.audit.record({
      userId: user.id,
      module: 'dispensing',
      action: 'CREATE',
      entityType: 'Prescription',
      entityId: prescription.id,
      newValue: { prescriptionNo: prescription.prescriptionNo },
      branchId: data.branchId,
    });

    return prescription;
  }

  /** Pharmacist validation step (§23). */
  async review(
    id: string,
    decision: 'APPROVE' | 'REJECT',
    user: AuthenticatedUser,
    reason?: string,
  ) {
    const prescription = await this.prisma.prescription.findUniqueOrThrow({ where: { id } });
    if (
      !([PrescriptionStatus.NEW, PrescriptionStatus.UNDER_REVIEW] as PrescriptionStatus[]).includes(prescription.status)
    ) {
      throw new BadRequestException(`Prescription is already ${prescription.status}`);
    }
    if (decision === 'REJECT' && !reason?.trim()) {
      throw new BadRequestException('A rejection reason is required');
    }

    const updated = await this.prisma.prescription.update({
      where: { id },
      data: {
        status: decision === 'APPROVE' ? PrescriptionStatus.APPROVED : PrescriptionStatus.REJECTED,
        reviewedById: user.id,
        reviewedAt: new Date(),
        rejectionReason: decision === 'REJECT' ? reason! : null,
      },
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'dispensing',
      action: decision === 'APPROVE' ? 'APPROVE' : 'REJECT',
      entityType: 'Prescription',
      entityId: id,
      previousValue: { status: prescription.status },
      newValue: { status: updated.status },
      reason,
      branchId: prescription.branchId,
    });

    return updated;
  }

  async findAll(query: {
    status?: PrescriptionStatus;
    patientId?: string;
    branchId?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, query.pageSize ?? 25);
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.prescription.findMany({
        where,
        include: {
          items: true,
          patient: { select: { id: true, patientCode: true, fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.prescription.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  async findOne(id: string) {
    return this.prisma.prescription.findUniqueOrThrow({
      where: { id },
      include: { items: true, patient: true, dispensings: { include: { items: true } } },
    });
  }
}
