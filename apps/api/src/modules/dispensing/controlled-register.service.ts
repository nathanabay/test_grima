import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
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
  /** Set on a REVERSAL entry: why, and which entry it cancels. */
  reversalReason?: string;
  reversalOfId?: string;
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
        reversalReason: input.reversalReason ?? null,
        reversalOfId: input.reversalOfId ?? null,
      },
    });
  }

  /**
   * Open the register for a product at a branch (§28).
   *
   * Until this existed the register could only be written by dispensing, and
   * dispensing refuses to take the running balance negative — so a pharmacy
   * that already held controlled stock could never make its first supply. The
   * register had no way in.
   *
   * The opening balance is not a number somebody types: it is read from the
   * stock the branch actually holds, so the register starts in step with the
   * shelf rather than with an estimate. It can be done once per product and
   * branch; after that the register is a history and corrections are
   * reversals.
   */
  async openingBalance(
    input: { productId: string; branchId: string; notes?: string; witnessedById?: string },
    user: AuthenticatedUser,
  ) {
    const product = await this.prisma.product.findUnique({
      where: { id: input.productId },
      select: { id: true, genericName: true, isControlled: true },
    });
    if (!product) throw new BadRequestException('Product not found');
    if (!product.isControlled) {
      throw new BadRequestException(
        `${product.genericName} is not a controlled medicine, so it has no register to open`,
      );
    }

    const existing = await this.prisma.controlledRegisterEntry.findFirst({
      where: { productId: input.productId, branchId: input.branchId },
      select: { entryNo: true },
    });
    if (existing) {
      throw new ConflictException(
        `The register for this product at this branch was opened at entry ${existing.entryNo}. ` +
          `An opening balance is recorded once; a later correction is a reversal.`,
      );
    }

    // The balance the branch physically holds, per batch, so the opening entries
    // name real batches rather than one lump nobody can trace.
    const balances = await this.prisma.inventoryBalance.findMany({
      where: {
        productId: input.productId,
        branchId: input.branchId,
        onHand: { gt: 0 },
      },
      select: { batchId: true, onHand: true },
    });
    if (!balances.length) {
      throw new BadRequestException(
        `This branch holds no ${product.genericName}. A register is opened against stock, not ` +
          `against an intention to hold it.`,
      );
    }

    // Several locations can hold the same batch; the register counts batches.
    const byBatch = new Map<string, Prisma.Decimal>();
    for (const b of balances) {
      if (!b.batchId) continue;
      byBatch.set(b.batchId, (byBatch.get(b.batchId) ?? new Prisma.Decimal(0)).plus(b.onHand));
    }
    if (!byBatch.size) {
      throw new BadRequestException(
        `The stock of ${product.genericName} at this branch is not held against a batch, so it ` +
          `cannot be entered on a controlled register.`,
      );
    }

    const entries = await this.prisma.$transaction(async (tx) => {
      const created: Awaited<ReturnType<typeof this.record>>[] = [];
      for (const [batchId, quantity] of byBatch) {
        created.push(
          await this.record(tx, {
            productId: input.productId,
            batchId,
            branchId: input.branchId,
            entryType: 'RECEIPT',
            quantityIn: Number(quantity),
            performedById: user.id,
            witnessedById: input.witnessedById,
          }),
        );
      }
      return created;
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'dispensing',
      action: 'CONTROLLED_REGISTER_OPENED',
      entityType: 'Product',
      entityId: input.productId,
      newValue: {
        product: product.genericName,
        entries: entries.length,
        openingBalance: entries[entries.length - 1]?.runningBalance?.toString(),
      },
      reason: input.notes?.trim() || 'Opening balance from stock on hand',
      branchId: input.branchId,
    });

    return {
      product: product.genericName,
      entries,
      openingBalance: entries[entries.length - 1]?.runningBalance ?? new Prisma.Decimal(0),
      note:
        'The opening balance was read from stock on hand, not typed. Reconcile the register ' +
        'against a physical count before relying on it.',
    };
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

    if (original.entryType === 'REVERSAL') {
      throw new ConflictException('A reversal cannot itself be reversed');
    }
    const alreadyReversed = await this.prisma.controlledRegisterEntry.findFirst({
      where: { reversalOfId: original.id },
      select: { entryNo: true },
    });
    if (alreadyReversed) {
      // Two reversals of one entry put the register permanently above physical
      // stock, and reconcile() then reports an unexplained variance on a
      // controlled drug forever.
      throw new ConflictException(
        `Entry ${original.entryNo} was already reversed by entry ${alreadyReversed.entryNo}`,
      );
    }

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
   * Anomaly detection over the controlled register (§28: features 918-922).
   *
   * Diversion of controlled medicines does not announce itself; it shows up as
   * a pattern - one dispenser handling far more than their peers, quantities
   * that jump, activity outside working hours, one prescriber's name recurring.
   *
   * Every signal here is a prompt to look, never a conclusion. Nothing is
   * blocked, nobody is accused, and the numbers behind each flag travel with
   * it so a supervisor can judge rather than trust.
   */
  async anomalies(query: { branchId?: string; days?: number; productId?: string }) {
    const days = Math.min(365, Math.max(7, query.days ?? 90));
    const since = new Date(Date.now() - days * 86_400_000);

    const entries = await this.prisma.controlledRegisterEntry.findMany({
      where: {
        occurredAt: { gte: since },
        entryType: 'DISPENSE',
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.productId ? { productId: query.productId } : {}),
      },
      select: {
        id: true,
        entryNo: true,
        productId: true,
        branchId: true,
        quantityOut: true,
        performedById: true,
        witnessedById: true,
        prescriberName: true,
        occurredAt: true,
      },
      orderBy: { occurredAt: 'asc' },
    });

    const signals: Array<{
      type: string;
      severity: 'HIGH' | 'MEDIUM';
      subject: string;
      detail: string;
      evidence: Record<string, unknown>;
    }> = [];

    // The caption travels with an empty report too: a quiet result must not
    // read as a clean bill of health just because there is nothing to caption.
    const note =
      'These are prompts to investigate, not findings. Nothing here is evidence of wrongdoing on its own.';

    if (!entries.length) {
      return { days, since, entriesExamined: 0, note, signals };
    }

    // --- Dispenser volume against the peer average.
    const byDispenser = new Map<string, { quantity: Prisma.Decimal; count: number }>();
    for (const e of entries) {
      const cur = byDispenser.get(e.performedById) ?? { quantity: new Prisma.Decimal(0), count: 0 };
      byDispenser.set(e.performedById, {
        quantity: cur.quantity.plus(e.quantityOut),
        count: cur.count + 1,
      });
    }

    if (byDispenser.size >= 3) {
      const totals = [...byDispenser.values()].map((v) => Number(v.quantity));
      const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
      const variance = totals.reduce((sum, t) => sum + (t - mean) ** 2, 0) / totals.length;
      const stdDev = Math.sqrt(variance);

      // Two standard deviations above the peer mean. Requiring at least three
      // dispensers keeps a single-pharmacist branch from flagging itself.
      for (const [userId, v] of byDispenser) {
        const total = Number(v.quantity);
        if (stdDev > 0 && total > mean + 2 * stdDev) {
          signals.push({
            type: 'DISPENSER_VOLUME_OUTLIER',
            severity: 'HIGH',
            subject: userId,
            detail:
              `Dispensed ${total.toFixed(2)} units across ${v.count} entries against a peer ` +
              `average of ${mean.toFixed(2)}.`,
            evidence: { total, peerMean: Number(mean.toFixed(2)), stdDev: Number(stdDev.toFixed(2)), entries: v.count },
          });
        }
      }
    }

    // --- Quantities far above the usual size for that product.
    const byProduct = new Map<string, number[]>();
    for (const e of entries) {
      const list = byProduct.get(e.productId) ?? [];
      list.push(Number(e.quantityOut));
      byProduct.set(e.productId, list);
    }
    for (const e of entries) {
      const sizes = byProduct.get(e.productId) ?? [];
      if (sizes.length < 5) continue;
      const sorted = [...sizes].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const quantity = Number(e.quantityOut);
      if (median > 0 && quantity > median * 4) {
        signals.push({
          type: 'UNUSUAL_QUANTITY',
          severity: 'MEDIUM',
          subject: e.id,
          detail: `Entry ${e.entryNo} dispensed ${quantity} against a median of ${median} for this product.`,
          evidence: { entryNo: e.entryNo, quantity, median, productId: e.productId },
        });
      }
    }

    // --- Activity at hours the pharmacy is not normally dispensing.
    const outOfHours = entries.filter((e) => {
      const hour = e.occurredAt.getHours();
      return hour < 6 || hour >= 22;
    });
    for (const e of outOfHours) {
      signals.push({
        type: 'OUT_OF_HOURS',
        severity: 'MEDIUM',
        subject: e.id,
        detail: `Entry ${e.entryNo} was recorded at ${e.occurredAt.toISOString().slice(11, 16)}.`,
        evidence: { entryNo: e.entryNo, occurredAt: e.occurredAt, performedById: e.performedById },
      });
    }

    // --- Controlled dispensing recorded with no second person present.
    const unwitnessed = entries.filter((e) => !e.witnessedById);
    if (unwitnessed.length) {
      signals.push({
        type: 'UNWITNESSED_DISPENSING',
        severity: 'HIGH',
        subject: query.branchId ?? 'all branches',
        detail: `${unwitnessed.length} of ${entries.length} controlled dispensings were recorded without a witness.`,
        evidence: {
          unwitnessed: unwitnessed.length,
          total: entries.length,
          entryNos: unwitnessed.slice(0, 20).map((e) => e.entryNo),
        },
      });
    }

    // --- One prescriber's name behind a large share of the register.
    const byPrescriber = new Map<string, number>();
    for (const e of entries) {
      if (!e.prescriberName) continue;
      byPrescriber.set(e.prescriberName, (byPrescriber.get(e.prescriberName) ?? 0) + 1);
    }
    for (const [prescriber, count] of byPrescriber) {
      const share = count / entries.length;
      if (count >= 10 && share > 0.4) {
        signals.push({
          type: 'PRESCRIBER_CONCENTRATION',
          severity: 'MEDIUM',
          subject: prescriber,
          detail: `${(share * 100).toFixed(0)}% of controlled dispensings in this period name one prescriber.`,
          evidence: { prescriber, count, total: entries.length },
        });
      }
    }

    const order = { HIGH: 0, MEDIUM: 1 } as const;
    signals.sort((a, b) => order[a.severity] - order[b.severity]);

    return {
      days,
      since,
      entriesExamined: entries.length,
      note,
      signals,
    };
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
