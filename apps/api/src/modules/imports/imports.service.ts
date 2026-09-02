import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parseCsv, toCsv } from '@pharmacore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';
import {
  IMPORTS_BY_KEY,
  IMPORT_DEFINITIONS,
  ImportContext,
  RowError,
} from './import-definitions';

/**
 * The import pipeline (§59).
 *
 *   upload → map columns → validate → preview → import → rollback
 *
 * Nothing is written until the import step, and an invalid row is never
 * silently skipped: it is stored with its errors and can be downloaded,
 * corrected and re-uploaded. For the drug master a single bad row rejects the
 * whole file, because a half-imported catalogue is a state nobody chose.
 */
@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** What can be imported, filtered to what this user may do. */
  catalogue(user: AuthenticatedUser) {
    return IMPORT_DEFINITIONS.filter((d) => user.permissions.includes(d.permission)).map((d) => ({
      key: d.key,
      label: d.label,
      description: d.description,
      allOrNothing: d.allOrNothing,
      allOrNothingReason: d.allOrNothingReason ?? null,
      canRollback: d.canRollback,
      rollbackNote: d.rollbackNote ?? null,
      fields: d.fields,
    }));
  }

  /** A CSV template with the headers, an example row and a notes row. */
  template(entityType: string, user: AuthenticatedUser): string {
    const definition = this.definitionFor(entityType, user);

    const headers = definition.fields.map((f) => ({
      key: f.key,
      label: `${f.label}${f.required ? ' *' : ''}`,
    }));

    const example: Record<string, unknown> = {};
    const notes: Record<string, unknown> = {};
    for (const field of definition.fields) {
      example[field.key] = field.example;
      notes[field.key] =
        (field.required ? 'Required. ' : 'Optional. ') +
        (field.options ? `One of: ${field.options.join(' / ')}. ` : '') +
        (field.description ?? '');
    }

    // The example row is first so a user can overwrite it; the notes row is
    // last and is skipped on upload because every column starts with "Required"
    // or "Optional", which fails validation loudly rather than importing.
    return toCsv(headers, [example, notes]);
  }

  private definitionFor(entityType: string, user: AuthenticatedUser) {
    const definition = IMPORTS_BY_KEY.get(entityType);
    if (!definition) {
      throw new BadRequestException(
        `Unknown import '${entityType}'. Available: ${[...IMPORTS_BY_KEY.keys()].join(', ')}`,
      );
    }
    if (!user.permissions.includes(definition.permission)) {
      throw new ForbiddenException(`Importing ${definition.label} requires ${definition.permission}`);
    }
    return definition;
  }

  /**
   * Step 1: read the file and record every row as uploaded.
   *
   * Column mapping is suggested by matching headers to field keys and labels,
   * so a file exported from the template needs no mapping at all.
   */
  async upload(
    input: { entityType: string; fileName: string; content: string; mapping?: Record<string, string> },
    user: AuthenticatedUser,
  ) {
    const definition = this.definitionFor(input.entityType, user);

    if (!input.content?.trim()) {
      throw new BadRequestException('The uploaded file is empty');
    }

    const parsed = parseCsv(input.content);
    if (!parsed.headers.length) {
      throw new BadRequestException('No header row could be read from the file');
    }
    if (!parsed.rows.length) {
      throw new BadRequestException('The file has a header but no data rows');
    }

    const mapping = input.mapping ?? this.suggestMapping(parsed.headers, definition.fields);

    const fileErrors: { message: string }[] = [];
    const mappedTargets = new Set(Object.values(mapping));
    for (const field of definition.fields.filter((f) => f.required)) {
      if (!mappedTargets.has(field.key)) {
        fileErrors.push({
          message: `Required column '${field.label}' is not mapped. Uploaded columns: ${parsed.headers.join(', ')}`,
        });
      }
    }
    for (const malformed of parsed.malformed) {
      fileErrors.push({
        message: `Row ${malformed.rowNumber} has ${malformed.found} columns but the header has ${malformed.expected}. This usually means an unescaped ${parsed.delimiter}.`,
      });
    }

    const reference = `IMP-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;

    const batch = await this.prisma.importBatch.create({
      data: {
        reference,
        entityType: definition.key,
        fileName: input.fileName,
        status: fileErrors.length ? 'FAILED' : 'UPLOADED',
        mapping: mapping as Prisma.InputJsonValue,
        delimiter: parsed.delimiter,
        totalRows: parsed.rows.length,
        fileErrors: fileErrors as unknown as Prisma.InputJsonValue,
        createdById: user.id,
        rows: {
          create: parsed.rows.map((row, index) => ({
            // Header row is 1, so the first data row is 2 — matching what a
            // spreadsheet shows the user.
            rowNumber: index + 2,
            raw: row as Prisma.InputJsonValue,
          })),
        },
      },
      include: { _count: { select: { rows: true } } },
    });

    return {
      id: batch.id,
      reference: batch.reference,
      entityType: batch.entityType,
      status: batch.status,
      totalRows: batch.totalRows,
      headers: parsed.headers,
      mapping,
      unmappedColumns: parsed.headers.filter((h) => !mapping[h]),
      fileErrors,
      delimiter: parsed.delimiter,
    };
  }

  /** Match uploaded headers to fields by key, label, or a loose comparison. */
  private suggestMapping(
    headers: string[],
    fields: { key: string; label: string }[],
  ): Record<string, string> {
    const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const byNormalised = new Map<string, string>();
    for (const field of fields) {
      byNormalised.set(normalise(field.key), field.key);
      byNormalised.set(normalise(field.label), field.key);
    }

    const mapping: Record<string, string> = {};
    for (const header of headers) {
      const match = byNormalised.get(normalise(header));
      if (match) mapping[header] = match;
    }
    return mapping;
  }

  /** Change the column mapping before validating. */
  async remap(id: string, mapping: Record<string, string>, user: AuthenticatedUser) {
    const batch = await this.getBatch(id, user);
    if (['IMPORTING', 'COMPLETED', 'PARTIAL'].includes(batch.status)) {
      throw new ConflictException('This import has already run; upload the file again to change it');
    }

    const updated = await this.prisma.importBatch.update({
      where: { id },
      data: { mapping: mapping as Prisma.InputJsonValue, status: 'UPLOADED' },
    });
    return { id: updated.id, mapping };
  }

  /**
   * Step 2: validate every row and record what is wrong with each.
   *
   * Nothing is written to the domain here.
   */
  async validate(id: string, user: AuthenticatedUser) {
    const batch = await this.getBatch(id, user);
    const definition = this.definitionFor(batch.entityType, user);

    if (batch.status === 'COMPLETED') {
      throw new ConflictException('This import has already been applied');
    }

    const rows = await this.prisma.importRow.findMany({
      where: { batchId: id },
      orderBy: { rowNumber: 'asc' },
    });

    const mapping = batch.mapping as Record<string, string>;
    const context: ImportContext = { prisma: this.prisma, userId: user.id, seen: new Map() };

    let valid = 0;
    let invalid = 0;
    const errorCounts = new Map<string, number>();

    for (const row of rows) {
      const raw = row.raw as Record<string, string>;
      const mapped: Record<string, unknown> = {};
      for (const [header, target] of Object.entries(mapping)) {
        if (target) mapped[target] = raw[header];
      }

      let errors: RowError[] = [];
      try {
        errors = await definition.validate(mapped, context);
      } catch (error) {
        errors = [{ field: '(row)', message: (error as Error).message }];
      }

      if (!errors.length) {
        // Only a valid row joins the duplicate index, so one duplicate does not
        // cascade into an error on every later row.
        const key = this.duplicateKey(definition.key, mapped);
        if (key) context.seen.set(key, row.rowNumber);
        valid += 1;
      } else {
        invalid += 1;
        for (const error of errors) {
          const label = `${error.field}: ${error.message}`;
          errorCounts.set(label, (errorCounts.get(label) ?? 0) + 1);
        }
      }

      await this.prisma.importRow.update({
        where: { id: row.id },
        data: {
          mapped: mapped as Prisma.InputJsonValue,
          status: errors.length ? 'INVALID' : 'VALID',
          errors: errors as unknown as Prisma.InputJsonValue,
        },
      });
    }

    const summary = [...errorCounts.entries()]
      .map(([message, count]) => ({ message, count }))
      .sort((a, b) => b.count - a.count);

    const updated = await this.prisma.importBatch.update({
      where: { id },
      data: {
        status: 'VALIDATED',
        validRows: valid,
        errorRows: invalid,
        errorSummary: summary as unknown as Prisma.InputJsonValue,
        validatedAt: new Date(),
      },
    });

    return {
      id: updated.id,
      reference: updated.reference,
      status: updated.status,
      totalRows: updated.totalRows,
      validRows: valid,
      errorRows: invalid,
      errorSummary: summary,
      allOrNothing: definition.allOrNothing,
      canImport: definition.allOrNothing ? invalid === 0 : valid > 0,
      blockedReason:
        definition.allOrNothing && invalid > 0
          ? definition.allOrNothingReason ?? 'Every row must be valid before this file can be imported'
          : valid === 0
            ? 'No row passed validation'
            : null,
    };
  }

  private duplicateKey(entityType: string, mapped: Record<string, unknown>): string | null {
    const keys: Record<string, string[]> = {
      products: ['sku'],
      suppliers: ['code'],
      patients: ['patientCode'],
      barcodes: ['barcode', 'symbology'],
      price_list: ['priceListCode', 'sku', 'minQuantity'],
    };
    const fields = keys[entityType];
    if (!fields) return null;
    return fields.map((f) => String(mapped[f] ?? '')).join('|');
  }

  /** Step 3: what would happen, before it happens. */
  async preview(id: string, user: AuthenticatedUser, limit = 20) {
    const batch = await this.getBatch(id, user);

    const [valid, invalid] = await Promise.all([
      this.prisma.importRow.findMany({
        where: { batchId: id, status: 'VALID' },
        orderBy: { rowNumber: 'asc' },
        take: limit,
      }),
      this.prisma.importRow.findMany({
        where: { batchId: id, status: 'INVALID' },
        orderBy: { rowNumber: 'asc' },
        take: limit,
      }),
    ]);

    return {
      id: batch.id,
      reference: batch.reference,
      status: batch.status,
      totalRows: batch.totalRows,
      validRows: batch.validRows,
      errorRows: batch.errorRows,
      errorSummary: batch.errorSummary,
      willImport: valid.map((r) => ({ rowNumber: r.rowNumber, values: r.mapped })),
      willReject: invalid.map((r) => ({
        rowNumber: r.rowNumber,
        values: r.mapped ?? r.raw,
        errors: r.errors,
      })),
    };
  }

  /**
   * Step 4: apply.
   *
   * Each row is applied in its own transaction, so one failure does not undo
   * the rows before it — except where the definition is all-or-nothing, in
   * which case validation has already refused the whole file.
   */
  async apply(id: string, user: AuthenticatedUser) {
    const batch = await this.getBatch(id, user);
    const definition = this.definitionFor(batch.entityType, user);

    if (batch.status === 'COMPLETED' || batch.status === 'PARTIAL') {
      throw new ConflictException(
        `${batch.reference} has already been imported. Roll it back first if it needs redoing.`,
      );
    }
    if (batch.status !== 'VALIDATED') {
      throw new BadRequestException('Validate the file before importing it');
    }
    if (definition.allOrNothing && batch.errorRows > 0) {
      throw new BadRequestException(
        definition.allOrNothingReason ??
          `${batch.errorRows} row(s) are invalid and this import is all-or-nothing`,
      );
    }
    if (batch.validRows === 0) {
      throw new BadRequestException('No row passed validation, so there is nothing to import');
    }

    await this.prisma.importBatch.update({ where: { id }, data: { status: 'IMPORTING' } });

    const rows = await this.prisma.importRow.findMany({
      where: { batchId: id, status: 'VALID' },
      orderBy: { rowNumber: 'asc' },
    });

    const context: ImportContext = { prisma: this.prisma, userId: user.id, seen: new Map() };
    let imported = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        const result = await this.prisma.$transaction((tx) =>
          definition.apply(row.mapped as Record<string, unknown>, context, tx),
        );
        await this.prisma.importRow.update({
          where: { id: row.id },
          data: { status: 'IMPORTED', entityId: result.entityId, action: result.action },
        });
        imported += 1;
      } catch (error) {
        // Recorded against the row, not swallowed: §59 forbids silently
        // skipping a record.
        failed += 1;
        await this.prisma.importRow.update({
          where: { id: row.id },
          data: {
            status: 'FAILED',
            errors: [
              { field: '(import)', message: (error as Error).message.slice(0, 400) },
            ] as unknown as Prisma.InputJsonValue,
          },
        });
        this.logger.warn(`Import row ${row.rowNumber} failed: ${(error as Error).message}`);
      }
    }

    const status = failed === 0 ? 'COMPLETED' : imported === 0 ? 'FAILED' : 'PARTIAL';

    const updated = await this.prisma.importBatch.update({
      where: { id },
      data: { status, importedRows: imported, failedRows: failed, importedAt: new Date() },
    });

    await this.audit.record({
      userId: user.id,
      module: 'admin',
      action: 'IMPORT',
      entityType: 'ImportBatch',
      entityId: id,
      newValue: {
        reference: batch.reference,
        entityType: batch.entityType,
        fileName: batch.fileName,
        imported,
        failed,
        rejected: batch.errorRows,
      },
    });

    return {
      id: updated.id,
      reference: updated.reference,
      status,
      importedRows: imported,
      failedRows: failed,
      rejectedRows: batch.errorRows,
      canRollback: definition.canRollback && imported > 0,
      rollbackNote: definition.rollbackNote ?? null,
    };
  }

  /**
   * Step 5: undo what an import created.
   *
   * Only rows this import created are removed; an updated record is left
   * alone, because restoring its previous values is not the same act and the
   * import did not capture them. Anything that has since been used is refused
   * with the reason.
   */
  async rollback(id: string, reason: string, user: AuthenticatedUser) {
    if (!reason?.trim()) throw new BadRequestException('A rollback reason is required');

    const batch = await this.getBatch(id, user);
    const definition = this.definitionFor(batch.entityType, user);

    if (!definition.canRollback || !definition.rollback) {
      throw new BadRequestException(
        definition.rollbackNote ?? `${definition.label} imports cannot be rolled back automatically`,
      );
    }
    if (!['COMPLETED', 'PARTIAL'].includes(batch.status)) {
      throw new BadRequestException(`${batch.reference} is ${batch.status} and has nothing to undo`);
    }
    if (batch.rolledBackAt) {
      throw new ConflictException(`${batch.reference} has already been rolled back`);
    }

    const rows = await this.prisma.importRow.findMany({
      where: { batchId: id, status: 'IMPORTED', action: 'CREATED' },
      orderBy: { rowNumber: 'desc' },
    });

    const updatedRows = await this.prisma.importRow.count({
      where: { batchId: id, status: 'IMPORTED', action: 'UPDATED' },
    });

    let undone = 0;
    const problems: { rowNumber: number; message: string }[] = [];

    for (const row of rows) {
      if (!row.entityId) continue;
      try {
        await this.prisma.$transaction((tx) => definition.rollback!(row.entityId!, tx));
        await this.prisma.importRow.update({
          where: { id: row.id },
          data: { status: 'ROLLED_BACK' },
        });
        undone += 1;
      } catch (error) {
        problems.push({ rowNumber: row.rowNumber, message: (error as Error).message });
      }
    }

    await this.prisma.importBatch.update({
      where: { id },
      data: {
        status: 'ROLLED_BACK',
        rolledBackRows: undone,
        rolledBackAt: new Date(),
        rollbackReason: reason.trim(),
      },
    });

    await this.audit.record({
      userId: user.id,
      module: 'admin',
      action: 'CANCEL',
      entityType: 'ImportBatch',
      entityId: id,
      previousValue: { status: batch.status, importedRows: batch.importedRows },
      newValue: { status: 'ROLLED_BACK', rolledBack: undone, couldNotUndo: problems.length },
      reason,
    });

    return {
      rolledBack: undone,
      // Stated rather than hidden: an update cannot be undone by deletion, and
      // a record already in use must not disappear.
      notRolledBack: {
        updatedRecords: updatedRows,
        note:
          updatedRows > 0
            ? `${updatedRows} row(s) updated an existing record. Their previous values were not captured, so they are left as they are.`
            : null,
        problems,
      },
    };
  }

  async list(user: AuthenticatedUser, entityType?: string) {
    return this.prisma.importBatch.findMany({
      where: {
        ...(entityType ? { entityType } : {}),
        // A user sees their own imports; an administrator sees them all.
        ...(user.permissions.includes('admin.setting.READ') ? {} : { createdById: user.id }),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  private async getBatch(id: string, user: AuthenticatedUser) {
    const batch = await this.prisma.importBatch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException('Import not found');
    if (batch.createdById !== user.id && !user.permissions.includes('admin.setting.READ')) {
      throw new ForbiddenException('This import belongs to someone else');
    }
    return batch;
  }

  async get(id: string, user: AuthenticatedUser) {
    const batch = await this.getBatch(id, user);
    const counts = await this.prisma.importRow.groupBy({
      by: ['status'],
      where: { batchId: id },
      _count: { _all: true },
    });

    return {
      ...batch,
      rowCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    };
  }

  /**
   * The rows that did not import, as a CSV with their original values and an
   * error column — correct it and upload it again.
   */
  async errorFile(id: string, user: AuthenticatedUser): Promise<string> {
    const batch = await this.getBatch(id, user);
    const rows = await this.prisma.importRow.findMany({
      where: { batchId: id, status: { in: ['INVALID', 'FAILED'] } },
      orderBy: { rowNumber: 'asc' },
    });

    if (!rows.length) return 'row,error\n';

    const originalHeaders = Object.keys((rows[0].raw as Record<string, string>) ?? {});
    const headers = [
      { key: '_row', label: 'Original row' },
      { key: '_errors', label: 'What is wrong' },
      ...originalHeaders.map((h) => ({ key: h, label: h })),
    ];

    return toCsv(
      headers,
      rows.map((row) => ({
        _row: row.rowNumber,
        _errors: ((row.errors as { field: string; message: string }[]) ?? [])
          .map((e) => `${e.field}: ${e.message}`)
          .join('; '),
        ...(row.raw as Record<string, string>),
      })),
    );
  }
}
