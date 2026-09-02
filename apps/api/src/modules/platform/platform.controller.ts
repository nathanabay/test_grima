import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '../../common/config/config.service';
import { AuditService } from '../../common/audit/audit.service';
import { JobRunnerService } from '../jobs/job-runner.service';
import { HealthService } from './health.service';
import { OrgHierarchyService } from './org-hierarchy.service';
import {
  AuthenticatedUser,
  CurrentUser,
  Public,
  RequirePermissions,
} from '../../common/decorators';

@ApiTags('Platform')
@Controller()
export class PlatformController {
  constructor(
    private readonly config: ConfigService,
    private readonly health: HealthService,
    private readonly jobs: JobRunnerService,
    private readonly hierarchy: OrgHierarchyService,
    private readonly audit: AuditService,
  ) {}

  // ---- Probes. Public because a load balancer has no bearer token, and they
  // deliberately expose no data beyond up/down (§64).

  @Get('health')
  @Public()
  @ApiOperation({ summary: 'Liveness probe' })
  liveness() {
    return this.health.liveness();
  }

  @Get('health/ready')
  @Public()
  @ApiOperation({ summary: 'Readiness probe — reports the database connection' })
  readiness() {
    return this.health.readiness();
  }

  @Get('admin/health')
  @RequirePermissions('admin.setting.READ')
  @ApiOperation({ summary: 'Full system health with per-dependency detail' })
  fullHealth() {
    return this.health.full();
  }

  // ---- Configuration (§65) ----

  @Get('admin/config')
  @RequirePermissions('admin.setting.READ')
  @ApiOperation({ summary: 'Every configurable rule with its resolved value and default' })
  describeConfig() {
    return this.config.describe();
  }

  @Patch('admin/config')
  @RequirePermissions('admin.setting.EDIT')
  @ApiOperation({ summary: 'Change one or more settings or feature flags' })
  async updateConfig(
    @Body() body: { values: Record<string, unknown>; reason?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const organizationId = await this.config.defaultOrganizationId();
    const applied = await this.config.setMany(body.values ?? {}, organizationId);

    // §71: a threshold change is a sensitive master-data change, so the old and
    // new values are both recorded against the actor.
    await this.audit.record({
      userId: user.id,
      module: 'admin',
      action: 'EDIT',
      entityType: 'SystemSetting',
      entityId: organizationId,
      previousValue: Object.fromEntries(applied.map((a) => [a.key, a.previous])),
      newValue: Object.fromEntries(applied.map((a) => [a.key, a.value])),
      reason: body.reason,
    });

    return this.config.describe(organizationId);
  }

  @Post('admin/config/:key/reset')
  @RequirePermissions('admin.setting.EDIT')
  @ApiOperation({ summary: 'Restore a setting to its catalogue default' })
  async resetConfig(@Param('key') key: string, @CurrentUser() user: AuthenticatedUser) {
    const organizationId = await this.config.defaultOrganizationId();
    const previous = await this.config.get(key, organizationId);
    await this.config.reset(key, organizationId);

    await this.audit.record({
      userId: user.id,
      module: 'admin',
      action: 'EDIT',
      entityType: 'SystemSetting',
      entityId: organizationId,
      previousValue: { [key]: previous },
      newValue: { [key]: await this.config.get(key, organizationId) },
      reason: 'Reset to default',
    });

    return this.config.describe(organizationId);
  }

  // ---- Background jobs (§64) ----

  @Get('admin/jobs')
  @RequirePermissions('admin.setting.READ')
  @ApiOperation({ summary: 'Registered background jobs and the outcome of their last run' })
  jobStatus() {
    return this.jobs.status();
  }

  @Get('admin/jobs/history')
  @RequirePermissions('admin.setting.READ')
  jobHistory(@Query('jobKey') jobKey?: string, @Query('limit') limit?: string) {
    return this.jobs.history(jobKey, limit ? Number(limit) : 50);
  }

  @Post('admin/jobs/:key/run')
  @RequirePermissions('admin.setting.EDIT')
  @ApiOperation({ summary: 'Run a background job now' })
  async runJob(@Param('key') key: string, @CurrentUser() user: AuthenticatedUser) {
    const result = await this.jobs.execute(key, 'MANUAL', user.id);
    await this.audit.record({
      userId: user.id,
      module: 'admin',
      action: 'CREATE',
      entityType: 'JobRun',
      entityId: key,
      newValue: { trigger: 'MANUAL', status: result.status },
    });
    return result;
  }

  // ---- Organizational hierarchy (§33) ----

  @Get('admin/hierarchy')
  @RequirePermissions('admin.branch.READ')
  @ApiOperation({ summary: 'Company → business unit → region → branch → warehouse → department' })
  tree(@CurrentUser() user: AuthenticatedUser) {
    return this.hierarchy.tree(user);
  }

  @Get('admin/business-units')
  @RequirePermissions('admin.branch.READ')
  businessUnits() {
    return this.hierarchy.listBusinessUnits();
  }

  @Post('admin/business-units')
  @RequirePermissions('admin.branch.CREATE')
  createBusinessUnit(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.hierarchy.createBusinessUnit(body, user);
  }

  @Patch('admin/business-units/:id')
  @RequirePermissions('admin.branch.EDIT')
  updateBusinessUnit(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.hierarchy.updateBusinessUnit(id, body, user);
  }

  @Get('admin/regions')
  @RequirePermissions('admin.branch.READ')
  regions() {
    return this.hierarchy.listRegions();
  }

  @Post('admin/regions')
  @RequirePermissions('admin.branch.CREATE')
  createRegion(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.hierarchy.createRegion(body, user);
  }

  @Patch('admin/regions/:id')
  @RequirePermissions('admin.branch.EDIT')
  updateRegion(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.hierarchy.updateRegion(id, body, user);
  }

  @Get('admin/departments')
  @RequirePermissions('admin.branch.READ')
  departments(@Query('branchId') branchId?: string) {
    return this.hierarchy.listDepartments(branchId);
  }

  @Post('admin/departments')
  @RequirePermissions('admin.branch.CREATE')
  createDepartment(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.hierarchy.createDepartment(body, user);
  }

  @Patch('admin/departments/:id')
  @RequirePermissions('admin.branch.EDIT')
  updateDepartment(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.hierarchy.updateDepartment(id, body, user);
  }

  @Patch('admin/branches/:id/assignment')
  @RequirePermissions('admin.branch.EDIT')
  @ApiOperation({ summary: 'Move a branch into a business unit and/or region' })
  assignBranch(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.hierarchy.assignBranch(id, body, user);
  }
}
