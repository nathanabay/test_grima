import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ConfigService } from '../../common/config/config.service';
import { AuthService } from '../auth/auth.service';
import { AuthenticatedUser } from '../../common/decorators';

/** Organization, branches, warehouses, users and roles (§4, §18, §33, §65). */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  // ---- Organization hierarchy ----

  async organization() {
    return this.prisma.organization.findFirstOrThrow({
      include: {
        branches: {
          include: {
            warehouses: { include: { locations: true } },
          },
          orderBy: { name: 'asc' },
        },
      },
    });
  }

  async updateOrganization(data: any, user: AuthenticatedUser) {
    const org = await this.prisma.organization.findFirstOrThrow();
    const updated = await this.prisma.organization.update({ where: { id: org.id }, data });
    await this.audit.record({
      userId: user.id,
      module: 'admin',
      action: 'EDIT',
      entityType: 'Organization',
      entityId: org.id,
      previousValue: {
        valuationMethod: org.valuationMethod,
        allowNegativeStock: org.allowNegativeStock,
      },
      newValue: data,
    });
    return updated;
  }

  async listBranches() {
    return this.prisma.branch.findMany({
      include: { warehouses: { select: { id: true, code: true, name: true, isColdRoom: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async createBranch(data: any, user: AuthenticatedUser) {
    const org = await this.prisma.organization.findFirstOrThrow();
    const branch = await this.prisma.branch.create({
      data: { ...data, organizationId: org.id },
    });
    await this.audit.record({
      userId: user.id,
      module: 'admin',
      action: 'CREATE',
      entityType: 'Branch',
      entityId: branch.id,
      newValue: { code: branch.code, name: branch.name },
    });
    return branch;
  }

  async createWarehouse(data: any, user: AuthenticatedUser) {
    const warehouse = await this.prisma.warehouse.create({ data });
    await this.audit.record({
      userId: user.id,
      module: 'admin',
      action: 'CREATE',
      entityType: 'Warehouse',
      entityId: warehouse.id,
      newValue: { code: warehouse.code, name: warehouse.name },
      branchId: warehouse.branchId,
    });
    return warehouse;
  }

  /** Create a nested storage location: room > zone > rack > shelf > bin (§18). */
  async createLocation(data: any, user: AuthenticatedUser) {
    const location = await this.prisma.warehouseLocation.create({ data });
    await this.audit.record({
      userId: user.id,
      module: 'admin',
      action: 'CREATE',
      entityType: 'WarehouseLocation',
      entityId: location.id,
      newValue: { code: location.code, level: location.level },
    });
    return location;
  }

  // ---- Users and roles ----

  async listUsers(query: { q?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, query.pageSize ?? 25);
    const where = query.q
      ? {
          OR: [
            { fullName: { contains: query.q, mode: 'insensitive' as const } },
            { email: { contains: query.q, mode: 'insensitive' as const } },
            { username: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          username: true,
          fullName: true,
          phone: true,
          status: true,
          mfaEnabled: true,
          lastLoginAt: true,
          licenseNumber: true,
          roles: { include: { role: { select: { code: true, name: true } } } },
          scopes: true,
        },
        orderBy: { fullName: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  async createUser(data: any, actor: AuthenticatedUser) {
    if (!data.password || String(data.password).length < 10) {
      throw new BadRequestException('An initial password of at least 10 characters is required');
    }

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: String(data.email).toLowerCase(),
          username: String(data.username).toLowerCase(),
          phone: data.phone ?? null,
          fullName: data.fullName,
          licenseNumber: data.licenseNumber ?? null,
          passwordHash: await AuthService.hashPassword(data.password),
          mustChangePassword: true,
        },
      });

      if (data.roleCodes?.length) {
        const roles = await tx.role.findMany({ where: { code: { in: data.roleCodes } } });
        await tx.userRole.createMany({
          data: roles.map((r) => ({ userId: created.id, roleId: r.id })),
        });
      }
      // No scope rows at all means organization-wide access, so branch
      // restrictions are explicit rather than accidental.
      if (data.branchIds?.length) {
        await tx.userScope.createMany({
          data: data.branchIds.map((branchId: string) => ({ userId: created.id, branchId })),
        });
      }
      return created;
    });

    await this.audit.record({
      userId: actor.id,
      userLabel: actor.fullName,
      module: 'admin',
      action: 'CREATE',
      entityType: 'User',
      entityId: user.id,
      newValue: { email: user.email, roles: data.roleCodes ?? [], branches: data.branchIds ?? [] },
    });

    return { id: user.id, email: user.email, username: user.username, fullName: user.fullName };
  }

  async setUserRoles(userId: string, roleCodes: string[], actor: AuthenticatedUser) {
    const before = await this.prisma.userRole.findMany({
      where: { userId },
      include: { role: { select: { code: true } } },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId } });
      const roles = await tx.role.findMany({ where: { code: { in: roleCodes } } });
      await tx.userRole.createMany({
        data: roles.map((r) => ({ userId, roleId: r.id })),
      });
      // Role changes take effect on the next token, so existing sessions are
      // revoked rather than left holding stale permissions.
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    await this.audit.record({
      userId: actor.id,
      userLabel: actor.fullName,
      module: 'admin',
      action: 'PERMISSION_CHANGE',
      entityType: 'User',
      entityId: userId,
      previousValue: { roles: before.map((b) => b.role.code) },
      newValue: { roles: roleCodes },
    });

    return { success: true, roles: roleCodes };
  }

  async setUserStatus(userId: string, status: any, actor: AuthenticatedUser, reason?: string) {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { status, failedAttempts: 0, lockedUntil: null },
    });
    if (status !== 'ACTIVE') {
      await this.prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await this.audit.record({
      userId: actor.id,
      userLabel: actor.fullName,
      module: 'admin',
      action: 'EDIT',
      entityType: 'User',
      entityId: userId,
      previousValue: { status: before.status },
      newValue: { status },
      reason,
    });
    return { id: updated.id, status: updated.status };
  }

  async listRoles() {
    return this.prisma.role.findMany({
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async createRole(data: { code: string; name: string; description?: string; permissionCodes: string[] }, actor: AuthenticatedUser) {
    const role = await this.prisma.$transaction(async (tx) => {
      const created = await tx.role.create({
        data: { code: data.code, name: data.name, description: data.description ?? null },
      });
      const permissions = await tx.permission.findMany({
        where: { code: { in: data.permissionCodes } },
      });
      await tx.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: created.id, permissionId: p.id })),
      });
      return created;
    });

    await this.audit.record({
      userId: actor.id,
      module: 'admin',
      action: 'CREATE',
      entityType: 'Role',
      entityId: role.id,
      newValue: { code: role.code, permissions: data.permissionCodes.length },
    });
    return role;
  }

  async setRolePermissions(roleId: string, permissionCodes: string[], actor: AuthenticatedUser) {
    const role = await this.prisma.role.findUniqueOrThrow({
      where: { id: roleId },
      include: { permissions: { include: { permission: true } } },
    });
    if (role.isSystem) {
      throw new BadRequestException('System roles cannot have their permissions edited');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      const permissions = await tx.permission.findMany({ where: { code: { in: permissionCodes } } });
      await tx.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId, permissionId: p.id })),
      });
      await tx.session.updateMany({
        where: { user: { roles: { some: { roleId } } }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    await this.audit.record({
      userId: actor.id,
      userLabel: actor.fullName,
      module: 'admin',
      action: 'PERMISSION_CHANGE',
      entityType: 'Role',
      entityId: roleId,
      previousValue: { permissions: role.permissions.map((p) => p.permission.code) },
      newValue: { permissions: permissionCodes },
    });

    return { success: true };
  }

  async listPermissions() {
    return this.prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { resource: 'asc' }] });
  }

  // ---- Settings (§65) ----

  async getSettings() {
    const org = await this.prisma.organization.findFirstOrThrow({ include: { settings: true } });
    return {
      organization: org,
      settings: Object.fromEntries(org.settings.map((s) => [s.key, s.value])),
    };
  }

  /**
   * Change one administrator setting.
   *
   * This used to write the row directly. Two things followed from that, and
   * both are the failure the settings catalogue exists to prevent: the value
   * was never validated against its definition, so a number outside its bounds
   * or of the wrong type was accepted; and ConfigService's cache was never
   * invalidated, so the system went on using the old value until the API was
   * restarted. The screen agreed with the administrator and the system ignored
   * them.
   *
   * The write now goes through ConfigService, which validates, stores and
   * invalidates — the same path the configuration screen's batch save uses.
   */
  async setSetting(key: string, value: unknown, actor: AuthenticatedUser) {
    const org = await this.prisma.organization.findFirstOrThrow();
    const [applied] = await this.config.setMany({ [key]: value }, org.id);

    // updatedById is not part of the shared write path, so it is stamped here.
    const setting = await this.prisma.systemSetting.update({
      where: { organizationId_key: { organizationId: org.id, key } },
      data: { updatedById: actor.id },
    });

    await this.audit.record({
      userId: actor.id,
      module: 'admin',
      action: 'EDIT',
      entityType: 'SystemSetting',
      entityId: setting.id,
      previousValue: applied.previous ?? null,
      newValue: { key, value: applied.value },
    });

    return setting;
  }
}
