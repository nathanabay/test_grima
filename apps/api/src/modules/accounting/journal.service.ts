import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';

export interface JournalLineInput {
  accountId?: string;
  /** Alternative to accountId: resolve by the account's stable system key. */
  systemKey?: string;
  debit?: number | string | Prisma.Decimal;
  credit?: number | string | Prisma.Decimal;
  description?: string;
  branchId?: string | null;
  departmentId?: string | null;
  productId?: string | null;
  batchId?: string | null;
}

export interface JournalEntryInput {
  entryDate?: Date;
  description: string;
  sourceType: string;
  sourceId?: string | null;
  branchId?: string | null;
  departmentId?: string | null;
  currency?: string;
  lines: JournalLineInput[];
}

/**
 * Double-entry journals (§32).
 *
 * Two rules are enforced rather than assumed:
 *   - Every entry balances. An unbalanced entry is refused, not corrected.
 *   - A posted entry is never edited or deleted. Corrections are made by
 *     posting a reversal that points back at the original (§53).
 *
 * Entries are unique per source document, so replaying a posting run cannot
 * double-post.
 */
@Injectable()
export class JournalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Resolve an account by its stable system key. */
  async accountByKey(tx: Prisma.TransactionClient, systemKey: string) {
    const account = await tx.account.findUnique({ where: { systemKey } });
    if (!account) {
      throw new BadRequestException(
        `No account is mapped to '${systemKey}'. Set it up in the chart of accounts before posting.`,
      );
    }
    if (!account.isActive) {
      throw new BadRequestException(`The account mapped to '${systemKey}' is inactive`);
    }
    return account;
  }

  private async nextEntryNo(tx: Prisma.TransactionClient, when: Date): Promise<string> {
    const year = when.getFullYear();
    const prefix = `JE-${year}-`;
    await this.prisma.advisoryLock(tx, `docnum:JE:${year}`);

    const last = await tx.journalEntry.findFirst({
      where: { entryNo: { startsWith: prefix } },
      orderBy: { entryNo: 'desc' },
      select: { entryNo: true },
    });
    const next = last ? Number(last.entryNo.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(next).padStart(6, '0')}`;
  }

  private async assertPeriodOpen(tx: Prisma.TransactionClient, date: Date): Promise<void> {
    const period = await tx.accountingPeriod.findFirst({
      where: { startDate: { lte: date }, endDate: { gte: date } },
    });
    // No period defined means periods are not being used; only an explicitly
    // closed period blocks a posting.
    if (period && period.status === 'CLOSED') {
      throw new ConflictException(
        `Accounting period ${period.code} is closed; post this entry to an open period instead.`,
      );
    }
  }

  /**
   * Post a balanced entry inside the caller's transaction.
   *
   * Takes `tx` so an accounting entry and the operation it describes commit or
   * roll back together — a journal for a receipt that failed would be worse
   * than no journal at all.
   */
  async post(
    tx: Prisma.TransactionClient,
    input: JournalEntryInput,
    user?: { id: string },
  ) {
    const entryDate = input.entryDate ?? new Date();
    await this.assertPeriodOpen(tx, entryDate);

    if (!input.lines?.length) {
      throw new BadRequestException('A journal entry needs at least one line');
    }

    const resolved: {
      accountId: string;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      description?: string;
      branchId?: string | null;
      departmentId?: string | null;
      productId?: string | null;
      batchId?: string | null;
    }[] = [];

    for (const line of input.lines) {
      const debit = new Prisma.Decimal(line.debit ?? 0);
      const credit = new Prisma.Decimal(line.credit ?? 0);

      if (debit.lessThan(0) || credit.lessThan(0)) {
        throw new BadRequestException(
          'A journal line cannot carry a negative amount; put it on the other side instead',
        );
      }
      if (debit.greaterThan(0) && credit.greaterThan(0)) {
        throw new BadRequestException('A journal line is either a debit or a credit, not both');
      }
      if (debit.isZero() && credit.isZero()) continue;

      // A line naming neither an account nor a system key is a malformed
      // request, not a server fault: say so with a 400 rather than letting
      // `where: { systemKey: undefined }` reach Prisma and surface as a 500.
      if (!line.accountId && !line.systemKey) {
        throw new BadRequestException(
          'Every journal line must name an account, by accountId or by systemKey',
        );
      }
      const accountId = line.accountId ?? (await this.accountByKey(tx, line.systemKey!)).id;
      resolved.push({
        accountId,
        debit,
        credit,
        description: line.description,
        branchId: line.branchId ?? input.branchId ?? null,
        departmentId: line.departmentId ?? input.departmentId ?? null,
        productId: line.productId ?? null,
        batchId: line.batchId ?? null,
      });
    }

    if (resolved.length < 2) {
      throw new BadRequestException('A journal entry needs at least two lines to balance');
    }

    const totalDebit = resolved.reduce((s, l) => s.plus(l.debit), new Prisma.Decimal(0));
    const totalCredit = resolved.reduce((s, l) => s.plus(l.credit), new Prisma.Decimal(0));

    if (!totalDebit.equals(totalCredit)) {
      throw new BadRequestException(
        `Journal does not balance: debits ${totalDebit.toString()} against credits ${totalCredit.toString()}`,
      );
    }
    if (totalDebit.isZero()) {
      throw new BadRequestException('A journal entry cannot be for zero');
    }

    const entryNo = await this.nextEntryNo(tx, entryDate);

    const entry = await tx.journalEntry.create({
      data: {
        entryNo,
        entryDate,
        description: input.description,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        branchId: input.branchId ?? null,
        departmentId: input.departmentId ?? null,
        currency: input.currency ?? 'ETB',
        status: 'POSTED',
        totalDebit,
        totalCredit,
        postedById: user?.id ?? null,
        postedAt: new Date(),
        lines: {
          create: resolved.map((l, index) => ({ ...l, lineNumber: index + 1 })),
        },
      },
      include: { lines: true },
    });

    return entry;
  }

  /** Post outside an existing transaction. */
  async postStandalone(input: JournalEntryInput, user?: { id: string }) {
    return this.prisma.$transaction((tx) => this.post(tx, input, user));
  }

  /**
   * Reverse a posted entry by writing its mirror image.
   *
   * The original is never touched, so the history of what was posted and when
   * it was corrected both survive.
   */
  async reverse(id: string, reason: string, user: AuthenticatedUser) {
    if (!reason?.trim()) throw new BadRequestException('A reversal reason is required');

    const original = await this.prisma.journalEntry.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!original) throw new NotFoundException('Journal entry not found');
    if (original.status === 'REVERSED') {
      throw new ConflictException(`Entry ${original.entryNo} has already been reversed`);
    }

    const reversal = await this.prisma.$transaction(async (tx) => {
      const entryDate = new Date();
      await this.assertPeriodOpen(tx, entryDate);
      const entryNo = await this.nextEntryNo(tx, entryDate);

      const created = await tx.journalEntry.create({
        data: {
          entryNo,
          entryDate,
          description: `Reversal of ${original.entryNo}: ${reason.trim()}`,
          sourceType: 'REVERSAL',
          // Unique on (sourceType, sourceId), so the reversal points at the
          // original and a second reversal of the same entry is refused by the
          // database as well as by the check above.
          sourceId: original.id,
          branchId: original.branchId,
          departmentId: original.departmentId,
          currency: original.currency,
          status: 'POSTED',
          totalDebit: original.totalCredit,
          totalCredit: original.totalDebit,
          reversalOfId: original.id,
          postedById: user.id,
          postedAt: new Date(),
          lines: {
            create: original.lines.map((l, index) => ({
              accountId: l.accountId,
              // Swapped: the mirror image of the original.
              debit: l.credit,
              credit: l.debit,
              description: `Reversal: ${l.description ?? ''}`.trim(),
              branchId: l.branchId,
              departmentId: l.departmentId,
              productId: l.productId,
              batchId: l.batchId,
              lineNumber: index + 1,
            })),
          },
        },
        include: { lines: true },
      });

      await tx.journalEntry.update({
        where: { id: original.id },
        data: { status: 'REVERSED', reversedById: created.id },
      });

      return created;
    });

    await this.audit.record({
      userId: user.id,
      module: 'finance',
      action: 'CANCEL',
      entityType: 'JournalEntry',
      entityId: id,
      previousValue: { entryNo: original.entryNo, status: original.status },
      newValue: { status: 'REVERSED', reversalEntryNo: reversal.entryNo },
      reason,
    });

    return reversal;
  }

  async list(filter: {
    sourceType?: string;
    accountId?: string;
    branchId?: string;
    from?: string;
    to?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(200, filter.pageSize ?? 50);

    const where: Prisma.JournalEntryWhereInput = {
      ...(filter.sourceType ? { sourceType: filter.sourceType } : {}),
      ...(filter.branchId ? { branchId: filter.branchId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.accountId ? { lines: { some: { accountId: filter.accountId } } } : {}),
      ...(filter.from || filter.to
        ? {
            entryDate: {
              ...(filter.from ? { gte: new Date(filter.from) } : {}),
              ...(filter.to ? { lte: new Date(filter.to) } : {}),
            },
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        include: { lines: { include: { account: { select: { code: true, name: true } } } } },
        orderBy: { entryDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.journalEntry.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  async get(id: string) {
    const entry = await this.prisma.journalEntry.findUnique({
      where: { id },
      include: {
        lines: { include: { account: true }, orderBy: { lineNumber: 'asc' } },
        reversalOf: { select: { id: true, entryNo: true } },
        reversals: { select: { id: true, entryNo: true } },
      },
    });
    if (!entry) throw new NotFoundException('Journal entry not found');
    return entry;
  }

  /**
   * Trial balance: every account with its net movement.
   *
   * The totals must agree; if they do not, the report says so rather than
   * quietly presenting an unbalanced ledger.
   */
  async trialBalance(filter: { from?: string; to?: string; branchId?: string } = {}) {
    const grouped = await this.prisma.journalLine.groupBy({
      by: ['accountId'],
      where: {
        entry: {
          status: 'POSTED',
          ...(filter.branchId ? { branchId: filter.branchId } : {}),
          ...(filter.from || filter.to
            ? {
                entryDate: {
                  ...(filter.from ? { gte: new Date(filter.from) } : {}),
                  ...(filter.to ? { lte: new Date(filter.to) } : {}),
                },
              }
            : {}),
        },
      },
      _sum: { debit: true, credit: true },
    });

    const accounts = await this.prisma.account.findMany({
      where: { id: { in: grouped.map((g) => g.accountId) } },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));

    const rows = grouped
      .map((g) => {
        const account = byId.get(g.accountId)!;
        const debit = new Prisma.Decimal(g._sum.debit ?? 0);
        const credit = new Prisma.Decimal(g._sum.credit ?? 0);
        // Assets and expenses are debit-natured; the rest are credit-natured.
        const debitNatured = ['ASSET', 'EXPENSE'].includes(account.type);
        const balance = debitNatured ? debit.minus(credit) : credit.minus(debit);

        return {
          accountId: account.id,
          code: account.code,
          name: account.name,
          type: account.type,
          debit: debit.toString(),
          credit: credit.toString(),
          balance: balance.toString(),
          normalSide: debitNatured ? 'DEBIT' : 'CREDIT',
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));

    const totalDebit = rows.reduce((s, r) => s.plus(r.debit), new Prisma.Decimal(0));
    const totalCredit = rows.reduce((s, r) => s.plus(r.credit), new Prisma.Decimal(0));

    return {
      rows,
      totalDebit: totalDebit.toString(),
      totalCredit: totalCredit.toString(),
      balanced: totalDebit.equals(totalCredit),
      difference: totalDebit.minus(totalCredit).toString(),
    };
  }

  /** Every movement on one account, with a running balance. */
  async accountLedger(
    accountId: string,
    filter: { from?: string; to?: string; page?: number; pageSize?: number } = {},
  ) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException('Account not found');

    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(500, filter.pageSize ?? 100);

    const where: Prisma.JournalLineWhereInput = {
      accountId,
      entry: {
        status: 'POSTED',
        ...(filter.from || filter.to
          ? {
              entryDate: {
                ...(filter.from ? { gte: new Date(filter.from) } : {}),
                ...(filter.to ? { lte: new Date(filter.to) } : {}),
              },
            }
          : {}),
      },
    };

    const [lines, total] = await Promise.all([
      this.prisma.journalLine.findMany({
        where,
        include: { entry: { select: { entryNo: true, entryDate: true, description: true, sourceType: true, sourceId: true } } },
        orderBy: { entry: { entryDate: 'asc' } },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.journalLine.count({ where }),
    ]);

    const debitNatured = ['ASSET', 'EXPENSE'].includes(account.type);
    let running = new Prisma.Decimal(0);
    const rows = lines.map((l) => {
      running = debitNatured
        ? running.plus(l.debit).minus(l.credit)
        : running.plus(l.credit).minus(l.debit);
      return {
        entryNo: l.entry.entryNo,
        entryDate: l.entry.entryDate,
        description: l.description ?? l.entry.description,
        sourceType: l.entry.sourceType,
        sourceId: l.entry.sourceId,
        debit: l.debit.toString(),
        credit: l.credit.toString(),
        balance: running.toString(),
      };
    });

    return { account, rows, total, page, pageSize };
  }
}
