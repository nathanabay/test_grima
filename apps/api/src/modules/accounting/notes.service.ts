import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ConfigService } from '../../common/config/config.service';
import { JournalService } from './journal.service';
import { AuthenticatedUser } from '../../common/decorators';

/**
 * Credit and debit notes, in both directions (§32).
 *
 * A note adjusts money owed, never stock. Returning the physical goods is a
 * separate act through the returns workflow — conflating them would let a
 * credit note silently move inventory.
 */
@Injectable()
export class FinanceNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly journal: JournalService,
    private readonly config: ConfigService,
  ) {}

  private async nextNoteNo(tx: Prisma.TransactionClient, noteType: string, when = new Date()) {
    const prefix = `${noteType === 'CREDIT' ? 'CN' : 'DN'}-${when.getFullYear()}-`;
    await this.prisma.advisoryLock(tx, `docnum:${prefix}`);

    const last = await tx.financeNote.findFirst({
      where: { noteNo: { startsWith: prefix } },
      orderBy: { noteNo: 'desc' },
      select: { noteNo: true },
    });
    const next = last ? Number(last.noteNo.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(next).padStart(6, '0')}`;
  }

  async list(filter: { direction?: string; status?: string; supplierId?: string } = {}) {
    return this.prisma.financeNote.findMany({
      where: {
        ...(filter.direction ? { direction: filter.direction } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.supplierId ? { supplierId: filter.supplierId } : {}),
      },
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async get(id: string) {
    const note = await this.prisma.financeNote.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!note) throw new NotFoundException('Note not found');
    return note;
  }

  async create(
    input: {
      noteType: 'CREDIT' | 'DEBIT';
      direction: 'CUSTOMER' | 'SUPPLIER';
      branchId: string;
      supplierId?: string;
      patientId?: string;
      referenceType?: string;
      referenceId?: string;
      reason: string;
      currency?: string;
      lines: {
        productId?: string;
        description: string;
        quantity?: number;
        unitPrice: number;
        taxRate?: number;
      }[];
    },
    user: AuthenticatedUser,
  ) {
    if (!['CREDIT', 'DEBIT'].includes(input.noteType)) {
      throw new BadRequestException('noteType must be CREDIT or DEBIT');
    }
    if (!['CUSTOMER', 'SUPPLIER'].includes(input.direction)) {
      throw new BadRequestException('direction must be CUSTOMER or SUPPLIER');
    }
    if (!input.reason?.trim()) {
      throw new BadRequestException('A note requires a reason');
    }
    if (!input.lines?.length) {
      throw new BadRequestException('A note needs at least one line');
    }
    if (input.direction === 'SUPPLIER' && !input.supplierId) {
      throw new BadRequestException('A supplier note needs a supplier');
    }

    const defaultTax = new Prisma.Decimal(await this.config.getNumber('finance.vatRate'));
    const decimals = await this.config.getNumber('finance.roundingDecimals');

    let subtotal = new Prisma.Decimal(0);
    let taxTotal = new Prisma.Decimal(0);

    const lines = input.lines.map((line) => {
      const quantity = new Prisma.Decimal(line.quantity ?? 1);
      const unitPrice = new Prisma.Decimal(line.unitPrice);
      if (unitPrice.lessThan(0)) {
        throw new BadRequestException(
          'A note line cannot be negative; raise the opposite note type instead',
        );
      }
      const taxRate = line.taxRate === undefined ? defaultTax : new Prisma.Decimal(line.taxRate);
      const net = quantity.times(unitPrice);
      const tax = net.times(taxRate);

      subtotal = subtotal.plus(net);
      taxTotal = taxTotal.plus(tax);

      return {
        productId: line.productId ?? null,
        description: line.description,
        quantity,
        unitPrice,
        taxRate,
        lineTotal: net.plus(tax).toDecimalPlaces(decimals, Prisma.Decimal.ROUND_HALF_UP),
      };
    });

    subtotal = subtotal.toDecimalPlaces(decimals, Prisma.Decimal.ROUND_HALF_UP);
    taxTotal = taxTotal.toDecimalPlaces(decimals, Prisma.Decimal.ROUND_HALF_UP);

    const note = await this.prisma.$transaction(async (tx) => {
      const noteNo = await this.nextNoteNo(tx, input.noteType);
      return tx.financeNote.create({
        data: {
          noteNo,
          noteType: input.noteType,
          direction: input.direction,
          supplierId: input.supplierId ?? null,
          patientId: input.patientId ?? null,
          branchId: input.branchId,
          referenceType: input.referenceType ?? null,
          referenceId: input.referenceId ?? null,
          currency: input.currency ?? 'ETB',
          subtotal,
          taxTotal,
          grandTotal: subtotal.plus(taxTotal),
          reason: input.reason.trim(),
          createdById: user.id,
          lines: { create: lines },
        },
        include: { lines: true },
      });
    });

    await this.audit.record({
      userId: user.id,
      module: 'finance',
      action: 'CREATE',
      entityType: 'FinanceNote',
      entityId: note.id,
      newValue: { noteNo: note.noteNo, grandTotal: note.grandTotal.toString() },
      reason: input.reason,
    });

    return note;
  }

  /**
   * Issue a note and post its accounting effect.
   *
   * Approval is a separate act from creation so one person cannot both raise
   * and issue a credit, which is the control that stops a refund being written
   * to nobody's attention.
   */
  async issue(id: string, user: AuthenticatedUser) {
    const note = await this.prisma.financeNote.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!note) throw new NotFoundException('Note not found');
    if (note.status !== 'DRAFT') {
      throw new ConflictException(`Note ${note.noteNo} is ${note.status} and cannot be issued again`);
    }
    if (note.createdById === user.id) {
      const requireDistinct = await this.config.getBoolean('approval.requireDistinctApprovers');
      if (requireDistinct) {
        throw new ConflictException(
          'The person who raised a note cannot issue it. A second approver is required.',
        );
      }
    }

    // Which way the money moves:
    //   Customer credit  - we owe the customer: reduce revenue, reduce receivable.
    //   Customer debit   - the customer owes more: raise revenue and receivable.
    //   Supplier credit  - the supplier owes us: reduce payable, reduce cost.
    //   Supplier debit   - we owe the supplier more: raise payable and cost.
    const lines =
      note.direction === 'CUSTOMER'
        ? note.noteType === 'CREDIT'
          ? [
              { systemKey: 'SALES_REVENUE', debit: note.subtotal },
              ...(note.taxTotal.greaterThan(0)
                ? [{ systemKey: 'VAT_OUTPUT', debit: note.taxTotal }]
                : []),
              { systemKey: 'ACCOUNTS_RECEIVABLE', credit: note.grandTotal },
            ]
          : [
              { systemKey: 'ACCOUNTS_RECEIVABLE', debit: note.grandTotal },
              { systemKey: 'SALES_REVENUE', credit: note.subtotal },
              ...(note.taxTotal.greaterThan(0)
                ? [{ systemKey: 'VAT_OUTPUT', credit: note.taxTotal }]
                : []),
            ]
        : note.noteType === 'CREDIT'
          ? [
              { systemKey: 'ACCOUNTS_PAYABLE', debit: note.grandTotal },
              { systemKey: 'INVENTORY_ASSET', credit: note.subtotal },
              ...(note.taxTotal.greaterThan(0)
                ? [{ systemKey: 'VAT_INPUT', credit: note.taxTotal }]
                : []),
            ]
          : [
              { systemKey: 'INVENTORY_ASSET', debit: note.subtotal },
              ...(note.taxTotal.greaterThan(0)
                ? [{ systemKey: 'VAT_INPUT', debit: note.taxTotal }]
                : []),
              { systemKey: 'ACCOUNTS_PAYABLE', credit: note.grandTotal },
            ];

    const result = await this.prisma.$transaction(async (tx) => {
      const entry = await this.journal.post(
        tx,
        {
          entryDate: new Date(),
          description: `${note.noteType === 'CREDIT' ? 'Credit' : 'Debit'} note ${note.noteNo}: ${note.reason}`,
          sourceType: note.noteType === 'CREDIT' ? 'CREDIT_NOTE' : 'DEBIT_NOTE',
          sourceId: note.id,
          branchId: note.branchId,
          currency: note.currency,
          lines,
        },
        user,
      );

      const updated = await tx.financeNote.update({
        where: { id },
        data: { status: 'ISSUED', approvedById: user.id, approvedAt: new Date() },
        include: { lines: true },
      });

      return { note: updated, journalEntry: entry };
    });

    await this.audit.record({
      userId: user.id,
      module: 'finance',
      action: 'APPROVE',
      entityType: 'FinanceNote',
      entityId: id,
      previousValue: { status: 'DRAFT' },
      newValue: { status: 'ISSUED', journalEntryNo: result.journalEntry.entryNo },
    });

    return result;
  }

  async cancel(id: string, reason: string, user: AuthenticatedUser) {
    if (!reason?.trim()) throw new BadRequestException('A cancellation reason is required');

    const note = await this.prisma.financeNote.findUnique({ where: { id } });
    if (!note) throw new NotFoundException('Note not found');
    if (note.status === 'ISSUED') {
      throw new ConflictException(
        `Note ${note.noteNo} has been issued and posted; reverse its journal entry instead of cancelling it.`,
      );
    }
    if (note.status === 'CANCELLED') {
      throw new ConflictException(`Note ${note.noteNo} is already cancelled`);
    }

    const cancelled = await this.prisma.financeNote.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    await this.audit.record({
      userId: user.id,
      module: 'finance',
      action: 'CANCEL',
      entityType: 'FinanceNote',
      entityId: id,
      previousValue: { status: note.status },
      newValue: { status: 'CANCELLED' },
      reason,
    });

    return cancelled;
  }
}
