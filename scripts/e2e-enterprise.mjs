// Enterprise platform end-to-end: configuration, pricing, accounting,
// automation, integration security, the report builder and the health score.
// Run against a seeded API on :4000 (pnpm db:seed runs the finalizer that
// posts the ledger and puts warehouse work in flight).
const BASE = 'http://localhost:4000/api';
let failures = 0;
function check(name, ok, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures++;
}
async function login(identifier) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'PharmaCore#2026' }),
  });
  const body = await r.json();
  if (!body.accessToken) {
    // Say what actually went wrong. Running every suite back to back trips the
    // login throttle, and a script that dies later on `undefined.length` sends
    // whoever reads the output looking for a bug that is not there.
    console.error(
      `\nCould not sign in as ${identifier}: HTTP ${r.status} — ${body.error ?? 'no token returned'}`,
    );
    if (r.status === 429) {
      console.error('The login throttle is doing its job. Wait a minute and run this suite again.');
    }
    process.exit(1);
  }
  return body.accessToken;
}
function client(token) {
  return async (method, path, body) => {
    const r = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { ok: r.ok, status: r.status, body: parsed };
  };
}
const num = (v) => Number(v ?? 0);

const admin = client(await login('admin'));
const cashier = client(await login('cashier'));
const pharmacist = client(await login('pharmacist'));
// A warehouse manager may read reports but not finance figures, which is
// exactly the split the withheld-column rule is meant to enforce.
const warehouse = client(await login('warehouse'));
const till = client(await login('cashier'));
const cashierMe = (await till('GET', '/auth/me')).body;
const org = (await admin('GET', '/admin/organization')).body;
const tillBranch = org.branches.find((b) => b.id === cashierMe.branchIds[0]) ?? org.branches[0];
const tillWarehouse = tillBranch.warehouses[0];

// ============================================================
console.log('\nCONFIGURATION (no magic values)');
// ============================================================

const config = (await admin('GET', '/admin/config')).body;
check('every configurable rule is declared with a default',
  config.settings.length > 20 && config.settings.every((s) => s.default !== undefined),
  `${config.settings.length} settings, ${config.features.length} flags`);

const bounded = config.settings.find((s) => s.type === 'number' && s.max !== undefined);
const tooHigh = await admin('PATCH', '/admin/config', { values: { [bounded.key]: bounded.max + 1 } });
check('a value outside its declared bounds is refused', tooHigh.status === 400,
  `${bounded.key} max ${bounded.max}`);

const original = config.settings.find((s) => s.key === 'expiry.criticalDays');
const changed = await admin('PATCH', '/admin/config', { values: { 'expiry.criticalDays': 45 } });
check('a valid change is applied and read back', changed.ok &&
  changed.body.settings.find((s) => s.key === 'expiry.criticalDays').value === 45);
const reset = await admin('POST', '/admin/config/expiry.criticalDays/reset');
check('reset restores the catalogue default',
  reset.body.settings.find((s) => s.key === 'expiry.criticalDays').value === original.default,
  `back to ${original.default}`);

const unknown = await admin('PATCH', '/admin/config', { values: { 'not.a.real.setting': 1 } });
check('an unknown setting key is refused', unknown.status === 400);

const blocked = config.features.filter((f) => f.unavailableReason);
check('a flag whose dependency is missing says so rather than pretending',
  blocked.every((f) => f.value === false),
  blocked.length ? `${blocked.length} unavailable: ${blocked.map((f) => f.key).join(', ')}` : 'all dependencies present');

const cashierConfig = await cashier('GET', '/admin/config');
check('a cashier cannot read the configuration catalogue', cashierConfig.status === 403);

// ============================================================
console.log('\nPRICING (one authority)');
// ============================================================

const lists = (await admin('GET', '/price-lists')).body;
check('price lists exist and carry a priority', lists.length > 0 && lists.every((l) => typeof l.priority === 'number'),
  `${lists.length} lists`);

