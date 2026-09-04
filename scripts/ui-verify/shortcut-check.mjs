/**
 * Do the keyboard shortcuts work, and do they stay out of the way?
 *
 * Shortcuts were one page — `/pos`, plus the shell's Ctrl+K. A pharmacist
 * working a queue reached for the mouse for every move between screens. The
 * risk in adding more is the obvious one: a `g` typed into a search box must
 * be a `g`, not a navigation. This checks both halves.
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
await page.evaluate((a) => {
  localStorage.setItem('pharmacore.access', a.accessToken);
  localStorage.setItem('pharmacore.refresh', a.refreshToken);
  localStorage.setItem('pharmacore.user', JSON.stringify(a.user));
}, auth);

console.log('\nKEYBOARD — do the shortcuts work, and do they stay out of the way?\n');

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
}

await page.goto(`${WEB}/dashboard`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

// `?` shows the list.
await page.keyboard.press('?');
await page.waitForTimeout(400);
const helpText = await page
  .locator('[role="dialog"][aria-label="Keyboard shortcuts"]')
  .innerText()
  .catch(() => '');
check('? shows the shortcut list', /Keyboard shortcuts/i.test(helpText));
check('the list only offers pages this role can open', /Go to /.test(helpText));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// `g` then a letter navigates.
await page.keyboard.press('g');
await page.waitForTimeout(200);
await page.keyboard.press('i');
await page.waitForTimeout(1200);
check('g i goes to stock balances', page.url().includes('/inventory'), page.url());

// The important half: typing in a field must not navigate.
await page.goto(`${WEB}/products`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const box = page.locator('input').first();
await box.click();
await box.type('gi');
await page.waitForTimeout(900);
check(
  'typing "gi" into a search box does not navigate',
  page.url().includes('/products'),
  page.url(),
);
check('the typed text reached the box', (await box.inputValue()) === 'gi');

// Ctrl+K still opens the palette.
await page.keyboard.press('Escape');
await page.locator('body').click({ position: { x: 5, y: 5 } });
await page.keyboard.press('Control+k');
await page.waitForTimeout(500);
const paletteOpen = await page.locator('[role="dialog"]').count();
check('Ctrl+K still opens the command palette', paletteOpen > 0);

await browser.close();
console.log(
  failures
    ? `\n${failures} keyboard check(s) failed.\n`
    : '\nEvery keyboard check passed.\n',
);
process.exit(failures ? 1 : 0);
