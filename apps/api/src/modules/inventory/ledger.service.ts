import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CacheService } from '../../common/cache/cache.service';
import { ConfigService } from '../../common/config/config.service';

export type MovementDirection = 'IN' | 'OUT';

export interface MovementInput {
  type: TransactionType;
  direction: MovementDirection;
  productId: string;
  batchId?: string | null;
  warehouseId: string;
  locationId?: string | null;
  branchId: string;
  /** Always positive, always in the product's base unit. */
  quantity: number | Prisma.Decimal;
  unitCost?: number | Prisma.Decimal;
  referenceType?: string;
  referenceId?: string;
  referenceNo?: string;
  reason?: string;
  performedById?: string;
  /** Repeat-safe key; a second post with the same key is rejected (§48). */
  idempotencyKey?: string;
  /** Set by recall/disposal flows that must move otherwise-blocked stock. */
  allowBlockedStatus?: boolean;
  /**
   * When the movement actually happened, for a delivery keyed in the next
   * morning. Defaults to now. How far back this may reach, and whether it may
   * reach forward at all, are administrator settings (§65).
   */
  occurredAt?: Date;
}

/**
 * Outbound movements that represent stock leaving for a patient or customer.
 * These may only draw on batches that are AVAILABLE or RELEASED (§8, §73).
 */
const SELLABLE_ONLY_TYPES: TransactionType[] = [
  TransactionType.SALE,
  TransactionType.DISPENSING,
  TransactionType.TRANSFER_OUT,
  TransactionType.RESERVATION,
];

const NON_ALLOCATABLE_STATUSES = [
  'QUARANTINED',
  'BLOCKED',
  'DAMAGED',
  'EXPIRED',
  'RECALLED',
  'DESTROYED',
  'RETURNED',
];

