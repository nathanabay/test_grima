import { Body, Controller, Delete, Get, Header, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthScoreService } from './health-score.service';
import { SearchService } from './search.service';
import { TimelineService } from './timeline.service';
import { ReportBuilderService } from './report-builder.service';
import { AuthenticatedUser, CurrentUser, RequirePermissions } from '../../common/decorators';

@ApiTags('Intelligence')
@Controller()
export class IntelligenceController {
  constructor(
    private readonly health: HealthScoreService,
    private readonly searchService: SearchService,
    private readonly timeline: TimelineService,
    private readonly reports: ReportBuilderService,
  ) {}

  // ---- Inventory health score (§11) ----

  @Get('analytics/health-score')
  @RequirePermissions('analytics.dashboard.READ')
  @ApiOperation({
    summary: 'Inventory health 0-100, with the measurement behind every factor',
  })
  healthScore(@CurrentUser() user: AuthenticatedUser, @Query('branchId') branchId?: string) {
    return this.health.score(user, branchId);
  }

  // ---- Global search (§62) ----

  @Get('search')
  @ApiOperation({
    summary: 'Search authorised records across the system. Results honour branch scope.',
  })
  search(@CurrentUser() user: AuthenticatedUser, @Query() query: any) {
    return this.searchService.search(user, query.q ?? '', {
      types: query.types ? String(query.types).split(',') : undefined,
      limit: query.limit ? Number(query.limit) : 8,
    });
  }

  // ---- Activity timeline (§63) ----

  @Get('timeline/:entityType/:entityId')
  @ApiOperation({ summary: 'Everything that happened to one record, linked to its source' })
  timelineFor(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
  ) {
    return this.timeline.forEntity(entityType, entityId, user, limit ? Number(limit) : 100);
  }

  // ---- Report builder (§60) ----

  @Get('report-builder/sources')
  @RequirePermissions('analytics.report.READ')
  @ApiOperation({ summary: 'Data sources and columns this user may report on' })
  sources(@CurrentUser() user: AuthenticatedUser) {
    return this.reports.catalogue(user);
  }

  @Post('report-builder/run')
  @RequirePermissions('analytics.report.READ')
  @ApiOperation({ summary: 'Run an ad-hoc report definition' })
  runReport(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.run(body, user);
  }

  @Post('report-builder/export')
  @RequirePermissions('analytics.report.EXPORT')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="report.csv"')
  @ApiOperation({ summary: 'Run a report and return it as CSV' })
  exportReport(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.exportCsv(body, user);
  }

  @Get('report-builder/saved')
  @RequirePermissions('analytics.report.READ')
  savedReports(@CurrentUser() user: AuthenticatedUser) {
    return this.reports.listSaved(user);
  }

  @Post('report-builder/saved')
  @RequirePermissions('analytics.report.READ')
  saveReport(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.save(body, user);
  }

  @Post('report-builder/saved/:id/run')
  @RequirePermissions('analytics.report.READ')
  runSavedReport(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reports.runSaved(id, user, body ?? {});
  }

  @Delete('report-builder/saved/:id')
  @RequirePermissions('analytics.report.READ')
  deleteReport(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.remove(id, user);
  }
}
