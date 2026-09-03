import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IntegrationsService,
  IntegrationEvent,
  INTEGRATION_EVENTS,
} from './integrations.service';
import { ApiKeysService } from './api-keys.service';
import { AuthenticatedUser, CurrentUser, RequirePermissions } from '../../common/decorators';

@ApiTags('Integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly apiKeys: ApiKeysService,
  ) {}

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
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 25,
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

  // ---- API keys (§53) ----

  @Get('api-keys')
  @RequirePermissions('admin.setting.READ')
  @ApiOperation({ summary: 'Machine-to-machine keys. The key itself is never returned.' })
  listApiKeys() {
    return this.apiKeys.list();
  }

  @Post('api-keys')
  @RequirePermissions('admin.setting.EDIT')
  @ApiOperation({
    summary: 'Create a key. It is shown once and cannot be recovered afterwards.',
  })
  createApiKey(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.apiKeys.create(body, user);
  }

  @Patch('api-keys/:id')
  @RequirePermissions('admin.setting.EDIT')
  updateApiKey(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.apiKeys.update(id, body, user);
  }

  @Post('api-keys/:id/revoke')
  @RequirePermissions('admin.setting.EDIT')
  revokeApiKey(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.apiKeys.revoke(id, body?.reason ?? 'Revoked by an administrator', user);
  }
}
