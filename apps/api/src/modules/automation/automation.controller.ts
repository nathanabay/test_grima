import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AutomationService } from './automation.service';
import { AuthenticatedUser, CurrentUser, RequirePermissions } from '../../common/decorators';

@ApiTags('Automation')
@Controller('automation')
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  @Get('catalogue')
  @RequirePermissions('admin.automation.READ')
  @ApiOperation({ summary: 'Triggers, their testable fields, and the available actions' })
  catalogue() {
    return this.automation.catalogue();
  }

  @Get('rules')
  @RequirePermissions('admin.automation.READ')
  list(@Query() query: any) {
    return this.automation.list({
      triggerType: query.triggerType,
      isActive: query.isActive === undefined ? undefined : query.isActive === 'true',
    });
  }

  @Get('rules/:id')
  @RequirePermissions('admin.automation.READ')
  get(@Param('id') id: string) {
    return this.automation.get(id);
  }

  @Post('rules')
  @RequirePermissions('admin.automation.CREATE')
  create(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.automation.create(body, user);
  }

  @Patch('rules/:id')
  @RequirePermissions('admin.automation.EDIT')
  update(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.automation.update(id, body, user);
  }

  @Delete('rules/:id')
  @RequirePermissions('admin.automation.DELETE')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.automation.remove(id, user);
  }

  @Get('rules/:id/preview')
  @RequirePermissions('admin.automation.READ')
  @ApiOperation({
    summary: 'What the rule would match and send, without doing any of it',
  })
  preview(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.automation.preview(id, limit ? Number(limit) : 25);
  }

  @Post('rules/:id/run')
  @RequirePermissions('admin.automation.EDIT')
  @ApiOperation({ summary: 'Run one rule now' })
  run(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.automation.run(id, 'MANUAL', user);
  }

  @Post('run-all')
  @RequirePermissions('admin.automation.EDIT')
  runAll(@CurrentUser() user: AuthenticatedUser) {
    return this.automation.runAll(user);
  }

  @Get('runs')
  @RequirePermissions('admin.automation.READ')
  runs(@Query() query: any) {
    return this.automation.runs({
      ruleId: query.ruleId,
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 25,
    });
  }

  @Get('escalations')
  @RequirePermissions('admin.automation.READ')
  @ApiOperation({ summary: 'Subjects a rule has acted on that are still unresolved' })
  escalations() {
    return this.automation.openEscalations();
  }
}