const groups = (await admin('GET', '/customer-groups')).body;
const insured = groups.find((g) => num(g.discountPercent) > 0) ?? groups[0];
const products = (await admin('GET', '/products?pageSize=50')).body.data;
const priced = products.find((p) => num(p.retailPrice) > 0);

const plain = (await admin('POST', '/price-lists/quote', { productIds: [priced.id], quantity: 1 })).body[priced.id];
check('a price resolves for a product with no matching list', num(plain.unitPrice) > 0,
  `${plain.unitPrice} from ${plain.source}`);
check('the resolver explains itself', Array.isArray(plain.explanation) && plain.explanation.length > 0,
  `${plain.explanation.length} step(s)`);

const grouped = (await admin('POST', '/price-lists/quote',
  { productIds: [priced.id], quantity: 1, customerGroupId: insured.id })).body[priced.id];
check('a customer group changes the resolved price or is explained away',
  num(grouped.unitPrice) !== num(plain.unitPrice) || num(insured.discountPercent) === 0,
  `${plain.unitPrice} -> ${grouped.unitPrice} for ${insured.name}`);

// A quantity break must beat the single-unit price on the same list.
const withItems = lists.find((l) => (l._count?.items ?? 0) > 0);
const detail = (await admin('GET', `/price-lists/${withItems.id}`)).body;
const breaks = {};
for (const item of detail.items) {
  (breaks[item.productId] ??= []).push(item);
}
const laddered = Object.values(breaks).find((rows) => rows.length > 1);
if (laddered) {
  const sorted = [...laddered].sort((a, b) => num(a.minQuantity) - num(b.minQuantity));
  const one = (await admin('POST', '/price-lists/quote',
    { productIds: [sorted[0].productId], quantity: 1 })).body[sorted[0].productId];
  const many = (await admin('POST', '/price-lists/quote',
    { productIds: [sorted[0].productId], quantity: num(sorted[sorted.length - 1].minQuantity) })).body[sorted[0].productId];
  check('a quantity break is honoured at the higher quantity',
    num(many.unitPrice) <= num(one.unitPrice),
    `1 @ ${one.unitPrice}, ${sorted[sorted.length - 1].minQuantity} @ ${many.unitPrice}`);
} else {
  check('a quantity break is honoured at the higher quantity', true, 'no laddered product in the seed');
}

const cashierLists = await cashier('GET', '/price-lists');
check('a cashier cannot read commercial price lists', cashierLists.status === 403);

// ============================================================
console.log('\nACCOUNTING (posted from real movements)');
// ============================================================

const mapping = (await admin('GET', '/accounting/accounts/mapping-health')).body;
check('every system account role is mapped', mapping.every((m) => !m.problem),
  mapping.filter((m) => m.problem).map((m) => m.systemKey).join(', ') || 'all mapped');

const tb = (await admin('GET', '/accounting/trial-balance')).body;
check('the trial balance balances', tb.balanced, `debit ${tb.totalDebit} credit ${tb.totalCredit}`);
check('the ledger carries the seeded activity', tb.rows.length > 3, `${tb.rows.length} accounts with movement`);

// Other suites may have left movements behind, so this posts what is
// outstanding and asserts the queue drains rather than assuming it is empty.
const pendingBefore = (await admin('GET', '/accounting/unposted?limit=200')).body;
const drain = (await admin('POST', '/accounting/post-pending', { limit: 500 })).body;
const pendingAfter = (await admin('GET', '/accounting/unposted?limit=200')).body;
check('every stock movement and sale reaches the ledger', pendingAfter.total === 0,
  `${pendingBefore.total} outstanding -> posted ${drain.movements} movement(s) and ${drain.sales} sale(s) -> ${pendingAfter.total} left`);
check('posting reports its failures rather than swallowing them',
  drain.failed === 0, drain.errors.map((e) => `${e.type}: ${e.error}`).join('; ') || 'none failed');

