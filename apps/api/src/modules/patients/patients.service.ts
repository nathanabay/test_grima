import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

/**
 * Fields a client may set on a patient.
 *
 * patientCode, the merge markers and the anonymization markers are absent on
 * purpose: they are set by the workflows below, and a request that could write
 * them could quietly un-anonymise a record or point a merge anywhere (§73).
 */
const WRITABLE_PATIENT_FIELDS = [
  'fullName',
  'dateOfBirth',
  'sex',
  'phone',
  'email',
  'addressLine',
  'city',
  'emergencyContactName',
  'emergencyContactPhone',
  'allergies',
  'notes',
  'patientType',
  'organizationName',
  'customerGroupId',
  'preferredLanguage',
  'communicationPrefs',
  'insuranceProvider',
  'insuranceMemberNo',
  'employerName',
  'isActive',
] as const;

/**
 * Digits only, last nine kept.
 *
 * "+251 91 123 4567", "0911234567" and "251911234567" are the same phone, and
 * a duplicate check that compares them as strings finds none of it.
 */
function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : digits || null;
}

/** Case, punctuation and repeated whitespace removed, for name comparison. */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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

    const existing = await this.prisma.patient.findUniqueOrThrow({
      where: { id },
      select: { isAnonymized: true, mergedIntoId: true },
    });
    if (existing.isAnonymized) {
      throw new ConflictException('An anonymised patient record cannot be edited');
    }
    if (existing.mergedIntoId) {
      throw new ConflictException(
        'This record was merged into another patient. Edit the surviving record instead.',
      );
    }

    const clean: Record<string, unknown> = {};
    for (const field of WRITABLE_PATIENT_FIELDS) {
      if (data[field] !== undefined) clean[field] = data[field];
    }
    if (clean.dateOfBirth) clean.dateOfBirth = new Date(clean.dateOfBirth as string);

    const patient = await this.prisma.patient.update({ where: { id }, data: clean as any });
    await this.audit.record({
      userId: user.id,
      module: 'sales',
      action: 'EDIT',
      entityType: 'Patient',
      entityId: id,
      // Field names only: the audit trail records that clinical notes changed,
      // never what they now say.
      newValue: { fields: Object.keys(clean) },
    });
    return patient;
  }

  /**
   * Candidate duplicates (§14: feature 656).
   *
   * Matching is on normalised phone, and on normalised name plus date of birth.
   * Nothing is merged automatically: two people really can share a name and a
   * birthday, and merging the wrong pair puts one patient's allergies on
   * another patient's record.
   */
  async findDuplicates(limit = 50) {
    const patients = await this.prisma.patient.findMany({
      where: { isActive: true, isAnonymized: false, mergedIntoId: null },
      select: {
        id: true,
        patientCode: true,
        fullName: true,
        phone: true,
        dateOfBirth: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const byPhone = new Map<string, typeof patients>();
    const byNameDob = new Map<string, typeof patients>();

    for (const p of patients) {
      const phone = normalizePhone(p.phone);
      if (phone) {
        const list = byPhone.get(phone) ?? [];
        list.push(p);
        byPhone.set(phone, list);
      }
      if (p.dateOfBirth) {
        const key = `${normalizeName(p.fullName)}|${p.dateOfBirth.toISOString().slice(0, 10)}`;
        const list = byNameDob.get(key) ?? [];
        list.push(p);
        byNameDob.set(key, list);
      }
    }

    const groups: Array<{
      matchedOn: string;
      confidence: 'HIGH' | 'MEDIUM';
      records: typeof patients;
    }> = [];
    const seen = new Set<string>();

    const collect = (
      source: Map<string, typeof patients>,
      matchedOn: string,
      confidence: 'HIGH' | 'MEDIUM',
    ) => {
      for (const [key, list] of source) {
        if (list.length < 2) continue;
        const signature = list.map((p) => p.id).sort().join(':');
        if (seen.has(signature)) continue;
        seen.add(signature);
        groups.push({ matchedOn: `${matchedOn}: ${key}`, confidence, records: list });
      }
    };

    // A shared phone and a shared name-plus-birthday are both strong, but the
    // phone is the stronger of the two: households share names far more often
    // than they share a mobile number in a pharmacy record.
    collect(byPhone, 'phone', 'HIGH');
    collect(byNameDob, 'name and date of birth', 'MEDIUM');

    return { total: groups.length, groups: groups.slice(0, limit) };
  }

  /**
   * Merge a duplicate into a surviving record (§14: feature 657).
   *
   * Everything that pointed at the duplicate is repointed, and the duplicate
   * row is kept — deactivated and marked mergedIntoId — rather than deleted,
   * so a prescription printed last year still resolves to something.
   *
   * Clinical fields are combined, never dropped: an allergy recorded only on
   * the duplicate must survive the merge or the merge has made the patient
   * less safe.
   */
  async merge(sourceId: string, targetId: string, user: AuthenticatedUser, reason?: string) {
    if (sourceId === targetId) {
      throw new BadRequestException('A patient cannot be merged into themselves');
    }
    if (!this.canSeeClinical(user)) {
      // The merge combines allergies and clinical notes, so it is a clinical
      // act even though it looks like data housekeeping.
      throw new ForbiddenException('Only clinical roles may merge patient records');
    }

    const [source, target] = await Promise.all([
      this.prisma.patient.findUnique({ where: { id: sourceId } }),
      this.prisma.patient.findUnique({ where: { id: targetId } }),
    ]);
    if (!source) throw new NotFoundException('The duplicate record was not found');
    if (!target) throw new NotFoundException('The surviving record was not found');
    if (source.mergedIntoId) {
      throw new ConflictException('That record has already been merged');
    }
    if (target.mergedIntoId) {
      throw new ConflictException('The surviving record has itself been merged into another');
    }
    if (source.isAnonymized || target.isAnonymized) {
      throw new ConflictException('An anonymised record cannot take part in a merge');
    }

    const joinText = (a: string | null, b: string | null): string | null => {
      const parts = [a, b].map((t) => t?.trim()).filter((t): t is string => !!t);
      if (!parts.length) return null;
      return [...new Set(parts)].join('\n---\n');
    };

    const moved = await this.prisma.$transaction(async (tx) => {
      const counts = {
        prescriptions: (await tx.prescription.updateMany({
          where: { patientId: sourceId },
          data: { patientId: targetId },
        })).count,
        dispensings: (await tx.dispensing.updateMany({
          where: { patientId: sourceId },
          data: { patientId: targetId },
        })).count,
        sales: (await tx.sale.updateMany({
          where: { patientId: sourceId },
          data: { patientId: targetId },
        })).count,
        returns: (await tx.returnDocument.updateMany({
          where: { patientId: sourceId },
          data: { patientId: targetId },
        })).count,
        consents: (await tx.patientConsent.updateMany({
          where: { patientId: sourceId },
          data: { patientId: targetId },
        })).count,
        recallTasks: (await tx.recallTask.updateMany({
          where: { patientId: sourceId },
          data: { patientId: targetId },
        })).count,
        controlledEntries: (await tx.controlledRegisterEntry.updateMany({
          where: { patientId: sourceId },
          data: { patientId: targetId },
        })).count,
      };

      await tx.patient.update({
        where: { id: targetId },
        data: {
          allergies: joinText(target.allergies, source.allergies),
          notes: joinText(target.notes, source.notes),
          phone: target.phone ?? source.phone,
          email: target.email ?? source.email,
          dateOfBirth: target.dateOfBirth ?? source.dateOfBirth,
          addressLine: target.addressLine ?? source.addressLine,
          city: target.city ?? source.city,
          insuranceProvider: target.insuranceProvider ?? source.insuranceProvider,
          insuranceMemberNo: target.insuranceMemberNo ?? source.insuranceMemberNo,
          // Balances add up: money owed on the duplicate is still owed.
          creditBalance: target.creditBalance.plus(source.creditBalance),
          loyaltyPoints: target.loyaltyPoints + source.loyaltyPoints,
        },
      });

      await tx.patient.update({
        where: { id: sourceId },
        data: {
          isActive: false,
          mergedIntoId: targetId,
          mergedAt: new Date(),
          mergedById: user.id,
          creditBalance: 0,
          loyaltyPoints: 0,
        },
      });

      return counts;
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'sales',
      action: 'MERGE',
      entityType: 'Patient',
      entityId: targetId,
      // Codes, not names: the audit row records which records were merged
      // without copying personal data into the log (§73).
      previousValue: { mergedFrom: source.patientCode },
      newValue: { survivor: target.patientCode, moved },
      reason,
    });

    return { survivorId: targetId, mergedId: sourceId, moved };
  }

  /**
   * Anonymise a patient on request (§14: feature 658).
   *
   * The row is kept and the identifying fields are cleared. Deleting it would
   * orphan dispensing records that a regulator requires to exist, and would
   * break the controlled-drug register; clearing the identity satisfies the
   * erasure request without destroying the pharmacy record.
   */
  async anonymize(id: string, reason: string, user: AuthenticatedUser) {
    if (!reason?.trim()) {
      throw new BadRequestException('Anonymisation must record why it was requested');
    }

    const patient = await this.prisma.patient.findUniqueOrThrow({ where: { id } });
    if (patient.isAnonymized) {
      throw new ConflictException('This record is already anonymised');
    }

    const outstanding = patient.creditBalance;
    if (!outstanding.isZero()) {
      throw new ConflictException(
        `This patient has an outstanding balance of ${outstanding.toFixed(2)}. ` +
          `Settle or write it off before anonymising, or the debt loses its owner.`,
      );
    }

    const anonymized = await this.prisma.patient.update({
      where: { id },
      data: {
        fullName: `Anonymised patient ${patient.patientCode}`,
        phone: null,
        email: null,
        addressLine: null,
        city: null,
        dateOfBirth: null,
        sex: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        organizationName: null,
        insuranceProvider: null,
        insuranceMemberNo: null,
        employerName: null,
        // Allergies are cleared with the rest: keeping them attached to a record
        // nobody may identify serves no clinical purpose.
        allergies: null,
        notes: null,
        communicationPrefs: undefined,
        isAnonymized: true,
        anonymizedAt: new Date(),
        anonymizedById: user.id,
        anonymizedReason: reason,
        isActive: false,
      },
      select: { id: true, patientCode: true, isAnonymized: true, anonymizedAt: true },
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'sales',
      action: 'ANONYMIZE',
      entityType: 'Patient',
      entityId: id,
      newValue: { patientCode: patient.patientCode },
      reason,
    });

    return anonymized;
  }

  /**
   * Records eligible for anonymisation under the retention policy
   * (§14: feature 659).
   *
   * This only ever lists: erasing patient data on a timer, with no human
   * looking, is how a record that is still needed for an open recall or an
   * unpaid balance disappears.
   */
  async retentionCandidates(retentionYears: number) {
    if (!Number.isFinite(retentionYears) || retentionYears < 1) {
      throw new BadRequestException('The retention period must be at least one year');
    }
    const cutoff = new Date(Date.now() - retentionYears * 365.25 * 86_400_000);

    const patients = await this.prisma.patient.findMany({
      where: {
        isAnonymized: false,
        mergedIntoId: null,
        createdAt: { lt: cutoff },
        prescriptions: { none: { prescriptionDate: { gte: cutoff } } },
        sales: { none: { soldAt: { gte: cutoff } } },
      },
      select: {
        id: true,
        patientCode: true,
        createdAt: true,
        creditBalance: true,
        _count: { select: { prescriptions: true, sales: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });

    return {
      retentionYears,
      cutoff,
      // The balance is surfaced because it is the usual reason a record that
      // looks dormant must not be touched.
      candidates: patients.map((p) => ({
        id: p.id,
        patientCode: p.patientCode,
        createdAt: p.createdAt,
        outstandingBalance: p.creditBalance.toFixed(2),
        blocked: !p.creditBalance.isZero(),
        prescriptions: p._count.prescriptions,
        sales: p._count.sales,
      })),
    };
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
