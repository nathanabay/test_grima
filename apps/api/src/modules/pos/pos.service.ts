import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PaymentMethod, Prisma, SaleStatus, TransactionType } from '@prisma/client';
import { allocateFefo, recommendBatch } from '@pharmacore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';
import { ScopeService } from '../../common/guards/scope.service';
import { PricingService } from '../catalog/pricing.service';
import { ConfigService } from '../../common/config/config.service';
import { LedgerService } from '../inventory/ledger.service';
import { FefoService } from '../inventory/fefo.service';
import { DocumentNumberService } from '../common-services/document-number.service';

export interface SaleLineInput {
  productId: string;
  quantity: number;
  unitCode?: string;
  batchId?: string;
  overrideReason?: string;
  discountPct?: number;
  /** A price agreed at the counter, which needs its own permission and reason. */
  priceOverride?: number;
  priceOverrideReason?: string;
}

export interface CheckoutInput {
  branchId: string;
  warehouseId: string;
  cashSessionId?: string;
  patientId?: string;
  prescriptionId?: string;
  lines: SaleLineInput[];
  payments: Array<{ method: PaymentMethod; amount: number; reference?: string }>;
  idempotencyKey?: string;
  /** A discount applied to the whole sale rather than to one line. */
  saleDiscountPct?: number;
  /** The cashier confirmed the buyer's age for any age-restricted line. */
  ageConfirmed?: boolean;
  /** Acknowledges a duplicate-sale or near-expiry warning already shown. */
  acknowledgedWarnings?: string[];
}

/**
 * Point of sale (§22) and cash sessions (§46).
 *
 * Checkout is a single transaction: allocate by FEFO, move stock, record the
 * sale, take payment. If payment validation fails, no stock moves.
 */
