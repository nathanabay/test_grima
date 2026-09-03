import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { spawn } from 'child_process';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from 'crypto';
import { createReadStream, createWriteStream, existsSync } from 'fs';
import { mkdir, readdir, stat, unlink } from 'fs/promises';
import { createGzip, createGunzip } from 'zlib';
import { join, resolve } from 'path';
import { pipeline } from 'stream/promises';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Backup and disaster recovery (§55).
 *
 * Dumps the database with pg_dump, compresses it, and encrypts it with
 * AES-256-GCM before it touches disk — so a stolen backup file does not hand
 * over patient records. The authentication tag is stored in the file header,
 * which means a truncated or tampered backup fails to decrypt rather than
 * restoring silently corrupted data.
 *
 * File layout: MAGIC(8) | salt(16) | iv(12) | authTag(16) | ciphertext
 */
const MAGIC = Buffer.from('PHCOREB1');
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private readonly dir = resolve(process.env.BACKUP_DIR ?? 'backups');
  private readonly retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private passphrase(): string {
    const key = process.env.BACKUP_ENCRYPTION_KEY;
    if (!key || key.length < 16) {
      // Refuse rather than write an unencrypted dump of patient data.
      throw new BadRequestException(
        'BACKUP_ENCRYPTION_KEY is not set (minimum 16 characters). ' +
          'Backups contain patient and controlled-drug records and are never written unencrypted.',
      );
    }
    return key;
  }

  private deriveKey(salt: Buffer): Buffer {
    return scryptSync(this.passphrase(), salt, 32);
  }

  /**
   * Translate the Prisma connection string into something pg_dump accepts.
   *
   * Prisma-specific query parameters (`schema`, `connection_limit`, and the
   * pool settings) are not valid libpq URI parameters — pg_dump aborts with
   * "invalid URI query parameter". The schema is lifted out and passed as a
   * proper `--schema` argument instead of being dropped.
   */
  private connection(): { url: string; schema?: string } {
    const raw = process.env.DATABASE_URL;
    if (!raw) throw new BadRequestException('DATABASE_URL is not configured');

    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      // Not a URL we can rewrite; hand it over untouched.
      return { url: raw };
    }

    const PRISMA_ONLY = [
      'schema',
      'connection_limit',
      'pool_timeout',
      'connect_timeout',
      'socket_timeout',
      'pgbouncer',
      'statement_cache_size',
    ];
    const schema = parsed.searchParams.get('schema') ?? undefined;
    for (const key of PRISMA_ONLY) parsed.searchParams.delete(key);

    return { url: parsed.toString(), schema };
  }

  /**
   * pg_dump is often absent from a service manager's PATH even when it is on
   * the operator's, so allow it to be pinned explicitly.
   */
  private pgDumpBinary(): string {
    return process.env.PG_DUMP_PATH || 'pg_dump';
  }

  /** Run pg_dump and stream it through gzip and the cipher into one file. */
  async run(trigger: 'SCHEDULED' | 'MANUAL', user?: AuthenticatedUser) {
    if (!existsSync(this.dir)) await mkdir(this.dir, { recursive: true });

    const startedAt = new Date();
    const fileName = `pharmacore-${startedAt.toISOString().replace(/[:.]/g, '-')}.sql.gz.enc`;
    const path = join(this.dir, fileName);

    const record = await this.prisma.backupRecord.create({
      data: { fileName, status: 'RUNNING', encrypted: true, startedAt },
    });

    try {
      const salt = randomBytes(SALT_LEN);
      const iv = randomBytes(IV_LEN);
      const cipher = createCipheriv('aes-256-gcm', this.deriveKey(salt), iv);

      const binary = this.pgDumpBinary();
      const { url, schema } = this.connection();
      const dump = spawn(binary, [
        '--no-owner',
        '--no-privileges',
        ...(schema ? [`--schema=${schema}`] : []),
        url,
      ]);
      let stderr = '';
      dump.stderr.on('data', (d) => (stderr += d.toString()));

      // Without this, a missing binary leaves stdout open forever and the
      // pipeline waits indefinitely instead of failing.
      // Attach the exit listener NOW, not after the pipeline. pg_dump can exit
      // before the pipeline settles, and a listener attached afterwards would
      // wait forever for an event that has already fired.
      const exit = new Promise<{ code: number }>((res) =>
        dump.on('close', (code) => res({ code: code ?? -1 })),
      );

      const spawnFailure = new Promise<never>((_, reject) => {
        dump.on('error', (e: any) =>
          reject(
            new Error(
              e.code === 'ENOENT'
                ? `Could not run "${binary}". Install the PostgreSQL client tools or set PG_DUMP_PATH to its full path.`
                : `Could not run "${binary}": ${e.message}`,
            ),
          ),
        );
      });

      // Belt and braces: a dump that stalls must fail rather than hang a request.
      const timeoutMs = Number(process.env.BACKUP_TIMEOUT_MS ?? 15 * 60_000);
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => {
          dump.kill('SIGKILL');
          reject(new Error(`Backup timed out after ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs).unref(),
      );

      // The auth tag is only known after the cipher finishes, so the payload is
      // written to a temporary file and the header prepended afterwards.
      const tmpPath = `${path}.part`;
      const gzip = createGzip();

      // NB: do not attach a 'data' listener to any stream inside the pipeline.
      // It puts that stream into flowing mode and steals chunks from the
      // pipeline, which stalls the write. The checksum is taken from the
      // finished file instead.
      await Promise.race([
        pipeline(dump.stdout, gzip, cipher, createWriteStream(tmpPath)),
        spawnFailure,
        timeout,
      ]);

      const { code: exitCode } = await exit;
      if (exitCode !== 0) {
        throw new Error(
          `${binary} exited with code ${exitCode}: ${stderr.trim().slice(0, 400) || 'no diagnostic output'}`,
        );
      }

      const tag = cipher.getAuthTag();
      await pipeline(
        (async function* () {
          yield Buffer.concat([MAGIC, salt, iv, tag]);
          for await (const chunk of createReadStream(tmpPath)) yield chunk as Buffer;
        })(),
        createWriteStream(path),
      );
      await unlink(tmpPath);

      const { size } = await stat(path);
      const checksum = await this.checksumOf(path);
      const completed = await this.prisma.backupRecord.update({
        where: { id: record.id },
        data: {
          status: 'SUCCESS',
          sizeBytes: BigInt(size),
          checksum,
          completedAt: new Date(),
        },
      });

      await this.audit.record({
        userId: user?.id ?? null,
        userLabel: user?.fullName ?? `System (${trigger.toLowerCase()} backup)`,
        module: 'admin',
        action: 'BACKUP',
        entityType: 'BackupRecord',
        entityId: record.id,
        newValue: { fileName, sizeBytes: size, trigger },
      });

      this.logger.log(`Backup ${fileName} completed (${(size / 1024 / 1024).toFixed(1)} MB)`);
      await this.prune();

      return { ...completed, sizeBytes: Number(completed.sizeBytes) };
    } catch (error: any) {
      // Never leave a half-written payload behind to be mistaken for a backup.
      await unlink(`${path}.part`).catch(() => undefined);
      await unlink(path).catch(() => undefined);

      await this.prisma.backupRecord.update({
        where: { id: record.id },
        data: { status: 'FAILED', errorMessage: String(error.message).slice(0, 500), completedAt: new Date() },
      });

      // A silent backup failure is the worst outcome: shout about it.
      await this.notifications.emit({
        eventType: 'BACKUP_FAILED',
        severity: 'CRITICAL',
        title: 'Database backup FAILED',
        body: `${fileName} did not complete: ${error.message}`,
        roleCodes: ['SUPER_ADMIN', 'PHARMACY_ADMIN'],
        linkUrl: '/admin?tab=Backups',
      });

      this.logger.error(`Backup failed: ${error.message}`);
      throw error;
    }
  }

  /** SHA-256 of a finished file, read back from disk. */
  private async checksumOf(path: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
    return hash.digest('hex');
  }

  /**
   * Verify a backup by decrypting it end to end. GCM authenticates as it goes,
   * so a corrupted or tampered file fails here rather than during a restore.
   */
  async verify(id: string, user?: AuthenticatedUser) {
    const record = await this.prisma.backupRecord.findUniqueOrThrow({ where: { id } });
    const path = join(this.dir, record.fileName);
    if (!existsSync(path)) {
      throw new BadRequestException(`Backup file ${record.fileName} is missing from ${this.dir}`);
    }

    try {
      await this.decryptToStream(path, async (source) => {
        // Drain without writing anywhere: reaching the end without the GCM tag
        // throwing is what proves the file is intact.
        for await (const chunk of source) void chunk;
      });

      const updated = await this.prisma.backupRecord.update({
        where: { id },
        data: { verifiedAt: new Date(), errorMessage: null },
      });

      await this.audit.record({
        userId: user?.id ?? null,
        module: 'admin',
        action: 'BACKUP_VERIFIED',
        entityType: 'BackupRecord',
        entityId: id,
        newValue: { fileName: record.fileName },
      });

      return { ...updated, sizeBytes: Number(updated.sizeBytes), valid: true };
    } catch (error: any) {
      await this.prisma.backupRecord.update({
        where: { id },
        data: { errorMessage: `Verification failed: ${error.message}`.slice(0, 500) },
      });
      throw new BadRequestException(
        `Backup ${record.fileName} failed verification: ${error.message}. ` +
          `Treat it as unusable and take a fresh backup.`,
      );
    }
  }

  /** Decrypt and decompress a backup, handing the plain SQL to a consumer. */
  private async decryptToStream(
    path: string,
    consume: (source: AsyncIterable<Buffer>) => Promise<void>,
  ): Promise<void> {
    const header: Buffer = await new Promise((res, rej) => {
      const chunks: Buffer[] = [];
      const stream = createReadStream(path, { end: MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN - 1 });
      stream.on('data', (c) => chunks.push(c as Buffer));
      stream.on('end', () => res(Buffer.concat(chunks)));
      stream.on('error', rej);
    });

    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error('Not a PharmaCore backup file');
    }
    let offset = MAGIC.length;
    const salt = header.subarray(offset, (offset += SALT_LEN));
    const iv = header.subarray(offset, (offset += IV_LEN));
    const tag = header.subarray(offset, (offset += TAG_LEN));

    const decipher = createDecipheriv('aes-256-gcm', this.deriveKey(salt), iv);
    decipher.setAuthTag(tag);

    const body = createReadStream(path, { start: offset });
    const gunzip = createGunzip();

    // .pipe() leaves stream errors unhandled, and an unhandled 'error' event
    // takes the whole process down. A corrupt backup must surface as a
    // rejected promise, not a crashed API. pipeline() propagates and cleans up.
    const plumbing = pipeline(body, decipher, gunzip);
    // Swallow here so the rejection is only observed once, via Promise.all below.
    plumbing.catch(() => undefined);

    await Promise.all([plumbing, consume(gunzip as unknown as AsyncIterable<Buffer>)]);
  }

  /**
   * Restore is deliberately NOT exposed over HTTP. Overwriting a live
   * pharmaceutical database is an operator action performed at the console,
   * with the service stopped — this only produces the decrypted SQL.
   */
  async decryptToFile(id: string, targetPath: string, user: AuthenticatedUser) {
    const record = await this.prisma.backupRecord.findUniqueOrThrow({ where: { id } });
    const source = join(this.dir, record.fileName);
    const out = createWriteStream(targetPath);

    await this.decryptToStream(source, async (stream) => {
      for await (const chunk of stream) out.write(chunk);
      out.end();
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'admin',
      action: 'BACKUP_DECRYPTED',
      entityType: 'BackupRecord',
      entityId: id,
      newValue: { target: targetPath },
      reason: 'Decrypted for restore',
    });

    return { fileName: record.fileName, decryptedTo: targetPath };
  }

  /** Remove backups past the retention window, keeping at least the newest three. */
  private async prune(): Promise<{ removed: number }> {
    const cutoff = new Date(Date.now() - this.retentionDays * 86_400_000);
    const old = await this.prisma.backupRecord.findMany({
      where: { status: 'SUCCESS', startedAt: { lt: cutoff } },
      orderBy: { startedAt: 'desc' },
    });
    const keep = await this.prisma.backupRecord.findMany({
      where: { status: 'SUCCESS' },
      orderBy: { startedAt: 'desc' },
      take: 3,
      select: { id: true },
    });
    const keepIds = new Set(keep.map((k) => k.id));

    let removed = 0;
    for (const record of old) {
      if (keepIds.has(record.id)) continue;
      const path = join(this.dir, record.fileName);
      await unlink(path).catch(() => undefined);
      await this.prisma.backupRecord.delete({ where: { id: record.id } });
      removed += 1;
    }
    if (removed) this.logger.log(`Pruned ${removed} backup(s) older than ${this.retentionDays} days`);
    return { removed };
  }

  /** What administrators see: last success, next run, current status (§55). */
  async status() {
    const [lastSuccess, lastFailure, records] = await Promise.all([
      this.prisma.backupRecord.findFirst({
        where: { status: 'SUCCESS' },
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.backupRecord.findFirst({
        where: { status: 'FAILED' },
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.backupRecord.findMany({ orderBy: { startedAt: 'desc' }, take: 20 }),
    ]);

    // Scheduled for 01:30 daily; report the next occurrence.
    const next = new Date();
    next.setHours(1, 30, 0, 0);
    if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);

    let onDisk = 0;
    if (existsSync(this.dir)) {
      const files = await readdir(this.dir);
      onDisk = files.filter((f) => f.endsWith('.enc')).length;
    }

    const hoursSince = lastSuccess
      ? (Date.now() - (lastSuccess.completedAt ?? lastSuccess.startedAt).getTime()) / 3_600_000
      : null;

    return {
      configured: !!process.env.BACKUP_ENCRYPTION_KEY,
      directory: this.dir,
      retentionDays: this.retentionDays,
      lastSuccessfulBackup: lastSuccess
        ? {
            fileName: lastSuccess.fileName,
            completedAt: lastSuccess.completedAt,
            sizeBytes: Number(lastSuccess.sizeBytes),
            verifiedAt: lastSuccess.verifiedAt,
            checksum: lastSuccess.checksum,
          }
        : null,
      lastFailure: lastFailure
        ? { fileName: lastFailure.fileName, at: lastFailure.startedAt, error: lastFailure.errorMessage }
        : null,
      nextScheduledBackup: next,
      filesOnDisk: onDisk,
      // A backup older than 48 hours is itself a finding.
      health:
        !lastSuccess ? 'NO_BACKUP'
        : hoursSince! > 48 ? 'STALE'
        : lastFailure && lastFailure.startedAt > (lastSuccess.completedAt ?? lastSuccess.startedAt) ? 'LAST_RUN_FAILED'
        : 'OK',
      history: records.map((r) => ({ ...r, sizeBytes: Number(r.sizeBytes) })),
    };
  }

  @Cron('30 1 * * *')
  async scheduled() {
    if (!process.env.BACKUP_ENCRYPTION_KEY) {
      this.logger.warn('Scheduled backup skipped: BACKUP_ENCRYPTION_KEY is not configured');
      return;
    }
    try {
      const result = await this.run('SCHEDULED');
      // Verify immediately: an unverified backup is only a hope.
      await this.verify(result.id);
    } catch (error: any) {
      this.logger.error(`Scheduled backup failed: ${error.message}`);
    }
  }
}
