import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * What each trigger looks at, and the fields a condition can test.
 *
 * Declared rather than inferred, so the rule editor can offer real field names
 * with real types instead of asking an administrator to guess.
 */
export interface TriggerField {
  path: string;
  label: string;
  type: 'number' | 'string' | 'boolean' | 'date';
}

export interface TriggerDefinition {
  key: string;
  label: string;
  description: string;
  subjectType: string;
  fields: TriggerField[];
}

export const TRIGGER_DEFINITIONS: TriggerDefinition[] = [
  {
    key: 'BATCH_EXPIRY',
    label: 'Batch approaching or past expiry',
    description: 'Every batch with stock on hand, with the days remaining and the value at risk.',
    subjectType: 'BATCH',
    fields: [
      { path: 'daysToExpiry', label: 'Days until expiry', type: 'number' },
      { path: 'quantityOnHand', label: 'Quantity on hand', type: 'number' },
      { path: 'valueAtRisk', label: 'Stock value at risk', type: 'number' },
      { path: 'batchStatus', label: 'Batch status', type: 'string' },
      { path: 'isColdChain', label: 'Cold chain product', type: 'boolean' },
      { path: 'isControlled', label: 'Controlled medicine', type: 'boolean' },
      { path: 'branchId', label: 'Branch', type: 'string' },
      { path: 'productName', label: 'Product name', type: 'string' },
    ],
  },
  {
    key: 'STOCK_LEVEL',
    label: 'Stock at or below its reorder point',
    description: 'Product positions per branch, with available quantity against the reorder point.',
    subjectType: 'BALANCE',
    fields: [
      { path: 'available', label: 'Available quantity', type: 'number' },
      { path: 'reorderLevel', label: 'Reorder point', type: 'number' },
      { path: 'safetyStock', label: 'Safety stock', type: 'number' },
      { path: 'coverRatio', label: 'Available as a fraction of the reorder point', type: 'number' },
      { path: 'daysOfCover', label: 'Days of cover at current consumption', type: 'number' },
      { path: 'isControlled', label: 'Controlled medicine', type: 'boolean' },
      { path: 'branchId', label: 'Branch', type: 'string' },
      { path: 'productName', label: 'Product name', type: 'string' },
    ],
  },
  {
    key: 'TEMPERATURE_EXCURSION',
    label: 'Open cold-chain excursion',
    description: 'Temperature excursions that have not been closed by a QA disposition.',
    subjectType: 'EXCURSION',
    fields: [
      { path: 'durationMinutes', label: 'Minutes out of range', type: 'number' },
      { path: 'peakTempC', label: 'Peak temperature', type: 'number' },
      { path: 'minTempC', label: 'Lowest temperature', type: 'number' },
      { path: 'affectedBatches', label: 'Batches affected', type: 'number' },
      { path: 'sensorCode', label: 'Sensor', type: 'string' },
      { path: 'disposition', label: 'QA disposition', type: 'string' },
    ],
  },
  {
    key: 'PURCHASE_ORDER_OVERDUE',
    label: 'Purchase order past its expected date',
    description: 'Ordered or partly received purchase orders whose expected date has passed.',
    subjectType: 'PURCHASE_ORDER',
    fields: [
      { path: 'daysLate', label: 'Days late', type: 'number' },
      { path: 'outstandingValue', label: 'Value not yet received', type: 'number' },
      { path: 'percentReceived', label: 'Percent received', type: 'number' },
      { path: 'supplierName', label: 'Supplier', type: 'string' },
      { path: 'branchId', label: 'Branch', type: 'string' },
    ],
  },
  {
    key: 'STOCK_VARIANCE',
    label: 'Stock count variance',
    description: 'Counted lines whose variance exceeds nothing by default; add a condition.',
    subjectType: 'COUNT',
    fields: [
      { path: 'variance', label: 'Variance quantity', type: 'number' },
      { path: 'variancePercent', label: 'Variance percent', type: 'number' },
      { path: 'varianceValue', label: 'Variance value', type: 'number' },
      { path: 'absVariance', label: 'Variance ignoring direction', type: 'number' },
      { path: 'isControlled', label: 'Controlled medicine', type: 'boolean' },
      { path: 'productName', label: 'Product name', type: 'string' },
    ],
  },
  {
    key: 'CONTROLLED_VARIANCE',
    label: 'Controlled register variance',
    description: 'Differences between the controlled register balance and physical stock.',
    subjectType: 'REGISTER',
    fields: [
      { path: 'variance', label: 'Variance', type: 'number' },
      { path: 'absVariance', label: 'Variance ignoring direction', type: 'number' },
      { path: 'registerBalance', label: 'Register balance', type: 'number' },
      { path: 'physicalQuantity', label: 'Physical quantity', type: 'number' },
      { path: 'productName', label: 'Product name', type: 'string' },
    ],
  },
  {
    key: 'SUPPLIER_LICENCE',
    label: 'Supplier licence expiring',
    description: 'Active suppliers whose licence is close to expiry or already expired.',
    subjectType: 'SUPPLIER',
    fields: [
      { path: 'daysToExpiry', label: 'Days until the licence expires', type: 'number' },
      { path: 'isApproved', label: 'Approved supplier', type: 'boolean' },
      { path: 'supplierName', label: 'Supplier', type: 'string' },
    ],
  },
  {
    key: 'QUARANTINED_STOCK',
    label: 'Stock sitting in quarantine',
    description: 'Quarantined batches, with how long they have been held.',
    subjectType: 'BATCH',
    fields: [
      { path: 'daysInQuarantine', label: 'Days held', type: 'number' },
      { path: 'quantityOnHand', label: 'Quantity held', type: 'number' },
      { path: 'valueAtRisk', label: 'Value held', type: 'number' },
      { path: 'quarantineReason', label: 'Reason', type: 'string' },
      { path: 'productName', label: 'Product name', type: 'string' },
    ],
  },
];

