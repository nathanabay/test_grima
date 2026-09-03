/**
 * What a reader can actually see and do on every page.
 *
 * `verify.mjs` proves a page is legible: contrast, focus, overflow, headings.
 * It does not ask whether the page shows the reader all their data, tells them
 * when it does not, or gives them a way to the rest. This does.
 *
 * For each page it records how many rows are rendered, whether a pager exists
 * and what it claims, how many controls are reachable, and whether the page
 * says anything at all when it has nothing to show.
 */
import { chromium } from 'playwright';

const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const WEB = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
const API = process.env.API_ORIGIN ?? 'http://localhost:4000/api';
const USER = process.env.VERIFY_USER ?? 'admin';

const PAGES = [
  '/dashboard', '/command-center', '/dispensing', '/patients', '/controlled',
  '/inventory', '/products', '/batches', '/inventory/expiry', '/counts',
  '/adjustments', '/serials', '/scan', '/procurement', '/suppliers', '/receiving',
  '/invoices', '/warehouse', '/transfers', '/pos', '/pricing', '/quality',
  '/cold-chain', '/returns', '/damage', '/recalls', '/disposal', '/approvals',
  '/accounting', '/reports', '/reports/builder', '/forecast', '/admin',
  '/admin/settings', '/automation', '/admin/integrations', '/admin/jobs',
  '/import', '/notifications',
];

const browser = await chromium.launch({ executablePath: CHROMIUM });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
const auth = await (
  await page.request.post(`${API}/auth/login`, {
    data: { identifier: USER, password: 'PharmaCore#2026' },
  })
).json();
await page.evaluate((a) => {
  localStorage.setItem('pharmacore.access', a.accessToken);
  localStorage.setItem('pharmacore.refresh', a.refreshToken);
  localStorage.setItem('pharmacore.user', JSON.stringify(a.user));
}, auth);

const findings = [];
console.log(
  `${'page'.padEnd(20)}${'rows'.padStart(5)}${'pager'.padStart(7)}${'claims'.padStart(16)}${'actions'.padStart(8)}  notes`,
);

for (const href of PAGES) {
  await page.goto(`${WEB}${href}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(700);

  // One pass in the page: many small locator queries are far slower and this
  // needs to run over forty screens.
  const { rows, pager, claim, actions, body } = await page.evaluate(() => {
    const text = document.querySelector('main')?.innerText ?? '';
    const buttons = [...document.querySelectorAll('button, a[href]')];
    const hasNext = buttons.some((b) => /^(next|next page)$/i.test(b.textContent?.trim() ?? ''));
    // "25 of 119" is the honest form; "119 products" is the weaker one.
    const of = text.match(/\b\d[\d,]*\s+of\s+[\d,]+/);
    const counted = text.match(/\b[\d,]{2,}\s+(?:stock positions?|batches|patients?|products?|records?|results?|prescriptions?|suppliers?)\b/i);
    return {
      rows: document.querySelectorAll('tbody tr').length,
      pager: hasNext,
      claim: (of?.[0] ?? counted?.[0] ?? '').trim(),
      actions: buttons.filter((b) => b.offsetParent !== null).length,
      body: text,
    };
  });

  const notes = [];
  // A table that fills its cap exactly is the shape of a truncated list.
  if (rows > 0 && !pager && [10, 15, 20, 25, 50, 100, 200].includes(rows)) {
    notes.push(`shows exactly ${rows} — the fetch cap — with no way to the rest`);
    findings.push({ href, kind: 'truncated' });
  }
  if (pager && !/\bof\s+[\d,]{2,}/.test(claim)) {
    notes.push('pager present but nothing says how many rows exist in total');
    findings.push({ href, kind: 'pager-without-total' });
  }
  if (rows === 0 && body.trim().length < 200) {
    notes.push('nothing rendered and nothing explaining why');
    findings.push({ href, kind: 'blank' });
  }

  console.log(
    `${href.padEnd(20)}${String(rows).padStart(5)}${String(pager).padStart(7)}${claim.trim().slice(0, 15).padStart(16)}${String(actions).padStart(8)}  ${notes.join('; ')}`,
  );
}

await browser.close();

const byKind = {};
for (const f of findings) (byKind[f.kind] ??= []).push(f.href);
console.log('\nSUMMARY');
for (const [kind, pages] of Object.entries(byKind)) {
  console.log(`  ${String(pages.length).padStart(3)}  ${kind}: ${pages.join(', ')}`);
}
console.log(`\n${findings.length} page(s) with a data-completeness problem\n`);
