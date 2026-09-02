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

          const units = await tx.productUnit.findMany({ where: { productId: line.productId } });
          const unit = line.unitCode
            ? units.find((u) => u.code === line.unitCode)
            : units.find((u) => u.isBaseUnit);
          if (line.unitCode && !unit) {
            throw new BadRequestException(`Unit "${line.unitCode}" is not defined for ${product.genericName}`);
          }
          const quantity = line.quantity * (unit ? Number(unit.factorToBase) : 1);
          if (quantity <= 0) throw new BadRequestException('Quantity must be greater than zero');

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

            const qty = new Prisma.Decimal(allocation.quantity);
            const gross = qty.times(product.retailPrice);
            const discount = gross.times(new Prisma.Decimal(line.discountPct ?? 0));
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
                unitPrice: product.retailPrice,
                unitCost: new Prisma.Decimal(allocation.unitCost),
                discountPct: new Prisma.Decimal(line.discountPct ?? 0),
                taxRate: product.taxRate,
                lineTotal: net.plus(tax),
                fefoRecommendedBatchId: recommended?.batchId ?? null,
                overrideReason,
              },
            });
          }
        }

        const grandTotal = subtotal.minus(discountTotal).plus(taxTotal);
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

        for (const payment of input.payments) {
          await tx.payment.create({
            data: {
              saleId: created.id,
              method: payment.method,
              amount: new Prisma.Decimal(payment.amount),
              reference: payment.reference ?? null,
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
          const cashPaid = input.payments
            .filter((p) => p.method === PaymentMethod.CASH)
            .reduce((sum, p) => sum + p.amount, 0);
          if (cashPaid > 0) {
            await tx.cashSession.update({
              where: { id: input.cashSessionId },
              data: { cashSales: { increment: new Prisma.Decimal(cashPaid) } },
            });
          }
        }

        if (input.idempotencyKey) {
          await tx.idempotencyKey.create({
            data: { key: input.idempotencyKey, scope: 'SALE', resultId: created.id },
          });
        }

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
      newValue: { saleNo: sale.saleNo, total: sale.grandTotal.toString() },
      branchId: input.branchId,
    });

    return this.findOne(sale.id);
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

  async openSession(input: { branchId: string; openingCash: number }, user: AuthenticatedUser) {
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
        },
      });
    });
  }

  async closeSession(id: string, actualCash: number, user: AuthenticatedUser, varianceReason?: string) {
    const session = await this.prisma.cashSession.findUniqueOrThrow({ where: { id } });
    if (!session.isOpen) throw new ConflictException('This cash session is already closed');

    const expected = session.openingCash
      .plus(session.cashSales)
      .minus(session.refunds)
      .minus(session.cashExpenses);
    const variance = new Prisma.Decimal(actualCash).minus(expected);

    // §46: a material variance must be explained before the shift can close.
    if (variance.abs().greaterThan(new Prisma.Decimal(50)) && !varianceReason?.trim()) {
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
}
