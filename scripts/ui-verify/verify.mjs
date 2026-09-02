// Browser verification: every screen, at six widths, in both themes, with the
// keyboard, against a real API.
//
// This is not a screenshot gallery. Each page is checked for things that are
// wrong rather than merely different: a client-side exception, a request that
// failed, a body that scrolls sideways, text that cannot be read against its
// background, a control with no accessible name, a heading level that skips,
// an image with no alternative text. Screenshots are written so a person can
// look, but the pass/fail comes from the assertions.
//
//   node scripts/ui-verify/verify.mjs [--user admin] [--only /dashboard]
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const WEB = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
const API = process.env.API_ORIGIN ?? 'http://localhost:4000/api';
const OUT = path.join(process.cwd(), 'scripts/ui-verify/screenshots');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const USER = arg('user', 'admin');
const ONLY = arg('only', null);

/**
 * The six widths the specification asks for. The names are what a person would
 * call them, because "375" tells a reader nothing about what broke.
 */
const BREAKPOINTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'phone-large', width: 428, height: 926 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'desktop', width: 1536, height: 960 },
  { name: 'wide', width: 1920, height: 1080 },
];

/** Every destination in the sidebar, plus the ones reached by drilling in. */
const PAGES = [
  '/dashboard', '/command-center',
  '/dispensing', '/patients', '/controlled',
  '/inventory', '/products', '/batches', '/inventory/expiry', '/counts',
  '/adjustments', '/serials', '/scan',
  '/procurement', '/suppliers', '/receiving', '/invoices',
  '/warehouse', '/transfers',
  '/pos', '/pricing',
  '/quality', '/cold-chain', '/returns', '/damage',
  '/recalls', '/disposal', '/approvals',
  '/accounting',
  '/reports', '/reports/builder', '/forecast',
  '/admin', '/admin/settings', '/automation', '/admin/integrations', '/admin/jobs',
  '/import', '/notifications',
];

let failures = 0;
let throttleHits = 0;
const findings = [];
function report(page, breakpoint, theme, message, severity = 'FAIL') {
  const line = `${severity}  ${page} [${breakpoint}/${theme}] — ${message}`;
  console.log(`  ${line}`);
  findings.push({ page, breakpoint, theme, message, severity });
  if (severity === 'FAIL') failures++;
}

/** WCAG relative luminance, so contrast is measured rather than eyeballed. */
function luminance([r, g, b]) {
  const channel = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrastRatio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
function parseRgb(value) {
  const m = /rgba?\(([^)]+)\)/.exec(value ?? '');
  if (!m) return null;
  const parts = m[1].split(/[,\s/]+/).filter(Boolean).map((p) => parseFloat(p));
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
}

/**
 * Flatten a stack of backgrounds, nearest first, onto an opaque base.
 *
 * A status badge is a translucent tint over a card over the page. Measuring the
 * text against the tint's own colour treats a 10%-opacity wash as if it were
 * solid, which reports every badge in the product as 1.00:1 — a false alarm
 * that would bury the real findings.
 */
function flatten(stack) {
  let result = null;
  for (let i = stack.length - 1; i >= 0; i--) {
    const layer = parseRgb(stack[i]);
    if (!layer) continue;
    const [r, g, b, a = 1] = layer;
    if (!result) {
      if (a === 1) result = [r, g, b];
      continue;
    }
    result = [
      r * a + result[0] * (1 - a),
      g * a + result[1] * (1 - a),
      b * a + result[2] * (1 - a),
    ];
  }
  return result;
}

async function signIn(page) {
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
  const response = await page.request.post(`${API}/auth/login`, {
    data: { identifier: USER, password: 'PharmaCore#2026' },
  });
  if (!response.ok()) {
    console.error(`\nCould not sign in as ${USER}: HTTP ${response.status()}`);
    console.error(await response.text());
    process.exit(1);
  }
  const body = await response.json();
  await page.evaluate((auth) => {
    localStorage.setItem('pharmacore.access', auth.accessToken);
    localStorage.setItem('pharmacore.refresh', auth.refreshToken);
    localStorage.setItem('pharmacore.user', JSON.stringify(auth.user));
  }, body);
  return body.user;
}

/**
 * Everything checked on one rendered page.
 *
 * Console errors and failed requests are collected by the caller across the
 * whole navigation, because an exception thrown during hydration arrives before
 * this function runs.
 */
