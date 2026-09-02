import { Injectable, Logger } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConfigService } from '../../common/config/config.service';
import { JournalService } from './journal.service';
import { ValuationService } from './valuation.service';

/**
 * The boundary between inventory and accounting (§32).
 *
 * Inventory services post stock movements and know nothing about accounts.
 * This service reads those movements and translates them into journals. That
 * separation is the point: changing a posting rule must never risk changing
 * what the stock ledger says, and the ledger is the record of fact either way.
 *
 * Posting is idempotent — journal entries are unique on (sourceType, sourceId),
 * so a re-run picks up only what has not been posted.
 */
@Injectable()
export class PostingService {
  private readonly logger = new Logger(PostingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: JournalService,
    private readonly valuation: ValuationService,
    private readonly config: ConfigService,
  ) {}

  /**
   * How each movement type is treated.
   *
   * `null` means the movement has no accounting effect on its own: a transfer
   * between two of the company's own warehouses moves an asset from one place
   * to another without changing its value, and a reservation moves nothing.
   */
  private static readonly RULES: Record<
    string,
    { debit: string; credit: string; label: string } | null
  > = {
    PURCHASE_RECEIPT: {
      debit: 'INVENTORY_ASSET',
      credit: 'GOODS_RECEIVED_NOT_INVOICED',
      label: 'Goods received',
    },
    SALE: { debit: 'COGS', credit: 'INVENTORY_ASSET', label: 'Cost of goods sold' },
    DISPENSING: { debit: 'COGS', credit: 'INVENTORY_ASSET', label: 'Cost of medicines dispensed' },
    RETURN_IN: { debit: 'INVENTORY_ASSET', credit: 'COGS', label: 'Customer return to stock' },
    RETURN_OUT: {
      debit: 'ACCOUNTS_PAYABLE',
      credit: 'INVENTORY_ASSET',
      label: 'Return to supplier',
    },
    ADJUSTMENT_IN: {
      debit: 'INVENTORY_ASSET',
      credit: 'INVENTORY_ADJUSTMENT',
      label: 'Stock adjustment (gain)',
    },
    ADJUSTMENT_OUT: {
      debit: 'INVENTORY_ADJUSTMENT',
      credit: 'INVENTORY_ASSET',
      label: 'Stock adjustment (loss)',
    },
    DAMAGE: { debit: 'INVENTORY_WRITE_OFF', credit: 'INVENTORY_ASSET', label: 'Damaged stock' },
    EXPIRY: { debit: 'INVENTORY_WRITE_OFF', credit: 'INVENTORY_ASSET', label: 'Expired stock' },
    DISPOSAL: { debit: 'INVENTORY_WRITE_OFF', credit: 'INVENTORY_ASSET', label: 'Stock disposal' },
    RECALL: null,
    TRANSFER_OUT: null,
    TRANSFER_IN: null,
    // A reservation moves nothing; it only marks stock as spoken for.
    RESERVATION: null,
    RESERVATION_RELEASE: null,
    STOCK_COUNT_IN: {
      debit: 'INVENTORY_ASSET',
      credit: 'INVENTORY_ADJUSTMENT',
      label: 'Stock count variance (gain)',
    },
    STOCK_COUNT_OUT: {
      debit: 'INVENTORY_ADJUSTMENT',
      credit: 'INVENTORY_ASSET',
      label: 'Stock count variance (loss)',
    },
    OPENING_BALANCE: {
      debit: 'INVENTORY_ASSET',
      credit: 'OPENING_BALANCE_EQUITY',
      label: 'Opening stock',
    },
  };

  /**
   * Post the accounting effect of one stock movement.
   *
   * Returns null when the movement has no accounting effect, or when it has
   * already been posted.
   */
  async postMovement(transactionId: string, actor?: { id: string }) {
    const movement = await this.prisma.inventoryTransaction.findUnique({
      where: { id: transactionId },
      include: {
        product: { select: { genericName: true, strength: true, averageCost: true } },
      },
    });
    if (!movement) return null;

    const rule = this.ruleFor(movement.type, movement.quantityIn.greaterThan(0));
    if (!rule) return null;

    const existing = await this.prisma.journalEntry.findFirst({
      where: { sourceType: 'INVENTORY_MOVEMENT', sourceId: transactionId },
      select: { id: true, entryNo: true },
    });
    if (existing) return existing;

    const quantity = movement.quantityIn.greaterThan(0)
      ? movement.quantityIn
      : movement.quantityOut;

    // Prefer the cost the movement was actually recorded at; fall back to the
    // running average only when the movement carries none.
    const unitCost = movement.unitCost.greaterThan(0)
      ? movement.unitCost
      : movement.product.averageCost;
    const amount = quantity.times(unitCost).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);

