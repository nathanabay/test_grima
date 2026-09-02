import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';

/**
 * Patients and customers (§25).
 *
 * Only data the pharmacy legitimately needs is stored. Clinical fields
 * (allergies, notes) and full dispensing history are withheld from roles that
 * have no clinical reason to see them, and every read of a patient record is
 * audited.
 */
const CLINICAL_ROLES = ['PHARMACIST', 'PHARMACY_ADMIN', 'SUPER_ADMIN', 'BRANCH_MANAGER'];

@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private canSeeClinical(user: AuthenticatedUser): boolean {
    return user.roles.some((r) => CLINICAL_ROLES.includes(r));
  }

  async search(query: { q?: string; page?: number; pageSize?: number }, user: AuthenticatedUser) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, query.pageSize ?? 25);
    const where = query.q
      ? {
          isActive: true,
          OR: [
            { fullName: { contains: query.q, mode: 'insensitive' as const } },
            { patientCode: { contains: query.q, mode: 'insensitive' as const } },
            { phone: { contains: query.q } },
          ],
        }
      : { isActive: true };

    const [data, total] = await Promise.all([
      this.prisma.patient.findMany({
        where,
        select: {
          id: true,
          patientCode: true,
          fullName: true,
          phone: true,
          dateOfBirth: true,
          city: true,
          // Clinical fields only for clinical roles.
          allergies: this.canSeeClinical(user),
          notes: this.canSeeClinical(user),
        },
        orderBy: { fullName: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.patient.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const patient = await this.prisma.patient.findUniqueOrThrow({
      where: { id },
      include: this.canSeeClinical(user)
        ? {
            prescriptions: {
              include: { items: true },
              orderBy: { prescriptionDate: 'desc' },
              take: 50,
            },
          }
        : {},
    });

    // §42/§25: reading a patient record is itself an auditable event.
    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'sales',
      action: 'READ',
      entityType: 'Patient',
      entityId: id,
      reason: 'Patient record viewed',
    });

    if (!this.canSeeClinical(user)) {
      const { allergies, notes, ...safe } = patient as any;
      return safe;
    }
    return patient;
  }

  async create(data: any, user: AuthenticatedUser) {
    const count = await this.prisma.patient.count();
    const patient = await this.prisma.patient.create({
      data: {
        patientCode: data.patientCode ?? `PT-${String(count + 1).padStart(6, '0')}`,
        fullName: data.fullName,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
        sex: data.sex ?? null,
        phone: data.phone ?? null,
        addressLine: data.addressLine ?? null,
        city: data.city ?? null,
        emergencyContactName: data.emergencyContactName ?? null,
        emergencyContactPhone: data.emergencyContactPhone ?? null,
        allergies: data.allergies ?? null,
        notes: data.notes ?? null,
      },
    });

    await this.audit.record({
      userId: user.id,
      module: 'sales',
      action: 'CREATE',
      entityType: 'Patient',
      entityId: patient.id,
      // Deliberately does not copy personal data into the audit payload.
      newValue: { patientCode: patient.patientCode },
    });

    return patient;
  }

  async update(id: string, data: any, user: AuthenticatedUser) {
    if ((data.allergies !== undefined || data.notes !== undefined) && !this.canSeeClinical(user)) {
      throw new ForbiddenException('You are not authorized to edit clinical patient information');
    }
    const patient = await this.prisma.patient.update({ where: { id }, data });
    await this.audit.record({
      userId: user.id,
      module: 'sales',
      action: 'EDIT',
      entityType: 'Patient',
      entityId: id,
      newValue: { fields: Object.keys(data) },
    });
    return patient;
  }

  /** Dispensing history for a patient (clinical roles only). */
  async history(id: string, user: AuthenticatedUser) {
    if (!this.canSeeClinical(user)) {
      throw new ForbiddenException('You are not authorized to view patient dispensing history');
    }
    await this.audit.record({
      userId: user.id,
      module: 'dispensing',
      action: 'READ',
      entityType: 'Patient',
      entityId: id,
      reason: 'Dispensing history viewed',
    });

    return this.prisma.dispensing.findMany({
      where: { patientId: id },
      include: { items: true, prescription: { select: { prescriptionNo: true, prescriberName: true } } },
      orderBy: { dispensedAt: 'desc' },
      take: 100,
    });
  }
}
