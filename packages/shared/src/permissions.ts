/**
 * Permission catalog and default roles (§4).
 *
 * A permission code is `module.resource.ACTION`. Authorization is always
 * evaluated server-side (§73) - the client only uses this catalog to decide
 * what to render.
 */

export const PERMISSION_ACTIONS = [
  'CREATE',
  'READ',
  'EDIT',
  'DELETE',
  'APPROVE',
  'REJECT',
  'CANCEL',
  'PRINT',
  'EXPORT',
  'IMPORT',
] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export interface ResourceDefinition {
  module: string;
  resource: string;
  label: string;
  actions: PermissionAction[];
}

const CRUD: PermissionAction[] = ['CREATE', 'READ', 'EDIT', 'DELETE'];
const CRUD_APPROVE: PermissionAction[] = [...CRUD, 'APPROVE', 'REJECT', 'CANCEL'];
const READ_ONLY: PermissionAction[] = ['READ'];
const REPORTING: PermissionAction[] = ['READ', 'PRINT', 'EXPORT'];

export const RESOURCE_CATALOG: ResourceDefinition[] = [
  { module: 'admin', resource: 'user', label: 'Users', actions: [...CRUD, 'APPROVE'] },
  { module: 'admin', resource: 'role', label: 'Roles & Permissions', actions: CRUD },
  { module: 'admin', resource: 'branch', label: 'Branches', actions: CRUD },
  { module: 'admin', resource: 'warehouse', label: 'Warehouses', actions: CRUD },
  { module: 'admin', resource: 'setting', label: 'System Settings', actions: ['READ', 'EDIT'] },
  { module: 'admin', resource: 'backup', label: 'Backups', actions: ['READ', 'CREATE'] },
  { module: 'admin', resource: 'automation', label: 'Automation Rules', actions: CRUD },

  { module: 'catalog', resource: 'product', label: 'Drug Master', actions: [...CRUD, 'IMPORT', 'EXPORT'] },
  { module: 'catalog', resource: 'price', label: 'Pricing', actions: ['READ', 'EDIT', 'APPROVE'] },
  { module: 'catalog', resource: 'manufacturer', label: 'Manufacturers', actions: CRUD },
  { module: 'catalog', resource: 'attribute', label: 'Product Attributes', actions: CRUD },

  { module: 'procurement', resource: 'supplier', label: 'Suppliers', actions: [...CRUD, 'APPROVE'] },
  { module: 'procurement', resource: 'purchase_request', label: 'Purchase Requests', actions: CRUD_APPROVE },
  { module: 'procurement', resource: 'rfq', label: 'RFQs', actions: CRUD },
  { module: 'procurement', resource: 'quotation', label: 'Supplier Quotations', actions: [...CRUD, 'APPROVE'] },
  { module: 'procurement', resource: 'purchase_order', label: 'Purchase Orders', actions: [...CRUD_APPROVE, 'PRINT'] },

  { module: 'inventory', resource: 'balance', label: 'Stock Balances', actions: REPORTING },
  { module: 'inventory', resource: 'ledger', label: 'Stock Ledger', actions: REPORTING },
  { module: 'inventory', resource: 'batch', label: 'Batches', actions: ['READ', 'EDIT', 'APPROVE'] },
  { module: 'inventory', resource: 'goods_receipt', label: 'Goods Receiving', actions: [...CRUD, 'APPROVE', 'PRINT'] },
  { module: 'inventory', resource: 'transfer', label: 'Stock Transfers', actions: [...CRUD_APPROVE, 'PRINT'] },
  { module: 'inventory', resource: 'adjustment', label: 'Stock Adjustments', actions: CRUD_APPROVE },
  { module: 'inventory', resource: 'count', label: 'Stock Counts', actions: CRUD_APPROVE },
  { module: 'inventory', resource: 'expiry', label: 'Expiry Management', actions: REPORTING },
  { module: 'inventory', resource: 'fefo_override', label: 'FEFO Batch Override', actions: ['CREATE'] },
  { module: 'inventory', resource: 'task', label: 'Warehouse Tasks & Picking', actions: [...CRUD, 'CANCEL'] },
  { module: 'inventory', resource: 'serial', label: 'Serial Numbers', actions: ['READ', 'EDIT', 'IMPORT', 'EXPORT'] },

  { module: 'dispensing', resource: 'prescription', label: 'Prescriptions', actions: CRUD_APPROVE },
  { module: 'dispensing', resource: 'dispensing', label: 'Dispensing', actions: ['CREATE', 'READ', 'PRINT'] },
  { module: 'dispensing', resource: 'controlled', label: 'Controlled Medicines Register', actions: ['CREATE', 'READ', 'PRINT', 'EXPORT'] },

  { module: 'sales', resource: 'sale', label: 'POS Sales', actions: ['CREATE', 'READ', 'CANCEL', 'PRINT'] },
  { module: 'sales', resource: 'payment', label: 'Payments', actions: ['CREATE', 'READ'] },
  { module: 'sales', resource: 'cash_session', label: 'Cash Sessions', actions: ['CREATE', 'READ', 'EDIT', 'APPROVE'] },
  { module: 'sales', resource: 'patient', label: 'Patients & Customers', actions: CRUD },

  { module: 'quality', resource: 'return', label: 'Returns', actions: [...CRUD, 'APPROVE'] },
  { module: 'quality', resource: 'recall', label: 'Recalls', actions: [...CRUD, 'APPROVE'] },
  { module: 'quality', resource: 'incident', label: 'Quality Incidents', actions: [...CRUD, 'APPROVE'] },
  { module: 'quality', resource: 'quarantine', label: 'Quarantine & Release', actions: ['READ', 'CREATE', 'APPROVE'] },
  { module: 'quality', resource: 'disposal', label: 'Waste & Disposal', actions: [...CRUD, 'APPROVE', 'PRINT'] },
  { module: 'quality', resource: 'cold_chain', label: 'Cold Chain', actions: ['READ', 'EDIT', 'APPROVE'] },

  { module: 'finance', resource: 'invoice', label: 'Invoices & Credit Notes', actions: [...CRUD, 'APPROVE'] },
  { module: 'finance', resource: 'account', label: 'Chart of Accounts', actions: CRUD },
  { module: 'finance', resource: 'journal', label: 'General Ledger', actions: [...CRUD, 'APPROVE', 'CANCEL'] },
  { module: 'finance', resource: 'report', label: 'Financial Reports', actions: REPORTING },

  { module: 'analytics', resource: 'dashboard', label: 'Dashboards', actions: READ_ONLY },
  { module: 'analytics', resource: 'report', label: 'Reports', actions: REPORTING },
  { module: 'analytics', resource: 'forecast', label: 'Forecasting', actions: READ_ONLY },

  { module: 'audit', resource: 'log', label: 'Audit Trail', actions: REPORTING },
];

