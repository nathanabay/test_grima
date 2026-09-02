import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ExportService } from './export.service';
import { DocumentsService } from './documents.service';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [AnalyticsModule],
  controllers: [ReportsController],
  providers: [ReportsService, ExportService, DocumentsService],
  exports: [ReportsService, ExportService, DocumentsService],
})
export class ReportsModule {}
