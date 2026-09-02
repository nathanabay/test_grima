import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ConfigService } from '../../common/config/config.service';
import { AuthenticatedUser } from '../../common/decorators';

export interface RegisterEntryInput {
  productId: string;
  batchId: string;
  branchId: string;
  entryType: 'RECEIPT' | 'DISPENSE' | 'RETURN' | 'DESTRUCTION' | 'REVERSAL' | 'ADJUSTMENT';
  quantityIn?: number;
  quantityOut?: number;
  prescriptionId?: string;
  prescriberName?: string;
  patientId?: string;
  performedById: string;
  witnessedById?: string;
}

/**
 * Controlled medicines register (§28).
 *
 * Append-only with a running balance. Nothing here is ever edited or deleted -
 * a correction is a REVERSAL row that points at the entry it cancels, so the
 * register can always be reconciled against physical stock.
 */
@Injectable()
export class ControlledRegisterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async record(tx: Prisma.TransactionClient, input: RegisterEntryInput) {
    const last = await tx.controlledRegisterEntry.findFirst({
      where: { productId: input.productId, branchId: input.branchId },
      orderBy: { entryNo: 'desc' },
      select: { runningBalance: true },
    });

    const previous = last?.runningBalance ?? new Prisma.Decimal(0);
    const quantityIn = new Prisma.Decimal(input.quantityIn ?? 0);
    const quantityOut = new Prisma.Decimal(input.quantityOut ?? 0);
    const runningBalance = previous.plus(quantityIn).minus(quantityOut);

    // §65: some jurisdictions require a second person to witness every
    // controlled movement. Where that is switched on, an entry without a
    // witness is refused rather than recorded and chased afterwards.
    if (
      !input.witnessedById &&
      (await this.config.getBoolean('controlled.requireDualAuthorization'))
    ) {
      throw new BadRequestException(
        'A controlled register entry needs a second person to witness it ' +
          '(controlled.requireDualAuthorization is on).',
      );
    }

    if (runningBalance.lessThan(0)) {
      throw new BadRequestException(
        `Controlled register balance would go negative (${runningBalance.toString()}). ` +
          `Reconcile the register before dispensing.`,
      );
    }

    return tx.controlledRegisterEntry.create({
      data: {
        productId: input.productId,
        batchId: input.batchId,
        branchId: input.branchId,
        entryType: input.entryType,
        quantityIn,
        quantityOut,
        runningBalance,
        prescriptionId: input.prescriptionId ?? null,
        prescriberName: input.prescriberName ?? null,
        patientId: input.patientId ?? null,
        performedById: input.performedById,
        witnessedById: input.witnessedById ?? null,
      },
    });
  }

  /** Corrections never mutate history — they append a compensating entry. */
  async reverse(
    entryId: string,
    reason: string,
    user: AuthenticatedUser,
    witnessedById?: string,
  ) {
    const original = await this.prisma.controlledRegisterEntry.findUniqueOrThrow({
      where: { id: entryId },
    });

    const entry = await this.prisma.$transaction(async (tx) =>
      this.record(tx, {
        productId: original.productId,
        batchId: original.batchId,
        branchId: original.branchId,
        entryType: 'REVERSAL',
        // Swap the direction to cancel the original movement.
        quantityIn: Number(original.quantityOut),
        quantityOut: Number(original.quantityIn),
        performedById: user.id,
        witnessedById,
      }).then((created) =>
        tx.controlledRegisterEntry.update({
          where: { id: created.id },
          data: { reversalOfId: original.id, reversalReason: reason },
        }),
      ),
    );

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'dispensing',
      action: 'CONTROLLED_REGISTER_REVERSAL',
      entityType: 'ControlledRegisterEntry',
      entityId: entry.id,
      previousValue: { originalEntryNo: original.entryNo },
      reason,
      branchId: original.branchId,
    });

    return entry;
  }

  /** The register view: every movement for a product at a branch, in order. */
  async register(query: {
    productId?: string;
    branchId?: string;
    from?: Date;
    to?: Date;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(500, query.pageSize ?? 100);
    const where = {
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.from || query.to
        ? {
            occurredAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.controlledRegisterEntry.findMany({
        where,
        orderBy: { entryNo: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.controlledRegisterEntry.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  /**
   * Reconcile the register against physical stock (§28). Any difference is
   * reported for investigation - it is never auto-corrected.
   */
  async reconcile(productId: string, branchId: string) {
    const last = await this.prisma.controlledRegisterEntry.findFirst({
      where: { productId, branchId },
      orderBy: { entryNo: 'desc' },
    });
    const registerBalance = last?.runningBalance ?? new Prisma.Decimal(0);

    const physical = await this.prisma.inventoryBalance.aggregate({
      where: { productId, branchId },
      _sum: { onHand: true },
    });
    const physicalBalance = physical._sum.onHand ?? new Prisma.Decimal(0);
    const variance = physicalBalance.minus(registerBalance);

    // Most jurisdictions run controlled stock at zero tolerance, which is the
    // default; the setting exists for those that allow a stated allowance for
    // measurable forms such as liquids (§65).
    const tolerance = new Prisma.Decimal(
      await this.config.getNumber('controlled.varianceTolerance'),
    );
    const withinTolerance = variance.abs().lessThanOrEqualTo(tolerance);

    return {
      productId,
      branchId,
      registerBalance,
      physicalBalance,
      variance,
      tolerance,
      reconciled: variance.equals(0),
      withinTolerance,
      // A variance inside a stated allowance still gets recorded; it just does
      // not stop the day. Anything outside it has to be investigated.
      requiresInvestigation: !withinTolerance,
    };
  }
}