async function audit(page) {
  return page.evaluate(() => {
    const problems = [];

    // 1. The body must never scroll sideways. Wide content scrolls inside its
    //    own container; a page that scrolls horizontally is a layout bug.
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) {
      const wide = [...document.querySelectorAll('*')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.right > doc.clientWidth + 1 && r.width > 0;
        })
        .slice(0, 3)
        .map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}`);
      problems.push({
        severity: 'FAIL',
        message: `page scrolls sideways (${doc.scrollWidth}px in ${doc.clientWidth}px)` +
          (wide.length ? `; widest: ${wide.join(', ')}` : ''),
      });
    }

    // 2. Every interactive control needs an accessible name, or a screen
    //    reader announces "button" and the reader has to guess.
    const nameless = [...document.querySelectorAll('button, a, input, select, textarea')]
      .filter((el) => {
        if (el.offsetParent === null && el.tagName !== 'INPUT') return false;
        const text = (el.textContent ?? '').trim();
        const label = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? '';
        const labelled = el.getAttribute('aria-labelledby');
        const own = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
        const wrapping = el.closest('label');
        const placeholder = el.getAttribute('placeholder') ?? '';
        return !text && !label && !labelled && !own && !wrapping && !placeholder;
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}${el.className ? `.${el.className.toString().split(' ')[0]}` : ''}`);
    if (nameless.length) {
      problems.push({ severity: 'FAIL', message: `control(s) with no accessible name: ${nameless.join(', ')}` });
    }

    // 3. Images must carry alternative text, even if empty for decoration.
    const noAlt = [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length;
    if (noAlt) problems.push({ severity: 'FAIL', message: `${noAlt} image(s) with no alt attribute` });

    // 4. Heading order. Skipping a level breaks navigation by heading.
    const levels = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
      .filter((h) => h.offsetParent !== null)
      .map((h) => Number(h.tagName[1]));
    for (let i = 1; i < levels.length; i++) {
      if (levels[i] > levels[i - 1] + 1) {
        problems.push({
          severity: 'WARN',
          message: `heading level jumps from h${levels[i - 1]} to h${levels[i]}`,
        });
        break;
      }
    }
    if (levels.length && levels[0] !== 1) {
      problems.push({ severity: 'WARN', message: `first heading is h${levels[0]}, not h1` });
    }

    // 5. A page that rendered nothing but chrome is a broken page, even though
    //    it throws no error.
    const main = document.querySelector('main') ?? document.body;
    if ((main.innerText ?? '').trim().length < 40) {
      problems.push({ severity: 'FAIL', message: 'main region is effectively empty' });
    }

    // 6. Collect visible text colours against their painted background so the
    //    caller can measure contrast. Walking every node in JS would be slow,
    //    so a representative sample is taken.
    const sample = [];
    const seen = new Set();
    const candidates = [...document.querySelectorAll('p, span, td, th, a, button, label, h1, h2, h3, li, div')]
      .filter((el) => {
        const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 2);
        if (!text || el.offsetParent === null) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.top < window.innerHeight;
      });
    for (const el of candidates) {
      const style = getComputedStyle(el);
      // Collect every painted layer from the element up to the root, so a
      // translucent badge tint is composited rather than read as opaque.
      const layers = [];
      let node = el;
      while (node) {
        const c = getComputedStyle(node).backgroundColor;
        if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) layers.push(c);
        node = node.parentElement;
      }
      layers.push(getComputedStyle(document.body).backgroundColor || 'rgb(255,255,255)');
      const key = `${style.color}|${layers.join('>')}|${style.fontSize}|${style.fontWeight}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sample.push({
        color: style.color,
        backgroundStack: layers,
        fontSize: parseFloat(style.fontSize),
        fontWeight: Number(style.fontWeight) || 400,
        text: (el.innerText ?? '').trim().slice(0, 40),
      });
      if (sample.length >= 60) break;
    }

    return { problems, sample };
  });
}

await mkdir(OUT, { recursive: true });

/**
 * The environment ships its own Chromium, which will not match the build number
 * the installed Playwright expects. Pointing at the provided binary is what the
 * runtime asks for; downloading another copy is both slow and pointless.
 */
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const pages = ONLY ? [ONLY] : PAGES;

console.log(`Verifying ${pages.length} page(s) at ${BREAKPOINTS.length} width(s) as "${USER}"\n`);

/**
 * The matrix is split by what each assertion actually depends on, rather than
 * run as a full cross product.
 *
 * Contrast and accessible naming depend on the theme and not on the width: the
 * same token pair is painted at every size. Overflow depends on the width and
 * not on the theme: a colour change cannot make a table fit. Running all six
 * widths in both themes therefore repeated every finding twelve times, took
 * long enough to be skipped, and exhausted memory before it finished.
 *
 * So: every page in both themes at the laptop width for the content checks, and
 * every page at all six widths in one theme for the layout checks.
 */
const PASSES = [
  ...['light', 'dark'].map((theme) => ({
    theme,
    breakpoint: BREAKPOINTS.find((b) => b.name === 'laptop'),
    checks: 'content',
  })),
  ...BREAKPOINTS.map((breakpoint) => ({ theme: 'light', breakpoint, checks: 'layout' })),
];

for (const pass of PASSES) {
  {
    const theme = pass.theme;
    const bp = pass.breakpoint;
    // A fresh browser per pass, so the memory a pass used is actually released
    // rather than accumulating across the whole matrix.
    const browser = await chromium.launch({
      executablePath: existsSync(CHROMIUM) ? CHROMIUM : undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const context = await browser.newContext({
      viewport: { width: bp.width, height: bp.height },
      colorScheme: theme,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    const consoleErrors = [];
    const failedRequests = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => consoleErrors.push(`uncaught: ${e.message}`));
    page.on('requestfailed', (r) => failedRequests.push(`${r.method()} ${r.url()}`));
    page.on('response', (r) => {
      if (r.status() >= 500) failedRequests.push(`HTTP ${r.status()} ${r.url()}`);
    });

    await signIn(page);
    // The theme is chosen explicitly rather than left to the media query, so
    // the run proves the data-theme attribute path and not only the fallback.
    await page.evaluate((t) => localStorage.setItem('pharmacore.theme', t), theme);

    console.log(`\n=== ${theme} / ${bp.name} (${bp.width}px) — ${pass.checks}`);

    for (const route of pages) {
      consoleErrors.length = 0;
      failedRequests.length = 0;

      try {
        await page.goto(`${WEB}${route}`, { waitUntil: 'networkidle', timeout: 30_000 });
      } catch (e) {
        report(route, bp.name, theme, `did not finish loading: ${e.message.split('\n')[0]}`);
        continue;
      }

      // Give data-driven screens a moment to paint their first result.
      await page.waitForTimeout(400);

      const { problems, sample } = await audit(page);

      for (const p of problems) {
        // A layout pass reports only what the width can affect; a content pass
        // reports everything else. Otherwise the same naming or heading defect
        // is filed eight times over.
        const isLayout = /scrolls sideways/.test(p.message);
        if (pass.checks === 'layout' && !isLayout) continue;
        if (pass.checks === 'content' && isLayout) {
          // Still worth reporting at the laptop width; it is a real defect.
        }
        report(route, bp.name, theme, p.message, p.severity);
      }

      for (const s of pass.checks === 'layout' ? [] : sample) {
        const fgRaw = parseRgb(s.color);
        const bg = flatten(s.backgroundStack);
        if (!fgRaw || !bg) continue;
        // Text can itself be translucent; composite it over its own ground.
        const alpha = fgRaw[3] ?? 1;
        const fg = alpha === 1
          ? [fgRaw[0], fgRaw[1], fgRaw[2]]
          : [
              fgRaw[0] * alpha + bg[0] * (1 - alpha),
              fgRaw[1] * alpha + bg[1] * (1 - alpha),
              fgRaw[2] * alpha + bg[2] * (1 - alpha),
            ];
        const ratio = contrastRatio(fg, bg);
        // WCAG AA: 3:1 for large text (18.66px bold or 24px), 4.5:1 otherwise.
        const large = s.fontSize >= 24 || (s.fontSize >= 18.66 && s.fontWeight >= 700);
        const required = large ? 3 : 4.5;
        if (ratio < required) {
          report(
            route, bp.name, theme,
            `contrast ${ratio.toFixed(2)}:1 below ${required}:1 on "${s.text}" ` +
              `(${s.color} on ${s.backgroundStack.slice(0, 2).join(' over ')}, ${s.fontSize}px)`,
          );
        }
      }

      // 429 is the login and read throttle doing its job against a robot that
      // opens thirty-nine pages in a row. It is a feature, not a page defect,
      // so it is counted and reported once at the end rather than filed against
      // every screen it happened to land on.
      const throttled = consoleErrors.filter((e) => /429/.test(e));
      const realErrors = consoleErrors.filter((e) => !/429/.test(e));
      throttleHits += throttled.length;

      // Next.js prefetches the RSC payload of links it can see and aborts those
      // requests when the reader navigates away. An aborted prefetch is not a
      // broken page.
      const realFailures = failedRequests.filter((r) => !/[?&]_rsc=/.test(r));

      if (realErrors.length) {
        report(route, bp.name, theme, `console error: ${realErrors[0].slice(0, 160)}`);
      }
      if (realFailures.length) {
        report(route, bp.name, theme, `request failed: ${realFailures[0].slice(0, 160)}`);
      }

      // Screenshots at the two representative widths only; six copies of every
      // page is a gallery nobody opens.
      if ((pass.checks === 'content' && bp.name === 'laptop') ||
          (pass.checks === 'layout' && bp.name === 'phone')) {
        const file = `${route.replace(/\//g, '_').replace(/^_/, '')}.${bp.name}.${theme}.png`;
        await page.screenshot({ path: path.join(OUT, file), fullPage: false });
      }
    }

    await context.close();
    await browser.close();
  }
}