    if (amount.isZero()) {
      this.logger.debug(`Movement ${transactionId} values at zero; no journal posted`);
      return null;
    }

    return this.prisma.$transaction((tx) =>
      this.journal.post(
        tx,
        {
          entryDate: movement.occurredAt,
          description: `${rule.label}: ${movement.product.genericName} ${movement.product.strength}`,
          sourceType: 'INVENTORY_MOVEMENT',
          sourceId: transactionId,
          branchId: movement.branchId,
          lines: [
            {
              systemKey: rule.debit,
              debit: amount,
              description: movement.referenceNo ?? undefined,
              productId: movement.productId,
              batchId: movement.batchId,
            },
            {
              systemKey: rule.credit,
              credit: amount,
              description: movement.referenceNo ?? undefined,
              productId: movement.productId,
              batchId: movement.batchId,
            },
          ],
        },
        actor,
      ),
    );
  }

  private ruleFor(type: TransactionType, isInbound: boolean) {
    // ADJUSTMENT and COUNT_ADJUSTMENT go either way depending on direction.
    if (type === TransactionType.ADJUSTMENT) {
      return PostingService.RULES[isInbound ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT'];
    }
    if (type === TransactionType.STOCK_COUNT) {
      return PostingService.RULES[isInbound ? 'STOCK_COUNT_IN' : 'STOCK_COUNT_OUT'];
    }
    return PostingService.RULES[type] ?? null;
  }

  /**
   * Post the revenue side of a completed sale.
   *
   * Separate from the cost side, which comes through the stock movement: a sale
   * is two facts — revenue earned and inventory relieved — and conflating them
   * would make either impossible to correct on its own.
   */
  async postSale(saleId: string, actor?: { id: string }) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: true, payments: true },
    });
    if (!sale || sale.status !== 'COMPLETED') return null;

    const existing = await this.prisma.journalEntry.findFirst({
      where: { sourceType: 'SALE_REVENUE', sourceId: saleId },
      select: { id: true, entryNo: true },
    });
    if (existing) return existing;

    const net = sale.subtotal.minus(sale.discountTotal);
    const tax = sale.taxTotal;
    const gross = sale.grandTotal;
    if (gross.isZero()) return null;

    // Cash and credit are different assets: a sale on account is a receivable,
    // not money in the drawer.
    //
    // The till records what the customer handed over, not what the sale was
    // worth — 1000 birr tendered against a 2.07 sale is a normal cash
    // transaction, and the 997.93 difference goes back across the counter as
    // change. Only what the drawer keeps is an asset, so the tender is capped
    // at the sale total. Posting the tender itself would put money into the
    // accounts that the pharmacy never had, and the entry would not balance.
    const tendered = sale.payments
      .filter((p) => p.method !== 'CREDIT')
      .reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
    const cashPaid = Prisma.Decimal.min(tendered, gross);
    const changeGiven = tendered.minus(cashPaid);
    const onAccount = gross.minus(cashPaid);

    const lines = [
      ...(cashPaid.greaterThan(0)
        ? [
            {
              systemKey: 'CASH',
              debit: cashPaid,
              description: changeGiven.greaterThan(0)
                ? `Cash and card takings (${tendered.toFixed(2)} tendered, ${changeGiven.toFixed(2)} change given)`
                : 'Cash and card takings',
            },
          ]
        : []),
      ...(onAccount.greaterThan(0)
        ? [
            {
              systemKey: 'ACCOUNTS_RECEIVABLE',
              debit: onAccount,
              description: 'Sold on account',
            },
          ]
        : []),
      { systemKey: 'SALES_REVENUE', credit: net, description: 'Net of discount' },
      ...(tax.greaterThan(0)
        ? [{ systemKey: 'VAT_OUTPUT', credit: tax, description: 'Output VAT' }]
        : []),
    ];

    return this.prisma.$transaction((tx) =>
      this.journal.post(
        tx,
        {
          entryDate: sale.soldAt ?? sale.createdAt,
          description: `Sale ${sale.saleNo}`,
          sourceType: 'SALE_REVENUE',
          sourceId: saleId,
          branchId: sale.branchId,
          lines,
        },
        actor,
      ),
    );
  }

  /** Post a supplier invoice: clear the GRNI accrual and raise the payable. */
  async postSupplierInvoice(invoiceId: string, actor?: { id: string }) {
    const invoice = await this.prisma.supplierInvoice.findUnique({
      where: { id: invoiceId },
      include: { supplier: { select: { companyName: true } } },
    });
    if (!invoice) return null;
    if (!['APPROVED', 'PAID', 'PARTIALLY_PAID'].includes(invoice.status)) return null;

    const existing = await this.prisma.journalEntry.findFirst({
      where: { sourceType: 'SUPPLIER_INVOICE', sourceId: invoiceId },
      select: { id: true, entryNo: true },
    });
    if (existing) return existing;

    const withholdingRate = new Prisma.Decimal(
      await this.config.getNumber('finance.withholdingRate'),
    );
    const threshold = new Prisma.Decimal(
      await this.config.getNumber('finance.withholdingThreshold'),
    );
    const withholding = invoice.subtotal.greaterThanOrEqualTo(threshold)
      ? invoice.subtotal.times(withholdingRate).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP)
      : new Prisma.Decimal(0);

    const payable = invoice.grandTotal.minus(withholding);

    const lines = [
      {
        systemKey: 'GOODS_RECEIVED_NOT_INVOICED',
        debit: invoice.subtotal,
        description: 'Clear the goods-received accrual',
      },
      ...(invoice.taxTotal.greaterThan(0)
        ? [{ systemKey: 'VAT_INPUT', debit: invoice.taxTotal, description: 'Recoverable input VAT' }]
        : []),
      ...(invoice.freightCost.greaterThan(0)
        ? [{ systemKey: 'FREIGHT', debit: invoice.freightCost, description: 'Freight' }]
        : []),
      ...(withholding.greaterThan(0)
        ? [
            {
              systemKey: 'WITHHOLDING_TAX',
              credit: withholding,
              description: `Withholding at ${withholdingRate.times(100).toString()}%`,
            },
          ]
        : []),
      {
        systemKey: 'ACCOUNTS_PAYABLE',
        credit: payable,
        description: `${invoice.supplier.companyName} invoice ${invoice.supplierInvoiceNo}`,
      },
    ];

    return this.prisma.$transaction((tx) =>
      this.journal.post(
        tx,
        {
          entryDate: invoice.invoiceDate,
          description: `Supplier invoice ${invoice.internalNo}`,
          sourceType: 'SUPPLIER_INVOICE',
          sourceId: invoiceId,
          branchId: invoice.branchId,
          currency: invoice.currency,
          lines,
        },
        actor,
      ),
    );
  }

  /** Post a supplier payment: settle the payable. */
  async postSupplierPayment(paymentId: string, actor?: { id: string }) {
    const payment = await this.prisma.supplierPayment.findUnique({
      where: { id: paymentId },
      include: { invoice: { select: { branchId: true, internalNo: true, currency: true } } },
    });
    if (!payment) return null;

    const existing = await this.prisma.journalEntry.findFirst({
      where: { sourceType: 'SUPPLIER_PAYMENT', sourceId: paymentId },
      select: { id: true, entryNo: true },
    });
    if (existing) return existing;

    return this.prisma.$transaction((tx) =>
      this.journal.post(
        tx,
        {
          entryDate: payment.paidAt,
          description: `Payment ${payment.paymentNo} against ${payment.invoice.internalNo}`,
          sourceType: 'SUPPLIER_PAYMENT',
          sourceId: paymentId,
          branchId: payment.invoice.branchId,
          currency: payment.invoice.currency,
          lines: [
            { systemKey: 'ACCOUNTS_PAYABLE', debit: payment.amount },
            { systemKey: 'CASH', credit: payment.amount },
          ],
        },
        actor,
      ),
    );
  }

  /**
   * Post everything not yet posted.
   *
   * Run as a background job so accounting never sits on the critical path of a
   * dispensing or a sale — a ledger problem must not stop a pharmacist working.
   */
  async postPending(limit = 500, actor?: { id: string }) {
    const posted = { movements: 0, sales: 0, invoices: 0, payments: 0, skipped: 0, failed: 0 };
    const errors: { type: string; id: string; error: string }[] = [];

    // Only what is actually outstanding is fetched.
    //
    // Selecting the oldest `limit` documents and filtering the posted ones out
    // in memory looks equivalent and is not: once more than `limit` documents
    // exist, the window sits entirely on already-posted history and a movement
    // recorded today is never reached, however often the job runs. The join
    // below is the same one `unpostedDocuments` reports from, so the queue the
    // administration screen shows is the queue this drains.
    const { movements, sales } = await this.unpostedDocuments(limit);

    for (const movement of movements) {
      try {
        const entry = await this.postMovement(movement.id, actor);
        if (entry) posted.movements += 1;
        // A movement with no accounting effect (a zero-value adjustment, say)
        // is not a failure; it is simply nothing to post.
        else posted.skipped += 1;
      } catch (error) {
        posted.failed += 1;
        errors.push({ type: 'MOVEMENT', id: movement.id, error: (error as Error).message });
      }
    }

    for (const sale of sales) {
      try {
        const entry = await this.postSale(sale.id, actor);
        if (entry) posted.sales += 1;
        else posted.skipped += 1;
      } catch (error) {
        posted.failed += 1;
        errors.push({ type: 'SALE', id: sale.id, error: (error as Error).message });
      }
    }

    // Same reasoning as above: select what is missing from the ledger, not the
    // first `limit` rows of the table.
    const invoices = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT i.id
      FROM supplier_invoices i
      LEFT JOIN journal_entries j
        ON j."sourceType" = 'SUPPLIER_INVOICE' AND j."sourceId" = i.id
      WHERE j.id IS NULL
        AND i.status IN ('APPROVED', 'PAID', 'PARTIALLY_PAID')
      ORDER BY i."createdAt" ASC
      LIMIT ${limit}`;
    for (const invoice of invoices) {
      try {
        const entry = await this.postSupplierInvoice(invoice.id, actor);
        if (entry) posted.invoices += 1;
        else posted.skipped += 1;
      } catch (error) {
        posted.failed += 1;
        errors.push({ type: 'SUPPLIER_INVOICE', id: invoice.id, error: (error as Error).message });
      }
    }

    const payments = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT p.id
      FROM supplier_payments p
      LEFT JOIN journal_entries j
        ON j."sourceType" = 'SUPPLIER_PAYMENT' AND j."sourceId" = p.id
      WHERE j.id IS NULL
      ORDER BY p."paidAt" ASC
      LIMIT ${limit}`;
    for (const payment of payments) {
      try {
        const entry = await this.postSupplierPayment(payment.id, actor);
        if (entry) posted.payments += 1;
        else posted.skipped += 1;
      } catch (error) {
        posted.failed += 1;
        errors.push({ type: 'SUPPLIER_PAYMENT', id: payment.id, error: (error as Error).message });
      }
    }

    if (errors.length) {
      this.logger.warn(`${errors.length} document(s) could not be posted`);
    }

    // Errors are returned, not swallowed: an unposted document is a real gap in
    // the accounts and somebody has to see it.
    return { ...posted, errors: errors.slice(0, 50) };
  }

  /** Documents that should have been posted but were not, and why. */
  async unpostedDocuments(limit = 100) {
    const [movements, sales] = await Promise.all([
      this.prisma.$queryRaw<{ id: string; type: string; occurredAt: Date }[]>`
        SELECT t.id, t.type::text, t."occurredAt"
        FROM inventory_transactions t
        LEFT JOIN journal_entries j
          ON j."sourceType" = 'INVENTORY_MOVEMENT' AND j."sourceId" = t.id
        WHERE j.id IS NULL
          AND t.type NOT IN ('TRANSFER_IN', 'TRANSFER_OUT', 'RECALL',
                             'RESERVATION', 'RESERVATION_RELEASE')
        ORDER BY t."occurredAt" DESC
        LIMIT ${limit}`,
      this.prisma.$queryRaw<{ id: string; saleNo: string; soldAt: Date }[]>`
        SELECT s.id, s."saleNo", s."soldAt"
        FROM sales s
        LEFT JOIN journal_entries j
          ON j."sourceType" = 'SALE_REVENUE' AND j."sourceId" = s.id
        WHERE j.id IS NULL AND s.status = 'COMPLETED'
        ORDER BY s."soldAt" DESC
        LIMIT ${limit}`,
    ]);

    return { movements, sales, total: movements.length + sales.length };
  }
}
