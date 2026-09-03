/**
 * Every screen and every core task, as the role that actually does the work.
 *
 * `verify.mjs` signs in as `admin`, who holds every permission. That is the
 * right actor for contrast, layout and accessibility — they do not depend on
 * who is looking — and the wrong actor for everything else, because a screen
 * that is unusable for the person whose job it is renders perfectly for an
 * administrator. Every browser sweep to date has therefore been blind to an
 * entire class of defect.
 *
 * Two passes:
 *
 *  1. NAVIGATION — for each role, open only the pages that role's own sidebar
 *     offers, and report any that shout a permission error or lose a panel to a
 *     403. A page the product itself puts in front of somebody has to work when
 *     they click it.
 *
 *  2. TASKS — open the screen a role's core job lives on and count the choices
 *     in each select. A task whose warehouse list is empty cannot be completed,
 *     however well the endpoint behind it behaves.
 *
 * The task pass only reaches controls on the page itself and behind one primary
 * button. A task whose fields sit deeper — dispensing, where the warehouse is
 * chosen after opening a prescription and then the dispense panel — reports
 * "no selects" rather than a verdict. Read that as "not reached", not as "fine".
 *
 * Run against a seeded API on :4000 and the web app on :3000.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const WEB = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
const API = process.env.API_ORIGIN ?? 'http://localhost:4000/api';
const PASSWORD = 'PharmaCore#2026';

const ROLES = [
  'cashier', 'pharmacist', 'storekeeper', 'warehouse',
  'qa', 'procurement', 'finance', 'manager', 'auditor', 'admin',
];

/** The job each role signs in to do, and the screen it lives on. */
const TASKS = [
  { who: 'cashier', href: '/pos', task: 'sell something' },
  { who: 'pharmacist', href: '/dispensing', task: 'dispense a prescription' },
  { who: 'storekeeper', href: '/receiving', task: 'receive a delivery' },
  { who: 'storekeeper', href: '/counts', task: 'run a stock count' },
  { who: 'storekeeper', href: '/transfers', task: 'send a transfer' },
  { who: 'warehouse', href: '/adjustments', task: 'adjust stock' },
  { who: 'qa', href: '/batches', task: 'release a batch' },
  { who: 'procurement', href: '/procurement', task: 'raise a purchase order' },
];

const NAV = [
  ...readFileSync(new URL('../../apps/web/components/nav.ts', import.meta.url), 'utf8')
    .matchAll(/\{ href: '([^']+)'[^}]*?permission: '([^']*)'/g),
].map((m) => ({ href: m[1], permission: m[2] }));

let failures = 0;
const browser = await chromium.launch({ executablePath: CHROMIUM });

async function signIn(who) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
  const res = await page.request.post(`${API}/auth/login`, {
    data: { identifier: who, password: PASSWORD },
  });
  if (!res.ok()) {
    await context.close();
    return null;
  }
  const auth = await res.json();
  await page.evaluate((a) => {
    localStorage.setItem('pharmacore.access', a.accessToken);
    localStorage.setItem('pharmacore.refresh', a.refreshToken);
    localStorage.setItem('pharmacore.user', JSON.stringify(a.user));
  }, auth);
  return { context, page, held: new Set(auth.user.permissions) };
}

/** Visit a page and collect what the reader was refused while it loaded. */
async function visit(page, href) {
  const denied = new Set();
  const onResponse = (r) => {
    if (r.status() === 403) denied.add(new URL(r.url()).pathname.replace('/api', ''));
  };
  page.on('response', onResponse);
  await page.goto(`${WEB}${href}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(600);
  const body = (await page.locator('main').innerText().catch(() => '')) ?? '';
  page.off('response', onResponse);
  return { denied: [...denied], shouts: /Missing required permission/i.test(body) };
}

// ============================================================
console.log('\nNAVIGATION — pages each role\'s own sidebar offers');
// ============================================================

const broken = [];
let checked = 0;
for (const who of ROLES) {
  const session = await signIn(who);
  if (!session) continue;
  for (const { href, permission } of NAV) {
    if (permission && !session.held.has(permission)) continue; // the sidebar hides it
    checked += 1;
    const { denied, shouts } = await visit(session.page, href);
    if (shouts || denied.length) broken.push({ who, href, shouts, denied });
  }
  await session.context.close();
}

const shouting = broken.filter((b) => b.shouts);
const partial = broken.filter((b) => !b.shouts);

console.log(`\n  ${shouting.length} page(s) show a raw permission error on a screen their own menu offers:`);
for (const b of shouting) {
  console.log(`    FAIL  ${b.who.padEnd(12)} ${b.href.padEnd(18)} 403: ${b.denied.join(', ')}`);
  failures += 1;
}
if (!shouting.length) console.log('    none');

console.log(`\n  ${partial.length} page(s) load with a panel silently missing:`);
const byEndpoint = {};
for (const b of partial) for (const d of b.denied) byEndpoint[d] = (byEndpoint[d] ?? 0) + 1;
for (const [endpoint, n] of Object.entries(byEndpoint).sort((a, b) => b[1] - a[1]).slice(0, 6)) {
  console.log(`    ${String(n).padStart(4)} x  ${endpoint}`);
}
console.log(`\n  ${broken.length} of ${checked} page/role combinations the product offers are broken or partial.`);

// ============================================================
console.log('\nTASKS — can the role that owns the job finish it?');
// ============================================================

console.log('\n  role         page          task                       choices in each select');
for (const { who, href, task } of TASKS) {
  const session = await signIn(who);
  if (!session) continue;
  const { page } = session;
  await page.goto(`${WEB}${href}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1200);
  // Open the primary create control, where the task starts behind one.
  for (const label of ['New', 'Create', 'Start', 'Add', 'Record', 'Receive', 'Dispense']) {
    const button = page.locator(`button:has-text("${label}")`).first();
    if (await button.count()) {
      await button.click().catch(() => {});
      await page.waitForTimeout(1000);
      break;
    }
  }

  const fields = [];
  let empty = 0;
  for (const select of await page.locator('select').all()) {
    const label =
      (await select.getAttribute('aria-label')) ??
      (await select.evaluate((el) => el.closest('label')?.innerText?.split('\n')[0] ?? '')) ??
      '';
    const options = await select.locator('option').count();
    // One option is a placeholder ("Select a warehouse"), which is no choice.
    if (options <= 1) empty += 1;
    fields.push(`${(label || '?').trim().slice(0, 20)}=${options}`);
  }

  const verdict = empty > 0 ? 'FAIL' : fields.length ? 'PASS' : '....';
  if (empty > 0) failures += 1;
  console.log(`  ${verdict}  ${who.padEnd(12)} ${href.padEnd(13)} ${task.padEnd(26)} ${fields.join('  ') || '(no selects)'}`);
}

await browser.close();
console.log(
  `\n${failures === 0 ? 'ALL ROLE FLOWS PASSED' : `${failures} ROLE FLOW FAILURE(S)`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
