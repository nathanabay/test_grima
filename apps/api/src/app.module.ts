import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { PrismaModule } from './common/prisma/prisma.module';
import { AppConfigModule } from './common/config/config.module';
import { AuditModule } from './common/audit/audit.module';
import { AppCacheModule } from './common/cache/cache.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';

import { AuthModule } from './modules/auth/auth.module';
import { AdminModule } from './modules/admin/admin.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ScanningModule } from './modules/scanning/scanning.module';
import { ProcurementModule } from './modules/procurement/procurement.module';
import { ReceivingModule } from './modules/receiving/receiving.module';
import { TransfersModule } from './modules/transfers/transfers.module';
import { DispensingModule } from './modules/dispensing/dispensing.module';
import { PosModule } from './modules/pos/pos.module';
import { QualityModule } from './modules/quality/quality.module';
import { RecallsModule } from './modules/recalls/recalls.module';
import { CountsModule } from './modules/counts/counts.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { CommonServicesModule } from './modules/common-services/common-services.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { PatientsModule } from './modules/patients/patients.module';
import { ReportsModule } from './modules/reports/reports.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { WorkflowModule } from './modules/workflow/workflow.module';
import { BackupModule } from './modules/backup/backup.module';
import { PlatformModule } from './modules/platform/platform.module';
import { WarehouseModule } from './modules/warehouse/warehouse.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { AutomationModule } from './modules/automation/automation.module';
import { FhirModule } from './modules/fhir/fhir.module';
import { IntelligenceModule } from './modules/intelligence/intelligence.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';

@Module({
  imports: [
    // Infrastructure
    PrismaModule,
    AppConfigModule,
    AuditModule,
    AppCacheModule,
    CommonServicesModule,
    NotificationsModule,
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),

    // Domain modules (§3). Each is self-contained and could later be extracted.
    AuthModule,
    AdminModule,
    CatalogModule,
    InventoryModule,
    ScanningModule,
    ProcurementModule,
    ReceivingModule,
    TransfersModule,
    DispensingModule,
    PatientsModule,
    PosModule,
    QualityModule,
    RecallsModule,
    CountsModule,
    AnalyticsModule,
    ReportsModule,
    DocumentsModule,
    WorkflowModule,
    BackupModule,
    IntegrationsModule,
    JobsModule,
    PlatformModule,
    WarehouseModule,
    AccountingModule,
    AutomationModule,
    FhirModule,
    IntelligenceModule,
  ],
  providers: [
    // Global: authenticate, then authorize, then rate-limit. Routes opt out of
    // authentication with @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