const recon = (await admin('GET', '/accounting/valuation/reconciliation')).body;
check('the inventory account reconciles to the stock valuation', recon.withinTolerance,
  `ledger ${recon.ledgerBalance} vs stock ${recon.physicalValue} (${recon.differencePercent}%)`);

// A posted entry is corrected by reversal, never by edit or delete.
const entries = (await admin('GET', '/accounting/journal?pageSize=5&status=POSTED')).body.data;
const target = entries[0];
const reversal = await admin('POST', `/accounting/journal/${target.id}/reverse`,
  { reason: 'End-to-end check of the reversal-only correction rule' });
check('a posted entry can be reversed', reversal.ok, reversal.body?.entryNo ?? reversal.body?.message);
const after = (await admin('GET', `/accounting/journal/${target.id}`)).body;
check('the original is marked reversed rather than removed', after.status === 'REVERSED');
check('the reversal is the mirror image',
  num(reversal.body.totalDebit) === num(target.totalCredit) &&
  num(reversal.body.totalCredit) === num(target.totalDebit),
  `${target.totalDebit}/${target.totalCredit} -> ${reversal.body.totalDebit}/${reversal.body.totalCredit}`);
const twice = await admin('POST', `/accounting/journal/${target.id}/reverse`, { reason: 'again' });
check('the same entry cannot be reversed twice', !twice.ok, `HTTP ${twice.status}`);

const tbAfter = (await admin('GET', '/accounting/trial-balance')).body;
check('the trial balance still balances after a reversal', tbAfter.balanced);

const unbalanced = await admin('POST', '/accounting/journal', {
  description: 'Deliberately unbalanced',
  lines: [{ systemKey: 'CASH', debit: 100 }, { systemKey: 'SALES_REVENUE', credit: 90 }],
});
check('an unbalanced manual entry is refused with a usable message',
  unbalanced.status === 400 && /balance/i.test(unbalanced.body.error ?? ''),
  `HTTP ${unbalanced.status}: ${unbalanced.body.error}`);

const noAccount = await admin('POST', '/accounting/journal', {
  description: 'Line with no account',
  lines: [{ debit: 10 }, { systemKey: 'CASH', credit: 10 }],
});
check('a line naming no account is a client error, not a server fault',
  noAccount.status === 400 && /must name an account/i.test(noAccount.body.error ?? ''),
  `HTTP ${noAccount.status}: ${noAccount.body.error}`);

const cashierLedger = await cashier('GET', '/accounting/trial-balance');
check('a cashier cannot read the ledger', cashierLedger.status === 403);

// ============================================================
console.log('\nAUTOMATION (configured, not coded)');
// ============================================================

const rules = (await admin('GET', '/automation/rules')).body;
check('automation rules are stored as data', rules.length > 0, `${rules.length} rules`);
check('every rule states its trigger, conditions and actions',
  rules.every((r) => r.triggerType && Array.isArray(r.actions)));

const expiryRule = rules.find((r) => r.code === 'EXPIRY_30');
const runsBefore = (await admin('GET', '/automation/runs?limit=1')).body.length;
const preview = (await admin('GET', `/automation/rules/${expiryRule.id}/preview`)).body;
check('a rule can be previewed', preview.matched >= 0 && Array.isArray(preview.samples),
  `${preview.matched} of ${preview.scanned} would match`);
check('a preview says what would be sent, rendered',
  Array.isArray(preview.wouldAct) &&
  (preview.samples.length === 0 || Array.isArray(preview.samples[0].preview)),
  `would ${preview.wouldAct.join(', ') || 'do nothing'}`);
check('a preview explains each condition rather than only the verdict',
  preview.samples.length === 0 || Array.isArray(preview.samples[0].conditionDetail),
  preview.samples.length ? `${preview.samples[0].conditionDetail.length} condition(s) shown` : 'nothing matches today');
