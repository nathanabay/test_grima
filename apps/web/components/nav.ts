import type { Command } from './CommandPalette';

/**
 * Information architecture (§20).
 *
 * Thirty-odd destinations grouped into twelve sections a pharmacy employee
 * already has a word for, rather than one flat list nobody can scan. A section
 * disappears entirely when the reader may see none of its pages, so a cashier
 * is not looking at eight headings with nothing under them.
 */
export interface NavItem {
  href: string;
  labelKey: string;
  /** Fallback when the message catalogue has no entry yet. */
  label: string;
  permission?: string;
  /** Extra words the command palette should match on. */
  keywords?: string;
}

export interface NavGroup {
  key: string;
  labelKey: string;
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    key: 'overview',
    labelKey: 'nav.group.overview',
    label: 'Overview',
    items: [
      { href: '/dashboard', labelKey: 'nav.dashboard', label: 'Dashboard', permission: 'analytics.dashboard.READ', keywords: 'home kpi summary' },
      { href: '/command-center', labelKey: 'nav.commandCenter', label: 'Command Centre', permission: 'analytics.dashboard.READ', keywords: 'operations alerts critical triage' },
    ],
  },
  {
    key: 'pharmacy',
    labelKey: 'nav.group.pharmacy',
    label: 'Pharmacy',
    items: [
      { href: '/dispensing', labelKey: 'nav.dispensing', label: 'Prescriptions', permission: 'dispensing.prescription.READ', keywords: 'rx dispense prescribe' },
      { href: '/patients', labelKey: 'nav.patients', label: 'Patients', permission: 'sales.patient.READ', keywords: 'customer crm' },
      { href: '/controlled', labelKey: 'nav.controlled', label: 'Controlled Register', permission: 'dispensing.controlled.READ', keywords: 'narcotic schedule register' },
    ],
  },
  {
    key: 'inventory',
    labelKey: 'nav.group.inventory',
    label: 'Inventory',
    items: [
      { href: '/inventory', labelKey: 'nav.inventory', label: 'Stock Balances', permission: 'inventory.balance.READ', keywords: 'stock on hand available' },
      { href: '/products', labelKey: 'nav.products', label: 'Drug Master', permission: 'catalog.product.READ', keywords: 'product catalogue sku medicine' },
      { href: '/batches', labelKey: 'nav.batches', label: 'Batches & Quarantine', permission: 'inventory.batch.READ', keywords: 'lot batch release quarantine' },
      { href: '/inventory/expiry', labelKey: 'nav.expiry', label: 'Expiry Risk Centre', permission: 'inventory.expiry.READ', keywords: 'expiry near expired risk' },
      { href: '/counts', labelKey: 'nav.counts', label: 'Stock Counts', permission: 'inventory.count.READ', keywords: 'count cycle variance' },
      { href: '/adjustments', labelKey: 'nav.adjustments', label: 'Adjustments', permission: 'inventory.adjustment.CREATE', keywords: 'adjust correction' },
      { href: '/serials', labelKey: 'nav.serials', label: 'Serial Register', permission: 'inventory.serial.READ', keywords: 'serial track trace pack unit gs1 sn' },
      { href: '/scan', labelKey: 'nav.scan', label: 'Scan Station', permission: 'inventory.balance.READ', keywords: 'barcode gs1 datamatrix scanner' },
    ],
  },
  {
    key: 'purchasing',
    labelKey: 'nav.group.purchasing',
    label: 'Purchasing',
    items: [
      { href: '/procurement', labelKey: 'nav.procurement', label: 'Procurement', permission: 'procurement.purchase_order.READ', keywords: 'purchase order rfq quotation request' },
      { href: '/suppliers', labelKey: 'nav.suppliers', label: 'Suppliers', permission: 'procurement.supplier.READ', keywords: 'vendor supplier performance' },
      { href: '/receiving', labelKey: 'nav.receiving', label: 'Goods Receiving', permission: 'inventory.goods_receipt.CREATE', keywords: 'grn receive delivery' },
      { href: '/invoices', labelKey: 'nav.invoices', label: 'Supplier Invoices', permission: 'finance.invoice.READ', keywords: 'invoice payable matching' },
    ],
  },
  {
    key: 'warehouse',
    labelKey: 'nav.group.warehouse',
    label: 'Warehouse',
    items: [
      { href: '/warehouse', labelKey: 'nav.warehouse', label: 'Warehouse Operations', permission: 'inventory.task.READ', keywords: 'bin putaway pick pack wave task occupancy' },
      { href: '/transfers', labelKey: 'nav.transfers', label: 'Stock Transfers', permission: 'inventory.transfer.READ', keywords: 'transfer branch move' },
    ],
  },
  {
    key: 'sales',
    labelKey: 'nav.group.sales',
    label: 'Sales',
    items: [
      { href: '/pos', labelKey: 'nav.pos', label: 'Point of Sale', permission: 'sales.sale.CREATE', keywords: 'till checkout cashier sell' },
      { href: '/pricing', labelKey: 'nav.pricing', label: 'Pricing', permission: 'catalog.price.READ', keywords: 'price list discount customer group' },
    ],
  },
  {
    key: 'quality',
    labelKey: 'nav.group.quality',
    label: 'Quality',
    items: [
      { href: '/quality', labelKey: 'nav.quality', label: 'Quality Incidents', permission: 'quality.incident.READ', keywords: 'capa incident investigation' },
      { href: '/cold-chain', labelKey: 'nav.coldChain', label: 'Cold Chain', permission: 'quality.cold_chain.READ', keywords: 'temperature fridge excursion sensor' },
      { href: '/returns', labelKey: 'nav.returns', label: 'Returns', permission: 'quality.return.READ', keywords: 'return customer supplier' },
      { href: '/damage', labelKey: 'nav.damage', label: 'Damaged Stock', permission: 'quality.disposal.READ', keywords: 'damage broken' },
    ],
  },
  {
    key: 'compliance',
    labelKey: 'nav.group.compliance',
    label: 'Compliance',
    items: [
      { href: '/recalls', labelKey: 'nav.recalls', label: 'Recalls', permission: 'quality.recall.READ', keywords: 'recall withdrawal trace' },
      { href: '/disposal', labelKey: 'nav.disposal', label: 'Waste & Disposal', permission: 'quality.disposal.READ', keywords: 'destroy dispose waste certificate' },
      { href: '/approvals', labelKey: 'nav.approvals', label: 'My Approvals', keywords: 'approve reject authorise inbox' },
    ],
  },
  {
    key: 'finance',
    labelKey: 'nav.group.finance',
    label: 'Finance',
    items: [
      { href: '/accounting', labelKey: 'nav.accounting', label: 'Accounting', permission: 'finance.account.READ', keywords: 'ledger journal trial balance valuation' },
    ],
  },
  {
    key: 'analytics',
    labelKey: 'nav.group.analytics',
    label: 'Analytics',
    items: [
      { href: '/reports', labelKey: 'nav.reports', label: 'Reports', permission: 'analytics.report.READ', keywords: 'report export print' },
      { href: '/reports/builder', labelKey: 'nav.reportBuilder', label: 'Report Builder', permission: 'analytics.report.READ', keywords: 'custom report builder query' },
      { href: '/forecast', labelKey: 'nav.forecast', label: 'Forecasting', permission: 'analytics.forecast.READ', keywords: 'forecast demand replenishment' },
    ],
  },
  {
    key: 'administration',
    labelKey: 'nav.group.administration',
    label: 'Administration',
    items: [
      { href: '/admin', labelKey: 'nav.admin', label: 'Users & Roles', permission: 'admin.user.READ', keywords: 'user role permission branch audit' },
      { href: '/admin/settings', labelKey: 'nav.settings', label: 'System Configuration', permission: 'admin.setting.READ', keywords: 'settings config threshold feature flag' },
      { href: '/automation', labelKey: 'nav.automation', label: 'Automation Rules', permission: 'admin.automation.READ', keywords: 'rule trigger escalation automation' },
      { href: '/admin/integrations', labelKey: 'nav.integrations', label: 'Integrations', permission: 'admin.setting.READ', keywords: 'api key webhook fhir integration' },
      { href: '/admin/jobs', labelKey: 'nav.jobs', label: 'System Health & Jobs', permission: 'admin.setting.READ', keywords: 'health job background scheduler' },
      { href: '/import', labelKey: 'nav.import', label: 'Data Import', permission: 'catalog.product.IMPORT', keywords: 'import csv upload bulk' },
      { href: '/notifications', labelKey: 'nav.notifications', label: 'Notifications', keywords: 'alert notification message' },
    ],
  },
];

