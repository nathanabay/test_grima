import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';

/**
 * Company → business unit → region → branch → warehouse → department (§33).
 *
 * Every level above branch is optional. A single-site pharmacy has one
 * organization and one branch and never sees the rest; a group running retail
 * and hospital supply across regions gets the layers it needs without a
 * different deployment.
 *
 * Scope enforcement stays in ScopeService and keys off branch and warehouse —
 * the upper layers are a reporting and administration structure, so adding
 * them cannot widen anybody's access.
 */
@Injectable()
export class OrgHierarchyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The whole tree, filtered to the branches the caller may see. */
  async tree(user: AuthenticatedUser) {
    const scoped = user.branchIds.length > 0;

    const organizations = await this.prisma.organization.findMany({
      orderBy: { name: 'asc' },
      include: {
        businessUnits: {
          orderBy: { name: 'asc' },
          include: { regions: { orderBy: { name: 'asc' }, select: { id: true, code: true, name: true } } },
        },
        regions: { orderBy: { name: 'asc' } },
        branches: {
          where: scoped ? { id: { in: user.branchIds } } : {},
          orderBy: { name: 'asc' },
          include: {
            departments: { where: { isActive: true }, orderBy: { name: 'asc' } },
            warehouses: {
              orderBy: { name: 'asc' },
              select: { id: true, code: true, name: true, isColdRoom: true, isQuarantine: true, isActive: true },
            },
          },
        },
      },
    });

    return organizations.map((org) => ({
      id: org.id,
      code: 'ORG',
      name: org.name,
      currency: org.currency,
      country: org.country,
      timezone: org.timezone,
      businessUnits: org.businessUnits.map((bu) => ({
        id: bu.id,
        code: bu.code,
        name: bu.name,
        isActive: bu.isActive,
        regionIds: bu.regions.map((r) => r.id),
        branches: org.branches.filter((b) => b.businessUnitId === bu.id).map((b) => this.branchNode(b)),
      })),
      regions: org.regions.map((region) => ({
        id: region.id,
        code: region.code,
        name: region.name,
        businessUnitId: region.businessUnitId,
        isActive: region.isActive,
        branches: org.branches.filter((b) => b.regionId === region.id).map((b) => this.branchNode(b)),
      })),
      // Branches that sit directly under the company with no unit or region.
      unassignedBranches: org.branches
        .filter((b) => !b.businessUnitId && !b.regionId)
        .map((b) => this.branchNode(b)),
      branchCount: org.branches.length,
    }));
  }

  private branchNode(branch: {
    id: string;
    code: string;
    name: string;
    branchType: string;
    isActive: boolean;
    isHeadOffice: boolean;
    businessUnitId: string | null;
    regionId: string | null;
    departments: { id: string; code: string; name: string; costCentre: string | null }[];
    warehouses: { id: string; code: string; name: string; isColdRoom: boolean; isQuarantine: boolean; isActive: boolean }[];
  }) {
    return {
      id: branch.id,
      code: branch.code,
      name: branch.name,
      branchType: branch.branchType,
      isActive: branch.isActive,
      isHeadOffice: branch.isHeadOffice,
      businessUnitId: branch.businessUnitId,
      regionId: branch.regionId,
      departments: branch.departments,
      warehouses: branch.warehouses,
    };
  }

  // ---- Business units ----

  async listBusinessUnits() {
    return this.prisma.businessUnit.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { branches: true, regions: true } } },
    });
  }

  async createBusinessUnit(
    data: { code: string; name: string; description?: string },
    user: AuthenticatedUser,
  ) {
    const org = await this.prisma.organization.findFirstOrThrow({ select: { id: true } });
    const created = await this.prisma.businessUnit.create({
      data: { ...data, organizationId: org.id },
    });
    await this.audit.record({
      userId: user.id,
      module: 'admin',
      action: 'CREATE',
      entityType: 'BusinessUnit',
      entityId: created.id,
      newValue: created,
    });
    return created;
  }

  async updateBusinessUnit(id: string, data: Record<string, unknown>, user: AuthenticatedUser) {
    const before = await this.prisma.businessUnit.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Business unit not found');

    const updated = await this.prisma.businessUnit.update({ where: { id }, data });
    await this.audit.record({
      userId: user.id,
      module: 'admin',
      action: 'EDIT',
      entityType: 'BusinessUnit',
      entityId: id,
      previousValue: before,
      newValue: updated,
    });
    return updated;
  }

  // ---- Regions ----

  async listRegions() {
    return this.prisma.region.findMany({
      orderBy: { name: 'asc' },
      include: {
        businessUnit: { select: { id: true, name: true } },
        _count: { select: { branches: true } },
      },
    });
  }

  async createRegion(
    data: { code: string; name: string; businessUnitId?: string },
    user: AuthenticatedUser,
  ) {
    const org = await this.prisma.organization.findFirstOrThrow({ select: { id: true } });
    if (data.businessUnitId) {
      const bu = await this.prisma.businessUnit.findUnique({ where: { id: data.businessUnitId } });
      if (!bu) throw new BadRequestException('Business unit not found');
    }

    const created = await this.prisma.region.create({ data: { ...data, organizationId: org.id } });
    await this.audit.record({
      userId: user.id,
      module: 'admin',
      action: 'CREATE',
      entityType: 'Region',
      entityId: created.id,
      newValue: created,
    });
    return created;
  }

  async updateRegion(id: string, data: Record<string, unknown>, user: AuthenticatedUser) {
    const before = await this.prisma.region.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Region not found');

    const updated = await this.prisma.region.update({ where: { id }, data });
    await this.audit.record({
      userId: user.id,
      module: 'admin',
      action: 'EDIT',
      entityType: 'Region',
      entityId: id,
      previousValue: before,
      newValue: updated,
    });
    return updated;
  }

  // ---- Departments ----

  async listDepartments(branchId?: string) {
    return this.prisma.department.findMany({
      where: branchId ? { branchId } : {},
      orderBy: [{ branchId: 'asc' }, { name: 'asc' }],
      include: { branch: { select: { id: true, code: true, name: true } } },
    });
  }

  async createDepartment(
    data: { branchId: string; code: string; name: string; costCentre?: string },
    user: AuthenticatedUser,
  ) {
    const branch = await this.prisma.branch.findUnique({ where: { id: data.branchId } });
    if (!branch) throw new BadRequestException('Branch not found');

    const created = await this.prisma.department.create({ data });
    await this.audit.record({
      userId: user.id,
      module: 'admin',
      action: 'CREATE',
      entityType: 'Department',
      entityId: created.id,
      newValue: created,
    });
    return created;
  }

  async updateDepartment(id: string, data: Record<string, unknown>, user: AuthenticatedUser) {
    const before = await this.prisma.department.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Department not found');

    const updated = await this.prisma.department.update({ where: { id }, data });
    await this.audit.record({
      userId: user.id,
      module: 'admin',
      action: 'EDIT',
      entityType: 'Department',
      entityId: id,
      previousValue: before,
      newValue: updated,
    });
    return updated;
  }

  /**
   * Assign a branch to a business unit and/or region. Kept separate from the
   * general branch update so the move is auditable as its own act.
   */
  async assignBranch(
    branchId: string,
    data: { businessUnitId?: string | null; regionId?: string | null; branchType?: string },
    user: AuthenticatedUser,
  ) {
    const before = await this.prisma.branch.findUnique({ where: { id: branchId } });
    if (!before) throw new NotFoundException('Branch not found');

    if (data.regionId) {
      const region = await this.prisma.region.findUnique({ where: { id: data.regionId } });
      if (!region) throw new BadRequestException('Region not found');
      // A branch in a region belonging to a unit must not claim a different unit.
      if (
        region.businessUnitId &&
        data.businessUnitId &&
        region.businessUnitId !== data.businessUnitId
      ) {
        throw new BadRequestException(
          'That region belongs to a different business unit; assign the branch to the region only, or move the region first.',
        );
      }
    }

    const updated = await this.prisma.branch.update({ where: { id: branchId }, data });
    await this.audit.record({
      userId: user.id,
      module: 'admin',
      action: 'EDIT',
      entityType: 'Branch',
      entityId: branchId,
      previousValue: {
        businessUnitId: before.businessUnitId,
        regionId: before.regionId,
        branchType: before.branchType,
      },
      newValue: data,
    });
    return updated;
  }
}
