import { BadRequestException, Injectable } from '@nestjs/common';
import {
  DocumentStatus,
  Prisma,
  PurchaseOrderStatus,
} from '@prisma/client';
import { calculateReplenishment, movingAverage } from '@pharmacore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';
import { DocumentNumberService } from '../common-services/document-number.service';

/** Weighting used to score quotations (§14). Configurable per organization. */
export interface QuotationWeights {
  price: number;
  deliveryTime: number;
  shelfLife: number;
  supplierScore: number;
  paymentTerms: number;
}

const DEFAULT_WEIGHTS: QuotationWeights = {
  price: 0.4,
  deliveryTime: 0.2,
  shelfLife: 0.15,
  supplierScore: 0.2,
  paymentTerms: 0.05,
};

@Injectable()
export class ProcurementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly docNumbers: DocumentNumberService,
  ) {}

  // ---- Automatic replenishment (§12) ----

  /**
   * Reorder recommendations. This only ever *suggests*: §12 forbids placing an
   * order automatically unless an administrator explicitly enables it, and that
   * setting is checked by the caller that would create the PO.
   */
  async replenishmentRecommendations(branchId?: string) {
    const products = await this.prisma.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        sku: true,
        genericName: true,
        brandName: true,
        strength: true,
        baseUnit: true,
        reorderLevel: true,
        safetyStock: true,
        maximumStock: true,
        leadTimeDays: true,
        preferredSupplierId: true,
        purchaseCost: true,
      },
    });

    // Six months of consumption, per product, in one query.
    const since = new Date(Date.now() - 180 * 86_400_000);
    const consumption = await this.prisma.inventoryTransaction.groupBy({
      by: ['productId'],
      where: {
        occurredAt: { gte: since },
        type: { in: ['SALE', 'DISPENSING'] },
        ...(branchId ? { branchId } : {}),
      },
      _sum: { quantityOut: true },
    });
    const consumed = new Map(
      consumption.map((c) => [c.productId, Number(c._sum.quantityOut ?? 0)]),
    );

    const balances = await this.prisma.inventoryBalance.groupBy({
      by: ['productId'],
      where: branchId ? { branchId } : {},
      _sum: { onHand: true, reserved: true },
    });
    const stock = new Map(
      balances.map((b) => [
        b.productId,
        { onHand: Number(b._sum.onHand ?? 0), reserved: Number(b._sum.reserved ?? 0) },
      ]),
    );

    // Confirmed incoming = approved/ordered POs not yet received.
    const incoming = await this.prisma.purchaseOrderItem.groupBy({
      by: ['productId'],
      where: {
        purchaseOrder: {
          status: {
            in: [
              PurchaseOrderStatus.APPROVED,
              PurchaseOrderStatus.ORDERED,
              PurchaseOrderStatus.PARTIALLY_RECEIVED,
            ],
          },
          ...(branchId ? { branchId } : {}),
        },
      },
      _sum: { orderedQty: true, receivedQty: true },
    });
    const onOrder = new Map(
      incoming.map((i) => [
        i.productId,
        Number(i._sum.orderedQty ?? 0) - Number(i._sum.receivedQty ?? 0),
      ]),
    );

    const recommendations: any[] = [];
    for (const product of products) {
      const monthly = (consumed.get(product.id) ?? 0) / 6;
      const avgDaily = monthly / 30;
      const position = stock.get(product.id) ?? { onHand: 0, reserved: 0 };

      // Standard deviation is approximated from the monthly series; with no
      // history we fall back to a conservative 30% of the mean.
      const demandStdDev = monthly * 0.3;

      const result = calculateReplenishment({
        productId: product.id,
        onHand: position.onHand,
        reserved: position.reserved,
        incomingConfirmed: onOrder.get(product.id) ?? 0,
        avgDailyConsumption: avgDaily,
        demandStdDev,
        leadTimeDays: product.leadTimeDays,
        safetyStock: Number(product.safetyStock) || undefined,
        reorderLevel: Number(product.reorderLevel),
        maximumStock: Number(product.maximumStock),
      });

      if (!result.shouldReorder || result.suggestedQuantity <= 0) continue;

      recommendations.push({
        ...result,
        sku: product.sku,
        productName: `${product.genericName}${product.brandName ? ` (${product.brandName})` : ''}`,
        strength: product.strength,
        unit: product.baseUnit,
        avgMonthlyConsumption: Math.round(monthly),
        leadTimeDays: product.leadTimeDays,
        preferredSupplierId: product.preferredSupplierId,
        estimatedCost: result.suggestedQuantity * Number(product.purchaseCost),
      });
    }

    return recommendations.sort((a, b) => b.estimatedCost - a.estimatedCost);
  }

  // ---- Purchase requests (§11) ----

  async createPurchaseRequest(data: any, user: AuthenticatedUser) {
    const request = await this.prisma.$transaction(async (tx) => {
      const requestNo = await this.docNumbers.next(tx, 'PR');
      return tx.purchaseRequest.create({
        data: {
          requestNo,
          branchId: data.branchId,
          requestedById: user.id,
          department: data.department ?? null,
          reason: data.reason ?? null,
          requiredBy: data.requiredBy ? new Date(data.requiredBy) : null,
          status: DocumentStatus.SUBMITTED,
          items: {
            create: (data.items ?? []).map((i: any) => ({
              productId: i.productId,
              requestedQty: new Prisma.Decimal(i.requestedQty),
              currentStock: new Prisma.Decimal(i.currentStock ?? 0),
              reorderLevel: new Prisma.Decimal(i.reorderLevel ?? 0),
              forecastDemand: new Prisma.Decimal(i.forecastDemand ?? 0),
              notes: i.notes ?? null,
            })),
          },
        },
        include: { items: true },
      });
    });

    await this.audit.record({
      userId: user.id,
      module: 'procurement',
      action: 'CREATE',
      entityType: 'PurchaseRequest',
      entityId: request.id,
      newValue: { requestNo: request.requestNo, lines: request.items.length },
      branchId: data.branchId,
    });

    return request;
  }

  async approvePurchaseRequest(
    id: string,
    decision: 'APPROVE' | 'REJECT',
    user: AuthenticatedUser,
    reason?: string,
  ) {
    const request = await this.prisma.purchaseRequest.findUniqueOrThrow({ where: { id } });
    if (request.status !== DocumentStatus.SUBMITTED) {
      throw new BadRequestException(`Purchase request is ${request.status} and cannot be decided`);
    }
    if (decision === 'REJECT' && !reason?.trim()) {
      throw new BadRequestException('A rejection reason is required');
    }

    const updated = await this.prisma.purchaseRequest.update({
      where: { id },
      data: {
        status: decision === 'APPROVE' ? DocumentStatus.APPROVED : DocumentStatus.REJECTED,
        approvedById: user.id,
        approvedAt: new Date(),
        rejectionReason: decision === 'REJECT' ? reason! : null,
      },
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'procurement',
      action: decision,
      entityType: 'PurchaseRequest',
      entityId: id,
      previousValue: { status: request.status },
      newValue: { status: updated.status },
      reason,
      branchId: request.branchId,
    });

    return updated;
  }

  // ---- RFQ and quotation comparison (§14) ----

  async createRfq(data: { purchaseRequestId?: string; items: any[]; closesAt?: string }, user: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const rfqNo = await this.docNumbers.next(tx, 'RFQ');
      return tx.rfq.create({
        data: {
          rfqNo,
          purchaseRequestId: data.purchaseRequestId ?? null,
          status: DocumentStatus.SUBMITTED,
          issuedAt: new Date(),
          closesAt: data.closesAt ? new Date(data.closesAt) : null,
          createdById: user.id,
          items: {
            create: data.items.map((i) => ({
              productId: i.productId,
              quantity: new Prisma.Decimal(i.quantity),
            })),
          },
        },
        include: { items: true },
      });
    });
  }

  async submitQuotation(rfqId: string, data: any) {
    return this.prisma.$transaction(async (tx) => {
      const quotationNo = await this.docNumbers.next(tx, 'QUO');
      return tx.supplierQuotation.create({
        data: {
          quotationNo,
          rfqId,
          supplierId: data.supplierId,
          validUntil: data.validUntil ? new Date(data.validUntil) : null,
          currency: data.currency ?? 'ETB',
          freightCost: new Prisma.Decimal(data.freightCost ?? 0),
          discountPct: new Prisma.Decimal(data.discountPct ?? 0),
          paymentTerms: data.paymentTerms ?? null,
          deliveryDays: data.deliveryDays ?? null,
          items: {
            create: (data.items ?? []).map((i: any) => ({
              productId: i.productId,
              unitPrice: new Prisma.Decimal(i.unitPrice),
              taxRate: new Prisma.Decimal(i.taxRate ?? 0),
              discountPct: new Prisma.Decimal(i.discountPct ?? 0),
              moq: new Prisma.Decimal(i.moq ?? 1),
              offeredShelfLifeDays: i.offeredShelfLifeDays ?? null,
            })),
          },
        },
        include: { items: true },
      });
    });
  }

  /**
   * Side-by-side comparison with landed cost and a weighted score (§14).
   * The cheapest quotation is NOT selected automatically - the ranking is
   * advisory and the buyer chooses.
   */
  async compareQuotations(rfqId: string, weights: Partial<QuotationWeights> = {}) {
    const w = { ...DEFAULT_WEIGHTS, ...weights };
    const rfq = await this.prisma.rfq.findUniqueOrThrow({
      where: { id: rfqId },
      include: {
        items: true,
        quotations: {
          include: {
            items: true,
            supplier: {
              select: {
                id: true,
                companyName: true,
                supplierScore: true,
                leadTimeDays: true,
                paymentTerms: true,
              },
            },
          },
        },
      },
    });

    if (!rfq.quotations.length) {
      return { rfqNo: rfq.rfqNo, quotations: [], recommendation: null, weights: w };
    }

    const rows = rfq.quotations.map((q) => {
      // Landed cost = line values + tax - discounts + freight.
      let goods = new Prisma.Decimal(0);
      let tax = new Prisma.Decimal(0);

      for (const rfqItem of rfq.items) {
        const line = q.items.find((i) => i.productId === rfqItem.productId);
        if (!line) continue;
        const gross = line.unitPrice.times(rfqItem.quantity);
        const net = gross.minus(gross.times(line.discountPct));
        goods = goods.plus(net);
        tax = tax.plus(net.times(line.taxRate));
      }

      const afterHeaderDiscount = goods.minus(goods.times(q.discountPct));
      const landedCost = afterHeaderDiscount.plus(tax).plus(q.freightCost);

      const coveredLines = rfq.items.filter((ri) =>
        q.items.some((qi) => qi.productId === ri.productId),
      ).length;

      const avgShelfLife =
        q.items.reduce((sum, i) => sum + (i.offeredShelfLifeDays ?? 0), 0) /
        (q.items.length || 1);

      return {
        quotationId: q.id,
        quotationNo: q.quotationNo,
        supplierId: q.supplierId,
        supplierName: q.supplier.companyName,
        supplierScore: Number(q.supplier.supplierScore),
        landedCost: Number(landedCost),
        goodsValue: Number(afterHeaderDiscount),
        tax: Number(tax),
        freight: Number(q.freightCost),
        deliveryDays: q.deliveryDays ?? q.supplier.leadTimeDays,
        paymentTerms: q.paymentTerms ?? q.supplier.paymentTerms,
        avgOfferedShelfLifeDays: Math.round(avgShelfLife),
        linesQuoted: coveredLines,
        linesRequested: rfq.items.length,
        complete: coveredLines === rfq.items.length,
        lines: q.items,
      };
    });

    // Normalize each criterion to 0-1 where 1 is best, then apply weights.
    const minCost = Math.min(...rows.map((r) => r.landedCost));
    const maxCost = Math.max(...rows.map((r) => r.landedCost));
    const minDelivery = Math.min(...rows.map((r) => r.deliveryDays ?? 999));
    const maxDelivery = Math.max(...rows.map((r) => r.deliveryDays ?? 999));
    const maxShelf = Math.max(...rows.map((r) => r.avgOfferedShelfLifeDays), 1);

    const norm = (value: number, min: number, max: number, higherIsBetter: boolean) => {
      if (max === min) return 1;
      const scaled = (value - min) / (max - min);
      return higherIsBetter ? scaled : 1 - scaled;
    };

    const scored = rows.map((r) => {
      const priceScore = norm(r.landedCost, minCost, maxCost, false);
      const deliveryScore = norm(r.deliveryDays ?? 999, minDelivery, maxDelivery, false);
      const shelfScore = r.avgOfferedShelfLifeDays / maxShelf;
      const supplierScore = r.supplierScore / 100;
      const termsScore = /NET\s*(\d+)/i.test(r.paymentTerms ?? '')
        ? Math.min(1, Number(RegExp.$1) / 90)
        : 0.3;

      const score =
        priceScore * w.price +
        deliveryScore * w.deliveryTime +
        shelfScore * w.shelfLife +
        supplierScore * w.supplierScore +
        termsScore * w.paymentTerms;

      return {
        ...r,
        breakdown: {
          priceScore: Math.round(priceScore * 100) / 100,
          deliveryScore: Math.round(deliveryScore * 100) / 100,
          shelfLifeScore: Math.round(shelfScore * 100) / 100,
          supplierScore: Math.round(supplierScore * 100) / 100,
          paymentTermsScore: Math.round(termsScore * 100) / 100,
        },
        // Incomplete quotations are ranked but flagged, never silently dropped.
        totalScore: Math.round(score * 10000) / 100,
      };
    });

    const ranked = [...scored].sort((a, b) => b.totalScore - a.totalScore);
    const best = ranked.find((r) => r.complete) ?? ranked[0];
    const cheapest = [...scored].sort((a, b) => a.landedCost - b.landedCost)[0];

    return {
      rfqNo: rfq.rfqNo,
      weights: w,
      quotations: ranked,
      recommendation: best
        ? {
            quotationId: best.quotationId,
            supplierName: best.supplierName,
            totalScore: best.totalScore,
            landedCost: best.landedCost,
            rationale:
              best.quotationId === cheapest.quotationId
                ? 'Highest weighted score and also the lowest landed cost.'
                : `Highest weighted score. Note the cheapest quotation is ${cheapest.supplierName} ` +
                  `at ${cheapest.landedCost.toFixed(2)}, which scores lower on delivery, shelf life or supplier performance.`,
          }
        : null,
      note: 'Advisory only. Selection requires an explicit decision by the procurement officer (§14).',
    };
  }

  // ---- Purchase orders (§11) ----

  async createPurchaseOrder(data: any, user: AuthenticatedUser) {
    const po = await this.prisma.$transaction(async (tx) => {
      const poNo = await this.docNumbers.next(tx, 'PO');

      let subtotal = new Prisma.Decimal(0);
      let taxTotal = new Prisma.Decimal(0);
      const items = (data.items ?? []).map((i: any) => {
        const gross = new Prisma.Decimal(i.unitPrice).times(i.orderedQty);
        const discount = gross.times(new Prisma.Decimal(i.discountPct ?? 0));
        const net = gross.minus(discount);
        const tax = net.times(new Prisma.Decimal(i.taxRate ?? 0));
        subtotal = subtotal.plus(net);
        taxTotal = taxTotal.plus(tax);
        return {
          productId: i.productId,
          orderedQty: new Prisma.Decimal(i.orderedQty),
          unitPrice: new Prisma.Decimal(i.unitPrice),
          taxRate: new Prisma.Decimal(i.taxRate ?? 0),
          discountPct: new Prisma.Decimal(i.discountPct ?? 0),
          lineTotal: net.plus(tax),
        };
      });

      const freight = new Prisma.Decimal(data.freightCost ?? 0);
      return tx.purchaseOrder.create({
        data: {
          poNo,
          supplierId: data.supplierId,
          branchId: data.branchId,
          warehouseId: data.warehouseId,
          quotationId: data.quotationId ?? null,
          status: PurchaseOrderStatus.DRAFT,
          expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
          currency: data.currency ?? 'ETB',
          subtotal,
          taxTotal,
          freightCost: freight,
          grandTotal: subtotal.plus(taxTotal).plus(freight),
          notes: data.notes ?? null,
          createdById: user.id,
          items: { create: items },
        },
        include: { items: true },
      });
    });

    await this.audit.record({
      userId: user.id,
      module: 'procurement',
      action: 'CREATE',
      entityType: 'PurchaseOrder',
      entityId: po.id,
      newValue: { poNo: po.poNo, total: po.grandTotal.toString() },
      branchId: data.branchId,
    });

    return po;
  }

  /** Move a PO through its approval chain (§43). */
  async transitionPurchaseOrder(
    id: string,
    next: PurchaseOrderStatus,
    user: AuthenticatedUser,
    comment?: string,
  ) {
    const po = await this.prisma.purchaseOrder.findUniqueOrThrow({ where: { id } });

    const allowed: Record<string, PurchaseOrderStatus[]> = {
      DRAFT: [PurchaseOrderStatus.SUBMITTED, PurchaseOrderStatus.CANCELLED],
      SUBMITTED: [PurchaseOrderStatus.PROCUREMENT_REVIEW, PurchaseOrderStatus.CANCELLED],
      PROCUREMENT_REVIEW: [PurchaseOrderStatus.FINANCE_REVIEW, PurchaseOrderStatus.CANCELLED],
      FINANCE_REVIEW: [PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.CANCELLED],
      APPROVED: [PurchaseOrderStatus.ORDERED, PurchaseOrderStatus.CANCELLED],
      ORDERED: [PurchaseOrderStatus.PARTIALLY_RECEIVED, PurchaseOrderStatus.RECEIVED, PurchaseOrderStatus.CANCELLED],
      PARTIALLY_RECEIVED: [PurchaseOrderStatus.RECEIVED, PurchaseOrderStatus.CLOSED],
      RECEIVED: [PurchaseOrderStatus.CLOSED],
      CANCELLED: [],
      CLOSED: [],
    };

    if (!allowed[po.status]?.includes(next)) {
      throw new BadRequestException(
        `Cannot move purchase order from ${po.status} to ${next}. ` +
          `Permitted: ${allowed[po.status]?.join(', ') || 'none'}`,
      );
    }

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: next,
        ...(next === PurchaseOrderStatus.APPROVED
          ? { approvedById: user.id, approvedAt: new Date() }
          : {}),
        ...(next === PurchaseOrderStatus.ORDERED ? { orderDate: new Date() } : {}),
      },
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'procurement',
      action: next === PurchaseOrderStatus.APPROVED ? 'APPROVE' : 'STATUS_CHANGE',
      entityType: 'PurchaseOrder',
      entityId: id,
      previousValue: { status: po.status },
      newValue: { status: next },
      reason: comment,
      branchId: po.branchId,
    });

    return updated;
  }

  async findPurchaseOrders(query: { status?: PurchaseOrderStatus; supplierId?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, query.pageSize ?? 25);
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        include: { items: true, supplier: { select: { companyName: true, code: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  async findPurchaseOrder(id: string) {
    return this.prisma.purchaseOrder.findUniqueOrThrow({
      where: { id },
      include: { items: true, supplier: true, receipts: { include: { items: true } } },
    });
  }
}