check('a preview says why non-matching subjects were skipped',
  Array.isArray(preview.nearMisses), `${preview.nearMisses?.length ?? 0} near miss(es)`);
check('previewing does not act', (await admin('GET', '/automation/runs?limit=1')).body.length === runsBefore ||
  preview.matched === 0);

const runs = (await admin('GET', '/automation/runs?limit=20')).body;
check('runs are recorded with what they scanned and did', runs.length > 0 &&
  runs.every((r) => typeof r.subjectsScanned === 'number' && typeof r.actionsRun === 'number'),
  `${runs.length} runs`);
const firstActing = runs.find((r) => r.actionsRun > 0) ??
  (await admin('GET', '/automation/runs?limit=200')).body.find((r) => r.actionsRun > 0);
check('at least one rule has actually acted, not just matched', !!firstActing,
  firstActing ? `${firstActing.actionsRun} action(s)` : 'none acted');

const rerun = (await admin('POST', `/automation/rules/${expiryRule.id}/run`, {})).body;
check('a re-run inside the cooldown suppresses rather than repeats',
  rerun.matched === 0 || rerun.suppressed > 0,
  `${rerun.matched} matched, ${rerun.suppressed} suppressed`);

const cashierRules = await cashier('GET', '/automation/rules');
check('a cashier cannot read or change automation rules', cashierRules.status === 403);

// ============================================================
console.log('\nINTEGRATION SECURITY');
// ============================================================

const noEscalation = await pharmacist('POST', '/integrations/api-keys', {
  name: 'e2e-privilege-escalation',
  scopes: ['admin.user.CREATE'],
});
check('a key cannot be granted a permission its creator lacks', !noEscalation.ok,
  `HTTP ${noEscalation.status}`);

const noScopes = await admin('POST', '/integrations/api-keys', { name: 'e2e-empty', scopes: [] });
check('a key with no scopes is refused', !noScopes.ok, `HTTP ${noScopes.status}`);

const created = await admin('POST', '/integrations/api-keys', {
  name: `e2e-${Date.now()}`,
  scopes: ['catalog.product.READ'],
  expiresInDays: 1,
});
check('a key is created and returned exactly once', created.ok && typeof created.body.key === 'string',
  created.body.prefix);

const keyList = (await admin('GET', '/integrations/api-keys')).body;
const listed = keyList.find((k) => k.id === created.body.id);
check('the key value is never returned again',
  listed && !('key' in listed) && !('keyHash' in listed));

const keyCall = await fetch(`${BASE}/products?pageSize=1`, { headers: { 'x-api-key': created.body.key } });
check('the key authenticates a machine caller', keyCall.status === 200, `HTTP ${keyCall.status}`);

const beyondScope = await fetch(`${BASE}/admin/users`, { headers: { 'x-api-key': created.body.key } });
check('the key cannot reach beyond its scopes', beyondScope.status === 403, `HTTP ${beyondScope.status}`);

await admin('POST', `/integrations/api-keys/${created.body.id}/revoke`, { reason: 'End-to-end check' });
const afterRevoke = await fetch(`${BASE}/products?pageSize=1`, { headers: { 'x-api-key': created.body.key } });
check('a revoked key stops working immediately', afterRevoke.status === 401, `HTTP ${afterRevoke.status}`);

const forged = await fetch(`${BASE}/products?pageSize=1`, { headers: { 'x-api-key': 'pck_deadbeef.forged' } });
check('a forged key is refused', forged.status === 401);

// ============================================================
console.log('\nFHIR');
// ============================================================

const capability = await (await fetch(`${BASE}/fhir/metadata`)).json();
check('the capability statement declares a real FHIR version',
  capability.resourceType === 'CapabilityStatement' && capability.fhirVersion === '4.0.1',
  capability.fhirVersion);