export const TRIGGERS_BY_KEY = new Map(TRIGGER_DEFINITIONS.map((t) => [t.key, t]));

/** A subject a rule can act on. */
export interface Subject {
  subjectType: string;
  subjectId: string;
  /** Everything a condition or a template can read. */
  [key: string]: unknown;
}

const day = 86_400_000;
const daysBetween = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / day);

/**
 * Gather the subjects for one trigger.
 *
 * Every query is bounded: a rule that matched a million rows would take the
 * scheduler down, so each source caps what it returns and the run records how
 * many it scanned.
 */
export async function gatherSubjects(
  prisma: PrismaService,
  triggerType: string,
  options: { branchId?: string | null; limit?: number } = {},
): Promise<Subject[]> {
  const limit = Math.min(options.limit ?? 2000, 5000);
  const now = new Date();

  switch (triggerType) {
    case 'BATCH_EXPIRY': {
      const balances = await prisma.inventoryBalance.findMany({
        where: {
          onHand: { gt: 0 },
          batchId: { not: null },
          ...(options.branchId ? { branchId: options.branchId } : {}),
        },
        include: {
          batch: true,
          product: {
            select: {
              id: true,
              genericName: true,
              strength: true,
              averageCost: true,
              baseUnit: true,
              isColdChain: true,
              isControlled: true,
            },
          },
          warehouse: { select: { id: true, code: true, name: true } },
        },
        take: limit,
      });

      return balances
        .filter((b) => b.batch)
        .map((b) => ({
          subjectType: 'BATCH',
          subjectId: b.batchId as string,
          batchId: b.batchId,
          batchNumber: b.batch!.batchNumber,
          batchStatus: b.batch!.status,
          expiryDate: b.batch!.expiryDate,
          daysToExpiry: daysBetween(now, b.batch!.expiryDate),
          quantityOnHand: Number(b.onHand),
          valueAtRisk: Number(b.onHand) * Number(b.product.averageCost),
          productId: b.productId,
          productName: `${b.product.genericName} ${b.product.strength}`,
          baseUnit: b.product.baseUnit,
          isColdChain: b.product.isColdChain,
          isControlled: b.product.isControlled,
          branchId: b.branchId,
          warehouseId: b.warehouseId,
          warehouseName: b.warehouse.name,
        }));
    }

    case 'QUARANTINED_STOCK': {
      const balances = await prisma.inventoryBalance.findMany({
        where: {
          onHand: { gt: 0 },
          batch: { status: 'QUARANTINED' },
          ...(options.branchId ? { branchId: options.branchId } : {}),
        },
        include: {
          batch: true,
          product: { select: { genericName: true, strength: true, averageCost: true } },
        },
        take: limit,
      });

      return balances
        .filter((b) => b.batch)
        .map((b) => ({
          subjectType: 'BATCH',
          subjectId: b.batchId as string,
          batchId: b.batchId,
          batchNumber: b.batch!.batchNumber,
          quarantineReason: b.batch!.quarantineReason ?? 'UNSPECIFIED',
          daysInQuarantine: daysBetween(b.batch!.receivedDate, now),
          quantityOnHand: Number(b.onHand),
          valueAtRisk: Number(b.onHand) * Number(b.product.averageCost),
          productId: b.productId,
          productName: `${b.product.genericName} ${b.product.strength}`,
          branchId: b.branchId,
          warehouseId: b.warehouseId,
        }));
    }

    case 'STOCK_LEVEL': {
      const grouped = await prisma.inventoryBalance.groupBy({
        by: ['productId', 'branchId'],
        where: {
          ...(options.branchId ? { branchId: options.branchId } : {}),
          batch: { status: { in: ['AVAILABLE', 'RELEASED'] } },
        },
        _sum: { onHand: true, reserved: true },
      });

      const products = await prisma.product.findMany({
        where: { id: { in: [...new Set(grouped.map((g) => g.productId))] }, isActive: true },
        select: {
          id: true,
          genericName: true,
          strength: true,
          reorderLevel: true,
          safetyStock: true,
          isControlled: true,
          leadTimeDays: true,
        },
      });
      const byProduct = new Map(products.map((p) => [p.id, p]));

      // Consumption over the last 90 days, to turn a bare quantity into cover.
      const since = new Date(now.getTime() - 90 * day);
      const consumption = await prisma.inventoryTransaction.groupBy({
        by: ['productId', 'branchId'],
        where: {
          occurredAt: { gte: since },
          type: { in: ['SALE', 'DISPENSING'] },
          ...(options.branchId ? { branchId: options.branchId } : {}),
        },
        _sum: { quantityOut: true },
      });
      const usage = new Map(
        consumption.map((c) => [`${c.productId}|${c.branchId}`, Number(c._sum.quantityOut ?? 0) / 90]),
      );

      return grouped
        .filter((g) => byProduct.has(g.productId))
        .slice(0, limit)
        .map((g) => {
          const product = byProduct.get(g.productId)!;
          const available = Number(g._sum.onHand ?? 0) - Number(g._sum.reserved ?? 0);
          const reorderLevel = Number(product.reorderLevel);
          const daily = usage.get(`${g.productId}|${g.branchId}`) ?? 0;

          return {
            subjectType: 'BALANCE',
            subjectId: `${g.productId}:${g.branchId}`,
            productId: g.productId,
            productName: `${product.genericName} ${product.strength}`,
            branchId: g.branchId,
            available,
            reorderLevel,
            safetyStock: Number(product.safetyStock),
            leadTimeDays: product.leadTimeDays,
            isControlled: product.isControlled,
            // Guarded: a product with no reorder point would divide by zero.
            coverRatio: reorderLevel > 0 ? available / reorderLevel : null,
            dailyConsumption: Number(daily.toFixed(4)),
            daysOfCover: daily > 0 ? Math.floor(available / daily) : null,
          };
        });
    }

    case 'TEMPERATURE_EXCURSION': {
      const excursions = await prisma.temperatureExcursion.findMany({
        where: { disposition: 'PENDING' },
        include: { sensor: { select: { code: true, name: true, warehouseId: true } } },
        take: limit,
      });

      return excursions.map((e) => ({
        subjectType: 'EXCURSION',
        subjectId: e.id,
        excursionNo: e.excursionNo,
        sensorCode: e.sensor.code,
        sensorName: e.sensor.name,
        warehouseId: e.sensor.warehouseId,
        startedAt: e.startedAt,
        endedAt: e.endedAt,
        durationMinutes: e.endedAt
          ? Math.round((e.endedAt.getTime() - e.startedAt.getTime()) / 60_000)
          : Math.round((now.getTime() - e.startedAt.getTime()) / 60_000),
        peakTempC: Number(e.maxTempC),
        minTempC: Number(e.minTempC),
        affectedBatches: Array.isArray(e.affectedBatchIds) ? e.affectedBatchIds.length : 0,
        disposition: e.disposition,
      }));
    }

    case 'PURCHASE_ORDER_OVERDUE': {
      const orders = await prisma.purchaseOrder.findMany({
        where: {
          status: { in: ['ORDERED', 'PARTIALLY_RECEIVED'] },
          expectedDate: { lt: now },
          ...(options.branchId ? { branchId: options.branchId } : {}),
        },
        include: { supplier: { select: { companyName: true } }, items: true },
        take: limit,
      });

      return orders.map((po) => {
        const ordered = po.items.reduce((s, i) => s + Number(i.orderedQty), 0);
        const received = po.items.reduce((s, i) => s + Number(i.receivedQty), 0);
        const outstandingValue = po.items.reduce(
          (s, i) => s + (Number(i.orderedQty) - Number(i.receivedQty)) * Number(i.unitPrice),
          0,
        );

        return {
          subjectType: 'PURCHASE_ORDER',
          subjectId: po.id,
          poNo: po.poNo,
          supplierName: po.supplier.companyName,
          supplierId: po.supplierId,
          branchId: po.branchId,
          expectedDate: po.expectedDate,
          daysLate: po.expectedDate ? daysBetween(po.expectedDate, now) : 0,
          percentReceived: ordered > 0 ? Math.round((received / ordered) * 100) : 0,
          outstandingValue,
        };
      });
    }

    case 'STOCK_VARIANCE': {
      const items = await prisma.stockCountItem.findMany({
        where: {
          countedQty: { not: null },
          stockCount: { status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'] } },
        },
        include: {
          stockCount: { select: { countNo: true, warehouseId: true, status: true } },
        },
        orderBy: { id: 'desc' },
        take: limit,
      });

      const countProducts = await prisma.product.findMany({
        where: { id: { in: [...new Set(items.map((i) => i.productId))] } },
        select: { id: true, genericName: true, strength: true, isControlled: true },
      });
      const countByProduct = new Map(countProducts.map((p) => [p.id, p]));

      return items.map((i) => {
        const system = Number(i.systemQty);
        const counted = Number(i.countedQty ?? 0);
        const variance = Number(i.varianceQty);
        const product = countByProduct.get(i.productId);

        return {
          subjectType: 'COUNT',
          subjectId: i.id,
          countNo: i.stockCount.countNo,
          countStatus: i.stockCount.status,
          warehouseId: i.stockCount.warehouseId,
          productId: i.productId,
          productName: product ? `${product.genericName} ${product.strength}` : 'Unknown product',
          isControlled: product?.isControlled ?? false,
          systemQty: system,
          countedQty: counted,
          variance,
          absVariance: Math.abs(variance),
          variancePercent: system > 0 ? Math.abs((variance / system) * 100) : counted > 0 ? 100 : 0,
          varianceValue: Math.abs(Number(i.varianceValue)),
        };
      });
    }

    case 'CONTROLLED_VARIANCE': {
      // The register's running balance against the physical stock of the same
      // product. A difference of any size is a compliance matter (§28).
      const entries = await prisma.controlledRegisterEntry.findMany({
        orderBy: { occurredAt: 'desc' },
        distinct: ['productId'],
        take: limit,
      });

      const productIds = entries.map((e) => e.productId);
      const [physical, registerProducts] = await Promise.all([
        prisma.inventoryBalance.groupBy({
          by: ['productId'],
          where: { productId: { in: productIds } },
          _sum: { onHand: true },
        }),
        prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, genericName: true, strength: true },
        }),
      ]);
      const byProduct = new Map(physical.map((p) => [p.productId, Number(p._sum.onHand ?? 0)]));
      const registerByProduct = new Map(registerProducts.map((p) => [p.id, p]));

      return entries.map((e) => {
        const registerBalance = Number(e.runningBalance);
        const physicalQuantity = byProduct.get(e.productId) ?? 0;
        const variance = physicalQuantity - registerBalance;
        const product = registerByProduct.get(e.productId);

        return {
          subjectType: 'REGISTER',
          subjectId: e.productId,
          productId: e.productId,
          productName: product ? `${product.genericName} ${product.strength}` : 'Unknown product',
          branchId: e.branchId,
          registerBalance,
          physicalQuantity,
          variance,
          absVariance: Math.abs(variance),
          lastEntryAt: e.occurredAt,
        };
      });
    }

    case 'SUPPLIER_LICENCE': {
      const suppliers = await prisma.supplier.findMany({
        where: { isActive: true, licenseExpiry: { not: null } },
        select: {
          id: true,
          companyName: true,
          licenseExpiry: true,
          licenseNumber: true,
          isApproved: true,
        },
        take: limit,
      });

      return suppliers.map((s) => ({
        subjectType: 'SUPPLIER',
        subjectId: s.id,
        supplierName: s.companyName,
        licenseNumber: s.licenseNumber,
        licenseExpiry: s.licenseExpiry,
        daysToExpiry: s.licenseExpiry ? daysBetween(now, s.licenseExpiry) : null,
        isApproved: s.isApproved,
      }));
    }

    default:
      return [];
  }
}
