/**
 * What every page does about the things a reader depends on.
 *
 * A static counterpart to the browser sweeps. `verify.mjs` proves a page is
 * legible and `role-flows.mjs` proves the right people can reach it; this asks
 * whether the page, once reached, shows a reader all of their data, tells them
 * when it cannot, captures input in something better than a browser prompt, and
 * says anything when their action succeeds.
 *
 * Every check is a property of the page source, so it runs without a server and
 * gives the same answer on every machine.
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const APP = 'apps/web/app';

function pages(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) pages(full, out);
    else if (entry === 'page.tsx') out.push(full);
  }
  return out;
}

const CHECKS = [
  {
    key: 'unreachable-rows',
    label: 'fetches a capped page and offers no way to the rest',
    test: (s, caps) => caps.length > 0 && !/setPage\(/.test(s),
  },
  {
    key: 'lying-pager',
    label: 'DataTable pages only the fetched slice and never says how many exist',
    test: (s, caps) => s.includes('<DataTable') && !s.includes('total=') && caps.length > 0,
  },
  {
    key: 'browser-prompt',
    label: 'captures input through window.prompt',
    test: (s) => /window\.prompt/.test(s),
  },
  {
    key: 'silent-success',
    label: 'changes data and confirms nothing',
    test: (s) => /method: ["'](POST|PATCH|PUT|DELETE)/.test(s) && !/setMessage\(/.test(s),
  },
  {
    key: 'no-empty-state',
    label: 'renders nothing explanatory when it has nothing to show',
    test: (s) => !/<Empty|<EmptyState/.test(s),
  },
  {
    key: 'no-error-state',
    label: 'has no way to show a failed request',
    test: (s) => !/<ErrorBox|<ErrorState/.test(s),
  },
  {
    key: 'field-error-unused',
    label: 'has a form but never marks the field that was rejected',
    test: (s) => /<Field\b/.test(s) && !/<Field[^>]*error=/.test(s),
  },
];

const found = {};
const rows = [];
for (const file of pages(APP).sort()) {
  const route = file.replace(APP, '').replace('/page.tsx', '') || '/';
  const source = readFileSync(file, 'utf8');
  const caps = [...source.matchAll(/(?:pageSize|limit)=(\d+)/g)].map((m) => Number(m[1]));
  const hits = CHECKS.filter((c) => c.test(source, caps)).map((c) => c.key);
  for (const h of hits) (found[h] ??= []).push(route);
  rows.push({ route, hits, cap: caps.length ? Math.max(...caps) : null });
}

console.log(`\n${rows.length} page(s) examined\n`);
for (const { key, label } of CHECKS) {
  const list = found[key] ?? [];
  console.log(`${String(list.length).padStart(3)}  ${label}`);
  if (list.length) console.log(`     ${list.join(', ')}`);
}

const affected = rows.filter((r) => r.hits.length).length;
console.log(`\n${affected} of ${rows.length} page(s) carry at least one.\n`);
// Reporting only: this is a standing measurement, not a gate, so it does not
// fail a build. The gates are verify.mjs, role-flows.mjs and link-check.mjs.
