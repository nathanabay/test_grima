import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';

/**
 * How exposed the pharmacy is to this supplier failing (§13: features 274-278).
 */
export const SUPPLIER_RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type SupplierRiskLevel = (typeof SUPPLIER_RISK_LEVELS)[number];

/**
 * Fields a client may set on a supplier.
 *
 * KPI fields (supplierScore, onTimeDeliveryRate, rejectionRate, ...) are
 * deliberately absent: they are computed from receipts and incidents by
 * recomputeScore, and letting a request write them would make the scorecard a
 * self-assessment. Passing the request body straight to Prisma would have
 * allowed exactly that (§73).
 */
const WRITABLE_SUPPLIER_FIELDS = [
  'code',
  'companyName',
  'contactName',
  'email',
  'phone',
  'alternatePhone',
  'address',
  'city',
  'country',
  'taxId',
  'licenseNumber',
  'licenseExpiry',
  'paymentTerms',
  'currency',
  'leadTimeDays',
  'minimumOrderValue',
  'notes',
  'isActive',
  'isApproved',
  'riskLevel',
  'riskNotes',
  'creditLimit',
] as const;

/**
 * Supplier management and scoring (§13).
 *
 * KPIs are recomputed from actual receipts and quality incidents rather than
 * entered by hand, so the supplier score cannot be talked up.
 */