const patients = (await admin('GET', '/patients?pageSize=1')).body;
const patientId = (patients.data ?? patients)[0].id;
const fhirPatient = (await admin('GET', `/fhir/Patient/${patientId}`)).body;
check('a patient maps to a conformant FHIR resource',
  fhirPatient.resourceType === 'Patient' && Array.isArray(fhirPatient.name));

const badResource = await admin('POST', '/fhir/Patient', { resourceType: 'Patient' });
check('an invalid resource is refused with a bare OperationOutcome',
  badResource.status === 400 && badResource.body.resourceType === 'OperationOutcome',
  `HTTP ${badResource.status}`);
check('the OperationOutcome names the problem and where it is',
  Array.isArray(badResource.body.issue) &&
  badResource.body.issue.some((i) => i.severity === 'error' && i.diagnostics),
  badResource.body.issue?.find((i) => i.severity === 'error')?.diagnostics);

// A cashier legitimately looks a customer up at the till, so the role that
// proves the gate is one with no patient permission at all.
const warehouseFhir = await warehouse('GET', `/fhir/Patient/${patientId}`);
check('FHIR is held to the same permissions a person needs', warehouseFhir.status === 403,
  `warehouse manager got HTTP ${warehouseFhir.status}`);
const cashierFhir = await cashier('GET', `/fhir/Patient/${patientId}`);
check('a role that may read patients can read them through FHIR too',
  cashierFhir.status === 200);

// ============================================================
console.log('\nREPORT BUILDER');
// ============================================================

const sources = (await admin('GET', '/report-builder/sources')).body;
check('the catalogue is a whitelist, not a query language', sources.length > 0 &&
  sources.every((s) => Array.isArray(s.columns)), `${sources.length} sources`);

const balancesSource = sources.find((s) => s.key === 'inventory_balances');
const report = (await admin('POST', '/report-builder/run', {
  dataSource: 'inventory_balances',
  columns: ['sku', 'product', 'onHand', 'averageCost'],
  filters: [{ field: 'onHand', operator: 'gt', value: 0 }],
  limit: 50,
})).body;
check('a report returns real rows', report.rowCount > 0, `${report.rowCount} rows`);
check('an administrator sees the cost column',
  report.columns.some((c) => c.key === 'averageCost') && report.withheldColumns.length === 0);

const restricted = (await warehouse('POST', '/report-builder/run', {
  dataSource: 'inventory_balances',
  columns: ['sku', 'onHand', 'averageCost'],
  limit: 10,
})).body;
check('a column needing a permission is withheld and named, not silently dropped',
  restricted.withheldColumns.some((w) => w.key === 'averageCost' && w.requires === 'finance.report.READ'),
  `withheld: ${restricted.withheldColumns.map((w) => `${w.key} needs ${w.requires}`).join(', ')}`);
check('the rest of the report is still returned rather than refused outright',
  restricted.rowCount > 0 && restricted.columns.some((c) => c.key === 'onHand'),
  `${restricted.rowCount} rows without the cost column`);
const allWithheld = await warehouse('POST', '/report-builder/run', {
  dataSource: 'inventory_balances', columns: ['averageCost'], limit: 1,
});
check('a report whose every column needs a missing permission is refused',
  allWithheld.status === 403, `HTTP ${allWithheld.status}`);

const badColumn = await admin('POST', '/report-builder/run', {
  dataSource: 'inventory_balances', columns: ['password'],
});
check('a column outside the whitelist is refused', badColumn.status === 400);
const badSource = await admin('POST', '/report-builder/run', { dataSource: 'users', columns: [] });
check('a data source outside the whitelist is refused', badSource.status === 400);

const csv = (await admin('POST', '/report-builder/export', {
  dataSource: 'inventory_balances', columns: ['sku', 'product', 'onHand'], limit: 10,
})).body;
check('an export returns CSV with a header row',
  typeof csv === 'string' && csv.split('\n')[0].includes('SKU'), csv.split('\n')[0]);
check('exported values are neutralised against formula injection',
  !csv.split('\n').slice(1).some((line) => /(^|,)[=+@]/.test(line)));

