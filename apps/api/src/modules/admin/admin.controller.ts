import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthenticatedUser, CurrentUser, RequirePermissions } from '../../common/decorators';

@ApiTags('Administration')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('organization')
  @RequirePermissions('admin.branch.READ')
  organization() {
    return this.admin.organization();
  }

  @Patch('organization')
  @RequirePermissions('admin.setting.EDIT')
  updateOrganization(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.admin.updateOrganization(body, user);
  }

  @Get('branches')
  @RequirePermissions('admin.branch.READ')
  branches() {
    return this.admin.listBranches();
  }

  @Post('branches')
  @RequirePermissions('admin.branch.CREATE')
  createBranch(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.admin.createBranch(body, user);
  }

  @Post('warehouses')
  @RequirePermissions('admin.warehouse.CREATE')
  createWarehouse(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.admin.createWarehouse(body, user);
  }

  @Post('warehouse-locations')
  @RequirePermissions('admin.warehouse.CREATE')
  @ApiOperation({ summary: 'Create a storage location (ROOM/ZONE/RACK/SHELF/BIN)' })
  createLocation(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.admin.createLocation(body, user);
  }

  @Get('users')
  @RequirePermissions('admin.user.READ')
  users(@Query() query: any) {
    return this.admin.listUsers({
      q: query.q,
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 25,
    });
  }

  @Post('users')
  @RequirePermissions('admin.user.CREATE')
  createUser(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.admin.createUser(body, user);
  }

  @Post('users/:id/roles')
  @RequirePermissions('admin.role.EDIT')
  @ApiOperation({ summary: 'Replace a user role set; revokes their active sessions' })
  setRoles(
    @Param('id') id: string,
    @Body() body: { roleCodes: string[] },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.admin.setUserRoles(id, body.roleCodes, user);
  }

  @Post('users/:id/status')
  @RequirePermissions('admin.user.EDIT')
  setStatus(
    @Param('id') id: string,
    @Body() body: { status: string; reason?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.admin.setUserStatus(id, body.status, user, body.reason);
  }

  @Get('roles')
  @RequirePermissions('admin.role.READ')
  roles() {
    return this.admin.listRoles();
  }

  @Post('roles')
  @RequirePermissions('admin.role.CREATE')
  createRole(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.admin.createRole(body, user);
  }

  @Post('roles/:id/permissions')
  @RequirePermissions('admin.role.EDIT')
  setRolePermissions(
    @Param('id') id: string,
    @Body() body: { permissionCodes: string[] },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.admin.setRolePermissions(id, body.permissionCodes, user);
  }

  @Get('permissions')
  @RequirePermissions('admin.role.READ')
  permissions() {
    return this.admin.listPermissions();
  }

  @Get('settings')
  @RequirePermissions('admin.setting.READ')
  settings() {
    return this.admin.getSettings();
  }

  @Post('settings')
  @RequirePermissions('admin.setting.EDIT')
  setSetting(@Body() body: { key: string; value: unknown }, @CurrentUser() user: AuthenticatedUser) {
    return this.admin.setSetting(body.key, body.value, user);
  }

  @Get('audit-logs')
  @RequirePermissions('audit.log.READ')
  @ApiOperation({ summary: 'Audit trail, newest first' })
  async auditLogs(@Query() query: any) {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(200, Number(query.pageSize ?? 50));
    const where = {
      ...(query.module ? { module: query.module } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { sequence: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  @Get('audit-logs/verify')
  @RequirePermissions('audit.log.READ')
  @ApiOperation({ summary: 'Verify the audit hash chain has not been tampered with' })
  verifyAudit() {
    return this.audit.verifyChain();
  }
}