@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(query: { q?: string; isActive?: boolean; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, query.pageSize ?? 25);
    const where: Prisma.SupplierWhereInput = {
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.q
        ? {
            OR: [
              { companyName: { contains: query.q, mode: 'insensitive' } },
              { code: { contains: query.q, mode: 'insensitive' } },
              { contactName: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        orderBy: { supplierScore: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.supplier.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  async findOne(id: string) {
    return this.prisma.supplier.findUniqueOrThrow({
      where: { id },
      include: {
        products: { include: { product: { select: { sku: true, genericName: true } } } },
        purchaseOrders: {
          select: { id: true, poNo: true, status: true, grandTotal: true, orderDate: true },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
  }

  /**
   * Keep only the fields a client is allowed to set, and validate the ones with
   * a fixed vocabulary. Unknown keys are dropped rather than rejected so a
   * client sending a whole supplier record back does not need to strip it.
   */
  private sanitize(data: Record<string, unknown>): Record<string, unknown> {
    const clean: Record<string, unknown> = {};
    for (const field of WRITABLE_SUPPLIER_FIELDS) {
      if (data[field] !== undefined) clean[field] = data[field];
    }

    if (clean.riskLevel !== undefined) {
      if (!(SUPPLIER_RISK_LEVELS as readonly string[]).includes(String(clean.riskLevel))) {
        throw new BadRequestException(
          `Risk level must be one of ${SUPPLIER_RISK_LEVELS.join(', ')}`,
        );
      }
    }
    if (clean.creditLimit !== undefined) {
      const limit = Number(clean.creditLimit);
      if (Number.isNaN(limit) || limit < 0) {
        throw new BadRequestException('The credit limit must be zero or a positive amount');
      }
      clean.creditLimit = new Prisma.Decimal(limit);
    }
    if (clean.licenseExpiry) clean.licenseExpiry = new Date(clean.licenseExpiry as string);

    return clean;
  }

  async create(data: any, user: AuthenticatedUser) {
    const supplier = await this.prisma.supplier.create({ data: this.sanitize(data) as any });
    await this.audit.record({
      userId: user.id,
      module: 'procurement',
      action: 'CREATE',
      entityType: 'Supplier',
      entityId: supplier.id,
      newValue: { code: supplier.code, companyName: supplier.companyName },
    });
    return supplier;
  }

  async update(id: string, data: any, user: AuthenticatedUser) {
    const before = await this.prisma.supplier.findUniqueOrThrow({ where: { id } });
    const clean = this.sanitize(data);
    const updated = await this.prisma.supplier.update({ where: { id }, data: clean as any });
    await this.audit.record({
      userId: user.id,
      module: 'procurement',
      action: 'EDIT',
      entityType: 'Supplier',
      entityId: id,
      previousValue: {
        isActive: before.isActive,
        isApproved: before.isApproved,
        riskLevel: before.riskLevel,
        creditLimit: before.creditLimit,
      },
      newValue: clean,
    });
    return updated;
  }

  /**
   * Recompute the KPI set and the composite score (§13).
   * Score is a weighted blend on a 0-100 scale.
   */
  async recomputeScore(supplierId: string) {
    const orders = await this.prisma.purchaseOrder.findMany({
      where: {
        supplierId,
        status: { in: ['RECEIVED', 'PARTIALLY_RECEIVED', 'CLOSED'] },
      },
      include: { items: true, receipts: true },
    });

    let onTime = 0;
    let withExpectedDate = 0;
    let leadTimeSum = 0;
    let leadTimeCount = 0;
    let shortShipments = 0;

    for (const po of orders) {
      const firstReceipt = po.receipts.sort(
        (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime(),
      )[0];
      if (!firstReceipt) continue;

      if (po.expectedDate) {
        withExpectedDate += 1;
        if (firstReceipt.receivedAt <= po.expectedDate) onTime += 1;
      }
      if (po.orderDate) {
        leadTimeSum +=
          (firstReceipt.receivedAt.getTime() - po.orderDate.getTime()) / 86_400_000;
        leadTimeCount += 1;
      }
      if (po.items.some((i) => i.receivedQty.lessThan(i.orderedQty))) shortShipments += 1;
    }

    const receiptItems = await this.prisma.goodsReceiptItem.findMany({
      where: { goodsReceipt: { supplierId } },
      select: { receivedQty: true, rejectedQty: true },
    });
    const totalReceived = receiptItems.reduce((s, i) => s + Number(i.receivedQty), 0);
    const totalRejected = receiptItems.reduce((s, i) => s + Number(i.rejectedQty), 0);

    const incidents = await this.prisma.qualityIncident.count({ where: { supplierId } });

    const onTimeRate = withExpectedDate ? onTime / withExpectedDate : 0;
    const avgLeadTime = leadTimeCount ? leadTimeSum / leadTimeCount : 0;
    const rejectionRate = totalReceived ? totalRejected / totalReceived : 0;
    const shortShipmentRate = orders.length ? shortShipments / orders.length : 0;

    // Weighted composite: delivery reliability dominates, quality penalizes hard.
    const score =
      onTimeRate * 45 +
      (1 - rejectionRate) * 25 +
      (1 - shortShipmentRate) * 20 +
      Math.max(0, 10 - incidents * 2);

    return this.prisma.supplier.update({
      where: { id: supplierId },
      data: {
        onTimeDeliveryRate: new Prisma.Decimal(onTimeRate.toFixed(4)),
        avgLeadTimeDays: new Prisma.Decimal(avgLeadTime.toFixed(2)),
        rejectionRate: new Prisma.Decimal(rejectionRate.toFixed(4)),
        shortShipmentRate: new Prisma.Decimal(shortShipmentRate.toFixed(4)),
        qualityIncidents: incidents,
        supplierScore: new Prisma.Decimal(Math.max(0, Math.min(100, score)).toFixed(2)),
      },
    });
  }

  async recomputeAllScores() {
    const suppliers = await this.prisma.supplier.findMany({ select: { id: true } });
    for (const s of suppliers) await this.recomputeScore(s.id);
    return { updated: suppliers.length };
  }

  /**
   * Single-source dependency analysis (§13: feature 277).
   *
   * The question this answers is "which medicines stop if one supplier stops".
   * A product bought from exactly one approved supplier is a single point of
   * failure; when that supplier is also rated HIGH or CRITICAL risk, it is the
   * one worth acting on first.
   */
  async dependencyAnalysis() {
    const links = await this.prisma.supplierProduct.findMany({
      where: { supplier: { isActive: true } },
      select: {
        productId: true,
        supplierId: true,
        supplier: { select: { id: true, code: true, companyName: true, riskLevel: true, supplierScore: true } },
      },
    });

    const suppliersByProduct = new Map<string, typeof links>();
    for (const link of links) {
      const list = suppliersByProduct.get(link.productId) ?? [];
      list.push(link);
      suppliersByProduct.set(link.productId, list);
    }

    const singleSourced = [...suppliersByProduct.entries()].filter(([, v]) => v.length === 1);
    const productIds = singleSourced.map(([productId]) => productId);

    const products = productIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            sku: true,
            genericName: true,
            strength: true,
            isControlled: true,
            isColdChain: true,
          },
        })
      : [];
    const productById = new Map(products.map((p) => [p.id, p]));

    // Stock cover matters: a single-sourced product with three months on the
    // shelf is a different problem from one with three days.
    const balances = productIds.length
      ? await this.prisma.inventoryBalance.groupBy({
          by: ['productId'],
          where: { productId: { in: productIds } },
          _sum: { onHand: true },
        })
      : [];
    const onHandByProduct = new Map(balances.map((b) => [b.productId, b._sum.onHand]));

    const rows = singleSourced
      .map(([productId, list]) => {
        const product = productById.get(productId);
        const supplier = list[0].supplier;
        if (!product) return null;
        const onHand = onHandByProduct.get(productId);
        const risky = supplier.riskLevel === 'HIGH' || supplier.riskLevel === 'CRITICAL';
        return {
          productId,
          sku: product.sku,
          product: `${product.genericName} ${product.strength}`.trim(),
          isControlled: product.isControlled,
          isColdChain: product.isColdChain,
          supplierId: supplier.id,
          supplierCode: supplier.code,
          supplierName: supplier.companyName,
          supplierRiskLevel: supplier.riskLevel,
          supplierScore: supplier.supplierScore,
          onHand: onHand ? onHand.toString() : '0',
          severity: risky ? (supplier.riskLevel === 'CRITICAL' ? 'CRITICAL' : 'HIGH') : 'MEDIUM',
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 } as const;
    rows.sort((a, b) => order[a.severity as keyof typeof order] - order[b.severity as keyof typeof order]);

    return {
      productsWithASupplier: suppliersByProduct.size,
      singleSourcedCount: rows.length,
      atRiskCount: rows.filter((r) => r.severity !== 'MEDIUM').length,
      rows,
    };
  }

  /**
   * How much this supplier is currently owed against their credit limit
   * (§13: feature 276).
   *
   * Only posted, unpaid invoices count. A limit of zero means no limit was
   * agreed, which is reported as such rather than as "nothing may be ordered".
   */
  async creditExposure(supplierId: string) {
    const supplier = await this.prisma.supplier.findUniqueOrThrow({
      where: { id: supplierId },
      select: { id: true, code: true, companyName: true, creditLimit: true, currency: true },
    });

    const invoices = await this.prisma.supplierInvoice.findMany({
      where: { supplierId, status: { notIn: ['CANCELLED', 'DRAFT'] } },
      select: { id: true, internalNo: true, grandTotal: true, amountPaid: true, dueDate: true, status: true },
    });

    const outstanding = invoices.reduce(
      (sum, i) => sum.plus(i.grandTotal.minus(i.amountPaid)),
      new Prisma.Decimal(0),
    );
    const now = Date.now();
    const overdue = invoices
      .filter((i) => i.dueDate && i.dueDate.getTime() < now && i.grandTotal.greaterThan(i.amountPaid))
      .reduce((sum, i) => sum.plus(i.grandTotal.minus(i.amountPaid)), new Prisma.Decimal(0));

    const hasLimit = supplier.creditLimit.greaterThan(0);
    return {
      supplierId: supplier.id,
      supplierCode: supplier.code,
      supplierName: supplier.companyName,
      currency: supplier.currency,
      creditLimit: supplier.creditLimit.toFixed(2),
      hasLimit,
      outstanding: outstanding.toFixed(2),
      overdue: overdue.toFixed(2),
      headroom: hasLimit ? supplier.creditLimit.minus(outstanding).toFixed(2) : null,
      utilisationPercent: hasLimit
        ? outstanding.dividedBy(supplier.creditLimit).times(100).toFixed(1)
        : null,
      overLimit: hasLimit && outstanding.greaterThan(supplier.creditLimit),
    };
  }

  /** Supplier performance report (§41). */
  async performanceReport() {
    const suppliers = await this.prisma.supplier.findMany({
      where: { isActive: true },
      orderBy: { supplierScore: 'desc' },
      select: {
        id: true,
        code: true,
        companyName: true,
        onTimeDeliveryRate: true,
        avgLeadTimeDays: true,
        rejectionRate: true,
        shortShipmentRate: true,
        qualityIncidents: true,
        returnRate: true,
        supplierScore: true,
        licenseExpiry: true,
      },
    });

    const now = Date.now();
    return suppliers.map((s) => ({
      ...s,
      // §44: surface expiring supplier licences alongside performance.
      licenceStatus: !s.licenseExpiry
        ? 'UNKNOWN'
        : s.licenseExpiry.getTime() < now
          ? 'EXPIRED'
          : s.licenseExpiry.getTime() - now < 60 * 86_400_000
            ? 'EXPIRING_SOON'
            : 'VALID',
    }));
  }
}
