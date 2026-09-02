import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ExportService } from './export.service';
import { DocumentsService } from './documents.service';
import { LabelsService } from './labels.service';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [AnalyticsModule],
  controllers: [ReportsController],
  providers: [ReportsService, ExportService, DocumentsService, LabelsService],
  exports: [ReportsService, ExportService, DocumentsService, LabelsService],
})
export class ReportsModule {}
