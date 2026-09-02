import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { IntelligenceController } from './intelligence.controller';
import { HealthScoreService } from './health-score.service';
import { SearchService } from './search.service';
import { TimelineService } from './timeline.service';
import { ReportBuilderService } from './report-builder.service';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [IntelligenceController],
  providers: [HealthScoreService, SearchService, TimelineService, ReportBuilderService],
  exports: [HealthScoreService, SearchService, TimelineService, ReportBuilderService],
})
export class IntelligenceModule {}
