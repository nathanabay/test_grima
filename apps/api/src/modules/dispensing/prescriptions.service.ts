import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PrescriptionStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';
import { ScopeService } from '../../common/guards/scope.service';
import { DocumentNumberService } from '../common-services/document-number.service';
import { ConfigService } from '../../common/config/config.service';

/** Statuses a prescription can still be worked on from. */
const OPEN_STATUSES: PrescriptionStatus[] = [
  PrescriptionStatus.NEW,
  PrescriptionStatus.UNDER_REVIEW,
  PrescriptionStatus.APPROVED,
  PrescriptionStatus.PARTIALLY_DISPENSED,
  PrescriptionStatus.READY_FOR_COLLECTION,
];

@Injectable()
export class PrescriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly docNumbers: DocumentNumberService,
    private readonly config: ConfigService,
    private readonly scope: ScopeService,
  ) {}

  async create(data: any, user: AuthenticatedUser) {
    if (!data.branchId) {
      throw new BadRequestException('A prescription belongs to a branch');
    }
    this.scope.assertBranch(user, data.branchId);
    if (!data.patientId) {
      throw new BadRequestException('A prescription needs a patient — there is nobody to supply otherwise');
    }
    if (!data.prescriberName?.trim()) {
      throw new BadRequestException('A prescription needs the prescriber who wrote it');
    }
    if (!data.items?.length) {
      throw new BadRequestException('A prescription with no items cannot be dispensed');
    }

    const prescriptionDate = new Date(data.prescriptionDate ?? Date.now());
    if (Number.isNaN(prescriptionDate.getTime())) {
      throw new BadRequestException('The prescription date is not a valid date');
    }
    if (prescriptionDate.getTime() > Date.now() + 86_400_000) {
      throw new BadRequestException('A prescription cannot be dated in the future');
    }

    // Prescriptions expire. Where the prescriber did not state a date, the
    // pharmacy's configured validity period decides it, so every prescription
    // has one rather than living forever by default.
    const validityDays = await this.config.getNumber('dispensing.prescriptionValidityDays');
    const validUntil = data.validUntil
      ? new Date(data.validUntil)
      : new Date(prescriptionDate.getTime() + validityDays * 86_400_000);
    if (Number.isNaN(validUntil.getTime()) || validUntil <= prescriptionDate) {
      throw new BadRequestException('The prescription must remain valid past the date it was written');
    }

    // Every line is checked before anything is written: a prescription that
    // half-exists is worse than one that was refused, because the pharmacist
    // has to work out which half.
    for (const [index, item] of (data.items as any[]).entries()) {
      if (!item?.productId) {
        throw new BadRequestException(`Line ${index + 1} names no product`);
      }
      const quantity = Number(item.prescribedQty);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new BadRequestException(`Line ${index + 1} must prescribe a quantity greater than zero`);
      }
    }
    const productIds = [...new Set((data.items as any[]).map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, isActive: true, genericName: true },
    });
    if (products.length !== productIds.length) {
      throw new BadRequestException('A prescribed product does not exist');
    }
    const inactive = products.filter((p) => !p.isActive);
    if (inactive.length) {
      throw new BadRequestException(
        `Cannot prescribe an inactive product: ${inactive.map((p) => p.genericName).join(', ')}`,
      );
    }

    const patient = await this.prisma.patient.findUnique({
      where: { id: data.patientId },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException('Patient not found');

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
          prescriptionDate,
          documentUrl: data.documentUrl ?? null,
          refillsAllowed: data.refillsAllowed ?? 0,
          validUntil,
          isUrgent: data.isUrgent ?? false,
          notes: data.notes ?? null,
          refillOfId: data.refillOfId ?? null,
          items: {
            create: (data.items ?? []).map((i: any) => ({
              productId: i.productId,
              strength: i.strength ?? null,
              dosage: i.dosage ?? null,
              frequency: i.frequency ?? null,
              durationDays: i.durationDays ?? null,
              prescribedQty: i.prescribedQty,
              instructions: i.instructions ?? null,
              allowSubstitution: i.allowSubstitution ?? true,
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
    this.scope.assertBranch(user, prescription.branchId);
    if (
      !([PrescriptionStatus.NEW, PrescriptionStatus.UNDER_REVIEW] as PrescriptionStatus[]).includes(prescription.status)
    ) {
      throw new BadRequestException(`Prescription is already ${prescription.status}`);
    }
    if (decision === 'REJECT' && !reason?.trim()) {
      throw new BadRequestException('A rejection reason is required');
    }
    // Approving an expired prescription would put it into the dispensing queue
    // looking valid. It has to be re-issued by the prescriber instead.
    if (
      decision === 'APPROVE' &&
      prescription.validUntil &&
      prescription.validUntil.getTime() < Date.now()
    ) {
      throw new ConflictException(
        `This prescription expired on ${prescription.validUntil.toISOString().slice(0, 10)} and ` +
          `cannot be approved. Ask the prescriber to re-issue it.`,
      );
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

  /**
   * Cancel a prescription that should not be dispensed (§23).
   *
   * Only reachable while nothing has been supplied against it. Once a supply
   * exists the record is history, and history is corrected by reversing the
   * dispensing, not by cancelling the paper it came from.
   */
  async cancel(id: string, reason: string, user: AuthenticatedUser) {
    if (!reason?.trim()) {
      throw new BadRequestException('Say why the prescription is being cancelled');
    }
    const prescription = await this.prisma.prescription.findUniqueOrThrow({ where: { id } });
    this.scope.assertBranch(user, prescription.branchId);
    if (
      !([PrescriptionStatus.NEW, PrescriptionStatus.UNDER_REVIEW, PrescriptionStatus.APPROVED] as PrescriptionStatus[]).includes(
        prescription.status,
      )
    ) {
      throw new ConflictException(
        `A ${prescription.status} prescription cannot be cancelled. Reverse the dispensing instead.`,
      );
    }

    const updated = await this.prisma.prescription.update({
      where: { id },
      data: { status: PrescriptionStatus.CANCELLED, rejectionReason: reason.trim() },
    });
    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'dispensing',
      action: 'CANCEL',
      entityType: 'Prescription',
      entityId: id,
      previousValue: { status: prescription.status },
      newValue: { status: updated.status },
      reason: reason.trim(),
      branchId: prescription.branchId,
    });
    return updated;
  }

  /**
   * Everything on the prescription has been made up and is on the collection
   * shelf (§23).
   *
   * The step exists because "dispensed" and "handed to the patient" are not the
   * same event, and a pharmacy that cannot tell them apart cannot say what is
   * sitting on its shelf.
   */
  async markReady(id: string, user: AuthenticatedUser) {
    const prescription = await this.prisma.prescription.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });
    this.scope.assertBranch(user, prescription.branchId);
    if (prescription.status === PrescriptionStatus.READY_FOR_COLLECTION) return prescription;
    if (
      !([PrescriptionStatus.PARTIALLY_DISPENSED, PrescriptionStatus.DISPENSED] as PrescriptionStatus[]).includes(
        prescription.status,
      )
    ) {
      throw new ConflictException(
        'Nothing has been made up against this prescription yet, so there is nothing to collect',
      );
    }

    const updated = await this.prisma.prescription.update({
      where: { id },
      data: { status: PrescriptionStatus.READY_FOR_COLLECTION, readyAt: new Date() },
    });
    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'dispensing',
      action: 'READY',
      entityType: 'Prescription',
      entityId: id,
      previousValue: { status: prescription.status },
      newValue: { status: updated.status },
      branchId: prescription.branchId,
    });
    return updated;
  }

  /**
   * The patient (or their representative) has taken the medicine away.
   *
   * `collectedBy` records who actually took it, which is the whole point of the
   * step when somebody collects on another person's behalf.
   */
  async markCollected(id: string, collectedBy: string, user: AuthenticatedUser) {
    if (!collectedBy?.trim()) {
      throw new BadRequestException('Record who collected the medicine');
    }
    const prescription = await this.prisma.prescription.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });
    this.scope.assertBranch(user, prescription.branchId);
    if (prescription.collectedAt) {
      throw new ConflictException(
        `Already collected on ${prescription.collectedAt.toISOString()} by ${prescription.collectedBy}`,
      );
    }
    if (
      !(
        [
          PrescriptionStatus.READY_FOR_COLLECTION,
          PrescriptionStatus.DISPENSED,
          PrescriptionStatus.PARTIALLY_DISPENSED,
        ] as PrescriptionStatus[]
      ).includes(prescription.status)
    ) {
      throw new ConflictException('Nothing has been dispensed against this prescription');
    }

    const fullySupplied = prescription.items.every((i) =>
      i.dispensedQty.greaterThanOrEqualTo(i.prescribedQty),
    );

    const updated = await this.prisma.prescription.update({
      where: { id },
      data: {
        collectedAt: new Date(),
        collectedBy: collectedBy.trim(),
        // Collecting part of an order does not close it: the rest is still owed.
        status: fullySupplied ? PrescriptionStatus.DISPENSED : prescription.status,
      },
    });
    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'dispensing',
      action: 'COLLECT',
      entityType: 'Prescription',
      entityId: id,
      newValue: { collectedBy: collectedBy.trim(), status: updated.status },
      branchId: prescription.branchId,
    });
    return updated;
  }

  /**
   * Issue the next repeat of a prescription (§23).
   *
   * A refill is a NEW prescription that copies the items and points back at the
   * original, rather than a counter that resets the quantities on the old one.
   * That way each supply keeps its own date, its own dispensed quantities and
   * its own audit trail, and the chain of repeats stays readable.
   */
  async refill(id: string, user: AuthenticatedUser) {
    const original = await this.prisma.prescription.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });
    this.scope.assertBranch(user, original.branchId);

    // The allowance belongs to the whole chain, not to each copy of it.
    const rootId = original.refillOfId ?? original.id;
    const root = await this.prisma.prescription.findUniqueOrThrow({
      where: { id: rootId },
      select: { id: true, refillsAllowed: true },
    });
    const used = await this.prisma.prescription.count({ where: { refillOfId: rootId } });
    if (used >= root.refillsAllowed) {
      throw new ConflictException(
        root.refillsAllowed === 0
          ? 'This prescription was written with no repeats. A new prescription is needed.'
          : `All ${root.refillsAllowed} repeat(s) on this prescription have been issued. A new prescription is needed.`,
      );
    }

    if (
      !([PrescriptionStatus.DISPENSED, PrescriptionStatus.READY_FOR_COLLECTION] as PrescriptionStatus[]).includes(
        original.status,
      )
    ) {
      throw new ConflictException(
        `The previous supply is ${original.status}. Finish it before issuing the next repeat.`,
      );
    }

    const validityDays = await this.config.getNumber('dispensing.prescriptionValidityDays');
    const now = new Date();

    const refill = await this.prisma.$transaction(async (tx) => {
      const prescriptionNo = await this.docNumbers.next(tx, 'RX');
      const created = await tx.prescription.create({
        data: {
          prescriptionNo,
          patientId: original.patientId,
          branchId: original.branchId,
          prescriberName: original.prescriberName,
          prescriberLicense: original.prescriberLicense,
          facilityName: original.facilityName,
          prescriptionDate: now,
          validUntil: new Date(now.getTime() + validityDays * 86_400_000),
          documentUrl: original.documentUrl,
          notes: original.notes,
          refillOfId: rootId,
          // The repeat still needs a pharmacist to look at it: the original
          // approval was for the original supply, not for every future one.
          status: PrescriptionStatus.NEW,
          items: {
            create: original.items.map((i) => ({
              productId: i.productId,
              strength: i.strength,
              dosage: i.dosage,
              frequency: i.frequency,
              durationDays: i.durationDays,
              prescribedQty: i.prescribedQty,
              instructions: i.instructions,
              allowSubstitution: i.allowSubstitution,
            })),
          },
        },
        include: { items: true },
      });
      await tx.prescription.update({
        where: { id: rootId },
        data: { refillsUsed: used + 1 },
      });
      return created;
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'dispensing',
      action: 'REFILL',
      entityType: 'Prescription',
      entityId: refill.id,
      newValue: {
        prescriptionNo: refill.prescriptionNo,
        refillOf: rootId,
        repeat: `${used + 1} of ${root.refillsAllowed}`,
      },
      branchId: original.branchId,
    });

    return refill;
  }

  /**
   * Move prescriptions past their validity date to EXPIRED (§23).
   *
   * Run by the scheduler. It only touches prescriptions nothing has been
   * supplied against — a partially dispensed prescription is a live piece of
   * work and expiring it under a pharmacist mid-supply would lose the rest of
   * the course. Those are surfaced on the queue as overdue instead.
   */
  async expireStale(now = new Date()) {
    const stale = await this.prisma.prescription.findMany({
      where: {
        validUntil: { lt: now },
        status: { in: [PrescriptionStatus.NEW, PrescriptionStatus.UNDER_REVIEW, PrescriptionStatus.APPROVED] },
      },
      select: { id: true, prescriptionNo: true, branchId: true, validUntil: true },
      take: 500,
    });
    if (!stale.length) return { expired: 0, prescriptions: [] as string[] };

    await this.prisma.prescription.updateMany({
      where: { id: { in: stale.map((p) => p.id) } },
      data: { status: PrescriptionStatus.EXPIRED },
    });

    for (const p of stale) {
      await this.audit.record({
        module: 'dispensing',
        action: 'EXPIRE',
        entityType: 'Prescription',
        entityId: p.id,
        newValue: { status: PrescriptionStatus.EXPIRED, validUntil: p.validUntil },
        reason: 'Past its validity date',
        branchId: p.branchId,
      });
    }

    return { expired: stale.length, prescriptions: stale.map((p) => p.prescriptionNo) };
  }

  /**
   * The dispensing queue (§23).
   *
   * Ordered the way a pharmacy actually works it: urgent first, then longest
   * waiting. The waiting time is reported so a screen does not have to compute
   * it from a timestamp and get the timezone wrong.
   */
  async queue(user: AuthenticatedUser, query: { branchId?: string; limit?: number } = {}) {
    if (query.branchId) this.scope.assertBranch(user, query.branchId);
    const where: Prisma.PrescriptionWhereInput = {
      ...this.scope.branchFilter(user),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      status: { in: OPEN_STATUSES },
    };

    const rows = await this.prisma.prescription.findMany({
      where,
      include: {
        items: true,
        patient: { select: { id: true, patientCode: true, fullName: true } },
      },
      orderBy: [{ isUrgent: 'desc' }, { createdAt: 'asc' }],
      take: Math.min(200, query.limit ?? 100),
    });

    const now = Date.now();
    const withProducts = await this.withProducts(rows);
    const data = withProducts.map((p) => {
      const outstanding = p.items.filter((i) => i.dispensedQty.lessThan(i.prescribedQty)).length;
      return {
        ...p,
        waitingMinutes: Math.round((now - p.createdAt.getTime()) / 60_000),
        outstandingItems: outstanding,
        isExpired: !!p.validUntil && p.validUntil.getTime() < now,
        awaitingCollection: p.status === PrescriptionStatus.READY_FOR_COLLECTION,
        readyMinutes: p.readyAt ? Math.round((now - p.readyAt.getTime()) / 60_000) : null,
      };
    });

    return {
      data,
      counts: {
        total: data.length,
        urgent: data.filter((p) => p.isUrgent).length,
        awaitingReview: data.filter((p) =>
          ([PrescriptionStatus.NEW, PrescriptionStatus.UNDER_REVIEW] as PrescriptionStatus[]).includes(p.status),
        ).length,
        awaitingDispensing: data.filter((p) =>
          ([PrescriptionStatus.APPROVED, PrescriptionStatus.PARTIALLY_DISPENSED] as PrescriptionStatus[]).includes(
            p.status,
          ),
        ).length,
        awaitingCollection: data.filter((p) => p.awaitingCollection).length,
        expired: data.filter((p) => p.isExpired).length,
      },
    };
  }

  /**
   * Attach the product each line names.
   *
   * PrescriptionItem stores a product id and no relation, so a screen that
   * wanted a medicine's name had to make one request per line — and a queue of
   * twenty prescriptions made a hundred. Resolved once here instead.
   */
  private async withProducts<T extends { items: { productId: string }[] }>(
    rows: T[],
  ): Promise<Array<T & { items: Array<T['items'][number] & { product: unknown }> }>> {
    const ids = [...new Set(rows.flatMap((r) => r.items.map((i) => i.productId)))];
    if (!ids.length) return rows as never;
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        genericName: true,
        brandName: true,
        strength: true,
        dosageForm: true,
        baseUnit: true,
        isControlled: true,
        requiresPrescription: true,
      },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    return rows.map((row) => ({
      ...row,
      items: row.items.map((item) => ({ ...item, product: byId.get(item.productId) ?? null })),
    })) as never;
  }

  async findAll(
    user: AuthenticatedUser,
    query: {
      status?: PrescriptionStatus;
      patientId?: string;
      branchId?: string;
      search?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, query.pageSize ?? 25);
    if (query.branchId) this.scope.assertBranch(user, query.branchId);

    // §4: a prescription is clinical data about a named patient. A user scoped
    // to one branch reads that branch, whatever branchId they ask for.
    const where: Prisma.PrescriptionWhereInput = {
      ...this.scope.branchFilter(user),
      ...(query.status ? { status: query.status } : {}),
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.search?.trim()
        ? {
            OR: [
              { prescriptionNo: { contains: query.search.trim(), mode: 'insensitive' as const } },
              { prescriberName: { contains: query.search.trim(), mode: 'insensitive' as const } },
              { patient: { fullName: { contains: query.search.trim(), mode: 'insensitive' as const } } },
              { patient: { patientCode: { contains: query.search.trim(), mode: 'insensitive' as const } } },
            ],
          }
        : {}),
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
    return { data: await this.withProducts(data), total, page, pageSize };
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const prescription = await this.prisma.prescription.findUnique({
      where: { id },
      include: {
        items: true,
        patient: true,
        dispensings: { include: { items: true }, orderBy: { dispensedAt: 'desc' } },
        refills: { select: { id: true, prescriptionNo: true, status: true, prescriptionDate: true } },
        refillOf: { select: { id: true, prescriptionNo: true, refillsAllowed: true } },
      },
    });
    // §33: not found and not yours read the same from outside, so a scoped user
    // cannot probe for prescriptions in another branch by id.
    if (!prescription) throw new NotFoundException('Prescription not found');
    this.scope.assertBranch(user, prescription.branchId);

    const rootId = prescription.refillOfId ?? prescription.id;
    const repeatsIssued = await this.prisma.prescription.count({ where: { refillOfId: rootId } });
    const allowed = prescription.refillOf?.refillsAllowed ?? prescription.refillsAllowed;
    const [enriched] = await this.withProducts([prescription]);

    return {
      ...enriched,
      refillsRemaining: Math.max(0, allowed - repeatsIssued),
      isExpired: !!prescription.validUntil && prescription.validUntil.getTime() < Date.now(),
    };
  }
}
