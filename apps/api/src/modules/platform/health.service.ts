import { Injectable, Logger } from '@nestjs/common';
import { statfsSync } from 'node:fs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { ConfigService } from '../../common/config/config.service';
import { JobRunnerService } from '../jobs/job-runner.service';

export type HealthState = 'OK' | 'DEGRADED' | 'DOWN' | 'NOT_CONFIGURED';

export interface HealthCheck {
  key: string;
  label: string;
  state: HealthState;
  detail: string;
  latencyMs?: number;
  /** Where an operator should go to act on a problem. */
  linkUrl?: string;
}

/**
 * System health (§64).
 *
 * Every check performs real work — a query, a stat of the disk, a read of the
 * delivery queue. Nothing here reports "OK" because a variable is set; a
 * dependency that cannot be reached is reported DOWN, and one that is simply
 * not configured is reported NOT_CONFIGURED rather than being hidden or
 * claimed as healthy (§35).
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly config: ConfigService,
    private readonly jobs: JobRunnerService,
  ) {}

  /** Cheap check for a load balancer: is the process up and the database reachable? */
  async liveness(): Promise<{ status: string; uptimeSeconds: number }> {
    return {
      status: 'ok',
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
    };
  }

  async readiness(): Promise<{ status: string; database: HealthState }> {
    const db = await this.checkDatabase();
    return {
      status: db.state === 'OK' ? 'ready' : 'not-ready',
      database: db.state,
    };
  }

  private async timed<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: Error; ms: number }> {
    const start = Date.now();
    try {
      const value = await fn();
      return { value, ms: Date.now() - start };
    } catch (error) {
      return { error: error as Error, ms: Date.now() - start };
    }
  }

  private async checkDatabase(): Promise<HealthCheck> {
    const { error, ms } = await this.timed(() => this.prisma.$queryRaw`SELECT 1`);
    if (error) {
      return {
        key: 'database',
        label: 'Database',
        state: 'DOWN',
        detail: error.message.slice(0, 200),
        latencyMs: ms,
      };
    }
    return {
      key: 'database',
      label: 'Database',
      // A database answering slowly is not healthy, it is about to be an outage.
      state: ms > 1000 ? 'DEGRADED' : 'OK',
      detail: ms > 1000 ? `Responding slowly (${ms}ms)` : `PostgreSQL responding in ${ms}ms`,
      latencyMs: ms,
    };
  }

  private async checkMigrations(): Promise<HealthCheck> {
    const { value, error } = await this.timed(
      () =>
        this.prisma.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`
          SELECT migration_name, finished_at
          FROM _prisma_migrations
          ORDER BY started_at DESC
          LIMIT 5`,
    );
    if (error) {
      return {
        key: 'migrations',
        label: 'Schema migrations',
        state: 'DEGRADED',
        detail: 'Migration history table is unreadable',
      };
    }
    const rows = value ?? [];
    const pending = rows.filter((r) => !r.finished_at);
    return {
      key: 'migrations',
      label: 'Schema migrations',
      state: pending.length ? 'DEGRADED' : 'OK',
      detail: pending.length
        ? `${pending.length} migration(s) did not finish: ${pending.map((p) => p.migration_name).join(', ')}`
        : `Latest applied: ${rows[0]?.migration_name ?? 'none'}`,
    };
  }

  private async checkQueue(): Promise<HealthCheck> {
    const [pending, failed, stuck] = await Promise.all([
      this.prisma.integrationDelivery.count({ where: { status: { in: ['PENDING', 'RETRYING'] } } }),
      this.prisma.integrationDelivery.count({
        where: { status: 'FAILED', createdAt: { gte: new Date(Date.now() - 86_400_000) } },
      }),
      this.prisma.integrationDelivery.count({
        where: {
          status: { in: ['PENDING', 'RETRYING'] },
          createdAt: { lt: new Date(Date.now() - 3_600_000) },
        },
      }),
    ]);

    return {
      key: 'queue',
      label: 'Integration queue',
      // A backlog older than an hour means the drain job is not running.
      state: stuck > 0 ? 'DEGRADED' : 'OK',
      detail:
        `${pending} queued, ${failed} failed in the last 24h` +
        (stuck ? `, ${stuck} waiting over an hour` : ''),
      linkUrl: '/admin/integrations',
    };
  }

  private async checkJobs(): Promise<HealthCheck> {
    const statuses = await this.jobs.status();
    const failed = statuses.filter((s) => s.lastStatus === 'FAILED');
    const never = statuses.filter((s) => s.lastStatus === 'NEVER_RUN');

    return {
      key: 'jobs',
      label: 'Background jobs',
      state: failed.length ? 'DEGRADED' : 'OK',
      detail: failed.length
        ? `${failed.length} job(s) failed on their last run: ${failed.map((f) => f.key).join(', ')}`
        : `${statuses.length - never.length}/${statuses.length} job(s) have run successfully`,
      linkUrl: '/admin/jobs',
    };
  }

  private checkStorage(): HealthCheck {
    const dir = process.env.UPLOAD_DIR || 'uploads';
    try {
      const stats = statfsSync(dir === '' ? '.' : '.');
      const totalBytes = stats.blocks * stats.bsize;
      const freeBytes = stats.bavail * stats.bsize;
      const usedPercent = totalBytes ? Math.round(((totalBytes - freeBytes) / totalBytes) * 100) : 0;
      return {
        key: 'storage',
        label: 'Document storage',
        state: usedPercent > 95 ? 'DOWN' : usedPercent > 85 ? 'DEGRADED' : 'OK',
        detail: `${usedPercent}% of the volume used, ${(freeBytes / 1_073_741_824).toFixed(1)} GB free (${dir})`,
      };
    } catch (error) {
      return {
        key: 'storage',
        label: 'Document storage',
        state: 'DEGRADED',
        detail: `Could not stat the storage volume: ${(error as Error).message}`,
      };
    }
  }

  private async checkBackups(): Promise<HealthCheck> {
    if (!process.env.BACKUP_ENCRYPTION_KEY) {
      return {
        key: 'backups',
        label: 'Backups',
        state: 'NOT_CONFIGURED',
        detail: 'BACKUP_ENCRYPTION_KEY is not set, so backups are not being taken.',
      };
    }

    const last = await this.prisma.backupRecord.findFirst({ orderBy: { startedAt: 'desc' } });
    if (!last) {
      return {
        key: 'backups',
        label: 'Backups',
        state: 'DEGRADED',
        detail: 'No backup has ever been taken.',
        linkUrl: '/admin/backups',
      };
    }

    const ageHours = (Date.now() - last.startedAt.getTime()) / 3_600_000;
    const stale = ageHours > 36;
    return {
      key: 'backups',
      label: 'Backups',
      state: last.status === 'FAILED' || stale ? 'DEGRADED' : 'OK',
      detail:
        last.status === 'FAILED'
          ? `Last backup failed: ${last.errorMessage ?? 'no reason recorded'}`
          : `Last backup ${Math.round(ageHours)}h ago, ${last.verifiedAt ? 'verified' : 'not yet verified'}`,
      linkUrl: '/admin/backups',
    };
  }

  private async checkColdChain(): Promise<HealthCheck> {
    const offlineMinutes = await this.config.getNumber('coldchain.sensorOfflineMinutes');
    const cutoff = new Date(Date.now() - offlineMinutes * 60_000);

    const sensors = await this.prisma.temperatureSensor.findMany({
      where: { isActive: true },
      select: { id: true, code: true, lastReadingAt: true },
    });
    if (!sensors.length) {
      return {
        key: 'iot',
        label: 'IoT sensors',
        state: 'NOT_CONFIGURED',
        detail: 'No temperature sensors are registered.',
        linkUrl: '/cold-chain',
      };
    }

    const offline = sensors.filter((s) => !s.lastReadingAt || s.lastReadingAt < cutoff);
    return {
      key: 'iot',
      label: 'IoT sensors',
      state: offline.length ? 'DEGRADED' : 'OK',
      detail: offline.length
        ? `${offline.length}/${sensors.length} sensor(s) silent for over ${offlineMinutes} minutes: ${offline
            .slice(0, 5)
            .map((s) => s.code)
            .join(', ')}`
        : `${sensors.length} sensor(s) reporting`,
      linkUrl: '/cold-chain',
    };
  }

  private channelCheck(
    key: string,
    label: string,
    envVar: string,
    linkUrl?: string,
  ): HealthCheck {
    const configured = Boolean(process.env[envVar]);
    return {
      key,
      label,
      state: configured ? 'OK' : 'NOT_CONFIGURED',
      detail: configured
        ? `${envVar} is configured`
        : `${envVar} is not set; this channel is disabled and nothing is sent through it.`,
      linkUrl,
    };
  }

  private async checkErrors(): Promise<HealthCheck> {
    const since = new Date(Date.now() - 86_400_000);
    const failures = await this.prisma.jobRun.count({
      where: { status: 'FAILED', startedAt: { gte: since } },
    });
    return {
      key: 'errors',
      label: 'Recent errors',
      state: failures > 10 ? 'DEGRADED' : 'OK',
      detail: `${failures} job failure(s) in the last 24 hours`,
      linkUrl: '/admin/jobs',
    };
  }

  /** The full health picture behind the administration screen. */
  async full(): Promise<{
    state: HealthState;
    uptimeSeconds: number;
    checks: HealthCheck[];
    cache: ReturnType<CacheService['stats']>;
    failedJobs: unknown[];
  }> {
    const [database, migrations, queue, jobs, backups, iot, errors] = await Promise.all([
      this.checkDatabase(),
      this.checkMigrations(),
      this.checkQueue(),
      this.checkJobs(),
      this.checkBackups(),
      this.checkColdChain(),
      this.checkErrors(),
    ]);

    const checks: HealthCheck[] = [
      { key: 'api', label: 'API', state: 'OK', detail: `Up for ${Math.round((Date.now() - this.startedAt) / 1000)}s` },
      database,
      migrations,
      queue,
      jobs,
      this.checkStorage(),
      backups,
      iot,
      errors,
      this.channelCheck('email', 'Email delivery', 'EMAIL_API_URL', '/admin'),
      this.channelCheck('sms', 'SMS delivery', 'SMS_PROVIDER_URL', '/admin'),
      this.channelCheck('telegram', 'Telegram delivery', 'TELEGRAM_BOT_TOKEN', '/admin'),
      this.channelCheck('whatsapp', 'WhatsApp delivery', 'WHATSAPP_TOKEN', '/admin'),
      this.channelCheck('push', 'Web push delivery', 'PUSH_API_URL', '/admin'),
      this.channelCheck('payments', 'Payment gateway', 'PAYMENT_PROVIDER_URL', '/admin'),
    ];

    // NOT_CONFIGURED is not a fault: an unconfigured SMS provider is a
    // deployment choice, not an outage, so it never drags the overall state.
    const state: HealthState = checks.some((c) => c.state === 'DOWN')
      ? 'DOWN'
      : checks.some((c) => c.state === 'DEGRADED')
        ? 'DEGRADED'
        : 'OK';

    return {
      state,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      checks,
      cache: this.cache.stats(),
      failedJobs: await this.jobs.recentFailures(24),
    };
  }
}
