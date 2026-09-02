/**
 * CSV parsing and writing (§59).
 *
 * Hand-written rather than pulled from a library because the failure modes
 * matter: a quoted field containing a comma, a newline inside a cell, a BOM
 * left by Excel, and CRLF line endings are all things a pharmacy's exported
 * file will actually contain, and getting any of them wrong silently corrupts
 * an import rather than failing it.
 */

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  /** Rows whose column count did not match the header. */
  malformed: { rowNumber: number; expected: number; found: number; raw: string }[];
  delimiter: string;
}

/** Guess the delimiter from the header line: comma, semicolon or tab. */
export function detectDelimiter(sample: string): string {
  const line = sample.split(/\r?\n/)[0] ?? '';
  const counts: Record<string, number> = {
    ',': (line.match(/,/g) ?? []).length,
    ';': (line.match(/;/g) ?? []).length,
    '\t': (line.match(/\t/g) ?? []).length,
  };
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Split one CSV document into rows of raw cells.
 *
 * A quoted field may contain the delimiter, a newline, or a doubled quote.
 */
export function splitCsv(text: string, delimiter: string): string[][] {
  // Excel writes a UTF-8 BOM; left in place it becomes part of the first
  // header name and every lookup against it fails.
  const input = text.replace(/^﻿/, '');

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char === '\r') {
      // Part of CRLF; the \n that follows ends the row.
    } else {
      field += char;
    }
  }

  // A file that does not end with a newline still has a final row.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

export function parseCsv(text: string, delimiter?: string): ParsedCsv {
  const sep = delimiter ?? detectDelimiter(text);
  const raw = splitCsv(text, sep).filter((r) => r.some((cell) => cell.trim() !== ''));

  if (!raw.length) {
    return { headers: [], rows: [], malformed: [], delimiter: sep };
  }

  const headers = raw[0].map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  const malformed: ParsedCsv['malformed'] = [];

  for (let i = 1; i < raw.length; i += 1) {
    const cells = raw[i];

    if (cells.length !== headers.length) {
      // Reported rather than padded: a row with the wrong shape usually means
      // an unescaped delimiter, and guessing which column shifted would import
      // the wrong values into the right-looking fields.
      malformed.push({
        rowNumber: i + 1,
        expected: headers.length,
        found: cells.length,
        raw: cells.join(sep).slice(0, 200),
      });
      continue;
    }

    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = (cells[index] ?? '').trim();
    });
    rows.push(record);
  }

  return { headers, rows, malformed, delimiter: sep };
}

/** Escape one value for CSV, neutralising spreadsheet formula injection. */
export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);

  // A leading =, +, - or @ is executed as a formula by Excel and Sheets.
  // Prefixing with an apostrophe stops that without changing what a human
  // reads in the cell.
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;

  return /["\n\r,;\t]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** Build a CSV document from headers and rows. */
export function toCsv(
  headers: { key: string; label?: string }[],
  rows: Record<string, unknown>[],
  delimiter = ',',
): string {
  const lines = [headers.map((h) => escapeCsvValue(h.label ?? h.key)).join(delimiter)];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvValue(row[h.key])).join(delimiter));
  }
  return lines.join('\r\n');
}