/**
 * The stock ledger (§19) - the single source of truth for inventory.
 *
 * Rules enforced here, not in callers:
 *   - the ledger is append-only; nothing updates or deletes a transaction row
 *   - every movement takes a row lock before reading the balance (§48)
 *   - a balance may never go negative unless the organization opts in
 *   - expired, recalled, quarantined and blocked batches cannot be dispensed,
 *     sold, transferred or reserved
 *   - `balanceAfter` is written on every row, so any historical balance can be
 *     read back without replaying the whole table
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Validate the date a movement claims to have happened on (§19).
   *
   * A stock ledger that can only ever be stamped "now" cannot record a delivery
   * entered the next morning, and one that accepts any date at all lets a
   * mistake or a cover-up be dated wherever it is least likely to be noticed.
   * Both limits are configured rather than assumed.
   */
  private async resolveOccurredAt(requested?: Date): Promise<Date> {
    const now = new Date();
    if (!requested) return now;
    if (Number.isNaN(requested.getTime())) {
      throw new BadRequestException('The movement date is not a valid date');
    }

    if (requested.getTime() > now.getTime()) {
      if (!(await this.config.getBoolean('inventory.allowFutureDating'))) {
        throw new BadRequestException(
          'A movement cannot be dated in the future: it has not happened yet. ' +
            'An administrator can allow this with inventory.allowFutureDating.',
        );
      }
      return requested;
    }

    const limitDays = await this.config.getNumber('inventory.backdateLimitDays');
    const ageDays = (now.getTime() - requested.getTime()) / 86_400_000;
    if (ageDays > limitDays) {
      throw new BadRequestException(
        limitDays === 0
          ? 'Backdating is turned off (inventory.backdateLimitDays is 0), so a movement is recorded as of now.'
          : `A movement may be backdated at most ${limitDays} day(s); this one is ${Math.floor(ageDays)} days old.`,
      );
    }
    return requested;
  }

  private toDecimal(value: number | Prisma.Decimal): Prisma.Decimal {
    return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
  }

  private async negativeStockAllowed(tx: Prisma.TransactionClient): Promise<boolean> {
    const org = await tx.organization.findFirst({ select: { allowNegativeStock: true } });
    return org?.allowNegativeStock ?? false;
  }

  /**
   * Post a single movement. MUST be called inside an interactive transaction so
   * the lock, the balance read, the ledger insert and the balance update all
   * commit or roll back together.
   */
  async post(tx: Prisma.TransactionClient, input: MovementInput): Promise<{
    transactionId: string;
    balanceAfter: Prisma.Decimal;
  }> {
    const quantity = this.toDecimal(input.quantity);
    if (quantity.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Movement quantity must be greater than zero');
    }

    if (input.idempotencyKey) {
      const existing = await tx.inventoryTransaction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true, balanceAfter: true },
      });
      if (existing) {
        // Same request replayed: return the original result rather than
        // double-posting (§48).
        return { transactionId: existing.id, balanceAfter: existing.balanceAfter };
      }
    }

    // Serialize concurrent movements against this exact stock position.
    if (input.batchId) {
      await this.prisma.lockBalanceRows(
        tx,
        input.productId,
        input.warehouseId,
        input.batchId,
      );
    } else {
      await this.prisma.lockBalanceRows(tx, input.productId, input.warehouseId);
    }
    // The first movement for a batch has no row to lock, so also take an
    // advisory lock on the logical stock position.
    await this.prisma.advisoryLock(
      tx,
      `stock:${input.productId}:${input.batchId ?? 'none'}:${input.warehouseId}`,
    );

    if (input.batchId) {
      const batch = await tx.batch.findUniqueOrThrow({
        where: { id: input.batchId },
        select: { status: true, expiryDate: true, batchNumber: true },
      });

      const mustBeSellable =
        input.direction === 'OUT' &&
        SELLABLE_ONLY_TYPES.includes(input.type) &&
        !input.allowBlockedStatus;

      if (mustBeSellable) {
        if (NON_ALLOCATABLE_STATUSES.includes(batch.status)) {
          throw new ConflictException(
            `Batch ${batch.batchNumber} is ${batch.status} and cannot be used for ${input.type}`,
          );
        }
        if (batch.expiryDate.getTime() < Date.now()) {
          throw new ConflictException(
            `Batch ${batch.batchNumber} expired on ${batch.expiryDate
              .toISOString()
              .slice(0, 10)} and cannot be dispensed or sold`,
          );
        }
      }
    }

    // Balances are keyed by product + batch + warehouse + location, so a
    // caller that names a location gets exactly that row.
    let resolvedLocationId = input.locationId ?? null;
    let balance = await tx.inventoryBalance.findFirst({
      where: {
        productId: input.productId,
        batchId: input.batchId ?? null,
        warehouseId: input.warehouseId,
        locationId: resolvedLocationId,
      },
    });

    // A caller that does not care about bins -- damage, adjustment, disposal --
    // still has to take the stock out of a real one. Stock is often not on the
    // warehouse-level row at all: it is sitting in a bin. Rather than report
    // zero available while the shelf is full, resolve the location holding it.
    //
    // Ambiguity is refused rather than guessed: taking stock out of whichever
    // bin happened to sort first would make the ledger disagree with the shelf.
    const needsResolution =
      !input.locationId &&
      input.direction === 'OUT' &&
      (!balance || balance.onHand.lessThan(quantity));

    if (needsResolution) {
      const holding = await tx.inventoryBalance.findMany({
        where: {
          productId: input.productId,
          batchId: input.batchId ?? null,
          warehouseId: input.warehouseId,
          onHand: { gt: 0 },
        },
        include: { location: { select: { code: true } } },
      });

      const sufficient = holding.filter((h) => h.onHand.greaterThanOrEqualTo(quantity));

      if (sufficient.length === 1) {
        balance = sufficient[0];
        resolvedLocationId = sufficient[0].locationId;
      } else if (sufficient.length > 1) {
        throw new ConflictException(
          `${quantity.toString()} unit(s) could come from ${sufficient.length} locations ` +
            `(${sufficient.map((h) => h.location?.code ?? 'unlocated').join(', ')}). ` +
            `Name the location this movement is taken from.`,
        );
      } else if (holding.length > 1) {
        const total = holding.reduce((sum, h) => sum.plus(h.onHand), new Prisma.Decimal(0));
        throw new ConflictException(
          `No single location holds ${quantity.toString()} unit(s); the stock is split across ` +
            `${holding.length} location(s) totalling ${total.toString()}. ` +
            `Move it together or post one movement per location.`,
        );
      } else if (holding.length === 1) {
        // One location, and it simply does not hold enough. Fall through to the
        // ordinary insufficient-stock path so the caller gets that reason
        // rather than a confusing note about a split that does not exist -- and
        // so the negative-stock setting still governs.
        balance = holding[0];
        resolvedLocationId = holding[0].locationId;
      }
    }

    const current = balance?.onHand ?? new Prisma.Decimal(0);
    const delta = input.direction === 'IN' ? quantity : quantity.negated();
    const balanceAfter = current.plus(delta);

    if (balanceAfter.lessThan(0) && !(await this.negativeStockAllowed(tx))) {
      throw new ConflictException(
        `Insufficient stock: ${current.toString()} available, ${quantity.toString()} requested. ` +
          `Negative inventory is disabled for this organization.`,
      );
    }

    const reserved = balance?.reserved ?? new Prisma.Decimal(0);
    if (
      input.direction === 'OUT' &&
      input.type !== TransactionType.RESERVATION_RELEASE &&
      balanceAfter.lessThan(reserved) &&
      input.type !== TransactionType.RECALL &&
      input.type !== TransactionType.DISPOSAL
    ) {
      throw new ConflictException(
        `Cannot move ${quantity.toString()} units: ${reserved.toString()} of the ` +
          `${current.toString()} on hand are reserved for other documents`,
      );
    }

    const occurredAt = await this.resolveOccurredAt(input.occurredAt);

    const transaction = await tx.inventoryTransaction.create({
      data: {
        occurredAt,
        type: input.type,
        productId: input.productId,
        batchId: input.batchId ?? null,
        warehouseId: input.warehouseId,
        locationId: resolvedLocationId,
        branchId: input.branchId,
        quantityIn: input.direction === 'IN' ? quantity : new Prisma.Decimal(0),
        quantityOut: input.direction === 'OUT' ? quantity : new Prisma.Decimal(0),
        balanceAfter,
        unitCost: this.toDecimal(input.unitCost ?? 0),
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        referenceNo: input.referenceNo ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        reason: input.reason ?? null,
        performedById: input.performedById ?? null,
      },
    });

    if (balance) {
      await tx.inventoryBalance.update({
        where: { id: balance.id },
        data: { onHand: balanceAfter, lastMovementAt: new Date() },
      });
    } else {
      await tx.inventoryBalance.create({
        data: {
          productId: input.productId,
          batchId: input.batchId ?? null,
          warehouseId: input.warehouseId,
          locationId: resolvedLocationId,
          branchId: input.branchId,
          onHand: balanceAfter,
          lastMovementAt: new Date(),
        },
      });
    }

    // Stock moved, so any cached dashboard figure is now stale.
    this.cache.invalidate('dashboard:');

    return { transactionId: transaction.id, balanceAfter };
  }

  /** Convenience wrapper opening its own transaction for a set of movements. */
  async postMany(inputs: MovementInput[]): Promise<{ transactionIds: string[] }> {
    return this.prisma.$transaction(
      async (tx) => {
        const ids: string[] = [];
        for (const input of inputs) {
          const { transactionId } = await this.post(tx, input);
          ids.push(transactionId);
        }
        return { transactionIds: ids };
      },
      { timeout: 20_000 },
    );
  }

  /**
   * Reserve stock for a pending document. Reservations do not move stock; they
   * reduce what FEFO considers available so two carts cannot promise the same
   * units.
   */
  async reserve(
    tx: Prisma.TransactionClient,
    input: {
      productId: string;
      batchId: string;
      warehouseId: string;
      quantity: number | Prisma.Decimal;
      referenceType: string;
      referenceId: string;
      createdById?: string;
    },
  ): Promise<void> {
    const quantity = this.toDecimal(input.quantity);
    await this.prisma.lockBalanceRows(tx, input.productId, input.warehouseId, input.batchId);

    const balance = await tx.inventoryBalance.findFirst({
      where: {
        productId: input.productId,
        batchId: input.batchId,
        warehouseId: input.warehouseId,
      },
      // Deterministic, so two calls never pick different rows for one batch
      // that is split across bins.
      orderBy: { id: 'asc' },
    });
    if (!balance) throw new ConflictException('No stock position exists to reserve against');

    const available = balance.onHand.minus(balance.reserved);
    if (available.lessThan(quantity)) {
      throw new ConflictException(
        `Cannot reserve ${quantity.toString()}: only ${available.toString()} available ` +
          `(${balance.reserved.toString()} already reserved)`,
      );
    }

    await tx.inventoryBalance.update({
      where: { id: balance.id },
      data: { reserved: balance.reserved.plus(quantity) },
    });
    await tx.stockReservation.create({
      data: {
        productId: input.productId,
        batchId: input.batchId,
        warehouseId: input.warehouseId,
        // Recorded so the release decrements the same row this incremented.
        balanceId: balance.id,
        quantity,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        createdById: input.createdById ?? null,
      },
    });
  }

  /** Release reservations for a document (on cancel, or on conversion to a sale). */
  async releaseReservations(
    tx: Prisma.TransactionClient,
    referenceType: string,
    referenceId: string,
  ): Promise<void> {
    const reservations = await tx.stockReservation.findMany({
      where: { referenceType, referenceId, releasedAt: null },
    });

    for (const reservation of reservations) {
      await this.prisma.lockBalanceRows(
        tx,
        reservation.productId,
        reservation.warehouseId,
        reservation.batchId,
      );
      // Prefer the row the reservation actually incremented. The lookup below
      // is only for reservations written before balanceId existed.
      const balance = reservation.balanceId
        ? await tx.inventoryBalance.findUnique({ where: { id: reservation.balanceId } })
        : await tx.inventoryBalance.findFirst({
            where: {
              productId: reservation.productId,
              batchId: reservation.batchId,
              warehouseId: reservation.warehouseId,
            },
            orderBy: { id: 'asc' },
          });
      if (balance) {
        const next = balance.reserved.minus(reservation.quantity);
        await tx.inventoryBalance.update({
          where: { id: balance.id },
          data: { reserved: next.lessThan(0) ? new Prisma.Decimal(0) : next },
        });
      }
      await tx.stockReservation.update({
        where: { id: reservation.id },
        data: { releasedAt: new Date() },
      });
    }
  }

  /**
   * Recompute a stock position by replaying the ledger (§19: every balance must
   * be reconstructable). Used by the integrity report and after any restore.
   */
  async reconstructBalance(
    productId: string,
    warehouseId: string,
    batchId?: string,
    asOf?: Date,
  ): Promise<Prisma.Decimal> {
    const result = await this.prisma.inventoryTransaction.aggregate({
      where: {
        productId,
        warehouseId,
        ...(batchId ? { batchId } : {}),
        ...(asOf ? { occurredAt: { lte: asOf } } : {}),
      },
      _sum: { quantityIn: true, quantityOut: true },
    });
    const inSum = result._sum.quantityIn ?? new Prisma.Decimal(0);
    const outSum = result._sum.quantityOut ?? new Prisma.Decimal(0);
    return inSum.minus(outSum);
  }

  /**
   * Compare every cached balance against a ledger replay. A mismatch means the
   * cache drifted and must be investigated - it is reported, never silently
   * "fixed" behind the operator's back.
   */
  async verifyIntegrity(warehouseId?: string): Promise<{
    checked: number;
    mismatches: Array<{
      productId: string;
      batchId: string | null;
      warehouseId: string;
      cached: string;
      ledger: string;
    }>;
  }> {
    const balances = await this.prisma.inventoryBalance.findMany({
      where: warehouseId ? { warehouseId } : {},
    });

    const mismatches: Array<{
      productId: string;
      batchId: string | null;
      warehouseId: string;
      cached: string;
      ledger: string;
    }> = [];

    for (const balance of balances) {
      const ledger = await this.reconstructBalance(
        balance.productId,
        balance.warehouseId,
        balance.batchId ?? undefined,
      );
      if (!ledger.equals(balance.onHand)) {
        mismatches.push({
          productId: balance.productId,
          batchId: balance.batchId,
          warehouseId: balance.warehouseId,
          cached: balance.onHand.toString(),
          ledger: ledger.toString(),
        });
      }
    }

    return { checked: balances.length, mismatches };
  }
}
