/**
 * Report catalogue and search authorization rules (§60, §61, §62).
 *
 * The parts that must not drift are the ones that decide who can see what, so
 * they are asserted about the catalogue itself rather than only about a
 * running query.
 */

import { REPORT_SOURCES, SOURCES_BY_KEY } from '../src/modules/intelligence/report-sources';
import { allPermissionCodes } from '../../../packages/shared/src/permissions';

const VALID = new Set(allPermissionCodes());

describe('Report data sources', () => {
  it('has a unique key for every source', () => {
    const keys = REPORT_SOURCES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('names a real permission for every source', () => {
    for (const source of REPORT_SOURCES) {
      expect({ source: source.key, permission: source.permission, valid: VALID.has(source.permission) })
        .toEqual({ source: source.key, permission: source.permission, valid: true });
    }
  });

  it('names a real permission for every restricted column', () => {
    for (const source of REPORT_SOURCES) {
      for (const column of source.columns) {
        if (!column.requires) continue;
        expect({ column: column.key, requires: column.requires, valid: VALID.has(column.requires) })
          .toEqual({ column: column.key, requires: column.requires, valid: true });
      }
    }
  });

  it('gives every source at least one column', () => {
    for (const source of REPORT_SOURCES) {
      expect(source.columns.length).toBeGreaterThan(0);
    }
  });

  it('has unique column keys within a source', () => {
    for (const source of REPORT_SOURCES) {
      const keys = source.columns.map((c) => c.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('marks every numeric column as numeric so aggregation is possible', () => {
    for (const source of REPORT_SOURCES) {
      for (const column of source.columns) {
        if (column.type === 'number') expect(column.numeric).toBe(true);
      }
    }
  });

  it('puts a permission on every column carrying cost or price', () => {
    // Commercial information needs the finance or pricing permission on top of
    // the permission for the source itself; a stock report must not be a way
    // to read margins.
    for (const source of REPORT_SOURCES) {
      for (const column of source.columns) {
        if (!/cost|price/i.test(column.key)) continue;
        expect({ source: source.key, column: column.key, requires: column.requires ?? null }).toEqual({
          source: source.key,
          column: column.key,
          requires: expect.stringMatching(/finance|price/),
        });
      }
    }
  });

  it('scopes every branch-aware source through a branch column', () => {
    for (const source of REPORT_SOURCES) {
      if (source.branchPath === null) continue;
      expect(source.branchPath).toBe('branchId');
    }
  });

  it('scopes the sources that carry branch-specific records', () => {
    // A branch user must not read another branch's sales, ledger or
    // prescriptions through a report.
    for (const key of ['inventory_balances', 'inventory_transactions', 'sales', 'dispensings', 'purchase_orders']) {
      expect({ key, scoped: SOURCES_BY_KEY.get(key)?.branchPath }).toEqual({ key, scoped: 'branchId' });
    }
  });

  it('never exposes a password, token or secret column', () => {
    for (const source of REPORT_SOURCES) {
      for (const column of source.columns) {
        expect(column.key).not.toMatch(/password|secret|token|hash|mfa/i);
        expect(column.path ?? '').not.toMatch(/password|secret|token|hash|mfa/i);
      }
    }
  });

  it('describes every source and column, so the builder never shows a bare key', () => {
    for (const source of REPORT_SOURCES) {
      expect(source.label.length).toBeGreaterThan(3);
      expect(source.description.length).toBeGreaterThan(15);
      for (const column of source.columns) {
        expect(column.label.length).toBeGreaterThan(1);
      }
    }
  });
});
