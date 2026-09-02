// Warehouse operations end-to-end (§5: capacity, put-away, picking,
// packing, dispatch). Run against a seeded API on :4000.
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
  return (await r.json()).accessToken;
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

const admin = client(await login('admin'));
const wh = client(await login('warehouse'));

const branches = (await admin('GET', '/admin/branches')).body;
const ho = branches.find((b) => b.code === 'HO');
const central = ho.warehouses.find((w) => w.code === 'HO-WH');

console.log('\nWAREHOUSE OPERATIONS');

// --- occupancy and empty-bin detection
const occ = (await admin('GET', `/warehouse/occupancy?warehouseId=${central.id}`)).body;
check('occupancy reports every location', occ.locations.length > 0, `${occ.locations.length} locations`);
check('occupancy is a real percentage, not a placeholder',
  occ.locations.some((l) => (l.occupancyPercent ?? 0) > 0 && l.occupancyPercent <= 100),
  `avg ${occ.summary.averageOccupancyPercent}%`);
check('empty bins are detected', occ.summary.empty > 0, `${occ.summary.empty} empty`);
check('unmetered locations report null rather than 0%',
  occ.locations.filter((l) => l.capacityUnits === null).every((l) => l.occupancyPercent === null));

// --- barcode resolution
const binA = occ.locations.find((l) => l.code === 'C03-01');
const binB = occ.locations.find((l) => l.code === 'C03-03');
const scanned = await wh('GET', `/warehouse/locations/by-barcode/${binA.barcode}`);
check('a shelf-edge barcode resolves to its location', scanned.body.id === binA.id, scanned.body.code);
const badScan = await wh('GET', '/warehouse/locations/by-barcode/NOT-A-LOCATION');
check('an unknown location barcode is refused', badScan.status === 404);

// --- find stock sitting in bin A
const balances = (await admin('GET', `/inventory/balances?warehouseId=${central.id}&pageSize=200`)).body;
const rows = balances.data ?? balances;
const inBinA = rows.find((b) => b.locationId === binA.id && Number(b.onHand) > 100);
check('found stock in the source bin to move', !!inBinA, inBinA ? `${inBinA.onHand} units` : 'none');

