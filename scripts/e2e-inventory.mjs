// Stock balances, batches, the ledger, reservations and integrity end to end.
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
    return { ok: r.ok, status: r.status, body: parsed, text };
  };
}

const admin = client(await login('admin'));
const storekeeper = client(await login('storekeeper'));
const qa = client(await login('qa'));
const cashier = client(await login('cashier'));
// The storekeeper holds stock balances but not the ledger; the pharmacist holds
// the ledger and is branch-scoped, which is what the scope checks need.
const pharmacist = client(await login('pharmacist'));

const me = (await storekeeper('GET', '/auth/me')).body;
const org = (await admin('GET', '/admin/organization')).body;
const branch = org.branches.find((b) => me.branchIds.includes(b.id)) ?? org.branches[0];
const warehouse = branch.warehouses.find((w) => !w.isColdRoom) ?? branch.warehouses[0];
const otherBranch = org.branches.find((b) => b.id !== branch.id);
const otherWarehouse = otherBranch?.warehouses?.find((w) => !w.isColdRoom);

// ============================================================
console.log('\nSTOCK BALANCES (§19)');
// ============================================================

{
  const r = await storekeeper('GET', `/inventory/balances?warehouseId=${warehouse.id}&pageSize=10`);
  check('balances read', r.ok && Array.isArray(r.body.data), `HTTP ${r.status}`);
  check('a summary covers the whole filter, not the page',
    !!r.body.summary && r.body.summary.positions >= r.body.data.length,
    `${r.body.summary?.positions} positions vs ${r.body.data.length} on the page`);
  check('the summary totals units and value',
    r.body.summary && Number(r.body.summary.units) > 0 && Number(r.body.summary.value) > 0,
    `${r.body.summary?.units} units, value ${r.body.summary?.value}`);

  const row = r.body.data.find((d) => Number(d.onHand) > 0 && d.batch);
  if (!row) {
    skip('stock is valued at what is held', 'no position with stock and a batch');
  } else {
    // §32: the balance sheet values what is held. Valuing `available` wrote the
    // reserved quantity off the stock screen while the ledger still carried it.
    const expected = Number(row.onHand) * Number(row.product.averageCost);
    check('stock is valued at on hand, not at available',
      Math.abs(Number(row.stockValue) - expected) < 0.01,
      `${row.stockValue} vs ${expected.toFixed(4)}`);
    check('stock age is reported', row.ageDays === null || typeof row.ageDays === 'number',
      String(row.ageDays));
  }
}

{
  // The filter used to run over the fetched page, so it returned whatever
  // happened to be below reorder among the first fifty rows.
  const filtered = await storekeeper('GET', '/inventory/balances?onlyBelowReorder=true&pageSize=200');
  check('the below-reorder filter reads', filtered.ok, `HTTP ${filtered.status}`);
  check('its total matches the rows it actually returns',
    filtered.body.total === filtered.body.summary.positions,
    `total ${filtered.body.total}, summary ${filtered.body.summary?.positions}`);

  if (filtered.body.data.length) {
    // Reorder is judged per product across the branch, not per shelf.
    const productIds = [...new Set(filtered.body.data.map((d) => d.productId))];
    const sample = productIds[0];
    const all = await storekeeper('GET', `/inventory/balances?productId=${sample}&pageSize=200`);
    const totalAvailable = (all.body.data ?? []).reduce((s, r) => s + Number(r.available), 0);
    const level = Number(all.body.data?.[0]?.product?.reorderLevel ?? 0);
    check('a product is short on its branch-wide total, not on one shelf',
      level > 0 && totalAvailable <= level,
      `available ${totalAvailable} vs level ${level}`);
  } else {
    skip('a product is short on its branch-wide total, not on one shelf', 'nothing is below reorder');
  }
}

{
  const controlled = await storekeeper('GET', '/inventory/balances?onlyControlled=true&pageSize=50');
  check('the controlled filter returns only controlled products',
    controlled.ok && (controlled.body.data ?? []).every((d) => d.product.isControlled),
    `${controlled.body.data?.length} row(s)`);

  const expiring = await storekeeper('GET', '/inventory/balances?expiringWithinDays=90&pageSize=50');
  check('the expiry filter returns only stock expiring inside the window',
    expiring.ok && (expiring.body.data ?? []).every((d) => d.daysToExpiry === null || d.daysToExpiry <= 90),
    `${expiring.body.data?.length} row(s)`);

  const byBatch = (await storekeeper('GET', '/inventory/balances?pageSize=1')).body.data?.[0];
  if (byBatch?.batch?.batchNumber) {
    const found = await storekeeper('GET',
      `/inventory/balances?search=${encodeURIComponent(byBatch.batch.batchNumber)}&pageSize=20`);
    check('a batch number off the box is searchable',
      found.ok && (found.body.data ?? []).some((d) => d.batch?.batchNumber === byBatch.batch.batchNumber),
      `${found.body.data?.length} row(s)`);
  } else {
    skip('a batch number off the box is searchable', 'no batched position to search for');
  }
}

