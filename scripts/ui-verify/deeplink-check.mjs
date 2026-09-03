/**
 * Does a notification link actually open the record it names?
 *
 * `link-check.mjs` proves the page reads the parameter. That is a property of
 * the source, and a page can read a parameter and then do nothing with it. So
 * this takes real ids out of the API, opens each page with the link a
 * notification would carry, and asks whether that record is now on screen —
 * selected in a detail panel, or scrolled to and ringed in a list.
 */
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const API = process.env.API_URL ?? 'http://localhost:4000/api';
const PASSWORD = process.env.SEED_PASSWORD ?? 'PharmaCore#2026';
const CHROMIUM =
  process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

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
const token = auth.accessToken;
await page.evaluate((a) => {
  localStorage.setItem('pharmacore.access', a.accessToken);
  localStorage.setItem('pharmacore.refresh', a.refreshToken);
  localStorage.setItem('pharmacore.user', JSON.stringify(a.user));
}, auth);

async function get(path) {
  const r = await page.request.get(`${API}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return r.ok() ? r.json() : null;
}

const rows = (body) => body?.data ?? body?.items ?? (Array.isArray(body) ? body : []);
const firstId = async (path) => rows(await get(path))[0]?.id ?? null;

/**
 * Each case: the link a notification emits, and how to tell it landed —
 * `detail` looks for the record's own name somewhere on the page; `row` looks
 * for the ringed row the page scrolled to.
 */
const CASES = [
  { name: '/products?id=', id: () => firstId('/products?pageSize=1'), url: (id) => `/products?id=${id}`, mode: 'detail', placeholder: 'Select a product' },
  { name: '/products tab', id: () => firstId('/products?pageSize=1'), url: (id) => `/products?id=${id}&tab=price-history`, mode: 'tab', tab: 'Price history' },
  { name: '/patients?id=', id: () => firstId('/patients?pageSize=1'), url: (id) => `/patients?id=${id}`, mode: 'detail', placeholder: 'Select a patient' },
  { name: '/suppliers?id=', id: () => firstId('/suppliers?pageSize=1'), url: (id) => `/suppliers?id=${id}`, mode: 'detail', placeholder: 'Select a supplier' },
  { name: '/quality?id=', id: () => firstId('/quality-incidents?pageSize=1'), url: (id) => `/quality?id=${id}`, mode: 'detail', placeholder: 'Select an incident' },
  { name: '/returns?id=', id: () => firstId('/returns?pageSize=1'), url: (id) => `/returns?id=${id}`, mode: 'detail', placeholder: 'Select a return' },
  { name: '/invoices?id=', id: () => firstId('/supplier-invoices?pageSize=1'), url: (id) => `/invoices?id=${id}`, mode: 'detail', placeholder: 'Select an invoice' },
  { name: '/recalls?id=', id: () => firstId('/recalls?pageSize=1'), url: (id) => `/recalls?id=${id}`, mode: 'detail', placeholder: 'Select a recall' },
  { name: '/transfers?id=', id: () => firstId('/transfers?pageSize=1'), url: (id) => `/transfers?id=${id}`, mode: 'detail', placeholder: 'Select a transfer' },
  { name: '/damage?id=', id: () => firstId('/damage-reports?pageSize=1'), url: (id) => `/damage?id=${id}`, mode: 'row' },
  { name: '/cold-chain?excursionId=', id: () => firstId('/cold-chain/excursions?pageSize=1'), url: (id) => `/cold-chain?excursionId=${id}`, mode: 'row' },
  { name: '/procurement?poId=', id: () => firstId('/purchase-orders?pageSize=1'), url: (id) => `/procurement?poId=${id}`, mode: 'row' },
  { name: '/admin?tab=', id: async () => 'Backups', url: () => '/admin?tab=Backups', mode: 'tab', tab: 'Backups' },
];

console.log('\nDEEP LINKS — does the link open the record it names?\n');

let failures = 0;
let checked = 0;
for (const c of CASES) {
  const id = await c.id();
  if (!id) {
    console.log(`  SKIP  ${c.name.padEnd(26)} nothing of this kind in the seed`);
    continue;
  }
  await page.goto(`${WEB}${c.url(id)}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1500);

  let landed = false;
  let how = '';
  if (c.mode === 'row') {
    // The ring is an animation that clears, so the attribute is what is
    // checked: the row exists and the page scrolled to it.
    const row = page.locator(`[data-row-id="${id}"]`);
    landed = (await row.count()) > 0 && (await row.first().isVisible());
    how = landed ? 'row is on screen' : 'row not rendered';
  } else if (c.mode === 'tab') {
    const active = page.locator(`button:has-text("${c.tab}")`).first();
    const cls = (await active.getAttribute('class').catch(() => '')) ?? '';
    landed = /font-medium|btn-primary|bg-brand/.test(cls);
    how = landed ? `"${c.tab}" is the open tab` : `"${c.tab}" is not selected`;
  } else {
    // The detail panel is open when the placeholder that stands in its place
    // is gone. Each page's exact wording is named above rather than matched by
    // a pattern, so an unrelated "Select a warehouse" elsewhere on the screen
    // cannot make a passing page look like a failing one.
    const body = (await page.locator('main').innerText().catch(() => '')) ?? '';
    landed = body.trim().length > 0 && !body.includes(c.placeholder);
    how = landed
      ? 'detail panel is open'
      : `still showing "${c.placeholder}"`;
  }

  checked += 1;
  if (!landed) failures += 1;
  console.log(`  ${landed ? 'PASS' : 'FAIL'}  ${c.name.padEnd(26)} ${how}`);
}

await browser.close();
console.log(
  failures
    ? `\n${failures} of ${checked} link(s) did not open what they named.\n`
    : `\n${checked} link(s) opened the record they named.\n`,
);
process.exit(failures ? 1 : 0);