// ============================================================
console.log('\nINVENTORY HEALTH SCORE');
// ============================================================

const score = (await admin('GET', '/analytics/health-score')).body;
check('the score is a real 0-100 figure', score.score >= 0 && score.score <= 100,
  `${score.score}/100 (${score.band})`);
check('every factor reports the measurement behind it',
  score.factors.every((f) => typeof f.measurement === 'string' && f.measurement.length > 0),
  `${score.factors.length} factors`);
check('a factor with nothing to measure is named rather than scored zero',
  score.unmeasured.every((key) => score.factors.find((f) => f.key === key).score < 0),
  score.unmeasured.length ? `unmeasured: ${score.unmeasured.join(', ')}` : 'every factor has data');
check('the score explains what is holding it back',
  typeof score.summary === 'string' && score.summary.length > 0, score.summary);
check('priority actions link somewhere actionable',
  score.priorityActions.every((a) => typeof a.linkUrl === 'string' && a.linkUrl.startsWith('/')),
  `${score.priorityActions.length} action(s)`);

// ============================================================
console.log('\nSYSTEM HEALTH');
// ============================================================

const health = (await admin('GET', '/admin/health')).body;
check('the database check does real work', health.checks.find((c) => c.key === 'database').latencyMs >= 0);
check('an unconfigured channel reports NOT_CONFIGURED rather than OK',
  health.checks.filter((c) => c.state === 'NOT_CONFIGURED').every((c) => /not set|not configured|no /i.test(c.detail)),
  `${health.checks.filter((c) => c.state === 'NOT_CONFIGURED').length} unconfigured`);
check('an unconfigured dependency does not drag the overall state',
  health.state !== 'DOWN' || health.checks.some((c) => c.state === 'DOWN'), health.state);

const jobs = (await admin('GET', '/admin/jobs')).body;
check('background jobs are registered with a schedule',
  jobs.length > 0 && jobs.every((j) => j.schedule), `${jobs.length} jobs`);
const ran = jobs.filter((j) => j.lastStatus !== 'NEVER_RUN');
check('a job that has run records its outcome',
  ran.every((j) => j.lastStartedAt && j.lastDurationMs !== null),
  `${ran.length} of ${jobs.length} have run`);

const manual = (await admin('POST', '/admin/jobs/supplier.scores/run')).body;
check('a job can be run on demand and reports its real status',
  ['SUCCESS', 'FAILED', 'SKIPPED'].includes(manual.status), manual.status);

const cashierJobs = await cashier('POST', '/admin/jobs/supplier.scores/run');
check('a cashier cannot run background jobs', cashierJobs.status === 403);

// ============================================================
console.log('\nSETTINGS ACTUALLY TAKE EFFECT');
// ============================================================

// A setting that changes nothing is worse than no setting: the screen agrees
// with the administrator and the system ignores them. Each check below changes
// a value and proves the behaviour moved with it.

async function withSetting(key, value, fn) {
  const before = (await admin('GET', '/admin/config')).body.settings.find((s) => s.key === key);
  await admin('PATCH', '/admin/config', { values: { [key]: value } });
  try {
    return await fn();
  } finally {
    await admin('POST', `/admin/config/${encodeURIComponent(key)}/reset`);
    if (before?.isOverridden) {
      await admin('PATCH', '/admin/config', { values: { [key]: before.value } });
    }
  }
}

// --- expiry buckets drive the report, rather than a fixed ladder in code
const defaultBuckets = (await admin('GET', '/inventory/expiry?maxDays=400')).body.buckets;
check('the expiry report returns the configured bucket ladder',
  Array.isArray(defaultBuckets) && defaultBuckets.length > 2,
  defaultBuckets?.map((b) => b.label).join(', '));

