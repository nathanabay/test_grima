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

export interface DispenseLineInput {
  productId: string;
  quantity: number;
  unitCode?: string;
  /** Omit to let FEFO choose. Supplying it records an override (§8). */
  batchId?: string;
  overrideReason?: string;
  prescriptionItemId?: string;
}

export interface DispenseInput {
  prescriptionId?: string;
  patientId?: string;
  branchId: string;
  warehouseId: string;
  lines: DispenseLineInput[];
  notes?: string;
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
  ) {}

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

          // Check the prescribed quantity is not exceeded.
          if (prescription && line.prescriptionItemId) {
            const item = prescription.items.find((i) => i.id === line.prescriptionItemId);
            if (!item) throw new BadRequestException('Prescription item not found on this prescription');
            const outstanding = item.prescribedQty.minus(item.dispensedQty);
            if (new Prisma.Decimal(quantity).greaterThan(outstanding)) {
              throw new ConflictException(
                `Cannot dispense ${quantity}: only ${outstanding.toString()} of the prescribed ` +
                  `${item.prescribedQty.toString()} remain on this prescription`,
              );
            }
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

  async findOne(id: string) {
    return this.prisma.dispensing.findUniqueOrThrow({
      where: { id },
      include: {
        items: true,
        prescription: {
          select: { prescriptionNo: true, prescriberName: true, patientId: true },
        },
      },
    });
  }

  async findAll(query: { patientId?: string; branchId?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, query.pageSize ?? 25);
    const where = {
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.dispensing.findMany({
        where,
        include: { items: true },
        orderBy: { dispensedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.dispensing.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }
}
