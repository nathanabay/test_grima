/**
 * Do the links in notifications land on the record they are about?
 *
 * Notifications are how work moves from one person to the next. A notification
 * that names a batch and then drops the reader on a list of every batch has
 * moved the work halfway.
 *
 * Two failure modes, and this reports both:
 *  - the route does not exist, so the link is a 404;
 *  - the route exists but the page never reads the query parameter, so the
 *    reader lands on an unfiltered list and finds the record by hand.
 *
 * Static: it reads the API for every `linkUrl` it emits and the web app for the
 * routes and the parameters each page actually consumes.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const API_SRC = 'apps/api/src';
const WEB_APP = 'apps/web/app';

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const routes = new Set(
  walk(WEB_APP)
    .filter((f) => f.endsWith('page.tsx'))
    .map((f) => f.replace(WEB_APP, '').replace('/page.tsx', '') || '/'),
);

/** A concrete path resolves when a static route equals it, or a dynamic one covers it. */
function resolves(path) {
  if (routes.has(path)) return true;
  const wanted = path.replace(/^\//, '').split('/');
  for (const route of routes) {
    const parts = route.replace(/^\//, '').split('/');
    if (parts.length !== wanted.length) continue;
    if (parts.every((p, i) => p.startsWith('[') || p === wanted[i])) return true;
  }
  return false;
}

const links = new Set();
for (const file of walk(API_SRC).filter((f) => f.endsWith('.ts'))) {
  for (const m of readFileSync(file, 'utf8').matchAll(/linkUrl: [`'"]([^`'"]+)/g)) {
    links.add(m[1]);
  }
}

const missingRoute = [];
const ignoredParam = [];
for (const raw of links) {
  const concrete = raw.replace(/\$\{[^}]*\}/g, 'X');
  const [path, query = ''] = concrete.split('?');
  if (!resolves(path)) {
    missingRoute.push(raw);
    continue;
  }
  if (!query) continue;
  const page = join(WEB_APP, path === '/' ? '' : path, 'page.tsx');
  let source = '';
  try {
    source = readFileSync(page, 'utf8');
  } catch {
    source = '';
  }
  // `useDeepLink('id')` is how a page reads its query string here: it wraps
  // `window.location.search` so a statically prerendered client page does not
  // need a Suspense boundary. Naming the hook counts as reading the URL, and
  // the key it is asked for appears as a quoted string just as before.
  const readsParams = /useSearchParams|URLSearchParams|location\.search|useDeepLink/.test(
    source,
  );
  for (const pair of query.split('&')) {
    const key = pair.split('=')[0];
    const honoured =
      readsParams && (source.includes(`'${key}'`) || source.includes(`"${key}"`));
    if (!honoured) ignoredParam.push(`${raw}  (${path} never reads "${key}")`);
  }
}

console.log(`\n${missingRoute.length} notification link(s) point at a route that does not exist:`);
for (const l of missingRoute.sort()) console.log(`  FAIL  ${l}`);

console.log(`\n${ignoredParam.length} carry a parameter the page ignores:`);
for (const l of ignoredParam.sort()) console.log(`  FAIL  ${l}`);

const total = missingRoute.length + ignoredParam.length;
console.log(
  `\n${total === 0 ? 'EVERY NOTIFICATION LINK LANDS ON ITS RECORD' : `${total} BROKEN NOTIFICATION LINK(S) over ${links.size} distinct link(s)`}\n`,
);
process.exit(total === 0 ? 0 : 1);
