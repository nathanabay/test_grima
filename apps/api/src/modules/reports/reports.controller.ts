import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ReportsService, ReportFilters } from './reports.service';
import { ExportService } from './export.service';
import { DocumentsService, DocumentKind } from './documents.service';
import { LabelsService, LabelRequest } from './labels.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser, CurrentUser, RequirePermissions } from '../../common/decorators';

type Format = 'json' | 'csv' | 'xlsx' | 'print';

@ApiTags('Reports & Documents')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly exporter: ExportService,
    private readonly documents: DocumentsService,
    private readonly labelsService: LabelsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private parseFilters(query: any): ReportFilters {
    return {
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      branchId: query.branchId,
      warehouseId: query.warehouseId,
      productId: query.productId,
      supplierId: query.supplierId,
      days: query.days ? Number(query.days) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
    };
  }

  @Get()
  @ApiOperation({ summary: 'Catalogue of every available report' })
  catalog(@CurrentUser() user: AuthenticatedUser) {
    // Only advertise reports the caller may actually run.
    return this.reports
      .catalog()
      .filter((r) => user.permissions.includes(r.permission));
  }

  @Get('run/:key')
  @ApiOperation({
    summary: 'Run a report as JSON, CSV, Excel or print-ready HTML (?format=json|csv|xlsx|print)',
  })
  async run(
    @Param('key') key: string,
    @Query() query: any,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const definition = this.reports.definitionFor(key);

    // Authorization is per report, since each one exposes different data.
    if (!user.permissions.includes(definition.permission)) {
      throw new ForbiddenException(
        `Running "${definition.title}" requires the ${definition.permission} permission`,
      );
    }

    const format: Format = (query.format ?? 'json') as Format;
    const result = await this.reports.run(key, this.parseFilters(query), user);
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `${key}-${stamp}`;

    // §61: exporting data is itself an auditable act.
    if (format !== 'json') {
      await this.audit.record({
        userId: user.id,
        userLabel: user.fullName,
        module: 'analytics',
        action: 'EXPORT',
        entityType: 'Report',
        entityId: key,
        newValue: { format, rows: result.rows.length, filters: this.parseFilters(query) },
      });
    }

    switch (format) {
      case 'csv':
        res
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="${filename}.csv"`)
          .send(this.exporter.toCsv(result.rows, result.columns));
        return;

      case 'xlsx':
        res
          .header('Content-Type', 'application/vnd.ms-excel; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="${filename}.xls"`)
          .send(this.exporter.toExcelXml(result.rows, result.columns, result.title));
        return;

      case 'print': {
        const org = await this.prisma.organization.findFirstOrThrow();
        res
          .header('Content-Type', 'text/html; charset=utf-8')
          .send(
            this.exporter.toPrintableHtml({
              title: result.title,
              subtitle: result.subtitle,
              organization: org,
              columns: result.columns,
              rows: result.rows,
              meta: result.meta,
              totals: result.totals,
            }),
          );
        return;
      }

      default:
        res.json(result);
    }
  }

  @Post('labels')
  @RequirePermissions('inventory.batch.READ')
  @ApiOperation({
    summary:
      'Print-ready label sheet. kind: product | shelf | bin | batch | transfer. ' +
      'Batch labels carry GS1 Application Identifiers via GS1-128.',
  })
  @Header('Content-Type', 'text/html; charset=utf-8')
  labels(@Body() body: LabelRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.labelsService.render(body).then(async (html) => {
      await this.audit.record({
        userId: user.id,
        userLabel: user.fullName,
        module: 'inventory',
        action: 'PRINT',
        entityType: `${body.kind}_label`,
        newValue: { count: body.ids.length, copies: body.copies ?? 1 },
      });
      return html;
    });
  }

  @Get('documents/:kind/:id')
  @ApiOperation({
    summary:
      'Print-ready business document: purchase-order, goods-receipt, stock-transfer, sales-invoice, ' +
      'dispensing-record, return-note, recall-report, stock-count, disposal-certificate, purchase-request, rfq',
  })
  @RequirePermissions('analytics.report.PRINT')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async document(
    @Param('kind') kind: DocumentKind,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const html = await this.documents.render(kind, id);
    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'analytics',
      action: 'PRINT',
      entityType: kind,
      entityId: id,
    });
    return html;
  }
}
