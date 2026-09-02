/**
 * CSV handling and the import catalogue (§59).
 *
 * The parser's failure modes are the point: a quoted comma, a newline inside a
 * cell, a BOM from Excel and CRLF endings all appear in real exports, and
 * getting any of them wrong corrupts an import silently rather than failing it.
 */

import {
  detectDelimiter,
  escapeCsvValue,
  parseCsv,
  splitCsv,
  toCsv,
} from '../../../packages/shared/src/csv';
import { IMPORT_DEFINITIONS, IMPORTS_BY_KEY } from '../src/modules/imports/import-definitions';
import { allPermissionCodes } from '../../../packages/shared/src/permissions';

describe('CSV parsing', () => {
  it('reads a simple file', () => {
    const result = parseCsv('a,b\n1,2\n3,4');
    expect(result.headers).toEqual(['a', 'b']);
    expect(result.rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('keeps a comma inside a quoted field', () => {
    const result = parseCsv('code,name\nS1,"Rift Valley Pharma, Ltd"');
    expect(result.rows[0].name).toBe('Rift Valley Pharma, Ltd');
  });

  it('reads a doubled quote as one quote', () => {
    const result = parseCsv('a\n"He said ""hello"""');
    expect(result.rows[0].a).toBe('He said "hello"');
  });

  it('keeps a newline inside a quoted field', () => {
    const result = parseCsv('a,b\n"line one\nline two",x');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].a).toBe('line one\nline two');
  });

  it('handles CRLF line endings', () => {
    const result = parseCsv('a,b\r\n1,2\r\n3,4');
    expect(result.rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('strips the BOM Excel writes', () => {
    // Left in place it becomes part of the first header name and every lookup
    // against that column fails.
    const result = parseCsv('﻿sku,name\nS1,Paracetamol');
    expect(result.headers[0]).toBe('sku');
    expect(result.rows[0].sku).toBe('S1');
  });

  it('reads the final row when the file has no trailing newline', () => {
    expect(parseCsv('a\n1\n2').rows).toHaveLength(2);
  });

  it('ignores blank lines', () => {
    expect(parseCsv('a,b\n1,2\n\n\n3,4\n').rows).toHaveLength(2);
  });

  it('reports a row with the wrong column count instead of padding it', () => {
    // Guessing which column shifted would import the wrong values into
    // right-looking fields.
    const result = parseCsv('a,b,c\n1,2,3\n4,5');
    expect(result.rows).toHaveLength(1);
    expect(result.malformed).toHaveLength(1);
    expect(result.malformed[0]).toMatchObject({ rowNumber: 3, expected: 3, found: 2 });
  });

  it('trims surrounding whitespace from values', () => {
    expect(parseCsv('a,b\n  1  ,  2  ').rows[0]).toEqual({ a: '1', b: '2' });
  });

  it('detects semicolon and tab delimiters', () => {
    expect(detectDelimiter('a;b;c')).toBe(';');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(detectDelimiter('a,b,c')).toBe(',');
    expect(parseCsv('a;b\n1;2').rows[0]).toEqual({ a: '1', b: '2' });
  });

  it('returns nothing for an empty document rather than throwing', () => {
    expect(parseCsv('').rows).toEqual([]);
    expect(parseCsv('   ').rows).toEqual([]);
  });

  it('splits a document into raw cells', () => {
    expect(splitCsv('a,b\n1,2', ',')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('CSV writing', () => {
  it('quotes a value containing the delimiter or a newline', () => {
    expect(escapeCsvValue('a,b')).toBe('"a,b"');
    expect(escapeCsvValue('a\nb')).toBe('"a\nb"');
  });

  it('doubles an embedded quote', () => {
    expect(escapeCsvValue('say "hi"')).toBe('"say ""hi"""');
  });

  it('neutralises a value a spreadsheet would run as a formula', () => {
    // =cmd|... in a CSV is a known way to execute code on the machine of
    // whoever opens the export.
    expect(escapeCsvValue('=1+1')).toBe("'=1+1");
    expect(escapeCsvValue('+251911000000')).toBe("'+251911000000");
    expect(escapeCsvValue('-1')).toBe("'-1");
    expect(escapeCsvValue('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('leaves an ordinary value alone', () => {
    expect(escapeCsvValue('Paracetamol')).toBe('Paracetamol');
    expect(escapeCsvValue(42)).toBe('42');
    expect(escapeCsvValue(null)).toBe('');
  });

  it('round-trips through the parser', () => {
    const rows = [
      { sku: 'S1', name: 'Rift Valley Pharma, Ltd', note: 'has "quotes" and\na newline' },
      { sku: 'S2', name: 'Simple', note: '' },
    ];
    const csv = toCsv([{ key: 'sku' }, { key: 'name' }, { key: 'note' }], rows);
    const parsed = parseCsv(csv);

    expect(parsed.rows[0].name).toBe('Rift Valley Pharma, Ltd');
    expect(parsed.rows[0].note).toBe('has "quotes" and\na newline');
    expect(parsed.malformed).toEqual([]);
  });
});

describe('Import catalogue', () => {
  const VALID = new Set(allPermissionCodes());

  it('has a unique key for every import', () => {
    const keys = IMPORT_DEFINITIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('names a real permission for every import', () => {
    for (const definition of IMPORT_DEFINITIONS) {
      expect({ key: definition.key, permission: definition.permission, valid: VALID.has(definition.permission) })
        .toEqual({ key: definition.key, permission: definition.permission, valid: true });
    }
  });

  it('gives every import at least one required field', () => {
    for (const definition of IMPORT_DEFINITIONS) {
      expect(definition.fields.some((f) => f.required)).toBe(true);
    }
  });

  it('gives every field an example, so the template is unambiguous', () => {
    for (const definition of IMPORT_DEFINITIONS) {
      for (const field of definition.fields) {
        expect(field.example.length).toBeGreaterThan(0);
        expect(field.label.length).toBeGreaterThan(1);
      }
    }
  });

  it('explains why an all-or-nothing import is all-or-nothing', () => {
    for (const definition of IMPORT_DEFINITIONS) {
      if (!definition.allOrNothing) continue;
      expect(definition.allOrNothingReason?.length ?? 0).toBeGreaterThan(20);
    }
  });

  it('provides a rollback implementation wherever it claims one', () => {
    for (const definition of IMPORT_DEFINITIONS) {
      expect({ key: definition.key, claims: definition.canRollback, has: typeof definition.rollback === 'function' })
        .toEqual({ key: definition.key, claims: definition.canRollback, has: definition.canRollback });
    }
  });

  it('makes the drug master all-or-nothing', () => {
    // §59: inventory records must not be silently half-imported.
    expect(IMPORTS_BY_KEY.get('products')?.allOrNothing).toBe(true);
  });

  it('has unique field keys within an import', () => {
    for (const definition of IMPORT_DEFINITIONS) {
      const keys = definition.fields.map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
