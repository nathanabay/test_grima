import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  DEFAULT_ROLES,
  RESOURCE_CATALOG,
  permissionCode,
  resolveRolePermissions,
} from '@pharmacore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Keep the permission table in step with the catalogue (§4).
 *
 * The seed builds permissions and role grants from scratch, which is fine for a
 * fresh database and useless for an existing one: a release that adds a
 * resource would ship a feature nobody holds the permission for, so it would be
 * unreachable and would look like a bug in authorization.
 *
 * This runs at boot and only ever ADDS:
 *
 * - Missing catalogue permissions are inserted.
 * - A system role gains any permission its definition grants and it does not
 *   yet hold.
 *
 * Nothing is revoked. An administrator who deliberately narrowed a system role,
 * or a custom role somebody built, must not be silently rewritten by a
 * deployment - that would be the system taking an authorization decision away
 * from the person accountable for it.
 */
@Injectable()
export class PermissionSyncService implements OnModuleInit {
  private readonly logger = new Logger(PermissionSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      const result = await this.sync();
      if (result.permissionsAdded || result.grantsAdded) {
        this.logger.log(
          `Permission catalogue: added ${result.permissionsAdded} permission(s) and ` +
            `${result.grantsAdded} role grant(s)`,
        );
      }
    } catch (error) {
      // A sync failure must not stop the API booting: the existing permissions
      // still work, and the new ones are simply not yet reachable.
      this.logger.error(
        `Permission catalogue sync failed; new permissions may be unreachable: ${
          (error as Error).message
        }`,
      );
    }
  }

  async sync(): Promise<{
    permissionsAdded: number;
    grantsAdded: number;
    added: string[];
  }> {
    const catalogue = RESOURCE_CATALOG.flatMap((r) =>
      r.actions.map((a) => ({
        module: r.module,
        resource: r.resource,
        action: a,
        code: permissionCode(r.module, r.resource, a),
      })),
    );

    const existing = await this.prisma.permission.findMany({ select: { id: true, code: true } });
    const existingCodes = new Set(existing.map((p) => p.code));
    const missing = catalogue.filter((c) => !existingCodes.has(c.code));

    if (missing.length) {
      await this.prisma.permission.createMany({
        data: missing.map((m) => ({
          module: m.module,
          resource: m.resource,
          action: m.action as never,
          code: m.code,
        })),
        skipDuplicates: true,
      });
    }

    const permissions = await this.prisma.permission.findMany({ select: { id: true, code: true } });
    const idByCode = new Map(permissions.map((p) => [p.code, p.id]));

    let grantsAdded = 0;
    for (const definition of DEFAULT_ROLES) {
      const role = await this.prisma.role.findUnique({
        where: { code: definition.code },
        select: { id: true, isSystem: true, permissions: { select: { permissionId: true } } },
      });
      // Only roles the product ships are kept in step. A role somebody created
      // is theirs, and a deployment has no business widening it.
      if (!role || !role.isSystem) continue;

      const held = new Set(role.permissions.map((p) => p.permissionId));
      const wanted = resolveRolePermissions(definition)
        .map((code) => idByCode.get(code))
        .filter((id): id is string => !!id)
        .filter((id) => !held.has(id));

      if (wanted.length) {
        await this.prisma.rolePermission.createMany({
          data: wanted.map((permissionId) => ({ roleId: role.id, permissionId })),
          skipDuplicates: true,
        });
        grantsAdded += wanted.length;
      }
    }

    return {
      permissionsAdded: missing.length,
      grantsAdded,
      added: missing.map((m) => m.code),
    };
  }
}
