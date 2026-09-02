import 'reflect-metadata';
import { loadEnv } from '../common/config/env';

// Same reason as main.ts: the repository keeps one .env at its root and each
// workspace package runs from its own directory (§65).
loadEnv(__dirname);

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { PrismaService } from '../common/prisma/prisma.service';
import { PostingService } from '../modules/accounting/posting.service';
import { AutomationService } from '../modules/automation/automation.service';
import { PickingService } from '../modules/warehouse/picking.service';
import { WarehouseTasksService } from '../modules/warehouse/tasks.service';
import { LocationsService } from '../modules/warehouse/locations.service';
import { AuthenticatedUser } from '../common/decorators';

/**
 * Bring the seeded database to the state a running pharmacy would already be
 * in (§68 demo data).
 *
 * This runs *after* prisma/seed.ts and deliberately does its work through the
 * real services rather than writing rows itself. A seeded journal entry written
 * by hand would be a second implementation of posting, and would drift from the
 * one the application uses; running the posting service means the ledger the
 * demo shows is the ledger the code produces. The same argument applies to
 * warehouse tasks (they must reserve real stock through FEFO) and to automation
 * runs (they must evaluate the real conditions against the real records).
 *
 * Nothing here invents data. Every entry it creates is derived from movements
 * and sales that prisma/seed.ts already recorded.
 */
async function finalize(): Promise<void> {
  const logger = new Logger('FinalizeDemo');
  const app = await NestFactory.createApplicationContext(AppModule, {
    // 'log' is on so the finalizer's own report is visible; Nest's startup
    // chatter is what the other levels would add.
    logger: ['error', 'warn', 'log'],
  });

  try {
    const prisma = app.get(PrismaService);
    const posting = app.get(PostingService);
    const automation = app.get(AutomationService);
    const picking = app.get(PickingService);
    const tasks = app.get(WarehouseTasksService);
    const locations = app.get(LocationsService);

    // Act as the seeded administrator, so every audit row names a real user
    // rather than a null actor.
    const admin = await prisma.user.findFirst({
      where: { username: 'admin' },
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    });
    if (!admin) {
      throw new Error('No admin user found. Run the seed first.');
    }

    const permissions = [
      ...new Set(
        admin.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.code)),
      ),
    ];
    const actor: AuthenticatedUser = {
      id: admin.id,
      email: admin.email,
      username: admin.username,
      fullName: admin.fullName,
      roles: admin.roles.map((r) => r.role.code),
      permissions,
      // Empty scope arrays mean organization-wide, which is what an
      // administrator holds.
      branchIds: [],
      warehouseIds: [],
      sessionId: 'seed-finalizer',
    };

    // ---- 1. Post the seeded movements and sales to the ledger ----
    const posted = await posting.postPending(2000, { id: admin.id });
    logger.log(
      `Ledger: ${posted.movements} movement(s), ${posted.sales} sale(s), ` +
        `${posted.invoices} invoice(s), ${posted.payments} payment(s) posted; ` +
        `${posted.skipped} already posted, ${posted.failed} could not be posted`,
    );
    for (const error of posted.errors.slice(0, 5)) {
      // Reported rather than swallowed: an unposted document is a real gap.
      logger.warn(`  ${error.type} ${error.id}: ${error.error}`);
    }

    // ---- 2. Warehouse work in flight ----
    const warehouses = await prisma.warehouse.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      take: 2,
    });

    for (const warehouse of warehouses) {
      // A replenishment task for each pick face the location service says is
      // running low — the same list the warehouse screen shows.
      const needs = await locations.replenishmentNeeds(warehouse.id);
      let moves = 0;
      for (const need of needs.slice(0, 3)) {
        const source = need.sources[0];
        if (!source) continue;
        try {
          await tasks.createMove(
            {
              warehouseId: warehouse.id,
              productId: need.productId,
              fromLocationId: source.locationId,
              toLocationId: need.pickFaceId,
              quantity: Math.min(need.suggestedQuantity, source.onHand),
              taskType: 'REPLENISH',
              priority: 70,
            },
            actor,
          );
          moves += 1;
        } catch (error) {
          logger.warn(`  Replenishment task skipped: ${(error as Error).message}`);
        }
      }

      // One planned pick wave over products that actually have stock, so the
      // wave screen shows a real walk order rather than an empty table.
      const candidates = await prisma.inventoryBalance.groupBy({
        by: ['productId'],
        where: {
          warehouseId: warehouse.id,
          onHand: { gt: 20 },
          batch: { status: { in: ['AVAILABLE', 'RELEASED'] } },
        },
        _sum: { onHand: true },
        orderBy: { _sum: { onHand: 'desc' } },
        take: 4,
      });

      if (candidates.length) {
        try {
          const wave = await picking.createWave(
            {
              warehouseId: warehouse.id,
              strategy: 'WAVE',
              lines: candidates.map((c) => ({ productId: c.productId, quantity: 5 })),
            },
            actor,
          );
          logger.log(
            `${warehouse.name}: ${moves} replenishment task(s), wave ${wave.wave.waveNo} planned ` +
              `with ${wave.taskCount} task(s)` +
              (wave.shortages.length ? `, ${wave.shortages.length} line(s) short` : ''),
          );
        } catch (error) {
          logger.warn(`  Wave not created for ${warehouse.name}: ${(error as Error).message}`);
        }
      } else {
        logger.log(`${warehouse.name}: ${moves} replenishment task(s), no stock free for a wave`);
      }
    }

    // ---- 3. Let the automation rules see the seeded data ----
    const automationResult = await automation.runAll({ id: admin.id });
    let matched = 0;
    let actionsRun = 0;
    let suppressed = 0;
    for (const outcome of Object.values(automationResult.results)) {
      const o = outcome as { matched?: number; actionsRun?: number; suppressed?: number };
      matched += o?.matched ?? 0;
      actionsRun += o?.actionsRun ?? 0;
      suppressed += o?.suppressed ?? 0;
    }
    // Suppression is reported rather than hidden: on a re-run inside the
    // cooldown window every match is legitimately suppressed, and a bare
    // "0 actions" would look like a failure.
    logger.log(
      `Automation: ${automationResult.rules} rule(s) evaluated, ${matched} match(es), ` +
        `${actionsRun} action(s) taken, ${suppressed} suppressed by cooldown`,
    );

    logger.log('Demo finalisation complete.');
  } finally {
    await app.close();
  }
}

finalize().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