@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly fefo: FefoService,
    private readonly audit: AuditService,
    private readonly docNumbers: DocumentNumberService,
    private readonly scope: ScopeService,
    private readonly pricing: PricingService,
    private readonly config: ConfigService,
  ) {}

  /** Fast product lookup for the POS search box, with live availability. */
  async searchForSale(query: { q: string; warehouseId: string; limit?: number }) {
    const products = await this.prisma.product.findMany({
      where: {
        isActive: true,
        OR: [
          { genericName: { contains: query.q, mode: 'insensitive' } },
          { brandName: { contains: query.q, mode: 'insensitive' } },
          { sku: { contains: query.q, mode: 'insensitive' } },
          { barcodes: { some: { barcode: query.q } } },
        ],
      },
      select: {
        id: true,
        sku: true,
        genericName: true,
        brandName: true,
        strength: true,
        dosageForm: true,
        baseUnit: true,
        retailPrice: true,
        taxRate: true,
        requiresPrescription: true,
        isControlled: true,
      },
      take: query.limit ?? 20,
    });

    // Availability in one grouped query rather than N per product.
    const balances = await this.prisma.inventoryBalance.groupBy({
      by: ['productId'],
      where: {
        productId: { in: products.map((p) => p.id) },
        warehouseId: query.warehouseId,
        batch: { status: { in: ['AVAILABLE', 'RELEASED'] }, expiryDate: { gt: new Date() } },
      },
      _sum: { onHand: true, reserved: true },
    });

    const availability = new Map(
      balances.map((b) => [
        b.productId,
        Number(b._sum.onHand ?? 0) - Number(b._sum.reserved ?? 0),
      ]),
    );

    return products.map((p) => ({
      ...p,
      available: availability.get(p.id) ?? 0,
      inStock: (availability.get(p.id) ?? 0) > 0,
    }));
  }

  async checkout(input: CheckoutInput, user: AuthenticatedUser) {
    if (!input.lines?.length) throw new BadRequestException('The cart is empty');

    // §4: the till may only sell from the operator's own branch.
    this.scope.assertBranch(user, input.branchId);
    await this.scope.assertWarehouse(user, input.warehouseId);
    if (!input.payments?.length) throw new BadRequestException('At least one payment is required');

    if (input.idempotencyKey) {
      const seen = await this.prisma.idempotencyKey.findUnique({
        where: { key: input.idempotencyKey },
      });
      if (seen?.resultId) return this.findOne(seen.resultId);
    }

    // Both checks run before the transaction: refusing a sale is cheaper than
    // rolling one back, and the duplicate check is advisory rather than a
    // refusal, so it must not hold a transaction open while somebody reads it.
    if (await this.config.getBoolean('pos.requireOpenShift')) {
      if (!input.cashSessionId) {
        throw new BadRequestException(
          'No cash shift is open. Open a shift before selling, so the takings reconcile to a drawer.',
        );
      }
      const shift = await this.prisma.cashSession.findUnique({
        where: { id: input.cashSessionId },
        select: { isOpen: true },
      });
      if (!shift?.isOpen) {
        throw new BadRequestException('That cash shift is already closed');
      }
    }

    const duplicateWindow = await this.config.getNumber('pos.duplicateSaleWindowMinutes');
    if (duplicateWindow > 0 && input.patientId) {
      const since = new Date(Date.now() - duplicateWindow * 60_000);
      const recent = await this.prisma.saleItem.findMany({
        where: {
          productId: { in: input.lines.map((l) => l.productId) },
          sale: {
            patientId: input.patientId,
            status: SaleStatus.COMPLETED,
            soldAt: { gte: since },
          },
        },
        select: { productId: true, sale: { select: { saleNo: true } } },
        take: 5,
      });
      const unacknowledged = recent.filter(
        (r) => !(input.acknowledgedWarnings ?? []).includes(`DUPLICATE:${r.productId}`),
      );
      if (unacknowledged.length) {
        // Advisory, not a refusal: a customer may legitimately come back. But
        // an unnoticed double sale of a limited medicine is the thing this
        // exists to prevent, so it has to be acknowledged rather than ignored.
        throw new ConflictException(
          `This customer already bought ${unacknowledged.length} of these item(s) in the last ` +
            `${duplicateWindow} minutes (${unacknowledged.map((r) => r.sale.saleNo).join(', ')}). ` +
            `Confirm the repeat sale to continue.`,
        );
      }
    }

    let priceOverridesForAudit: Array<{ product: string; from: string; to: string; reason: string }> = [];
    let warningsForReceipt: string[] = [];
    let tenderedForReceipt = new Prisma.Decimal(0);
    let changeDueForReceipt = new Prisma.Decimal(0);

    const sale = await this.prisma.$transaction(
      async (tx) => {
        const saleNo = await this.docNumbers.next(tx, 'SALE');
        const created = await tx.sale.create({
          data: {
            saleNo,
            branchId: input.branchId,
            warehouseId: input.warehouseId,
            cashSessionId: input.cashSessionId ?? null,
            patientId: input.patientId ?? null,
            prescriptionId: input.prescriptionId ?? null,
            cashierId: user.id,
            status: SaleStatus.DRAFT,
          },
        });

        let subtotal = new Prisma.Decimal(0);
        let taxTotal = new Prisma.Decimal(0);
        let discountTotal = new Prisma.Decimal(0);
        const priceOverrides: Array<{ product: string; from: string; to: string; reason: string }> = [];
        const nearExpiryLines: Array<{ product: string; batchNumber: string; daysRemaining: number }> = [];
        // What counts as "close to expiry" is the pharmacy's decision, not a
        // constant in this file (§65).
        const nearExpiryDays = await this.config.getNumber('expiry.warningDays');
        let costTotal = new Prisma.Decimal(0);

        for (const line of input.lines) {
          const product = await tx.product.findUniqueOrThrow({
            where: { id: line.productId },
            select: {
              id: true,
              genericName: true,
              retailPrice: true,
              taxRate: true,
              requiresPrescription: true,
              isControlled: true,
              isActive: true,
              baseUnit: true,
              maxQuantityPerSale: true,
              isAgeRestricted: true,
              minimumAgeYears: true,
              isColdChain: true,
            },
          });

          if (!product.isActive) {
            throw new BadRequestException(`${product.genericName} is inactive and cannot be sold`);
          }
          // §73: prescription-only medicines never go out through plain OTC sale.
          if (product.requiresPrescription && !input.prescriptionId) {
            throw new ForbiddenException(
              `${product.genericName} is prescription-only. Dispense it against a prescription instead.`,
            );
          }
          if (product.isControlled) {
            throw new ForbiddenException(
              `${product.genericName} is a controlled medicine and must go through the dispensing workflow (§28)`,
            );
          }

          // A product a pharmacy is required to limit — pseudoephedrine and
          // codeine preparations, typically. Enforced here rather than on the
          // screen, because the screen is not the authority (§73).
          if (product.maxQuantityPerSale) {
            const askedInBase = line.quantity;
            if (new Prisma.Decimal(askedInBase).greaterThan(product.maxQuantityPerSale)) {
              throw new BadRequestException(
                `${product.genericName} is limited to ${product.maxQuantityPerSale.toString()} ` +
                  `${product.baseUnit} per sale. Reduce the quantity or dispense against a prescription.`,
              );
            }
          }
          if (product.isAgeRestricted && !input.ageConfirmed) {
            throw new BadRequestException(
              `${product.genericName} may not be sold without confirming the buyer is at least ` +
                `${product.minimumAgeYears ?? 18}. Confirm the age check and try again.`,
            );
          }

          const units = await tx.productUnit.findMany({ where: { productId: line.productId } });
          const unit = line.unitCode
            ? units.find((u) => u.code === line.unitCode)
            : units.find((u) => u.isBaseUnit);
          if (line.unitCode && !unit) {
            throw new BadRequestException(`Unit "${line.unitCode}" is not defined for ${product.genericName}`);
          }
          const quantity = line.quantity * (unit ? Number(unit.factorToBase) : 1);
          if (quantity <= 0) throw new BadRequestException('Quantity must be greater than zero');

          // §32: price comes from the pricing engine, never from
          // product.retailPrice directly, so branch, contract, promotional and
          // customer-group pricing all apply at the till.
          const priced = await this.pricing.resolve({
            productId: line.productId,
            quantity,
            branchId: input.branchId,
            patientId: input.patientId ?? null,
            channel: 'RETAIL',
          });
          let unitPrice = new Prisma.Decimal(priced.unitPrice);

          // A price agreed at the counter overrides the pricing engine, but
          // only for somebody allowed to agree it, and never silently: the
          // engine's price and the reason both go into the audit entry.
          if (line.priceOverride !== undefined) {
            if (!user.permissions.includes('catalog.price.EDIT')) {
              throw new ForbiddenException(
                `Overriding the price of ${product.genericName} needs the pricing permission`,
              );
            }
            if (!line.priceOverrideReason?.trim()) {
              throw new BadRequestException('A price override must state why');
            }
            const override = new Prisma.Decimal(line.priceOverride);
            if (override.lessThan(0)) {
              throw new BadRequestException('An overridden price cannot be negative');
            }
            priceOverrides.push({
              product: product.genericName,
              from: unitPrice.toFixed(2),
              to: override.toFixed(2),
              reason: line.priceOverrideReason.trim(),
            });
            unitPrice = override;
          }

          // §65: the discount ceiling is configured, not hardcoded.
          const discountPct = new Prisma.Decimal(line.discountPct ?? 0);
          if (discountPct.greaterThan(0)) {
            const maxDiscount = new Prisma.Decimal(
              await this.config.getNumber('pos.maxDiscountPercent'),
            ).dividedBy(100);
            if (discountPct.greaterThan(maxDiscount)) {
              if (!user.permissions.includes('sales.sale.APPROVE')) {
                throw new ForbiddenException(
                  `A discount of ${discountPct.times(100).toFixed(1)}% exceeds the ${maxDiscount
                    .times(100)
                    .toFixed(1)}% ceiling and needs supervisor approval`,
                );
              }
            }
          }

          const candidates = await this.fefo.loadCandidates(line.productId, input.warehouseId, tx);
          const recommended = recommendBatch(candidates, { warehouseId: input.warehouseId });

          let allocations;
          let overrideReason: string | null = null;

          if (line.batchId) {
            const chosen = candidates.find((c) => c.batchId === line.batchId);
            if (!chosen) throw new BadRequestException('Selected batch holds no stock here');
            const check = allocateFefo(quantity, [chosen], { warehouseId: input.warehouseId });
            if (!check.fullyAllocated) {
              throw new ConflictException(
                `Selected batch cannot supply ${quantity}: ${check.excluded[0]?.reason ?? 'insufficient stock'}`,
              );
            }
            if (recommended && recommended.batchId !== line.batchId) {
              if (!line.overrideReason?.trim()) {
                throw new BadRequestException(
                  `Batch ${chosen.batchNumber} is not the FEFO recommendation; a reason is required`,
                );
              }
              overrideReason = line.overrideReason.trim();
            }
            allocations = check.allocations;
          } else {
            const result = allocateFefo(quantity, candidates, { warehouseId: input.warehouseId });
            if (!result.fullyAllocated) {
              throw new ConflictException(
                `Insufficient stock for ${product.genericName}: ${result.allocatedQuantity} of ${quantity} available`,
              );
            }
            allocations = result.allocations;
          }

          for (const allocation of allocations) {
            await this.ledger.post(tx, {
              type: TransactionType.SALE,
              direction: 'OUT',
              productId: line.productId,
              batchId: allocation.batchId,
              warehouseId: input.warehouseId,
              locationId: allocation.locationId,
              branchId: input.branchId,
              quantity: allocation.quantity,
              unitCost: allocation.unitCost,
              referenceType: 'SALE',
              referenceId: created.id,
              referenceNo: saleNo,
              performedById: user.id,
              reason: overrideReason ? `FEFO override: ${overrideReason}` : undefined,
              idempotencyKey: input.idempotencyKey
                ? `${input.idempotencyKey}:${line.productId}:${allocation.batchId}`
                : undefined,
            });

            // The batch FEFO picked may be close to expiry. That is correct —
            // it is the one that should go first — but the customer is buying
            // it, so the receipt and the till both have to say so.
            const allocatedBatch = candidates.find((c) => c.batchId === allocation.batchId);
            if (allocatedBatch) {
              const daysRemaining = Math.floor(
                (new Date(allocatedBatch.expiryDate).getTime() - Date.now()) / 86_400_000,
              );
              if (daysRemaining <= nearExpiryDays) {
                nearExpiryLines.push({
                  product: product.genericName,
                  batchNumber: allocatedBatch.batchNumber,
                  daysRemaining,
                });
              }
            }

            const qty = new Prisma.Decimal(allocation.quantity);
            const gross = qty.times(unitPrice);
            const discount = gross.times(discountPct);
            const net = gross.minus(discount);
            const tax = net.times(product.taxRate);
            const cost = qty.times(allocation.unitCost);

            subtotal = subtotal.plus(gross);
            discountTotal = discountTotal.plus(discount);
            taxTotal = taxTotal.plus(tax);
            costTotal = costTotal.plus(cost);

            await tx.saleItem.create({
              data: {
                saleId: created.id,
                productId: line.productId,
                batchId: allocation.batchId,
                quantity: qty,
                unitPrice,
                unitCost: new Prisma.Decimal(allocation.unitCost),
                discountPct,
                taxRate: product.taxRate,
                lineTotal: net.plus(tax),
                fefoRecommendedBatchId: recommended?.batchId ?? null,
                overrideReason,
              },
            });
          }
        }

        // A discount on the whole sale, applied after the line discounts and
        // subject to the same ceiling. Kept separate from the line discounts so
        // a receipt can show which was which.
        if (input.saleDiscountPct) {
          const salePct = new Prisma.Decimal(input.saleDiscountPct);
          if (salePct.lessThan(0) || salePct.greaterThan(1)) {
            throw new BadRequestException('A sale discount is a fraction between 0 and 1');
          }
          const ceiling = new Prisma.Decimal(
            await this.config.getNumber('pos.maxDiscountPercent'),
          ).dividedBy(100);
          if (salePct.greaterThan(ceiling) && !user.permissions.includes('sales.sale.APPROVE')) {
            throw new ForbiddenException(
              `A sale discount of ${salePct.times(100).toFixed(1)}% exceeds the ` +
                `${ceiling.times(100).toFixed(1)}% ceiling and needs supervisor approval`,
            );
          }
          const saleDiscount = subtotal.minus(discountTotal).times(salePct);
          discountTotal = discountTotal.plus(saleDiscount);
        }

        const grandTotal = subtotal.minus(discountTotal).plus(taxTotal);

        // Selling on account puts money on the customer's balance, so the
        // limit has to hold here rather than being discovered at month end.
        const onAccount = input.payments
          .filter((p) => p.method === PaymentMethod.CREDIT)
          .reduce((sum, p) => sum.plus(new Prisma.Decimal(p.amount)), new Prisma.Decimal(0));
        if (onAccount.greaterThan(0)) {
          if (!input.patientId) {
            throw new BadRequestException(
              'A credit sale needs a customer — an account sale with nobody to bill is not a sale',
            );
          }
          const account = await tx.patient.findUniqueOrThrow({
            where: { id: input.patientId },
            select: { fullName: true, creditLimit: true, creditBalance: true },
          });
          // A limit of zero means no credit was agreed, and an account sale is
          // refused. This is deliberately the opposite of the supplier rule,
          // where zero means no ceiling: a supplier is onboarded deliberately,
          // whereas a walk-in customer is created at the counter in seconds,
          // and defaulting them to unlimited credit would hand the pharmacy's
          // stock to anyone willing to give a name.
          if (!account.creditLimit.greaterThan(0)) {
            throw new BadRequestException(
              `${account.fullName} has no credit limit agreed, so this sale cannot go on account. ` +
                `Set a limit on their record first, or take payment now.`,
            );
          }
          const after = account.creditBalance.plus(onAccount);
          if (after.greaterThan(account.creditLimit)) {
            throw new BadRequestException(
              `${account.fullName} would owe ${after.toFixed(2)} against a credit limit of ` +
                `${account.creditLimit.toFixed(2)}. Take payment or raise the limit.`,
            );
          }
        }

        const paid = input.payments.reduce(
          (sum, p) => sum.plus(new Prisma.Decimal(p.amount)),
          new Prisma.Decimal(0),
        );

        // Allow rounding to the smallest coin, reject real underpayment.
        if (paid.lessThan(grandTotal.minus(0.01))) {
          throw new BadRequestException(
            `Payment of ${paid.toFixed(2)} does not cover the total of ${grandTotal.toFixed(2)}`,
          );
        }

        // No payment gateway is integrated (§35: the interface exists, the
        // connection does not). A card or mobile-money payment is therefore
        // captured on a separate terminal and recorded here after the fact,
        // which is how a pharmacy with a standalone card machine actually
        // works — but it means this system has no confirmation of its own.
        //
        // The reference from that terminal is what makes the payment
        // reconcilable, so it is required rather than optional. Accepting a
        // card payment with nothing to trace it by would be recording a
        // settlement that cannot be checked against anything.
        for (const payment of input.payments) {
          const needsReference =
            payment.method !== PaymentMethod.CASH && payment.method !== PaymentMethod.CREDIT;
          if (needsReference && !payment.reference?.trim()) {
            throw new BadRequestException(
              `A ${payment.method.toLowerCase().replace('_', ' ')} payment needs the reference from ` +
                'the terminal or transfer that took it. No payment gateway is connected, so this ' +
                'system cannot confirm the settlement itself.',
            );
          }

          await tx.payment.create({
            data: {
              saleId: created.id,
              method: payment.method,
              amount: new Prisma.Decimal(payment.amount),
              reference: payment.reference?.trim() || null,
            },
          });
        }

        const finalized = await tx.sale.update({
          where: { id: created.id },
          data: {
            status: SaleStatus.COMPLETED,
            subtotal,
            discountTotal,
            taxTotal,
            grandTotal,
            costTotal,
            soldAt: new Date(),
          },
        });

        if (input.cashSessionId) {
          // What reaches the drawer is what the sale was worth in cash, not
          // what the customer handed over: the change goes straight back out.
          const cashTendered = input.payments
            .filter((p) => p.method === PaymentMethod.CASH)
            .reduce((sum, p) => sum.plus(new Prisma.Decimal(p.amount)), new Prisma.Decimal(0));
          const nonCash = input.payments
            .filter((p) => p.method !== PaymentMethod.CASH)
            .reduce((sum, p) => sum.plus(new Prisma.Decimal(p.amount)), new Prisma.Decimal(0));
          const cashApplied = Prisma.Decimal.min(cashTendered, grandTotal.minus(nonCash));
          if (cashApplied.greaterThan(0)) {
            await tx.cashSession.update({
              where: { id: input.cashSessionId },
              data: { cashSales: { increment: cashApplied } },
            });
          }
        }

        // Selling on account moves the balance; loyalty accrues on what was
        // actually paid for, net of discount.
        if (input.patientId) {
          if (onAccount.greaterThan(0)) {
            await tx.patient.update({
              where: { id: input.patientId },
              data: { creditBalance: { increment: onAccount } },
            });
          }
          const pointsPerUnit = await this.config.getNumber('pos.loyaltyPointsPerCurrencyUnit');
          if (pointsPerUnit > 0) {
            const points = Math.floor(Number(grandTotal) * pointsPerUnit);
            if (points > 0) {
              await tx.patient.update({
                where: { id: input.patientId },
                data: { loyaltyPoints: { increment: points } },
              });
            }
          }
        }

        if (input.idempotencyKey) {
          await tx.idempotencyKey.create({
            data: { key: input.idempotencyKey, scope: 'SALE', resultId: created.id },
          });
        }

        priceOverridesForAudit = priceOverrides;
        warningsForReceipt = nearExpiryLines.map(
          (l) =>
            `${l.product} batch ${l.batchNumber} expires in ${l.daysRemaining} day(s) — ` +
            `tell the customer before they leave`,
        );
        tenderedForReceipt = input.payments
          .filter((p) => p.method === PaymentMethod.CASH)
          .reduce((sum, p) => sum.plus(new Prisma.Decimal(p.amount)), new Prisma.Decimal(0));
        const nonCashTotal = input.payments
          .filter((p) => p.method !== PaymentMethod.CASH)
          .reduce((sum, p) => sum.plus(new Prisma.Decimal(p.amount)), new Prisma.Decimal(0));
        changeDueForReceipt = Prisma.Decimal.max(
          new Prisma.Decimal(0),
          tenderedForReceipt.plus(nonCashTotal).minus(grandTotal),
        );

        return finalized;
      },
      { timeout: 30_000 },
    );

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'sales',
      action: 'SALE',
      entityType: 'Sale',
      entityId: sale.id,
      newValue: {
        saleNo: sale.saleNo,
        total: sale.grandTotal.toString(),
        // A price agreed at the counter is exactly the thing an auditor looks
        // for, so it goes in the audit entry rather than only on the line.
        ...(priceOverridesForAudit.length ? { priceOverrides: priceOverridesForAudit } : {}),
      },
      reason: priceOverridesForAudit.length
        ? priceOverridesForAudit.map((o) => `${o.product}: ${o.reason}`).join('; ')
        : undefined,
      branchId: input.branchId,
    });

    const receipt = await this.findOne(sale.id);
    return {
      ...receipt,
      // What the till needs to tell the customer, computed once here rather
      // than re-derived by every client.
      tendered: tenderedForReceipt.toFixed(2),
      changeDue: changeDueForReceipt.toFixed(2),
      warnings: warningsForReceipt,
    };
  }

  /**
   * Hold a cart (§22). Stock is reserved while the sale is parked, so a held
   * cart cannot be undercut by another till selling the same last units — and
   * the reservation is released when it is resumed or abandoned.
   */
  async holdCart(input: CheckoutInput, user: AuthenticatedUser) {
    if (!input.lines?.length) throw new BadRequestException('There is nothing to hold');
    this.scope.assertBranch(user, input.branchId);

    return this.prisma.$transaction(async (tx) => {
      const saleNo = await this.docNumbers.next(tx, 'SALE');
      const sale = await tx.sale.create({
        data: {
          saleNo,
          branchId: input.branchId,
          warehouseId: input.warehouseId,
          cashSessionId: input.cashSessionId ?? null,
          patientId: input.patientId ?? null,
          cashierId: user.id,
          status: SaleStatus.HELD,
        },
      });

      for (const line of input.lines) {
        const product = await tx.product.findUniqueOrThrow({
          where: { id: line.productId },
          select: { retailPrice: true, taxRate: true, averageCost: true },
        });
        const priced = await this.pricing.resolve({
          productId: line.productId,
          quantity: line.quantity,
          branchId: input.branchId,
          patientId: input.patientId ?? null,
          channel: 'RETAIL',
        });
        const unitPrice = new Prisma.Decimal(priced.unitPrice);

        const candidates = await this.fefo.loadCandidates(line.productId, input.warehouseId, tx);
        const allocation = allocateFefo(line.quantity, candidates, {
          warehouseId: input.warehouseId,
        });
        if (!allocation.fullyAllocated) {
          throw new ConflictException(
            `Cannot hold ${line.quantity}: only ${allocation.allocatedQuantity} available`,
          );
        }

        for (const part of allocation.allocations) {
          // Reserve rather than move: the stock has not left yet.
          await this.ledger.reserve(tx, {
            productId: line.productId,
            batchId: part.batchId,
            warehouseId: input.warehouseId,
            quantity: part.quantity,
            referenceType: 'HELD_SALE',
            referenceId: sale.id,
            createdById: user.id,
          });

          await tx.saleItem.create({
            data: {
              saleId: sale.id,
              productId: line.productId,
              batchId: part.batchId,
              quantity: new Prisma.Decimal(part.quantity),
              unitPrice,
              unitCost: new Prisma.Decimal(part.unitCost),
              taxRate: product.taxRate,
              lineTotal: new Prisma.Decimal(part.quantity).times(unitPrice),
            },
          });
        }
      }

      return tx.sale.findUniqueOrThrow({ where: { id: sale.id }, include: { items: true } });
    });
  }

  async listHeld(branchId: string) {
    return this.prisma.sale.findMany({
      where: { branchId, status: SaleStatus.HELD },
      include: { items: true, patient: { select: { fullName: true, patientCode: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Resume a held cart: release its reservations and hand the lines back. */
  async resumeCart(id: string, user: AuthenticatedUser) {
    const sale = await this.prisma.sale.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });
    if (sale.status !== SaleStatus.HELD) {
      throw new ConflictException(`Sale ${sale.saleNo} is ${sale.status}, not held`);
    }
    this.scope.assertBranch(user, sale.branchId);

    await this.prisma.$transaction(async (tx) => {
      await this.ledger.releaseReservations(tx, 'HELD_SALE', sale.id);
      await tx.sale.update({
        where: { id },
        data: { status: SaleStatus.VOIDED, voidedAt: new Date(), voidReason: 'Cart resumed at the till' },
      });
    });

    await this.audit.record({
      userId: user.id,
      module: 'sales',
      action: 'CART_RESUMED',
      entityType: 'Sale',
      entityId: id,
      newValue: { saleNo: sale.saleNo },
      branchId: sale.branchId,
    });

    // Hand back the cart contents for the till to reload.
    return {
      saleNo: sale.saleNo,
      patientId: sale.patientId,
      lines: sale.items.map((i) => ({
        productId: i.productId,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
      })),
    };
  }

  async abandonHeld(id: string, user: AuthenticatedUser) {
    const sale = await this.prisma.sale.findUniqueOrThrow({ where: { id } });
    if (sale.status !== SaleStatus.HELD) {
      throw new ConflictException('Only a held cart can be abandoned');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.ledger.releaseReservations(tx, 'HELD_SALE', id);
      await tx.sale.update({
        where: { id },
        data: { status: SaleStatus.VOIDED, voidedAt: new Date(), voidReason: 'Held cart abandoned' },
      });
    });
    await this.audit.record({
      userId: user.id,
      module: 'sales',
      action: 'CART_ABANDONED',
      entityType: 'Sale',
      entityId: id,
      branchId: sale.branchId,
    });
    return { success: true };
  }

  /**
   * Partial refund (§22). Returns the exact batches that were sold, so the
   * refunded units go back to the batch they came from rather than to whatever
   * FEFO would pick — otherwise a refund could silently move stock between
   * batches and corrupt expiry tracking.
   */
  async refund(
    id: string,
    input: { lines: Array<{ saleItemId: string; quantity: number }>; reason: string; method?: PaymentMethod },
    user: AuthenticatedUser,
  ) {
    if (!input.reason?.trim()) throw new BadRequestException('A refund reason is required');
    if (!input.lines?.length) throw new BadRequestException('Nothing to refund');

    const sale = await this.prisma.sale.findUniqueOrThrow({
      where: { id },
      include: { items: true, payments: true },
    });
    if (![SaleStatus.COMPLETED, SaleStatus.PARTIALLY_REFUNDED].includes(sale.status as any)) {
      throw new ConflictException(`Sale is ${sale.status} and cannot be refunded`);
    }
    this.scope.assertBranch(user, sale.branchId);

    // How much of each line has already gone back.
    const priorRefunds = await this.prisma.payment.findMany({
      where: { saleId: id, amount: { lt: 0 } },
    });

    let refundTotal = new Prisma.Decimal(0);

    await this.prisma.$transaction(async (tx) => {
      for (const line of input.lines) {
        const item = sale.items.find((i) => i.id === line.saleItemId);
        if (!item) throw new BadRequestException(`Line ${line.saleItemId} is not on this sale`);
        if (line.quantity <= 0) continue;
        if (new Prisma.Decimal(line.quantity).greaterThan(item.quantity)) {
          throw new BadRequestException(
            `Cannot refund ${line.quantity} of ${item.quantity.toString()} sold on that line`,
          );
        }

        // Back to the same batch it left from.
        await this.ledger.post(tx, {
          type: TransactionType.RETURN_IN,
          direction: 'IN',
          productId: item.productId,
          batchId: item.batchId,
          warehouseId: sale.warehouseId,
          branchId: sale.branchId,
          quantity: line.quantity,
          unitCost: item.unitCost,
          referenceType: 'SALE_REFUND',
          referenceId: sale.id,
          referenceNo: sale.saleNo,
          reason: `Refund: ${input.reason}`,
          performedById: user.id,
          allowBlockedStatus: true,
        });

        const gross = new Prisma.Decimal(line.quantity).times(item.unitPrice);
        const net = gross.minus(gross.times(item.discountPct));
        refundTotal = refundTotal.plus(net.plus(net.times(item.taxRate)));
      }

      // A refund is recorded as a negative payment, so the till reconciles.
      await tx.payment.create({
        data: {
          saleId: id,
          method: input.method ?? sale.payments[0]?.method ?? 'CASH',
          amount: refundTotal.negated(),
          reference: `Refund: ${input.reason}`.slice(0, 200),
        },
      });

      const refundedSoFar = priorRefunds
        .reduce((sum, p) => sum.plus(p.amount.abs()), new Prisma.Decimal(0))
        .plus(refundTotal);

      await tx.sale.update({
        where: { id },
        data: {
          status: refundedSoFar.greaterThanOrEqualTo(sale.grandTotal)
            ? SaleStatus.REFUNDED
            : SaleStatus.PARTIALLY_REFUNDED,
        },
      });

      if (sale.cashSessionId) {
        await tx.cashSession.update({
          where: { id: sale.cashSessionId },
          data: { refunds: { increment: refundTotal } },
        });
      }
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'sales',
      action: 'REFUND',
      entityType: 'Sale',
      entityId: id,
      newValue: { saleNo: sale.saleNo, amount: refundTotal.toString(), lines: input.lines.length },
      reason: input.reason,
      branchId: sale.branchId,
    });

    return this.findOne(id);
  }

  /** The cashier's own open session, for the till header. */
  async currentSession(user: AuthenticatedUser, branchId: string) {
    return this.prisma.cashSession.findFirst({
      where: { branchId, cashierId: user.id, isOpen: true },
      include: { sales: { select: { grandTotal: true, status: true } } },
    });
  }

  async findOne(id: string) {
    return this.prisma.sale.findUniqueOrThrow({
      where: { id },
      include: { items: true, payments: true, patient: { select: { fullName: true, patientCode: true } } },
    });
  }

  /** Void a completed sale and return the exact batches to stock (§26). */
  async voidSale(id: string, reason: string, user: AuthenticatedUser) {
    if (!reason?.trim()) throw new BadRequestException('A void reason is required');

    const sale = await this.prisma.sale.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });
    if (sale.status !== SaleStatus.COMPLETED) {
      throw new ConflictException(`Only completed sales can be voided; this one is ${sale.status}`);
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of sale.items) {
        await this.ledger.post(tx, {
          type: TransactionType.RETURN_IN,
          direction: 'IN',
          productId: item.productId,
          batchId: item.batchId,
          warehouseId: sale.warehouseId,
          branchId: sale.branchId,
          quantity: item.quantity,
          unitCost: item.unitCost,
          referenceType: 'SALE_VOID',
          referenceId: sale.id,
          referenceNo: sale.saleNo,
          reason: `Sale voided: ${reason}`,
          performedById: user.id,
        });
      }
      await tx.sale.update({
        where: { id },
        data: { status: SaleStatus.VOIDED, voidedAt: new Date(), voidReason: reason },
      });
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'sales',
      action: 'VOID',
      entityType: 'Sale',
      entityId: id,
      previousValue: { status: sale.status },
      newValue: { status: SaleStatus.VOIDED },
      reason,
      branchId: sale.branchId,
    });

    return this.findOne(id);
  }

  // ---- Cash sessions (§46) ----

  async openSession(
    input: { branchId: string; openingCash: number; isBlindClose?: boolean },
    user: AuthenticatedUser,
  ) {
    this.scope.assertBranch(user, input.branchId);
    const existing = await this.prisma.cashSession.findFirst({
      where: { branchId: input.branchId, cashierId: user.id, isOpen: true },
    });
    if (existing) {
      throw new ConflictException(`Cash session ${existing.sessionNo} is already open for you`);
    }

    return this.prisma.$transaction(async (tx) => {
      const sessionNo = await this.docNumbers.next(tx, 'CASH');
      return tx.cashSession.create({
        data: {
          sessionNo,
          branchId: input.branchId,
          cashierId: user.id,
          openingCash: new Prisma.Decimal(input.openingCash),
          isBlindClose: input.isBlindClose ?? false,
        },
      });
    });
  }

  async closeSession(
    id: string,
    actualCash: number,
    user: AuthenticatedUser,
    varianceReason?: string,
    /**
     * The drawer counted note by note. "The drawer was 200 short" and "there
     * were no fifties in it" are different investigations, and only the second
     * one points at where the money went.
     */
    denominations?: Record<string, number>,
  ) {
    const session = await this.prisma.cashSession.findUniqueOrThrow({
      where: { id },
      include: { movements: true },
    });
    if (!session.isOpen) throw new ConflictException('This cash session is already closed');
    this.scope.assertBranch(user, session.branchId);

    if (denominations) {
      // A denomination count that does not add up to the figure being declared
      // is a keying error, and accepting it would put a number in the record
      // that the notes in the drawer do not support.
      const counted = Object.entries(denominations).reduce(
        (sum, [note, count]) => sum.plus(new Prisma.Decimal(note).times(count)),
        new Prisma.Decimal(0),
      );
      if (!counted.equals(new Prisma.Decimal(actualCash))) {
        throw new BadRequestException(
          `The denominations add up to ${counted.toFixed(2)}, not the ${Number(actualCash).toFixed(2)} ` +
            `being declared. Recount, or correct the note breakdown.`,
        );
      }
    }

    const expected = session.openingCash
      .plus(session.cashSales)
      .minus(session.refunds)
      .minus(session.cashExpenses)
      // Drops, payouts and float top-ups all change what should be in the
      // drawer. Leaving them out blames the cashier for money a manager took.
      .plus(this.drawerEffect(session.movements));
    const variance = new Prisma.Decimal(actualCash).minus(expected);

    // §46: a material variance must be explained before the shift can close.
    // What counts as material is pharmacy policy, so it is configured (§65).
    const varianceTolerance = new Prisma.Decimal(
      await this.config.getNumber('pos.cashVarianceTolerance'),
    );
    if (variance.abs().greaterThan(varianceTolerance) && !varianceReason?.trim()) {
      throw new BadRequestException(
        `Cash variance of ${variance.toFixed(2)} requires an explanation before closing`,
      );
    }

    const closed = await this.prisma.cashSession.update({
      where: { id },
      data: {
        isOpen: false,
        closedAt: new Date(),
        expectedCash: expected,
        actualCash: new Prisma.Decimal(actualCash),
        variance,
        varianceReason: varianceReason ?? null,
        closedById: user.id,
        denominations: denominations ? (denominations as Prisma.InputJsonValue) : undefined,
      },
    });

    await this.audit.record({
      userId: user.id,
      module: 'sales',
      action: 'CASH_SESSION_CLOSED',
      entityType: 'CashSession',
      entityId: id,
      newValue: {
        expected: expected.toString(),
        actual: String(actualCash),
        variance: variance.toString(),
      },
      reason: varianceReason,
      branchId: session.branchId,
    });

    return closed;
  }

  // ---- Cash movements, shift reports and sale retrieval (§46) ----

  /** DROP and PICKUP take money out of the drawer; the others put it in. */
  private static readonly CASH_MOVEMENT_TYPES = ['DROP', 'PAYOUT', 'FLOAT_IN', 'PICKUP'] as const;

  /**
   * Money in or out of the drawer that is not a sale.
   *
   * Without these the expected drawer figure is wrong the moment anybody takes
   * cash out for any reason, and the variance that follows lands on the
   * cashier who was simply following instructions.
   */
  async recordCashMovement(
    input: {
      cashSessionId: string;
      movementType: string;
      amount: number;
      reason: string;
      witnessedById?: string;
      reference?: string;
    },
    user: AuthenticatedUser,
  ) {
    const movementType = (input.movementType ?? '').toUpperCase();
    if (!(PosService.CASH_MOVEMENT_TYPES as readonly string[]).includes(movementType)) {
      throw new BadRequestException(
        `Movement type must be one of ${PosService.CASH_MOVEMENT_TYPES.join(', ')}`,
      );
    }
    if (!input.reason?.trim()) {
      throw new BadRequestException('Cash leaving or entering the drawer must state why');
    }
    const amount = new Prisma.Decimal(input.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('The amount must be greater than zero; the type sets the direction');
    }

    const session = await this.prisma.cashSession.findUniqueOrThrow({
      where: { id: input.cashSessionId },
    });
    if (!session.isOpen) throw new ConflictException('That shift is already closed');
    this.scope.assertBranch(user, session.branchId);

    const movement = await this.prisma.cashMovement.create({
      data: {
        cashSessionId: session.id,
        movementType,
        amount,
        reason: input.reason.trim(),
        witnessedById: input.witnessedById ?? null,
        reference: input.reference?.trim() || null,
        performedById: user.id,
      },
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'sales',
      action: 'CASH_MOVEMENT',
      entityType: 'CashSession',
      entityId: session.id,
      newValue: { movementType, amount: amount.toFixed(2), sessionNo: session.sessionNo },
      reason: input.reason.trim(),
      branchId: session.branchId,
    });

    return movement;
  }

  /** Net effect of the drawer movements on the cash that should be in it. */
  private drawerEffect(movements: Array<{ movementType: string; amount: Prisma.Decimal }>) {
    return movements.reduce(
      (sum, m) => (m.movementType === 'DROP' || m.movementType === 'PICKUP' || m.movementType === 'PAYOUT'
        ? sum.minus(m.amount)
        : sum.plus(m.amount)),
      new Prisma.Decimal(0),
    );
  }

  /**
   * The shift so far, with no side effects (§46).
   *
   * An X-report is read mid-shift — at a handover, or when a supervisor wants
   * to know where the drawer stands — and must never close anything.
   */
  async shiftReport(cashSessionId: string, user: AuthenticatedUser) {
    const session = await this.prisma.cashSession.findUniqueOrThrow({
      where: { id: cashSessionId },
      include: {
        movements: { orderBy: { occurredAt: 'asc' } },
        sales: {
          where: { status: SaleStatus.COMPLETED },
          include: { payments: true, items: true },
        },
      },
    });
    this.scope.assertBranch(user, session.branchId);

    const byMethod = new Map<string, Prisma.Decimal>();
    for (const sale of session.sales) {
      for (const payment of sale.payments) {
        byMethod.set(
          payment.method,
          (byMethod.get(payment.method) ?? new Prisma.Decimal(0)).plus(payment.amount),
        );
      }
    }

    const grossSales = session.sales.reduce(
      (sum, s) => sum.plus(s.grandTotal),
      new Prisma.Decimal(0),
    );
    const discounts = session.sales.reduce(
      (sum, s) => sum.plus(s.discountTotal),
      new Prisma.Decimal(0),
    );
    const tax = session.sales.reduce((sum, s) => sum.plus(s.taxTotal), new Prisma.Decimal(0));
    const cost = session.sales.reduce((sum, s) => sum.plus(s.costTotal), new Prisma.Decimal(0));
    const movementEffect = this.drawerEffect(session.movements);

    const expectedCash = session.openingCash
      .plus(session.cashSales)
      .minus(session.refunds)
      .minus(session.cashExpenses)
      .plus(movementEffect);

    return {
      sessionNo: session.sessionNo,
      branchId: session.branchId,
      isOpen: session.isOpen,
      openedAt: session.openedAt,
      closedAt: session.closedAt,
      openingCash: session.openingCash.toFixed(2),
      salesCount: session.sales.length,
      lineCount: session.sales.reduce((n, s) => n + s.items.length, 0),
      grossSales: grossSales.toFixed(2),
      discounts: discounts.toFixed(2),
      tax: tax.toFixed(2),
      cost: cost.toFixed(2),
      margin: grossSales.minus(tax).minus(cost).toFixed(2),
      byPaymentMethod: [...byMethod.entries()]
        .map(([method, amount]) => ({ method, amount: amount.toFixed(2) }))
        .sort((a, b) => Number(b.amount) - Number(a.amount)),
      movements: session.movements.map((m) => ({
        id: m.id,
        movementType: m.movementType,
        amount: m.amount.toFixed(2),
        reason: m.reason,
        occurredAt: m.occurredAt,
      })),
      movementEffect: movementEffect.toFixed(2),
      expectedCash: expectedCash.toFixed(2),
      // Withheld on a blind close until the count is in, so the cashier counts
      // the drawer rather than the screen.
      countedCash: session.actualCash?.toFixed(2) ?? null,
      variance: session.closedAt ? session.variance.toFixed(2) : null,
      denominations: session.denominations ?? null,
    };
  }

  /** Today's takings for a branch — the number a manager asks for first. */
  async todaySummary(branchId: string, user: AuthenticatedUser) {
    this.scope.assertBranch(user, branchId);
    const since = new Date();
    since.setHours(0, 0, 0, 0);

    const sales = await this.prisma.sale.findMany({
      where: { branchId, status: SaleStatus.COMPLETED, soldAt: { gte: since } },
      include: { items: true },
    });

    const byProduct = new Map<string, { quantity: Prisma.Decimal; value: Prisma.Decimal }>();
    for (const sale of sales) {
      for (const item of sale.items) {
        const cur = byProduct.get(item.productId) ?? {
          quantity: new Prisma.Decimal(0),
          value: new Prisma.Decimal(0),
        };
        byProduct.set(item.productId, {
          quantity: cur.quantity.plus(item.quantity),
          value: cur.value.plus(item.lineTotal),
        });
      }
    }

    const productIds = [...byProduct.keys()];
    const products = productIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, sku: true, genericName: true, strength: true },
        })
      : [];
    const byId = new Map(products.map((p) => [p.id, p]));

    const takings = sales.reduce((sum, s) => sum.plus(s.grandTotal), new Prisma.Decimal(0));
    return {
      since,
      salesCount: sales.length,
      takings: takings.toFixed(2),
      averageBasket: sales.length ? takings.dividedBy(sales.length).toFixed(2) : '0.00',
      topSellers: [...byProduct.entries()]
        .map(([productId, v]) => ({
          productId,
          sku: byId.get(productId)?.sku ?? productId,
          product: byId.get(productId)
            ? `${byId.get(productId)!.genericName} ${byId.get(productId)!.strength}`.trim()
            : productId,
          quantity: v.quantity.toFixed(2),
          value: v.value.toFixed(2),
        }))
        .sort((a, b) => Number(b.value) - Number(a.value))
        .slice(0, 10),
    };
  }

  /**
   * Find a past sale, so a receipt can be reprinted, voided or returned
   * against without knowing its id.
   */
  async searchSales(
    query: {
      q?: string;
      branchId?: string;
      patientId?: string;
      from?: Date;
      to?: Date;
      page?: number;
      pageSize?: number;
    },
    user: AuthenticatedUser,
  ) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
    if (query.branchId) this.scope.assertBranch(user, query.branchId);

    const where: Prisma.SaleWhereInput = {
      status: { in: [SaleStatus.COMPLETED, SaleStatus.REFUNDED, SaleStatus.VOIDED] },
      ...(query.branchId ? { branchId: query.branchId } : this.scope.branchFilter(user)),
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.q ? { saleNo: { contains: query.q, mode: 'insensitive' } } : {}),
      ...(query.from || query.to
        ? {
            soldAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        include: {
          items: true,
          payments: true,
          patient: { select: { fullName: true, patientCode: true } },
        },
        orderBy: { soldAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.sale.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }
}
