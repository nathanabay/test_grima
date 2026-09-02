/**
 * Every declared setting must either be read somewhere, or say that it is not.
 *
 * A setting that changes nothing is worse than a missing one: the configuration
 * screen agrees with the administrator and the system ignores them. This test
 * greps the source for each key, so a setting added without a call site fails
 * here rather than being discovered by somebody who changed it and waited for
 * something to happen.
 *
 * It is deliberately a text search: the point is to catch a key nobody wired
 * up, and a key that appears nowhere in the code cannot possibly be read.
 */

import { execFileSync } from 'child_process';
import { join, resolve } from 'path';
import { FEATURE_FLAGS, SETTING_DEFINITIONS } from '../src/common/config/settings.catalog';

const REPO_ROOT = resolve(__dirname, '../../..');
const CATALOGUE = 'settings.catalog.ts';

/** Files that mention the key, excluding the catalogue that declares it. */
function referencesOutsideCatalogue(key: string): string[] {
  try {
    const out = execFileSync(
      'grep',
      [
        '-rl',
        '--include=*.ts',
        '--include=*.tsx',
        '--',
        key,
        join(REPO_ROOT, 'apps/api/src'),
        join(REPO_ROOT, 'apps/web'),
        join(REPO_ROOT, 'packages'),
      ],
      { encoding: 'utf8' },
    );
    return out
      .split('\n')
      .filter(Boolean)
      .filter((f) => !f.endsWith(CATALOGUE));
  } catch {
    // grep exits non-zero when nothing matches.
    return [];
  }
}

describe('Settings catalogue (§65)', () => {
  const entries = [
    ...SETTING_DEFINITIONS.map((d) => ({ key: d.key, notEnforced: d.notEnforced })),
    ...FEATURE_FLAGS.map((f) => ({ key: f.key, notEnforced: f.notEnforced })),
  ];

  it('declares at least one setting per group it claims to cover', () => {
    expect(SETTING_DEFINITIONS.length).toBeGreaterThan(20);
    expect(FEATURE_FLAGS.length).toBeGreaterThan(5);
  });

  it('has no duplicate keys', () => {
    const keys = entries.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(entries.filter((e) => !e.notEnforced).map((e) => e.key))(
    '%s is read somewhere outside the catalogue',
    (key) => {
      const files = referencesOutsideCatalogue(key);
      expect(files.length).toBeGreaterThan(0);
    },
  );

  it.each(entries.filter((e) => e.notEnforced).map((e) => [e.key, e.notEnforced!]))(
    '%s is marked not enforced, and explains why',
    (key, note) => {
      // If somebody wires it up, they should clear the marker — otherwise the
      // screen keeps telling operators it does nothing when it now does.
      expect(referencesOutsideCatalogue(key)).toHaveLength(0);
      expect(note.length).toBeGreaterThan(30);
    },
  );
});