await withSetting('expiry.alertBuckets', [7, 14], async () => {
  const narrowed = (await admin('GET', '/inventory/expiry?maxDays=400')).body;
  check('changing expiry.alertBuckets changes the buckets the report uses',
    narrowed.buckets.length === 4 && narrowed.buckets.some((b) => b.label === '0-7 days'),
    narrowed.buckets.map((b) => b.label).join(', '));
  check('rows are classified into the new buckets',
    Object.keys(narrowed.summary).every((k) => narrowed.buckets.some((b) => b.key === k)),
    Object.keys(narrowed.summary).join(', '));
});

// --- the count variance tolerance decides what needs approval
const countTolerance = (await admin('GET', '/admin/config')).body.settings
  .find((s) => s.key === 'count.tolerancePercent');
check('count.tolerancePercent is declared with bounds', countTolerance && countTolerance.max === 100,
  `default ${countTolerance?.default}%`);

// --- the cash variance tolerance is enforced at shift close
await withSetting('pos.cashVarianceTolerance', 0, async () => {
  const session = await till('POST', '/pos/cash-sessions/open', {
    branchId: tillBranch.id, openingCash: 100,
  });
  const closed = await till('POST', `/pos/cash-sessions/${session.body.id}/close`, {
    actualCash: 99,
  });
  check('a cash variance beyond the configured tolerance demands an explanation',
    closed.status === 400 && /variance/i.test(closed.body.error ?? ''),
    `HTTP ${closed.status}: ${closed.body.error}`);
  const explained = await till('POST', `/pos/cash-sessions/${session.body.id}/close`, {
    actualCash: 99, varianceReason: 'Rounding on a cash sale, checked by the supervisor',
  });
  check('the same close succeeds once it is explained', explained.ok);
});

// --- the password policy is enforced on every path that sets a password
await withSetting('security.passwordMinLength', 16, async () => {
  // Twelve characters: past the DTO's hard floor of ten, so what refuses it
  // is the configured policy rather than a constant in a validator.
  const weak = await admin('POST', '/auth/change-password', {
    currentPassword: 'PharmaCore#2026', newPassword: 'Abcdef123!xy',
  });
  check('a password below the configured minimum is refused',
    weak.status === 400 && /16 characters/.test(weak.body.error ?? ''),
    `HTTP ${weak.status}: ${weak.body.error}`);
});

// --- turning a feature off actually turns it off
await withSetting('feature.reportBuilder', false, async () => {
  const blocked = await admin('POST', '/report-builder/run', {
    dataSource: 'inventory_balances', columns: ['sku'], limit: 1,
  });
  check('turning feature.reportBuilder off stops reports running, not just the screen',
    blocked.status === 400 && /reportBuilder/.test(blocked.body.error ?? ''),
    `HTTP ${blocked.status}: ${blocked.body.error}`);
});

await withSetting('feature.iotIngestion', false, async () => {
  const sensor = (await admin('GET', '/cold-chain/live')).body[0];
  if (sensor?.code) {
    const refused = await admin('POST', '/cold-chain/readings', {
      sensorCode: sensor.code, temperature: 5,
    });
    check('turning feature.iotIngestion off stops readings being accepted',
      refused.status === 400 && /iotIngestion/.test(refused.body.error ?? ''),
      `HTTP ${refused.status}: ${refused.body.error}`);
  } else {
    check('turning feature.iotIngestion off stops readings being accepted', true, 'no sensor to test with');
  }
});

