import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IntegrationsService,
  IntegrationEvent,
  INTEGRATION_EVENTS,
} from './integrations.service';
import { AuthenticatedUser, CurrentUser, RequirePermissions } from '../../common/decorators';

@ApiTags('Integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get('events')
  @RequirePermissions('admin.setting.READ')
  @ApiOperation({ summary: 'Events an endpoint can subscribe to' })
  events() {
    return { events: INTEGRATION_EVENTS };
  }

  @Get('endpoints')
  @RequirePermissions('admin.setting.READ')
  list() {
    return this.integrations.list();
  }

  @Get('health')
  @RequirePermissions('admin.setting.READ')
  @ApiOperation({ summary: 'Delivery success rate and health per endpoint' })
  health() {
    return this.integrations.health();
  }

  @Post('endpoints')
  @RequirePermissions('admin.setting.EDIT')
  @ApiOperation({
    summary: 'Register a webhook endpoint. The signing secret is returned once and never again.',
  })
  register(
    @Body() body: { name: string; url: string; events: IntegrationEvent[]; description?: string; headers?: Record<string, string> },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.integrations.register(body, user);
  }

  @Post('endpoints/:id/active')
  @RequirePermissions('admin.setting.EDIT')
  setActive(
    @Param('id') id: string,
    @Body() body: { isActive: boolean },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.integrations.setActive(id, body.isActive, user);
  }

  @Delete('endpoints/:id')
  @RequirePermissions('admin.setting.EDIT')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.integrations.remove(id, user);
  }

  @Get('deliveries')
  @RequirePermissions('admin.setting.READ')
  deliveries(@Query() query: any) {
    return this.integrations.deliveries({
      endpointId: query.endpointId,
      status: query.status,
      limit: query.limit ? Number(query.limit) : 50,
    });
  }

  @Post('deliveries/:id/retry')
  @RequirePermissions('admin.setting.EDIT')
  retry(@Param('id') id: string) {
    return this.integrations.retry(id);
  }

  @Post('process')
  @RequirePermissions('admin.setting.EDIT')
  @ApiOperation({ summary: 'Send everything currently due, without waiting for the scheduler' })
  process() {
    return this.integrations.processQueue();
  }
}
