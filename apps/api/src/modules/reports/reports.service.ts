import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { classifyExpiry, daysUntil } from '@pharmacore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthenticatedUser } from '../../common/decorators';
import { ScopeService } from '../../common/guards/scope.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { ExportColumn } from './export.service';

export interface ReportFilters {
  from?: Date;
  to?: Date;
  branchId?: string;
  warehouseId?: string;
  productId?: string;
  supplierId?: string;
  days?: number;
  limit?: number;
}

export interface ReportResult {
  key: string;
  title: string;
  subtitle?: string;
  columns: ExportColumn[];
  rows: any[];
  totals?: Array<[string, string]>;
  meta?: Array<[string, string]>;
}

interface ReportDefinition {
  key: string;
  title: string;
  group: string;
  description: string;
  permission: string;
  columns: ExportColumn[];
  run: (filters: ReportFilters, user: AuthenticatedUser) => Promise<{
    rows: any[];
    totals?: Array<[string, string]>;
    subtitle?: string;
  }>;
}

const money = (n: unknown) =>
  Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Reporting centre (§41).
 *
 * Every report is a definition — title, columns, query — so the same source
 * serves JSON for the screen, CSV and Excel for download, and print-ready HTML,
 * without three implementations drifting apart.
 */
@Injectable()
export class ReportsService {
  private readonly definitions: ReportDefinition[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly analytics: AnalyticsService,
  ) {
    this.definitions = this.buildDefinitions();
  }

  /** Restrict a query to the branches the caller may see. */
  private branchWhere(user: AuthenticatedUser, filters: ReportFilters) {
    if (filters.branchId) return { branchId: filters.branchId };
    return this.scope.isUnscoped(user) ? {} : { branchId: { in: user.branchIds } };
  }

