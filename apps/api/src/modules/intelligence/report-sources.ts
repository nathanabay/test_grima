/**
 * The data sources a report may be built on (§60).
 *
 * A whitelist, not a query language. Every source names the permission needed
 * to read it, the columns that may be selected, and how a branch restriction is
 * applied — so a report cannot reach a table its author could not open
 * directly, and cannot be turned into arbitrary SQL.
 */

export interface ReportColumn {
  key: string;
  label: string;
  type: 'string' | 'number' | 'date' | 'boolean';
  /** Path into the returned row, when it differs from the key. */
  path?: string;
  /** Aggregatable when the report is grouped. */
  numeric?: boolean;
  /** Excluded unless the caller holds this extra permission. */
  requires?: string;
}

export interface ReportSource {
  key: string;
  label: string;
  description: string;
  permission: string;
  /** Prisma model to query. */
  model: string;
  /** How to restrict the query to the caller's branches; null when not scoped. */
  branchPath: string | null;
  /** Relations to include so nested columns resolve. */
  include?: Record<string, unknown>;
  columns: ReportColumn[];
}

export const REPORT_SOURCES: ReportSource[] = [
  {
    key: 'inventory_balances',
    label: 'Stock balances',
    description: 'Current stock by product, batch, warehouse and location.',
    permission: 'inventory.balance.READ',
    model: 'inventoryBalance',
    branchPath: 'branchId',
    include: {
      product: { select: { sku: true, genericName: true, brandName: true, strength: true, averageCost: true, isControlled: true } },
      batch: { select: { batchNumber: true, expiryDate: true, status: true } },
      warehouse: { select: { code: true, name: true } },
      location: { select: { code: true } },
    },
    columns: [
      { key: 'sku', label: 'SKU', type: 'string', path: 'product.sku' },
      { key: 'product', label: 'Product', type: 'string', path: 'product.genericName' },
      { key: 'brand', label: 'Brand', type: 'string', path: 'product.brandName' },
      { key: 'strength', label: 'Strength', type: 'string', path: 'product.strength' },
      { key: 'batchNumber', label: 'Batch', type: 'string', path: 'batch.batchNumber' },
      { key: 'expiryDate', label: 'Expiry', type: 'date', path: 'batch.expiryDate' },
      { key: 'batchStatus', label: 'Batch status', type: 'string', path: 'batch.status' },
      { key: 'warehouse', label: 'Warehouse', type: 'string', path: 'warehouse.name' },
      { key: 'location', label: 'Location', type: 'string', path: 'location.code' },
      { key: 'onHand', label: 'On hand', type: 'number', numeric: true },
      { key: 'reserved', label: 'Reserved', type: 'number', numeric: true },
      // Cost is commercial information, so it needs the finance permission on
      // top of the stock permission.
      { key: 'averageCost', label: 'Average cost', type: 'number', path: 'product.averageCost', numeric: true, requires: 'finance.report.READ' },
      { key: 'lastMovementAt', label: 'Last movement', type: 'date' },
    ],
  },
  {
    key: 'inventory_transactions',
    label: 'Stock ledger',
    description: 'Every stock movement, with its reference document.',
    permission: 'inventory.ledger.READ',
    model: 'inventoryTransaction',
    branchPath: 'branchId',
    include: {
      product: { select: { sku: true, genericName: true, strength: true } },
      batch: { select: { batchNumber: true, expiryDate: true } },
    },
    columns: [
      { key: 'occurredAt', label: 'Date', type: 'date' },
      { key: 'type', label: 'Movement', type: 'string' },
      { key: 'sku', label: 'SKU', type: 'string', path: 'product.sku' },
      { key: 'product', label: 'Product', type: 'string', path: 'product.genericName' },
      { key: 'batchNumber', label: 'Batch', type: 'string', path: 'batch.batchNumber' },
      { key: 'quantityIn', label: 'In', type: 'number', numeric: true },
      { key: 'quantityOut', label: 'Out', type: 'number', numeric: true },
      { key: 'balanceAfter', label: 'Balance after', type: 'number', numeric: true },
      { key: 'unitCost', label: 'Unit cost', type: 'number', numeric: true, requires: 'finance.report.READ' },
      { key: 'referenceNo', label: 'Reference', type: 'string' },
      { key: 'reason', label: 'Reason', type: 'string' },
    ],
  },
  {
    key: 'products',
    label: 'Drug master',
    description: 'The product catalogue with its planning and classification fields.',
    permission: 'catalog.product.READ',
    model: 'product',
    branchPath: null,
    include: { category: { select: { name: true } }, manufacturer: { select: { name: true } } },
    columns: [
      { key: 'sku', label: 'SKU', type: 'string' },
      { key: 'gtin', label: 'GTIN', type: 'string' },
      { key: 'genericName', label: 'Generic name', type: 'string' },
      { key: 'brandName', label: 'Brand', type: 'string' },
      { key: 'strength', label: 'Strength', type: 'string' },
      { key: 'dosageForm', label: 'Form', type: 'string' },
      { key: 'atcCode', label: 'ATC', type: 'string' },
      { key: 'category', label: 'Category', type: 'string', path: 'category.name' },
      { key: 'manufacturer', label: 'Manufacturer', type: 'string', path: 'manufacturer.name' },
      { key: 'requiresPrescription', label: 'Prescription only', type: 'boolean' },
      { key: 'isControlled', label: 'Controlled', type: 'boolean' },
      { key: 'isColdChain', label: 'Cold chain', type: 'boolean' },
      { key: 'reorderLevel', label: 'Reorder point', type: 'number', numeric: true },
      { key: 'maximumStock', label: 'Maximum stock', type: 'number', numeric: true },
      { key: 'retailPrice', label: 'Retail price', type: 'number', numeric: true, requires: 'catalog.price.READ' },
      { key: 'averageCost', label: 'Average cost', type: 'number', numeric: true, requires: 'finance.report.READ' },
      { key: 'isActive', label: 'Active', type: 'boolean' },
    ],
  },
  {
    key: 'sales',
    label: 'Sales',
    description: 'Completed point-of-sale transactions.',
    permission: 'sales.sale.READ',
    model: 'sale',
    branchPath: 'branchId',
    include: { patient: { select: { patientCode: true, fullName: true } } },
    columns: [
      { key: 'saleNo', label: 'Sale number', type: 'string' },
      { key: 'soldAt', label: 'Date', type: 'date' },
      { key: 'status', label: 'Status', type: 'string' },
      { key: 'subtotal', label: 'Subtotal', type: 'number', numeric: true },
      { key: 'discountTotal', label: 'Discount', type: 'number', numeric: true },
      { key: 'taxTotal', label: 'Tax', type: 'number', numeric: true },
      { key: 'grandTotal', label: 'Total', type: 'number', numeric: true },
      { key: 'costTotal', label: 'Cost', type: 'number', numeric: true, requires: 'finance.report.READ' },
      { key: 'patient', label: 'Customer', type: 'string', path: 'patient.fullName', requires: 'sales.patient.READ' },
    ],
  },
  {
    key: 'purchase_orders',
    label: 'Purchase orders',
    description: 'Orders raised on suppliers and how much has been received.',
    permission: 'procurement.purchase_order.READ',
    model: 'purchaseOrder',
    branchPath: 'branchId',
    include: { supplier: { select: { code: true, companyName: true } } },
    columns: [
      { key: 'poNo', label: 'PO number', type: 'string' },
      { key: 'createdAt', label: 'Raised', type: 'date' },
      { key: 'expectedDate', label: 'Expected', type: 'date' },
      { key: 'status', label: 'Status', type: 'string' },
      { key: 'supplier', label: 'Supplier', type: 'string', path: 'supplier.companyName' },
      { key: 'subtotal', label: 'Subtotal', type: 'number', numeric: true },
      { key: 'grandTotal', label: 'Total', type: 'number', numeric: true },
    ],
  },
  {
    key: 'batches',
    label: 'Batches',
    description: 'Batch records with expiry, quality status and supplier.',
    permission: 'inventory.batch.READ',
    model: 'batch',
    branchPath: null,
    include: {
      product: { select: { sku: true, genericName: true, strength: true } },
      supplier: { select: { companyName: true } },
    },
    columns: [
      { key: 'batchNumber', label: 'Batch', type: 'string' },
      { key: 'sku', label: 'SKU', type: 'string', path: 'product.sku' },
      { key: 'product', label: 'Product', type: 'string', path: 'product.genericName' },
      { key: 'supplier', label: 'Supplier', type: 'string', path: 'supplier.companyName' },
      { key: 'manufacturingDate', label: 'Manufactured', type: 'date' },
      { key: 'expiryDate', label: 'Expiry', type: 'date' },
      { key: 'receivedDate', label: 'Received', type: 'date' },
      { key: 'receivedQuantity', label: 'Received quantity', type: 'number', numeric: true },
      { key: 'status', label: 'Status', type: 'string' },
      { key: 'purchaseCost', label: 'Purchase cost', type: 'number', numeric: true, requires: 'finance.report.READ' },
    ],
  },
  {
    key: 'dispensings',
    label: 'Dispensing',
    description: 'Medicines dispensed against prescriptions.',
    permission: 'dispensing.dispensing.READ',
    model: 'dispensing',
    branchPath: 'branchId',
    include: {
      prescription: { select: { prescriptionNo: true, prescriberName: true } },
    },
    columns: [
      { key: 'dispensingNo', label: 'Dispensing number', type: 'string' },
      { key: 'dispensedAt', label: 'Date', type: 'date' },
      { key: 'prescriptionNo', label: 'Prescription', type: 'string', path: 'prescription.prescriptionNo' },
      { key: 'prescriber', label: 'Prescriber', type: 'string', path: 'prescription.prescriberName' },
      { key: 'notes', label: 'Notes', type: 'string' },
    ],
  },
  {
    key: 'stock_counts',
    label: 'Stock count variances',
    description: 'Counted lines and the variance found.',
    permission: 'inventory.count.READ',
    model: 'stockCountItem',
    branchPath: null,
    include: { stockCount: { select: { countNo: true, status: true, warehouseId: true } } },
    columns: [
      { key: 'countNo', label: 'Count', type: 'string', path: 'stockCount.countNo' },
      { key: 'countStatus', label: 'Count status', type: 'string', path: 'stockCount.status' },
      { key: 'systemQty', label: 'System quantity', type: 'number', numeric: true },
      { key: 'countedQty', label: 'Counted quantity', type: 'number', numeric: true },
      { key: 'varianceQty', label: 'Variance', type: 'number', numeric: true },
      { key: 'varianceValue', label: 'Variance value', type: 'number', numeric: true, requires: 'finance.report.READ' },
      { key: 'requiresApproval', label: 'Needs approval', type: 'boolean' },
      { key: 'reason', label: 'Reason', type: 'string' },
    ],
  },
  {
    key: 'suppliers',
    label: 'Suppliers',
    description: 'Supplier records with their performance scores.',
    permission: 'procurement.supplier.READ',
    model: 'supplier',
    branchPath: null,
    columns: [
      { key: 'code', label: 'Code', type: 'string' },
      { key: 'companyName', label: 'Supplier', type: 'string' },
      { key: 'city', label: 'City', type: 'string' },
      { key: 'leadTimeDays', label: 'Lead time (days)', type: 'number', numeric: true },
      { key: 'onTimeDeliveryRate', label: 'On-time delivery', type: 'number', numeric: true },
      { key: 'rejectionRate', label: 'Rejection rate', type: 'number', numeric: true },
      { key: 'supplierScore', label: 'Score', type: 'number', numeric: true },
      { key: 'isApproved', label: 'Approved', type: 'boolean' },
      { key: 'licenseExpiry', label: 'Licence expiry', type: 'date' },
    ],
  },
  {
    key: 'audit_logs',
    label: 'Audit trail',
    description: 'Who changed what, and when.',
    permission: 'audit.log.READ',
    model: 'auditLog',
    branchPath: 'branchId',
    columns: [
      { key: 'createdAt', label: 'When', type: 'date' },
      { key: 'userLabel', label: 'User', type: 'string' },
      { key: 'module', label: 'Module', type: 'string' },
      { key: 'action', label: 'Action', type: 'string' },
      { key: 'entityType', label: 'Record type', type: 'string' },
      { key: 'entityId', label: 'Record', type: 'string' },
      { key: 'reason', label: 'Reason', type: 'string' },
      { key: 'ipAddress', label: 'IP address', type: 'string' },
    ],
  },
];

export const SOURCES_BY_KEY = new Map(REPORT_SOURCES.map((s) => [s.key, s]));
