import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StorageCondition } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';

export interface BinSuggestion {
  locationId: string;
  code: string;
  name: string;
  score: number;
  freeUnits: number | null;
  occupancyPercent: number | null;
  reasons: string[];
}

/** Location types stock can never be picked from for a sale or dispensing. */
export const NON_SELLABLE_LOCATION_TYPES = [
  'QUARANTINE',
  'DAMAGED',
  'RECALL_HOLD',
  'RETURNS',
];

/**
 * Storage locations, their capacity, and where a given product should go
 * (§5: features 211-236).
 */
@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Storage conditions a location can satisfy.
   *
   * A freezer can hold a refrigerated product, and a refrigerator can hold a
   * room-temperature one — the reverse is never true, which is the whole point
   * of checking. Being deliberate about the direction stops a vaccine being
   * put away on an ambient shelf because both were "cold-ish".
   */
  private satisfies(provided: StorageCondition, required: StorageCondition): boolean {
    const rank: Record<string, number> = {
      FROZEN: 0,
      REFRIGERATED: 1,
      COOL: 2,
      ROOM_TEMPERATURE: 3,
    };
    const p = rank[provided];
    const r = rank[required];
    if (p === undefined || r === undefined) return provided === required;
    // A colder location satisfies a warmer requirement.
    return p <= r;
  }

  async list(warehouseId: string, filter: { locationType?: string; level?: string } = {}) {
    return this.prisma.warehouseLocation.findMany({
      where: {
        warehouseId,
        ...(filter.locationType ? { locationType: filter.locationType } : {}),
        ...(filter.level ? { level: filter.level } : {}),
      },
      orderBy: [{ level: 'asc' }, { pickSequence: 'asc' }, { code: 'asc' }],
    });
  }

  async create(data: Record<string, unknown>, user: AuthenticatedUser) {
    const created = await this.prisma.warehouseLocation.create({ data: data as any });
    await this.audit.record({
      userId: user.id,
      module: 'inventory',
      action: 'CREATE',
      entityType: 'WarehouseLocation',
      entityId: created.id,
      newValue: created,
    });
    return created;
  }

  async update(id: string, data: Record<string, unknown>, user: AuthenticatedUser) {
    const before = await this.prisma.warehouseLocation.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Location not found');

    const updated = await this.prisma.warehouseLocation.update({ where: { id }, data });
    await this.audit.record({
      userId: user.id,
      module: 'inventory',
      action: 'EDIT',
      entityType: 'WarehouseLocation',
      entityId: id,
      previousValue: before,
      newValue: updated,
    });
    return updated;
  }

  /** Resolve a scanned shelf label to a location (§5: feature 227). */
  async findByBarcode(barcode: string) {
    const location = await this.prisma.warehouseLocation.findUnique({
      where: { barcode },
      include: { warehouse: { select: { id: true, code: true, name: true } } },
    });
    if (!location) throw new NotFoundException(`No location carries the barcode ${barcode}`);
    return location;
  }

  /**
   * Occupancy per location (§5: features 229-231).
   *
   * Occupancy is quantity against declared capacity. A location with no
   * declared capacity reports null rather than 0% — pretending an unmetered
   * shelf is empty would send every put-away to it.
   */
  async occupancy(warehouseId: string) {
    const [locations, balances] = await Promise.all([
      this.prisma.warehouseLocation.findMany({
        where: { warehouseId, isActive: true },
        orderBy: [{ pickSequence: 'asc' }, { code: 'asc' }],
      }),
      this.prisma.inventoryBalance.groupBy({
        by: ['locationId'],
        where: { warehouseId, onHand: { gt: 0 } },
        _sum: { onHand: true },
        _count: { productId: true },
      }),
    ]);

    const used = new Map(
      balances
        .filter((b) => b.locationId)
        .map((b) => [b.locationId as string, { units: Number(b._sum.onHand ?? 0), lines: b._count.productId }]),
    );

    const rows = locations.map((location) => {
      const usage = used.get(location.id) ?? { units: 0, lines: 0 };
      const capacity = location.capacityUnits ? Number(location.capacityUnits) : null;
      return {
        id: location.id,
        code: location.code,
        name: location.name,
        level: location.level,
        locationType: location.locationType,
        storageCondition: location.storageCondition,
        isPickFace: location.isPickFace,
        barcode: location.barcode,
        capacityUnits: capacity,
        usedUnits: usage.units,
        distinctProducts: usage.lines,
        freeUnits: capacity === null ? null : Math.max(0, capacity - usage.units),
        occupancyPercent: capacity === null ? null : Math.round((usage.units / capacity) * 100),
        isEmpty: usage.units === 0,
      };
    });

    const metered = rows.filter((r) => r.capacityUnits !== null);
    return {
      warehouseId,
      locations: rows,
      summary: {
        total: rows.length,
        empty: rows.filter((r) => r.isEmpty).length,
        // Averaged over metered locations only; including unmetered ones would
        // report a capacity figure that nobody declared.
        averageOccupancyPercent: metered.length
          ? Math.round(metered.reduce((sum, r) => sum + (r.occupancyPercent ?? 0), 0) / metered.length)
          : null,
        overCapacity: rows.filter((r) => (r.occupancyPercent ?? 0) > 100).length,
        unmetered: rows.length - metered.length,
      },
    };
  }

  /**
   * Recommend where to put a product away (§5: feature 224).
   *
   * Ranked, with the reasoning attached, because a storekeeper who disagrees
   * needs to see why the system chose a bin before overriding it.
   */
  async suggestBins(
    productId: string,
    warehouseId: string,
    quantity: number,
    limit = 5,
  ): Promise<BinSuggestion[]> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        genericName: true,
        storageCondition: true,
        isControlled: true,
        isColdChain: true,
      },
    });
    if (!product) throw new NotFoundException('Product not found');

    const occupancy = await this.occupancy(warehouseId);

    // A put-away target is a leaf: somewhere stock physically sits. Keying off
    // the level name would exclude a functional area like the controlled
    // cabinet or the quarantine hold, which are zones with no bins beneath them
    // and are exactly where that stock belongs.
    const parents = await this.prisma.warehouseLocation.findMany({
      where: { warehouseId, parentId: { not: null } },
      select: { parentId: true },
    });
    const hasChildren = new Set(parents.map((p) => p.parentId as string));

    // Where this product already lives: consolidating beats scattering.
    const existing = await this.prisma.inventoryBalance.findMany({
      where: { productId, warehouseId, onHand: { gt: 0 }, locationId: { not: null } },
      select: { locationId: true },
    });
    const existingLocations = new Set(existing.map((e) => e.locationId as string));

    const candidates = occupancy.locations
      .filter((location) => {
        if (hasChildren.has(location.id)) return false;
        if (NON_SELLABLE_LOCATION_TYPES.includes(location.locationType)) return false;
        if (['RECEIVING', 'DISPATCH', 'STAGING', 'DOCK'].includes(location.locationType)) return false;
        // A controlled medicine only ever goes to controlled storage, and
        // controlled storage takes nothing else (§28).
        if (product.isControlled !== (location.locationType === 'CONTROLLED')) return false;
        if (!this.satisfies(location.storageCondition, product.storageCondition)) return false;
        // A metered bin that cannot hold the quantity is not a candidate.
        if (location.freeUnits !== null && location.freeUnits < quantity) return false;
        return true;
      })
      .map((location) => {
        const reasons: string[] = [];
        let score = 0;

        if (existingLocations.has(location.id)) {
          score += 50;
          reasons.push('Already holds this product, so the stock stays consolidated');
        }
        if (location.isPickFace) {
          score += 25;
          reasons.push('Pick face, so the stock is immediately pickable');
        }
        if (location.storageCondition === product.storageCondition) {
          score += 15;
          reasons.push(`Storage condition matches exactly (${location.storageCondition})`);
        } else {
          score += 5;
          reasons.push(
            `${location.storageCondition} storage also satisfies a ${product.storageCondition} requirement`,
          );
        }
        if (location.occupancyPercent !== null) {
          // Prefer bins with room, without preferring completely empty ones so
          // strongly that stock ends up scattered across the warehouse.
          const headroom = 100 - location.occupancyPercent;
          score += Math.min(20, Math.round(headroom / 5));
          reasons.push(`${location.occupancyPercent}% full, ${location.freeUnits} unit(s) free`);
        } else {
          score += 8;
          reasons.push('Capacity is not metered on this location');
        }
        if (product.isControlled) {
          reasons.push('Controlled-medicine storage');
        }

        return {
          locationId: location.id,
          code: location.code,
          name: location.name,
          score,
          freeUnits: location.freeUnits,
          occupancyPercent: location.occupancyPercent,
          reasons,
        };
      })
      .sort((a, b) => b.score - a.score);

    return candidates.slice(0, limit);
  }

  /**
   * Check a proposed put-away before it happens, so the caller gets a reason
   * rather than a silent failure.
   */
  async validatePutaway(productId: string, locationId: string, quantity: number) {
    const [product, location] = await Promise.all([
      this.prisma.product.findUnique({
        where: { id: productId },
        select: { genericName: true, storageCondition: true, isControlled: true },
      }),
      this.prisma.warehouseLocation.findUnique({ where: { id: locationId } }),
    ]);
    if (!product) throw new NotFoundException('Product not found');
    if (!location) throw new NotFoundException('Location not found');

    const problems: string[] = [];

    if (!location.isActive) problems.push(`${location.code} is not active`);

    if (!this.satisfies(location.storageCondition, product.storageCondition)) {
      problems.push(
        `${product.genericName} needs ${product.storageCondition} storage; ${location.code} provides ${location.storageCondition}`,
      );
    }

    if (product.isControlled && location.locationType !== 'CONTROLLED') {
      problems.push(
        `${product.genericName} is a controlled medicine and must be stored in controlled storage (§28)`,
      );
    }
    if (!product.isControlled && location.locationType === 'CONTROLLED') {
      problems.push(`${location.code} is reserved for controlled medicines`);
    }

    if (location.capacityUnits) {
      const current = await this.prisma.inventoryBalance.aggregate({
        where: { locationId, onHand: { gt: 0 } },
        _sum: { onHand: true },
      });
      const used = Number(current._sum.onHand ?? 0);
      const free = Number(location.capacityUnits) - used;
      if (free < quantity) {
        problems.push(
          `${location.code} has ${free} unit(s) free but ${quantity} were offered`,
        );
      }
    }

    return { allowed: problems.length === 0, problems, location, product };
  }

  /** Where a product has been stored over time (§5: feature 232). */
  async productLocationHistory(productId: string, warehouseId?: string, limit = 200) {
    const movements = await this.prisma.inventoryTransaction.findMany({
      where: {
        productId,
        ...(warehouseId ? { warehouseId } : {}),
        locationId: { not: null },
      },
      orderBy: { occurredAt: 'desc' },
      take: Math.min(limit, 500),
      select: {
        id: true,
        occurredAt: true,
        type: true,
        quantityIn: true,
        quantityOut: true,
        locationId: true,
        warehouseId: true,
        batchId: true,
        referenceType: true,
        referenceNo: true,
      },
    });

    const locationIds = [...new Set(movements.map((m) => m.locationId as string))];
    const locations = await this.prisma.warehouseLocation.findMany({
      where: { id: { in: locationIds } },
      select: { id: true, code: true, name: true },
    });
    const byId = new Map(locations.map((l) => [l.id, l]));

    return movements.map((m) => ({
      ...m,
      locationCode: byId.get(m.locationId as string)?.code ?? null,
      locationName: byId.get(m.locationId as string)?.name ?? null,
    }));
  }

  /**
   * Bins whose pick face has run low and can be topped up from bulk
   * (§5: features 235-236).
   */
  async replenishmentNeeds(warehouseId: string) {
    const pickFaces = await this.prisma.warehouseLocation.findMany({
      where: { warehouseId, isPickFace: true, isActive: true },
      select: { id: true, code: true, name: true, capacityUnits: true },
    });
    if (!pickFaces.length) return [];

    const balances = await this.prisma.inventoryBalance.findMany({
      where: { warehouseId, locationId: { in: pickFaces.map((p) => p.id) } },
      include: {
        product: { select: { id: true, sku: true, genericName: true, strength: true } },
      },
    });

    const bulk = await this.prisma.inventoryBalance.findMany({
      where: {
        warehouseId,
        onHand: { gt: 0 },
        location: { isPickFace: false, locationType: { in: ['GENERAL', 'BULK'] } },
        batch: { status: { in: ['AVAILABLE', 'RELEASED'] } },
      },
      include: { location: { select: { id: true, code: true } } },
    });

    const bulkByProduct = new Map<string, { locationId: string; code: string; onHand: number }[]>();
    for (const b of bulk) {
      if (!b.location) continue;
      const list = bulkByProduct.get(b.productId) ?? [];
      list.push({ locationId: b.location.id, code: b.location.code, onHand: Number(b.onHand) });
      bulkByProduct.set(b.productId, list);
    }

    const needs: {
      productId: string;
      product: { id: string; sku: string; genericName: string; strength: string };
      pickFaceId: string;
      pickFaceCode: string;
      onHand: number;
      capacity: number;
      suggestedQuantity: number;
      sources: { locationId: string; code: string; onHand: number }[];
      reason: string;
    }[] = [];
    for (const balance of balances) {
      const face = pickFaces.find((p) => p.id === balance.locationId);
      if (!face?.capacityUnits) continue;

      const capacity = Number(face.capacityUnits);
      const onHand = Number(balance.onHand);
      // Top up below a third full; above that the trip is not worth making.
      if (onHand > capacity / 3) continue;

      const sources = bulkByProduct.get(balance.productId) ?? [];
      if (!sources.length) continue;

      needs.push({
        productId: balance.productId,
        product: balance.product,
        pickFaceId: face.id,
        pickFaceCode: face.code,
        onHand,
        capacity,
        suggestedQuantity: Math.min(
          capacity - onHand,
          sources.reduce((sum, s) => sum + s.onHand, 0),
        ),
        sources,
        reason: `Pick face is ${Math.round((onHand / capacity) * 100)}% full`,
      });
    }

    return needs.sort((a, b) => a.onHand / a.capacity - b.onHand / b.capacity);
  }
}