  private dateWhere(filters: ReportFilters, field = 'occurredAt') {
    if (!filters.from && !filters.to) return {};
    return {
      [field]: {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {}),
      },
    };
  }

  catalog() {
    return this.definitions.map((d) => ({
      key: d.key,
      title: d.title,
      group: d.group,
      description: d.description,
      permission: d.permission,
      columns: d.columns.map((c) => ({ key: c.key, label: c.label, type: c.type ?? 'text' })),
    }));
  }

  definitionFor(key: string): ReportDefinition {
    const def = this.definitions.find((d) => d.key === key);
    if (!def) {
      throw new NotFoundException(
        `Unknown report "${key}". Available: ${this.definitions.map((d) => d.key).join(', ')}`,
      );
    }
    return def;
  }

  async run(key: string, filters: ReportFilters, user: AuthenticatedUser): Promise<ReportResult> {
    const def = this.definitionFor(key);
    const { rows, totals, subtitle } = await def.run(filters, user);

    const meta: Array<[string, string]> = [];
    if (filters.from) meta.push(['From', filters.from.toISOString().slice(0, 10)]);
    if (filters.to) meta.push(['To', filters.to.toISOString().slice(0, 10)]);
    if (filters.branchId) {
      const branch = await this.prisma.branch.findUnique({ where: { id: filters.branchId } });
      if (branch) meta.push(['Branch', branch.name]);
    }
    if (filters.warehouseId) {
      const wh = await this.prisma.warehouse.findUnique({ where: { id: filters.warehouseId } });
      if (wh) meta.push(['Warehouse', wh.name]);
    }
    meta.push(['Prepared by', user.fullName]);

    return { key, title: def.title, subtitle, columns: def.columns, rows, totals, meta };
  }

  // ---------------------------------------------------------------
  // Report definitions
  // ---------------------------------------------------------------

  private buildDefinitions(): ReportDefinition[] {
    return [
      // ---- Inventory ----
      {
        key: 'inventory-balance',
        title: 'Inventory Balance',
        group: 'Inventory',
        description: 'On-hand, reserved and available quantity for every batch position.',
        permission: 'inventory.balance.READ',
        columns: [
          { key: 'sku', label: 'SKU' },
          { key: 'product', label: 'Product', width: 200 },
          { key: 'batchNumber', label: 'Batch' },
          { key: 'status', label: 'Status' },
          { key: 'expiryDate', label: 'Expiry', type: 'date' },
          { key: 'onHand', label: 'On hand', type: 'number' },
          { key: 'reserved', label: 'Reserved', type: 'number' },
          { key: 'available', label: 'Available', type: 'number' },
          { key: 'unitCost', label: 'Unit cost', type: 'money' },
          { key: 'value', label: 'Value', type: 'money' },
          { key: 'warehouse', label: 'Warehouse' },
        ],
        run: async (filters, user) => {
          const balances = await this.prisma.inventoryBalance.findMany({
            where: {
              ...this.branchWhere(user, filters),
              ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
              ...(filters.productId ? { productId: filters.productId } : {}),
              onHand: { gt: 0 },
            },
            include: {
              product: true,
              batch: true,
              warehouse: { select: { name: true } },
            },
            orderBy: [{ product: { genericName: 'asc' } }],
          });

          let total = 0;
          const rows = balances.map((b) => {
            const available = Number(b.onHand) - Number(b.reserved);
            const value = Number(b.onHand) * Number(b.product.averageCost);
            total += value;
            return {
              sku: b.product.sku,
              product: `${b.product.genericName} ${b.product.strength}`,
              batchNumber: b.batch?.batchNumber ?? '-',
              status: b.batch?.status ?? '-',
              expiryDate: b.batch?.expiryDate ?? null,
              onHand: Number(b.onHand),
              reserved: Number(b.reserved),
              available,
              unitCost: Number(b.product.averageCost),
              value,
              warehouse: b.warehouse.name,
            };
          });

          return { rows, totals: [['Total inventory value', money(total)]] };
        },
      },

      {
        key: 'stock-ledger',
        title: 'Stock Ledger',
        group: 'Inventory',
        description: 'Every stock movement with its running balance.',
        permission: 'inventory.ledger.READ',
        columns: [
          { key: 'occurredAt', label: 'Date', type: 'date' },
          { key: 'type', label: 'Type' },
          { key: 'sku', label: 'SKU' },
          { key: 'product', label: 'Product', width: 180 },
          { key: 'batchNumber', label: 'Batch' },
          { key: 'quantityIn', label: 'In', type: 'number' },
          { key: 'quantityOut', label: 'Out', type: 'number' },
          { key: 'balanceAfter', label: 'Balance', type: 'number' },
          { key: 'referenceNo', label: 'Reference' },
          { key: 'reason', label: 'Reason', width: 180 },
        ],
        run: async (filters, user) => {
          const rows = await this.prisma.inventoryTransaction.findMany({
            where: {
              ...this.branchWhere(user, filters),
              ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
              ...(filters.productId ? { productId: filters.productId } : {}),
              ...this.dateWhere(filters),
            },
            include: {
              product: { select: { sku: true, genericName: true, strength: true } },
              batch: { select: { batchNumber: true } },
            },
            orderBy: { occurredAt: 'desc' },
            take: filters.limit ?? 5000,
          });

          return {
            rows: rows.map((r) => ({
              occurredAt: r.occurredAt,
              type: r.type,
              sku: r.product.sku,
              product: `${r.product.genericName} ${r.product.strength}`,
              batchNumber: r.batch?.batchNumber ?? '-',
              quantityIn: Number(r.quantityIn),
              quantityOut: Number(r.quantityOut),
              balanceAfter: Number(r.balanceAfter),
              referenceNo: r.referenceNo ?? '-',
              reason: r.reason ?? '',
            })),
          };
        },
      },

      {
        key: 'batch-inventory',
        title: 'Batch Inventory',
        group: 'Inventory',
        description: 'Every batch with received, remaining quantity and quality status.',
        permission: 'inventory.batch.READ',
        columns: [
          { key: 'batchNumber', label: 'Batch' },
          { key: 'product', label: 'Product', width: 200 },
          { key: 'supplier', label: 'Supplier', width: 160 },
          { key: 'manufacturingDate', label: 'Manufactured', type: 'date' },
          { key: 'expiryDate', label: 'Expiry', type: 'date' },
          { key: 'status', label: 'Status' },
          { key: 'receivedQuantity', label: 'Received', type: 'number' },
          { key: 'remaining', label: 'Remaining', type: 'number' },
          { key: 'purchaseCost', label: 'Unit cost', type: 'money' },
          { key: 'value', label: 'Value', type: 'money' },
        ],
        run: async (filters) => {
          const batches = await this.prisma.batch.findMany({
            where: {
              ...(filters.productId ? { productId: filters.productId } : {}),
              ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
            },
            include: {
              product: { select: { genericName: true, strength: true, sku: true } },
              supplier: { select: { companyName: true } },
              balances: { select: { onHand: true } },
            },
            orderBy: { expiryDate: 'asc' },
            take: filters.limit ?? 5000,
          });

          let total = 0;
          const rows = batches.map((b) => {
            const remaining = b.balances.reduce((s, x) => s + Number(x.onHand), 0);
            const value = remaining * Number(b.purchaseCost);
            total += value;
            return {
              batchNumber: b.batchNumber,
              product: `${b.product.genericName} ${b.product.strength}`,
              supplier: b.supplier?.companyName ?? '-',
              manufacturingDate: b.manufacturingDate,
              expiryDate: b.expiryDate,
              status: b.status,
              receivedQuantity: Number(b.receivedQuantity),
              remaining,
              purchaseCost: Number(b.purchaseCost),
              value,
            };
          });

          return { rows, totals: [['Total batch value', money(total)]] };
        },
      },

      {
        key: 'expiry',
        title: 'Expiry Report',
        group: 'Inventory',
        description: 'All stock bucketed by remaining shelf life with the value at risk.',
        permission: 'inventory.expiry.READ',
        columns: [
          { key: 'bucket', label: 'Bucket' },
          { key: 'sku', label: 'SKU' },
          { key: 'product', label: 'Product', width: 200 },
          { key: 'batchNumber', label: 'Batch' },
          { key: 'expiryDate', label: 'Expiry', type: 'date' },
          { key: 'daysRemaining', label: 'Days left', type: 'integer' },
          { key: 'quantity', label: 'Quantity', type: 'number' },
          { key: 'potentialLoss', label: 'Value at risk', type: 'money' },
          { key: 'warehouse', label: 'Warehouse' },
        ],
        run: async (filters, user) => this.expiryRows(filters, user),
      },

      {
        key: 'near-expiry',
        title: 'Near Expiry',
        group: 'Inventory',
        description: 'Stock expiring within the configured horizon (90 days by default).',
        permission: 'inventory.expiry.READ',
        columns: [
          { key: 'sku', label: 'SKU' },
          { key: 'product', label: 'Product', width: 200 },
          { key: 'batchNumber', label: 'Batch' },
          { key: 'expiryDate', label: 'Expiry', type: 'date' },
          { key: 'daysRemaining', label: 'Days left', type: 'integer' },
          { key: 'quantity', label: 'Quantity', type: 'number' },
          { key: 'potentialLoss', label: 'Value at risk', type: 'money' },
          { key: 'warehouse', label: 'Warehouse' },
        ],
        run: async (filters, user) =>
          this.expiryRows({ ...filters, days: filters.days ?? 90 }, user, (r) => r.daysRemaining >= 0),
      },

      {
        key: 'expired-inventory',
        title: 'Expired Inventory',
        group: 'Inventory',
        description: 'Stock already past its expiry date and awaiting disposal.',
        permission: 'inventory.expiry.READ',
        columns: [
          { key: 'sku', label: 'SKU' },
          { key: 'product', label: 'Product', width: 200 },
          { key: 'batchNumber', label: 'Batch' },
          { key: 'expiryDate', label: 'Expired on', type: 'date' },
          { key: 'daysRemaining', label: 'Days ago', type: 'integer' },
          { key: 'quantity', label: 'Quantity', type: 'number' },
          { key: 'potentialLoss', label: 'Write-off value', type: 'money' },
          { key: 'warehouse', label: 'Warehouse' },
        ],
        run: async (filters, user) => this.expiryRows(filters, user, (r) => r.daysRemaining < 0),
      },

      {
        key: 'low-stock',
        title: 'Low Stock',
        group: 'Inventory',
        description: 'Products at or below their reorder level.',
        permission: 'inventory.balance.READ',
        columns: [
          { key: 'sku', label: 'SKU' },
          { key: 'product', label: 'Product', width: 220 },
          { key: 'onHand', label: 'On hand', type: 'number' },
          { key: 'reorderLevel', label: 'Reorder level', type: 'number' },
          { key: 'shortfall', label: 'Shortfall', type: 'number' },
          { key: 'leadTimeDays', label: 'Lead time (d)', type: 'integer' },
          { key: 'preferredSupplier', label: 'Preferred supplier', width: 180 },
        ],
        run: async (filters, user) => this.stockLevelRows(filters, user, 'LOW'),
      },

      {
        key: 'out-of-stock',
        title: 'Out of Stock',
        group: 'Inventory',
        description: 'Active products with no available stock at all.',
        permission: 'inventory.balance.READ',
        columns: [
          { key: 'sku', label: 'SKU' },
          { key: 'product', label: 'Product', width: 220 },
          { key: 'reorderLevel', label: 'Reorder level', type: 'number' },
          { key: 'leadTimeDays', label: 'Lead time (d)', type: 'integer' },
          { key: 'preferredSupplier', label: 'Preferred supplier', width: 180 },
        ],
        run: async (filters, user) => this.stockLevelRows(filters, user, 'OUT'),
      },

      {
        key: 'stock-valuation',
        title: 'Stock Valuation',
        group: 'Inventory',
        description: 'Inventory value per product at weighted-average cost.',
        permission: 'finance.report.READ',
        columns: [
          { key: 'sku', label: 'SKU' },
          { key: 'product', label: 'Product', width: 220 },
          { key: 'category', label: 'Category' },
          { key: 'quantity', label: 'Quantity', type: 'number' },
          { key: 'averageCost', label: 'Avg cost', type: 'money' },
          { key: 'costValue', label: 'Cost value', type: 'money' },
          { key: 'retailValue', label: 'Retail value', type: 'money' },
          { key: 'potentialMargin', label: 'Potential margin', type: 'money' },
        ],
        run: async (filters, user) => {
          const balances = await this.prisma.inventoryBalance.findMany({
            where: { ...this.branchWhere(user, filters), onHand: { gt: 0 } },
            include: { product: { include: { category: { select: { name: true } } } } },
          });

          const byProduct = new Map<string, any>();
          for (const b of balances) {
            const entry = byProduct.get(b.productId) ?? {
              sku: b.product.sku,
              product: `${b.product.genericName} ${b.product.strength}`,
              category: b.product.category?.name ?? '-',
              quantity: 0,
              averageCost: Number(b.product.averageCost),
              retailPrice: Number(b.product.retailPrice),
            };
            entry.quantity += Number(b.onHand);
            byProduct.set(b.productId, entry);
          }

          let cost = 0;
          let retail = 0;
          const rows = Array.from(byProduct.values()).map((e) => {
            const costValue = e.quantity * e.averageCost;
            const retailValue = e.quantity * e.retailPrice;
            cost += costValue;
            retail += retailValue;
            return {
              ...e,
              costValue,
              retailValue,
              potentialMargin: retailValue - costValue,
            };
          });
          rows.sort((a, b) => b.costValue - a.costValue);

          return {
            rows,
            totals: [
              ['Total cost value', money(cost)],
              ['Total retail value', money(retail)],
              ['Potential margin', money(retail - cost)],
            ],
          };
        },
      },

      {
        key: 'inventory-movement',
        title: 'Inventory Movement',
        group: 'Inventory',
        description: 'Quantity in and out per product over the period.',
        permission: 'inventory.ledger.READ',
        columns: [
          { key: 'sku', label: 'SKU' },
          { key: 'product', label: 'Product', width: 220 },
          { key: 'received', label: 'Received', type: 'number' },
          { key: 'issued', label: 'Issued', type: 'number' },
          { key: 'adjusted', label: 'Adjusted', type: 'number' },
          { key: 'wasted', label: 'Expired/disposed', type: 'number' },
          { key: 'net', label: 'Net change', type: 'number' },
        ],
        run: async (filters, user) => {
          const movements = await this.prisma.inventoryTransaction.findMany({
            where: { ...this.branchWhere(user, filters), ...this.dateWhere(filters) },
            include: { product: { select: { sku: true, genericName: true, strength: true } } },
          });

          const byProduct = new Map<string, any>();
          for (const m of movements) {
            const entry = byProduct.get(m.productId) ?? {
              sku: m.product.sku,
              product: `${m.product.genericName} ${m.product.strength}`,
              received: 0,
              issued: 0,
              adjusted: 0,
              wasted: 0,
            };
            const inQty = Number(m.quantityIn);
            const outQty = Number(m.quantityOut);

            if (m.type === 'PURCHASE_RECEIPT' || m.type === 'TRANSFER_IN' || m.type === 'RETURN_IN') {
              entry.received += inQty;
            } else if (m.type === 'SALE' || m.type === 'DISPENSING' || m.type === 'TRANSFER_OUT') {
              entry.issued += outQty;
            } else if (m.type === 'EXPIRY' || m.type === 'DISPOSAL' || m.type === 'DAMAGE') {
              entry.wasted += outQty;
            } else {
              entry.adjusted += inQty - outQty;
            }
            byProduct.set(m.productId, entry);
          }

          const rows = Array.from(byProduct.values()).map((e) => ({
            ...e,
            net: e.received - e.issued + e.adjusted - e.wasted,
          }));
          rows.sort((a, b) => b.issued - a.issued);
          return { rows };
        },
      },

      {
        key: 'stock-transfers',
        title: 'Stock Transfer Report',
        group: 'Inventory',
        description: 'Transfers with dispatched and received quantities.',
        permission: 'inventory.transfer.READ',
        columns: [
          { key: 'transferNo', label: 'Transfer' },
          { key: 'status', label: 'Status' },
          { key: 'from', label: 'From' },
          { key: 'to', label: 'To' },
          { key: 'lines', label: 'Lines', type: 'integer' },
          { key: 'requested', label: 'Requested', type: 'number' },
          { key: 'dispatched', label: 'Dispatched', type: 'number' },
          { key: 'received', label: 'Received', type: 'number' },
          { key: 'dispatchedAt', label: 'Dispatched on', type: 'date' },
        ],
        run: async (filters) => {
          const transfers = await this.prisma.stockTransfer.findMany({
            where: this.dateWhere(filters, 'createdAt'),
            include: { items: true },
            orderBy: { createdAt: 'desc' },
            take: filters.limit ?? 1000,
          });

          const warehouses = await this.prisma.warehouse.findMany({ select: { id: true, name: true } });
          const nameOf = new Map(warehouses.map((w) => [w.id, w.name]));

          return {
            rows: transfers.map((t) => ({
              transferNo: t.transferNo,
              status: t.status,
              from: nameOf.get(t.fromWarehouseId) ?? '-',
              to: nameOf.get(t.toWarehouseId) ?? '-',
              lines: t.items.length,
              requested: t.items.reduce((s, i) => s + Number(i.requestedQty), 0),
              dispatched: t.items.reduce((s, i) => s + Number(i.dispatchedQty), 0),
              received: t.items.reduce((s, i) => s + Number(i.receivedQty), 0),
              dispatchedAt: t.dispatchedAt,
            })),
          };
        },
      },

      {
        key: 'stock-adjustments',
        title: 'Inventory Adjustment Report',
        group: 'Inventory',
        description: 'Manual adjustments with reasons and who approved them.',
        permission: 'inventory.adjustment.READ',
        columns: [
          { key: 'occurredAt', label: 'Date', type: 'date' },
          { key: 'referenceNo', label: 'Reference' },
          { key: 'sku', label: 'SKU' },
          { key: 'product', label: 'Product', width: 200 },
          { key: 'batchNumber', label: 'Batch' },
          { key: 'quantityIn', label: 'Increase', type: 'number' },
          { key: 'quantityOut', label: 'Decrease', type: 'number' },
          { key: 'reason', label: 'Reason', width: 240 },
        ],
        run: async (filters, user) => {
          const rows = await this.prisma.inventoryTransaction.findMany({
            where: {
              ...this.branchWhere(user, filters),
              type: { in: ['ADJUSTMENT', 'STOCK_COUNT', 'DAMAGE'] },
              ...this.dateWhere(filters),
            },
            include: {
              product: { select: { sku: true, genericName: true, strength: true } },
              batch: { select: { batchNumber: true } },
            },
            orderBy: { occurredAt: 'desc' },
            take: filters.limit ?? 2000,
          });

          return {
            rows: rows.map((r) => ({
              occurredAt: r.occurredAt,
              referenceNo: r.referenceNo ?? '-',
              sku: r.product.sku,
              product: `${r.product.genericName} ${r.product.strength}`,
              batchNumber: r.batch?.batchNumber ?? '-',
              quantityIn: Number(r.quantityIn),
              quantityOut: Number(r.quantityOut),
              reason: r.reason ?? '',
            })),
          };
        },
      },

      {
        key: 'count-variance',
        title: 'Stock Count Variance',
        group: 'Inventory',
        description: 'System versus counted quantity, with variance value.',
        permission: 'inventory.count.READ',
        columns: [
          { key: 'countNo', label: 'Count' },
          { key: 'sku', label: 'SKU' },
          { key: 'product', label: 'Product', width: 200 },
          { key: 'batchNumber', label: 'Batch' },
          { key: 'systemQty', label: 'System', type: 'number' },
          { key: 'countedQty', label: 'Counted', type: 'number' },
          { key: 'varianceQty', label: 'Variance', type: 'number' },
          { key: 'variancePct', label: 'Variance %', type: 'number' },
          { key: 'varianceValue', label: 'Variance value', type: 'money' },
          { key: 'reason', label: 'Reason', width: 200 },
        ],
        run: async (filters) => {
          const items = await this.prisma.stockCountItem.findMany({
            where: {
              stockCount: {
                ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
                ...this.dateWhere(filters, 'createdAt'),
              },
            },
            include: {
              stockCount: { select: { countNo: true } },
            },
            take: filters.limit ?? 5000,
          });

          const productIds = Array.from(new Set(items.map((i) => i.productId)));
          const products = await this.prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, sku: true, genericName: true, strength: true },
          });
          const byId = new Map(products.map((p) => [p.id, p]));

          const batchIds = items.map((i) => i.batchId).filter((b): b is string => !!b);
          const batches = await this.prisma.batch.findMany({
            where: { id: { in: batchIds } },
            select: { id: true, batchNumber: true },
          });
          const batchById = new Map(batches.map((b) => [b.id, b.batchNumber]));

          let varianceValue = 0;
          const rows = items.map((i) => {
            const p = byId.get(i.productId);
            const system = Number(i.systemQty);
            const variance = Number(i.varianceQty);
            varianceValue += Number(i.varianceValue);
            return {
              countNo: i.stockCount.countNo,
              sku: p?.sku ?? '-',
              product: p ? `${p.genericName} ${p.strength}` : '-',
              batchNumber: i.batchId ? (batchById.get(i.batchId) ?? '-') : '-',
              systemQty: system,
              countedQty: i.countedQty === null ? null : Number(i.countedQty),
              varianceQty: variance,
              variancePct: system ? Math.round((variance / system) * 10000) / 100 : 0,
              varianceValue: Number(i.varianceValue),
              reason: i.reason ?? '',
            };
          });

          return { rows, totals: [['Net variance value', money(varianceValue)]] };
        },
      },

      // ---- Procurement ----
      {
        key: 'purchases',
        title: 'Purchase Report',
        group: 'Procurement',
        description: 'Purchase orders with values and receipt status.',
        permission: 'procurement.purchase_order.READ',
        columns: [
          { key: 'poNo', label: 'PO' },
          { key: 'supplier', label: 'Supplier', width: 200 },
          { key: 'status', label: 'Status' },
          { key: 'orderDate', label: 'Ordered', type: 'date' },
          { key: 'expectedDate', label: 'Expected', type: 'date' },
          { key: 'lines', label: 'Lines', type: 'integer' },
          { key: 'orderedQty', label: 'Ordered qty', type: 'number' },
          { key: 'receivedQty', label: 'Received qty', type: 'number' },
          { key: 'grandTotal', label: 'Total', type: 'money' },
        ],
        run: async (filters) => {
          const orders = await this.prisma.purchaseOrder.findMany({
            where: {
              ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
              ...(filters.branchId ? { branchId: filters.branchId } : {}),
              ...this.dateWhere(filters, 'createdAt'),
            },
            include: { items: true, supplier: { select: { companyName: true } } },
            orderBy: { createdAt: 'desc' },
            take: filters.limit ?? 1000,
          });

          let total = 0;
          const rows = orders.map((po) => {
            total += Number(po.grandTotal);
            return {
              poNo: po.poNo,
              supplier: po.supplier.companyName,
              status: po.status,
              orderDate: po.orderDate,
              expectedDate: po.expectedDate,
              lines: po.items.length,
              orderedQty: po.items.reduce((s, i) => s + Number(i.orderedQty), 0),
              receivedQty: po.items.reduce((s, i) => s + Number(i.receivedQty), 0),
              grandTotal: Number(po.grandTotal),
            };
          });

          return { rows, totals: [['Total purchase value', money(total)]] };
        },
      },

      {
        key: 'supplier-performance',
        title: 'Supplier Performance',
        group: 'Procurement',
        description: 'Delivery reliability, quality and licence status per supplier.',
        permission: 'procurement.supplier.READ',
        columns: [
          { key: 'code', label: 'Code' },
          { key: 'companyName', label: 'Supplier', width: 220 },
          { key: 'supplierScore', label: 'Score', type: 'number' },
          { key: 'onTimePct', label: 'On time %', type: 'number' },
          { key: 'avgLeadTimeDays', label: 'Avg lead (d)', type: 'number' },
          { key: 'rejectionPct', label: 'Rejects %', type: 'number' },
          { key: 'shortShipmentPct', label: 'Short ship %', type: 'number' },
          { key: 'qualityIncidents', label: 'Incidents', type: 'integer' },
          { key: 'licenceStatus', label: 'Licence' },
        ],
        run: async () => {
          const suppliers = await this.prisma.supplier.findMany({
            where: { isActive: true },
            orderBy: { supplierScore: 'desc' },
          });
          const now = Date.now();
          return {
            rows: suppliers.map((s) => ({
              code: s.code,
              companyName: s.companyName,
              supplierScore: Number(s.supplierScore),
              onTimePct: Math.round(Number(s.onTimeDeliveryRate) * 100),
              avgLeadTimeDays: Number(s.avgLeadTimeDays),
              rejectionPct: Math.round(Number(s.rejectionRate) * 10000) / 100,
              shortShipmentPct: Math.round(Number(s.shortShipmentRate) * 10000) / 100,
              qualityIncidents: s.qualityIncidents,
              licenceStatus: !s.licenseExpiry
                ? 'UNKNOWN'
                : s.licenseExpiry.getTime() < now
                  ? 'EXPIRED'
                  : s.licenseExpiry.getTime() - now < 60 * 86_400_000
                    ? 'EXPIRING SOON'
                    : 'VALID',
            })),
          };
        },
      },

      // ---- Sales ----
      {
        key: 'sales',
        title: 'Sales Report',
        group: 'Sales',
        description: 'Completed sales with revenue, cost and margin.',
        permission: 'sales.sale.READ',
        columns: [
          { key: 'saleNo', label: 'Sale' },
          { key: 'soldAt', label: 'Date', type: 'date' },
          { key: 'lines', label: 'Lines', type: 'integer' },
          { key: 'subtotal', label: 'Subtotal', type: 'money' },
          { key: 'discountTotal', label: 'Discount', type: 'money' },
          { key: 'taxTotal', label: 'Tax', type: 'money' },
          { key: 'grandTotal', label: 'Total', type: 'money' },
          { key: 'costTotal', label: 'Cost', type: 'money' },
          { key: 'profit', label: 'Profit', type: 'money' },
        ],
        run: async (filters, user) => {
          const sales = await this.prisma.sale.findMany({
            where: {
              ...this.branchWhere(user, filters),
              status: 'COMPLETED',
              ...this.dateWhere(filters, 'soldAt'),
            },
            include: { items: true },
            orderBy: { soldAt: 'desc' },
            take: filters.limit ?? 5000,
          });

          let revenue = 0;
          let cost = 0;
          const rows = sales.map((s) => {
            revenue += Number(s.grandTotal);
            cost += Number(s.costTotal);
            return {
              saleNo: s.saleNo,
              soldAt: s.soldAt,
              lines: s.items.length,
              subtotal: Number(s.subtotal),
              discountTotal: Number(s.discountTotal),
              taxTotal: Number(s.taxTotal),
              grandTotal: Number(s.grandTotal),
              costTotal: Number(s.costTotal),
              profit: Number(s.grandTotal) - Number(s.costTotal),
            };
          });

          return {
            rows,
            totals: [
              ['Revenue', money(revenue)],
              ['Cost of goods sold', money(cost)],
              ['Gross profit', money(revenue - cost)],
              ['Gross margin', revenue ? `${(((revenue - cost) / revenue) * 100).toFixed(2)}%` : '0%'],
            ],
          };
        },
      },

      {
        key: 'profitability',
        title: 'Profitability by Product',
        group: 'Sales',
        description: 'Revenue, cost and margin per product over the period.',
        permission: 'finance.report.READ',
        columns: [
          { key: 'sku', label: 'SKU' },
          { key: 'product', label: 'Product', width: 220 },
          { key: 'quantity', label: 'Qty sold', type: 'number' },
          { key: 'revenue', label: 'Revenue', type: 'money' },
          { key: 'cost', label: 'Cost', type: 'money' },
          { key: 'profit', label: 'Profit', type: 'money' },
          { key: 'marginPct', label: 'Margin %', type: 'number' },
        ],
        run: async (filters, user) => {
          const items = await this.prisma.saleItem.findMany({
            where: {
              sale: {
                ...this.branchWhere(user, filters),
                status: 'COMPLETED',
                ...this.dateWhere(filters, 'soldAt'),
              },
            },
            include: { sale: { select: { id: true } } },
            take: filters.limit ?? 20000,
          });

          const productIds = Array.from(new Set(items.map((i) => i.productId)));
          const products = await this.prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, sku: true, genericName: true, strength: true },
          });
          const byId = new Map(products.map((p) => [p.id, p]));

          const agg = new Map<string, any>();
          for (const i of items) {
            const p = byId.get(i.productId);
            const entry = agg.get(i.productId) ?? {
              sku: p?.sku ?? '-',
              product: p ? `${p.genericName} ${p.strength}` : '-',
              quantity: 0,
              revenue: 0,
              cost: 0,
            };
            entry.quantity += Number(i.quantity);
            entry.revenue += Number(i.lineTotal);
            entry.cost += Number(i.quantity) * Number(i.unitCost);
            agg.set(i.productId, entry);
          }

          const rows = Array.from(agg.values()).map((e) => ({
            ...e,
            profit: e.revenue - e.cost,
            marginPct: e.revenue ? Math.round(((e.revenue - e.cost) / e.revenue) * 10000) / 100 : 0,
          }));
          rows.sort((a, b) => b.profit - a.profit);

          return {
            rows,
            totals: [
              ['Total revenue', money(rows.reduce((s, r) => s + r.revenue, 0))],
              ['Total profit', money(rows.reduce((s, r) => s + r.profit, 0))],
            ],
          };
        },
      },

      // ---- Compliance ----
      {
        key: 'controlled-register',
        title: 'Controlled Medicine Register',
        group: 'Compliance',
        description: 'Statutory register of controlled drug receipts and issues.',
        permission: 'dispensing.controlled.READ',
        columns: [
          { key: 'entryNo', label: 'Entry', type: 'integer' },
          { key: 'occurredAt', label: 'Date', type: 'date' },
          { key: 'entryType', label: 'Type' },
          { key: 'product', label: 'Product', width: 200 },
          { key: 'batchNumber', label: 'Batch' },
          { key: 'quantityIn', label: 'Received', type: 'number' },
          { key: 'quantityOut', label: 'Issued', type: 'number' },
          { key: 'runningBalance', label: 'Balance', type: 'number' },
          { key: 'prescriberName', label: 'Prescriber', width: 160 },
          { key: 'reversalReason', label: 'Reversal reason', width: 200 },
        ],
        run: async (filters) => {
          const entries = await this.prisma.controlledRegisterEntry.findMany({
            where: {
              ...(filters.productId ? { productId: filters.productId } : {}),
              ...(filters.branchId ? { branchId: filters.branchId } : {}),
              ...this.dateWhere(filters),
            },
            orderBy: { entryNo: 'asc' },
            take: filters.limit ?? 5000,
          });

          const productIds = Array.from(new Set(entries.map((e) => e.productId)));
          const products = await this.prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, genericName: true, strength: true },
          });
          const byId = new Map(products.map((p) => [p.id, p]));

          const batches = await this.prisma.batch.findMany({
            where: { id: { in: entries.map((e) => e.batchId) } },
            select: { id: true, batchNumber: true },
          });
          const batchById = new Map(batches.map((b) => [b.id, b.batchNumber]));

          return {
            rows: entries.map((e) => {
              const p = byId.get(e.productId);
              return {
                entryNo: e.entryNo,
                occurredAt: e.occurredAt,
                entryType: e.entryType,
                product: p ? `${p.genericName} ${p.strength}` : '-',
                batchNumber: batchById.get(e.batchId) ?? '-',
                quantityIn: Number(e.quantityIn),
                quantityOut: Number(e.quantityOut),
                runningBalance: Number(e.runningBalance),
                prescriberName: e.prescriberName ?? '',
                reversalReason: e.reversalReason ?? '',
              };
            }),
          };
        },
      },

      {
        key: 'recalls',
        title: 'Recall Report',
        group: 'Compliance',
        description: 'Recalls with affected, recovered and outstanding quantities.',
        permission: 'quality.recall.READ',
        columns: [
          { key: 'recallNo', label: 'Recall' },
          { key: 'severity', label: 'Class' },
          { key: 'status', label: 'Status' },
          { key: 'recallDate', label: 'Raised', type: 'date' },
          { key: 'batchNumber', label: 'Batch' },
          { key: 'product', label: 'Product', width: 200 },
          { key: 'inStock', label: 'In stock', type: 'number' },
          { key: 'dispensed', label: 'Dispensed', type: 'number' },
          { key: 'recovered', label: 'Recovered', type: 'number' },
          { key: 'outstanding', label: 'Outstanding', type: 'number' },
          { key: 'reason', label: 'Reason', width: 260 },
        ],
        run: async (filters) => {
          const recalls = await this.prisma.recall.findMany({
            where: this.dateWhere(filters, 'recallDate'),
            include: {
              batches: {
                include: {
                  batch: { include: { product: { select: { genericName: true, strength: true } } } },
                },
              },
            },
            orderBy: { recallDate: 'desc' },
          });

          const rows = recalls.flatMap((r) =>
            r.batches.map((rb) => {
              const affected = Number(rb.quantityInStockAtActivation) + Number(rb.quantityDispensedHistorical);
              const accounted =
                Number(rb.quantityRecovered) + Number(rb.quantityReturned) + Number(rb.quantityDestroyed);
              return {
                recallNo: r.recallNo,
                severity: r.severity,
                status: r.status,
                recallDate: r.recallDate,
                batchNumber: rb.batch.batchNumber,
                product: `${rb.batch.product.genericName} ${rb.batch.product.strength}`,
                inStock: Number(rb.quantityInStockAtActivation),
                dispensed: Number(rb.quantityDispensedHistorical),
                recovered: Number(rb.quantityRecovered),
                outstanding: affected - accounted,
                reason: r.reason,
              };
            }),
          );

          return { rows };
        },
      },

      {
        key: 'cold-chain',
        title: 'Cold Chain Excursions',
        group: 'Compliance',
        description: 'Temperature breaches with duration, affected stock and disposition.',
        permission: 'quality.cold_chain.READ',
        columns: [
          { key: 'excursionNo', label: 'Excursion' },
          { key: 'sensor', label: 'Sensor' },
          { key: 'startedAt', label: 'Started', type: 'date' },
          { key: 'durationMinutes', label: 'Duration (min)', type: 'integer' },
          { key: 'minTempC', label: 'Min C', type: 'number' },
          { key: 'maxTempC', label: 'Max C', type: 'number' },
          { key: 'affectedBatches', label: 'Batches', type: 'integer' },
          { key: 'affectedQuantity', label: 'Quantity', type: 'number' },
          { key: 'disposition', label: 'Disposition' },
          { key: 'investigation', label: 'Investigation', width: 260 },
        ],
        run: async (filters) => {
          const excursions = await this.prisma.temperatureExcursion.findMany({
            where: this.dateWhere(filters, 'startedAt'),
            include: { sensor: { select: { name: true } } },
            orderBy: { startedAt: 'desc' },
          });
          return {
            rows: excursions.map((e) => ({
              excursionNo: e.excursionNo,
              sensor: e.sensor.name,
              startedAt: e.startedAt,
              durationMinutes: e.durationMinutes,
              minTempC: Number(e.minTempC),
              maxTempC: Number(e.maxTempC),
              affectedBatches: e.affectedBatchIds.length,
              affectedQuantity: Number(e.affectedQuantity),
              disposition: e.disposition,
              investigation: e.investigation ?? '',
            })),
          };
        },
      },

      {
        key: 'waste-disposal',
        title: 'Waste & Disposal',
        group: 'Compliance',
        description: 'Disposed stock with method, certificate and cost written off.',
        permission: 'quality.disposal.READ',
        columns: [
          { key: 'disposalNo', label: 'Disposal' },
          { key: 'disposedAt', label: 'Date', type: 'date' },
          { key: 'method', label: 'Method' },
          { key: 'status', label: 'Status' },
          { key: 'lines', label: 'Lines', type: 'integer' },
          { key: 'quantity', label: 'Quantity', type: 'number' },
          { key: 'totalCostValue', label: 'Value', type: 'money' },
          { key: 'certificateNo', label: 'Certificate' },
          { key: 'witnessName', label: 'Witness' },
          { key: 'reason', label: 'Reason', width: 220 },
        ],
        run: async (filters) => {
          const disposals = await this.prisma.disposal.findMany({
            where: this.dateWhere(filters, 'createdAt'),
            include: { items: true },
            orderBy: { createdAt: 'desc' },
          });
          let total = 0;
          const rows = disposals.map((d) => {
            total += Number(d.totalCostValue);
            return {
              disposalNo: d.disposalNo,
              disposedAt: d.disposedAt,
              method: d.method,
              status: d.status,
              lines: d.items.length,
              quantity: d.items.reduce((s, i) => s + Number(i.quantity), 0),
              totalCostValue: Number(d.totalCostValue),
              certificateNo: d.certificateNo ?? '-',
              witnessName: d.witnessName ?? '-',
              reason: d.reason,
            };
          });
          return { rows, totals: [['Total written off', money(total)]] };
        },
      },

      {
        key: 'audit-trail',
        title: 'Audit Trail',
        group: 'Compliance',
        description: 'Who did what, when, with previous and new values.',
        permission: 'audit.log.READ',
        columns: [
          { key: 'sequence', label: 'Seq', type: 'integer' },
          { key: 'createdAt', label: 'When', type: 'date' },
          { key: 'userLabel', label: 'User', width: 160 },
          { key: 'module', label: 'Module' },
          { key: 'action', label: 'Action' },
          { key: 'entityType', label: 'Entity' },
          { key: 'entityId', label: 'Record', width: 200 },
          { key: 'reason', label: 'Reason', width: 240 },
        ],
        run: async (filters) => {
          const rows = await this.prisma.auditLog.findMany({
            where: this.dateWhere(filters, 'createdAt'),
            orderBy: { sequence: 'desc' },
            take: filters.limit ?? 5000,
          });
          return {
            rows: rows.map((r) => ({
              sequence: r.sequence,
              createdAt: r.createdAt,
              userLabel: r.userLabel ?? r.userId ?? 'system',
              module: r.module,
              action: r.action,
              entityType: r.entityType ?? '-',
              entityId: r.entityId ?? '-',
              reason: r.reason ?? '',
            })),
          };
        },
      },

      // ---- Analytics ----
      {
        key: 'dead-stock',
        title: 'Dead Stock',
        group: 'Analytics',
        description: 'Stock with no outbound movement in the chosen window.',
        permission: 'analytics.report.READ',
        columns: [
          { key: 'sku', label: 'SKU' },
          { key: 'name', label: 'Product', width: 220 },
          { key: 'batch', label: 'Batch' },
          { key: 'quantity', label: 'Quantity', type: 'number' },
          { key: 'value', label: 'Value', type: 'money' },
          { key: 'lastMovementAt', label: 'Last movement', type: 'date' },
          { key: 'expiryDate', label: 'Expiry', type: 'date' },
          { key: 'warehouse', label: 'Warehouse' },
          { key: 'recommendedAction', label: 'Recommended action', width: 240 },
        ],
        run: async (filters, user) => {
          const rows = await this.analytics.deadStock(user, filters.days ?? 180);
          return {
            rows,
            subtitle: `No movement in ${filters.days ?? 180} days`,
            totals: [['Dead stock value', money(rows.reduce((s, r) => s + r.value, 0))]],
          };
        },
      },

      {
        key: 'fast-moving',
        title: 'Fast-Moving Products',
        group: 'Analytics',
        description: 'Highest outbound volume over the period.',
        permission: 'analytics.report.READ',
        columns: [
          { key: 'sku', label: 'SKU' },
          { key: 'product', label: 'Product', width: 220 },
          { key: 'quantity', label: 'Quantity issued', type: 'number' },
          { key: 'transactions', label: 'Transactions', type: 'integer' },
        ],
        run: async (filters, user) => this.movementRanking(filters, user, 'desc'),
      },

      {
        key: 'slow-moving',
        title: 'Slow-Moving Products',
        group: 'Analytics',
        description: 'Lowest outbound volume over the period.',
        permission: 'analytics.report.READ',
        columns: [
          { key: 'sku', label: 'SKU' },
          { key: 'product', label: 'Product', width: 220 },
          { key: 'quantity', label: 'Quantity issued', type: 'number' },
          { key: 'transactions', label: 'Transactions', type: 'integer' },
        ],
        run: async (filters, user) => this.movementRanking(filters, user, 'asc'),
      },

      {
        key: 'abc-analysis',
        title: 'ABC Analysis',
        group: 'Analytics',
        description: 'Products classified by share of annual consumption value.',
        permission: 'analytics.report.READ',
        columns: [
          { key: 'abcClass', label: 'Class' },
          { key: 'sku', label: 'SKU' },
          { key: 'name', label: 'Product', width: 220 },
          { key: 'annualConsumptionValue', label: 'Consumption value', type: 'money' },
          { key: 'sharePct', label: 'Share %', type: 'number' },
        ],
        run: async (filters, user) => {
          const rows = await this.analytics.abcXyz(user, 12);
          return { rows };
        },
      },

      {
        key: 'xyz-analysis',
        title: 'XYZ Analysis',
        group: 'Analytics',
        description: 'Products classified by demand predictability, with planning guidance.',
        permission: 'analytics.report.READ',
        columns: [
          { key: 'combinedClass', label: 'Class' },
          { key: 'sku', label: 'SKU' },
          { key: 'name', label: 'Product', width: 200 },
          { key: 'xyzClass', label: 'XYZ' },
          { key: 'coefficientOfVariation', label: 'CV', type: 'number' },
          { key: 'guidance', label: 'Planning guidance', width: 320 },
        ],
        run: async (filters, user) => {
          const rows = await this.analytics.abcXyz(user, 12);
          return { rows };
        },
      },

      {
        key: 'branch-performance',
        title: 'Branch Performance',
        group: 'Analytics',
        description: 'Revenue, profit, inventory value and expiry exposure per branch.',
        permission: 'analytics.report.READ',
        columns: [
          { key: 'branch', label: 'Branch', width: 220 },
          { key: 'sales', label: 'Transactions', type: 'integer' },
          { key: 'revenue', label: 'Revenue', type: 'money' },
          { key: 'cost', label: 'Cost', type: 'money' },
          { key: 'profit', label: 'Profit', type: 'money' },
          { key: 'marginPct', label: 'Margin %', type: 'number' },
          { key: 'inventoryValue', label: 'Inventory value', type: 'money' },
          { key: 'nearExpiryValue', label: 'Near-expiry value', type: 'money' },
        ],
        run: async (filters) => {
          const branches = await this.prisma.branch.findMany({ where: { isActive: true } });
          const rows: any[] = [];

          for (const branch of branches) {
            const sales = await this.prisma.sale.aggregate({
              where: {
                branchId: branch.id,
                status: 'COMPLETED',
                ...this.dateWhere(filters, 'soldAt'),
              },
              _sum: { grandTotal: true, costTotal: true },
              _count: true,
            });

            const balances = await this.prisma.inventoryBalance.findMany({
              where: { branchId: branch.id, onHand: { gt: 0 } },
              include: {
                product: { select: { averageCost: true } },
                batch: { select: { expiryDate: true } },
              },
            });

            let inventoryValue = 0;
            let nearExpiryValue = 0;
            for (const b of balances) {
              const value = Number(b.onHand) * Number(b.product.averageCost);
              inventoryValue += value;
              if (b.batch && daysUntil(b.batch.expiryDate) <= 90) nearExpiryValue += value;
            }

            const revenue = Number(sales._sum.grandTotal ?? 0);
            const cost = Number(sales._sum.costTotal ?? 0);
            rows.push({
              branch: branch.name,
              sales: sales._count,
              revenue,
              cost,
              profit: revenue - cost,
              marginPct: revenue ? Math.round(((revenue - cost) / revenue) * 10000) / 100 : 0,
              inventoryValue,
              nearExpiryValue,
            });
          }

          rows.sort((a, b) => b.revenue - a.revenue);
          return {
            rows,
            totals: [
              ['Group revenue', money(rows.reduce((s, r) => s + r.revenue, 0))],
              ['Group inventory value', money(rows.reduce((s, r) => s + r.inventoryValue, 0))],
            ],
          };
        },
      },

      {
        key: 'prescriptions',
        title: 'Prescription & Dispensing Report',
        group: 'Sales',
        description: 'Prescriptions with dispensing status and prescriber.',
        permission: 'dispensing.prescription.READ',
        columns: [
          { key: 'prescriptionNo', label: 'Prescription' },
          { key: 'prescriptionDate', label: 'Date', type: 'date' },
          { key: 'patient', label: 'Patient', width: 180 },
          { key: 'prescriberName', label: 'Prescriber', width: 180 },
          { key: 'status', label: 'Status' },
          { key: 'items', label: 'Items', type: 'integer' },
          { key: 'prescribedQty', label: 'Prescribed', type: 'number' },
          { key: 'dispensedQty', label: 'Dispensed', type: 'number' },
        ],
        run: async (filters, user) => {
          const prescriptions = await this.prisma.prescription.findMany({
            where: {
              ...this.branchWhere(user, filters),
              ...this.dateWhere(filters, 'prescriptionDate'),
            },
            include: { items: true, patient: { select: { fullName: true, patientCode: true } } },
            orderBy: { prescriptionDate: 'desc' },
            take: filters.limit ?? 2000,
          });

          return {
            rows: prescriptions.map((p) => ({
              prescriptionNo: p.prescriptionNo,
              prescriptionDate: p.prescriptionDate,
              patient: `${p.patient.fullName} (${p.patient.patientCode})`,
              prescriberName: p.prescriberName,
              status: p.status,
              items: p.items.length,
              prescribedQty: p.items.reduce((s, i) => s + Number(i.prescribedQty), 0),
              dispensedQty: p.items.reduce((s, i) => s + Number(i.dispensedQty), 0),
            })),
          };
        },
      },

      {
        key: 'returns',
        title: 'Returns Report',
        group: 'Compliance',
        description: 'Customer, supplier and branch returns with their disposition.',
        permission: 'quality.return.READ',
        columns: [
          { key: 'returnNo', label: 'Return' },
          { key: 'createdAt', label: 'Date', type: 'date' },
          { key: 'type', label: 'Type' },
          { key: 'status', label: 'Status' },
          { key: 'lines', label: 'Lines', type: 'integer' },
          { key: 'quantity', label: 'Quantity', type: 'number' },
          { key: 'dispositions', label: 'Dispositions', width: 240 },
          { key: 'reason', label: 'Reason', width: 220 },
        ],
        run: async (filters) => {
          const returns = await this.prisma.returnDocument.findMany({
            where: this.dateWhere(filters, 'createdAt'),
            include: { items: true },
            orderBy: { createdAt: 'desc' },
          });
          return {
            rows: returns.map((r) => ({
              returnNo: r.returnNo,
              createdAt: r.createdAt,
              type: r.type,
              status: r.status,
              lines: r.items.length,
              quantity: r.items.reduce((s, i) => s + Number(i.quantity), 0),
              dispositions: Array.from(new Set(r.items.map((i) => i.disposition))).join(', '),
              reason: r.reason,
            })),
          };
        },
      },
    ];
  }

  // ---- Shared row builders ----

  private async expiryRows(
    filters: ReportFilters,
    user: AuthenticatedUser,
    predicate?: (row: any) => boolean,
  ) {
    const balances = await this.prisma.inventoryBalance.findMany({
      where: {
        ...this.branchWhere(user, filters),
        ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
        onHand: { gt: 0 },
        batchId: { not: null },
      },
      include: {
        batch: true,
        product: { select: { sku: true, genericName: true, strength: true, averageCost: true } },
        warehouse: { select: { name: true } },
      },
    });

    const now = new Date();
    let rows = balances
      .filter((b) => b.batch)
      .map((b) => {
        const days = daysUntil(b.batch!.expiryDate, now);
        const quantity = Number(b.onHand);
        return {
          bucket: classifyExpiry(b.batch!.expiryDate, now),
          sku: b.product.sku,
          product: `${b.product.genericName} ${b.product.strength}`,
          batchNumber: b.batch!.batchNumber,
          expiryDate: b.batch!.expiryDate,
          daysRemaining: days,
          quantity,
          potentialLoss: quantity * Number(b.product.averageCost),
          warehouse: b.warehouse.name,
        };
      });

    if (filters.days !== undefined) rows = rows.filter((r) => r.daysRemaining <= filters.days!);
    if (predicate) rows = rows.filter(predicate);
    rows.sort((a, b) => a.daysRemaining - b.daysRemaining);

    return {
      rows,
      totals: [['Total value at risk', money(rows.reduce((s, r) => s + r.potentialLoss, 0))]] as Array<[string, string]>,
    };
  }

  private async stockLevelRows(
    filters: ReportFilters,
    user: AuthenticatedUser,
    mode: 'LOW' | 'OUT',
  ) {
    const products = await this.prisma.product.findMany({
      where: { isActive: true },
      include: { supplierLinks: { where: { isPreferred: true }, include: { supplier: true } } },
    });

    const balances = await this.prisma.inventoryBalance.groupBy({
      by: ['productId'],
      where: this.branchWhere(user, filters),
      _sum: { onHand: true },
    });
    const onHandBy = new Map(balances.map((b) => [b.productId, Number(b._sum.onHand ?? 0)]));

    const rows = products
      .map((p) => {
        const onHand = onHandBy.get(p.id) ?? 0;
        return {
          productId: p.id,
          sku: p.sku,
          product: `${p.genericName} ${p.strength}`,
          onHand,
          reorderLevel: Number(p.reorderLevel),
          shortfall: Math.max(0, Number(p.reorderLevel) - onHand),
          leadTimeDays: p.leadTimeDays,
          preferredSupplier: p.supplierLinks[0]?.supplier.companyName ?? '-',
        };
      })
      .filter((r) =>
        mode === 'OUT' ? r.onHand <= 0 : r.reorderLevel > 0 && r.onHand > 0 && r.onHand <= r.reorderLevel,
      );

    rows.sort((a, b) => b.shortfall - a.shortfall);
    return { rows };
  }

  private async movementRanking(
    filters: ReportFilters,
    user: AuthenticatedUser,
    direction: 'asc' | 'desc',
  ) {
    const grouped = await this.prisma.inventoryTransaction.groupBy({
      by: ['productId'],
      where: {
        ...this.branchWhere(user, filters),
        type: { in: ['SALE', 'DISPENSING'] },
        ...this.dateWhere(filters),
      },
      _sum: { quantityOut: true },
      _count: true,
      orderBy: { _sum: { quantityOut: direction } },
      take: filters.limit ?? 50,
    });

    const products = await this.prisma.product.findMany({
      where: { id: { in: grouped.map((g) => g.productId) } },
      select: { id: true, sku: true, genericName: true, strength: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    return {
      rows: grouped.map((g) => {
        const p = byId.get(g.productId);
        return {
          sku: p?.sku ?? '-',
          product: p ? `${p.genericName} ${p.strength}` : '-',
          quantity: Number(g._sum.quantityOut ?? 0),
          transactions: g._count,
        };
      }),
    };
  }
}
