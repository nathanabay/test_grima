// Build tests/spec-tests.json: which requirement each test actually covers.
//
// A registry typed by hand is a list of intentions. This one is derived from
// the suites that exist and the traceability matrix, so a requirement claiming
// test coverage it does not have shows up as a gap rather than as a tick.
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const facts = JSON.parse(await readFile(path.join(ROOT, 'scripts/spec-gen/facts.json'), 'utf8'));
const trace = await readFile(path.join(ROOT, 'specs/TRACEABILITY_MATRIX.md'), 'utf8');

const rows = trace.split('\n')
  .filter((l) => l.startsWith('| `PHARM-'))
  .map((l) => {
    const c = l.split('|').map((x) => x.trim());
    return { req: c[1].replace(/`/g, ''), num: Number(c[2]), feature: c[3], tests: c[11], status: c[12] };
  });

// Every named suite, and what it is.
const suites = [
  ...facts.tests.map((t) => ({
    id: t.file.replace(/\.spec\.ts$/, ''),
    kind: t.integration ? 'integration' : 'unit',
    path: `apps/api/test/${t.file}`,
    cases: t.cases,
    describes: t.suites,
  })),
  ...facts.e2e.map((t) => ({
    id: t.file.replace(/^e2e-|\.mjs$/g, ''),
    kind: 'end-to-end',
    path: `scripts/${t.file}`,
    cases: t.checks,
    describes: [],
  })),
  {
    id: 'ui-verify',
    kind: 'browser',
    path: 'scripts/ui-verify/verify.mjs',
    cases: facts.pages.length,
    describes: ['contrast', 'layout overflow', 'accessible names', 'keyboard and focus'],
  },
];

const byRequirement = {};
for (const r of rows) {
  const named = r.tests
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s && s !== '—' && s !== '-');
  byRequirement[r.req] = {
    number: r.num,
    feature: r.feature,
    status: r.status,
    suites: named.map((n) => {
      // The matrix writes a suite name the way a person would: "fefo.spec",
      // "e2e-capa", "e2e-workflow (partial)". Normalise before matching, and
      // keep the "(partial)" note rather than discarding it — it says the suite
      // touches the feature without covering all of it.
      const partial = /\(partial\)/i.test(n);
      const key = n
        .replace(/\(partial\)/i, '')
        .trim()
        .replace(/\.spec$/, '')
        .replace(/^e2e-/, '');
      const match =
        suites.find((s) => s.id === key) ??
        suites.find((s) => s.id.startsWith(key + '-')) ??
        suites.find((s) => s.id === n);
      return { named: n, partial, resolved: match ? match.path : null };
    }),
  };
}

const covered = Object.values(byRequirement).filter((r) => r.suites.length > 0);
const implementedWithoutTests = Object.entries(byRequirement)
  .filter(([, r]) => r.status === 'IMPLEMENTED' && r.suites.length === 0)
  .map(([req]) => req);
const unresolved = [...new Set(
  Object.values(byRequirement).flatMap((r) => r.suites.filter((s) => !s.resolved).map((s) => s.named)),
)];

const registry = {
  generated: new Date().toISOString(),
  totals: {
    requirements: rows.length,
    implemented: rows.filter((r) => r.status === 'IMPLEMENTED').length,
    partial: rows.filter((r) => r.status === 'PARTIALLY IMPLEMENTED').length,
    notImplemented: rows.filter((r) => r.status === 'NOT IMPLEMENTED').length,
    withNamedTests: covered.length,
    implementedWithoutNamedTests: implementedWithoutTests.length,
    unitAndIntegrationCases: facts.tests.reduce((s, t) => s + t.cases, 0),
    endToEndChecks: facts.e2e.reduce((s, t) => s + t.checks, 0),
    pagesVerifiedInBrowser: facts.pages.length,
  },
  suites,
  // Named but not resolvable to a suite that exists: the registry's own honesty
  // check. An empty list means every reference points at real code.
  unresolvedSuiteNames: unresolved,
  requirements: byRequirement,
};

await mkdir(path.join(ROOT, 'tests'), { recursive: true });
await writeFile(path.join(ROOT, 'tests/spec-tests.json'), JSON.stringify(registry, null, 1));

console.log(
  `${registry.totals.requirements} requirements; ${covered.length} name a suite; ` +
  `${implementedWithoutTests.length} implemented with no named suite; ` +
  `${unresolved.length} unresolved suite name(s)` +
  (unresolved.length ? `: ${unresolved.join(', ')}` : ''),
);