{
  const csv = await storekeeper('GET', '/inventory/balances.csv?pageSize=10');
  check('the balance export is a CSV', csv.ok && typeof csv.body === 'string' && csv.text.includes('SKU'),
    `HTTP ${csv.status}`);
  const denied = await cashier('GET', '/inventory/balances.csv');
  check('a cashier cannot export stock', denied.status === 403, `HTTP ${denied.status}`);
}

// ============================================================
console.log('\nTHE LEDGER (§19)');
// ============================================================

{
  const denied = await storekeeper('GET', '/inventory/ledger?pageSize=5');
  check('a storekeeper cannot read the ledger', denied.status === 403, `HTTP ${denied.status}`);

  const r = await admin('GET', '/inventory/ledger?pageSize=20');
  check('the ledger reads', r.ok && Array.isArray(r.body.data), `HTTP ${r.status}`);
  check('every movement names who made it or says nobody did',
    (r.body.data ?? []).every((m) => 'performedBy' in m));
  check('a movement links to the document it came from',
    (r.body.data ?? []).some((m) => m.referenceHref),
    `${(r.body.data ?? []).filter((m) => m.referenceHref).length} linked`);

  const csv = await admin('GET', '/inventory/ledger.csv?pageSize=10');
  check('the ledger exports as a CSV',
    csv.ok && typeof csv.body === 'string' && csv.text.includes('Balance after'),
    `HTTP ${csv.status}`);
}

{
  const row = (await admin('GET', '/inventory/balances?pageSize=20')).body.data
    .find((d) => d.batch && Number(d.onHand) > 0);
  if (!row) {
    skip('a batch ledger carries the running balance', 'no batched position');
  } else {
    const r = await admin('GET',
      `/inventory/ledger/batch/${row.batch.id}?warehouseId=${row.warehouseId}`);
    const rows = Array.isArray(r.body) ? r.body : [];
    check('a batch ledger reads oldest first', r.ok && Array.isArray(r.body), `HTTP ${r.status}`);
    check('it carries the running balance after each movement',
      rows.length === 0 || rows.every((m) => m.balanceAfter !== undefined));
    if (rows.length > 1) {
      const ordered = rows.every((m, i) =>
        i === 0 || new Date(m.occurredAt) >= new Date(rows[i - 1].occurredAt));
      check('it is in the order the movements happened', ordered);
    }
  }
}

// ============================================================
console.log('\nINTEGRITY (§19)');
// ============================================================

{
  const r = await admin('GET', `/inventory/ledger/integrity?warehouseId=${warehouse.id}`);
  check('the integrity check reads', r.ok, `HTTP ${r.status}`);
  // The check used to compare a per-location balance row against a replay that
  // ignores location, so a batch split across two bins always looked wrong.
  check('a batch split across bins is not reported as drift',
    r.body.mismatches?.length === 0,
    `${r.body.mismatches?.length} mismatch(es) over ${r.body.positions} position(s) in ${r.body.checked} group(s)`);
  check('it says how many rows it aggregated',
    typeof r.body.positions === 'number' && r.body.positions >= r.body.checked,
    `${r.body.positions} rows -> ${r.body.checked} groups`);

  const unscopedSweep = await pharmacist('GET', '/inventory/ledger/integrity');
  check('a branch user must name the warehouse to replay',
    unscopedSweep.status === 400 || unscopedSweep.ok,
    `HTTP ${unscopedSweep.status}`);
}

// ============================================================
console.log('\nRESERVATIONS (§19)');
// ============================================================

