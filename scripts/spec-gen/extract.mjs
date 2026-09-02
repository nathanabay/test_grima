// Extract the facts the specification documents are built from, straight out of
// the code that runs. A document typed by hand drifts from the system the
// morning after it is written; one generated from the schema, the route table
// and the permission catalogue cannot.
//
// Writes scripts/spec-gen/facts.json.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const facts = {};

// ---- Data model, from the Prisma schema ----
const schema = await readFile(path.join(ROOT, 'apps/api/prisma/schema.prisma'), 'utf8');

const enums = [...schema.matchAll(/^enum\s+(\w+)\s*\{([^}]*)\}/gm)].map((m) => ({
  name: m[1],
  values: m[2].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//')),
}));

const models = [...schema.matchAll(/^(\/\/\/[^\n]*\n)*model\s+(\w+)\s*\{([\s\S]*?)\n\}/gm)].map((m) => {
  const body = m[3];
  const doc = [];
  // Collect the /// documentation that immediately precedes the model.
  const before = schema.slice(0, m.index).split('\n');
  for (let i = before.length - 1; i >= 0 && before[i].trim().startsWith('///'); i--) {
    doc.unshift(before[i].trim().replace(/^\/\/\/\s?/, ''));
  }

  const fields = [];
  const indexes = [];
  let pendingDoc = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) { pendingDoc = []; continue; }
    if (line.startsWith('///')) { pendingDoc.push(line.replace(/^\/\/\/\s?/, '')); continue; }
    if (line.startsWith('//')) continue;
    if (line.startsWith('@@')) { indexes.push(line); continue; }
    const fm = /^(\w+)\s+(\S+)(.*)$/.exec(line);
    if (!fm) { pendingDoc = []; continue; }
    fields.push({
      name: fm[1],
      type: fm[2],
      attributes: fm[3].trim(),
      doc: pendingDoc.join(' '),
      optional: fm[2].endsWith('?'),
      relation: /^[A-Z]/.test(fm[2].replace(/[?[\]]/g, '')),
    });
    pendingDoc = [];
  }

  const table = /@@map\("([^"]+)"\)/.exec(body)?.[1] ?? null;
  return { name: m[2], table, doc: doc.join(' '), fields, indexes };
});

facts.dataModel = { models, enums };

// ---- Migrations, in order ----
const migDir = path.join(ROOT, 'apps/api/prisma/migrations');
const migrations = (await readdir(migDir, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
facts.migrations = await Promise.all(
  migrations.map(async (name) => {
    const sql = await readFile(path.join(migDir, name, 'migration.sql'), 'utf8');
    const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);
    return {
      name,
      timestamp: name.slice(0, 14),
      label: name.slice(15).replace(/_/g, ' '),
      statements: statements.length,
      // A migration that drops or renames is the one a reviewer must read.
      destructive: /DROP\s+(TABLE|COLUMN)|ALTER\s+TABLE[^;]*RENAME/i.test(sql),
      addsNotNullWithoutDefault: /ADD COLUMN[^;,]*NOT NULL(?![^;,]*DEFAULT)/i.test(sql),
    };
  }),
);

// ---- Routes, from the running application's own route table ----
const log = await readFile('/tmp/api.log', 'utf8').catch(() => '');
const routeLines = [...log.matchAll(/Mapped \{([^,]+), (\w+)\}/g)];
const routes = [...new Map(
  routeLines.map((m) => [`${m[2]} ${m[1]}`, { method: m[2], path: m[1] }]),
).values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

// Attach the permissions each route declares, read from the controllers.
const controllerFiles = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (entry.name.endsWith('.controller.ts')) controllerFiles.push(full);
  }
}
await walk(path.join(ROOT, 'apps/api/src'));

const handlers = [];
for (const file of controllerFiles) {
  const src = await readFile(file, 'utf8');
  const controllerPath = /@Controller\('([^']*)'\)/.exec(src)?.[1] ?? '';
  const tag = /@ApiTags\('([^']*)'\)/.exec(src)?.[1] ?? null;
  const blocks = src.split(/\n\s*\n/);
  for (const block of blocks) {
    const verb = /@(Get|Post|Patch|Put|Delete)\('?([^')]*)'?\)/.exec(block);
    if (!verb) continue;
    const perms = /@RequirePermissions\(([^)]*)\)/.exec(block);
    const summary = /summary:\s*\n?\s*'([^']*)'/.exec(block)?.[1]
      ?? /summary: '([^']*)'/.exec(block)?.[1]
      ?? null;
    handlers.push({
      module: path.basename(path.dirname(file)),
      tag,
      method: verb[1].toUpperCase(),
      controllerPath,
      routePath: verb[2] ?? '',
      permissions: perms ? [...perms[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [],
      isPublic: /@Public\(\)/.test(block),
      summary,
    });
  }
}
facts.routes = routes;
facts.handlers = handlers;

// ---- Permissions and roles, from the shared catalogue ----
const perms = await import(path.join(ROOT, 'packages/shared/dist/permissions.js'));
facts.permissions = {
  catalogue: perms.RESOURCE_CATALOG,
  codes: perms.allPermissionCodes(),
  roles: perms.DEFAULT_ROLES.map((r) => ({
    code: r.code,
    name: r.name,
    description: r.description,
    permissions: perms.resolveRolePermissions(r),
  })),
};

// ---- Settings catalogue ----
const settingsSrc = await readFile(
  path.join(ROOT, 'apps/api/src/common/config/settings.catalog.ts'),
  'utf8',
);
facts.settings = {
  count: (settingsSrc.match(/^\s*key: '/gm) ?? []).length,
  notEnforced: (settingsSrc.match(/notEnforced:/g) ?? []).length,
};

// ---- Tests ----
const testDir = path.join(ROOT, 'apps/api/test');
const testFiles = (await readdir(testDir)).filter((f) => f.endsWith('.spec.ts'));
facts.tests = await Promise.all(
  testFiles.map(async (f) => {
    const src = await readFile(path.join(testDir, f), 'utf8');
    return {
      file: f,
      suites: [...src.matchAll(/^describe\('([^']*)'/gm)].map((m) => m[1]),
      cases: (src.match(/\n\s*it\(/g) ?? []).length,
      integration: /PrismaClient|\$connect/.test(src),
    };
  }),
);

const scriptDir = path.join(ROOT, 'scripts');
const e2e = (await readdir(scriptDir)).filter((f) => f.startsWith('e2e-'));
facts.e2e = await Promise.all(
  e2e.map(async (f) => {
    const src = await readFile(path.join(scriptDir, f), 'utf8');
    return { file: f, checks: (src.match(/\n\s*check\(/g) ?? []).length };
  }),
);

// ---- Web pages ----
const webApp = path.join(ROOT, 'apps/web/app');
const pages = [];
async function walkPages(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) await walkPages(path.join(dir, entry.name), `${prefix}/${entry.name}`);
    else if (entry.name === 'page.tsx') pages.push(prefix || '/');
  }
}
await walkPages(webApp);
facts.pages = pages.sort();

await writeFile(
  path.join(ROOT, 'scripts/spec-gen/facts.json'),
  JSON.stringify(facts, null, 1),
);

console.log(
  `models ${models.length}, enums ${enums.length}, migrations ${facts.migrations.length}, ` +
  `routes ${routes.length}, handlers ${handlers.length}, permissions ${facts.permissions.codes.length}, ` +
  `roles ${facts.permissions.roles.length}, settings ${facts.settings.count}, ` +
  `unit suites ${facts.tests.length}, e2e suites ${facts.e2e.length}, pages ${pages.length}`,
);
