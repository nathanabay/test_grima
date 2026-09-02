import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  FefoCandidate,
  FefoResult,
  FefoTieBreak,
  allocateFefo,
  recommendBatch,
} from '@pharmacore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConfigService } from '../../common/config/config.service';

export interface FefoRequest {
  productId: string;
  warehouseId: string;
  quantity: number;
  minRemainingDays?: number;
  now?: Date;
}

/**
 * FEFO allocation against live stock (§8).
 *
 * The decision logic lives in the shared package so it can be unit tested
 * without a database; this service is responsible for loading a truthful set of
 * candidates - on hand minus reserved, joined to batch status and expiry.
 */
@Injectable()
export class FefoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * How to order two batches that FEFO cannot separate (§8, §65).
   *
   * Expiry order itself is never configurable - that is the patient-safety
   * rule. This decides only the tie, from the existing inventory.pickStrategy
   * setting, so an administrator has one place to look rather than two keys
   * that mean nearly the same thing.
   */
  private async tieBreak(): Promise<FefoTieBreak> {
    return (await this.config.getString('inventory.pickStrategy')) === 'LIFO'
      ? 'LIFO'
      : 'FIFO';
  }

  /** Load every stock position for a product in a warehouse as FEFO candidates. */
  async loadCandidates(
    productId: string,
    warehouseId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<FefoCandidate[]> {
    const client = tx ?? this.prisma;
    const balances = await client.inventoryBalance.findMany({
      where: { productId, warehouseId, batchId: { not: null } },
      include: { batch: true },
    });

    return balances
      .filter((b) => b.batch !== null)
      .map((b) => ({
        batchId: b.batch!.id,
        batchNumber: b.batch!.batchNumber,
        expiryDate: b.batch!.expiryDate,
        status: b.batch!.status as FefoCandidate['status'],
        availableQuantity: Number(b.onHand.minus(b.reserved)),
        warehouseId: b.warehouseId,
        locationId: b.locationId,
        unitCost: Number(b.batch!.purchaseCost),
        // Only used to break a tie between equal expiry dates.
        receivedDate: b.batch!.receivedDate,
      }));
  }

  /** Which batches to draw from, nearest valid expiry first. */
  async allocate(request: FefoRequest, tx?: Prisma.TransactionClient): Promise<FefoResult> {
    if (request.quantity <= 0) {
      throw new BadRequestException('Quantity must be greater than zero');
    }
    const candidates = await this.loadCandidates(
      request.productId,
      request.warehouseId,
      tx,
    );
    return allocateFefo(request.quantity, candidates, {
      now: request.now,
      minRemainingDays: request.minRemainingDays,
      warehouseId: request.warehouseId,
      tieBreak: await this.tieBreak(),
    });
  }

  /** The batch FEFO recommends - used to detect and audit manual overrides. */
  async recommend(
    productId: string,
    warehouseId: string,
    options: { minRemainingDays?: number; now?: Date } = {},
  ): Promise<FefoCandidate | null> {
    const candidates = await this.loadCandidates(productId, warehouseId);
    return recommendBatch(candidates, {
      ...options,
      warehouseId,
      tieBreak: await this.tieBreak(),
    });
  }

  /**
   * Validate an operator's manual batch choice (§8). An override is permitted
   * but must be justified, and the reason plus the batch FEFO would have picked
   * are returned so the caller can persist both.
   */
  async validateOverride(input: {
    productId: string;
    warehouseId: string;
    chosenBatchId: string;
    quantity: number;
    reason?: string;
  }): Promise<{
    isOverride: boolean;
    recommendedBatchId: string | null;
    recommendedBatchNumber: string | null;
    chosenBatch: FefoCandidate;
  }> {
    const candidates = await this.loadCandidates(input.productId, input.warehouseId);
    const chosen = candidates.find((c) => c.batchId === input.chosenBatchId);
    if (!chosen) {
      throw new BadRequestException('Selected batch holds no stock in this warehouse');
    }

    // Run the allocator over just this batch to reuse the exclusion rules.
    const check = allocateFefo(input.quantity, [chosen], {
      warehouseId: input.warehouseId,
    });
    if (!check.fullyAllocated) {
      const reason =
        check.excluded[0]?.reason ??
        `Batch holds only ${chosen.availableQuantity} available units`;
      throw new BadRequestException(`Selected batch cannot be used: ${reason}`);
    }

    const recommended = recommendBatch(candidates, { warehouseId: input.warehouseId });
    const isOverride = recommended !== null && recommended.batchId !== input.chosenBatchId;

    if (isOverride && !input.reason?.trim()) {
      throw new BadRequestException(
        `Batch ${chosen.batchNumber} is not the FEFO recommendation ` +
          `(${recommended?.batchNumber} expires sooner). A reason is required to override.`,
      );
    }

    return {
      isOverride,
      recommendedBatchId: recommended?.batchId ?? null,
      recommendedBatchNumber: recommended?.batchNumber ?? null,
      chosenBatch: chosen,
    };
  }
}