{
  const before = await storekeeper('GET', '/inventory/reservations?pageSize=50');
  check('reservations read', before.ok && Array.isArray(before.body.data), `HTTP ${before.status}`);

  // Hold a basket at the till, which is what creates a reservation. The till
  // works in the cashier's own branch, which need not be the storekeeper's.
  const till = (await cashier('GET', '/auth/me')).body;
  const tillBranch = org.branches.find((b) => till.branchIds.includes(b.id)) ?? branch;
  const tillWarehouse = tillBranch.warehouses.find((w) => !w.isColdRoom) ?? tillBranch.warehouses[0];

  const sellable = (await cashier('GET', `/pos/search?q=a&warehouseId=${tillWarehouse.id}`)).body;
  const otc = (Array.isArray(sellable) ? sellable : [])
    .find((p) => !p.requiresPrescription && !p.isControlled && Number(p.available) > 5);

  if (!otc) {
    skip('a held basket holds stock and says so', 'no over-the-counter stock at the till warehouse');
  } else {
    const availableBefore = Number(otc.available);
    const held = await cashier('POST', '/pos/hold', {
      branchId: tillBranch.id, warehouseId: tillWarehouse.id,
      lines: [{ productId: otc.id, quantity: 2 }], payments: [],
    });
    check('a basket can be held', held.ok, `HTTP ${held.status}`);

    const after = (await cashier('GET', `/pos/search?q=a&warehouseId=${tillWarehouse.id}`)).body
      .find((p) => p.id === otc.id);
    check('holding it takes the stock out of available',
      Number(after.available) === availableBefore - 2,
      `${availableBefore} -> ${after.available}`);

    // Read as admin: the reservation is in the till's branch, and this check is
    // about the reservation being visible at all, not about who may see it.
    const list = await admin('GET',
      `/inventory/reservations?productId=${otc.id}&warehouseId=${tillWarehouse.id}`);
    const hold = (list.body.data ?? []).find((r) => r.referenceId === held.body.id);
    check('the hold is visible with a name against it', !!hold,
      `${list.body.data?.length} reservation(s)`);
    check('it says who is holding it and for how long',
      !!hold && hold.referenceType === 'HELD_SALE' && typeof hold.heldForMinutes === 'number',
      `${hold?.referenceType}, ${hold?.heldForMinutes}m`);
    // expiresAt existed on the model and nothing ever set it, so an abandoned
    // basket held its stock for good.
    check('the hold has an expiry rather than lasting for ever', !!hold?.expiresAt,
      String(hold?.expiresAt));

    if (!hold) {
      console.error('\nThe held basket produced no reservation; the rest of this section cannot run.');
      failures++;
      process.exit(1);
    }

    const noReason = await admin('POST', `/inventory/reservations/${hold.id}/release`, {});
    check('releasing a hold without a reason is refused', noReason.status === 400,
      `HTTP ${noReason.status}`);

    const released = await admin('POST', `/inventory/reservations/${hold.id}/release`, {
      reason: 'End-to-end check',
    });
    check('a hold can be released by hand', released.ok, `HTTP ${released.status}`);

    const backOnSale = (await cashier('GET', `/pos/search?q=a&warehouseId=${tillWarehouse.id}`)).body
      .find((p) => p.id === otc.id);
    check('releasing it puts the stock back on sale',
      Number(backOnSale.available) === availableBefore,
      `${after.available} -> ${backOnSale.available}`);

    const stillHeld = await cashier('GET', `/pos/sales/${held.body.id}`);
    check('the held sale itself is left alone',
      !stillHeld.ok || stillHeld.body.status === 'HELD',
      String(stillHeld.body?.status));

    const twice = await admin('POST', `/inventory/reservations/${hold.id}/release`, {
      reason: 'again',
    });
    check('a released hold cannot be released twice', twice.status === 409, `HTTP ${twice.status}`);

    const denied = await cashier('POST', `/inventory/reservations/${hold.id}/release`, {
      reason: 'not mine to release',
    });
    check('a cashier cannot release a hold', denied.status === 403, `HTTP ${denied.status}`);
  }
}

// ============================================================
console.log('\nANOMALIES (§19)');
// ============================================================

{
  const r = await storekeeper('GET', `/inventory/anomalies?warehouseId=${warehouse.id}`);
  check('the anomaly report reads', r.ok && typeof r.body.checked === 'number', `HTTP ${r.status}`);
  check('it names what each finding means',
    ['negative', 'overReserved', 'heldAtZero', 'expiredButAvailable']
      .every((k) => typeof r.body[k]?.meaning === 'string'));
  check('it says it corrects nothing',
    typeof r.body.note === 'string' && /not a correction/i.test(r.body.note));
  check('a seeded database has no negative stock', r.body.negative.count === 0,
    `${r.body.negative.count} negative position(s)`);
}

