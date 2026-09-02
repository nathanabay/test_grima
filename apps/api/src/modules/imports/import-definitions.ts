import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * What can be imported, and the rules each row must satisfy (§59).
 *
 * A definition owns its own validation and its own apply step, so adding an
 * import means adding a definition rather than editing a general-purpose
 * importer that grows a special case per entity.
 *
 * Rollback is declared per entity and is deliberately not universal. Master
 * data can be undone by removing what was created; a stock movement cannot,
 * because §53 forbids deleting a ledger entry — it has to be reversed, and
 * that is a decision with a reason attached, not an undo button.
 */

export interface ImportField {
  key: string;
  label: string;
  required: boolean;
  type: 'string' | 'number' | 'boolean' | 'date';
  /** Shown in the template so the expected format is unambiguous. */
  example: string;
  description?: string;
  /** Accepted values for an enumerated field. */
  options?: string[];
}

export interface RowError {
  field: string;
  message: string;
}

export interface ImportContext {
  prisma: PrismaService;
  userId: string;
  /** Rows already seen in this file, for duplicate detection within the file. */
  seen: Map<string, number>;
}

export interface ImportDefinition {
  key: string;
  label: string;
  description: string;
  permission: string;
  fields: ImportField[];
  /** True when a single invalid row must reject the whole file. */
  allOrNothing: boolean;
  /** Why, when it does. */
  allOrNothingReason?: string;
  canRollback: boolean;
  rollbackNote?: string;
  validate(row: Record<string, unknown>, context: ImportContext): Promise<RowError[]>;
  apply(
    row: Record<string, unknown>,
    context: ImportContext,
    tx: Prisma.TransactionClient,
  ): Promise<{ entityId: string; action: 'CREATED' | 'UPDATED' }>;
  rollback?(entityId: string, tx: Prisma.TransactionClient): Promise<void>;
}

const asString = (value: unknown): string => String(value ?? '').trim();
const asNumber = (value: unknown): number => Number(String(value ?? '').trim());
const asBoolean = (value: unknown): boolean =>
  ['true', 'yes', '1', 'y'].includes(String(value ?? '').trim().toLowerCase());

/** Duplicate within the file itself, which a database constraint cannot catch. */
function checkFileDuplicate(context: ImportContext, key: string, label: string): RowError[] {
  if (!key) return [];
  const previous = context.seen.get(key);
  if (previous !== undefined) {
    return [{ field: label, message: `Duplicated in this file: also on row ${previous}` }];
  }
  return [];
}

