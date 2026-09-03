import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BatchStatus, Prisma, TransactionType } from '@prisma/client';
import {
  bucketFor,
  classifyExpiry,
  daysUntil,
  expiryBuckets,
  expiryRiskScore,
} from '@pharmacore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthenticatedUser } from '../../common/decorators';
import { ScopeService } from '../../common/guards/scope.service';
import { ConfigService } from '../../common/config/config.service';
import { AuditService } from '../../common/audit/audit.service';
import { LedgerService } from './ledger.service';

export interface StockQuery {
  productId?: string;
  warehouseId?: string;
  branchId?: string;
  locationId?: string;
  search?: string;
  onlyBelowReorder?: boolean;
  onlyOutOfStock?: boolean;
  onlyControlled?: boolean;
  onlyColdChain?: boolean;
  /** Batch status, e.g. only RELEASED stock. */
  batchStatus?: BatchStatus;
  /** Only positions whose batch expires within this many days. */
  expiringWithinDays?: number;
  sort?: 'product' | 'expiry' | 'onHand' | 'available' | 'value' | 'age';
  direction?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

/** Sorts Prisma can do in the database. `value` and `age` are derived. */
const DB_SORT: Record<string, (d: 'asc' | 'desc') => Prisma.InventoryBalanceOrderByWithRelationInput[]> = {
  product: (d) => [{ product: { genericName: d } }, { batch: { expiryDate: 'asc' } }],
  expiry: (d) => [{ batch: { expiryDate: d } }],
  onHand: (d) => [{ onHand: d }],
};

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly config: ConfigService,
    private readonly ledgerService: LedgerService,
    private readonly audit: AuditService,
  ) {}

  /** Paginated stock balances, always scoped to what the user may see. */
  async listBalances(user: AuthenticatedUser, query: StockQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, query.pageSize ?? 50);

    /**
     * "Below reorder" is a question about a PRODUCT, not about a shelf.
     *
     * The filter used to run over the current page after it had been fetched,
     * so asking "what do I need to order" returned whatever happened to be
     * below reorder among the first fifty rows, with a total that counted
     * everything. It also compared the product's reorder level against a single
     * balance row, so a product split across three bins looked short on each of
     * them while the branch actually held three times the level.
     *
     * The product ids are resolved first, from the branch-wide total per
     * product, and the page is then a normal query with those ids in it.
     */
    let belowReorderIds: string[] | null = null;
    if (query.onlyBelowReorder) {
      belowReorderIds = await this.productsBelowReorder(user, {
        warehouseId: query.warehouseId,
        branchId: query.branchId,
      });
      if (!belowReorderIds.length) {
        return { data: [], total: 0, page, pageSize, summary: this.emptySummary() };
      }
    }

    const search = query.search?.trim();
    const where: Prisma.InventoryBalanceWhereInput = {
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(this.scope.isUnscoped(user) ? {} : { branchId: { in: user.branchIds } }),
      ...(query.onlyOutOfStock ? { onHand: { lte: 0 } } : {}),
      ...(belowReorderIds ? { productId: { in: belowReorderIds } } : {}),
      ...(query.batchStatus || query.expiringWithinDays !== undefined
        ? {
            batch: {
              ...(query.batchStatus ? { status: query.batchStatus } : {}),
              ...(query.expiringWithinDays !== undefined
                ? {
                    expiryDate: {
                      lte: new Date(Date.now() + query.expiringWithinDays * 86_400_000),
                    },
                  }
                : {}),
            },
          }
        : {}),
      ...(query.onlyControlled || query.onlyColdChain
        ? {
            product: {
              ...(query.onlyControlled ? { isControlled: true } : {}),
              ...(query.onlyColdChain ? { isColdChain: true } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { product: { genericName: { contains: search, mode: 'insensitive' as const } } },
              { product: { brandName: { contains: search, mode: 'insensitive' as const } } },
              { product: { sku: { contains: search, mode: 'insensitive' as const } } },
              // A storekeeper reads the batch number off the box, so it is
              // searchable from the same field as the product name.
              { batch: { batchNumber: { contains: search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.inventoryBalance.findMany({
        where,
        include: {
          product: {
            select: {
              id: true,
              sku: true,
              genericName: true,
              brandName: true,
              strength: true,
              dosageForm: true,
              baseUnit: true,
              reorderLevel: true,
              isControlled: true,
              isColdChain: true,
              averageCost: true,
              retailPrice: true,
            },
          },
          batch: {
            select: {
              id: true,
              batchNumber: true,
              expiryDate: true,
              status: true,
              receivedDate: true,
              purchaseCost: true,
            },
          },
          warehouse: { select: { id: true, name: true, code: true, branchId: true } },
          location: { select: { id: true, code: true, name: true } },
        },
        orderBy: (DB_SORT[query.sort ?? 'product'] ?? DB_SORT.product)(query.direction ?? 'asc'),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.inventoryBalance.count({ where }),
    ]);

    const now = Date.now();
    const data = rows.map((row) => {
      const available = row.onHand.minus(row.reserved);
      return {
        ...row,
        available,
        expiryBucket: row.batch ? classifyExpiry(row.batch.expiryDate) : null,
        daysToExpiry: row.batch ? daysUntil(row.batch.expiryDate) : null,
        /**
         * Valued at what is held, not at what is unreserved.
         *
         * This used to multiply `available`, so every hold at the till or open
         * pick wave silently wrote value off the stock screen while the ledger
         * and the balance sheet still carried it. A reservation is a promise
         * about where stock is going, not a disposal.
         */
        stockValue: row.onHand.times(row.product.averageCost),
        /** How long this stock has been sitting, for slow-mover triage. */
        ageDays: row.batch?.receivedDate
          ? Math.floor((now - row.batch.receivedDate.getTime()) / 86_400_000)
          : null,
      };
    });

    // `value` and `age` are derived, so they are ordered after the page is
    // fetched. That is honest about what it does — it sorts the page, not the
    // whole result — and the column header says so.
    if (query.sort === 'value' || query.sort === 'age' || query.sort === 'available') {
      const sign = query.direction === 'desc' ? -1 : 1;
      data.sort((a, b) => {
        if (query.sort === 'value') return sign * a.stockValue.comparedTo(b.stockValue);
        if (query.sort === 'available') return sign * a.available.comparedTo(b.available);
        return sign * ((a.ageDays ?? -1) - (b.ageDays ?? -1));
      });
    }

    return {
      data,
      total,
      page,
      pageSize,
      summary: await this.balanceSummary(where),
      /** Named so a screen can say which sorts are page-local. */
      sortedAcrossAllPages: !['value', 'age', 'available'].includes(query.sort ?? 'product'),
    };
  }

  private emptySummary() {
    return {
      positions: 0,
      products: 0,
      units: '0',
      reserved: '0',
      value: '0',
      expiringWithin90Days: 0,
      outOfStock: 0,
      negative: 0,
    };
  }

  /**
   * Totals for the whole filtered set, not for the page.
   *
   * A stock screen whose header counts only the rows currently visible answers
   * a question nobody asked.
   */
  private async balanceSummary(where: Prisma.InventoryBalanceWhereInput) {
    const rows = await this.prisma.inventoryBalance.findMany({
      where,
      select: {
        productId: true,
        onHand: true,
        reserved: true,
        product: { select: { averageCost: true } },
        batch: { select: { expiryDate: true } },
      },
    });

    const horizon = new Date(Date.now() + 90 * 86_400_000);
    let units = new Prisma.Decimal(0);
    let reserved = new Prisma.Decimal(0);
    let value = new Prisma.Decimal(0);
    let expiring = 0;
    let outOfStock = 0;
    let negative = 0;
    const products = new Set<string>();

    for (const row of rows) {
      units = units.plus(row.onHand);
      reserved = reserved.plus(row.reserved);
      value = value.plus(row.onHand.times(row.product.averageCost));
      products.add(row.productId);
      if (row.onHand.lessThanOrEqualTo(0)) outOfStock += 1;
      if (row.onHand.lessThan(0)) negative += 1;
      if (row.batch && row.onHand.greaterThan(0) && row.batch.expiryDate <= horizon) expiring += 1;
    }

    return {
      positions: rows.length,
      products: products.size,
      units: units.toString(),
      reserved: reserved.toString(),
      value: value.toDecimalPlaces(2).toString(),
      expiringWithin90Days: expiring,
      outOfStock,
      negative,
    };
  }

  /**
   * The products whose branch-wide available total is at or below their reorder
   * level (§12).
   *
   * Totalled per product across every position the reader can see, because a
   * reorder level is set for a product and a pharmacy orders products, not
   * shelves.
   */
  async productsBelowReorder(
    user: AuthenticatedUser,
    options: { warehouseId?: string; branchId?: string } = {},
  ): Promise<string[]> {
    const totals = await this.prisma.inventoryBalance.groupBy({
      by: ['productId'],
      where: {
        ...(options.warehouseId ? { warehouseId: options.warehouseId } : {}),
        ...(options.branchId ? { branchId: options.branchId } : {}),
        ...(this.scope.isUnscoped(user) ? {} : { branchId: { in: user.branchIds } }),
      },
      _sum: { onHand: true, reserved: true },
    });
    if (!totals.length) return [];

    const products = await this.prisma.product.findMany({
      where: { id: { in: totals.map((t) => t.productId) } },
      select: { id: true, reorderLevel: true },
    });
    const levelById = new Map(products.map((p) => [p.id, p.reorderLevel]));

    return totals
      .filter((t) => {
        const level = levelById.get(t.productId);
        if (!level) return false;
        const available = (t._sum.onHand ?? new Prisma.Decimal(0)).minus(
          t._sum.reserved ?? new Prisma.Decimal(0),
        );
        return available.lessThanOrEqualTo(level);
      })
      .map((t) => t.productId);
  }

  /** Aggregate on-hand across batches for one product (the "do we have it" view). */
  async productStock(productId: string, user: AuthenticatedUser) {
    const balances = await this.prisma.inventoryBalance.findMany({
      where: {
        productId,
        ...(this.scope.isUnscoped(user) ? {} : { branchId: { in: user.branchIds } }),
      },
      include: {
        batch: { select: { batchNumber: true, expiryDate: true, status: true } },
        warehouse: { select: { id: true, name: true, branchId: true } },
      },
    });

    const totalOnHand = balances.reduce(
      (sum, b) => sum.plus(b.onHand),
      new Prisma.Decimal(0),
    );
    const totalReserved = balances.reduce(
      (sum, b) => sum.plus(b.reserved),
      new Prisma.Decimal(0),
    );

    return {
      productId,
      totalOnHand,
      totalReserved,
      totalAvailable: totalOnHand.minus(totalReserved),
      positions: balances,
    };
  }

  /**
   * Open stock reservations, so a held quantity has a name against it (§19).
   *
   * `available` sits below `onHand` for a reason, and until this existed the
   * only way to find out what the reason was, was to read the database. A
   * storekeeper looking at "40 on hand, 12 available" needs to see the baskets
   * and the pick wave holding the difference.
   */
  async reservations(
    user: AuthenticatedUser,
    query: {
      productId?: string;
      batchId?: string;
      warehouseId?: string;
      referenceType?: string;
      includeReleased?: boolean;
      onlyLapsed?: boolean;
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, query.pageSize ?? 50);
    if (query.warehouseId) await this.scope.assertWarehouse(user, query.warehouseId);

    // StockReservation carries no branch, so the reader's scope is applied
    // through the warehouses they can reach.
    let warehouseIds: string[] | undefined;
    if (!this.scope.isUnscoped(user)) {
      const warehouses = await this.prisma.warehouse.findMany({
        where: { branchId: { in: user.branchIds } },
        select: { id: true },
      });
      warehouseIds = warehouses.map((w) => w.id);
      if (!warehouseIds.length) return { data: [], total: 0, page, pageSize };
    }

    const where: Prisma.StockReservationWhereInput = {
      ...(warehouseIds ? { warehouseId: { in: warehouseIds } } : {}),
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.batchId ? { batchId: query.batchId } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.referenceType ? { referenceType: query.referenceType } : {}),
      ...(query.includeReleased ? {} : { releasedAt: null }),
      ...(query.onlyLapsed ? { expiresAt: { not: null, lt: new Date() } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.stockReservation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.stockReservation.count({ where }),
    ]);

    const [products, batches, warehouses, actors] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.productId))] } },
        select: { id: true, sku: true, genericName: true, strength: true },
      }),
      this.prisma.batch.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.batchId))] } },
        select: { id: true, batchNumber: true, expiryDate: true },
      }),
      this.prisma.warehouse.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.warehouseId))] } },
        select: { id: true, name: true },
      }),
      this.prisma.user.findMany({
        where: {
          id: { in: [...new Set(rows.map((r) => r.createdById).filter((v): v is string => !!v))] },
        },
        select: { id: true, fullName: true },
      }),
    ]);
    const productById = new Map(products.map((p) => [p.id, p]));
    const batchById = new Map(batches.map((b) => [b.id, b]));
    const warehouseById = new Map(warehouses.map((w) => [w.id, w]));
    const actorById = new Map(actors.map((a) => [a.id, a.fullName]));

    const now = Date.now();
    return {
      data: rows.map((row) => ({
        ...row,
        product: productById.get(row.productId) ?? null,
        batch: batchById.get(row.batchId) ?? null,
        warehouse: warehouseById.get(row.warehouseId) ?? null,
        createdBy: row.createdById ? (actorById.get(row.createdById) ?? null) : null,
        heldForMinutes: Math.round((now - row.createdAt.getTime()) / 60_000),
        lapsed: !!row.expiresAt && row.expiresAt.getTime() < now,
        referenceHref: this.referenceHref(row.referenceType, row.referenceId),
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Release one reservation by hand (§19).
   *
   * For the hold nothing will ever come back for: a till that crashed mid-sale,
   * a pick wave abandoned when the van left. The document is deliberately left
   * as it is — releasing the stock is not the same decision as cancelling the
   * order it was held for, and this is not entitled to make the second one.
   */
  async releaseReservation(id: string, reason: string, user: AuthenticatedUser) {
    if (!reason?.trim()) {
      throw new BadRequestException('Say why the reservation is being released by hand');
    }
    const reservation = await this.prisma.stockReservation.findUnique({ where: { id } });
    if (!reservation) throw new NotFoundException('Reservation not found');
    await this.scope.assertWarehouse(user, reservation.warehouseId);
    if (reservation.releasedAt) {
      throw new ConflictException(`Already released on ${reservation.releasedAt.toISOString()}`);
    }

    await this.prisma.$transaction(async (tx) =>
      this.ledgerService.releaseReservationRows(tx, [id]),
    );

    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id: reservation.warehouseId },
      select: { branchId: true },
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'inventory',
      action: 'RESERVATION_RELEASED',
      entityType: 'StockReservation',
      entityId: id,
      previousValue: {
        referenceType: reservation.referenceType,
        referenceId: reservation.referenceId,
        quantity: reservation.quantity.toString(),
      },
      newValue: { releasedAt: new Date() },
      reason: reason.trim(),
      branchId: warehouse?.branchId ?? null,
    });

    return {
      released: true,
      quantity: reservation.quantity.toString(),
      note:
        `The stock is available again. ${reservation.referenceType} was left as it is — ` +
        `releasing the hold is not the same as cancelling the document.`,
    };
  }

  /**
   * Positions that need a person to look at them (§19).
   *
   * Negative stock is arithmetically impossible and always means a posting went
   * in the wrong order or a count was applied twice. A position at zero that
   * still has something reserved against it is the same problem wearing a
   * different hat.
   */
  async anomalies(user: AuthenticatedUser, options: { warehouseId?: string } = {}) {
    if (options.warehouseId) await this.scope.assertWarehouse(user, options.warehouseId);
    const where: Prisma.InventoryBalanceWhereInput = {
      ...this.scope.branchFilter(user),
      ...(options.warehouseId ? { warehouseId: options.warehouseId } : {}),
    };

    const rows = await this.prisma.inventoryBalance.findMany({
      where,
      include: {
        product: { select: { id: true, sku: true, genericName: true, strength: true } },
        batch: { select: { id: true, batchNumber: true, expiryDate: true, status: true } },
        warehouse: { select: { id: true, name: true } },
      },
    });

    const recently = Date.now() - 30 * 86_400_000;
    const negative = rows.filter((r) => r.onHand.lessThan(0));
    const overReserved = rows.filter((r) => r.reserved.greaterThan(r.onHand));
    const heldAtZero = rows.filter(
      (r) =>
        r.onHand.equals(0) &&
        r.reserved.greaterThan(0) &&
        !!r.lastMovementAt &&
        r.lastMovementAt.getTime() > recently,
    );
    const expiredButHeld = rows.filter(
      (r) =>
        r.onHand.greaterThan(0) &&
        !!r.batch &&
        r.batch.expiryDate.getTime() < Date.now() &&
        r.batch.status !== BatchStatus.EXPIRED &&
        r.batch.status !== BatchStatus.DESTROYED,
    );

    const describe = (list: typeof rows) =>
      list.slice(0, 100).map((r) => ({
        balanceId: r.id,
        product: r.product,
        batch: r.batch,
        warehouse: r.warehouse,
        onHand: r.onHand.toString(),
        reserved: r.reserved.toString(),
        lastMovementAt: r.lastMovementAt,
      }));

    return {
      checked: rows.length,
      negative: {
        count: negative.length,
        rows: describe(negative),
        meaning: 'A movement was posted out of order, or a count was applied twice.',
      },
      overReserved: {
        count: overReserved.length,
        rows: describe(overReserved),
        meaning: 'More is reserved than is held; a release did not decrement the row it should have.',
      },
      heldAtZero: {
        count: heldAtZero.length,
        rows: describe(heldAtZero),
        meaning: 'Nothing on hand and something still reserved against it.',
      },
      expiredButAvailable: {
        count: expiredButHeld.length,
        rows: describe(expiredButHeld),
        meaning: 'Past its expiry date and not yet swept. Run the expiry sweep.',
      },
      note:
        'Each of these is a prompt to investigate, not a correction. Nothing here changes a ' +
        'balance — a stock figure is corrected by a count or an adjustment, and both of those ' +
        'are somebody’s decision.',
    };
  }

  /**
   * Stock ledger for a product/batch, newest first (§19).
   *
   * §4: the ledger used to take no user at all. Every movement in the
   * organisation — each branch, each unit cost — was readable by anyone holding
   * `inventory.ledger.READ`, which the branch roles do. It is filtered on the
   * reader's branches now, in the query, and asking for a branch outside them is
   * refused rather than quietly widened.
   */
  async ledger(
    user: AuthenticatedUser,
    query: {
      productId?: string;
      batchId?: string;
      warehouseId?: string;
      branchId?: string;
      type?: TransactionType;
      referenceType?: string;
      referenceId?: string;
      search?: string;
      from?: Date;
      to?: Date;
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(500, query.pageSize ?? 100);
    if (query.branchId) this.scope.assertBranch(user, query.branchId);
    if (query.warehouseId) await this.scope.assertWarehouse(user, query.warehouseId);

    const search = query.search?.trim();
    const where: Prisma.InventoryTransactionWhereInput = {
      ...this.scope.branchFilter(user),
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.batchId ? { batchId: query.batchId } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.referenceType ? { referenceType: query.referenceType } : {}),
      ...(query.referenceId ? { referenceId: query.referenceId } : {}),
      ...(search
        ? {
            OR: [
              { referenceNo: { contains: search, mode: 'insensitive' as const } },
              { product: { genericName: { contains: search, mode: 'insensitive' as const } } },
              { product: { sku: { contains: search, mode: 'insensitive' as const } } },
              { batch: { batchNumber: { contains: search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
      ...(query.from || query.to
        ? { occurredAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.inventoryTransaction.findMany({
        where,
        include: {
          product: { select: { id: true, sku: true, genericName: true, brandName: true, strength: true } },
          batch: { select: { id: true, batchNumber: true, expiryDate: true } },
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.inventoryTransaction.count({ where }),
    ]);

    // Who moved it. Resolved once rather than per row.
    const actorIds = [...new Set(rows.map((r) => r.performedById).filter((v): v is string => !!v))];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, fullName: true },
        })
      : [];
    const actorById = new Map(actors.map((a) => [a.id, a.fullName]));

    return {
      data: rows.map((row) => ({
        ...row,
        performedBy: row.performedById ? (actorById.get(row.performedById) ?? null) : null,
        /**
         * Where this movement came from, as something a screen can link to.
         *
         * The ledger already stores referenceType and referenceId; without the
         * route a reader who sees "SALE" has to go and find the sale by hand.
         */
        referenceHref: this.referenceHref(row.referenceType, row.referenceId),
      })),
      total,
      page,
      pageSize,
    };
  }

  /** Ledger reference → the screen that shows that document, or null. */
  private referenceHref(type: string | null, id: string | null): string | null {
    if (!type || !id) return null;
    const routes: Record<string, string> = {
      GOODS_RECEIPT: '/receiving',
      SALE: '/pos',
      DISPENSING: '/dispensing',
      DISPENSING_REVERSAL: '/dispensing',
      STOCK_ADJUSTMENT: '/adjustments',
      STOCK_COUNT: '/counts',
      TRANSFER: '/transfers',
      DAMAGE_REPORT: '/damage',
      DISPOSAL: '/disposal',
      RECALL: '/recalls',
      RETURN: '/returns',
    };
    const base = routes[type];
    return base ? `${base}?highlight=${id}` : null;
  }

  /**
   * The ledger for one batch at one warehouse, oldest first, with the running
   * balance after each movement (§19).
   *
   * The stored `balanceAfter` is the running balance for the product+batch
   * +warehouse the movement was posted against, so it is read rather than
   * recomputed — a recomputation that disagreed with the stored figure would be
   * hiding exactly the drift the integrity check exists to find.
   */
  async batchLedger(
    user: AuthenticatedUser,
    batchId: string,
    options: { warehouseId?: string; limit?: number } = {},
  ) {
    if (options.warehouseId) await this.scope.assertWarehouse(user, options.warehouseId);
    const rows = await this.prisma.inventoryTransaction.findMany({
      where: {
        batchId,
        ...this.scope.branchFilter(user),
        ...(options.warehouseId ? { warehouseId: options.warehouseId } : {}),
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      take: Math.min(1000, options.limit ?? 500),
    });

    return rows.map((row) => ({
      id: row.id,
      occurredAt: row.occurredAt,
      type: row.type,
      quantityIn: row.quantityIn,
      quantityOut: row.quantityOut,
      balanceAfter: row.balanceAfter,
      unitCost: row.unitCost,
      referenceType: row.referenceType,
      referenceNo: row.referenceNo,
      referenceHref: this.referenceHref(row.referenceType, row.referenceId),
      reason: row.reason,
      warehouseId: row.warehouseId,
      locationId: row.locationId,
    }));
  }

  /**
   * Expiry dashboard (§9): every batch position bucketed by remaining shelf
   * life, with the value that would be lost if it is not moved.
   */
  async expiryReport(
    user: AuthenticatedUser,
    options: { warehouseId?: string; maxDays?: number } = {},
  ) {
    const balances = await this.prisma.inventoryBalance.findMany({
      where: {
        onHand: { gt: 0 },
        batchId: { not: null },
        ...(options.warehouseId ? { warehouseId: options.warehouseId } : {}),
        ...(this.scope.isUnscoped(user) ? {} : { branchId: { in: user.branchIds } }),
      },
      include: {
        batch: true,
        product: {
          select: {
            id: true,
            sku: true,
            genericName: true,
            brandName: true,
            strength: true,
            averageCost: true,
            baseUnit: true,
          },
        },
        warehouse: { select: { id: true, name: true, branchId: true } },
      },
    });

    const now = new Date();
    // §65: the horizons are administrator-configured, so the ladder is built
    // from the setting rather than from constants in this file. Before this,
    // expiry.alertBuckets could be changed and nothing happened.
    const ladder = expiryBuckets(await this.config.getNumberArray('expiry.alertBuckets'));

    const rows = balances
      .filter((b) => b.batch)
      .map((b) => {
        const days = daysUntil(b.batch!.expiryDate, now);
        const available = b.onHand.minus(b.reserved);
        return {
          productId: b.product.id,
          sku: b.product.sku,
          productName: `${b.product.genericName}${b.product.brandName ? ` (${b.product.brandName})` : ''}`,
          strength: b.product.strength,
          batchId: b.batch!.id,
          batchNumber: b.batch!.batchNumber,
          batchStatus: b.batch!.status,
          expiryDate: b.batch!.expiryDate,
          daysRemaining: days,
          bucket: bucketFor(b.batch!.expiryDate, ladder, now).key,
          quantity: available,
          unit: b.product.baseUnit,
          warehouseId: b.warehouseId,
          warehouseName: b.warehouse.name,
          // A batch can sit in several bins in one warehouse, so product +
          // batch + warehouse does not identify a row.
          locationId: b.locationId,
          branchId: b.branchId,
          // §9: Potential Expiry Loss = remaining quantity x inventory cost
          potentialLoss: available.times(b.product.averageCost),
        };
      })
      .filter((r) => options.maxDays === undefined || r.daysRemaining <= options.maxDays)
      .sort((a, b) => a.daysRemaining - b.daysRemaining);

    const summary = rows.reduce<Record<string, { count: number; quantity: number; value: number }>>(
      (acc, row) => {
        const key = row.bucket;
        acc[key] ??= { count: 0, quantity: 0, value: 0 };
        acc[key].count += 1;
        acc[key].quantity += Number(row.quantity);
        acc[key].value += Number(row.potentialLoss);
        return acc;
      },
      {},
    );

    return {
      rows,
      // The ladder travels with the data so a screen renders the configured
      // labels instead of keeping its own copy, which is exactly how the two
      // drift apart when an administrator changes the horizons.
      buckets: ladder,
      summary,
      totalValueAtRisk: rows.reduce((sum, r) => sum + Number(r.potentialLoss), 0),
    };
  }

  /**
   * Month-by-month expiry calendar (§9: feature 108).
   *
   * The bucket ladder answers "how urgent"; the calendar answers "when", which
   * is the question a purchasing plan is built from. Value at risk is the
   * quantity that is actually available - stock already reserved against an
   * order is not going to sit on the shelf and expire.
   */
  async expiryCalendar(
    user: AuthenticatedUser,
    options: { warehouseId?: string; months?: number } = {},
  ) {
    const months = Math.min(36, Math.max(1, options.months ?? 12));
    const now = new Date();
    const horizon = new Date(now.getFullYear(), now.getMonth() + months, 1);

    const balances = await this.prisma.inventoryBalance.findMany({
      where: {
        onHand: { gt: 0 },
        batchId: { not: null },
        ...(options.warehouseId ? { warehouseId: options.warehouseId } : {}),
        ...(this.scope.isUnscoped(user) ? {} : { branchId: { in: user.branchIds } }),
        batch: { expiryDate: { lt: horizon } },
      },
      include: {
        batch: { select: { id: true, batchNumber: true, expiryDate: true } },
        product: { select: { id: true, sku: true, genericName: true, averageCost: true } },
      },
    });

    const cells = new Map<
      string,
      {
        month: string;
        batches: number;
        quantity: Prisma.Decimal;
        value: Prisma.Decimal;
        expiredQuantity: Prisma.Decimal;
        expiredValue: Prisma.Decimal;
      }
    >();

    for (const b of balances) {
      if (!b.batch) continue;
      const expiry = b.batch.expiryDate;
      const month = `${expiry.getFullYear()}-${String(expiry.getMonth() + 1).padStart(2, '0')}`;
      const available = b.onHand.minus(b.reserved);
      if (available.lessThanOrEqualTo(0)) continue;

      const cell = cells.get(month) ?? {
        month,
        batches: 0,
        quantity: new Prisma.Decimal(0),
        value: new Prisma.Decimal(0),
        expiredQuantity: new Prisma.Decimal(0),
        expiredValue: new Prisma.Decimal(0),
      };
      const value = available.times(b.product.averageCost);
      // The current month holds both stock that has already expired and stock
      // that has not. A single flag on the cell described whichever row was
      // read first, so the same data labelled the month differently between
      // runs; the expired portion is measured instead.
      const isExpired = expiry.getTime() < now.getTime();
      cells.set(month, {
        ...cell,
        batches: cell.batches + 1,
        quantity: cell.quantity.plus(available),
        value: cell.value.plus(value),
        expiredQuantity: isExpired ? cell.expiredQuantity.plus(available) : cell.expiredQuantity,
        expiredValue: isExpired ? cell.expiredValue.plus(value) : cell.expiredValue,
      });
    }

    const rows = [...cells.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((c) => ({
        month: c.month,
        batches: c.batches,
        quantity: c.quantity.toFixed(2),
        value: c.value.toFixed(2),
        expiredQuantity: c.expiredQuantity.toFixed(2),
        expiredValue: c.expiredValue.toFixed(2),
        // True only when the whole month is already past — a disposal backlog
        // rather than a risk. A month that is part expired reports both figures.
        alreadyExpired: c.expiredQuantity.equals(c.quantity) && !c.quantity.isZero(),
        partlyExpired: !c.expiredQuantity.isZero() && !c.expiredQuantity.equals(c.quantity),
      }));

    return {
      months,
      generatedAt: now,
      rows,
      peakMonth: rows.reduce<null | (typeof rows)[number]>(
        (peak, r) => (!peak || Number(r.value) > Number(peak.value) ? r : peak),
        null,
      ),
      totalValue: rows.reduce((sum, r) => sum + Number(r.value), 0).toFixed(2),
    };
  }

  /**
   * How much stock we actually lost to expiry, month by month (§9: feature 109).
   *
   * This is history, not projection: it reads the EXPIRY_WRITE_OFF and DISPOSAL
   * movements the ledger already holds. Trending what was projected would only
   * measure how the projection changed.
   */
  async expiryTrend(user: AuthenticatedUser, options: { months?: number; warehouseId?: string } = {}) {
    const months = Math.min(36, Math.max(1, options.months ?? 12));
    // Normalise to the first of the month BEFORE stepping back, and step back
    // months-1. Stepping back first can overflow a short month (31 March minus
    // one month is 3 March, not 28 February), which dropped the very month the
    // caller asked for; and stepping back the full count returned months+1
    // buckets under a heading that promised months.
    const since = new Date();
    since.setDate(1);
    since.setHours(0, 0, 0, 0);
    since.setMonth(since.getMonth() - (months - 1));

    const movements = await this.prisma.inventoryTransaction.findMany({
      where: {
        type: { in: [TransactionType.EXPIRY, TransactionType.DISPOSAL] },
        occurredAt: { gte: since },
        ...(options.warehouseId ? { warehouseId: options.warehouseId } : {}),
        ...(this.scope.isUnscoped(user) ? {} : { branchId: { in: user.branchIds } }),
      },
      select: {
        type: true,
        occurredAt: true,
        quantityOut: true,
        unitCost: true,
        productId: true,
      },
    });

    const byMonth = new Map<string, { quantity: Prisma.Decimal; value: Prisma.Decimal; lines: number }>();
    const byProduct = new Map<string, { quantity: Prisma.Decimal; value: Prisma.Decimal }>();

    for (const m of movements) {
      const key = `${m.occurredAt.getFullYear()}-${String(m.occurredAt.getMonth() + 1).padStart(2, '0')}`;
      const cell = byMonth.get(key) ?? {
        quantity: new Prisma.Decimal(0),
        value: new Prisma.Decimal(0),
        lines: 0,
      };
      // Value is quantity x the cost the movement was actually posted at, not
      // today's average cost: writing off last year's stock at this year's
      // price would restate history every time a price moved.
      const quantity = m.quantityOut;
      const cost = quantity.times(m.unitCost);
      byMonth.set(key, {
        quantity: cell.quantity.plus(quantity),
        value: cell.value.plus(cost),
        lines: cell.lines + 1,
      });

      const p = byProduct.get(m.productId) ?? {
        quantity: new Prisma.Decimal(0),
        value: new Prisma.Decimal(0),
      };
      byProduct.set(m.productId, {
        quantity: p.quantity.plus(quantity),
        value: p.value.plus(cost),
      });
    }

    const productIds = [...byProduct.keys()];
    const products = productIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, sku: true, genericName: true, strength: true },
        })
      : [];
    const productById = new Map(products.map((p) => [p.id, p]));

    const series = [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, v]) => ({
        month,
        lines: v.lines,
        quantity: v.quantity.toFixed(2),
        value: v.value.toFixed(2),
      }));

    return {
      months,
      series,
      totalValue: series.reduce((sum, s) => sum + Number(s.value), 0).toFixed(2),
      worstProducts: [...byProduct.entries()]
        .map(([productId, v]) => ({
          productId,
          sku: productById.get(productId)?.sku ?? productId,
          product: productById.get(productId)
            ? `${productById.get(productId)!.genericName} ${productById.get(productId)!.strength}`.trim()
            : productId,
          quantity: v.quantity.toFixed(2),
          value: v.value.toFixed(2),
        }))
        .sort((a, b) => Number(b.value) - Number(a.value))
        .slice(0, 20),
    };
  }

  /**
   * Expiry exposure compared across branches, categories or suppliers
   * (§9: features 110-112).
   *
   * One dimension per call, because a table that crosses all three at once is
   * unreadable and nobody acts on it. Value at risk is what is compared -
   * counting batches would rank a branch holding cheap sachets above one
   * holding insulin.
   */
  async expiryComparison(
    user: AuthenticatedUser,
    dimension: 'branch' | 'category' | 'supplier',
    options: { withinDays?: number } = {},
  ) {
    const withinDays = Math.min(730, Math.max(1, options.withinDays ?? 180));
    const horizon = new Date(Date.now() + withinDays * 86_400_000);

    const balances = await this.prisma.inventoryBalance.findMany({
      where: {
        onHand: { gt: 0 },
        batchId: { not: null },
        batch: { expiryDate: { lt: horizon } },
        ...(this.scope.isUnscoped(user) ? {} : { branchId: { in: user.branchIds } }),
      },
      include: {
        batch: { select: { expiryDate: true, supplierId: true } },
        product: { select: { id: true, categoryId: true, averageCost: true } },
      },
    });

    const groups = new Map<
      string,
      { key: string; batches: number; quantity: Prisma.Decimal; value: Prisma.Decimal }
    >();

    for (const b of balances) {
      if (!b.batch) continue;
      const available = b.onHand.minus(b.reserved);
      if (available.lessThanOrEqualTo(0)) continue;

      const key =
        dimension === 'branch'
          ? b.branchId
          : dimension === 'category'
            ? b.product.categoryId ?? 'UNCATEGORISED'
            : b.batch.supplierId ?? 'UNKNOWN_SUPPLIER';

      const cell = groups.get(key) ?? {
        key,
        batches: 0,
        quantity: new Prisma.Decimal(0),
        value: new Prisma.Decimal(0),
      };
      groups.set(key, {
        key,
        batches: cell.batches + 1,
        quantity: cell.quantity.plus(available),
        value: cell.value.plus(available.times(b.product.averageCost)),
      });
    }

    const keys = [...groups.keys()].filter((k) => !['UNCATEGORISED', 'UNKNOWN_SUPPLIER'].includes(k));
    const labels = new Map<string, string>();
    if (dimension === 'branch' && keys.length) {
      const branches = await this.prisma.branch.findMany({
        where: { id: { in: keys } },
        select: { id: true, name: true },
      });
      branches.forEach((b) => labels.set(b.id, b.name));
    } else if (dimension === 'category' && keys.length) {
      const categories = await this.prisma.productCategory.findMany({
        where: { id: { in: keys } },
        select: { id: true, name: true },
      });
      categories.forEach((c) => labels.set(c.id, c.name));
    } else if (dimension === 'supplier' && keys.length) {
      const suppliers = await this.prisma.supplier.findMany({
        where: { id: { in: keys } },
        select: { id: true, companyName: true },
      });
      suppliers.forEach((s) => labels.set(s.id, s.companyName));
    }

    const rows = [...groups.values()]
      .map((g) => ({
        id: g.key,
        // An unlabelled group is named for what it is rather than dropped: a
        // large pile of uncategorised expiry is itself a finding.
        label:
          labels.get(g.key) ??
          (g.key === 'UNCATEGORISED'
            ? 'Uncategorised'
            : g.key === 'UNKNOWN_SUPPLIER'
              ? 'No supplier recorded'
              : g.key),
        batches: g.batches,
        quantity: g.quantity.toFixed(2),
        value: g.value.toFixed(2),
      }))
      .sort((a, b) => Number(b.value) - Number(a.value));

    const total = rows.reduce((sum, r) => sum + Number(r.value), 0);
    return {
      dimension,
      withinDays,
      totalValue: total.toFixed(2),
      rows: rows.map((r) => ({
        ...r,
        sharePercent: total ? ((Number(r.value) / total) * 100).toFixed(1) : '0.0',
      })),
    };
  }

  /**
   * Smart expiry redistribution (§10). For each at-risk batch position, find
   * branches that consume fast enough to actually use the stock before it
   * expires, and rank the resulting transfer suggestions.
   */
  async redistributionSuggestions(
    user: AuthenticatedUser,
    options: { withinDays?: number; transferLeadTimeDays?: number } = {},
  ) {
    const withinDays = options.withinDays ?? 120;
    const leadTime = options.transferLeadTimeDays ?? 3;
    const expiry = await this.expiryReport(user, { maxDays: withinDays });

    // Average monthly consumption per product per branch over the last 180 days.
    const since = new Date(Date.now() - 180 * 86_400_000);
    const consumption = await this.prisma.inventoryTransaction.groupBy({
      by: ['productId', 'branchId'],
      where: {
        occurredAt: { gte: since },
        type: { in: ['SALE', 'DISPENSING'] },
      },
      _sum: { quantityOut: true },
    });

    const monthlyRate = new Map<string, number>();
    for (const row of consumption) {
      const perMonth = Number(row._sum.quantityOut ?? 0) / 6; // 180 days ~ 6 months
      monthlyRate.set(`${row.productId}:${row.branchId}`, perMonth);
    }

    const branches = await this.prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true },
    });

    const suggestions: any[] = [];
    for (const row of expiry.rows) {
      if (row.batchStatus !== 'AVAILABLE' && row.batchStatus !== 'RELEASED') continue;

      const sourceRate = monthlyRate.get(`${row.productId}:${row.branchId}`) ?? 0;
      const risk = expiryRiskScore({
        quantityOnHand: Number(row.quantity),
        daysToExpiry: row.daysRemaining,
        avgMonthlyConsumption: sourceRate,
        transferLeadTimeDays: leadTime,
      });
      if (risk.riskLevel === 'NONE' || risk.surplusQuantity < 1) continue;

      // Rank candidate destinations by how much of the surplus they can absorb.
      const destinations = branches
        .filter((b) => b.id !== row.branchId)
        .map((b) => {
          const rate = monthlyRate.get(`${row.productId}:${b.id}`) ?? 0;
          const usableDays = Math.max(0, row.daysRemaining - leadTime);
          const canConsume = (rate / 30) * usableDays;
          return {
            branchId: b.id,
            branchName: b.name,
            avgMonthlyConsumption: Math.round(rate),
            canConsumeBeforeExpiry: Math.floor(canConsume),
            suggestedTransferQty: Math.floor(Math.min(canConsume, risk.surplusQuantity)),
          };
        })
        .filter((d) => d.suggestedTransferQty >= 1)
        .sort((a, b) => b.suggestedTransferQty - a.suggestedTransferQty);

      if (!destinations.length) continue;

      suggestions.push({
        productId: row.productId,
        productName: row.productName,
        batchId: row.batchId,
        batchNumber: row.batchNumber,
        expiryDate: row.expiryDate,
        daysRemaining: row.daysRemaining,
        sourceBranchId: row.branchId,
        sourceWarehouseId: row.warehouseId,
        quantityOnHand: Number(row.quantity),
        sourceMonthlyConsumption: Math.round(sourceRate),
        riskScore: risk.score,
        riskLevel: risk.riskLevel,
        surplusQuantity: Math.floor(risk.surplusQuantity),
        valueAtRisk: Number(row.potentialLoss),
        destinations: destinations.slice(0, 3),
      });
    }

    return suggestions.sort((a, b) => b.riskScore - a.riskScore);
  }
}