/** Every navigable destination as a palette command. */
export const NAV_COMMANDS: Command[] = NAV.flatMap((g) =>
  g.items.map((i) => ({
    id: `nav:${i.href}`,
    label: i.label,
    group: g.label,
    href: i.href,
    keywords: i.keywords,
    permission: i.permission,
  })),
);

/**
 * Actions rather than destinations. These land on the page that starts the job,
 * so the palette is a way to begin work, not only to move around.
 */
export const ACTION_COMMANDS: Command[] = [
  { id: 'act:sell', label: 'Start a sale', group: 'Actions', href: '/pos', permission: 'sales.sale.CREATE', keywords: 'new sale checkout till' },
  { id: 'act:dispense', label: 'Dispense a prescription', group: 'Actions', href: '/dispensing', permission: 'dispensing.dispensing.CREATE', keywords: 'new dispense rx' },
  { id: 'act:receive', label: 'Receive a delivery', group: 'Actions', href: '/receiving', permission: 'inventory.goods_receipt.CREATE', keywords: 'goods receipt grn delivery' },
  { id: 'act:count', label: 'Start a stock count', group: 'Actions', href: '/counts', permission: 'inventory.count.CREATE', keywords: 'new count cycle' },
  { id: 'act:transfer', label: 'Raise a stock transfer', group: 'Actions', href: '/transfers', permission: 'inventory.transfer.CREATE', keywords: 'new transfer move branch' },
  { id: 'act:scan', label: 'Scan a barcode', group: 'Actions', href: '/scan', permission: 'inventory.balance.READ', keywords: 'scan gs1 barcode lookup' },
  { id: 'act:report', label: 'Build a report', group: 'Actions', href: '/reports/builder', permission: 'analytics.report.READ', keywords: 'new report custom' },
  { id: 'act:approvals', label: 'Review my approvals', group: 'Actions', href: '/approvals', keywords: 'approve pending inbox' },
];

export const ALL_COMMANDS: Command[] = [...ACTION_COMMANDS, ...NAV_COMMANDS];
