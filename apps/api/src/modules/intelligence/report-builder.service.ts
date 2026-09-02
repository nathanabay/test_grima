import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { evaluateConditions, readField, ConditionGroup } from '@pharmacore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ScopeService } from '../../common/guards/scope.service';
import { AuthenticatedUser } from '../../common/decorators';
import { REPORT_SOURCES, ReportColumn, SOURCES_BY_KEY } from './report-sources';

export interface ReportDefinition {
  dataSource: string;
  columns: string[];
  filters?: { field: string; operator: string; value?: unknown; value2?: unknown }[];
  groupBy?: string | null;
  sort?: { field: string; direction: 'asc' | 'desc' }[];
  aggregates?: Record<string, 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'>;
  from?: string;
  to?: string;
  limit?: number;
}

/**
 * Report builder (§60, §61).
 *
 * Reports are assembled from a whitelist of data sources and columns, never
 * from user-supplied SQL. Three checks run on every execution, not on save:
 *
 *  - The caller must hold the source's read permission.
 *  - A column may carry its own extra permission; one they lack is dropped
 *    from the result with a note, rather than the whole report being refused.
 *  - The branch restriction is applied inside the query.
 *
 * Running a report is audited when it touches patient, financial or audit data.
 */
@Injectable()
export class ReportBuilderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  /** The catalogue, filtered to what this user may actually read. */
  catalogue(user: AuthenticatedUser) {
    return REPORT_SOURCES.filter((s) => user.permissions.includes(s.permission)).map((s) => ({
      key: s.key,
      label: s.label,
      description: s.description,
      supportsBranchFilter: s.branchPath !== null,
      columns: s.columns.map((c) => ({
        key: c.key,
        label: c.label,
        type: c.type,
        numeric: Boolean(c.numeric),
        available: !c.requires || user.permissions.includes(c.requires),
        requires: c.requires ?? null,
      })),
    }));
  }

  private resolveColumns(
    source: (typeof REPORT_SOURCES)[number],
    requested: string[],
    user: AuthenticatedUser,
  ): { columns: ReportColumn[]; withheld: { key: string; requires: string }[] } {
    const byKey = new Map(source.columns.map((c) => [c.key, c]));
    const chosen = requested.length ? requested : source.columns.map((c) => c.key);

    const columns: ReportColumn[] = [];
    const withheld: { key: string; requires: string }[] = [];

    for (const key of chosen) {
      const column = byKey.get(key);
      if (!column) {
        throw new BadRequestException(
          `'${key}' is not a column of ${source.label}. Available: ${[...byKey.keys()].join(', ')}`,
        );
      }
      if (column.requires && !user.permissions.includes(column.requires)) {
        // Withheld rather than refused: a stock report is still useful to
        // someone who may not see cost.
        withheld.push({ key, requires: column.requires });
        continue;
      }
      columns.push(column);
    }

    if (!columns.length) {
      throw new ForbiddenException(
        'Every column in this report needs a permission you do not hold',
      );
    }

    return { columns, withheld };
  }

  async run(definition: ReportDefinition, user: AuthenticatedUser) {
    const source = SOURCES_BY_KEY.get(definition.dataSource);
    if (!source) {
      throw new BadRequestException(
        `Unknown data source '${definition.dataSource}'. Available: ${[...SOURCES_BY_KEY.keys()].join(', ')}`,
      );
    }

    // Checked at run time, not at save time: a report saved while someone had
    // a permission must not keep working after it is taken away.
    if (!user.permissions.includes(source.permission)) {
      throw new ForbiddenException(
        `Reading ${source.label} requires ${source.permission}`,
      );
    }

    const { columns, withheld } = this.resolveColumns(source, definition.columns ?? [], user);

    const where: Record<string, unknown> = {};
    if (source.branchPath) {
      const branchFilter = this.scope.branchFilter(user);
      Object.assign(where, branchFilter);
    }

    // A date range narrows the query in the database rather than in memory.
    const dateColumn = source.columns.find((c) => c.type === 'date' && !c.path);
    if ((definition.from || definition.to) && dateColumn) {
      where[dateColumn.key] = {
        ...(definition.from ? { gte: new Date(definition.from) } : {}),
        ...(definition.to ? { lte: new Date(definition.to) } : {}),
      };
    }

    const limit = Math.min(definition.limit ?? 1000, 10_000);

    const rows: Record<string, unknown>[] = await (this.prisma as never as Record<string, any>)[
      source.model
    ].findMany({
      where,
      ...(source.include ? { include: source.include } : {}),
      take: limit,
    });

    // Filters run in memory against the projected values, so a filter can use
    // a nested column without needing a Prisma path for every combination.
    const projected = rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const column of columns) {
        const value = readField(row, column.path ?? column.key);
        out[column.key] =
          value instanceof Date
            ? value.toISOString()
            : value !== null && typeof value === 'object' && 'toString' in value
              ? value.toString()
              : value;
      }
      return out;
    });

    const group: ConditionGroup = {
      match: 'ALL',
      conditions: (definition.filters ?? []).map((f) => ({
        field: f.field,
        operator: f.operator as never,
        value: f.value,
        value2: f.value2,
      })),
    };

    const filtered = group.conditions.length
      ? projected.filter((row) => evaluateConditions(row, group).matched)
      : projected;

    const sorted = this.applySort(filtered, definition.sort ?? [], columns);
    const result = definition.groupBy
      ? this.applyGrouping(sorted, definition.groupBy, definition.aggregates ?? {}, columns)
      : { rows: sorted, grouped: false as const };

    await this.auditIfSensitive(source.key, source.permission, definition, user, filtered.length);

    return {
      dataSource: source.key,
      label: source.label,
      columns: columns.map((c) => ({ key: c.key, label: c.label, type: c.type, numeric: Boolean(c.numeric) })),
      // Named explicitly so a missing column is understood rather than
      // mistaken for missing data.
      withheldColumns: withheld,
      rowCount: result.rows.length,
      scannedRows: rows.length,
      truncated: rows.length >= limit,
      ...result,
    };
  }

  private applySort(
    rows: Record<string, unknown>[],
    sort: { field: string; direction: 'asc' | 'desc' }[],
    columns: ReportColumn[],
  ) {
    if (!sort.length) return rows;
    const numeric = new Set(columns.filter((c) => c.numeric).map((c) => c.key));

    return [...rows].sort((a, b) => {
      for (const { field, direction } of sort) {
        const left = a[field];
        const right = b[field];
        if (left === right) continue;
        if (left === null || left === undefined) return 1;
        if (right === null || right === undefined) return -1;

        const comparison = numeric.has(field)
          ? Number(left) - Number(right)
          : String(left).localeCompare(String(right));
        if (comparison !== 0) return direction === 'desc' ? -comparison : comparison;
      }
      return 0;
    });
  }

  private applyGrouping(
    rows: Record<string, unknown>[],
    groupBy: string,
    aggregates: Record<string, string>,
    columns: ReportColumn[],
  ) {
    const numeric = new Set(columns.filter((c) => c.numeric).map((c) => c.key));
    const buckets = new Map<string, Record<string, unknown>[]>();

    for (const row of rows) {
      const key = String(row[groupBy] ?? '(none)');
      const bucket = buckets.get(key) ?? [];
      bucket.push(row);
      buckets.set(key, bucket);
    }

    const grouped = [...buckets.entries()].map(([key, bucket]) => {
      const out: Record<string, unknown> = { [groupBy]: key, _count: bucket.length };

      for (const [field, fn] of Object.entries(aggregates)) {
        if (!numeric.has(field) && fn !== 'COUNT') continue;
        const values = bucket
          .map((r) => Number(r[field]))
          .filter((v) => Number.isFinite(v));

        switch (fn) {
          case 'SUM':
            out[`${field}_sum`] = values.reduce((s, v) => s + v, 0);
            break;
          case 'AVG':
            out[`${field}_avg`] = values.length
              ? Number((values.reduce((s, v) => s + v, 0) / values.length).toFixed(4))
              : null;
            break;
          case 'MIN':
            out[`${field}_min`] = values.length ? Math.min(...values) : null;
            break;
          case 'MAX':
            out[`${field}_max`] = values.length ? Math.max(...values) : null;
            break;
          case 'COUNT':
            out[`${field}_count`] = bucket.filter((r) => r[field] !== null && r[field] !== undefined).length;
            break;
        }
      }
      return out;
    });

    return { rows: grouped, grouped: true as const, groupBy };
  }

  /**
   * Running a report over patient, financial, controlled or audit data is
   * itself recorded (§61: audit sensitive exports).
   */
  private async auditIfSensitive(
    sourceKey: string,
    permission: string,
    definition: ReportDefinition,
    user: AuthenticatedUser,
    rowCount: number,
  ) {
    const sensitive = ['audit_logs', 'sales', 'dispensings', 'purchase_orders'];
    if (!sensitive.includes(sourceKey)) return;

    await this.audit.record({
      userId: user.id,
      module: 'analytics',
      action: 'EXPORT',
      entityType: 'Report',
      entityId: sourceKey,
      newValue: {
        dataSource: sourceKey,
        columns: definition.columns,
        filters: definition.filters,
        rowCount,
      },
    });
  }

  // ---- Saved reports ----

  async listSaved(user: AuthenticatedUser) {
    const reports = await this.prisma.savedReport.findMany({
      where: { OR: [{ ownerId: user.id }, { isShared: true }] },
      orderBy: { name: 'asc' },
    });

    // A shared report whose source the viewer cannot read is not offered.
    return reports.filter((r) => {
      const source = SOURCES_BY_KEY.get(r.dataSource);
      return source ? user.permissions.includes(source.permission) : false;
    });
  }

  async save(data: Record<string, unknown>, user: AuthenticatedUser) {
    const source = SOURCES_BY_KEY.get(String(data.dataSource));
    if (!source) throw new BadRequestException(`Unknown data source '${data.dataSource}'`);
    if (!user.permissions.includes(source.permission)) {
      throw new ForbiddenException(`Reading ${source.label} requires ${source.permission}`);
    }

    // Validate the definition now so a broken report is not saved, even though
    // permissions are re-checked on every run.
    this.resolveColumns(source, (data.columns as string[]) ?? [], user);

    const created = await this.prisma.savedReport.create({
      data: {
        name: String(data.name),
        description: (data.description as string) ?? null,
        dataSource: source.key,
        columns: (data.columns as string[]) ?? [],
        filters: (data.filters ?? []) as Prisma.InputJsonValue,
        groupBy: (data.groupBy as string) ?? null,
        sort: (data.sort ?? []) as Prisma.InputJsonValue,
        aggregates: (data.aggregates ?? {}) as Prisma.InputJsonValue,
        visualization: String(data.visualization ?? 'TABLE'),
        isShared: Boolean(data.isShared),
        schedule: (data.schedule as string) ?? null,
        recipients: (data.recipients as string[]) ?? [],
        ownerId: user.id,
      },
    });

    await this.audit.record({
      userId: user.id,
      module: 'analytics',
      action: 'CREATE',
      entityType: 'SavedReport',
      entityId: created.id,
      newValue: { name: created.name, dataSource: created.dataSource },
    });

    return created;
  }

  async runSaved(id: string, user: AuthenticatedUser, overrides: Partial<ReportDefinition> = {}) {
    const report = await this.prisma.savedReport.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Report not found');
    if (report.ownerId !== user.id && !report.isShared) {
      throw new ForbiddenException('This report belongs to someone else and is not shared');
    }

    const result = await this.run(
      {
        dataSource: report.dataSource,
        columns: report.columns,
        filters: report.filters as never,
        groupBy: report.groupBy,
        sort: report.sort as never,
        aggregates: report.aggregates as never,
        ...overrides,
      },
      user,
    );

    await this.prisma.savedReport.update({ where: { id }, data: { lastRunAt: new Date() } });
    return { report: { id: report.id, name: report.name, visualization: report.visualization }, ...result };
  }

  async remove(id: string, user: AuthenticatedUser) {
    const report = await this.prisma.savedReport.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Report not found');
    if (report.ownerId !== user.id) {
      throw new ForbiddenException('Only the owner can delete a report');
    }

    await this.prisma.savedReport.delete({ where: { id } });
    await this.audit.record({
      userId: user.id,
      module: 'analytics',
      action: 'DELETE',
      entityType: 'SavedReport',
      entityId: id,
      previousValue: { name: report.name },
    });
    return { removed: true };
  }

  /** CSV of a report result, honouring the same permission rules. */
  async exportCsv(definition: ReportDefinition, user: AuthenticatedUser): Promise<string> {
    const result = await this.run(definition, user);

    const escape = (value: unknown) => {
      if (value === null || value === undefined) return '';
      const text = String(value);
      // A leading =, +, - or @ is treated as a formula by spreadsheet software;
      // prefixing breaks that without altering the value a human reads.
      const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
      return /[",\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
    };

    const header = result.grouped
      ? Object.keys(result.rows[0] ?? {})
      : result.columns.map((c) => c.key);
    const labels = result.grouped
      ? header
      : result.columns.map((c) => c.label);

    const lines = [
      labels.map(escape).join(','),
      ...result.rows.map((row) => header.map((key) => escape((row as Record<string, unknown>)[key])).join(',')),
    ];

    return lines.join('\n');
  }
}
