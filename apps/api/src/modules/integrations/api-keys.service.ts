import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { allPermissionCodes } from '@pharmacore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';

const VALID_PERMISSIONS = new Set(allPermissionCodes());

/**
 * Machine-to-machine credentials (§53, §54).
 *
 * The key is shown once, at creation, and only its hash is stored — someone
 * reading the database cannot use it. Scopes are ordinary permission codes
 * checked by the same guard that checks a user's, so an integration can never
 * do something no role could do.
 */
@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private hash(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  async list() {
    const keys = await this.prisma.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        prefix: true,
        scopes: true,
        branchId: true,
        rateLimit: true,
        expiresAt: true,
        isActive: true,
        lastUsedAt: true,
        usageCount: true,
        revokedAt: true,
        createdAt: true,
        // keyHash is deliberately never selected.
      },
    });

    const now = new Date();
    return keys.map((k) => ({
      ...k,
      status: k.revokedAt
        ? 'REVOKED'
        : !k.isActive
          ? 'DISABLED'
          : k.expiresAt && k.expiresAt < now
            ? 'EXPIRED'
            : 'ACTIVE',
    }));
  }

  /**
   * Create a key. The full value is returned exactly once and never again.
   */
  async create(
    data: {
      name: string;
      description?: string;
      scopes: string[];
      branchId?: string;
      rateLimit?: number;
      expiresInDays?: number;
    },
    user: AuthenticatedUser,
  ) {
    if (!data.name?.trim()) throw new BadRequestException('An API key needs a name');
    if (!data.scopes?.length) {
      throw new BadRequestException(
        'An API key with no scopes can do nothing; grant at least one permission',
      );
    }

    const unknown = data.scopes.filter((s) => !VALID_PERMISSIONS.has(s));
    if (unknown.length) {
      throw new BadRequestException(`Unknown permission(s): ${unknown.join(', ')}`);
    }

    // A key must never hold a permission its creator does not have, or an
    // integration becomes a way to escalate privilege.
    const missing = data.scopes.filter((s) => !user.permissions.includes(s));
    if (missing.length) {
      throw new BadRequestException(
        `You cannot grant a permission you do not hold yourself: ${missing.join(', ')}`,
      );
    }

    // 32 random bytes, printed with a recognisable prefix so a leaked key can
    // be spotted in a log or a repository.
    const secret = randomBytes(32).toString('base64url');
    const prefix = `pck_${randomBytes(4).toString('hex')}`;
    const fullKey = `${prefix}.${secret}`;

    const created = await this.prisma.apiKey.create({
      data: {
        name: data.name.trim(),
        description: data.description ?? null,
        prefix,
        keyHash: this.hash(fullKey),
        scopes: data.scopes,
        branchId: data.branchId ?? null,
        rateLimit: data.rateLimit ?? 120,
        expiresAt: data.expiresInDays
          ? new Date(Date.now() + data.expiresInDays * 86_400_000)
          : null,
        createdById: user.id,
      },
    });

    await this.audit.record({
      userId: user.id,
      module: 'admin',
      action: 'CREATE',
      entityType: 'ApiKey',
      entityId: created.id,
      // The key itself is never written to the audit log (§64).
      newValue: {
        name: created.name,
        prefix: created.prefix,
        scopes: created.scopes,
        expiresAt: created.expiresAt,
      },
    });

    return {
      id: created.id,
      name: created.name,
      prefix: created.prefix,
      scopes: created.scopes,
      expiresAt: created.expiresAt,
      key: fullKey,
      warning:
        'This is the only time the key is shown. Store it now; it cannot be recovered, only replaced.',
    };
  }

  /**
   * Resolve a presented key.
   *
   * Returns null for anything not usable, without saying which reason — an
   * unauthenticated caller learning that a key exists but has expired is more
   * information than they need.
   */
  async verify(presented: string): Promise<{
    id: string;
    name: string;
    scopes: string[];
    branchId: string | null;
    rateLimit: number;
  } | null> {
    if (!presented?.startsWith('pck_')) return null;

    const prefix = presented.split('.')[0];
    const record = await this.prisma.apiKey.findUnique({ where: { prefix } });
    if (!record) return null;

    if (!record.isActive || record.revokedAt) return null;
    if (record.expiresAt && record.expiresAt < new Date()) return null;

    // Compared as hashes, so a wrong key never reaches a string comparison
    // against the real one.
    if (this.hash(presented) !== record.keyHash) return null;

    void this.prisma.apiKey
      .update({
        where: { id: record.id },
        data: { lastUsedAt: new Date(), usageCount: { increment: 1 } },
      })
      .catch(() => undefined);

    return {
      id: record.id,
      name: record.name,
      scopes: record.scopes,
      branchId: record.branchId,
      rateLimit: record.rateLimit,
    };
  }

  async revoke(id: string, reason: string, user: AuthenticatedUser) {
    const key = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!key) throw new NotFoundException('API key not found');
    if (key.revokedAt) throw new ConflictException(`${key.name} is already revoked`);

    const revoked = await this.prisma.apiKey.update({
      where: { id },
      data: { isActive: false, revokedAt: new Date(), revokedById: user.id },
    });

    await this.audit.record({
      userId: user.id,
      module: 'admin',
      action: 'DELETE',
      entityType: 'ApiKey',
      entityId: id,
      previousValue: { name: key.name, prefix: key.prefix, isActive: true },
      newValue: { isActive: false, revokedAt: revoked.revokedAt },
      reason,
    });

    return { revoked: true, name: key.name };
  }

  async update(id: string, data: Record<string, unknown>, user: AuthenticatedUser) {
    const key = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!key) throw new NotFoundException('API key not found');
    if (key.revokedAt) {
      throw new ConflictException('A revoked key cannot be changed; create a new one');
    }

    if (Array.isArray(data.scopes)) {
      const scopes = data.scopes as string[];
      const unknown = scopes.filter((s) => !VALID_PERMISSIONS.has(s));
      if (unknown.length) throw new BadRequestException(`Unknown permission(s): ${unknown.join(', ')}`);
      const missing = scopes.filter((s) => !user.permissions.includes(s));
      if (missing.length) {
        throw new BadRequestException(
          `You cannot grant a permission you do not hold yourself: ${missing.join(', ')}`,
        );
      }
    }

    // The hash and prefix are not editable through this path.
    const { keyHash: _k, prefix: _p, ...safe } = data as Record<string, unknown>;

    const updated = await this.prisma.apiKey.update({ where: { id }, data: safe });
    await this.audit.record({
      userId: user.id,
      module: 'admin',
      action: 'EDIT',
      entityType: 'ApiKey',
      entityId: id,
      previousValue: { scopes: key.scopes, isActive: key.isActive, rateLimit: key.rateLimit },
      newValue: { scopes: updated.scopes, isActive: updated.isActive, rateLimit: updated.rateLimit },
    });

    return { ...updated, keyHash: undefined };
  }
}
