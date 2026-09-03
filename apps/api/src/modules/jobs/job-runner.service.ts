import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface JobDescriptor {
  key: string;
  label: string;
  description: string;
  /** Human-readable schedule, for the administration screen. */
  schedule: string;
  run: () => Promise<unknown>;
}

/**
 * Registry and execution wrapper for background jobs (§64).
 *
 * Every scheduled job goes through `execute`, which writes a JobRun row before
 * and after. That is the difference between "the cron is configured" and "the
 * job actually ran last night", and it is what the system health screen reads.
 *
 * Jobs are also runnable on demand, so an administrator can re-run last
 * night's expiry sweep after fixing the data that made it fail rather than
 * waiting a day.
 */
@Injectable()
export class JobRunnerService {
  private readonly logger = new Logger(JobRunnerService.name);
  private readonly registry = new Map<string, JobDescriptor>();
  private readonly running = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  register(descriptor: JobDescriptor): void {
    this.registry.set(descriptor.key, descriptor);
  }

  list(): Omit<JobDescriptor, 'run'>[] {
    return [...this.registry.values()].map(({ run: _run, ...rest }) => rest);
  }

  has(key: string): boolean {
    return this.registry.has(key);
  }

  /**
   * Run a job, recording the attempt. A job already in flight is not started
   * again — a second expiry sweep racing the first would double-post.
   */
  async execute(
    key: string,
    trigger: 'SCHEDULED' | 'MANUAL' = 'SCHEDULED',
    triggeredById?: string,
  ): Promise<{ status: string; result?: unknown; error?: string; skipped?: boolean }> {
    const descriptor = this.registry.get(key);
    if (!descriptor) throw new Error(`Unknown job '${key}'`);

    if (this.running.has(key)) {
      this.logger.warn(`Job ${key} is already running; this trigger was skipped`);
      return { status: 'SKIPPED', skipped: true };
    }

    this.running.add(key);
    const started = Date.now();
    const record = await this.prisma.jobRun.create({
      data: { jobKey: key, trigger, status: 'RUNNING', triggeredById: triggeredById ?? null },
    });

    try {
      const result = await descriptor.run();
      await this.prisma.jobRun.update({
        where: { id: record.id },
        data: {
          status: 'SUCCESS',
          finishedAt: new Date(),
          durationMs: Date.now() - started,
          result: (result ?? {}) as object,
        },
      });
      return { status: 'SUCCESS', result };
    } catch (error) {
      const message = (error as Error).message ?? String(error);
      this.logger.error(`Job ${key} failed: ${message}`);
      await this.prisma.jobRun.update({
        where: { id: record.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          durationMs: Date.now() - started,
          // Only the message: a stack trace can carry connection strings (§64).
          errorMessage: message.slice(0, 2000),
        },
      });
      return { status: 'FAILED', error: message };
    } finally {
      this.running.delete(key);
    }
  }

  /** Latest run per registered job, for the health and administration screens. */
  async status() {
    const jobs = this.list();
    const latest = await this.prisma.jobRun.findMany({
      where: { jobKey: { in: jobs.map((j) => j.key) } },
      orderBy: { startedAt: 'desc' },
      take: 200,
    });

    const byKey = new Map<string, (typeof latest)[number]>();
    for (const run of latest) if (!byKey.has(run.jobKey)) byKey.set(run.jobKey, run);

    return jobs.map((job) => {
      const run = byKey.get(job.key);
      return {
        ...job,
        isRunning: this.running.has(job.key),
        lastStatus: run?.status ?? 'NEVER_RUN',
        lastStartedAt: run?.startedAt ?? null,
        lastFinishedAt: run?.finishedAt ?? null,
        lastDurationMs: run?.durationMs ?? null,
        lastError: run?.errorMessage ?? null,
        lastResult: run?.result ?? null,
      };
    });
  }

  async history(query: { jobKey?: string; page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, query.pageSize ?? 50);
    const where = query.jobKey ? { jobKey: query.jobKey } : {};
    const [data, total] = await this.prisma.$transaction([
      this.prisma.jobRun.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.jobRun.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  /** Failures in the recent past — the "failed jobs" card on the health page. */
  async recentFailures(hours = 24) {
    return this.prisma.jobRun.findMany({
      where: {
        status: 'FAILED',
        startedAt: { gte: new Date(Date.now() - hours * 3_600_000) },
      },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
  }
}
