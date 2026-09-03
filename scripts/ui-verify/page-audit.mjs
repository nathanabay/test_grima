/**
 * What every page does about the things a reader depends on.
 *
 * A static counterpart to the browser sweeps. `verify.mjs` proves a page is
 * legible and `role-flows.mjs` proves the right people can reach it; this asks
 * whether the page, once reached, shows a reader all of their data, tells them
 * when it cannot, captures input in something better than a browser prompt, and
 * says anything when their action succeeds.
 *
 * Every check is a property of the page source, so it runs without a server and
 * gives the same answer on every machine.
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const APP = 'apps/web/app';

function pages(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) pages(full, out);
    else if (entry === 'page.tsx') out.push(full);
  }
  return out;
}

/** The page can walk the server's pages. */
const PAGED = /usePaged[<(]|<Pager\b|\bserver=\{|setPage\(/;
/** The page says out loud that what it shows is a slice of something larger. */
const STATES_CAP = /<MoreMatches\b|of\s*\{"\s*"\}|\bof the\b[\s\S]{0,80}\btoLocaleString\(\)/;

const CHECKS = [
  {
    key: 'unreachable-rows',
    label: 'fetches a capped page and offers no way to the rest',
    /**
     * A cap is only a defect when the reader is left with no route to the rest
     * and no statement that a rest exists. Three things count as a remedy, and
     * all three are things a reader can actually see:
     *
     *  - the page drives a server pager (`usePaged`, `<Pager`, `server={`, or
     *    its own `setPage(`), so the next rows are one click away;
     *  - it renders `<MoreMatches`, which says how many matched beyond the
     *    slice a search-as-you-type dropdown can show;
     *  - it is a deliberate sample that says so, e.g. the dashboard cards that
     *    print "the oldest 8 of 59 waiting" beside a link to the full list.
     */
    test: (s, caps) => caps.length > 0 && !PAGED.test(s) && !STATES_CAP.test(s),
  },
  {
    key: 'lying-pager',
    label: 'DataTable pages only the fetched slice and never says how many exist',
    test: (s, caps) =>
      s.includes('<DataTable') &&
      !/\btotal=|\bserver=/.test(s) &&
      caps.length > 0,
  },
  {
    key: 'browser-prompt',
    label: 'captures input through window.prompt',
    test: (s) => /window\.prompt/.test(s),
  },
  {
    key: 'silent-success',
    label: 'changes data and confirms nothing',
    /**
     * `toast()` is confirmation, and so is a receipt or result panel the
     * action produces — the till showing a receipt is not silent — and so is
     * an `onMessage` prop handed to a child that raises it. Counting only
     * `setMessage(` reported eleven screens as silent that say so plainly.
     */
    test: (s) =>
      /method: ["'](POST|PATCH|PUT|DELETE)/.test(s) &&
      !/setMessage\(|\btoast\(|setReceipt\(|setResult\(|onMessage\(/.test(s),
  },
  {
    key: 'no-empty-state',
    label: 'renders nothing explanatory when it has nothing to show',
    /**
     * `DataTable`'s own `empty=` is an empty state, and a page that fetches no
     * list — a sign-in form, an import wizard, a redirect — has no "nothing to
     * show" to explain. Flagging those asked for a message that would never
     * render.
     */
    test: (s) =>
      /useApi|usePaged/.test(s) && !/<Empty|<EmptyState|\bempty=/.test(s),
  },
  {
    key: 'no-error-state',
    label: 'has no way to show a failed request',
    /**
     * A page whose only request lives in a child component — `/scan` and its
     * `<Scanner>` — shows the failure through that child. What matters is that
     * the reader sees it, not which file renders it.
     */
    test: (s) =>
      /useApi|usePaged|await api\(/.test(s) &&
      !/<ErrorBox|<ErrorState/.test(s),
  },
  {
    key: 'field-error-unused',
    label: 'has a form but never marks the field that was rejected',
    /**
     * Three things this must not confuse with a form:
     *
     *  - a page that defines its own local `Field` for read-only detail rows
     *    (`/products`), which has no input to mark;
     *  - `Field` around a filter (`/batches`, `/inventory`), which the server
     *    never rejects because nothing is submitted;
     *  - a `<Field>` opening tag spread over several lines, which the old
     *    single-line pattern read as having no `error` prop even when it did.
     */
    test: (s) => {
      if (!/<Field\b/.test(s)) return false;
      if (/function Field\(/.test(s)) return false;
      // No submission means nothing for the server to reject.
      if (!/method: ["'](POST|PATCH|PUT)/.test(s)) return false;
      return !/<Field\b[\s\S]{0,400}?\berror=/.test(s);
    },
  },
];

/**
 * Each check, against a page that has the defect and one that does not.
 *
 * The checks were widened to stop reporting screens that were in fact fine —
 * a `toast()` is confirmation, a `DataTable empty=` is an empty state, a
 * `<Field>` around a filter has nothing to reject. Widening a check is how a
 * measurement quietly becomes a rubber stamp, so each one is exercised here on
 * both answers before it is trusted on the real pages.
 */
const SELF_TEST = {
  'unreachable-rows': {
    bad: 'const a = useApi("/x?pageSize=25");',
    good: 'const a = usePaged("/x", { pageSize: 25 }); <Pager />',
  },
  'lying-pager': {
    bad: '<DataTable rows={r} /> useApi("/x?pageSize=25")',
    good: '<DataTable rows={r} server={p.server} /> useApi("/x?pageSize=25")',
  },
  'browser-prompt': {
    bad: 'const v = window.prompt("why?");',
    good: 'const v = await prompt({ fields: [] });',
  },
  'silent-success': {
    bad: 'await api("/x", { method: "POST" });',
    good: 'await api("/x", { method: "POST" }); toast("Saved", "ok");',
  },
  'no-empty-state': {
    bad: 'const list = useApi("/x"); list.data.map(Boolean)',
    good: 'const list = useApi("/x"); <EmptyState title="Nothing yet" />',
  },
  'no-error-state': {
    bad: 'const list = useApi("/x");',
    good: 'const list = useApi("/x"); <ErrorBox message={list.error} />',
  },
  'field-error-unused': {
    bad: '<Field label="Name"><input /></Field> api("/x", { method: "POST" })',
    good: '<Field label="Name" error={e}><input /></Field> api("/x", { method: "POST" })',
  },
};

for (const { key, test } of CHECKS) {
  const sample = SELF_TEST[key];
  if (!sample) throw new Error(`No self-test for check "${key}"`);
  const capsOf = (src) =>
    [...src.matchAll(/(?:pageSize|limit)=(\d+)/g)].map((m) => Number(m[1]));
  if (!test(sample.bad, capsOf(sample.bad))) {
    throw new Error(`Check "${key}" no longer catches the defect it names`);
  }
  if (test(sample.good, capsOf(sample.good))) {
    throw new Error(`Check "${key}" reports a page that has the remedy`);
  }
}

const found = {};
const rows = [];
for (const file of pages(APP).sort()) {
  const route = file.replace(APP, '').replace('/page.tsx', '') || '/';
  const source = readFileSync(file, 'utf8');
  const caps = [...source.matchAll(/(?:pageSize|limit)=(\d+)/g)].map((m) => Number(m[1]));
  const hits = CHECKS.filter((c) => c.test(source, caps)).map((c) => c.key);
  for (const h of hits) (found[h] ??= []).push(route);
  rows.push({ route, hits, cap: caps.length ? Math.max(...caps) : null });
}

console.log(`\n${rows.length} page(s) examined\n`);
for (const { key, label } of CHECKS) {
  const list = found[key] ?? [];
  console.log(`${String(list.length).padStart(3)}  ${label}`);
  if (list.length) console.log(`     ${list.join(', ')}`);
}

// The checks above are per page, not per fetch: a page that pages one list
// passes even if a second list on it still caps. So the caps that survive are
// listed rather than declared absent, and each was read by hand — they are
// search-as-you-type dropdowns that say how many matched, deliberate samples
// that say so beside a link to the full list, or a probe that reads only a
// total. Anything appearing here that is none of those is a defect.
const stillCapped = rows.filter((r) => r.cap !== null);
if (stillCapped.length) {
  console.log(
    `\n${stillCapped.length} page(s) still cap a fetch, each stating the limit or paging past it:`,
  );
  console.log(
    `     ${stillCapped.map((r) => `${r.route} (${r.cap})`).join(', ')}`,
  );
}

const affected = rows.filter((r) => r.hits.length).length;
console.log(`\n${affected} of ${rows.length} page(s) carry at least one.\n`);
// Reporting only: this is a standing measurement, not a gate, so it does not
// fail a build. The gates are verify.mjs, role-flows.mjs and link-check.mjs.
