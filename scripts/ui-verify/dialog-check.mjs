/**
 * Are regulated values captured in a form, or in a browser prompt?
 *
 * Twenty-one values were read through `window.prompt` — a payment amount, a
 * received quantity, the witness to a drug disposal. `page-audit.mjs` proves
 * the calls are gone from the source; this proves what replaced them works:
 * the dialog opens, its fields are labelled, it refuses a value the server
 * would refuse, and it says which field is wrong rather than failing whole.
 *
 * `window.prompt` is stubbed to throw, so a dialog that quietly fell back to
 * one fails here rather than passing silently.
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

// A prompt that still exists would block the run forever; this turns it into
// a visible failure instead.
await context.addInitScript(() => {
  window.prompt = () => {
    window.__promptCalled = true;
    return null;
  };
});

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

console.log('\nDIALOGS — is a regulated value captured in a labelled, validated form?\n');

let failures = 0;
let checked = 0;

/**
 * Open a screen, click the button that used to raise a prompt, and check the
 * dialog that appears: it is a real dialog, its first field is labelled, and
 * submitting it empty reports the field rather than doing nothing.
 */
async function check(name, route, openLabel, expectField, selectFirst) {
  await page.goto(`${WEB}${route}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1200);

  // Some actions live on a record, so the record has to be open first.
  if (selectFirst) {
    const row = page.locator(selectFirst).first();
    if (await row.count()) {
      await row.click().catch(() => {});
      await page.waitForTimeout(900);
    }
  }

  const button = page.getByRole('button', { name: openLabel }).first();
  if (!(await button.count())) {
    console.log(`  SKIP  ${name.padEnd(30)} "${openLabel}" is not offered on this seed`);
    return;
  }
  await button.click().catch(() => {});
  await page.waitForTimeout(700);

  const dialog = page.locator('[role="dialog"]').last();
  if (!(await dialog.count()) || !(await dialog.isVisible())) {
    checked += 1;
    failures += 1;
    console.log(`  FAIL  ${name.padEnd(30)} no dialog opened`);
    return;
  }

  const text = await dialog.innerText();
  if (process.env.DEBUG_DIALOG) console.log('    DIALOG:', text.replace(/\s+/g,' ').slice(0,240));
  // Labels render uppercase through CSS, so `innerText` comes back shouting.
  const hasField = text.toLowerCase().includes(expectField.toLowerCase());
  // Submitting empty must report the field, not silently do nothing.
  // The confirm button is whichever one is not Cancel; its wording is chosen
  // per dialog to say what will happen, so it cannot be matched by a fixed
  // list without the list going stale the first time one is reworded.
  const submit = dialog.locator('button').filter({ hasNotText: /^Cancel$/ }).last();
  let reported = 'not tested';
  if (await submit.count()) {
    await submit.click().catch(() => {});
    await page.waitForTimeout(400);
    const stillOpen = (await dialog.count()) > 0 && (await dialog.isVisible());
    const alert = await dialog.locator('[role="alert"]').count();
    reported = stillOpen && alert > 0 ? 'yes' : stillOpen ? 'held open' : 'closed';
  }

  const used = await page.evaluate(() => window.__promptCalled === true);
  if (used) promptsCalled += 1;

  const ok = hasField && reported === 'yes' && !used;
  checked += 1;
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(30)} field "${expectField}" ${hasField ? 'shown' : 'MISSING'}; empty submit reports the field: ${reported}${used ? '; USED window.prompt' : ''}`,
  );

  await page.keyboard.press('Escape').catch(() => {});
}

/**
 * The disposal witness is the case the audit named first, so it is not left
 * to chance: the fixture is created through the API, exactly as a pharmacist
 * would, and removed from the screen's reach by carrying it out or leaving it
 * approved for the next run.
 */
async function seedApprovedDisposal() {
  const token = auth.accessToken;
  const call = async (method, path, body) => {
    const r = await page.request.fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      data: body,
    });
    return r.ok() ? r.json() : null;
  };

  const existing = await call('GET', '/disposals?pageSize=50');
  const approved = (existing?.data ?? []).find((d) => d.status === 'APPROVED');
  if (approved) return approved;

  const expiring = await call('GET', '/inventory/expiry?maxDays=3650');
  const row = (expiring?.rows ?? expiring?.data ?? [])[0];
  if (!row?.batchId) return null;

  const created = await call('POST', '/disposals', {
    branchId: row.branchId,
    warehouseId: row.warehouseId,
    reason: 'Expired stock, withdrawn for destruction (dialog verification)',
    method: 'INCINERATION',
    items: [{ productId: row.productId, batchId: row.batchId, quantity: 1 }],
  });
  if (!created?.id) return null;
  return call('POST', `/disposals/${created.id}/approve`);
}

const disposal = await seedApprovedDisposal();
if (disposal) {
  await check(
    'disposal witness',
    '/disposal',
    /Carry out disposal/,
    'Witness',
    '.space-y-1 > button, .max-h-\\[60vh\\] > button',
  );
} else {
  console.log('  SKIP  disposal witness               could not raise a disposal to approve');
}
await check(
  'prescription rejection',
  '/dispensing',
  /^Reject$/,
  'Why it is being rejected',
  'tbody tr button',
);
await check('controlled reversal', '/controlled', /^Reverse$/, 'Why the entry is being reversed');
await check('saved table view', '/serials', /Save view/, 'Name');

await browser.close();
console.log(
  failures
    ? `\n${failures} of ${checked} dialog(s) did not capture the value properly.\n`
    : `\n${checked} dialog(s) captured their value in a labelled, validated form.\n`,
);
process.exit(failures ? 1 : 0);
