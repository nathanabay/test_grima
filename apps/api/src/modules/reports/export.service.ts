import { Injectable } from '@nestjs/common';

export type ColumnType = 'text' | 'number' | 'money' | 'date' | 'integer';

export interface ExportColumn {
  key: string;
  label: string;
  type?: ColumnType;
  width?: number;
}

/**
 * Tabular export in CSV, Excel-readable XML, and print-ready HTML (§41, §61).
 *
 * Everything is generated in-process with no binary dependency: the
 * SpreadsheetML dialect below opens natively in Excel, LibreOffice and Numbers,
 * and keeps numbers as numbers rather than text, which a plain CSV cannot
 * guarantee across locales.
 */
@Injectable()
export class ExportService {
  private escapeCsv(value: unknown): string {
    if (value === null || value === undefined) return '';
    const text = String(value);
    // Quote when the value contains a delimiter, quote or newline.
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  private escapeXml(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private cellValue(row: any, column: ExportColumn): unknown {
    // Support dotted paths like "product.genericName".
    const raw = column.key
      .split('.')
      .reduce<any>((acc, part) => (acc === null || acc === undefined ? acc : acc[part]), row);

    if (raw === null || raw === undefined) return '';
    if (column.type === 'date') {
      const d = new Date(raw as string);
      return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
    }
    if (column.type === 'number' || column.type === 'money' || column.type === 'integer') {
      const n = Number(raw);
      return Number.isFinite(n) ? n : '';
    }
    return raw;
  }

  toCsv(rows: any[], columns: ExportColumn[]): string {
    const header = columns.map((c) => this.escapeCsv(c.label)).join(',');
    const body = rows.map((row) =>
      columns.map((c) => this.escapeCsv(this.cellValue(row, c))).join(','),
    );
    // BOM so Excel on Windows detects UTF-8 (Amharic column values survive).
    return '﻿' + [header, ...body].join('\r\n');
  }

  /**
   * SpreadsheetML 2003. Chosen over a zipped .xlsx because it needs no
   * dependency, streams as plain text, and preserves numeric cell types.
   */
  toExcelXml(rows: any[], columns: ExportColumn[], sheetName = 'Report'): string {
    const headerCells = columns
      .map((c) => `<Cell ss:StyleID="hdr"><Data ss:Type="String">${this.escapeXml(c.label)}</Data></Cell>`)
      .join('');

    const bodyRows = rows
      .map((row) => {
        const cells = columns
          .map((c) => {
            const value = this.cellValue(row, c);
            const numeric =
              c.type === 'number' || c.type === 'money' || c.type === 'integer';
            if (numeric && value === '') {
              return '<Cell/>';
            }
            const type = numeric ? 'Number' : 'String';
            const style =
              c.type === 'money' ? ' ss:StyleID="money"' : c.type === 'date' ? ' ss:StyleID="date"' : '';
            return `<Cell${style}><Data ss:Type="${type}">${this.escapeXml(value)}</Data></Cell>`;
          })
          .join('');
        return `<Row>${cells}</Row>`;
      })
      .join('');

    return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
          xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="hdr">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#E2E8F0" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="money"><NumberFormat ss:Format="#,##0.00"/></Style>
    <Style ss:ID="date"><NumberFormat ss:Format="yyyy-mm-dd"/></Style>
  </Styles>
  <Worksheet ss:Name="${this.escapeXml(sheetName.slice(0, 31))}">
    <Table>
      ${columns.map((c) => `<Column ss:Width="${c.width ?? 110}"/>`).join('')}
      <Row>${headerCells}</Row>
      ${bodyRows}
    </Table>
  </Worksheet>
</Workbook>`;
  }

  /**
   * Print-ready HTML. The browser's own print-to-PDF produces the file, which
   * keeps fonts and Amharic script correct without shipping a PDF engine.
   */
  toPrintableHtml(options: {
    title: string;
    subtitle?: string;
    organization: { name: string; addressLine?: string | null; phone?: string | null; logoUrl?: string | null };
    columns: ExportColumn[];
    rows: any[];
    meta?: Array<[string, string]>;
    totals?: Array<[string, string]>;
    footNote?: string;
  }): string {
    const { title, subtitle, organization, columns, rows, meta = [], totals = [], footNote } = options;

    const metaHtml = meta
      .map(([k, v]) => `<div><dt>${this.escapeXml(k)}</dt><dd>${this.escapeXml(v)}</dd></div>`)
      .join('');

    const head = columns
      .map((c) => `<th class="${c.type === 'money' || c.type === 'number' || c.type === 'integer' ? 'num' : ''}">${this.escapeXml(c.label)}</th>`)
      .join('');

    const body = rows
      .map(
        (row) =>
          `<tr>${columns
            .map((c) => {
              const value = this.cellValue(row, c);
              const numeric = c.type === 'money' || c.type === 'number' || c.type === 'integer';
              const display =
                c.type === 'money' && value !== ''
                  ? Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : value;
              return `<td class="${numeric ? 'num' : ''}">${this.escapeXml(display)}</td>`;
            })
            .join('')}</tr>`,
      )
      .join('');

    const totalsHtml = totals.length
      ? `<table class="totals">${totals
          .map(([k, v]) => `<tr><th>${this.escapeXml(k)}</th><td class="num">${this.escapeXml(v)}</td></tr>`)
          .join('')}</table>`
      : '';

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${this.escapeXml(title)}</title>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font: 11px/1.45 ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif; color: #0f172a; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-start;
           border-bottom: 2px solid #0d7d6c; padding-bottom: 8px; margin-bottom: 12px; }
  .org { font-size: 15px; font-weight: 700; color: #0a6156; }
  .org small { display: block; font-weight: 400; font-size: 10px; color: #475569; }
  h1 { font-size: 15px; margin: 0; text-align: right; }
  h1 small { display: block; font-size: 10px; font-weight: 400; color: #475569; margin-top: 2px; }
  dl { display: flex; flex-wrap: wrap; gap: 4px 22px; margin: 0 0 10px; }
  dl div { display: flex; gap: 6px; }
  dt { color: #475569; } dd { margin: 0; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #cbd5e1; padding: 4px 6px; text-align: left; vertical-align: top; }
  thead th { background: #f1f5f9; font-size: 10px; text-transform: uppercase; letter-spacing: .03em; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  .totals { width: auto; margin-left: auto; margin-top: 10px; }
  .totals th { background: #f1f5f9; }
  footer { margin-top: 14px; padding-top: 6px; border-top: 1px solid #cbd5e1;
           font-size: 9px; color: #64748b; display: flex; justify-content: space-between; }
  .sign { margin-top: 26px; display: flex; gap: 40px; }
  .sign div { flex: 1; border-top: 1px solid #0f172a; padding-top: 4px; font-size: 10px; }
  @media print { .no-print { display: none; } }
</style>
</head>
<body>
<header>
  <div class="org">${this.escapeXml(organization.name)}
    <small>${this.escapeXml(organization.addressLine ?? '')}${organization.phone ? ` &middot; ${this.escapeXml(organization.phone)}` : ''}</small>
  </div>
  <h1>${this.escapeXml(title)}${subtitle ? `<small>${this.escapeXml(subtitle)}</small>` : ''}</h1>
</header>

${metaHtml ? `<dl>${metaHtml}</dl>` : ''}

<table>
  <thead><tr>${head}</tr></thead>
  <tbody>${body || `<tr><td colspan="${columns.length}">No records match these filters.</td></tr>`}</tbody>
</table>

${totalsHtml}
${footNote ? `<div class="sign"><div>${this.escapeXml(footNote)}</div></div>` : ''}

<footer>
  <span>Generated ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC</span>
  <span>${rows.length} record(s)</span>
</footer>

<script>
  // Opening the document straight into the print dialog is what "print" means
  // to the operator; the tab stays open afterwards for a second copy.
  if (!new URLSearchParams(location.search).has('noprint')) {
    window.addEventListener('load', () => setTimeout(() => window.print(), 250));
  }
</script>
</body>
</html>`;
  }
}