export const IMPORT_DEFINITIONS: ImportDefinition[] = [
  {
    key: 'products',
    label: 'Drug master',
    description: 'Create or update products. An existing SKU is updated, a new one is created.',
    permission: 'catalog.product.IMPORT',
    allOrNothing: true,
    allOrNothingReason:
      'A partly imported drug master leaves the catalogue in a state nobody chose. Correct the file and import it again.',
    canRollback: true,
    fields: [
      { key: 'sku', label: 'SKU', required: true, type: 'string', example: 'SKU-0001', description: 'Unique internal code. An existing SKU is updated.' },
      { key: 'genericName', label: 'Generic name', required: true, type: 'string', example: 'Amoxicillin' },
      { key: 'brandName', label: 'Brand name', required: false, type: 'string', example: 'Amoxil' },
      { key: 'activeIngredient', label: 'Active ingredient', required: true, type: 'string', example: 'Amoxicillin trihydrate' },
      { key: 'strength', label: 'Strength', required: true, type: 'string', example: '500 mg' },
      { key: 'dosageForm', label: 'Dosage form', required: true, type: 'string', example: 'Capsule' },
      { key: 'gtin', label: 'GTIN', required: false, type: 'string', example: '8901234567890' },
      { key: 'atcCode', label: 'ATC code', required: false, type: 'string', example: 'J01CA04' },
      { key: 'baseUnit', label: 'Base unit', required: false, type: 'string', example: 'CAPSULE', description: 'Defaults to TABLET.' },
      { key: 'requiresPrescription', label: 'Prescription only', required: false, type: 'boolean', example: 'true' },
      { key: 'isControlled', label: 'Controlled', required: false, type: 'boolean', example: 'false' },
      { key: 'isColdChain', label: 'Cold chain', required: false, type: 'boolean', example: 'false' },
      { key: 'purchaseCost', label: 'Purchase cost', required: false, type: 'number', example: '2.40' },
      { key: 'retailPrice', label: 'Retail price', required: false, type: 'number', example: '4.50' },
      { key: 'reorderLevel', label: 'Reorder point', required: false, type: 'number', example: '100' },
      { key: 'taxRate', label: 'Tax rate', required: false, type: 'number', example: '0.15', description: 'A fraction, not a percentage.' },
    ],

    async validate(row, context) {
      const errors: RowError[] = [];
      const sku = asString(row.sku);

      if (!sku) errors.push({ field: 'sku', message: 'SKU is required' });
      if (!asString(row.genericName)) errors.push({ field: 'genericName', message: 'Generic name is required' });
      if (!asString(row.activeIngredient)) errors.push({ field: 'activeIngredient', message: 'Active ingredient is required' });
      if (!asString(row.strength)) errors.push({ field: 'strength', message: 'Strength is required' });
      if (!asString(row.dosageForm)) errors.push({ field: 'dosageForm', message: 'Dosage form is required' });

      errors.push(...checkFileDuplicate(context, sku, 'sku'));

      const gtin = asString(row.gtin);
      if (gtin) {
        if (!/^\d{8}$|^\d{12,14}$/.test(gtin)) {
          errors.push({ field: 'gtin', message: 'A GTIN must be 8, 12, 13 or 14 digits' });
        } else {
          const existing = await context.prisma.product.findFirst({
            where: { gtin, sku: { not: sku } },
            select: { sku: true },
          });
          if (existing) {
            errors.push({ field: 'gtin', message: `GTIN already belongs to ${existing.sku}` });
          }
        }
      }

      for (const key of ['purchaseCost', 'retailPrice', 'reorderLevel', 'taxRate']) {
        const raw = asString(row[key]);
        if (!raw) continue;
        const value = asNumber(raw);
        if (!Number.isFinite(value)) {
          errors.push({ field: key, message: `'${raw}' is not a number` });
        } else if (value < 0) {
          errors.push({ field: key, message: 'Cannot be negative' });
        }
      }

      const taxRate = asString(row.taxRate);
      if (taxRate && asNumber(taxRate) > 1) {
        errors.push({
          field: 'taxRate',
          message: 'Expressed as a fraction: 0.15 for 15%, not 15',
        });
      }

      return errors;
    },

    async apply(row, context, tx) {
      const sku = asString(row.sku);
      const data = {
        genericName: asString(row.genericName),
        brandName: asString(row.brandName) || null,
        activeIngredient: asString(row.activeIngredient),
        strength: asString(row.strength),
        dosageForm: asString(row.dosageForm),
        gtin: asString(row.gtin) || null,
        atcCode: asString(row.atcCode) || null,
        baseUnit: asString(row.baseUnit) || 'TABLET',
        requiresPrescription: asBoolean(row.requiresPrescription),
        isControlled: asBoolean(row.isControlled),
        isColdChain: asBoolean(row.isColdChain),
        ...(asString(row.purchaseCost) ? { purchaseCost: new Prisma.Decimal(asNumber(row.purchaseCost)) } : {}),
        ...(asString(row.retailPrice) ? { retailPrice: new Prisma.Decimal(asNumber(row.retailPrice)) } : {}),
        ...(asString(row.reorderLevel) ? { reorderLevel: new Prisma.Decimal(asNumber(row.reorderLevel)) } : {}),
        ...(asString(row.taxRate) ? { taxRate: new Prisma.Decimal(asNumber(row.taxRate)) } : {}),
      };

      const existing = await tx.product.findUnique({ where: { sku }, select: { id: true } });
      if (existing) {
        await tx.product.update({ where: { id: existing.id }, data });
        return { entityId: existing.id, action: 'UPDATED' };
      }

      const created = await tx.product.create({
        data: { sku, ...data, createdById: context.userId },
      });
      return { entityId: created.id, action: 'CREATED' };
    },

    async rollback(entityId, tx) {
      // Only if nothing has happened to it since. A product that has been
      // received, sold or dispensed is part of the record now.
      const [balances, movements] = await Promise.all([
        tx.inventoryBalance.count({ where: { productId: entityId } }),
        tx.inventoryTransaction.count({ where: { productId: entityId } }),
      ]);
      if (balances > 0 || movements > 0) {
        throw new Error('This product now has stock history and cannot be removed; deactivate it instead');
      }
      await tx.product.delete({ where: { id: entityId } });
    },
  },

  {
    key: 'suppliers',
    label: 'Suppliers',
    description: 'Create or update supplier records.',
    permission: 'procurement.supplier.CREATE',
    allOrNothing: false,
    canRollback: true,
    fields: [
      { key: 'code', label: 'Supplier code', required: true, type: 'string', example: 'SUP-001' },
      { key: 'companyName', label: 'Company name', required: true, type: 'string', example: 'Ethio Pharma Import PLC' },
      { key: 'contactName', label: 'Contact', required: false, type: 'string', example: 'Alemayehu Tadesse' },
      { key: 'phone', label: 'Phone', required: false, type: 'string', example: '+251911000000' },
      { key: 'email', label: 'Email', required: false, type: 'string', example: 'sales@example.com' },
      { key: 'city', label: 'City', required: false, type: 'string', example: 'Addis Ababa' },
      { key: 'taxId', label: 'Tax ID', required: false, type: 'string', example: '0012345678' },
      { key: 'licenseNumber', label: 'Licence number', required: false, type: 'string', example: 'EFDA-IMP-2026-001' },
      { key: 'licenseExpiry', label: 'Licence expiry', required: false, type: 'date', example: '2027-12-31' },
      { key: 'paymentTerms', label: 'Payment terms', required: false, type: 'string', example: 'NET30' },
      { key: 'leadTimeDays', label: 'Lead time (days)', required: false, type: 'number', example: '14' },
    ],

    async validate(row, context) {
      const errors: RowError[] = [];
      const code = asString(row.code);

      if (!code) errors.push({ field: 'code', message: 'Supplier code is required' });
      if (!asString(row.companyName)) errors.push({ field: 'companyName', message: 'Company name is required' });

      errors.push(...checkFileDuplicate(context, code, 'code'));

      const email = asString(row.email);
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        errors.push({ field: 'email', message: `'${email}' is not a valid email address` });
      }

      const expiry = asString(row.licenseExpiry);
      if (expiry) {
        const parsed = new Date(expiry);
        if (Number.isNaN(parsed.getTime())) {
          errors.push({ field: 'licenseExpiry', message: `'${expiry}' is not a valid date (use YYYY-MM-DD)` });
        } else if (parsed.getTime() < Date.now()) {
          // A warning would be lost; an expired licence is a real problem.
          errors.push({ field: 'licenseExpiry', message: 'This licence has already expired' });
        }
      }

      const lead = asString(row.leadTimeDays);
      if (lead && (!Number.isFinite(asNumber(lead)) || asNumber(lead) < 0)) {
        errors.push({ field: 'leadTimeDays', message: 'Lead time must be a positive number of days' });
      }

      return errors;
    },

    async apply(row, _context, tx) {
      const code = asString(row.code);
      const data = {
        companyName: asString(row.companyName),
        contactName: asString(row.contactName) || null,
        phone: asString(row.phone) || null,
        email: asString(row.email) || null,
        city: asString(row.city) || null,
        taxId: asString(row.taxId) || null,
        licenseNumber: asString(row.licenseNumber) || null,
        licenseExpiry: asString(row.licenseExpiry) ? new Date(asString(row.licenseExpiry)) : null,
        paymentTerms: asString(row.paymentTerms) || null,
        ...(asString(row.leadTimeDays) ? { leadTimeDays: Math.round(asNumber(row.leadTimeDays)) } : {}),
      };

      const existing = await tx.supplier.findUnique({ where: { code }, select: { id: true } });
      if (existing) {
        await tx.supplier.update({ where: { id: existing.id }, data });
        return { entityId: existing.id, action: 'UPDATED' };
      }

      const created = await tx.supplier.create({ data: { code, ...data } });
      return { entityId: created.id, action: 'CREATED' };
    },

    async rollback(entityId, tx) {
      const orders = await tx.purchaseOrder.count({ where: { supplierId: entityId } });
      if (orders > 0) {
        throw new Error('This supplier has purchase orders and cannot be removed; deactivate it instead');
      }
      await tx.supplierProduct.deleteMany({ where: { supplierId: entityId } });
      await tx.supplier.delete({ where: { id: entityId } });
    },
  },

  {
    key: 'patients',
    label: 'Patients and customers',
    description: 'Create or update patient records.',
    permission: 'sales.patient.CREATE',
    allOrNothing: false,
    canRollback: true,
    fields: [
      { key: 'patientCode', label: 'Patient code', required: true, type: 'string', example: 'PT-000001' },
      { key: 'fullName', label: 'Full name', required: true, type: 'string', example: 'Abebe Kebede' },
      { key: 'dateOfBirth', label: 'Date of birth', required: false, type: 'date', example: '1985-03-14' },
      { key: 'sex', label: 'Sex', required: false, type: 'string', example: 'M', options: ['M', 'F'] },
      { key: 'phone', label: 'Phone', required: false, type: 'string', example: '+251911223344' },
      { key: 'email', label: 'Email', required: false, type: 'string', example: 'patient@example.com' },
      { key: 'city', label: 'City', required: false, type: 'string', example: 'Addis Ababa' },
      { key: 'allergies', label: 'Allergies', required: false, type: 'string', example: 'Penicillin' },
    ],

    async validate(row, context) {
      const errors: RowError[] = [];
      const code = asString(row.patientCode);

      if (!code) errors.push({ field: 'patientCode', message: 'Patient code is required' });
      if (!asString(row.fullName)) errors.push({ field: 'fullName', message: 'Full name is required' });

      errors.push(...checkFileDuplicate(context, code, 'patientCode'));

      const sex = asString(row.sex).toUpperCase();
      if (sex && !['M', 'F'].includes(sex)) {
        errors.push({ field: 'sex', message: `'${row.sex}' is not recognised; use M or F` });
      }

      const dob = asString(row.dateOfBirth);
      if (dob) {
        const parsed = new Date(dob);
        if (Number.isNaN(parsed.getTime())) {
          errors.push({ field: 'dateOfBirth', message: `'${dob}' is not a valid date (use YYYY-MM-DD)` });
        } else if (parsed.getTime() > Date.now()) {
          errors.push({ field: 'dateOfBirth', message: 'A date of birth cannot be in the future' });
        }
      }

      return errors;
    },

    async apply(row, _context, tx) {
      const patientCode = asString(row.patientCode);
      const data = {
        fullName: asString(row.fullName),
        dateOfBirth: asString(row.dateOfBirth) ? new Date(asString(row.dateOfBirth)) : null,
        sex: asString(row.sex).toUpperCase() || null,
        phone: asString(row.phone) || null,
        email: asString(row.email) || null,
        city: asString(row.city) || null,
        allergies: asString(row.allergies) || null,
      };

      const existing = await tx.patient.findUnique({ where: { patientCode }, select: { id: true } });
      if (existing) {
        await tx.patient.update({ where: { id: existing.id }, data });
        return { entityId: existing.id, action: 'UPDATED' };
      }

      const created = await tx.patient.create({ data: { patientCode, ...data } });
      return { entityId: created.id, action: 'CREATED' };
    },

    async rollback(entityId, tx) {
      const [prescriptions, sales] = await Promise.all([
        tx.prescription.count({ where: { patientId: entityId } }),
        tx.sale.count({ where: { patientId: entityId } }),
      ]);
      if (prescriptions > 0 || sales > 0) {
        throw new Error('This patient has dispensing or sales history and cannot be removed');
      }
      await tx.patientConsent.deleteMany({ where: { patientId: entityId } });
      await tx.patient.delete({ where: { id: entityId } });
    },
  },

  {
    key: 'barcodes',
    label: 'Product barcodes',
    description: 'Attach additional barcodes to existing products.',
    permission: 'catalog.product.IMPORT',
    allOrNothing: false,
    canRollback: true,
    fields: [
      { key: 'sku', label: 'Product SKU', required: true, type: 'string', example: 'SKU-0001' },
      { key: 'barcode', label: 'Barcode', required: true, type: 'string', example: '8901234567890' },
      { key: 'symbology', label: 'Symbology', required: false, type: 'string', example: 'EAN13', options: ['EAN13', 'UPC', 'CODE128', 'GS1_DATAMATRIX'] },
      { key: 'unitCode', label: 'Unit', required: false, type: 'string', example: 'BOX', description: 'When the barcode identifies a pack rather than a base unit.' },
    ],

    async validate(row, context) {
      const errors: RowError[] = [];
      const sku = asString(row.sku);
      const barcode = asString(row.barcode);

      if (!sku) errors.push({ field: 'sku', message: 'Product SKU is required' });
      if (!barcode) errors.push({ field: 'barcode', message: 'Barcode is required' });

      errors.push(...checkFileDuplicate(context, `${barcode}|${asString(row.symbology) || 'EAN13'}`, 'barcode'));

      if (sku) {
        const product = await context.prisma.product.findUnique({ where: { sku }, select: { id: true } });
        if (!product) errors.push({ field: 'sku', message: `No product has the SKU '${sku}'` });
      }

      const symbology = asString(row.symbology).toUpperCase();
      if (symbology && !['EAN13', 'UPC', 'CODE128', 'GS1_DATAMATRIX'].includes(symbology)) {
        errors.push({
          field: 'symbology',
          message: `'${row.symbology}' is not supported; use EAN13, UPC, CODE128 or GS1_DATAMATRIX`,
        });
      }

      if (barcode) {
        const existing = await context.prisma.productBarcode.findFirst({
          where: { barcode, symbology: symbology || 'EAN13' },
          include: { product: { select: { sku: true } } },
        });
        // A barcode pointing at two products means a scan is ambiguous, which
        // is worse than a missing barcode.
        if (existing && existing.product.sku !== sku) {
          errors.push({
            field: 'barcode',
            message: `Already registered to ${existing.product.sku}`,
          });
        }
      }

      return errors;
    },

    async apply(row, _context, tx) {
      const sku = asString(row.sku);
      const product = await tx.product.findUniqueOrThrow({ where: { sku }, select: { id: true } });
      const barcode = asString(row.barcode);
      const symbology = asString(row.symbology).toUpperCase() || 'EAN13';

      const existing = await tx.productBarcode.findFirst({ where: { barcode, symbology } });
      if (existing) {
        await tx.productBarcode.update({
          where: { id: existing.id },
          data: { unitCode: asString(row.unitCode) || null },
        });
        return { entityId: existing.id, action: 'UPDATED' };
      }

      const created = await tx.productBarcode.create({
        data: {
          productId: product.id,
          barcode,
          symbology,
          unitCode: asString(row.unitCode) || null,
        },
      });
      return { entityId: created.id, action: 'CREATED' };
    },

    async rollback(entityId, tx) {
      await tx.productBarcode.delete({ where: { id: entityId } });
    },
  },

  {
    key: 'price_list',
    label: 'Price list lines',
    description: 'Set prices on an existing price list.',
    permission: 'catalog.price.EDIT',
    allOrNothing: false,
    canRollback: true,
    fields: [
      { key: 'priceListCode', label: 'Price list code', required: true, type: 'string', example: 'PL-INSURANCE' },
      { key: 'sku', label: 'Product SKU', required: true, type: 'string', example: 'SKU-0001' },
      { key: 'unitPrice', label: 'Unit price', required: true, type: 'number', example: '4.05' },
      { key: 'minQuantity', label: 'From quantity', required: false, type: 'number', example: '0', description: 'Quantity break. 0 means it always applies.' },
      { key: 'effectiveFrom', label: 'Effective from', required: false, type: 'date', example: '2026-01-01' },
      { key: 'effectiveTo', label: 'Effective to', required: false, type: 'date', example: '2026-12-31' },
    ],

    async validate(row, context) {
      const errors: RowError[] = [];
      const listCode = asString(row.priceListCode);
      const sku = asString(row.sku);

      if (!listCode) errors.push({ field: 'priceListCode', message: 'Price list code is required' });
      if (!sku) errors.push({ field: 'sku', message: 'Product SKU is required' });

      errors.push(
        ...checkFileDuplicate(context, `${listCode}|${sku}|${asString(row.minQuantity) || '0'}`, 'sku'),
      );

      if (listCode) {
        const list = await context.prisma.priceList.findUnique({ where: { code: listCode } });
        if (!list) errors.push({ field: 'priceListCode', message: `No price list has the code '${listCode}'` });
      }
      if (sku) {
        const product = await context.prisma.product.findUnique({ where: { sku }, select: { id: true } });
        if (!product) errors.push({ field: 'sku', message: `No product has the SKU '${sku}'` });
      }

      const price = asString(row.unitPrice);
      if (!price) {
        errors.push({ field: 'unitPrice', message: 'Unit price is required' });
      } else if (!Number.isFinite(asNumber(price)) || asNumber(price) < 0) {
        errors.push({ field: 'unitPrice', message: `'${price}' is not a valid price` });
      }

      const from = asString(row.effectiveFrom);
      const to = asString(row.effectiveTo);
      if (from && to && new Date(from) > new Date(to)) {
        errors.push({ field: 'effectiveTo', message: 'The end date is before the start date' });
      }

      return errors;
    },

    async apply(row, context, tx) {
      const list = await tx.priceList.findUniqueOrThrow({ where: { code: asString(row.priceListCode) } });
      const product = await tx.product.findUniqueOrThrow({
        where: { sku: asString(row.sku) },
        select: { id: true },
      });

      const minQuantity = new Prisma.Decimal(asString(row.minQuantity) ? asNumber(row.minQuantity) : 0);
      const unitPrice = new Prisma.Decimal(asNumber(row.unitPrice));

      const existing = await tx.priceListItem.findUnique({
        where: {
          priceListId_productId_minQuantity: {
            priceListId: list.id,
            productId: product.id,
            minQuantity,
          },
        },
      });

      const data = {
        unitPrice,
        effectiveFrom: asString(row.effectiveFrom) ? new Date(asString(row.effectiveFrom)) : null,
        effectiveTo: asString(row.effectiveTo) ? new Date(asString(row.effectiveTo)) : null,
      };

      // §71: a price change is recorded with its old and new value whether it
      // came from a screen or a spreadsheet.
      await tx.priceHistory.create({
        data: {
          productId: product.id,
          branchId: list.branchId,
          priceType: list.listType,
          oldValue: existing?.unitPrice ?? new Prisma.Decimal(0),
          newValue: unitPrice,
          reason: `Imported into price list ${list.code}`,
          changedById: context.userId,
        },
      });

      if (existing) {
        await tx.priceListItem.update({ where: { id: existing.id }, data });
        return { entityId: existing.id, action: 'UPDATED' };
      }

      const created = await tx.priceListItem.create({
        data: { priceListId: list.id, productId: product.id, minQuantity, ...data },
      });
      return { entityId: created.id, action: 'CREATED' };
    },

    async rollback(entityId, tx) {
      await tx.priceListItem.delete({ where: { id: entityId } });
    },
  },
];

export const IMPORTS_BY_KEY = new Map(IMPORT_DEFINITIONS.map((d) => [d.key, d]));
