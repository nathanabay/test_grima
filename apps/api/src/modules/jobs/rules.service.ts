import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { daysUntil } from '@pharmacore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BatchService } from '../inventory/batch.service';
import { SuppliersService } from '../procurement/suppliers.service';
import { ProcurementService } from '../procurement/procurement.service';
import { NotificationsService } from '../notifications/notifications.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { JobRunnerService } from './job-runner.service';
import { PostingService } from '../accounting/posting.service';
import { AutomationService } from '../automation/automation.service';
import { ConfigService } from '../../common/config/config.service';
import { ReportBuilderService } from '../intelligence/report-builder.service';
import { PrescriptionsService } from '../dispensing/prescriptions.service';
import { LedgerService } from '../inventory/ledger.service';

/**
 * Rule engine and scheduled jobs (§58).
 *
 * Each rule reads live data and emits notifications or state changes. Nothing
 * here places an order or disposes of stock on its own - those stay human
 * decisions (§12, §29).
 */
@Injectable()
export class RulesService implements OnModuleInit {
  private readonly logger = new Logger(RulesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly batches: BatchService,
    private readonly suppliers: SuppliersService,
    private readonly procurement: ProcurementService,
    private readonly notifications: NotificationsService,
    private readonly integrations: IntegrationsService,
    private readonly runner: JobRunnerService,
    private readonly posting: PostingService,
    private readonly automation: AutomationService,
    private readonly config: ConfigService,
    private readonly reportBuilder: ReportBuilderService,
    private readonly prescriptions: PrescriptionsService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Register every rule with the job runner so each execution is recorded and
   * can be re-run on demand from the administration screen (§64).
   */
  onModuleInit(): void {
    this.runner.register({
      key: 'webhooks.deliver',
      label: 'Deliver queued webhooks',
      description: 'Drains the outbound integration queue and retries failed deliveries.',
      schedule: 'Every minute',
      run: () => this.runDeliverWebhooks(),
    });
    this.runner.register({
      key: 'reports.deliverScheduled',
      label: 'Deliver scheduled reports',
      description:
        'Runs each saved report whose schedule fires this hour, with the owner\'s own permissions.',
      schedule: 'Hourly',
      run: () => this.runDeliverScheduledReports(),
    });
    this.runner.register({
      key: 'expiry.alerts',
      label: 'Expiry alerts',
      description: 'Notifies on stock approaching expiry, escalating as the date nears.',
      schedule: 'Daily at 01:00',
      run: () => this.runExpiryAlerts(),
    });
    this.runner.register({
      key: 'expiry.sweep',
      label: 'Expiry sweep',
      description: 'Marks expired batches and removes them from available stock.',
      schedule: 'Daily at 02:00',
      run: () => this.runExpirySweep(),
    });
    this.runner.register({
      key: 'inventory.releaseLapsedReservations',
      label: 'Release lapsed stock reservations',
      description:
        'Puts back stock held by a basket nobody returned for, or a pick wave nobody closed. ' +
        'The document is left alone — lapsing the hold is not cancelling the order.',
      schedule: 'Hourly',
      run: () => this.ledger.releaseExpiredReservations(),
    });
    this.runner.register({
      key: 'prescriptions.expire',
      label: 'Expire prescriptions past their validity date',
      description:
        'Moves undispensed prescriptions past their validity date to EXPIRED. Prescriptions ' +
        'part-way through a supply are left alone and shown on the queue as overdue instead.',
      schedule: 'Daily at 02:30',
      run: () => this.prescriptions.expireStale(),
    });
    this.runner.register({
      key: 'supplier.scores',
      label: 'Supplier scoring',
      description: 'Recomputes supplier KPIs and reports overdue purchase orders.',
      schedule: 'Daily at 03:00',
      run: () => this.runSupplierScores(),
    });
    this.runner.register({
      key: 'stock.lowStockAlerts',
      label: 'Low stock alerts',
      description: 'Raises replenishment recommendations for stock at or below its reorder point.',
      schedule: 'Daily at 06:00',
      run: () => this.runLowStockAlerts(),
    });
    this.runner.register({
      key: 'automation.runAll',
      label: 'Automation rules',
      description:
        'Evaluates every active rule and takes its configured actions, escalating what stays unresolved.',
      schedule: 'Hourly',
      run: () => this.automation.runAll(),
    });
    this.runner.register({
      key: 'accounting.postPending',
      label: 'Post to the general ledger',
      description:
        'Translates stock movements, sales, supplier invoices and payments into journal entries.',
      schedule: 'Hourly',
      run: () => this.runPostToLedger(),
    });
    this.runner.register({
      key: 'documents.expiryAlerts',
      label: 'Licence and document expiry',
      description: 'Announces supplier licences and stored documents approaching expiry.',
      schedule: 'Daily at 07:00',
      run: () => this.runDocumentExpiryAlerts(),
    });
  }

  /**
   * Drain the webhook queue (§53). Runs often, because a partner waiting on a
   * stock event should not wait an hour for it.
   */
  async runDeliverWebhooks() {
    const result = await this.integrations.processQueue(100);
    if (result.sent || result.failed) {
      this.logger.log(`Webhooks: ${result.sent} delivered, ${result.failed} failed`);
    }
    return result;
  }

  /** IF expiry < threshold THEN alert the inventory manager. */
  async runExpiryAlerts(): Promise<{ alerted: number }> {
    const horizon = new Date(Date.now() + 90 * 86_400_000);
    const balances = await this.prisma.inventoryBalance.findMany({
      where: {
        onHand: { gt: 0 },
        batch: {
          expiryDate: { lte: horizon, gt: new Date() },
          status: { in: ['AVAILABLE', 'RELEASED'] },
        },
      },
      include: {
        batch: true,
        product: { select: { genericName: true, strength: true, averageCost: true, baseUnit: true } },
      },
    });

    let alerted = 0;
    for (const b of balances) {
      if (!b.batch) continue;
      const days = daysUntil(b.batch.expiryDate);
      const severity = days <= 30 ? 'CRITICAL' : days <= 60 ? 'WARNING' : 'INFO';
      const value = Number(b.onHand) * Number(b.product.averageCost);

      await this.notifications.emit({
        eventType: 'EXPIRY_APPROACHING',
        severity,
        title: `${severity === 'CRITICAL' ? 'URGENT' : 'Notice'}: ${b.product.genericName} ${b.product.strength} expires in ${days} days`,
        body:
          `Batch ${b.batch.batchNumber}\n` +
          `Quantity: ${b.onHand.toString()} ${b.product.baseUnit}\n` +
          `Expires: ${b.batch.expiryDate.toISOString().slice(0, 10)} (${days} days)\n` +
          `Stock value at risk: ${value.toFixed(2)}\n` +
          `Recommended action: ${
            days <= 30 ? 'TRANSFER / RETURN TO SUPPLIER / QUARANTINE' : 'PROMOTE / PLAN REDISTRIBUTION'
          }`,
        branchId: b.branchId,
        roleCodes: ['WAREHOUSE_MANAGER', 'PHARMACY_ADMIN', 'BRANCH_MANAGER'],
        linkUrl: `/inventory/expiry?batchId=${b.batchId}`,
        payload: { batchId: b.batchId, daysRemaining: days, valueAtRisk: value },
      });
      alerted += 1;
    }

    this.logger.log(`Expiry alert rule: ${alerted} position(s) alerted`);
    return { alerted };
  }

  /** Move expired stock out of available inventory. */
  async runExpirySweep() {
    const result = await this.batches.processExpiredBatches();
    if (result.batchesExpired > 0) {
      await this.notifications.emit({
        eventType: 'EXPIRED_STOCK',
        severity: 'WARNING',
        title: `${result.batchesExpired} batch(es) expired overnight`,
        body:
          `${result.quantityRemoved} units worth ${result.valueRemoved.toFixed(2)} were removed ` +
          `from available stock and marked EXPIRED. They now need a disposal decision.`,
        roleCodes: ['QA_OFFICER', 'WAREHOUSE_MANAGER'],
        linkUrl: '/inventory/expiry',
      });
    }
    this.logger.log(`Expiry sweep: ${result.batchesExpired} batch(es) expired`);
    return result;
  }

  /** IF stock <= reorder level THEN create a replenishment recommendation. */
  async runLowStockAlerts() {
    const recommendations = await this.procurement.replenishmentRecommendations();
    if (!recommendations.length) return { alerted: 0 };

    const critical = recommendations.filter((r) => r.available <= 0);

    await this.notifications.emit({
      eventType: 'LOW_STOCK',
      severity: critical.length ? 'CRITICAL' : 'WARNING',
      title: `${recommendations.length} product(s) at or below the reorder point`,
      body:
        (critical.length ? `${critical.length} are completely out of stock.\n\n` : '') +
        recommendations
          .slice(0, 15)
          .map((r) => `${r.productName}: ${r.available} available, suggest ordering ${r.suggestedQuantity}`)
          .join('\n'),
      roleCodes: ['PROCUREMENT_OFFICER', 'PHARMACY_ADMIN'],
      linkUrl: '/procurement/replenishment',
    });

    this.logger.log(`Low stock rule: ${recommendations.length} recommendation(s)`);
    return { alerted: recommendations.length };
  }

  /** IF supplier delivery late THEN update the supplier performance score. */
  async runSupplierScores() {
    const result = await this.suppliers.recomputeAllScores();

    const late = await this.prisma.purchaseOrder.findMany({
      where: {
        status: { in: ['ORDERED', 'PARTIALLY_RECEIVED'] },
        expectedDate: { lt: new Date() },
      },
      include: { supplier: { select: { companyName: true } } },
    });

    for (const po of late) {
      const daysLate = po.expectedDate
        ? Math.floor((Date.now() - po.expectedDate.getTime()) / 86_400_000)
        : 0;
      await this.notifications.emit({
        eventType: 'SUPPLIER_DELAY',
        severity: daysLate > 7 ? 'CRITICAL' : 'WARNING',
        title: `${po.supplier.companyName} is ${daysLate} day(s) late on ${po.poNo}`,
        body: `Purchase order ${po.poNo} was expected on ${po.expectedDate?.toISOString().slice(0, 10)}.`,
        branchId: po.branchId,
        roleCodes: ['PROCUREMENT_OFFICER'],
        linkUrl: `/procurement/purchase-orders/${po.id}`,
      });
    }

    this.logger.log(`Supplier scoring: ${result.updated} supplier(s), ${late.length} late order(s)`);
    return { ...result, lateOrders: late.length };
  }

  /** Supplier licence and document expiry alerts (§44). */
  async runDocumentExpiryAlerts() {
    // §65: how far ahead a licence or document expiry is announced is
    // configured, not sixty days because sixty was typed here first.
    const reminderDays = await this.config.getNumber('compliance.licenceReminderDays');
    const soon = new Date(Date.now() + reminderDays * 86_400_000);

    const [suppliers, documents] = await Promise.all([
      this.prisma.supplier.findMany({
        where: { isActive: true, licenseExpiry: { lte: soon } },
        select: { id: true, companyName: true, licenseExpiry: true },
      }),
      this.prisma.document.findMany({
        where: { expiresAt: { lte: soon } },
        select: { id: true, fileName: true, entityType: true, entityId: true, expiresAt: true },
      }),
    ]);

    for (const s of suppliers) {
      const days = s.licenseExpiry ? daysUntil(s.licenseExpiry) : 0;
      await this.notifications.emit({
        eventType: 'DOCUMENT_EXPIRY',
        severity: days < 0 ? 'CRITICAL' : 'WARNING',
        title: `${s.companyName} licence ${days < 0 ? 'has expired' : `expires in ${days} days`}`,
        body: `Supplier licence expiry: ${s.licenseExpiry?.toISOString().slice(0, 10)}. Obtain a renewed licence before the next order.`,
        roleCodes: ['PROCUREMENT_OFFICER', 'QA_OFFICER'],
        linkUrl: `/suppliers/${s.id}`,
      });
    }

    return { suppliers: suppliers.length, documents: documents.length };
  }

  // ---- Scheduled entry points ----
  // Each records a JobRun, so a job that stopped firing is visible on the
  // system health screen instead of being assumed healthy (§64).

  @Cron(CronExpression.EVERY_MINUTE)
  async deliverWebhooksCron() {
    return this.runner.execute('webhooks.deliver');
  }

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async expiryAlertsCron() {
    return this.runner.execute('expiry.alerts');
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async expirySweepCron() {
    return this.runner.execute('expiry.sweep');
  }

  @Cron(CronExpression.EVERY_HOUR)
  async lapsedReservationsCron() {
    return this.runner.execute('inventory.releaseLapsedReservations');
  }

  @Cron('30 2 * * *')
  async prescriptionExpiryCron() {
    return this.runner.execute('prescriptions.expire');
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async supplierScoresCron() {
    return this.runner.execute('supplier.scores');
  }

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async lowStockAlertsCron() {
    return this.runner.execute('stock.lowStockAlerts');
  }

  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async documentExpiryAlertsCron() {
    return this.runner.execute('documents.expiryAlerts');
  }

  /**
   * Accounting runs on a schedule rather than inline (§32).
   *
   * A ledger problem must never stop a pharmacist dispensing, so posting is
   * deliberately off the critical path. It is idempotent, so a missed run
   * catches up on the next one.
   */
  async runPostToLedger() {
    const result = await this.posting.postPending(1000);
    if (result.failed) {
      this.logger.warn(`Ledger posting: ${result.failed} document(s) could not be posted`);
      await this.notifications.emit({
        eventType: 'POSTING_FAILED',
        severity: 'WARNING',
        title: `${result.failed} document(s) could not be posted to the ledger`,
        body:
          result.errors
            .slice(0, 10)
            .map((e) => `${e.type} ${e.id}: ${e.error}`)
            .join('\n') || 'See the accounting screen for detail.',
        roleCodes: ['FINANCE_OFFICER', 'PHARMACY_ADMIN'],
        linkUrl: '/accounting',
      });
    }
    return result;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async postToLedgerCron() {
    return this.runner.execute('accounting.postPending');
  }

  @Cron(CronExpression.EVERY_HOUR)
  async automationCron() {
    return this.runner.execute('automation.runAll');
  }

  /**
   * Scheduled report delivery (§40).
   *
   * Hourly, because that is the finest granularity the delivery notification is
   * useful at; a report scheduled for 08:30 goes out in the 08:00 pass.
   */
  async runDeliverScheduledReports() {
    const result = await this.reportBuilder.deliverScheduled();
    if (result.skipped.length) {
      this.logger.warn(
        `Scheduled reports: ${result.skipped.length} could not be delivered ` +
          `(${result.skipped.map((s) => s.name).join(', ')})`,
      );
    }
    return result;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async scheduledReportsCron() {
    return this.runner.execute('reports.deliverScheduled');
  }
}
