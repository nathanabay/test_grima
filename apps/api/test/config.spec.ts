import { parseEnv } from '../src/common/config/env';
import {
  FEATURE_FLAGS,
  SETTING_DEFINITIONS,
  SETTINGS_BY_KEY,
} from '../src/common/config/settings.catalog';
import { ConfigService } from '../src/common/config/config.service';

describe('.env parsing (§65)', () => {
  it('reads plain assignments', () => {
    expect(parseEnv('API_PORT=4000')).toEqual({ API_PORT: '4000' });
  });

  it('strips double and single quotes', () => {
    expect(parseEnv('A="hello world"\nB=\'single\'')).toEqual({
      A: 'hello world',
      B: 'single',
    });
  });

  it('keeps a "#" inside a quoted value but drops a trailing comment', () => {
    const parsed = parseEnv('PASS="Pharma#2026"\nPORT=4000 # the api port');
    expect(parsed.PASS).toBe('Pharma#2026');
    expect(parsed.PORT).toBe('4000');
  });

  it('ignores comments and blank lines', () => {
    expect(parseEnv('# a comment\n\n  \nX=1')).toEqual({ X: '1' });
  });

  it('accepts an export prefix', () => {
    expect(parseEnv('export DATABASE_URL=postgres://x')).toEqual({
      DATABASE_URL: 'postgres://x',
    });
  });

  it('handles a connection string containing = and ?', () => {
    const url = 'postgresql://u:p@localhost:5432/db?schema=public';
    expect(parseEnv(`DATABASE_URL="${url}"`).DATABASE_URL).toBe(url);
  });

  it('unescapes \\n inside double quotes only', () => {
    expect(parseEnv('A="one\\ntwo"').A).toBe('one\ntwo');
    expect(parseEnv("B='one\\ntwo'").B).toBe('one\\ntwo');
  });
});

describe('Settings catalogue (§65, "no magic values")', () => {
  it('has a unique key for every definition', () => {
    const keys = SETTING_DEFINITIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('does not collide with a feature flag key', () => {
    const settings = new Set(SETTING_DEFINITIONS.map((d) => d.key));
    for (const flag of FEATURE_FLAGS) expect(settings.has(flag.key)).toBe(false);
  });

  it('gives every setting a default matching its declared type', () => {
    for (const def of SETTING_DEFINITIONS) {
      switch (def.type) {
        case 'number':
          expect(typeof def.default).toBe('number');
          break;
        case 'boolean':
          expect(typeof def.default).toBe('boolean');
          break;
        case 'string':
          expect(typeof def.default).toBe('string');
          break;
        default:
          expect(Array.isArray(def.default)).toBe(true);
      }
    }
  });

  it('keeps every numeric default inside its own bounds', () => {
    for (const def of SETTING_DEFINITIONS) {
      if (def.type !== 'number') continue;
      const value = def.default as number;
      if (def.min !== undefined) expect(value).toBeGreaterThanOrEqual(def.min);
      if (def.max !== undefined) expect(value).toBeLessThanOrEqual(def.max);
    }
  });

  it('keeps every option-constrained default among its options', () => {
    for (const def of SETTING_DEFINITIONS) {
      if (!def.options) continue;
      expect(def.options).toContain(def.default as string);
    }
  });

  it('describes every setting, so the admin screen never shows a bare key', () => {
    for (const def of SETTING_DEFINITIONS) {
      expect(def.label.length).toBeGreaterThan(3);
      expect(def.description.length).toBeGreaterThan(15);
      expect(def.group.length).toBeGreaterThan(2);
    }
  });

  it('covers the thresholds the specification names as configurable', () => {
    // Expiry alert days, maximum discount, adjustment thresholds, purchase
    // approval thresholds, cold-chain alert duration, password policy,
    // controlled tolerance and forecast windows.
    for (const key of [
      'expiry.alertBuckets',
      'pos.maxDiscountPercent',
      'approval.adjustment.approvalThreshold',
      'approval.purchaseOrder.managerThreshold',
      'coldchain.excursionToleranceMinutes',
      'security.passwordMinLength',
      'controlled.varianceTolerance',
      'replenishment.forecastHorizonDays',
    ]) {
      expect(SETTINGS_BY_KEY.has(key)).toBe(true);
    }
  });
});

describe('ConfigService validation', () => {
  // The service only needs Prisma for reads; validation is pure.
  const service = new ConfigService({} as never);

  it('coerces a numeric string to a number', () => {
    expect(service.validate('expiry.criticalDays', '45')).toBe(45);
  });

  it('rejects a value above the declared maximum', () => {
    expect(() => service.validate('expiry.criticalDays', 9999)).toThrow(/at most 365/);
  });

  it('rejects a value below the declared minimum', () => {
    expect(() => service.validate('security.passwordMinLength', 4)).toThrow(/at least 8/);
  });

  it('rejects an unknown key rather than storing it', () => {
    expect(() => service.validate('made.up.key', 1)).toThrow(/Unknown setting/);
  });

  it('rejects a value outside the declared options', () => {
    expect(() => service.validate('inventory.pickStrategy', 'RANDOM')).toThrow(/must be one of/);
    expect(service.validate('inventory.pickStrategy', 'FIFO')).toBe('FIFO');
  });

  it('parses a comma-separated list into an array', () => {
    expect(service.validate('expiry.alertBuckets', '7,30,90')).toEqual([7, 30, 90]);
    expect(service.validate('locale.enabled', 'en,am')).toEqual(['en', 'am']);
  });

  it('refuses an empty numeric list', () => {
    expect(() => service.validate('expiry.alertBuckets', '')).toThrow(/at least one value/);
  });

  it('reads the usual truthy spellings as booleans', () => {
    expect(service.validate('pos.allowNegativeStock', 'true')).toBe(true);
    expect(service.validate('pos.allowNegativeStock', '1')).toBe(true);
    expect(service.validate('pos.allowNegativeStock', 'no')).toBe(false);
    expect(service.validate('pos.allowNegativeStock', 'false')).toBe(false);
  });

  it('treats a feature flag as a boolean', () => {
    expect(service.validate('feature.webhooks', 'true')).toBe(true);
  });
});
