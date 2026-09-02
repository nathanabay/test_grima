/**
 * The default chart of accounts.
 *
 * Codes follow the usual 1000/2000/3000/4000/5000 blocks. Every account the
 * posting rules reference carries a systemKey, so an organization can rename or
 * renumber accounts to suit its accountant without breaking posting.
 */
export const DEFAULT_ACCOUNTS: {
  code: string;
  name: string;
  type: string;
  subType?: string;
  systemKey?: string;
  description?: string;
}[] = [
  // Assets
  { code: '1000', name: 'Cash and bank', type: 'ASSET', subType: 'CURRENT_ASSET', systemKey: 'CASH' },
  { code: '1100', name: 'Accounts receivable', type: 'ASSET', subType: 'CURRENT_ASSET', systemKey: 'ACCOUNTS_RECEIVABLE' },
  { code: '1200', name: 'Inventory', type: 'ASSET', subType: 'CURRENT_ASSET', systemKey: 'INVENTORY_ASSET', description: 'Medicines held for sale or dispensing, at the configured valuation method.' },
  { code: '1210', name: 'Stock in transit', type: 'ASSET', subType: 'CURRENT_ASSET', systemKey: 'STOCK_IN_TRANSIT', description: 'Stock dispatched between branches but not yet received.' },
  { code: '1300', name: 'Recoverable input VAT', type: 'ASSET', subType: 'CURRENT_ASSET', systemKey: 'VAT_INPUT' },

  // Liabilities
  { code: '2000', name: 'Accounts payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', systemKey: 'ACCOUNTS_PAYABLE' },
  { code: '2050', name: 'Goods received not invoiced', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', systemKey: 'GOODS_RECEIVED_NOT_INVOICED', description: 'Accrual raised when stock is received and cleared when the supplier invoice arrives.' },
  { code: '2100', name: 'Output VAT payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', systemKey: 'VAT_OUTPUT' },
  { code: '2150', name: 'Withholding tax payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', systemKey: 'WITHHOLDING_TAX' },

  // Equity
  { code: '3000', name: 'Opening balance equity', type: 'EQUITY', systemKey: 'OPENING_BALANCE_EQUITY', description: 'Contra account for opening stock brought in at go-live.' },
  { code: '3100', name: 'Retained earnings', type: 'EQUITY' },

  // Income
  { code: '4000', name: 'Sales revenue', type: 'INCOME', subType: 'OPERATING_INCOME', systemKey: 'SALES_REVENUE' },
  { code: '4100', name: 'Purchase discounts received', type: 'INCOME', subType: 'OTHER_INCOME', systemKey: 'PURCHASE_DISCOUNT' },

  // Expenses
  { code: '5000', name: 'Cost of goods sold', type: 'EXPENSE', subType: 'COST_OF_SALES', systemKey: 'COGS' },
  { code: '5100', name: 'Inventory write-off', type: 'EXPENSE', subType: 'COST_OF_SALES', systemKey: 'INVENTORY_WRITE_OFF', description: 'Expiry, damage and disposal.' },
  { code: '5150', name: 'Inventory adjustment', type: 'EXPENSE', subType: 'COST_OF_SALES', systemKey: 'INVENTORY_ADJUSTMENT', description: 'Stock count variances and corrections.' },
  { code: '5200', name: 'Freight and clearing', type: 'EXPENSE', subType: 'COST_OF_SALES', systemKey: 'FREIGHT' },
];
