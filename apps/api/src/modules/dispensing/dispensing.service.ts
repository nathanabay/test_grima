import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma, PrescriptionStatus, TransactionType } from '@prisma/client';
import { allocateFefo, recommendBatch } from '@pharmacore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';
import { ScopeService } from '../../common/guards/scope.service';
import { ConfigService } from '../../common/config/config.service';
import { LedgerService } from '../inventory/ledger.service';
import { FefoService } from '../inventory/fefo.service';
import { DocumentNumberService } from '../common-services/document-number.service';
import { ControlledRegisterService } from './controlled-register.service';
import { ClinicalChecksService } from './clinical-checks.service';

export interface DispenseLineInput {
  productId: string;
  quantity: number;
  unitCode?: string;
  /** Omit to let FEFO choose. Supplying it records an override (§8). */
  batchId?: string;
  overrideReason?: string;
  prescriptionItemId?: string;
  /**
   * Why an equivalent was supplied instead of the product the prescriber wrote.
   * Required whenever `productId` differs from the prescription line's product.
   */
  substitutionReason?: string;
}

export interface DispenseInput {
  prescriptionId?: string;
  patientId?: string;
  branchId: string;
  warehouseId: string;
  lines: DispenseLineInput[];
  notes?: string;
  /** What the pharmacist actually told the patient. */
  counsellingNotes?: string;
  /** Second person present, required for a controlled supply. */
  witnessedById?: string;
  /**
   * Clinical warnings the pharmacist has seen and decided to proceed past,
   * each with their reason. A CRITICAL warning cannot be passed without one.
   */
  overrides?: Array<{ code: string; reason: string }>;
  /** Repeat-safe: replaying the same key will not dispense twice. */
  idempotencyKey?: string;
}

/**
 * Dispensing (§23, §24).
 *
 * Runs entirely inside one database transaction: FEFO selection, the safety
 * checks, the ledger movements and the controlled-drug register all commit
 * together or not at all. Two pharmacists racing for the last units contend on
 * the balance row lock, so exactly one of them wins (§68).
 */
