import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';
import { DEFAULT_ACCOUNTS } from './chart-of-accounts';

export { DEFAULT_ACCOUNTS };

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(includeInactive = false) {
    return this.prisma.account.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  async get(id: string) {
    const account = await this.prisma.account.findUnique({
      where: { id },
      include: { parent: { select: { id: true, code: true, name: true } }, children: true },
    });
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  async create(data: Record<string, unknown>, user: AuthenticatedUser) {
    const type = String(data.type ?? '').toUpperCase();
    if (!['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'].includes(type)) {
      throw new BadRequestException(
        'Account type must be ASSET, LIABILITY, EQUITY, INCOME or EXPENSE',
      );
    }

    const created = await this.prisma.account.create({ data: { ...(data as any), type } });
    await this.audit.record({
      userId: user.id,
      module: 'finance',
      action: 'CREATE',
      entityType: 'Account',
      entityId: created.id,
      newValue: created,
    });
    return created;
  }

  async update(id: string, data: Record<string, unknown>, user: AuthenticatedUser) {
    const before = await this.prisma.account.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Account not found');

    // The systemKey is what posting rules point at; changing it silently would
    // redirect every future journal.
    if (data.systemKey !== undefined && data.systemKey !== before.systemKey && before.isSystem) {
      throw new ConflictException(
        `${before.code} is a system account; its mapping key cannot be changed. ` +
          `Create a new account and move the key instead.`,
      );
    }

    if (data.isActive === false) {
      const lines = await this.prisma.journalLine.count({ where: { accountId: id } });
      if (lines > 0 && before.isSystem) {
        throw new ConflictException(
          `${before.code} carries ${lines} posting(s) and is referenced by posting rules; it cannot be deactivated.`,
        );
      }
    }

    const updated = await this.prisma.account.update({ where: { id }, data });
    await this.audit.record({
      userId: user.id,
      module: 'finance',
      action: 'EDIT',
      entityType: 'Account',
      entityId: id,
      previousValue: before,
      newValue: updated,
    });
    return updated;
  }

  /**
   * Create any default account that does not exist yet.
   *
   * Additive by design: an organization that has renamed 5000 keeps its name,
   * and only genuinely missing accounts are added.
   */
  async ensureDefaults(user?: AuthenticatedUser) {
    const existing = await this.prisma.account.findMany({ select: { code: true, systemKey: true } });
    const codes = new Set(existing.map((a) => a.code));
    const keys = new Set(existing.map((a) => a.systemKey).filter(Boolean) as string[]);

    const missing = DEFAULT_ACCOUNTS.filter(
      (a) => !codes.has(a.code) && !(a.systemKey && keys.has(a.systemKey)),
    );

    if (missing.length) {
      await this.prisma.account.createMany({
        data: missing.map((a) => ({ ...a, isSystem: Boolean(a.systemKey) })),
      });
    }

    if (user && missing.length) {
      await this.audit.record({
        userId: user.id,
        module: 'finance',
        action: 'CREATE',
        entityType: 'Account',
        entityId: 'chart-of-accounts',
        newValue: { created: missing.map((m) => m.code) },
      });
    }

    return { created: missing.length, codes: missing.map((m) => m.code) };
  }

  /**
   * Which posting keys have no account behind them.
   *
   * Reported up front, because the alternative is discovering it when a
   * dispensing fails to post at month end.
   */
  async mappingHealth() {
    const required = DEFAULT_ACCOUNTS.filter((a) => a.systemKey).map((a) => a.systemKey!);
    const mapped = await this.prisma.account.findMany({
      where: { systemKey: { in: required } },
      select: { systemKey: true, code: true, name: true, isActive: true },
    });

    const byKey = new Map(mapped.map((m) => [m.systemKey!, m]));
    return required.map((key) => {
      const account = byKey.get(key);
      return {
        systemKey: key,
        mapped: Boolean(account),
        code: account?.code ?? null,
        name: account?.name ?? null,
        isActive: account?.isActive ?? false,
        problem: !account
          ? 'No account is mapped to this key; postings that need it will fail.'
          : !account.isActive
            ? 'The mapped account is inactive.'
            : null,
      };
    });
  }

  // ---- Accounting periods ----

  async listPeriods() {
    return this.prisma.accountingPeriod.findMany({ orderBy: { startDate: 'desc' } });
  }

  async createPeriod(data: { code: string; startDate: string; endDate: string }, user: AuthenticatedUser) {
    const startDate = new Date(data.startDate);
    const endDate = new Date(data.endDate);
    if (endDate <= startDate) {
      throw new BadRequestException('A period must end after it starts');
    }

    const overlapping = await this.prisma.accountingPeriod.findFirst({
      where: { startDate: { lte: endDate }, endDate: { gte: startDate } },
    });
    if (overlapping) {
      throw new ConflictException(
        `That range overlaps period ${overlapping.code}; periods must not overlap.`,
      );
    }

    const created = await this.prisma.accountingPeriod.create({
      data: { code: data.code, startDate, endDate },
    });
    await this.audit.record({
      userId: user.id,
      module: 'finance',
      action: 'CREATE',
      entityType: 'AccountingPeriod',
      entityId: created.id,
      newValue: created,
    });
    return created;
  }

  async closePeriod(id: string, user: AuthenticatedUser) {
    const period = await this.prisma.accountingPeriod.findUnique({ where: { id } });
    if (!period) throw new NotFoundException('Period not found');
    if (period.status === 'CLOSED') {
      throw new ConflictException(`Period ${period.code} is already closed`);
    }

    // Closing over unposted documents would leave the month permanently wrong,
    // so the gap is reported instead.
    const unposted = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM inventory_transactions t
      LEFT JOIN journal_entries j
        ON j."sourceType" = 'INVENTORY_MOVEMENT' AND j."sourceId" = t.id
      WHERE j.id IS NULL
        AND t.type NOT IN ('TRANSFER_IN', 'TRANSFER_OUT', 'RECALL',
                           'RESERVATION', 'RESERVATION_RELEASE')
        AND t."occurredAt" BETWEEN ${period.startDate} AND ${period.endDate}`;

    const pending = Number(unposted[0]?.count ?? 0);
    if (pending > 0) {
      throw new ConflictException(
        `${pending} movement(s) in ${period.code} have not been posted to the ledger. ` +
          `Run the posting job before closing the period.`,
      );
    }

    const closed = await this.prisma.accountingPeriod.update({
      where: { id },
      data: { status: 'CLOSED', closedById: user.id, closedAt: new Date() },
    });

    await this.audit.record({
      userId: user.id,
      module: 'finance',
      action: 'APPROVE',
      entityType: 'AccountingPeriod',
      entityId: id,
      previousValue: { status: 'OPEN' },
      newValue: { status: 'CLOSED' },
    });

    return closed;
  }

  async reopenPeriod(id: string, reason: string, user: AuthenticatedUser) {
    if (!reason?.trim()) throw new BadRequestException('Reopening a period requires a reason');

    const period = await this.prisma.accountingPeriod.findUnique({ where: { id } });
    if (!period) throw new NotFoundException('Period not found');

    const reopened = await this.prisma.accountingPeriod.update({
      where: { id },
      data: { status: 'OPEN', closedById: null, closedAt: null },
    });

    await this.audit.record({
      userId: user.id,
      module: 'finance',
      action: 'EDIT',
      entityType: 'AccountingPeriod',
      entityId: id,
      previousValue: { status: 'CLOSED', closedAt: period.closedAt },
      newValue: { status: 'OPEN' },
      reason,
    });

    return reopened;
  }
}