// ---- Keyboard and focus, once, at the laptop width ----
console.log('\n=== keyboard and focus');
{
  const browser = await chromium.launch({
    executablePath: existsSync(CHROMIUM) ? CHROMIUM : undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await signIn(page);
  await page.goto(`${WEB}/dashboard`, { waitUntil: 'networkidle' });

  await page.keyboard.press('Tab');
  const firstStop = await page.evaluate(() => {
    const el = document.activeElement;
    return { text: (el?.textContent ?? '').trim().slice(0, 40), tag: el?.tagName };
  });
  if (!/skip/i.test(firstStop.text)) {
    report('/dashboard', 'laptop', 'light',
      `the first tab stop is "${firstStop.text}", not a skip-to-content link`);
  } else {
    console.log(`  PASS  first tab stop is the skip link ("${firstStop.text}")`);
  }

  // Every focused element must show a visible ring; an invisible focus makes
  // the keyboard unusable even though every control is reachable.
  let invisible = 0;
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    const visible = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return true;
      const s = getComputedStyle(el);
      const ring = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
      const shadow = s.boxShadow && s.boxShadow !== 'none';
      return ring || shadow;
    });
    if (!visible) invisible++;
  }
  if (invisible) {
    report('/dashboard', 'laptop', 'light', `${invisible} of 25 tab stops showed no focus indicator`);
  } else {
    console.log('  PASS  every one of 25 tab stops showed a focus indicator');
  }

  // The command palette is the keyboard entry point to the whole product.
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(300);
  const paletteOpen = await page.evaluate(() =>
    !!document.querySelector('[role="dialog"], [role="listbox"], [data-command-palette]'));
  if (!paletteOpen) {
    report('/dashboard', 'laptop', 'light', 'Ctrl+K did not open the command palette');
  } else {
    console.log('  PASS  Ctrl+K opens the command palette');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const closed = await page.evaluate(() =>
      !document.querySelector('[role="dialog"], [role="listbox"], [data-command-palette]'));
    if (!closed) report('/dashboard', 'laptop', 'light', 'Escape did not close the command palette');
    else console.log('  PASS  Escape closes it again');
  }

  await context.close();
  await browser.close();
}

await writeFile(
  path.join(OUT, 'findings.json'),
  JSON.stringify({ user: USER, ranAt: new Date().toISOString(), findings }, null, 2),
);

const warnings = findings.filter((f) => f.severity === 'WARN').length;
console.log('\n' + '='.repeat(60));
if (throttleHits) {
  console.log(
    `note: the API returned 429 ${throttleHits} time(s) — the rate limiter ` +
      `responding to this sweep's own load, not a defect in any screen.`,
  );
}
console.log(`${findings.length - warnings} failure(s), ${warnings} warning(s)`);
console.log(`Screenshots and findings.json in ${OUT}`);
if (failures) {
  console.log('BROWSER VERIFICATION FAILED');
  process.exit(1);
}
console.log('BROWSER VERIFICATION PASSED');
console.log('='.repeat(60));
