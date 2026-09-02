import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { AuthenticatedUser, CurrentUser, RequirePermissions } from '../../common/decorators';

@ApiTags('Dashboards & Analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('dashboard')
  @RequirePermissions('analytics.dashboard.READ')
  @ApiOperation({ summary: 'Executive dashboard cards and charts, computed live' })
  dashboard(@CurrentUser() user: AuthenticatedUser, @Query('branchId') branchId?: string) {
    return this.analytics.dashboard(user, branchId);
  }

  @Get('command-center')
  @RequirePermissions('analytics.dashboard.READ')
  @ApiOperation({ summary: 'Inventory Command Center: what needs attention, ranked (§71)' })
  commandCenter(@CurrentUser() user: AuthenticatedUser, @Query('branchId') branchId?: string) {
    return this.analytics.commandCenter(user, branchId);
  }

  @Get('abc-xyz')
  @RequirePermissions('analytics.report.READ')
  @ApiOperation({ summary: 'ABC value / XYZ predictability classification with planning guidance' })
  abcXyz(@CurrentUser() user: AuthenticatedUser, @Query('months') months?: string) {
    return this.analytics.abcXyz(user, months ? Number(months) : 12);
  }

  @Get('dead-stock')
  @RequirePermissions('analytics.report.READ')
  deadStock(@CurrentUser() user: AuthenticatedUser, @Query('days') days?: string) {
    return this.analytics.deadStock(user, days ? Number(days) : 180);
  }

  @Get('kpis')
  @RequirePermissions('analytics.report.READ')
  @ApiOperation({ summary: 'Turnover, DIO, margin, expiry rate, accuracy and shrinkage' })
  kpis(
    @CurrentUser() user: AuthenticatedUser,
    @Query('branchId') branchId?: string,
    @Query('periodDays') periodDays?: string,
  ) {
    return this.analytics.kpis(user, branchId, periodDays ? Number(periodDays) : 365);
  }
}
