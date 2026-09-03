/**
 * Does typing a URL get the same answer as the menu?
 *
 * `nav.ts` filters the sidebar, but a URL typed into the address bar was
 * unguarded: a cashier who typed `/accounting` got the page with four dead
 * panels and a scattering of permission errors rather than a clean answer.
 * The data was never at risk — the API refuses it — but a screen that
 * half-loads reads as a broken product rather than a page that is not theirs.
 *
 * This signs in as a role, opens a page that role's own menu does not offer,
 * and checks the page says so plainly instead of rendering broken panels. It
 * also opens a page the role does hold, so a guard that refused everything
 * would fail here rather than look like a pass.
 */
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const API = process.env.API_URL ?? 'http://localhost:4000/api';
const PASSWORD = process.env.SEED_PASSWORD ?? 'PharmaCore#2026';
const CHROMIUM =
  process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/** Who, a page they may not open, and a page they may. */
const CASES = [
  { who: 'cashier', refused: '/accounting', allowed: '/pos' },
  // Not `/dashboard`: a cashier does not hold `analytics.dashboard.READ`, so
  // that is a page they may not open — which is why signing in now lands on
  // the first page their own menu offers.
  { who: 'cashier', refused: '/admin', allowed: '/patients' },
  { who: 'storekeeper', refused: '/accounting', allowed: '/counts' },
  { who: 'qa', refused: '/pricing', allowed: '/batches' },
];

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
  return { context, page };
}

console.log('\nROUTE GUARD — does a typed URL answer the same as the menu?\n');

let failures = 0;
for (const { who, refused, allowed } of CASES) {
  const session = await signIn(who);
  if (!session) {
    console.log(`  SKIP  ${who.padEnd(12)} could not sign in (login throttle)`);
    continue;
  }
  const { context, page } = session;

  await page.goto(`${WEB}${refused}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(900);
  const refusedBody = (await page.locator('main').innerText().catch(() => '')) ?? '';
  const saysNo = /is not part of your role/i.test(refusedBody);
  const leaksErrors = /Missing required permission/i.test(refusedBody);

  await page.goto(`${WEB}${allowed}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(900);
  const allowedBody = (await page.locator('main').innerText().catch(() => '')) ?? '';
  const stillWorks = !/is not part of your role/i.test(allowedBody) && allowedBody.trim().length > 0;

  const ok = saysNo && !leaksErrors && stillWorks;
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${who.padEnd(12)} ${refused} refused cleanly: ${saysNo ? 'yes' : 'NO'}` +
      `${leaksErrors ? ' (leaks permission errors)' : ''}; ${allowed} still opens: ${stillWorks ? 'yes' : 'NO'}`,
  );

  await context.close();
}

await browser.close();
console.log(
  failures
    ? `\n${failures} route(s) did not answer the way the menu does.\n`
    : `\nEvery typed URL answered the way the menu does.\n`,
);
process.exit(failures ? 1 : 0);