@Injectable()
export class DispensingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly fefo: FefoService,
    private readonly audit: AuditService,
    private readonly docNumbers: DocumentNumberService,
    private readonly controlled: ControlledRegisterService,
    private readonly scope: ScopeService,
    private readonly config: ConfigService,
    private readonly clinical: ClinicalChecksService,
  ) {}

  /**
   * Run the clinical checks without dispensing anything (§24).
   *
   * The till and the dispensing screen both need to show a pharmacist what
   * they are about to do BEFORE they do it. Running the same checks here and
   * at the point of supply means the screen cannot show one thing and the
   * server enforce another.
   */
  async preview(input: DispenseInput, user: AuthenticatedUser) {
    this.scope.assertBranch(user, input.branchId);
    await this.scope.assertWarehouse(user, input.warehouseId);

    const prescription = input.prescriptionId
      ? await this.prisma.prescription.findUniqueOrThrow({
          where: { id: input.prescriptionId },
          include: { items: true },
        })
      : null;

    const warnings = await this.clinical.check({
      patientId: input.patientId ?? prescription?.patientId ?? null,
      branchId: input.branchId,
      lines: input.lines,
      prescription,
    });

    // What FEFO would pick, so the pharmacist sees the batch and its expiry
    // before they commit rather than reading it off the label afterwards.
    const blockWithinDays = await this.config.getNumber('expiry.blockDispensingWithinDays');
    const allocation: Array<{
      productId: string;
      requested: number;
      fullyAllocated: boolean;
      allocatedQuantity: number;
      batches: Array<{
        batchId: string;
        batchNumber: string | null;
        expiryDate: Date | string | null;
        quantity: number;
        daysRemaining: number | null;
      }>;
      excluded: unknown[];
    }> = [];
    for (const line of input.lines) {
      const candidates = await this.fefo.loadCandidates(line.productId, input.warehouseId);
      const usable = blockWithinDays > 0
        ? candidates.filter(
            (c) =>
              (new Date(c.expiryDate).getTime() - Date.now()) / 86_400_000 >= blockWithinDays,
          )
        : candidates;
      const result = allocateFefo(line.quantity, usable, { warehouseId: input.warehouseId });
      allocation.push({
        productId: line.productId,
        requested: line.quantity,
        fullyAllocated: result.fullyAllocated,
        allocatedQuantity: result.allocatedQuantity,
        batches: result.allocations.map((a) => {
          const batch = usable.find((c) => c.batchId === a.batchId);
          return {
            batchId: a.batchId,
            batchNumber: batch?.batchNumber ?? null,
            expiryDate: batch?.expiryDate ?? null,
            quantity: a.quantity,
            daysRemaining: batch
              ? Math.floor((new Date(batch.expiryDate).getTime() - Date.now()) / 86_400_000)
              : null,
          };
        }),
        excluded: result.excluded,
      });
    }

    return {
      warnings,
      allocation,
      // Stated rather than implied: the pharmacist decides, the system records.
      note:
        'These checks are advisory. None of them refuses a supply — the pharmacist is the ' +
        'clinician. A CRITICAL warning must be acknowledged with a reason, which is recorded ' +
        'on the dispensing and in the audit trail.',
    };
  }

  async dispense(input: DispenseInput, user: AuthenticatedUser) {
    if (!input.lines?.length) {
      throw new BadRequestException('Nothing to dispense');
    }

    // §65: a pharmacy may refuse to hand out stock that is about to expire,
    // because a course of treatment has to outlive the pack it comes in. Zero
    // means "any unexpired stock", which is the default.
    const blockWithinDays = await this.config.getNumber('expiry.blockDispensingWithinDays');
    const minRemainingDays = blockWithinDays > 0 ? blockWithinDays : undefined;

    // §4: a branch-scoped user may only dispense within their own branch.
    this.scope.assertBranch(user, input.branchId);
    await this.scope.assertWarehouse(user, input.warehouseId);

    /**
     * Clinical checks run before the transaction opens.
     *
     * None of them refuses the supply — the pharmacist is the clinician and can
     * see the patient. What the system insists on is that a CRITICAL warning
     * cannot be passed silently: it needs a reason, and the reason is kept on
     * the dispensing and in the audit trail. The record of the decision is what
     * this is for, not the decision.
     */
    const rxForChecks = input.prescriptionId
      ? await this.prisma.prescription.findUnique({
          where: { id: input.prescriptionId },
          include: { items: true },
        })
      : null;

    const warnings = await this.clinical.check({
      patientId: input.patientId ?? rxForChecks?.patientId ?? null,
      branchId: input.branchId,
      lines: input.lines,
      prescription: rxForChecks,
    });

    const overrides = new Map((input.overrides ?? []).map((o) => [o.code, o.reason?.trim() ?? '']));
    const unacknowledged = warnings.filter(
      (w) => w.severity === 'CRITICAL' && !overrides.get(w.code),
    );
    if (unacknowledged.length) {
      throw new ConflictException(
        `${unacknowledged.length} clinical warning(s) need a pharmacist's decision before this ` +
          `can be supplied: ${unacknowledged.map((w) => `${w.product} — ${w.message}`).join(' | ')}`,
      );
    }

    const recordedOverrides = warnings
      .filter((w) => overrides.has(w.code))
      .map((w) => ({
        code: w.code,
        severity: w.severity,
        product: w.product,
        warning: w.message,
        reason: overrides.get(w.code)!,
      }));

    if (input.idempotencyKey) {
      const seen = await this.prisma.idempotencyKey.findUnique({
        where: { key: input.idempotencyKey },
      });
      if (seen?.resultId) {
        return this.findOne(seen.resultId);
      }
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        // Typed explicitly: TypeScript would otherwise infer `null` from the
        // initializer and reject the assignment below.
        let prescription:
          | (Awaited<ReturnType<typeof tx.prescription.findUniqueOrThrow>> & {
              items: Awaited<ReturnType<typeof tx.prescriptionItem.findMany>>;
            })
          | null = null;
        if (input.prescriptionId) {
          prescription = await tx.prescription.findUniqueOrThrow({
            where: { id: input.prescriptionId },
            include: { items: true },
          });
          if (
            !(
              [
                PrescriptionStatus.APPROVED,
                PrescriptionStatus.PARTIALLY_DISPENSED,
              ] as PrescriptionStatus[]
            ).includes(prescription.status)
          ) {
            throw new ConflictException(
              `Prescription ${prescription.prescriptionNo} is ${prescription.status}; ` +
                `only APPROVED or PARTIALLY_DISPENSED prescriptions may be dispensed`,
            );
          }
        }

        const dispensingNo = await this.docNumbers.next(tx, 'DSP');
        const dispensing = await tx.dispensing.create({
          data: {
            dispensingNo,
            prescriptionId: input.prescriptionId ?? null,
            patientId: input.patientId ?? prescription?.patientId ?? null,
            branchId: input.branchId,
            warehouseId: input.warehouseId,
            pharmacistId: user.id,
            notes: input.notes ?? null,
            counsellingNotes: input.counsellingNotes ?? null,
            witnessedById: input.witnessedById ?? null,
            overriddenWarnings: recordedOverrides.length
              ? (recordedOverrides as unknown as Prisma.InputJsonValue)
              : undefined,
          },
        });

        const dispensedLines: any[] = [];

        for (const line of input.lines) {
          const product = await tx.product.findUniqueOrThrow({
            where: { id: line.productId },
            select: {
              id: true,
              genericName: true,
              brandName: true,
              strength: true,
              baseUnit: true,
              requiresPrescription: true,
              isControlled: true,
              retailPrice: true,
              isActive: true,
            },
          });

          if (!product.isActive) {
            throw new BadRequestException(`${product.genericName} is inactive and cannot be dispensed`);
          }

          // §24: a prescription-only medicine needs a validated prescription.
          if (product.requiresPrescription && !prescription) {
            throw new ForbiddenException(
              `${product.genericName} ${product.strength} is prescription-only and requires an approved prescription`,
            );
          }

          if (product.isControlled) {
            if (!prescription) {
              throw new ForbiddenException(
                `${product.genericName} is a controlled medicine and cannot be dispensed without a prescription (§28)`,
              );
            }
            if (!user.permissions.includes('dispensing.controlled.CREATE')) {
              throw new ForbiddenException(
                'You are not authorized to dispense controlled medicines',
              );
            }
            // §28: most jurisdictions require a second person to witness a
            // controlled supply. Whether this pharmacy does is configuration,
            // but where it is required the register entry must name them.
            if (await this.config.getBoolean('dispensing.requireControlledWitness')) {
              if (!input.witnessedById) {
                throw new BadRequestException(
                  `${product.genericName} is a controlled medicine and this pharmacy requires a ` +
                    `witness. Name the second person present before supplying.`,
                );
              }
              if (input.witnessedById === user.id) {
                throw new BadRequestException(
                  'The witness to a controlled supply cannot be the person making it',
                );
              }
            }
          }

          // §6: convert to base units before touching stock.
          const units = await tx.productUnit.findMany({ where: { productId: line.productId } });
          const unit = line.unitCode
            ? units.find((u) => u.code === line.unitCode)
            : units.find((u) => u.isBaseUnit);
          if (line.unitCode && !unit) {
            throw new BadRequestException(`Unit "${line.unitCode}" is not defined for ${product.genericName}`);
          }
          const quantity = line.quantity * (unit ? Number(unit.factorToBase) : 1);
          if (quantity <= 0) throw new BadRequestException('Quantity must be greater than zero');

          // Check the prescribed quantity is not exceeded, and that what is
          // being handed over is what was prescribed — or a substitution the
          // prescriber allowed and the pharmacist has justified.
          let substitutedForProductId: string | null = null;
          let substitutionReason: string | null = null;
          if (prescription && line.prescriptionItemId) {
            const item = prescription.items.find((i) => i.id === line.prescriptionItemId);
            if (!item) throw new BadRequestException('Prescription item not found on this prescription');

            if (item.productId !== line.productId) {
              // §23: "do not substitute" is written for a reason, so it is
              // enforced rather than displayed.
              if (!item.allowSubstitution) {
                throw new ForbiddenException(
                  `The prescriber marked this line "do not substitute". ` +
                    `${product.genericName} cannot be supplied against it.`,
                );
              }
              if (!line.substitutionReason?.trim()) {
                throw new BadRequestException(
                  `Supplying ${product.genericName} instead of the prescribed product is a ` +
                    `substitution and needs a reason`,
                );
              }
              substitutedForProductId = item.productId;
              substitutionReason = line.substitutionReason.trim();
            }

            const outstanding = item.prescribedQty.minus(item.dispensedQty);
            if (new Prisma.Decimal(quantity).greaterThan(outstanding)) {
              throw new ConflictException(
                `Cannot dispense ${quantity}: only ${outstanding.toString()} of the prescribed ` +
                  `${item.prescribedQty.toString()} remain on this prescription`,
              );
            }
          } else if (line.substitutionReason?.trim()) {
            throw new BadRequestException(
              'A substitution reason only means something against a prescription line',
            );
          }

          // Load candidates INSIDE the transaction so the FEFO view reflects
          // any concurrent movement that has already committed.
          const candidates = await this.fefo.loadCandidates(
            line.productId,
            input.warehouseId,
            tx,
          );
          // The same shelf-life filter as the allocation below, so the batch
          // named as "what FEFO recommended" is one that could actually be
          // dispensed.
          const recommended = recommendBatch(candidates, {
            warehouseId: input.warehouseId,
            minRemainingDays,
          });

          let allocations;
          let overrideReason: string | null = null;
          let fefoRecommendedBatchId: string | null = recommended?.batchId ?? null;

          if (line.batchId) {
            // Manual override: permitted, but justified and audited (§8).
            const chosen = candidates.find((c) => c.batchId === line.batchId);
            if (!chosen) {
              throw new BadRequestException(
                `Selected batch holds no stock for ${product.genericName} in this warehouse`,
              );
            }
            const check = allocateFefo(quantity, [chosen], {
              warehouseId: input.warehouseId,
              minRemainingDays,
            });
            if (!check.fullyAllocated) {
              throw new ConflictException(
                `Selected batch cannot supply ${quantity}: ${
                  check.excluded[0]?.reason ?? `only ${chosen.availableQuantity} available`
                }`,
              );
            }
            const isOverride = recommended !== null && recommended.batchId !== line.batchId;
            if (isOverride) {
              if (!line.overrideReason?.trim()) {
                throw new BadRequestException(
                  `Batch ${chosen.batchNumber} is not the FEFO recommendation ` +
                    `(${recommended!.batchNumber} expires sooner). A reason is required.`,
                );
              }
              if (!user.permissions.includes('inventory.fefo_override.CREATE')) {
                throw new ForbiddenException('You are not authorized to override the FEFO recommendation');
              }
              overrideReason = line.overrideReason.trim();
            }
            allocations = check.allocations;
          } else {
            const result = allocateFefo(quantity, candidates, {
              warehouseId: input.warehouseId,
              minRemainingDays,
            });
            if (!result.fullyAllocated) {
              const detail = result.excluded.length
                ? ` Excluded: ${result.excluded.map((e) => `${e.batchNumber} (${e.reason})`).join('; ')}`
                : '';
              throw new ConflictException(
                `Insufficient allocatable stock for ${product.genericName}: ` +
                  `${result.allocatedQuantity} of ${quantity} available.${detail}`,
              );
            }
            allocations = result.allocations;
          }

          for (const allocation of allocations) {
            await this.ledger.post(tx, {
              type: TransactionType.DISPENSING,
              direction: 'OUT',
              productId: line.productId,
              batchId: allocation.batchId,
              warehouseId: input.warehouseId,
              locationId: allocation.locationId,
              branchId: input.branchId,
              quantity: allocation.quantity,
              unitCost: allocation.unitCost,
              referenceType: 'DISPENSING',
              referenceId: dispensing.id,
              referenceNo: dispensingNo,
              performedById: user.id,
              reason: overrideReason
                ? `FEFO override: ${overrideReason}`
                : undefined,
              idempotencyKey: input.idempotencyKey
                ? `${input.idempotencyKey}:${line.productId}:${allocation.batchId}`
                : undefined,
            });

            const item = await tx.dispensingItem.create({
              data: {
                dispensingId: dispensing.id,
                productId: line.productId,
                batchId: allocation.batchId,
                quantity: new Prisma.Decimal(allocation.quantity),
                unitPrice: product.retailPrice,
                fefoRecommendedBatchId,
                overrideReason,
                overrideById: overrideReason ? user.id : null,
                substitutedForProductId,
                substitutionReason,
              },
            });

            if (product.isControlled) {
              await this.controlled.record(tx, {
                productId: line.productId,
                batchId: allocation.batchId,
                branchId: input.branchId,
                entryType: 'DISPENSE',
                quantityOut: allocation.quantity,
                prescriptionId: input.prescriptionId,
                patientId: input.patientId ?? prescription?.patientId ?? undefined,
                prescriberName: prescription?.prescriberName,
                performedById: user.id,
                witnessedById: input.witnessedById,
              });
            }

            dispensedLines.push({
              ...item,
              batchNumber: allocation.batchNumber,
              expiryDate: allocation.expiryDate,
              productName: product.genericName,
              wasOverride: !!overrideReason,
            });
          }

          if (prescription && line.prescriptionItemId) {
            await tx.prescriptionItem.update({
              where: { id: line.prescriptionItemId },
              data: { dispensedQty: { increment: new Prisma.Decimal(quantity) } },
            });
          }
        }

        if (prescription) {
          const items = await tx.prescriptionItem.findMany({
            where: { prescriptionId: prescription.id },
          });
          const fully = items.every((i) => i.dispensedQty.greaterThanOrEqualTo(i.prescribedQty));
          await tx.prescription.update({
            where: { id: prescription.id },
            data: {
              status: fully
                ? PrescriptionStatus.DISPENSED
                : PrescriptionStatus.PARTIALLY_DISPENSED,
            },
          });
        }

        if (input.idempotencyKey) {
          await tx.idempotencyKey.create({
            data: {
              key: input.idempotencyKey,
              scope: 'DISPENSING',
              resultId: dispensing.id,
            },
          });
        }

        return { dispensing, dispensedLines, dispensingNo };
      },
      { timeout: 30_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'dispensing',
      action: 'DISPENSE',
      entityType: 'Dispensing',
      entityId: result.dispensing.id,
      newValue: {
        dispensingNo: result.dispensingNo,
        prescriptionId: input.prescriptionId ?? null,
        lines: result.dispensedLines.map((l) => ({
          product: l.productName,
          batch: l.batchNumber,
          quantity: String(l.quantity),
          fefoOverride: l.wasOverride,
        })),
      },
      branchId: input.branchId,
    });

    return this.findOne(result.dispensing.id);
  }

  /**
   * Reverse a dispensing (§24).
   *
   * The record is never deleted or edited. Reversal posts the stock back in as
   * a compensating movement, restores the prescription's outstanding
   * quantities, and appends a REVERSAL row to the controlled register where one
   * applies. What was dispensed and what was reversed are both readable
   * afterwards, which is the point.
   *
   * This is a stock and paperwork correction. It does not, and cannot, undo
   * medicine that has already been handed to a patient — so a dispensing the
   * patient has collected is refused, and the pharmacist deals with it as a
   * return instead.
   */
  async reverse(
    id: string,
    input: { reason: string; returnToStock?: boolean },
    user: AuthenticatedUser,
  ) {
    if (!input.reason?.trim()) {
      throw new BadRequestException('Say why the dispensing is being reversed');
    }
    const existing = await this.prisma.dispensing.findUnique({
      where: { id },
      include: { items: true, prescription: { select: { id: true, status: true } } },
    });
    if (!existing) throw new BadRequestException('Dispensing not found');
    this.scope.assertBranch(user, existing.branchId);

    if (existing.reversedAt) {
      throw new ConflictException(
        `Already reversed on ${existing.reversedAt.toISOString()}. A reversal is not itself reversible.`,
      );
    }

    const collected = existing.prescriptionId
      ? await this.prisma.prescription.findUnique({
          where: { id: existing.prescriptionId },
          select: { collectedAt: true, prescriptionNo: true },
        })
      : null;
    if (collected?.collectedAt) {
      throw new ConflictException(
        `${collected.prescriptionNo} was collected on ` +
          `${collected.collectedAt.toISOString().slice(0, 10)}. Medicine that has left the ` +
          `pharmacy is handled as a return, not a reversal.`,
      );
    }

    // Whether the stock goes back on the shelf is a decision, not an
    // assumption: a pack that was made up and opened does not.
    const returnToStock = input.returnToStock ?? true;

    // The movements the original supply posted. Reversing against these rather
    // than against the dispensing items is what puts each pack back on the
    // shelf it was picked from, at the cost it left at: an item row records the
    // batch but not the location or the cost layer, so a reversal built from it
    // returns stock to "somewhere in the warehouse".
    const originalMovements = await this.prisma.inventoryTransaction.findMany({
      where: { referenceType: 'DISPENSING', referenceId: existing.id },
      select: {
        id: true,
        productId: true,
        batchId: true,
        locationId: true,
        quantityOut: true,
        unitCost: true,
      },
    });

    const result = await this.prisma.$transaction(
      async (tx) => {
        const reversedAt = new Date();

        if (returnToStock) {
          for (const movement of originalMovements) {
            if (movement.quantityOut.lessThanOrEqualTo(0)) continue;
            await this.ledger.post(tx, {
              type: TransactionType.RETURN_IN,
              direction: 'IN',
              productId: movement.productId,
              batchId: movement.batchId,
              warehouseId: existing.warehouseId,
              locationId: movement.locationId,
              branchId: existing.branchId,
              quantity: movement.quantityOut,
              unitCost: movement.unitCost,
              referenceType: 'DISPENSING_REVERSAL',
              referenceId: existing.id,
              referenceNo: existing.dispensingNo,
              performedById: user.id,
              reason: `Reversal of ${existing.dispensingNo}: ${input.reason.trim()}`,
              idempotencyKey: `rev:${existing.id}:${movement.id}`,
            });
          }
        }

        for (const item of existing.items) {
          const product = await tx.product.findUniqueOrThrow({
            where: { id: item.productId },
            select: { id: true, genericName: true, isControlled: true },
          });

          if (product.isControlled) {
            await this.controlled.record(tx, {
              productId: item.productId,
              batchId: item.batchId,
              branchId: existing.branchId,
              entryType: 'REVERSAL',
              // The register follows the stock: no return to stock, no entry
              // back into the balance.
              quantityIn: returnToStock ? Number(item.quantity) : 0,
              quantityOut: 0,
              prescriptionId: existing.prescriptionId ?? undefined,
              patientId: existing.patientId ?? undefined,
              performedById: user.id,
              witnessedById: existing.witnessedById ?? undefined,
              reversalReason: `Reversal of ${existing.dispensingNo}: ${input.reason.trim()}`,
            });
          }

          // Give the prescription its outstanding quantity back, so what is
          // still owed to the patient is right again.
          if (existing.prescriptionId) {
            const line = await tx.prescriptionItem.findFirst({
              where: {
                prescriptionId: existing.prescriptionId,
                productId: item.substitutedForProductId ?? item.productId,
              },
            });
            if (line) {
              const restored = line.dispensedQty.minus(item.quantity);
              await tx.prescriptionItem.update({
                where: { id: line.id },
                data: {
                  dispensedQty: restored.lessThan(0) ? new Prisma.Decimal(0) : restored,
                },
              });
            }
          }
        }

        if (existing.prescriptionId) {
          const items = await tx.prescriptionItem.findMany({
            where: { prescriptionId: existing.prescriptionId },
          });
          const anyDispensed = items.some((i) => i.dispensedQty.greaterThan(0));
          const fully = items.every((i) => i.dispensedQty.greaterThanOrEqualTo(i.prescribedQty));
          await tx.prescription.update({
            where: { id: existing.prescriptionId },
            data: {
              status: fully
                ? PrescriptionStatus.DISPENSED
                : anyDispensed
                  ? PrescriptionStatus.PARTIALLY_DISPENSED
                  : PrescriptionStatus.APPROVED,
              // Nothing is made up any more, so it is not waiting on a shelf.
              readyAt: anyDispensed ? undefined : null,
            },
          });
        }

        return tx.dispensing.update({
          where: { id },
          data: {
            reversedAt,
            reversedById: user.id,
            reversalReason: input.reason.trim(),
          },
        });
      },
      { timeout: 30_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'dispensing',
      action: 'REVERSE',
      entityType: 'Dispensing',
      entityId: id,
      previousValue: { dispensingNo: existing.dispensingNo, reversedAt: null },
      newValue: { reversedAt: result.reversedAt, returnedToStock: returnToStock },
      reason: input.reason.trim(),
      branchId: existing.branchId,
    });

    return this.findOne(id, user);
  }

  /**
   * Everything the dispensing label needs, in one request (§24).
   *
   * Assembled here rather than in the browser because a label is a legal
   * document about a medicine: the product, the batch, the expiry, the
   * directions the prescriber wrote and the cautionary wording all have to come
   * from the same read of the same record. A screen that fetches them
   * separately can print a label whose batch and expiry belong to different
   * rows.
   */
  async labelData(id: string, user: AuthenticatedUser) {
    const dispensing = await this.prisma.dispensing.findUnique({
      where: { id },
      include: {
        items: true,
        prescription: { include: { items: true } },
      },
    });
    if (!dispensing) throw new BadRequestException('Dispensing not found');
    this.scope.assertBranch(user, dispensing.branchId);

    const [patient, branch, pharmacist, products, batches] = await Promise.all([
      dispensing.patientId
        ? this.prisma.patient.findUnique({
            where: { id: dispensing.patientId },
            select: { fullName: true, patientCode: true },
          })
        : null,
      this.prisma.branch.findUnique({
        where: { id: dispensing.branchId },
        select: { name: true, phone: true },
      }),
      this.prisma.user.findUnique({
        where: { id: dispensing.pharmacistId },
        select: { fullName: true },
      }),
      this.prisma.product.findMany({
        where: {
          id: {
            in: [
              ...new Set(
                dispensing.items.flatMap((i) =>
                  [i.productId, i.substitutedForProductId].filter((v): v is string => !!v),
                ),
              ),
            ],
          },
        },
        select: {
          id: true,
          genericName: true,
          brandName: true,
          strength: true,
          dosageForm: true,
          baseUnit: true,
          auxiliaryLabels: true,
          isColdChain: true,
        },
      }),
      this.prisma.batch.findMany({
        where: { id: { in: [...new Set(dispensing.items.map((i) => i.batchId))] } },
        select: { id: true, batchNumber: true, expiryDate: true },
      }),
    ]);

    const productById = new Map(products.map((p) => [p.id, p]));
    const batchById = new Map(batches.map((b) => [b.id, b]));

    return {
      dispensingId: dispensing.id,
      dispensingNo: dispensing.dispensingNo,
      dispensedAt: dispensing.dispensedAt,
      reversedAt: dispensing.reversedAt,
      labelPrintCount: dispensing.labelPrintCount,
      patientName: patient?.fullName ?? 'Patient',
      patientCode: patient?.patientCode ?? null,
      pharmacistName: pharmacist?.fullName ?? null,
      branchName: branch?.name ?? null,
      branchPhone: branch?.phone ?? null,
      items: dispensing.items.map((item) => {
        const product = productById.get(item.productId);
        // The directions belong to the prescription LINE, matched on the
        // product that was prescribed — which is not the product supplied when
        // the pharmacist substituted.
        const line = dispensing.prescription?.items.find(
          (i) => i.productId === (item.substitutedForProductId ?? item.productId),
        );
        const batch = batchById.get(item.batchId);
        const directions = [
          line?.dosage,
          line?.frequency,
          line?.durationDays ? `for ${line.durationDays} days` : null,
        ]
          .filter(Boolean)
          .join(' ');

        return {
          productName: product?.genericName ?? 'Medicine',
          brandName: product?.brandName ?? null,
          strength: product?.strength ?? null,
          form: product?.dosageForm ?? null,
          unit: product?.baseUnit ?? null,
          quantity: item.quantity,
          directions: directions || line?.instructions || null,
          extraInstructions: directions && line?.instructions ? line.instructions : null,
          batchNumber: batch?.batchNumber ?? null,
          expiryDate: batch?.expiryDate ?? null,
          auxiliaryLabels: product?.auxiliaryLabels ?? [],
          isColdChain: product?.isColdChain ?? false,
          substitutedFor: item.substitutedForProductId
            ? (productById.get(item.substitutedForProductId)?.genericName ?? 'the prescribed brand')
            : null,
        };
      }),
    };
  }

  /**
   * Count a label print (§24).
   *
   * Reprints are counted rather than prevented: a label that jams in the
   * printer has to be printed again. What matters is that a dispensing whose
   * label has been printed eleven times is visible as such.
   */
  async recordLabelPrint(id: string, user: AuthenticatedUser) {
    const existing = await this.prisma.dispensing.findUnique({
      where: { id },
      select: { id: true, branchId: true, labelPrintCount: true, dispensingNo: true },
    });
    if (!existing) throw new BadRequestException('Dispensing not found');
    this.scope.assertBranch(user, existing.branchId);

    const updated = await this.prisma.dispensing.update({
      where: { id },
      data: { labelPrintCount: { increment: 1 } },
      select: { id: true, labelPrintCount: true },
    });

    if (updated.labelPrintCount > 1) {
      await this.audit.record({
        userId: user.id,
        userLabel: user.fullName,
        module: 'dispensing',
        action: 'REPRINT_LABEL',
        entityType: 'Dispensing',
        entityId: id,
        newValue: { dispensingNo: existing.dispensingNo, printCount: updated.labelPrintCount },
        branchId: existing.branchId,
      });
    }

    return updated;
  }

  /**
   * What this patient has been supplied, newest first (§23).
   *
   * The medication history a pharmacist reads before supplying anything else.
   * Product names are resolved here so the screen does not have to make one
   * request per line.
   */
  async patientHistory(patientId: string, user: AuthenticatedUser, limit = 50) {
    const rows = await this.prisma.dispensing.findMany({
      where: { patientId, ...this.scope.branchFilter(user) },
      include: {
        items: true,
        prescription: { select: { prescriptionNo: true, prescriberName: true } },
      },
      orderBy: { dispensedAt: 'desc' },
      take: Math.min(200, limit),
    });

    const productIds = [...new Set(rows.flatMap((d) => d.items.map((i) => i.productId)))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, genericName: true, brandName: true, strength: true, dosageForm: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    return {
      data: rows.map((d) => ({
        id: d.id,
        dispensingNo: d.dispensingNo,
        dispensedAt: d.dispensedAt,
        reversedAt: d.reversedAt,
        prescriptionNo: d.prescription?.prescriptionNo ?? null,
        prescriberName: d.prescription?.prescriberName ?? null,
        counsellingNotes: d.counsellingNotes,
        items: d.items.map((i) => ({
          productId: i.productId,
          product: byId.get(i.productId) ?? null,
          quantity: i.quantity,
          batchId: i.batchId,
          substitutedForProductId: i.substitutedForProductId,
        })),
      })),
      // Reversed supplies are shown, not hidden: a history that quietly drops
      // them reads as though the medicine was never made up.
      note: 'Reversed dispensings are listed with their reversal date rather than removed.',
    };
  }

  /**
   * Today at a glance, for the dispensing screen's header (§23).
   */
  async todaySummary(user: AuthenticatedUser, branchId?: string) {
    if (branchId) this.scope.assertBranch(user, branchId);
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const where: Prisma.DispensingWhereInput = {
      ...this.scope.branchFilter(user),
      ...(branchId ? { branchId } : {}),
      dispensedAt: { gte: start },
    };

    const rows = await this.prisma.dispensing.findMany({
      where,
      select: {
        id: true,
        pharmacistId: true,
        reversedAt: true,
        overriddenWarnings: true,
        items: { select: { id: true, substitutedForProductId: true, overrideReason: true } },
      },
    });

    return {
      since: start,
      dispensings: rows.length,
      reversed: rows.filter((d) => d.reversedAt).length,
      lines: rows.reduce((n, d) => n + d.items.length, 0),
      substitutions: rows.reduce(
        (n, d) => n + d.items.filter((i) => i.substitutedForProductId).length,
        0,
      ),
      fefoOverrides: rows.reduce((n, d) => n + d.items.filter((i) => i.overrideReason).length, 0),
      warningsOverridden: rows.reduce(
        (n, d) => n + (Array.isArray(d.overriddenWarnings) ? d.overriddenWarnings.length : 0),
        0,
      ),
      pharmacists: new Set(rows.map((d) => d.pharmacistId)).size,
    };
  }

  /**
   * Dispensing volume per pharmacist over a window (§23).
   *
   * Presented as a workload measure, not a performance score: a pharmacist who
   * dispensed fewer prescriptions may have spent the afternoon on the ones that
   * needed a conversation.
   */
  async workload(
    user: AuthenticatedUser,
    query: { branchId?: string; days?: number } = {},
  ) {
    if (query.branchId) this.scope.assertBranch(user, query.branchId);
    const days = Math.min(180, Math.max(1, query.days ?? 30));
    const since = new Date(Date.now() - days * 86_400_000);

    const rows = await this.prisma.dispensing.findMany({
      where: {
        ...this.scope.branchFilter(user),
        ...(query.branchId ? { branchId: query.branchId } : {}),
        dispensedAt: { gte: since },
      },
      select: {
        pharmacistId: true,
        reversedAt: true,
        counsellingNotes: true,
        items: { select: { id: true } },
      },
    });

    const byPharmacist = new Map<
      string,
      { dispensings: number; lines: number; reversed: number; counselled: number }
    >();
    for (const row of rows) {
      const entry = byPharmacist.get(row.pharmacistId) ?? {
        dispensings: 0,
        lines: 0,
        reversed: 0,
        counselled: 0,
      };
      entry.dispensings += 1;
      entry.lines += row.items.length;
      if (row.reversedAt) entry.reversed += 1;
      if (row.counsellingNotes?.trim()) entry.counselled += 1;
      byPharmacist.set(row.pharmacistId, entry);
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: [...byPharmacist.keys()] } },
      select: { id: true, fullName: true },
    });
    const names = new Map(users.map((u) => [u.id, u.fullName]));

    return {
      since,
      days,
      data: [...byPharmacist.entries()]
        .map(([pharmacistId, stats]) => ({
          pharmacistId,
          pharmacist: names.get(pharmacistId) ?? 'Unknown',
          ...stats,
          counselledPct: stats.dispensings
            ? Math.round((stats.counselled / stats.dispensings) * 100)
            : 0,
        }))
        .sort((a, b) => b.dispensings - a.dispensings),
      note:
        'A workload measure, not a performance score. Prescriptions differ in the time they take.',
    };
  }

  async findOne(id: string, user?: AuthenticatedUser) {
    const dispensing = await this.prisma.dispensing.findUnique({
      where: { id },
      include: {
        items: true,
        prescription: {
          select: { prescriptionNo: true, prescriberName: true, patientId: true },
        },
      },
    });
    // §33: not found and not yours read the same from outside.
    if (!dispensing) throw new BadRequestException('Dispensing not found');
    if (user) this.scope.assertBranch(user, dispensing.branchId);
    return dispensing;
  }

  async findAll(
    user: AuthenticatedUser,
    query: {
      patientId?: string;
      branchId?: string;
      prescriptionId?: string;
      from?: Date;
      to?: Date;
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, query.pageSize ?? 25);
    if (query.branchId) this.scope.assertBranch(user, query.branchId);

    // §4: a dispensing names a patient and a medicine. It is read within the
    // reader's own branches, whatever branchId they ask for.
    const where: Prisma.DispensingWhereInput = {
      ...this.scope.branchFilter(user),
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.prescriptionId ? { prescriptionId: query.prescriptionId } : {}),
      ...(query.from || query.to
        ? {
            dispensedAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.dispensing.findMany({
        where,
        include: {
          items: true,
          prescription: { select: { prescriptionNo: true, prescriberName: true } },
        },
        orderBy: { dispensedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.dispensing.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }
}
