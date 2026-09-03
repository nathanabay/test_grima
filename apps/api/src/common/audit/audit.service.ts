import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  userId?: string | null;
  userLabel?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  module: string;
  action: string;
  entityType?: string;
  entityId?: string;
  previousValue?: unknown;
  newValue?: unknown;
  reason?: string;
  branchId?: string | null;
}

/**
 * Tamper-evident audit trail (§42).
 *
 * Each row stores a SHA-256 over its own content plus the hash of the previous
 * row. Editing or deleting any historical row breaks every subsequent hash, so
 * `verifyChain` can prove the log has not been rewritten. Rows are never
 * updated or deleted by application code.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Canonical form of a value: what PostgreSQL will hand back when this row is
   * read again.
   *
   * The hash has to be computed over the stored shape, not the in-memory one,
   * or verification fails on rows that were perfectly intact:
   *
   * - `jsonb` does not preserve key order, so {requestNo, lines} reads back as
   *   {lines, requestNo}. Keys are sorted recursively.
   * - A Prisma `Decimal` is an object in memory but is stored and read back as
   *   a JSON number, so a payload carrying a price or a quantity would hash
   *   over the Decimal's internals and never verify. Decimals are reduced to
   *   the number jsonb will return, which also normalises trailing zeros the
   *   same way Postgres does (12.3400 and 12.34 hash identically).
   * - `BigInt` cannot be serialized by JSON.stringify at all and would throw.
   * - Dates round-trip as ISO strings.
   */
  private canonicalize(value: unknown): unknown {
    if (value === null || value === undefined) return value ?? null;
    if (typeof value === 'bigint') return value.toString();
    if (typeof value !== 'object') return value;
    if (value instanceof Date) return value.toISOString();
    if (Prisma.Decimal.isDecimal(value)) return Number(value.toString());
    if (Array.isArray(value)) return value.map((v) => this.canonicalize(v));
    if (Buffer.isBuffer(value)) return value.toString('base64');

    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = this.canonicalize((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }

  private computeHash(entry: AuditEntry, previousHash: string | null, createdAt: Date): string {
    const payload = JSON.stringify({
      userId: entry.userId ?? null,
      module: entry.module,
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      previousValue: this.canonicalize(entry.previousValue ?? null),
      newValue: this.canonicalize(entry.newValue ?? null),
      reason: entry.reason ?? null,
      branchId: entry.branchId ?? null,
      createdAt: createdAt.toISOString(),
      previousHash,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Append one entry. Pass `tx` to record inside the same database transaction
   * as the change being audited, so an audit row can never survive a rollback
   * of the operation it describes.
   */
  async record(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    // Appending to a hash chain is read-the-tail-then-write, and that is only
    // correct if one writer does it at a time. Without the lock two requests
    // landing in the same millisecond both read the same tail and both claim
    // it as their predecessor, so the chain forks: `verifyChain` walks by
    // sequence, finds the second row pointing at its grandparent, and reports
    // "chain broken" on rows nobody has touched. That is worse than no
    // tamper-evidence, because it makes a real tamper indistinguishable from
    // ordinary concurrent traffic. Observed on a running server: sequences
    // 2440 and 2441 both carried the same previousHash.
    if (tx) return this.append(tx, entry);
    return this.prisma.$transaction((inner) => this.append(inner, entry));
  }

  /** The append itself, always under the chain lock. */
  private async append(
    client: Prisma.TransactionClient,
    entry: AuditEntry,
  ): Promise<void> {
    await this.prisma.advisoryLock(client, 'audit-log-chain');

    const createdAt = new Date();
    const previous = await client.auditLog.findFirst({
      orderBy: { sequence: 'desc' },
      select: { hash: true },
    });
    const previousHash = previous?.hash ?? null;
    const hash = this.computeHash(entry, previousHash, createdAt);

    await client.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        userLabel: entry.userLabel ?? null,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
        module: entry.module,
        action: entry.action,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        previousValue: (entry.previousValue ?? null) as Prisma.InputJsonValue,
        newValue: (entry.newValue ?? null) as Prisma.InputJsonValue,
        reason: entry.reason ?? null,
        branchId: entry.branchId ?? null,
        previousHash,
        hash,
        createdAt,
      },
    });
  }

  /** Walk the chain and report the first row whose hash does not verify. */
  async verifyChain(limit = 10000): Promise<{
    valid: boolean;
    checked: number;
    brokenAtSequence?: number;
  }> {
    const rows = await this.prisma.auditLog.findMany({
      orderBy: { sequence: 'asc' },
      take: limit,
    });

    let previousHash: string | null = null;
    for (const row of rows) {
      const expected = this.computeHash(
        {
          userId: row.userId,
          module: row.module,
          action: row.action,
          entityType: row.entityType ?? undefined,
          entityId: row.entityId ?? undefined,
          previousValue: row.previousValue,
          newValue: row.newValue,
          reason: row.reason ?? undefined,
          branchId: row.branchId,
        },
        previousHash,
        row.createdAt,
      );
      if (expected !== row.hash || row.previousHash !== previousHash) {
        return { valid: false, checked: rows.length, brokenAtSequence: row.sequence };
      }
      previousHash = row.hash;
    }

    return { valid: true, checked: rows.length };
  }
}