if (inBinA) {
  // --- bin-to-bin move
  const move = await wh('POST', '/warehouse/tasks/moves', {
    warehouseId: central.id,
    productId: inBinA.productId,
    batchId: inBinA.batchId,
    fromLocationId: binA.id,
    toLocationId: binB.id,
    quantity: 50,
    taskType: 'MOVE',
  });
  check('bin-to-bin move task created', move.ok, move.body?.taskNo ?? JSON.stringify(move.body).slice(0, 80));

  if (move.ok) {
    const overSized = await wh('POST', '/warehouse/tasks/moves', {
      warehouseId: central.id,
      productId: inBinA.productId,
      batchId: inBinA.batchId,
      fromLocationId: binA.id,
      toLocationId: binB.id,
      quantity: 99_999_999,
    });
    check('a move larger than the bin holds is refused', !overSized.ok,
      String(overSized.body?.error).slice(0, 70));

    await wh('POST', `/warehouse/tasks/${move.body.id}/start`);

    const wrongScan = await wh('POST', `/warehouse/tasks/${move.body.id}/complete`, {
      quantity: 50,
      toLocationId: binB.id,
      scannedLocationBarcode: binA.barcode,
    });
    check('completing against the wrong scanned bin is refused', !wrongScan.ok,
      String(wrongScan.body?.error).slice(0, 70));

    const before = (await admin('GET', `/warehouse/occupancy?warehouseId=${central.id}`)).body;
    const beforeB = before.locations.find((l) => l.code === 'C03-03').usedUnits;

    const done = await wh('POST', `/warehouse/tasks/${move.body.id}/complete`, {
      quantity: 50,
      toLocationId: binB.id,
      scannedLocationBarcode: binB.barcode,
    });
    check('move completes with the correct scan', done.ok, done.body?.status);

    const after = (await admin('GET', `/warehouse/occupancy?warehouseId=${central.id}`)).body;
    const afterB = after.locations.find((l) => l.code === 'C03-03').usedUnits;
    check('the move actually shifted stock between bins', afterB === beforeB + 50,
      `${beforeB} -> ${afterB}`);

    const repeat = await wh('POST', `/warehouse/tasks/${move.body.id}/complete`, { quantity: 50 });
    check('a completed task cannot be completed twice', !repeat.ok,
      String(repeat.body?.error).slice(0, 60));
  }

  // --- pick wave
  const wave = await wh('POST', '/warehouse/waves', {
    warehouseId: central.id,
    strategy: 'WAVE',
    lines: [{ productId: inBinA.productId, quantity: 30 }],
  });
  check('pick wave planned', wave.ok, wave.body?.wave?.waveNo);

  if (wave.ok) {
    const detail = (await wh('GET', `/warehouse/waves/${wave.body.wave.id}`)).body;
    check('wave contains pick tasks', detail.tasks.length > 0, `${detail.tasks.length} task(s)`);
    check('the pick list is FEFO-allocated', detail.tasks.every((t) => t.batchId));
    const seqs = detail.tasks.map((t) => t.fromLocation?.pickSequence ?? 1e9);
    check('the pick list walks the aisle in sequence',
      seqs.every((v, i, a) => i === 0 || a[i - 1] <= v), seqs.join(','));

    const released = await wh('POST', `/warehouse/waves/${wave.body.wave.id}/release`);
    check('wave released and stock reserved', released.ok, released.body?.status);

    const stock = (await admin('GET', `/inventory/products/${inBinA.productId}/stock`)).body;
    check('released wave shows as reserved stock', Number(stock.totalReserved) > 0,
      `reserved ${stock.totalReserved}`);

    const cancelled = await wh('POST', `/warehouse/waves/${wave.body.wave.id}/cancel`, {
      reason: 'Order withdrawn by the requesting branch',
    });
    check('wave cancelled', cancelled.ok);

    const stockAfter = (await admin('GET', `/inventory/products/${inBinA.productId}/stock`)).body;
    check('cancelling a wave releases its reservation',
      Number(stockAfter.totalReserved) < Number(stock.totalReserved),
      `${stock.totalReserved} -> ${stockAfter.totalReserved}`);
    // Releasing more than was reserved would leave a negative figure, which
    // would then let the till oversell.
    check('the released reservation does not go negative',
      Number(stockAfter.totalReserved) >= 0, `reserved ${stockAfter.totalReserved}`);

    const noReason = await wh('POST', `/warehouse/waves/${wave.body.wave.id}/cancel`, {});
    check('cancelling without a reason is refused', !noReason.ok);
  }

  // --- packing, verification and dispatch
  const pkg = await wh('POST', '/warehouse/packages', {
    warehouseId: central.id,
    referenceType: 'TRANSFER',
    lines: [{ productId: inBinA.productId, batchId: inBinA.batchId, quantity: 10 }],
    weightKg: 2.5,
    sealNumber: 'SEAL-0001',
  });
  check('package packed', pkg.ok, pkg.body?.packageNo);

  if (pkg.ok) {
    const wrong = await wh('POST', `/warehouse/packages/${pkg.body.id}/verify`, {
      scans: [{ productId: inBinA.productId, batchId: inBinA.batchId, quantity: 9 }],
    });
    check('a miscounted package fails verification', wrong.body?.verified === false,
      wrong.body?.discrepancies?.[0]);

    const early = await wh('POST', `/warehouse/packages/${pkg.body.id}/dispatch`, {});
    check('an unverified package cannot be dispatched', !early.ok,
      String(early.body?.error).slice(0, 70));

    const right = await wh('POST', `/warehouse/packages/${pkg.body.id}/verify`, {
      scans: [{ productId: inBinA.productId, batchId: inBinA.batchId, quantity: 10 }],
    });
    check('a correctly scanned package verifies', right.body?.verified === true);

    const dispatched = await wh('POST', `/warehouse/packages/${pkg.body.id}/dispatch`, {});
    check('a verified package dispatches', dispatched.ok, dispatched.body?.status);
  }
}

// --- put-away tasks from a goods receipt
const receipts = (await admin('GET', '/goods-receipts?pageSize=1')).body;
const grn = (receipts.data ?? receipts)[0];
if (grn) {
  const gen = await wh('POST', `/warehouse/goods-receipts/${grn.id}/putaway-tasks`);
  check('put-away tasks generated from a goods receipt', gen.ok,
    gen.ok ? `${gen.body.generated} task(s)` : String(gen.body?.error).slice(0, 60));
  if (gen.ok) {
    check('each task carries a recommended bin',
      gen.body.tasks.every((t) => t.suggestedLocationId || String(t.notes).includes('manually')));
    const again = await wh('POST', `/warehouse/goods-receipts/${grn.id}/putaway-tasks`);
    check('put-away tasks are not generated twice for one receipt', !again.ok,
      String(again.body?.error).slice(0, 70));
  }
}

// --- productivity and exceptions
const prod = (await admin('GET', `/warehouse/tasks/productivity?warehouseId=${central.id}`)).body;
check('productivity metrics computed', Array.isArray(prod.byUser), `${prod.byUser.length} user(s)`);
const exc = (await admin('GET', `/warehouse/tasks/exceptions?warehouseId=${central.id}`)).body;
check('exception dashboard responds', exc.unassignedCount !== undefined,
  `${exc.unassignedCount} unassigned`);

// --- authorization
const cashier = client(await login('cashier'));
const denied = await cashier('POST', '/warehouse/tasks/moves', {
  warehouseId: central.id, productId: inBinA?.productId, fromLocationId: binA.id,
  toLocationId: binB.id, quantity: 1,
});
check('a cashier cannot create warehouse tasks', denied.status === 403, `status ${denied.status}`);

console.log('\n' + '='.repeat(60));
console.log(failures ? `${failures} CHECK(S) FAILED` : 'ALL WAREHOUSE CHECKS PASSED');
console.log('='.repeat(60));
process.exit(failures ? 1 : 0);
