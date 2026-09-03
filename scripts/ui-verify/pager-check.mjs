/**
 * Does the pagination actually reach the rows the server holds?
 *
 * `page-audit.mjs` proves a screen has a route to the rest of its data; this
 * proves the route goes somewhere. It opens each converted screen, clicks Next
 * and checks the rows changed — a pager that renders but does not fetch is
 * exactly the defect this work was meant to remove, and it looks identical to
 * a working one until it is clicked.
 */
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const API = process.env.API_URL ?? 'http://localhost:4000/api';
const PASSWORD = process.env.SEED_PASSWORD ?? 'PharmaCore#2026';
const CHROMIUM =
  process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/** Screens with a server-driven pager, and how to find their first row. */
const SCREENS = [
  { route: '/products', row: '.max-h-\\[70vh\\] > button' },
  { route: '/patients', row: '.max-h-\\[70vh\\] > button' },
  { route: '/suppliers', row: '.max-h-\\[70vh\\] > button' },
  { route: '/controlled', row: 'tbody tr' },
  { route: '/admin', row: 'tbody tr' },
  { route: '/transfers', row: '.max-h-\\[60vh\\] > button' },
  { route: '/counts', row: '.space-y-1 > button' },
  { route: '/recalls', row: '.space-y-2 > button' },
  { route: '/serials', row: 'tbody tr' },
];

const browser = await chromium.launch({ executablePath: CHROMIUM });
const context = await browser.newContext();
const page = await context.newPage();

await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
const res = await page.request.post(`${API}/auth/login`, {
  data: { identifier: 'admin', password: PASSWORD },
});
if (!res.ok()) {
  console.error(`Could not sign in: HTTP ${res.status()}. The login throttle needs a minute.`);
  await browser.close();
  process.exit(1);
}
const auth = await res.json();
await page.evaluate((a) => {
  localStorage.setItem('pharmacore.access', a.accessToken);
  localStorage.setItem('pharmacore.refresh', a.refreshToken);
  localStorage.setItem('pharmacore.user', JSON.stringify(a.user));
}, auth);

console.log('\nPAGINATION — does Next reach rows the first page did not hold?\n');

let failures = 0;
let walked = 0;
let counted = 0;
for (const { route, row } of SCREENS) {
  await page.goto(`${WEB}${route}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(700);

  const next = page.getByRole('button', { name: 'Next' }).first();
  if (!(await next.count()) || (await next.isDisabled().catch(() => true))) {
    // Not a skip: the screen still owes the reader an honest count. "1-27 of
    // 27" proves the total came from the server, which is what a truncating
    // list could never say.
    const body = (await page.locator('main').innerText().catch(() => '')) ?? '';
    const count = body.match(/(\d[\d,]*)\s*[–-]\s*(\d[\d,]*)\s+of\s+(\d[\d,]*)/);
    const num = (v) => Number(v.replace(/,/g, ''));
    const whole = count && num(count[2]) === num(count[3]);
    counted += 1;
    console.log(
      `  ${whole ? 'PASS' : 'FAIL'}  ${route.padEnd(12)} one page, and it says so: ${count ? count[0] : 'no count on screen'}`,
    );
    if (!whole) failures += 1;
    continue;
  }

  const before = await page.locator(row).first().innerText().catch(() => '');
  await next.click();
  await page.waitForTimeout(1200);
  const after = await page.locator(row).first().innerText().catch(() => '');

  walked += 1;
  const moved = !!before && !!after && before !== after;
  console.log(`  ${moved ? 'PASS' : 'FAIL'}  ${route.padEnd(12)} page two shows different rows`);
  if (!moved) {
    failures += 1;
    console.log(`        first row on page 1: ${before.replace(/\s+/g, ' ').slice(0, 60)}`);
    console.log(`        first row on page 2: ${after.replace(/\s+/g, ' ').slice(0, 60)}`);
  }
}

await browser.close();
console.log(
  failures
    ? `\n${failures} screen(s) failed: a pager that did not fetch, or a count that did not add up.\n`
    : `\n${walked} pager(s) walked and fetched; ${counted} single-page screen(s) reported their full total.\n`,
);
process.exit(failures ? 1 : 0);
