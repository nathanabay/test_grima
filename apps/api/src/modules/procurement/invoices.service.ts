import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  InvoiceMatchStatus,
  PaymentMethod,
  Prisma,
  SupplierInvoiceStatus,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';
import { DocumentNumberService } from '../common-services/document-number.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SeparationOfDutiesService } from '../../common/approval/separation.service';

export interface CreateInvoiceInput {
  supplierInvoiceNo: string;
  supplierId: string;
  branchId: string;
  purchaseOrderId?: string;
  goodsReceiptId?: string;
  invoiceDate: string | Date;
  dueDate?: string | Date;
  currency?: string;
  freightCost?: number;
  items: Array<{
    productId: string;
    quantity: number;
    unitPrice: number;
    taxRate?: number;
  }>;
}

/** Tolerances before a line is treated as a genuine variance rather than rounding. */
const PRICE_TOLERANCE = 0.01; // 1%
const QUANTITY_TOLERANCE = 0; // pharmaceutical quantities must match exactly

/**
 * Accounts payable (§11 final steps, §45).
 *
 * The value here is the three-way match: what was ordered (purchase order),
 * what actually arrived (goods receipt) and what is being billed (invoice).
 * An invoice that does not reconcile cannot be approved for payment, which is
 * the control that stops a pharmacy paying for stock it never received.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly docNumbers: DocumentNumberService,
    private readonly notifications: NotificationsService,
    private readonly separation: SeparationOfDutiesService,
  ) {}

  async create(input: CreateInvoiceInput, user: AuthenticatedUser) {
    if (!input.items?.length) {
      throw new BadRequestException('An invoice must have at least one line');
    }

    const duplicate = await this.prisma.supplierInvoice.findFirst({
      where: { supplierId: input.supplierId, supplierInvoiceNo: input.supplierInvoiceNo },
    });
    if (duplicate) {
      // Duplicate invoice entry is one of the commonest ways money leaks.
      throw new ConflictException(
        `Invoice ${input.supplierInvoiceNo} has already been entered for this supplier as ${duplicate.internalNo}`,
      );
    }

    const invoice = await this.prisma.$transaction(async (tx) => {
      const internalNo = await this.docNumbers.next(tx, 'INV');

      let subtotal = new Prisma.Decimal(0);
      let taxTotal = new Prisma.Decimal(0);
      const items = input.items.map((i) => {
        const net = new Prisma.Decimal(i.unitPrice).times(i.quantity);
        const tax = net.times(new Prisma.Decimal(i.taxRate ?? 0));
        subtotal = subtotal.plus(net);
        taxTotal = taxTotal.plus(tax);
        return {
          productId: i.productId,
          quantity: new Prisma.Decimal(i.quantity),
          unitPrice: new Prisma.Decimal(i.unitPrice),
          taxRate: new Prisma.Decimal(i.taxRate ?? 0),
          lineTotal: net.plus(tax),
        };
      });

      const freight = new Prisma.Decimal(input.freightCost ?? 0);

      return tx.supplierInvoice.create({
        data: {
          internalNo,
          supplierInvoiceNo: input.supplierInvoiceNo,
          supplierId: input.supplierId,
          branchId: input.branchId,
          purchaseOrderId: input.purchaseOrderId ?? null,
          goodsReceiptId: input.goodsReceiptId ?? null,
          invoiceDate: new Date(input.invoiceDate),
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          currency: input.currency ?? 'ETB',
          subtotal,
          taxTotal,
          freightCost: freight,
          grandTotal: subtotal.plus(taxTotal).plus(freight),
          status: SupplierInvoiceStatus.SUBMITTED,
          createdById: user.id,
          items: { create: items },
        },
        include: { items: true },
      });
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'finance',
      action: 'CREATE',
      entityType: 'SupplierInvoice',
      entityId: invoice.id,
      newValue: {
        internalNo: invoice.internalNo,
        supplierInvoiceNo: invoice.supplierInvoiceNo,
        total: invoice.grandTotal.toString(),
      },
      branchId: input.branchId,
    });

    // Match immediately so the buyer sees discrepancies while the delivery is fresh.
    return this.match(invoice.id, user);
  }

  /**
   * Three-way match. Compares each invoice line against the purchase order
   * price and the quantity actually received, and records the outcome per line
   * so a disputed invoice shows exactly which lines are wrong.
   */
  async match(invoiceId: string, user: AuthenticatedUser) {
    const invoice = await this.prisma.supplierInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { items: true },
    });

    if (!invoice.purchaseOrderId) {
      await this.prisma.supplierInvoice.update({
        where: { id: invoiceId },
        data: {
          matchStatus: InvoiceMatchStatus.UNMATCHED,
          matchNotes: 'No purchase order is linked, so the invoice cannot be matched automatically.',
        },
      });
      return this.findOne(invoiceId);
    }

    const po = await this.prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: invoice.purchaseOrderId },
      include: { items: true },
    });

    let priceVariance = false;
    let quantityVariance = false;
    const notes: string[] = [];

    for (const line of invoice.items) {
      const poItem = po.items.find((i) => i.productId === line.productId);

      if (!poItem) {
        quantityVariance = true;
        notes.push(`Line for product ${line.productId.slice(0, 8)} is not on the purchase order`);
        await this.prisma.supplierInvoiceItem.update({
          where: { id: line.id },
          data: { variance: 'NOT_ON_PURCHASE_ORDER' },
        });
        continue;
      }

      const variances: string[] = [];

      const priceDelta = line.unitPrice.minus(poItem.unitPrice).abs();
      if (priceDelta.greaterThan(poItem.unitPrice.times(PRICE_TOLERANCE))) {
        priceVariance = true;
        variances.push(
          `PRICE billed ${line.unitPrice.toString()} vs ordered ${poItem.unitPrice.toString()}`,
        );
      }

      // Bill for what arrived, not for what was ordered.
      const qtyDelta = line.quantity.minus(poItem.receivedQty).abs();
      if (qtyDelta.greaterThan(QUANTITY_TOLERANCE)) {
        quantityVariance = true;
        variances.push(
          `QUANTITY billed ${line.quantity.toString()} vs received ${poItem.receivedQty.toString()}`,
        );
      }

      await this.prisma.supplierInvoiceItem.update({
        where: { id: line.id },
        data: {
          orderedQty: poItem.orderedQty,
          receivedQty: poItem.receivedQty,
          poUnitPrice: poItem.unitPrice,
          variance: variances.join('; ') || null,
        },
      });
      if (variances.length) notes.push(variances.join('; '));
    }

    const matchStatus =
      priceVariance && quantityVariance
        ? InvoiceMatchStatus.BOTH_VARIANCE
        : priceVariance
          ? InvoiceMatchStatus.PRICE_VARIANCE
          : quantityVariance
            ? InvoiceMatchStatus.QUANTITY_VARIANCE
            : InvoiceMatchStatus.MATCHED;

    const clean = matchStatus === InvoiceMatchStatus.MATCHED;

    await this.prisma.supplierInvoice.update({
      where: { id: invoiceId },
      data: {
        matchStatus,
        matchNotes: notes.join('\n') || 'Invoice reconciles with the order and the goods received.',
        status: clean ? SupplierInvoiceStatus.MATCHED : SupplierInvoiceStatus.DISPUTED,
      },
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'finance',
      action: 'INVOICE_MATCH',
      entityType: 'SupplierInvoice',
      entityId: invoiceId,
      newValue: { matchStatus, notes },
      branchId: invoice.branchId,
    });

    if (!clean) {
      await this.notifications.emit({
        eventType: 'INVOICE_VARIANCE',
        severity: 'WARNING',
        title: `Invoice ${invoice.supplierInvoiceNo} does not reconcile (${matchStatus})`,
        body: notes.join('\n'),
        branchId: invoice.branchId,
        roleCodes: ['FINANCE_OFFICER', 'PROCUREMENT_OFFICER'],
        linkUrl: `/invoices?id=${invoiceId}`,
      });
    }

    return this.findOne(invoiceId);
  }

  /** Approve for payment. A disputed invoice needs an explicit override reason. */
  async approve(invoiceId: string, user: AuthenticatedUser, overrideReason?: string) {
    const invoice = await this.prisma.supplierInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
    });

    if (invoice.status === SupplierInvoiceStatus.PAID) {
      throw new ConflictException('This invoice is already paid');
    }
    if (invoice.matchStatus !== InvoiceMatchStatus.MATCHED && !overrideReason?.trim()) {
      throw new BadRequestException(
        `Invoice does not reconcile (${invoice.matchStatus}). ` +
          `Approving it anyway requires a written reason.`,
      );
    }

    await this.separation.assertDistinct({
      entityType: 'SupplierInvoice',
      entityId: invoiceId,
      actor: user,
      raisedById: invoice.createdById,
      stage: 'approve',
      countPriorSteps: false,
    });

    const updated = await this.prisma.supplierInvoice.update({
      where: { id: invoiceId },
      data: {
        status: SupplierInvoiceStatus.APPROVED,
        approvedById: user.id,
        approvedAt: new Date(),
        disputeReason: overrideReason ?? invoice.disputeReason,
      },
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'finance',
      action: 'APPROVE',
      entityType: 'SupplierInvoice',
      entityId: invoiceId,
      previousValue: { status: invoice.status, matchStatus: invoice.matchStatus },
      newValue: { status: SupplierInvoiceStatus.APPROVED },
      reason: overrideReason,
      branchId: invoice.branchId,
    });

    return updated;
  }

  /** Record a payment against an approved invoice. */
  async pay(
    invoiceId: string,
    input: { amount: number; method: PaymentMethod; reference?: string; notes?: string },
    user: AuthenticatedUser,
  ) {
    const invoice = await this.prisma.supplierInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
    });

    if (
      ![SupplierInvoiceStatus.APPROVED, SupplierInvoiceStatus.PARTIALLY_PAID].includes(
        invoice.status as any,
      )
    ) {
      throw new ConflictException(
        `Invoice is ${invoice.status}; only an approved invoice can be paid`,
      );
    }

    const amount = new Prisma.Decimal(input.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Payment amount must be greater than zero');
    }

    const outstanding = invoice.grandTotal.minus(invoice.amountPaid);
    if (amount.greaterThan(outstanding)) {
      throw new BadRequestException(
        `Payment of ${amount.toString()} exceeds the outstanding balance of ${outstanding.toString()}`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const paymentNo = await this.docNumbers.next(tx, 'PAY');
      await tx.supplierPayment.create({
        data: {
          paymentNo,
          invoiceId,
          amount,
          method: input.method,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          recordedById: user.id,
        },
      });

      const paid = invoice.amountPaid.plus(amount);
      return tx.supplierInvoice.update({
        where: { id: invoiceId },
        data: {
          amountPaid: paid,
          status: paid.greaterThanOrEqualTo(invoice.grandTotal)
            ? SupplierInvoiceStatus.PAID
            : SupplierInvoiceStatus.PARTIALLY_PAID,
        },
      });
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'finance',
      action: 'PAYMENT',
      entityType: 'SupplierInvoice',
      entityId: invoiceId,
      newValue: {
        amount: amount.toString(),
        method: input.method,
        reference: input.reference,
        totalPaid: result.amountPaid.toString(),
      },
      branchId: invoice.branchId,
    });

    return this.findOne(invoiceId);
  }

  async findOne(id: string) {
    return this.prisma.supplierInvoice.findUniqueOrThrow({
      where: { id },
      include: {
        items: true,
        payments: { orderBy: { paidAt: 'desc' } },
        supplier: { select: { companyName: true, code: true, paymentTerms: true } },
      },
    });
  }

  async findAll(query: {
    status?: SupplierInvoiceStatus;
    supplierId?: string;
    overdueOnly?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, query.pageSize ?? 25);

    const where: Prisma.SupplierInvoiceWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.overdueOnly
        ? {
            dueDate: { lt: new Date() },
            status: { notIn: [SupplierInvoiceStatus.PAID, SupplierInvoiceStatus.CANCELLED] },
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.supplierInvoice.findMany({
        where,
        include: {
          items: true,
          supplier: { select: { companyName: true, code: true } },
        },
        orderBy: { invoiceDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.supplierInvoice.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  /** Accounts payable ageing (§45). */
  async ageing() {
    const invoices = await this.prisma.supplierInvoice.findMany({
      where: {
        status: {
          notIn: [SupplierInvoiceStatus.PAID, SupplierInvoiceStatus.CANCELLED],
        },
      },
      include: { supplier: { select: { companyName: true } } },
    });

    const now = Date.now();
    const buckets = {
      current: 0,
      days1_30: 0,
      days31_60: 0,
      days61_90: 0,
      over90: 0,
    };

    const rows = invoices.map((i) => {
      const outstanding = Number(i.grandTotal.minus(i.amountPaid));
      const daysOverdue = i.dueDate
        ? Math.floor((now - i.dueDate.getTime()) / 86_400_000)
        : 0;

      if (daysOverdue <= 0) buckets.current += outstanding;
      else if (daysOverdue <= 30) buckets.days1_30 += outstanding;
      else if (daysOverdue <= 60) buckets.days31_60 += outstanding;
      else if (daysOverdue <= 90) buckets.days61_90 += outstanding;
      else buckets.over90 += outstanding;

      return {
        invoiceId: i.id,
        internalNo: i.internalNo,
        supplierInvoiceNo: i.supplierInvoiceNo,
        supplier: i.supplier.companyName,
        invoiceDate: i.invoiceDate,
        dueDate: i.dueDate,
        daysOverdue: Math.max(0, daysOverdue),
        grandTotal: Number(i.grandTotal),
        amountPaid: Number(i.amountPaid),
        outstanding,
        status: i.status,
        matchStatus: i.matchStatus,
      };
    });

    return {
      buckets,
      totalOutstanding: rows.reduce((s, r) => s + r.outstanding, 0),
      rows: rows.sort((a, b) => b.daysOverdue - a.daysOverdue),
    };
  }
}