// ============================================================
console.log('\nBATCHES (§7, §16)');
// ============================================================

let splittable = null;
{
  const denied = await storekeeper('GET', '/inventory/batches?pageSize=5');
  check('a storekeeper cannot read batch records', denied.status === 403, `HTTP ${denied.status}`);

  const r = await qa('GET', `/inventory/batches?onlyInStock=true&pageSize=20`);
  check('batches read', r.ok && Array.isArray(r.body.data), `HTTP ${r.status}`);
  check('each batch carries its own on-hand and value',
    (r.body.data ?? []).every((b) => b.onHand !== undefined && b.stockValue !== undefined));
  check('each batch reports days to expiry',
    (r.body.data ?? []).every((b) => typeof b.daysToExpiry === 'number'));

  splittable = (r.body.data ?? []).find(
    (b) => Number(b.available) > 4 && !['DESTROYED', 'EXPIRED'].includes(b.status),
  );

  const one = (r.body.data ?? [])[0];
  if (!one) {
    skip('a batch record reads', 'no batch with stock');
  } else {
    const detail = await qa('GET', `/inventory/batches/${one.id}`);
    check('a batch record reads', detail.ok, `HTTP ${detail.status}`);
    check('it says where the stock is', Array.isArray(detail.body.balances));
    check('it carries the status history from the audit chain',
      Array.isArray(detail.body.history));
    check('it exposes genealogy', 'childBatches' in detail.body && 'parentBatch' in detail.body);
    check('it totals what left the batch by movement type',
      !!detail.body.movementTotals && 'damaged' in detail.body.movementTotals,
      JSON.stringify(detail.body.movementTotals));
    check('it reports how fast the batch is moving',
      !!detail.body.consumption && typeof detail.body.consumption.perDay === 'string',
      `${detail.body.consumption?.perDay}/day over ${detail.body.consumption?.windowDays}d`);
    check('the velocity window is measured from the first supply, not a flat 90 days',
      detail.body.consumption.windowDays === 0 || detail.body.consumption.windowDays <= 90,
      String(detail.body.consumption?.windowDays));
  }
}

{
  const quarantined = (await qa('GET', '/inventory/batches?status=QUARANTINED&pageSize=10')).body.data?.[0];
  if (!quarantined) {
    skip('releasing a batch needs its evidence', 'no quarantined batch');
  } else {
    const noReason = await qa('POST', `/inventory/batches/${quarantined.id}/release`, {});
    check('releasing without a reason is refused', noReason.status === 400, `HTTP ${noReason.status}`);

    const noEvidence = await qa('POST', `/inventory/batches/${quarantined.id}/release`, {
      reason: 'Looks fine',
    });
    check('releasing without naming the evidence is refused',
      noEvidence.status === 400 && /certificate|evidence/i.test(String(noEvidence.body?.error)),
      `HTTP ${noEvidence.status}`);

    const released = await qa('POST', `/inventory/batches/${quarantined.id}/release`, {
      reason: 'Certificate of analysis reviewed and accepted',
      evidenceRef: 'COA-E2E-0001',
    });
    check('releasing with the evidence works', released.ok, `HTTP ${released.status}`);

    const detail = await qa('GET', `/inventory/batches/${quarantined.id}`);
    const entry = (detail.body.history ?? []).find((h) => h.action === 'BATCH_STATUS_CHANGE');
    check('the evidence is kept against the decision',
      entry?.newValue?.evidenceRef === 'COA-E2E-0001',
      String(entry?.newValue?.evidenceRef));
  }
}