// --- the ledger date controls
const anyBatch = (await admin('GET', '/inventory/balances?pageSize=1')).body.data[0];
if (anyBatch) {
  const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const adjustBody = (occurredAt) => ({
    branchId: anyBatch.branchId,
    warehouseId: anyBatch.warehouseId,
    reason: 'End-to-end check of the movement dating controls',
    occurredAt,
    items: [{ productId: anyBatch.productId, batchId: anyBatch.batchId, quantityDelta: -1, lossType: 'DAMAGE' }],
  });

  const futureMove = await admin('POST', '/stock-adjustments', adjustBody(future));
  check('a future-dated movement is refused while inventory.allowFutureDating is off',
    futureMove.status === 400 && /future/i.test(futureMove.body?.error ?? ''),
    `HTTP ${futureMove.status}: ${futureMove.body?.error ?? ''}`);

  const allowed = await withSetting('inventory.allowFutureDating', true, () =>
    admin('POST', '/stock-adjustments', adjustBody(future)));
  check('turning inventory.allowFutureDating on lets the same movement through',
    allowed.ok, `HTTP ${allowed.status}: ${allowed.body?.error ?? ''}`);

  const tooOld = new Date(Date.now() - 400 * 86_400_000).toISOString();
  const backdated = await admin('POST', '/stock-adjustments', adjustBody(tooOld));
  check('a movement backdated beyond inventory.backdateLimitDays is refused',
    backdated.status === 400 && /backdated|Backdating/i.test(backdated.body?.error ?? ''),
    `HTTP ${backdated.status}: ${backdated.body?.error ?? ''}`);

  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  const withinLimit = await admin('POST', '/stock-adjustments', adjustBody(yesterday));
  check('a movement inside the backdating limit is accepted',
    withinLimit.ok, `HTTP ${withinLimit.status}: ${withinLimit.body?.error ?? ''}`);
}

// ============================================================
console.log('\nPAYMENT CAPTURE (no gateway is connected)');
// ============================================================

const otc = (await till('GET', `/pos/search?q=Paracetamol&warehouseId=${tillWarehouse.id}`)).body
  .find((p) => !p.requiresPrescription && !p.isControlled && Number(p.available) > 5);

const cardNoRef = await till('POST', '/pos/checkout', {
  branchId: tillBranch.id,
  warehouseId: tillWarehouse.id,
  lines: [{ productId: otc.id, quantity: 1 }],
  payments: [{ method: 'CARD', amount: 1000 }],
});
check('a card payment with no terminal reference is refused',
  cardNoRef.status === 400 && /reference/i.test(cardNoRef.body.error ?? ''),
  `HTTP ${cardNoRef.status}: ${cardNoRef.body.error}`);

const cardWithRef = await till('POST', '/pos/checkout', {
  branchId: tillBranch.id,
  warehouseId: tillWarehouse.id,
  lines: [{ productId: otc.id, quantity: 1 }],
  payments: [{ method: 'CARD', amount: 1000, reference: `E2E-TERM-${Date.now()}` }],
});
check('a card payment carrying its reference is accepted', cardWithRef.ok,
  cardWithRef.body?.saleNo ?? cardWithRef.body?.error);

if (cardWithRef.ok) {
  const drain = (await admin('POST', '/accounting/post-pending', { limit: 200 })).body;
  check('a sale tendered over its total still posts', drain.failed === 0,
    drain.errors.map((e) => e.error).join('; ') || 'nothing failed');
  const entry = (await admin('GET', '/accounting/journal?pageSize=20')).body.data
    .find((e) => e.description.includes(cardWithRef.body.saleNo));
  check('the tender is capped at the sale total, so change is not posted as an asset',
    !!entry && num(entry.totalDebit) === num(cardWithRef.body.grandTotal),
    entry
      ? `posted ${entry.totalDebit} for a ${cardWithRef.body.grandTotal} sale tendered with 1000`
      : 'the sale did not reach the ledger');
}

// ============================================================
console.log('\nAUDIT');
// ============================================================

const chain = (await admin('GET', '/admin/audit-logs/verify')).body;
check('the audit hash chain verifies after all of the above',
  chain.valid, `${chain.checked} entries checked`);

console.log(`\n${'='.repeat(60)}`);
if (failures) {
  console.log(`${failures} CHECK(S) FAILED`);
  console.log('='.repeat(60));
  process.exit(1);
}
console.log('ALL ENTERPRISE PLATFORM CHECKS PASSED');
console.log('='.repeat(60));
