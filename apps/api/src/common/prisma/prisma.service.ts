import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Single Prisma client for the process.
 *
 * `SERIALIZABLE` is deliberately NOT the default: it would make every POS sale
 * contend. Instead, inventory-mutating code paths open an interactive
 * transaction and take explicit row locks via `lockBalanceRows` (§48), which
 * gives us the strict ordering we need only where stock is actually moving.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      log:
        process.env.NODE_ENV === 'development'
          ? [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }]
          : [{ emit: 'event', level: 'error' }],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Lock the inventory_balances rows for a product (optionally a single batch)
   * inside the current transaction. Any concurrent transaction touching the
   * same stock blocks here until this one commits or rolls back, which is what
   * prevents two pharmacists from both selling the last 10 units (§68).
   *
   * Must be called inside `$transaction`; `tx` is the transactional client.
   */
  async lockBalanceRows(
    tx: Prisma.TransactionClient,
    productId: string,
    warehouseId: string,
    batchId?: string,
  ): Promise<void> {
    if (batchId) {
      await tx.$queryRaw`
        SELECT id FROM inventory_balances
        WHERE "productId" = ${productId}::uuid
          AND "warehouseId" = ${warehouseId}::uuid
          AND "batchId" = ${batchId}::uuid
        FOR UPDATE`;
    } else {
      await tx.$queryRaw`
        SELECT id FROM inventory_balances
        WHERE "productId" = ${productId}::uuid
          AND "warehouseId" = ${warehouseId}::uuid
        FOR UPDATE`;
    }
  }

  /**
   * Advisory lock keyed on an arbitrary string, used to serialize operations
   * that have no balance row to lock yet (e.g. the first receipt of a batch,
   * or document-number generation).
   */
  async advisoryLock(tx: Prisma.TransactionClient, key: string): Promise<void> {
    // hashtext() maps the key onto the bigint that pg_advisory_xact_lock wants.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  }
}