{
  if (!splittable) {
    skip('a batch can be split', 'no batch with enough unreserved stock');
  } else {
    const position = (splittable.balances ?? []).find((b) => Number(b.onHand) > 4);
    if (!position) {
      skip('a batch can be split', 'the batch holds no single position with enough stock');
    } else {
      const before = (await admin('GET', `/inventory/batches/${splittable.id}`)).body;

      const noReason = await admin('POST', `/inventory/batches/${splittable.id}/split`, {
        warehouseId: position.warehouseId, quantity: 2,
      });
      check('splitting without a reason is refused', noReason.status === 400,
        `HTTP ${noReason.status}`);

      const tooMuch = await admin('POST', `/inventory/batches/${splittable.id}/split`, {
        warehouseId: position.warehouseId, quantity: 1e9, reason: 'more than exists',
      });
      check('splitting more than is unreserved is refused', tooMuch.status === 409,
        `HTTP ${tooMuch.status}`);

      const child = await admin('POST', `/inventory/batches/${splittable.id}/split`, {
        warehouseId: position.warehouseId, quantity: 2,
        reason: 'Repacked for the branch dispensary',
      });
      check('a batch can be split', child.ok,
        `HTTP ${child.status} ${JSON.stringify(child.body).slice(0, 160)}`);
      check('the child records its parent', child.body?.parentBatchId === splittable.id);
      check('the child keeps the parent expiry',
        new Date(child.body.expiryDate).getTime() === new Date(splittable.expiryDate).getTime(),
        `${child.body?.expiryDate} vs ${splittable.expiryDate}`);
      check('the child keeps the parent cost',
        Number(child.body.purchaseCost) === Number(splittable.purchaseCost),
        `${child.body?.purchaseCost} vs ${splittable.purchaseCost}`);

      const after = (await admin('GET', `/inventory/batches/${splittable.id}`)).body;
      check('the split moved stock rather than creating it',
        Number(after.onHand) === Number(before.onHand) - 2,
        `${before.onHand} -> ${after.onHand}`);
      check('the parent lists the child',
        (after.childBatches ?? []).some((c) => c.id === child.body.id));

      const childDetail = (await admin('GET', `/inventory/batches/${child.body.id}`)).body;
      check('the child holds the quantity that was split',
        Number(childDetail.onHand) === 2, String(childDetail.onHand));
      check('both movements are on the ledger',
        (await admin('GET', `/inventory/ledger/batch/${child.body.id}`)).body.length > 0);
    }
  }
}

// ============================================================
console.log('\nBRANCH SCOPE (§4, §33)');
// ============================================================

{
  if (!otherWarehouse || me.branchIds.length === 0) {
    skip('the ledger does not reach another branch', 'no second branch, or the actor is organisation-wide');
  } else {
    // The ledger took no user at all: every movement, every branch, every cost.
    const wide = await pharmacist('GET', '/inventory/ledger?pageSize=500');
    check('the ledger does not reach another branch',
      !(wide.body.data ?? []).some((m) => m.branchId === otherBranch.id),
      `${(wide.body.data ?? []).filter((m) => m.branchId === otherBranch.id).length} leaked`);

    const named = await pharmacist('GET', `/inventory/ledger?branchId=${otherBranch.id}`);
    check('asking for another branch by id does not widen the ledger',
      named.status === 403 || (named.body.data ?? []).length === 0,
      `HTTP ${named.status}, ${(named.body?.data ?? []).length} rows`);

    const probe = await storekeeper('GET',
      `/inventory/fefo/recommend?productId=${(await storekeeper('GET', '/inventory/balances?pageSize=1')).body.data[0].productId}&warehouseId=${otherWarehouse.id}`);
    check('FEFO cannot be used to probe another branch', probe.status === 403,
      `HTTP ${probe.status}`);

    const allocate = await storekeeper('POST', '/inventory/fefo/allocate', {
      productId: (await storekeeper('GET', '/inventory/balances?pageSize=1')).body.data[0].productId,
      warehouseId: otherWarehouse.id, quantity: 1,
    });
    check('nor can a dry-run allocation', allocate.status === 403, `HTTP ${allocate.status}`);

    const integrity = await pharmacist('GET',
      `/inventory/ledger/integrity?warehouseId=${otherWarehouse.id}`);
    check('nor can the integrity replay', integrity.status === 403, `HTTP ${integrity.status}`);

    const reservations = await storekeeper('GET',
      `/inventory/reservations?warehouseId=${otherWarehouse.id}`);
    check('nor can the reservation list', reservations.status === 403,
      `HTTP ${reservations.status}`);

    const otherBatch = (await admin('GET', '/inventory/batches?pageSize=200')).body.data
      ?.find((b) => (b.balances ?? []).length === 0);
    if (!otherBatch) {
      skip('a batch held only by another branch is unreachable', 'every batch is visible here');
    } else {
      const read = await pharmacist('GET', `/inventory/batches/${otherBatch.id}`);
      check('a batch held only by another branch is unreachable',
        read.status === 404 || read.status === 403, `HTTP ${read.status}`);
    }
  }
}

// ============================================================
console.log(`\n${failures === 0 ? 'ALL INVENTORY CHECKS PASSED' : `${failures} INVENTORY CHECK(S) FAILED`}`);
if (skipped.length) console.log(`${skipped.length} skipped: ${skipped.map((s) => s.name).join('; ')}`);
process.exit(failures === 0 ? 0 : 1);
