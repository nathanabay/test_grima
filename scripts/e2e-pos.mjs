// Point of sale end to end: the till's payment paths, guards, cash drawer,
// shift reports and sale retrieval.
//
// Run against a seeded API on :4000.
const BASE = 'http://localhost:4000/api';
let failures = 0;
const skipped = [];
function check(name, ok, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures++;
}
function skip(name, why) {
  console.log(`  SKIP  ${name} -- ${why}`);
  skipped.push({ name, why });
}
async function login(identifier) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'PharmaCore#2026' }),
  });
  const body = await r.json();
  if (!body.accessToken) {
    console.error(`\nCould not sign in as ${identifier}: HTTP ${r.status} — ${body.error ?? 'no token'}`);
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
const key = () => `e2e-pos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const admin = client(await login('admin'));
const cashier = client(await login('cashier'));
const me = (await cashier('GET', '/auth/me')).body;
const org = (await admin('GET', '/admin/organization')).body;
const branch = org.branches.find((b) => me.branchIds.includes(b.id)) ?? org.branches[0];
const warehouse = branch.warehouses.find((w) => !w.isColdRoom) ?? branch.warehouses[0];

// A sellable over-the-counter product with stock.
const searchable = (await cashier('GET', `/pos/search?q=a&warehouseId=${warehouse.id}`)).body;
const otc = (Array.isArray(searchable) ? searchable : []).find(
  (p) => !p.requiresPrescription && !p.isControlled && p.available > 10,
);
if (!otc) {
  console.error('\nNo over-the-counter product with stock in this dataset — cannot exercise the till.');
  process.exit(1);
}

// ============================================================
console.log('\nSHIFT AND CASH DRAWER (§46)');
// ============================================================

let session = (await cashier('GET', `/pos/cash-sessions/current?branchId=${branch.id}`)).body;
if (!session?.id) {
  const opened = await cashier('POST', '/pos/cash-sessions/open', {
    branchId: branch.id, openingCash: 500,
  });
  check('a cash shift opens with a float', opened.ok, `HTTP ${opened.status}: ${opened.body?.error ?? ''}`);
  session = opened.body;
} else {
  check('a cash shift is open', true, session.sessionNo);
}

const xReport = await cashier('GET', `/pos/cash-sessions/${session.id}/report`);
check('an X-report reads the shift without closing it',
  xReport.ok && xReport.body.isOpen === true,
  `expected ${xReport.body?.expectedCash} in the drawer`);

const badMovement = await cashier('POST', `/pos/cash-sessions/${session.id}/movements`, {
  movementType: 'MYSTERY', amount: 10, reason: 'x',
});
check('an unrecognised cash movement type is refused', badMovement.status === 400,
  badMovement.body?.error);

const noReason = await cashier('POST', `/pos/cash-sessions/${session.id}/movements`, {
  movementType: 'DROP', amount: 100, reason: '  ',
});
check('cash leaving the drawer must state why', noReason.status === 400, noReason.body?.error);

const drop = await cashier('POST', `/pos/cash-sessions/${session.id}/movements`, {
  movementType: 'DROP', amount: 100, reason: 'Banked to the safe, counted with the manager',
});
check('a drop to the safe is recorded', drop.ok, `HTTP ${drop.status}`);

const afterDrop = (await cashier('GET', `/pos/cash-sessions/${session.id}/report`)).body;
check('the drop reduces what should be in the drawer',
  Number(afterDrop.expectedCash) === Number(xReport.body.expectedCash) - 100,
  `${xReport.body.expectedCash} -> ${afterDrop.expectedCash}`);

const topUp = await cashier('POST', `/pos/cash-sessions/${session.id}/movements`, {
  movementType: 'FLOAT_IN', amount: 50, reason: 'Change brought from the safe',
});
const afterTopUp = (await cashier('GET', `/pos/cash-sessions/${session.id}/report`)).body;
check('a float top-up increases it again',
  topUp.ok && Number(afterTopUp.expectedCash) === Number(afterDrop.expectedCash) + 50,
  `${afterDrop.expectedCash} -> ${afterTopUp.expectedCash}`);

// ============================================================
console.log('\nPAYMENT (§22, §35)');
// ============================================================

const line = { productId: otc.id, quantity: 2 };
const base = {
  branchId: branch.id, warehouseId: warehouse.id, cashSessionId: session.id, lines: [line],
};

const cardWithoutReference = await cashier('POST', '/pos/checkout', {
  ...base,
  payments: [{ method: 'CARD', amount: 10000 }],
  idempotencyKey: key(),
});
check('a card payment with no terminal reference is refused',
  cardWithoutReference.status === 400 && /reference/i.test(cardWithoutReference.body?.error ?? ''),
  cardWithoutReference.body?.error);

const cardSale = await cashier('POST', '/pos/checkout', {
  ...base,
  payments: [{ method: 'CARD', amount: 10000, reference: 'TERM-000123' }],
  idempotencyKey: key(),
});
check('a card payment carrying its reference completes', cardSale.ok,
  `HTTP ${cardSale.status}: ${cardSale.body?.error ?? ''} ${cardSale.body?.saleNo ?? ''}`);

const cashKey = key();
const cashSale = await cashier('POST', '/pos/checkout', {
  ...base,
  payments: [{ method: 'CASH', amount: 10000 }],
  idempotencyKey: cashKey,
});
check('a cash sale completes', cashSale.ok, `HTTP ${cashSale.status}: ${cashSale.body?.error ?? ''}`);
check('the till is told the change to hand back',
  cashSale.ok && Number(cashSale.body.changeDue) ===
    Number((10000 - Number(cashSale.body.grandTotal)).toFixed(2)),
  `tendered 10000, total ${cashSale.body?.grandTotal}, change ${cashSale.body?.changeDue}`);

const replay = await cashier('POST', '/pos/checkout', {
  ...base,
  payments: [{ method: 'CASH', amount: 10000 }],
  idempotencyKey: cashKey,
});
check('replaying the same cart returns the original sale rather than making a second',
  replay.ok && replay.body.saleNo === cashSale.body.saleNo,
  `${cashSale.body?.saleNo} vs ${replay.body?.saleNo}`);

const split = await cashier('POST', '/pos/checkout', {
  ...base,
  payments: [
    { method: 'CASH', amount: 20 },
    { method: 'CARD', amount: 10000, reference: 'TERM-000124' },
  ],
  idempotencyKey: key(),
});
check('a total split across two tenders is accepted', split.ok,
  `HTTP ${split.status}: ${split.body?.error ?? ''}`);

const short = await cashier('POST', '/pos/checkout', {
  ...base, payments: [{ method: 'CASH', amount: 0.01 }], idempotencyKey: key(),
});
check('an underpayment is refused', short.status === 400, short.body?.error);

// ============================================================
console.log('\nSALE GUARDS (§22, §28)');
// ============================================================

const rx = (Array.isArray(searchable) ? searchable : []).find(
  (p) => p.requiresPrescription || p.isControlled,
);
if (rx) {
  const attempt = await cashier('POST', '/pos/checkout', {
    ...base, lines: [{ productId: rx.id, quantity: 1 }],
    payments: [{ method: 'CASH', amount: 10000 }], idempotencyKey: key(),
  });
  check('a prescription-only or controlled product cannot be sold at the till',
    attempt.status === 403, attempt.body?.error);
} else {
  skip('prescription-only guard', 'no Rx or controlled product surfaced by the search');
}

// A quantity ceiling, set on the product, must hold at the server.
const limited = await admin('PATCH', `/products/${otc.id}`, { maxQuantityPerSale: 1 });
if (limited.ok) {
  const overLimit = await cashier('POST', '/pos/checkout', {
    ...base, lines: [{ productId: otc.id, quantity: 5 }],
    payments: [{ method: 'CASH', amount: 10000 }], idempotencyKey: key(),
  });
  check('a quantity above the product ceiling is refused',
    overLimit.status === 400 && /per sale/i.test(overLimit.body?.error ?? ''),
    overLimit.body?.error);
  await admin('PATCH', `/products/${otc.id}`, { maxQuantityPerSale: null });
} else {
  skip('per-sale quantity ceiling', `could not set the limit: HTTP ${limited.status}`);
}

const restricted = await admin('PATCH', `/products/${otc.id}`, {
  isAgeRestricted: true, minimumAgeYears: 18,
});
if (restricted.ok) {
  const unconfirmed = await cashier('POST', '/pos/checkout', {
    ...base, payments: [{ method: 'CASH', amount: 10000 }], idempotencyKey: key(),
  });
  check('an age-restricted product needs the age check confirmed',
    unconfirmed.status === 400 && /age/i.test(unconfirmed.body?.error ?? ''),
    unconfirmed.body?.error);

  const confirmed = await cashier('POST', '/pos/checkout', {
    ...base, payments: [{ method: 'CASH', amount: 10000 }],
    ageConfirmed: true, idempotencyKey: key(),
  });
  check('and completes once it is', confirmed.ok, `HTTP ${confirmed.status}: ${confirmed.body?.error ?? ''}`);
  await admin('PATCH', `/products/${otc.id}`, { isAgeRestricted: false, minimumAgeYears: null });
} else {
  skip('age restriction', `could not set the flag: HTTP ${restricted.status}`);
}

// ============================================================
console.log('\nCUSTOMER, CREDIT AND LOYALTY (§14)');
// ============================================================

const stamp = Date.now();
const buyer = await admin('POST', '/patients', {
  fullName: `POS Credit Test ${stamp}`, phone: `0911${String(stamp).slice(-6)}`,
});
if (buyer.ok) {
  const creditNoCustomer = await cashier('POST', '/pos/checkout', {
    ...base, payments: [{ method: 'CREDIT', amount: 10000 }], idempotencyKey: key(),
  });
  check('an account sale with nobody to bill is refused',
    creditNoCustomer.status === 400 && /customer/i.test(creditNoCustomer.body?.error ?? ''),
    creditNoCustomer.body?.error);

  const noLimit = await cashier('POST', '/pos/checkout', {
    ...base, patientId: buyer.body.id,
    payments: [{ method: 'CREDIT', amount: 10000 }], idempotencyKey: key(),
  });
  // Zero means no credit agreed, not unlimited: a walk-in created at the
  // counter in seconds must not walk out with the stock on account.
  check('a customer with no agreed limit cannot buy on account',
    noLimit.status === 400 && /no credit limit/i.test(noLimit.body?.error ?? ''),
    noLimit.body?.error);

  await admin('PATCH', `/patients/${buyer.body.id}`, { creditLimit: 500 });
  const overLimit = await cashier('POST', '/pos/checkout', {
    ...base, patientId: buyer.body.id,
    payments: [{ method: 'CREDIT', amount: 10000 }], idempotencyKey: key(),
  });
  check('and cannot exceed the limit once one is set',
    overLimit.status === 400 && /credit limit/i.test(overLimit.body?.error ?? ''),
    overLimit.body?.error);

  const withinLimit = await cashier('POST', '/pos/checkout', {
    ...base, patientId: buyer.body.id,
    payments: [{ method: 'CREDIT', amount: 100 }], idempotencyKey: key(),
  });
  check('an account sale inside the limit completes', withinLimit.ok,
    `HTTP ${withinLimit.status}: ${withinLimit.body?.error ?? ''}`);

  const after = (await admin('GET', `/patients/${buyer.body.id}`)).body;
  check('the balance moves onto the account', Number(after.creditBalance) > 0,
    `owes ${after.creditBalance}`);
} else {
  skip('credit sale checks', `could not create a customer: HTTP ${buyer.status}`);
}

// ============================================================
console.log('\nSALE RETRIEVAL (§22)');
// ============================================================

const lookup = await cashier('GET', `/pos/sales?branchId=${branch.id}&q=${cashSale.body.saleNo}`);
check('a past sale can be found by its number',
  lookup.ok && lookup.body.data.some((s) => s.saleNo === cashSale.body.saleNo),
  `${lookup.body?.data?.length ?? 0} match(es)`);

const takings = await cashier('GET', `/pos/today?branchId=${branch.id}`);
check("today's takings are reported", takings.ok && Number(takings.body.takings) > 0,
  `${takings.body?.salesCount} sale(s), ${takings.body?.takings}`);
check('with the top sellers behind them', (takings.body?.topSellers ?? []).length > 0,
  `${takings.body?.topSellers?.length} product(s)`);

const otherBranch = org.branches.find((b) => !me.branchIds.includes(b.id));
if (otherBranch) {
  const foreign = await cashier('GET', `/pos/sales?branchId=${otherBranch.id}`);
  check('a cashier cannot list another branch\'s sales', foreign.status === 403,
    `HTTP ${foreign.status}`);
} else {
  skip('cross-branch sale listing', 'the cashier reaches every branch in this dataset');
}

// ============================================================
console.log('\nCLOSING THE DRAWER (§46)');
// ============================================================

const report = (await cashier('GET', `/pos/cash-sessions/${session.id}/report`)).body;
const expected = Number(report.expectedCash);

const mismatched = await cashier('POST', `/pos/cash-sessions/${session.id}/close`, {
  actualCash: expected,
  denominations: { '100': 1 },
});
check('a note breakdown that does not add up to the declared figure is refused',
  mismatched.status === 400 && /add up/i.test(mismatched.body?.error ?? ''),
  mismatched.body?.error);

// Build a breakdown that really does sum to the expected figure.
const notes = {};
let remaining = Math.round(expected * 100);
for (const note of [200, 100, 50, 10, 5, 1]) {
  const cents = note * 100;
  const count = Math.floor(remaining / cents);
  if (count > 0) { notes[String(note)] = count; remaining -= count * cents; }
}
const declared = Number(
  (Object.entries(notes).reduce((s, [n, c]) => s + Number(n) * c, 0)).toFixed(2),
);

const closed = await cashier('POST', `/pos/cash-sessions/${session.id}/close`, {
  actualCash: declared,
  denominations: notes,
  varianceReason: 'End-to-end check: counted to the nearest note',
});
check('the shift closes with a denomination count', closed.ok,
  `HTTP ${closed.status}: ${closed.body?.error ?? ''}`);

const zReport = await cashier('GET', `/pos/cash-sessions/${session.id}/report`);
check('the Z-report shows the reconciliation',
  zReport.ok && zReport.body.isOpen === false && zReport.body.countedCash !== null,
  `expected ${zReport.body?.expectedCash}, counted ${zReport.body?.countedCash}, variance ${zReport.body?.variance}`);
check('and keeps the note breakdown', !!zReport.body?.denominations,
  JSON.stringify(zReport.body?.denominations ?? null));

const reclose = await cashier('POST', `/pos/cash-sessions/${session.id}/close`, { actualCash: 1 });
check('a closed shift cannot be closed again', reclose.status === 409, reclose.body?.error);

// ============================================================
console.log('\nAUDIT');
// ============================================================
const chain = await admin('GET', '/admin/audit-logs/verify');
check('the audit chain still verifies', chain.body?.valid === true,
  `${chain.body?.checked ?? 0} entries checked`);

console.log('\n' + '='.repeat(60));
if (skipped.length) {
  console.log(`${skipped.length} check(s) could not run on this dataset:`);
  for (const s of skipped) console.log(`  - ${s.name}: ${s.why}`);
  console.log('');
}
if (failures) {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('ALL POINT-OF-SALE CHECKS PASSED');
console.log('='.repeat(60));
