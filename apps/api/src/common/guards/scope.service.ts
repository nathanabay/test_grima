import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../decorators';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Branch and warehouse scoping (§4, §33).
 *
 * A user with no UserScope rows is organization-wide (head office). Otherwise
 * every read is filtered and every write is asserted against their scope.
 */
@Injectable()
export class ScopeService {
  constructor(private readonly prisma: PrismaService) {}

  isUnscoped(user: AuthenticatedUser): boolean {
    return user.branchIds.length === 0 && user.warehouseIds.length === 0;
  }

  /** Prisma `where` fragment restricting rows to the user's branches. */
  branchFilter(user: AuthenticatedUser): Record<string, unknown> {
    if (this.isUnscoped(user)) return {};
    return { branchId: { in: user.branchIds } };
  }

  assertBranch(user: AuthenticatedUser, branchId: string): void {
    if (this.isUnscoped(user)) return;
    if (!user.branchIds.includes(branchId)) {
      throw new ForbiddenException('You do not have access to this branch');
    }
  }

  async assertWarehouse(user: AuthenticatedUser, warehouseId: string): Promise<void> {
    if (this.isUnscoped(user)) return;
    if (user.warehouseIds.includes(warehouseId)) return;

    // A branch-scoped user reaches every warehouse inside their branches.
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id: warehouseId },
      select: { branchId: true },
    });
    if (!warehouse || !user.branchIds.includes(warehouse.branchId)) {
      throw new ForbiddenException('You do not have access to this warehouse');
    }
  }
}
