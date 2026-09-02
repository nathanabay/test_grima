import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';

/** The relationship types a product may declare, and their inverses. */
const RELATION_TYPES = {
  FAMILY: 'FAMILY',
  VARIANT: 'VARIANT',
  ALTERNATIVE_BRAND: 'ALTERNATIVE_BRAND',
  GENERIC_EQUIVALENT: 'GENERIC_EQUIVALENT',
  SUBSTITUTE: 'SUBSTITUTE',
} as const;

type RelationType = keyof typeof RELATION_TYPES;

/**
 * All five relationships are symmetric: if A is a generic equivalent of B then
 * B is one of A. Writing both directions means a substitution lookup returns
 * the same set whichever product the pharmacist started from.
 */
const SYMMETRIC: RelationType[] = [
  'FAMILY',
  'VARIANT',
  'ALTERNATIVE_BRAND',
  'GENERIC_EQUIVALENT',
  'SUBSTITUTE',
];

/**
 * Ingredients, product relationships and administrator-defined attributes
 * (§1: features 4-7, 30-34, 49).
 */
@Injectable()
export class ProductDepthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---- Active ingredients ----

  async listIngredients(productId: string) {
    return this.prisma.productIngredient.findMany({
      where: { productId },
      orderBy: [{ role: 'asc' }, { sequence: 'asc' }],
    });
  }

  /**
   * Replace a product's ingredient list in one transaction.
   *
   * Replacement rather than incremental edits, because a combination product's
   * formula is a single fact — half-applying a change would describe a medicine
   * that does not exist.
   */
  async setIngredients(
    productId: string,
    ingredients: {
      name: string;
      strengthValue?: number | string | null;
      strengthUnit?: string | null;
      role?: string;
      sequence?: number;
    }[],
    user: AuthenticatedUser,
  ) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    const cleaned = ingredients
      .map((i, index) => ({
        name: (i.name ?? '').trim(),
        strengthValue:
          i.strengthValue === null || i.strengthValue === undefined || i.strengthValue === ''
            ? null
            : new Prisma.Decimal(i.strengthValue),
        strengthUnit: i.strengthUnit?.trim() || null,
        role: (i.role ?? 'ACTIVE').toUpperCase(),
        sequence: i.sequence ?? index,
      }))
      .filter((i) => i.name.length > 0);

    for (const i of cleaned) {
      if (!['ACTIVE', 'EXCIPIENT'].includes(i.role)) {
        throw new BadRequestException(`Ingredient role must be ACTIVE or EXCIPIENT, got '${i.role}'`);
      }
      if (i.strengthValue && i.strengthValue.lessThan(0)) {
        throw new BadRequestException(`Ingredient "${i.name}" cannot have a negative strength`);
      }
      if (i.strengthValue && !i.strengthUnit) {
        throw new BadRequestException(
          `Ingredient "${i.name}" has a strength but no unit; 500 of what?`,
        );
      }
    }

    const duplicates = cleaned
      .map((i) => `${i.name.toLowerCase()}|${i.role}`)
      .filter((key, index, all) => all.indexOf(key) !== index);
    if (duplicates.length) {
      throw new BadRequestException('The same ingredient is listed twice in the same role');
    }

    const before = await this.listIngredients(productId);

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.productIngredient.deleteMany({ where: { productId } });
      if (cleaned.length) {
        await tx.productIngredient.createMany({
          data: cleaned.map((i) => ({ ...i, productId })),
        });
      }
      // Keep the denormalised summary on the product in step, so existing
      // searches and printed labels stay correct.
      const actives = cleaned.filter((i) => i.role === 'ACTIVE');
      if (actives.length) {
        await tx.product.update({
          where: { id: productId },
          data: {
            activeIngredient: actives.map((i) => i.name).join(' + '),
            strength: actives
              .map((i) => (i.strengthValue ? `${i.strengthValue.toString()}${i.strengthUnit}` : ''))
              .filter(Boolean)
              .join(' + '),
          },
        });
      }
      return tx.productIngredient.findMany({
        where: { productId },
        orderBy: [{ role: 'asc' }, { sequence: 'asc' }],
      });
    });

    await this.audit.record({
      userId: user.id,
      module: 'catalog',
      action: 'EDIT',
      entityType: 'ProductIngredient',
      entityId: productId,
      previousValue: before,
      newValue: result,
    });

    return result;
  }

  /** Find products containing an ingredient (§12: feature 558, ingredient search). */
  async searchByIngredient(name: string, limit = 50) {
    return this.prisma.product.findMany({
      where: {
        isActive: true,
        ingredients: { some: { name: { contains: name, mode: 'insensitive' }, role: 'ACTIVE' } },
      },
      select: {
        id: true,
        sku: true,
        genericName: true,
        brandName: true,
        strength: true,
        dosageForm: true,
        ingredients: { where: { role: 'ACTIVE' }, orderBy: { sequence: 'asc' } },
      },
      take: Math.min(limit, 200),
      orderBy: { genericName: 'asc' },
    });
  }

  // ---- Relationships ----

  async listRelations(productId: string) {
    const rows = await this.prisma.productRelation.findMany({
      where: { productId },
      include: {
        relatedProduct: {
          select: {
            id: true,
            sku: true,
            genericName: true,
            brandName: true,
            strength: true,
            dosageForm: true,
            isActive: true,
            retailPrice: true,
          },
        },
      },
      orderBy: { relationType: 'asc' },
    });

    return rows.map((r) => ({
      id: r.id,
      relationType: r.relationType,
      notes: r.notes,
      product: r.relatedProduct,
    }));
  }

  async addRelation(
    productId: string,
    data: { relatedProductId: string; relationType: string; notes?: string },
    user: AuthenticatedUser,
  ) {
    const relationType = data.relationType?.toUpperCase() as RelationType;
    if (!RELATION_TYPES[relationType]) {
      throw new BadRequestException(
        `Relation type must be one of: ${Object.keys(RELATION_TYPES).join(', ')}`,
      );
    }
    if (productId === data.relatedProductId) {
      throw new BadRequestException('A product cannot be related to itself');
    }

    const [product, related] = await Promise.all([
      this.prisma.product.findUnique({ where: { id: productId }, select: { id: true } }),
      this.prisma.product.findUnique({
        where: { id: data.relatedProductId },
        select: { id: true, genericName: true },
      }),
    ]);
    if (!product) throw new NotFoundException('Product not found');
    if (!related) throw new NotFoundException('Related product not found');

    const created = await this.prisma.$transaction(async (tx) => {
      const forward = await tx.productRelation.upsert({
        where: {
          productId_relatedProductId_relationType: {
            productId,
            relatedProductId: data.relatedProductId,
            relationType,
          },
        },
        create: {
          productId,
          relatedProductId: data.relatedProductId,
          relationType,
          notes: data.notes,
          createdById: user.id,
        },
        update: { notes: data.notes },
      });

      if (SYMMETRIC.includes(relationType)) {
        await tx.productRelation.upsert({
          where: {
            productId_relatedProductId_relationType: {
              productId: data.relatedProductId,
              relatedProductId: productId,
              relationType,
            },
          },
          create: {
            productId: data.relatedProductId,
            relatedProductId: productId,
            relationType,
            notes: data.notes,
            createdById: user.id,
          },
          update: { notes: data.notes },
        });
      }

      return forward;
    });

    await this.audit.record({
      userId: user.id,
      module: 'catalog',
      action: 'CREATE',
      entityType: 'ProductRelation',
      entityId: created.id,
      newValue: { productId, ...data, relationType },
    });

    return created;
  }

  async removeRelation(relationId: string, user: AuthenticatedUser) {
    const relation = await this.prisma.productRelation.findUnique({ where: { id: relationId } });
    if (!relation) throw new NotFoundException('Relation not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.productRelation.delete({ where: { id: relationId } });
      // Remove the inverse too, or the pair becomes one-directional and the
      // substitution list stops agreeing with itself.
      await tx.productRelation.deleteMany({
        where: {
          productId: relation.relatedProductId,
          relatedProductId: relation.productId,
          relationType: relation.relationType,
        },
      });
    });

    await this.audit.record({
      userId: user.id,
      module: 'catalog',
      action: 'DELETE',
      entityType: 'ProductRelation',
      entityId: relationId,
      previousValue: relation,
    });

    return { removed: true };
  }

  /**
   * Substitutes that could actually be dispensed right now: related products
   * that are active and have sellable stock in the given branch.
   */
  async availableSubstitutes(productId: string, branchId?: string) {
    const relations = await this.prisma.productRelation.findMany({
      where: {
        productId,
        relationType: { in: ['GENERIC_EQUIVALENT', 'SUBSTITUTE', 'ALTERNATIVE_BRAND'] },
      },
      include: {
        relatedProduct: {
          select: {
            id: true,
            sku: true,
            genericName: true,
            brandName: true,
            strength: true,
            dosageForm: true,
            isActive: true,
            retailPrice: true,
            requiresPrescription: true,
          },
        },
      },
    });

    const candidates = relations.filter((r) => r.relatedProduct.isActive);
    if (!candidates.length) return [];

    const balances = await this.prisma.inventoryBalance.groupBy({
      by: ['productId'],
      where: {
        productId: { in: candidates.map((r) => r.relatedProductId) },
        ...(branchId ? { branchId } : {}),
        // Only stock that could actually leave the shelf (§8).
        batch: { status: { in: ['AVAILABLE', 'RELEASED'] }, expiryDate: { gt: new Date() } },
      },
      _sum: { onHand: true, reserved: true },
    });

    const stock = new Map(
      balances.map((b) => [
        b.productId,
        Number(b._sum.onHand ?? 0) - Number(b._sum.reserved ?? 0),
      ]),
    );

    return candidates
      .map((r) => ({
        relationType: r.relationType,
        product: r.relatedProduct,
        available: stock.get(r.relatedProductId) ?? 0,
      }))
      .sort((a, b) => b.available - a.available);
  }

  // ---- Custom attributes ----

  async listAttributeDefinitions(includeInactive = false) {
    return this.prisma.attributeDefinition.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ group: 'asc' }, { sequence: 'asc' }],
    });
  }

  async createAttributeDefinition(data: Record<string, unknown>, user: AuthenticatedUser) {
    const dataType = String(data.dataType ?? 'TEXT').toUpperCase();
    if (!['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'SELECT'].includes(dataType)) {
      throw new BadRequestException('dataType must be TEXT, NUMBER, BOOLEAN, DATE or SELECT');
    }
    if (dataType === 'SELECT' && !(data.options as string[])?.length) {
      throw new BadRequestException('A SELECT attribute needs at least one option');
    }

    const created = await this.prisma.attributeDefinition.create({
      data: { ...(data as any), dataType },
    });
    await this.audit.record({
      userId: user.id,
      module: 'catalog',
      action: 'CREATE',
      entityType: 'AttributeDefinition',
      entityId: created.id,
      newValue: created,
    });
    return created;
  }

  private validateAttributeValue(
    definition: { code: string; dataType: string; options: string[] },
    value: string,
  ): string {
    switch (definition.dataType) {
      case 'NUMBER':
        if (!Number.isFinite(Number(value))) {
          throw new BadRequestException(`${definition.code} must be a number`);
        }
        return String(Number(value));
      case 'BOOLEAN':
        return ['true', '1', 'yes'].includes(value.toLowerCase()) ? 'true' : 'false';
      case 'DATE': {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
          throw new BadRequestException(`${definition.code} must be a valid date`);
        }
        return parsed.toISOString().slice(0, 10);
      }
      case 'SELECT':
        if (!definition.options.includes(value)) {
          throw new BadRequestException(
            `${definition.code} must be one of: ${definition.options.join(', ')}`,
          );
        }
        return value;
      default:
        return value;
    }
  }

  async listAttributes(productId: string) {
    const [definitions, values] = await Promise.all([
      this.listAttributeDefinitions(),
      this.prisma.productAttribute.findMany({ where: { productId } }),
    ]);
    const byDefinition = new Map(values.map((v) => [v.definitionId, v]));

    return definitions.map((d) => ({
      definitionId: d.id,
      code: d.code,
      label: d.label,
      dataType: d.dataType,
      options: d.options,
      group: d.group,
      isRequired: d.isRequired,
      value: byDefinition.get(d.id)?.value ?? null,
    }));
  }

  async setAttributes(
    productId: string,
    values: Record<string, string>,
    user: AuthenticatedUser,
  ) {
    const definitions = await this.prisma.attributeDefinition.findMany({
      where: { code: { in: Object.keys(values) }, isActive: true },
    });
    const byCode = new Map(definitions.map((d) => [d.code, d]));

    const unknown = Object.keys(values).filter((code) => !byCode.has(code));
    if (unknown.length) {
      throw new BadRequestException(`Unknown attribute(s): ${unknown.join(', ')}`);
    }

    const before = await this.prisma.productAttribute.findMany({ where: { productId } });

    // Validate everything first: a bad value halfway through must not leave the
    // product half-updated.
    const validated = Object.entries(values).map(([code, raw]) => {
      const definition = byCode.get(code)!;
      return { definition, value: this.validateAttributeValue(definition, String(raw ?? '')) };
    });

    await this.prisma.$transaction(
      validated.map(({ definition, value }) =>
        value === ''
          ? this.prisma.productAttribute.deleteMany({
              where: { productId, definitionId: definition.id },
            })
          : this.prisma.productAttribute.upsert({
              where: { productId_definitionId: { productId, definitionId: definition.id } },
              create: { productId, definitionId: definition.id, value },
              update: { value },
            }),
      ),
    );

    await this.audit.record({
      userId: user.id,
      module: 'catalog',
      action: 'EDIT',
      entityType: 'ProductAttribute',
      entityId: productId,
      previousValue: before,
      newValue: validated.map((v) => ({ code: v.definition.code, value: v.value })),
    });

    return this.listAttributes(productId);
  }
}