export function permissionCode(
  module: string,
  resource: string,
  action: PermissionAction,
): string {
  return `${module}.${resource}.${action}`;
}

export function allPermissionCodes(): string[] {
  return RESOURCE_CATALOG.flatMap((r) =>
    r.actions.map((a) => permissionCode(r.module, r.resource, a)),
  );
}

/** All codes for a module, optionally restricted to a set of actions. */
function moduleCodes(module: string, actions?: PermissionAction[]): string[] {
  return RESOURCE_CATALOG.filter((r) => r.module === module).flatMap((r) =>
    r.actions
      .filter((a) => !actions || actions.includes(a))
      .map((a) => permissionCode(r.module, r.resource, a)),
  );
}

function resourceCodes(
  module: string,
  resource: string,
  actions?: PermissionAction[],
): string[] {
  const def = RESOURCE_CATALOG.find((r) => r.module === module && r.resource === resource);
  if (!def) return [];
  return def.actions
    .filter((a) => !actions || actions.includes(a))
    .map((a) => permissionCode(def.module, def.resource, a));
}

export interface RoleDefinition {
  code: string;
  name: string;
  description: string;
  /** '*' grants everything and is reserved for the super administrator. */
  permissions: string[] | '*';
}

export const DEFAULT_ROLES: RoleDefinition[] = [
  {
    code: 'SUPER_ADMIN',
    name: 'Super Administrator',
    description: 'Complete system access.',
    permissions: '*',
  },
  {
    code: 'PHARMACY_ADMIN',
    name: 'Pharmacy Administrator',
    description: 'Manages pharmacy configuration, employees and operations.',
    permissions: [
      ...moduleCodes('admin').filter((c) => !c.startsWith('admin.backup')),
      ...moduleCodes('catalog'),
      // Approving procurement is a management act: without this, the only
      // approver of a purchase request would be the officer who raised it.
      ...moduleCodes('procurement'),
      ...moduleCodes('inventory'),
      ...moduleCodes('dispensing'),
      ...moduleCodes('sales'),
      ...moduleCodes('quality'),
      ...moduleCodes('analytics'),
      ...moduleCodes('audit'),
    ],
  },
  {
    code: 'PHARMACIST',
    name: 'Pharmacist',
    description: 'Prescription validation, dispensing and pharmaceutical stock operations.',
    permissions: [
      ...moduleCodes('dispensing'),
      ...resourceCodes('inventory', 'balance'),
      ...resourceCodes('inventory', 'ledger'),
      ...resourceCodes('inventory', 'batch', ['READ']),
      ...resourceCodes('inventory', 'serial', ['READ', 'EDIT']),
      ...resourceCodes('inventory', 'expiry'),
      ...resourceCodes('inventory', 'fefo_override'),
      ...resourceCodes('quality', 'return', ['CREATE', 'READ']),
      ...resourceCodes('quality', 'quarantine', ['READ', 'CREATE']),
      ...resourceCodes('quality', 'recall', ['READ']),
      ...resourceCodes('sales', 'sale', ['CREATE', 'READ', 'PRINT']),
      ...resourceCodes('sales', 'patient'),
      ...resourceCodes('catalog', 'product', ['READ']),
      ...resourceCodes('analytics', 'dashboard'),
    ],
  },
  {
    code: 'PHARMACY_TECHNICIAN',
    name: 'Pharmacy Technician',
    description: 'Receiving, picking and permitted dispensing workflows.',
    permissions: [
      ...resourceCodes('inventory', 'balance'),
      ...resourceCodes('inventory', 'goods_receipt', ['CREATE', 'READ', 'EDIT', 'PRINT']),
      ...resourceCodes('inventory', 'transfer', ['CREATE', 'READ', 'PRINT']),
      ...resourceCodes('inventory', 'count', ['CREATE', 'READ', 'EDIT']),
      ...resourceCodes('inventory', 'expiry', ['READ']),
      ...resourceCodes('inventory', 'serial', ['READ']),
      ...resourceCodes('dispensing', 'prescription', ['READ']),
      ...resourceCodes('catalog', 'product', ['READ']),
    ],
  },
  {
    code: 'PROCUREMENT_OFFICER',
    name: 'Procurement Officer',
    description: 'Suppliers, RFQs, quotations and purchase orders.',
    permissions: [
      ...moduleCodes('procurement'),
      ...resourceCodes('inventory', 'balance'),
      ...resourceCodes('inventory', 'expiry', ['READ']),
      ...resourceCodes('catalog', 'product', ['READ']),
      ...resourceCodes('analytics', 'forecast'),
      ...resourceCodes('analytics', 'dashboard'),
    ],
  },
  {
    code: 'WAREHOUSE_MANAGER',
    name: 'Warehouse Manager',
    description: 'Receiving, transfers, inventory counts and warehouse management.',
    permissions: [
      ...moduleCodes('inventory'),
      ...resourceCodes('admin', 'warehouse', ['READ', 'EDIT']),
      ...resourceCodes('catalog', 'product', ['READ']),
      ...resourceCodes('quality', 'quarantine'),
      ...resourceCodes('quality', 'return', ['CREATE', 'READ']),
      ...resourceCodes('analytics', 'dashboard'),
      ...resourceCodes('analytics', 'report'),
    ],
  },
  {
    code: 'STOREKEEPER',
    name: 'Storekeeper',
    description: 'Day-to-day warehouse transactions.',
    permissions: [
      ...resourceCodes('inventory', 'balance'),
      ...resourceCodes('inventory', 'goods_receipt', ['CREATE', 'READ', 'EDIT']),
      ...resourceCodes('inventory', 'transfer', ['CREATE', 'READ']),
      ...resourceCodes('inventory', 'count', ['CREATE', 'READ', 'EDIT']),
      ...resourceCodes('catalog', 'product', ['READ']),
    ],
  },
  {
    code: 'CASHIER',
    name: 'Cashier',
    description: 'POS and payment processing.',
    permissions: [
      ...moduleCodes('sales'),
      ...resourceCodes('inventory', 'balance', ['READ']),
      ...resourceCodes('catalog', 'product', ['READ']),
    ],
  },
  {
    code: 'FINANCE_OFFICER',
    name: 'Finance Officer',
    description: 'Invoices, payments, expenses and financial reports.',
    permissions: [
      ...moduleCodes('finance'),
      // Finance reviews the money, not the order. Holding the procurement
      // approval too would let one officer clear both steps of a tiered chain,
      // which is exactly the segregation the workflow engine exists to enforce.
      ...resourceCodes('procurement', 'purchase_order', ['READ']),
      ...resourceCodes('sales', 'cash_session', ['READ', 'APPROVE']),
      ...resourceCodes('catalog', 'price'),
      ...moduleCodes('analytics'),
    ],
  },
  {
    code: 'QA_OFFICER',
    name: 'Quality Assurance Officer',
    description: 'Batch quarantine, recalls, damaged medicines and quality incidents.',
    permissions: [
      ...moduleCodes('quality'),
      ...resourceCodes('inventory', 'batch'),
      ...resourceCodes('inventory', 'serial', ['READ', 'EDIT']),
      ...resourceCodes('inventory', 'balance'),
      ...resourceCodes('inventory', 'ledger'),
      ...resourceCodes('inventory', 'expiry'),
      ...resourceCodes('analytics', 'dashboard'),
      ...resourceCodes('audit', 'log', ['READ']),
    ],
  },
  {
    code: 'AUDITOR',
    name: 'Auditor',
    description: 'Read-only access to transactions and audit logs.',
    permissions: [
      ...allPermissionCodes().filter(
        (c) => c.endsWith('.READ') || c.endsWith('.EXPORT') || c.endsWith('.PRINT'),
      ),
    ],
  },
  {
    code: 'BRANCH_MANAGER',
    name: 'Branch Manager',
    description: 'Full operational access restricted to the assigned branch.',
    permissions: [
      ...moduleCodes('inventory'),
      ...moduleCodes('sales'),
      ...moduleCodes('dispensing'),
      ...resourceCodes('procurement', 'purchase_request'),
      ...resourceCodes('quality', 'return'),
      ...resourceCodes('quality', 'recall', ['READ']),
      ...moduleCodes('analytics'),
      ...resourceCodes('catalog', 'product', ['READ']),
    ],
  },
];

/** Deduplicated permission list for a role. */
export function resolveRolePermissions(role: RoleDefinition): string[] {
  if (role.permissions === '*') return allPermissionCodes();
  return Array.from(new Set(role.permissions));
}
