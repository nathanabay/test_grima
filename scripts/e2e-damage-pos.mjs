const API = 'http://localhost:4000/api';
let fails = 0;
const check = (l, c, d = '') => { if (!c) fails++; console.log(`${c ? '  PASS' : '  FAIL'}  ${l}${d ? ` -- ${d}` : ''}`); };
async function login(u) {
  const r = await fetch(`${API}/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({identifier:u, password:'PharmaCore#2026'})});
  return (await r.json()).accessToken;
}
const client = (t) => async (m, p, b) => {
  const r = await fetch(`${API}${p}`, { method:m, headers:{'Content-Type':'application/json', Authorization:`Bearer ${t}`}, body: b?JSON.stringify(b):undefined });
  const x = await r.text(); let j; try { j = JSON.parse(x); } catch { j = x; }
  return { ok: r.ok, status: r.status, body: j };
};


/**
 * A genuinely over-the-counter line with stock in this warehouse.
 *
 * These suites used to search for "Paracetamol" by name. The seed does not put
 * an over-the-counter paracetamol in every branch store, so on a freshly seeded
 * database the lookup returned nothing and the suite fell over on a data-shape
 * accident rather than on anything it was testing. The search term is broad now
 * and the assertions do the choosing.
 */
async function findOtc(callAs, warehouseId, minimum = 1) {
  for (const term of ['a', 'e', 'i', 'o', 'u']) {
    const results = (await callAs('GET', `/pos/search?q=${term}&warehouseId=${warehouseId}`)).body;
    const found = (Array.isArray(results) ? results : [])
      .find((p) => !p.requiresPrescription && !p.isControlled && Number(p.available) > minimum);
    if (found) return found;
  }
  return null;
}

const admin = client(await login('admin'));
const qa = client(await login('qa'));
const cashier = client(await login('cashier'));

const org = (await admin('GET','/admin/organization')).body;
const cashierMe = (await cashier('GET','/auth/me')).body;
const branch = org.branches.find(b => b.id === cashierMe.branchIds[0]);
const wh = branch.warehouses.find(w => !w.isColdRoom);

console.log('\n===== §31 DAMAGED STOCK =====\n');
// A batch can sit in more than one bin, so "the stock" is the sum of its
// balance rows in this warehouse, not whichever row happens to come back first.
const batchTotal = async (batchId) => {
  const rows = (await admin('GET', `/inventory/balances?warehouseId=${wh.id}&pageSize=200`)).body.data;
  return rows.filter((b) => b.batch?.id === batchId).reduce((sum, b) => sum + Number(b.onHand), 0);
};

const stock = (await admin(`GET`, `/inventory/balances?warehouseId=${wh.id}&pageSize=200`)).body.data
  .find(b => b.batch && Number(b.onHand) > 100 && ['AVAILABLE','RELEASED'].includes(b.batch.status));
const before = await batchTotal(stock.batch.id);

const noReason = await qa('POST','/quality-incidents'.replace('quality-incidents','damage-reports'), {
  productId: stock.productId, batchId: stock.batch.id, warehouseId: wh.id, branchId: branch.id,
  quantity: 10, damageType: 'BREAKAGE', reason: '',
});
check('damage without a reason is refused', !noReason.ok, String(noReason.body.error).slice(0,70));

const dmg = await qa('POST','/damage-reports', {
  productId: stock.productId, batchId: stock.batch.id, warehouseId: wh.id, branchId: branch.id,
  quantity: 25, damageType: 'BREAKAGE', reason: 'Carton crushed by a pallet during unloading',
});
check('damage reported', dmg.ok, `${dmg.body.reportNo} value ${dmg.body.totalValue}`);

const after = { onHand: await batchTotal(stock.batch.id) };
check('damaged units LEFT sellable stock immediately', Number(after.onHand) === before - 25,
  `${before} -> ${Number(after.onHand)}`);

const rejectNoReason = await qa('POST', `/damage-reports/${dmg.body.id}/verify`, { decision: 'REJECT' });
check('rejecting a damage report without a reason is refused', !rejectNoReason.ok, String(rejectNoReason.body.error).slice(0,70));

const rejected = await qa('POST', `/damage-reports/${dmg.body.id}/verify`, { decision:'REJECT', notes:'Outer carton only; product intact on inspection' });
check('rejection returns the units to stock', rejected.ok);
const restored = { onHand: await batchTotal(stock.batch.id) };
check('stock is back where it was', Number(restored.onHand) === before, `${Number(restored.onHand)} of ${before}`);

const dmg2 = await qa('POST','/damage-reports', {
  productId: stock.productId, batchId: stock.batch.id, warehouseId: wh.id, branchId: branch.id,
  quantity: 12, damageType: 'CONTAMINATION', reason: 'Water ingress in store room B',
});
const verified = await qa('POST', `/damage-reports/${dmg2.body.id}/verify`, { decision:'VERIFY', notes:'Confirmed unusable' });
check('verified damage is held for disposal', verified.body.status === 'VERIFIED');
const summary = await qa('GET','/damage-reports/summary?days=30');
check('damage summary computed', summary.body.totalValue > 0,
  `${summary.body.reports} report(s), ${summary.body.totalUnits} units, value ${summary.body.totalValue}`);

console.log('\n===== §22 HOLD / RESUME CART =====\n');
const otc = await findOtc(cashier, wh.id, 5);
if (!otc) {
  console.error(`\nNo over-the-counter product with stock in ${wh.name} — cannot exercise the till.`);
  process.exit(1);
}
// Re-read the same product from the same warehouse each time, so the numbers
// compared are the same shelf before and after.
const availability = async () =>
  Number(((await cashier('GET', `/pos/search?q=${encodeURIComponent(otc.genericName)}&warehouseId=${wh.id}`)).body
    .find(p => p.id === otc.id) ?? {}).available ?? 0);
const availBefore = Number(otc.available);

const held = await cashier('POST','/pos/hold', {
  branchId: branch.id, warehouseId: wh.id,
  lines: [{ productId: otc.id, quantity: 3 }], payments: [],
});
check('cart held', held.ok, held.body.saleNo);

const afterHold = { available: await availability() };
check('held stock is RESERVED, not sellable by another till', afterHold.available === availBefore - 3,
  `${availBefore} -> ${afterHold.available} available`);

const heldList = await cashier('GET', `/pos/held?branchId=${branch.id}`);
check('held carts are listed', heldList.body.some(h => h.id === held.body.id), `${heldList.body.length} held`);

const resumed = await cashier('POST', `/pos/held/${held.body.id}/resume`);
check('resuming returns the cart lines', resumed.ok && resumed.body.lines.length === 1);
const afterResume = { available: await availability() };
check('resuming releases the reservation', afterResume.available === availBefore, `${afterResume.available} available`);

console.log('\n===== §22 PARTIAL REFUND =====\n');
const sale = await cashier('POST','/pos/checkout', {
  branchId: branch.id, warehouseId: wh.id,
  lines: [{ productId: otc.id, quantity: 4 }],
  payments: [{ method:'CASH', amount: 1000 }],
});
check('sale completed', sale.ok, `${sale.body.saleNo} total ${sale.body.grandTotal}`);
const soldBatch = sale.body.items[0].batchId;
const afterSale = { available: await availability() };

const noReasonRefund = await cashier('POST', `/pos/sales/${sale.body.id}/refund`, {
  lines: [{ saleItemId: sale.body.items[0].id, quantity: 1 }], reason: '',
});
check('refund without a reason is refused', !noReasonRefund.ok, String(noReasonRefund.body.error).slice(0,60));

const tooMany = await cashier('POST', `/pos/sales/${sale.body.id}/refund`, {
  lines: [{ saleItemId: sale.body.items[0].id, quantity: 99 }], reason: 'test',
});
check('refunding more than was sold is refused', !tooMany.ok, String(tooMany.body.error).slice(0,70));

const partial = await cashier('POST', `/pos/sales/${sale.body.id}/refund`, {
  lines: [{ saleItemId: sale.body.items[0].id, quantity: 2 }], reason: 'Customer returned two unopened packs',
});
check('partial refund recorded', partial.body?.status === 'PARTIALLY_REFUNDED', partial.body?.status);
const afterRefund = { available: await availability() };
check('refunded units returned to the SAME batch', afterRefund.available === afterSale.available + 2,
  `${afterSale.available} -> ${afterRefund.available}`);
const ledger = await admin('GET', `/inventory/ledger?batchId=${soldBatch}&pageSize=3`);
check('refund appears in the ledger against the original batch',
  ledger.body.data.some(t => t.referenceType === 'SALE_REFUND'));

const rest = await cashier('POST', `/pos/sales/${sale.body.id}/refund`, {
  lines: [{ saleItemId: sale.body.items[0].id, quantity: 2 }], reason: 'Remaining two packs returned',
});
check('refunding the balance marks it fully REFUNDED', rest.body?.status === 'REFUNDED', rest.body?.status);

console.log('\n===== §46 CASH SESSION =====\n');
const opened = await cashier('POST','/pos/cash-sessions/open', { branchId: branch.id, openingCash: 500 });
check('shift opened', opened.ok, opened.body.sessionNo);
const dup = await cashier('POST','/pos/cash-sessions/open', { branchId: branch.id, openingCash: 500 });
check('a second open shift is refused', !dup.ok, String(dup.body.error).slice(0,60));
const current = await cashier('GET', `/pos/cash-sessions/current?branchId=${branch.id}`);
check('current session is discoverable', current.body?.id === opened.body.id);
const closed = await cashier('POST', `/pos/cash-sessions/${opened.body.id}/close`, { actualCash: 500 });
check('shift closed and reconciled', closed.ok, `expected ${closed.body?.expectedCash} actual ${closed.body?.actualCash} variance ${closed.body?.variance}`);

console.log(`\n${fails === 0 ? 'ALL PHASE 5 + 6 CHECKS PASSED' : `${fails} CHECK(S) FAILED`}\n`);
process.exit(fails ? 1 : 0);
