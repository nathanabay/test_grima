import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { ForecastService } from './forecast.service';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, ForecastService],
  exports: [AnalyticsService, ForecastService],
})
export class AnalyticsModule {}
