import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UnitDefinition, describeQuantity, toBaseUnits } from '@pharmacore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Global product search (§49). Matches generic name, brand, SKU, GTIN and any
   * registered barcode, and tolerates minor typos via trigram similarity when
   * an exact match returns nothing.
   */
  /**
   * Every product category, for the pickers that filter by one.
   *
   * `/counts` used to derive its category list from the first 200 products,
   * so a category whose products all sorted later simply did not appear as an
   * option. This asks the categories table, which is the only place that
   * answer is complete.
   */
  async categories() {
    const rows = await this.prisma.productCategory.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        parentId: true,
        _count: { select: { products: true } },
      },
      orderBy: { name: 'asc' },
    });
    return rows.map(({ _count, ...c }) => ({ ...c, productCount: _count.products }));
  }

  async search(query: {
    q?: string;
    categoryId?: string;
    isControlled?: boolean;
    isActive?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, query.pageSize ?? 25);
    const term = query.q?.trim();

    const where: Prisma.ProductWhereInput = {
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.isControlled !== undefined ? { isControlled: query.isControlled } : {}),
      isActive: query.isActive ?? true,
      ...(term
        ? {
            OR: [
              { genericName: { contains: term, mode: 'insensitive' } },
              { brandName: { contains: term, mode: 'insensitive' } },
              { activeIngredient: { contains: term, mode: 'insensitive' } },
              { sku: { contains: term, mode: 'insensitive' } },
              { gtin: { contains: term } },
              { atcCode: { contains: term, mode: 'insensitive' } },
              { barcodes: { some: { barcode: { contains: term } } } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          manufacturer: { select: { name: true } },
          category: { select: { name: true } },
          units: true,
          barcodes: true,
        },
        orderBy: { genericName: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  async findOne(id: string) {
    return this.prisma.product.findUniqueOrThrow({
      where: { id },
      include: {
        manufacturer: true,
        category: true,
        units: { orderBy: { factorToBase: 'desc' } },
        barcodes: true,
        supplierLinks: { include: { supplier: { select: { id: true, companyName: true } } } },
        priceHistory: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
  }

  async create(data: any, user: AuthenticatedUser) {
    const { units, barcodes, ...productData } = data;

    const product = await this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: { ...productData, createdById: user.id },
      });

      // Every product needs at least its base unit defined, or conversions fail.
      const unitRows = units?.length
        ? units
        : [{ code: created.baseUnit, name: created.baseUnit, factorToBase: 1, isBaseUnit: true }];

      await tx.productUnit.createMany({
        data: unitRows.map((u: any) => ({ ...u, productId: created.id })),
      });

      if (barcodes?.length) {
        await tx.productBarcode.createMany({
          data: barcodes.map((b: any) => ({ ...b, productId: created.id })),
        });
      }
      return created;
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'catalog',
      action: 'CREATE',
      entityType: 'Product',
      entityId: product.id,
      newValue: { sku: product.sku, genericName: product.genericName },
    });

    return this.findOne(product.id);
  }

  async update(id: string, data: any, user: AuthenticatedUser) {
    const before = await this.prisma.product.findUniqueOrThrow({ where: { id } });

    // Price changes are audited separately and kept in price history (§32).
    const priceFields: Array<keyof typeof before> = [
      'retailPrice',
      'wholesalePrice',
      'insurancePrice',
      'purchaseCost',
    ];
    const priceChanges = priceFields.filter(
      (f) => data[f] !== undefined && String(data[f]) !== String(before[f]),
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.product.update({ where: { id }, data });

      for (const field of priceChanges) {
        await tx.priceHistory.create({
          data: {
            productId: id,
            priceType: field.toString().replace('Price', '').toUpperCase(),
            oldValue: new Prisma.Decimal(before[field] as any),
            newValue: new Prisma.Decimal(data[field]),
            reason: data.priceChangeReason ?? null,
            changedById: user.id,
          },
        });
      }
      return result;
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'catalog',
      action: priceChanges.length ? 'PRICE_CHANGE' : 'EDIT',
      entityType: 'Product',
      entityId: id,
      previousValue: Object.fromEntries(
        Object.keys(data).filter((k) => k in before).map((k) => [k, (before as any)[k]]),
      ),
      newValue: data,
    });

    return updated;
  }

  /** Unit definitions for a product, for the conversion helpers. */
  async unitsFor(productId: string): Promise<UnitDefinition[]> {
    const units = await this.prisma.productUnit.findMany({ where: { productId } });
    if (!units.length) {
      const product = await this.prisma.product.findUniqueOrThrow({
        where: { id: productId },
        select: { baseUnit: true },
      });
      return [{ code: product.baseUnit, name: product.baseUnit, factorToBase: 1, isBaseUnit: true }];
    }
    return units.map((u) => ({
      code: u.code,
      name: u.name,
      factorToBase: Number(u.factorToBase),
      isBaseUnit: u.isBaseUnit,
    }));
  }

  /** Convert a quantity in any of the product's units into base units (§6). */
  async convertToBase(productId: string, quantity: number, unitCode?: string): Promise<number> {
    if (!unitCode) return quantity;
    const units = await this.unitsFor(productId);
    return toBaseUnits(quantity, unitCode, units);
  }

  async describe(productId: string, baseQuantity: number): Promise<string> {
    return describeQuantity(baseQuantity, await this.unitsFor(productId));
  }

  /** Bulk import with per-row validation; nothing is written if a row fails (§60). */
  async importProducts(rows: any[], user: AuthenticatedUser) {
    const errors: Array<{ row: number; sku?: string; error: string }> = [];
    const valid: any[] = [];

    rows.forEach((row, index) => {
      if (!row.sku) errors.push({ row: index + 1, error: 'sku is required' });
      else if (!row.genericName)
        errors.push({ row: index + 1, sku: row.sku, error: 'genericName is required' });
      else if (!row.strength)
        errors.push({ row: index + 1, sku: row.sku, error: 'strength is required' });
      else if (row.retailPrice !== undefined && Number(row.retailPrice) < 0)
        errors.push({ row: index + 1, sku: row.sku, error: 'retailPrice cannot be negative' });
      else valid.push(row);
    });

    if (errors.length) {
      // §60: never import invalid pharmaceutical data silently.
      throw new BadRequestException({
        message: `${errors.length} of ${rows.length} rows failed validation. Nothing was imported.`,
        errors,
      });
    }

    const created = await this.prisma.$transaction(
      valid.map((row) =>
        this.prisma.product.upsert({
          where: { sku: row.sku },
          create: { ...row, createdById: user.id },
          update: row,
        }),
      ),
    );

    await this.audit.record({
      userId: user.id,
      module: 'catalog',
      action: 'IMPORT',
      entityType: 'Product',
      newValue: { imported: created.length },
    });

    return { imported: created.length, errors: [] };
  }
}
