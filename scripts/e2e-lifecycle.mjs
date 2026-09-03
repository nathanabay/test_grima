// Traceability and governance end-to-end: the serial lifecycle, blind and
// frozen counts, loss classification, transfer logistics, supplier credit
// control, patient duplicate governance, cold-chain equipment certification,
// expiry analytics, forecast scoring, controlled-register anomalies and API
// versioning.
//
// Run against a seeded API on :4000.
const BASE = 'http://localhost:4000/api';
let failures = 0;
const skipped = [];
function check(name, ok, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures++;
}
/**
 * A precondition this dataset cannot satisfy.
 *
 * Reported separately and never as a PASS: a check that could not run tells you
 * nothing, and dressing it as a success is how a gap survives a green suite.
 */
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
    if (r.status === 429) console.error('The login throttle is doing its job. Wait a minute and retry.');
    process.exit(1);
  }
  return body.accessToken;
}
function client(token, base = BASE) {
  return async (method, path, body) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { ok: r.ok, status: r.status, body: parsed };
  };
}

const adminToken = await login('admin');
const admin = client(adminToken);
const adminV1 = client(adminToken, 'http://localhost:4000/api/v1');
const cashier = client(await login('cashier'));
const storekeeper = client(await login('storekeeper'));
// The technician is the branch-scoped role that holds inventory.serial.READ;
// the storekeeper does not, so it is the wrong actor for the serial checks.
const technician = client(await login('technician'));
// A branch manager holds every inventory permission AND is scoped to one
// branch. That combination is the only one that actually tests scope: a role
// that lacks the permission would be refused whether or not scope existed, so
// a check written against it proves nothing.
const branchMgr = client(await login('branchmgr'));

const org = (await admin('GET', '/admin/organization')).body;
const branch = org.branches[0];
const warehouse = branch.warehouses[0];

// ============================================================
console.log('\nAPI VERSIONING (§52)');
// ============================================================

const unversioned = await admin('GET', '/inventory/balances?pageSize=1');
const versioned = await adminV1('GET', '/inventory/balances?pageSize=1');
check('the unversioned path still answers', unversioned.ok, `HTTP ${unversioned.status}`);
check('the same route answers under /api/v1', versioned.ok, `HTTP ${versioned.status}`);
check('both paths return the same shape',
  Array.isArray(unversioned.body?.data) && Array.isArray(versioned.body?.data));

// ============================================================
console.log('\nSERIAL LIFECYCLE (§3: features 141-150)');
// ============================================================

const anyBatch = (await admin('GET', '/inventory/batches?pageSize=1')).body.data[0];
const stamp = Date.now();
const serials = [`E2E-${stamp}-A`, `E2E-${stamp}-B`, `E2E-${stamp}-A`];

const imported = await admin('POST', '/serials/import', {
  batchId: anyBatch.id, serials, warehouseId: warehouse.id, referenceNo: 'E2E-IMPORT',
});
check('registering serials creates the unique ones', imported.body?.created === 2,
  `created ${imported.body?.created}`);
check('a serial repeated inside the upload is reported, not silently deduped',
  imported.body?.duplicates?.length === 1, imported.body?.duplicates?.[0]?.reason);

const again = await admin('POST', '/serials/import', {
  batchId: anyBatch.id, serials: [`E2E-${stamp}-A`],
});
check('re-uploading an existing serial is refused rather than overwritten',
  again.body?.created === 0 && again.body?.duplicates?.length === 1,
  again.body?.duplicates?.[0]?.reason);

const found = await admin('GET', `/serials/by-serial/E2E-${stamp}-A`);
check('a pack resolves by the code printed on it', found.ok && found.body.status === 'IN_STOCK',
  `status ${found.body?.status}`);
check('its history opens with a RECEIVED event',
  found.body?.events?.length === 1 && found.body.events[0].eventType === 'RECEIVED');
check('the register offers only the moves the lifecycle allows',
  found.body?.allowedEvents?.includes('DISPENSED') && !found.body.allowedEvents.includes('RECEIVED'),
  (found.body?.allowedEvents ?? []).join(', '));

const packId = found.body.id;
const dispensed = await admin('POST', `/serials/${packId}/events`, {
  eventType: 'DISPENSED', referenceNo: 'E2E-RX', reason: 'End-to-end check',
});
check('a legal movement is recorded', dispensed.ok && dispensed.body.status === 'DISPENSED',
  `HTTP ${dispensed.status}`);

const illegal = await admin('POST', `/serials/${packId}/events`, { eventType: 'DISPENSED' });
check('the same pack cannot be dispensed twice', illegal.status === 409,
  `HTTP ${illegal.status}: ${illegal.body?.error ?? ''}`);

const uncorrected = await admin('POST', `/serials/${packId}/events`, { eventType: 'CORRECTED', correctedTo: 'IN_STOCK' });
check('a correction with no reason is refused', uncorrected.status === 400,
  illegal.body?.error ? '' : uncorrected.body?.error);

const corrected = await admin('POST', `/serials/${packId}/events`, {
  eventType: 'CORRECTED', correctedTo: 'IN_STOCK', reason: 'Keyed against the wrong pack',
});
check('a correction with a reason is accepted', corrected.ok && corrected.body.status === 'IN_STOCK');

const history = await admin('GET', `/serials/${packId}`);
check('the wrong entry stays visible after the correction',
  history.body.events.some((e) => e.eventType === 'DISPENSED') &&
  history.body.events.some((e) => e.eventType === 'CORRECTED'),
  `${history.body.events.length} events`);

const cashierRead = await cashier('GET', '/serials?pageSize=1');
check('a cashier holds no serial permission', cashierRead.status === 403, `HTTP ${cashierRead.status}`);

// ============================================================
console.log('\nLOSS CLASSIFICATION (§21: feature 180)');
// ============================================================

const balance = (await admin('GET', '/inventory/balances?pageSize=1')).body.data[0];
const writeOff = (lossType) => ({
  branchId: balance.branchId, warehouseId: balance.warehouseId,
  reason: 'End-to-end check of loss classification',
  items: [{ productId: balance.productId, batchId: balance.batchId, quantityDelta: -1, lossType }],
});

const unclassified = await admin('POST', '/stock-adjustments', writeOff(undefined));
check('a write-off with no cause is refused', unclassified.status === 400, unclassified.body?.error);

const bogus = await admin('POST', '/stock-adjustments', writeOff('MYSTERY'));
check('an unrecognised cause is refused', bogus.status === 400, bogus.body?.error);

const classified = await admin('POST', '/stock-adjustments', writeOff('DAMAGE'));
check('a classified write-off posts', classified.ok, `HTTP ${classified.status}`);

const foundStock = await admin('POST', '/stock-adjustments', {
  branchId: balance.branchId, warehouseId: balance.warehouseId,
  reason: 'Stock found on the shelf',
  items: [{ productId: balance.productId, batchId: balance.batchId, quantityDelta: 1, lossType: 'DAMAGE' }],
});
check('a positive adjustment carrying a loss type is refused', foundStock.status === 400,
  foundStock.body?.error);

const losses = await admin('GET', '/stock-adjustments/loss-analysis');
check('loss analysis reports by cause',
  losses.ok && losses.body.byType.some((t) => t.lossType === 'DAMAGE'),
  `${losses.body?.byType?.length} cause(s), ${losses.body?.totalValue} total`);

// ============================================================
console.log('\nBLIND AND FROZEN COUNTS (§21: features 175-176)');
// ============================================================

const storeMe = (await storekeeper('GET', '/auth/me')).body;
const counterBranch = org.branches.find((b) => storeMe.branchIds.includes(b.id)) ?? branch;
const counterWarehouse = counterBranch.warehouses[0] ?? warehouse;
const count = await admin('POST', '/stock-counts', {
  warehouseId: counterWarehouse.id, branchId: counterBranch.id, countType: 'RANDOM',
  sampleSize: 3, isBlind: true, freeze: true,
});
check('a blind, frozen count opens', count.ok && count.body.isBlind && count.body.isFrozen,
  `HTTP ${count.status}`);

const countId = count.body.id;
const frozenItem = count.body.items[0];

const blocked = await admin('POST', '/stock-adjustments', {
  branchId: counterBranch.id, warehouseId: counterWarehouse.id,
  reason: 'Should be blocked by the freeze',
  items: [{ productId: frozenItem.productId, batchId: frozenItem.batchId, quantityDelta: -1, lossType: 'DAMAGE' }],
});
check('the freeze stops a movement on a counted position', blocked.status === 409,
  `HTTP ${blocked.status}: ${blocked.body?.error ?? ''}`);

const unfrozen = await admin('POST', `/stock-counts/${countId}/freeze`, { freeze: false });
check('the freeze can be lifted', unfrozen.ok && unfrozen.body.isFrozen === false);

const afterThaw = await admin('POST', '/stock-adjustments', {
  branchId: counterBranch.id, warehouseId: counterWarehouse.id,
  reason: 'Allowed once the freeze is lifted',
  items: [{ productId: frozenItem.productId, batchId: frozenItem.batchId, quantityDelta: -1, lossType: 'COUNTING_ERROR' }],
});
check('the same movement is accepted once the freeze is lifted', afterThaw.ok,
  `HTTP ${afterThaw.status}: ${afterThaw.body?.error ?? ''}`);

// The counter role sees no system quantity; a supervisor does.
const blindRead = await storekeeper('GET', `/stock-counts/${countId}`);
check('a blind count hides the expected quantity from the counter',
  blindRead.ok && blindRead.body.blindMasked === true && blindRead.body.items[0].systemQty === null,
  `masked=${blindRead.body?.blindMasked}`);

const supervisorRead = await admin('GET', `/stock-counts/${countId}`);
check('a supervisor who must judge the variance still sees it',
  supervisorRead.body.blindMasked === false && supervisorRead.body.items[0].systemQty !== null);

// ============================================================
console.log('\nTRANSFER LOGISTICS (§20: feature 233)');
// ============================================================

const overdue = await admin('GET', '/transfers/overdue');
check('overdue transfers are reported with a severity', Array.isArray(overdue.body),
  `${overdue.body?.length ?? 0} overdue`);
check('every overdue row states why it is considered late',
  (overdue.body ?? []).every((t) => t.expectedBasis && typeof t.daysLate === 'number'),
  (overdue.body ?? []).map((t) => `${t.transferNo} ${t.daysLate}d`).join(', ') || 'none in transit');

// ============================================================
console.log('\nSUPPLIER RISK AND CREDIT (§13: features 274-278)');
// ============================================================

const supplier = (await admin('GET', '/suppliers?pageSize=1')).body.data[0];

const badRisk = await admin('PATCH', `/suppliers/${supplier.id}`, { riskLevel: 'APOCALYPTIC' });
check('an unrecognised risk level is refused', badRisk.status === 400, badRisk.body?.error);

// Read the score first and then try to write a DIFFERENT value. Asserting
// against a fixed number cannot tell "the write was ignored" from "it was
// already that number", and on a fresh seed it is already 100.
const scoreBefore = Number((await admin('GET', `/suppliers/${supplier.id}`)).body.supplierScore);
const tampered = await admin('PATCH', `/suppliers/${supplier.id}`, {
  supplierScore: scoreBefore === 42 ? 43 : 42,
  onTimeDeliveryRate: 1,
  riskLevel: 'HIGH',
});
const afterTamper = (await admin('GET', `/suppliers/${supplier.id}`)).body;
check('a client cannot write the computed supplier score',
  tampered.ok && Number(afterTamper.supplierScore) === scoreBefore,
  `score stayed ${afterTamper.supplierScore} (was ${scoreBefore})`);
check('the risk level it was allowed to set did apply', afterTamper.riskLevel === 'HIGH');

const credit = await admin('GET', `/suppliers/${supplier.id}/credit`);
check('credit exposure is reported against the agreed limit', credit.ok,
  `outstanding ${credit.body?.outstanding}, limit ${credit.body?.creditLimit}`);

const dependency = await admin('GET', '/suppliers/dependency-analysis');
check('single-source dependency is analysed', dependency.ok && Array.isArray(dependency.body.rows),
  `${dependency.body?.singleSourcedCount} single-sourced, ${dependency.body?.atRiskCount} on a risky supplier`);

// A credit limit of 1 makes any order breach it, which is the check we want.
await admin('PATCH', `/suppliers/${supplier.id}`, { creditLimit: 1 });
const po = await admin('POST', '/purchase-orders', {
  supplierId: supplier.id, branchId: branch.id, warehouseId: warehouse.id,
  items: [{ productId: balance.productId, orderedQty: 10, unitPrice: 100 }],
});
if (po.ok) {
  for (const next of ['SUBMITTED', 'PROCUREMENT_REVIEW', 'FINANCE_REVIEW']) {
    await admin('POST', `/purchase-orders/${po.body.id}/transition`, { status: next });
  }
  const approve = await admin('POST', `/purchase-orders/${po.body.id}/transition`, { status: 'APPROVED' });
  check('approving past the credit limit is refused', approve.status === 400,
    `HTTP ${approve.status}: ${approve.body?.error ?? ''}`);

  await admin('PATCH', `/suppliers/${supplier.id}`, { creditLimit: 0 });
  const allowed = await admin('POST', `/purchase-orders/${po.body.id}/transition`, { status: 'APPROVED' });
  check('with no limit agreed the same order approves', allowed.ok,
    `HTTP ${allowed.status}: ${allowed.body?.error ?? ''}`);
} else {
  check('approving past the credit limit is refused', false, `could not raise a PO: ${po.body?.error}`);
}

// ============================================================
console.log('\nPATIENT GOVERNANCE (§14: features 656-659)');
// ============================================================

const dup = `+251 91 ${String(stamp).slice(-6)}`;
const p1 = await admin('POST', '/patients', { fullName: 'Test Duplicate', phone: dup, dateOfBirth: '1990-01-01' });
const p2 = await admin('POST', '/patients', { fullName: 'Test  duplicate', phone: dup.replace(/\D/g, ''), dateOfBirth: '1990-01-01' });
check('two patients can be created for the duplicate check', p1.ok && p2.ok);

const dups = await admin('GET', '/patients/duplicates');
const group = (dups.body?.groups ?? []).find((g) =>
  g.records.some((r) => r.id === p1.body.id) && g.records.some((r) => r.id === p2.body.id));
check('differently formatted phone numbers are matched as one person', !!group,
  group?.matchedOn ?? 'no group found');

const selfMerge = await admin('POST', `/patients/${p1.body.id}/merge`, { targetId: p1.body.id });
check('a patient cannot be merged into themselves', selfMerge.status === 400, selfMerge.body?.error);

const merged = await admin('POST', `/patients/${p2.body.id}/merge`, {
  targetId: p1.body.id, reason: 'End-to-end duplicate check',
});
check('the duplicate merges into the survivor', merged.ok, `HTTP ${merged.status}: ${merged.body?.error ?? ''}`);

const remerge = await admin('POST', `/patients/${p2.body.id}/merge`, { targetId: p1.body.id, reason: 'again' });
check('a record already merged cannot be merged again', remerge.status === 409, remerge.body?.error);

const editMerged = await admin('PATCH', `/patients/${p2.body.id}`, { city: 'Addis Ababa' });
check('the merged-away record cannot be edited', editMerged.status === 409, editMerged.body?.error);

const noReason = await admin('POST', `/patients/${p1.body.id}/anonymize`, {});
check('anonymisation without a stated reason is refused', noReason.status === 400, noReason.body?.error);

const anonymised = await admin('POST', `/patients/${p1.body.id}/anonymize`, {
  reason: 'End-to-end erasure check',
});
check('anonymisation clears the identity', anonymised.ok && anonymised.body.isAnonymized);

const readBack = await admin('GET', `/patients/${p1.body.id}`);
check('the pharmacy record survives with no identifying data',
  readBack.ok && readBack.body.phone === null && readBack.body.dateOfBirth === null,
  readBack.body?.fullName);

const editAnon = await admin('PATCH', `/patients/${p1.body.id}`, { phone: '0911000000' });
check('an anonymised record cannot be edited back', editAnon.status === 409, editAnon.body?.error);

// ============================================================
console.log('\nCOLD-CHAIN EQUIPMENT (§27: features 897-899)');
// ============================================================

const sensors = await admin('GET', '/cold-chain/live');
if (sensors.body?.length) {
  const sensorId = sensors.body[0].sensorId;
  check('a live reading states whether its sensor is calibrated',
    !!sensors.body[0].calibrationStatus, sensors.body[0].calibrationStatus);

  const fail = await admin('POST', `/cold-chain/equipment/${sensorId}/calibrations`, {
    result: 'FAIL', certificateNo: 'E2E-FAIL', performedBy: 'End-to-end check',
  });
  check('a failed calibration is recorded', fail.ok, `HTTP ${fail.status}`);

  const afterFail = (await admin('GET', `/cold-chain/equipment/${sensorId}`)).body;
  // Not merely "does not extend": a failure revokes the certificate the sensor
  // was still carrying, so this holds whether or not it was calibrated before.
  check('a failed calibration revokes the sensor\'s calibration',
    afterFail.calibrationStatus !== 'VALID', afterFail.calibrationStatus);

  const pass = await admin('POST', `/cold-chain/equipment/${sensorId}/calibrations`, {
    result: 'PASS', certificateNo: 'E2E-PASS',
  });
  const afterPass = (await admin('GET', `/cold-chain/equipment/${sensorId}`)).body;
  check('a passing calibration sets the due date', pass.ok && afterPass.calibrationStatus === 'VALID',
    afterPass.calibrationDueAt);

  const future = await admin('POST', `/cold-chain/equipment/${sensorId}/calibrations`, {
    calibratedAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
  });
  check('a calibration dated in the future is refused', future.status === 400, future.body?.error);

  const noDescription = await admin('POST', `/cold-chain/equipment/${sensorId}/maintenance`, {
    workType: 'PREVENTIVE', description: '   ',
  });
  check('a service record with no description is refused', noDescription.status === 400,
    noDescription.body?.error);

  const service = await admin('POST', `/cold-chain/equipment/${sensorId}/maintenance`, {
    workType: 'BATTERY', description: 'Battery replaced during the end-to-end check',
    nextDueAt: new Date(Date.now() + 180 * 86_400_000).toISOString(),
  });
  check('a service record is accepted', service.ok, `HTTP ${service.status}`);

  const due = await admin('GET', '/cold-chain/equipment/due');
  check('equipment due for attention is listed', due.ok && Array.isArray(due.body.rows),
    `${due.body?.rows?.length} of ${due.body?.activeSensors} sensor(s)`);
} else {
  skip('cold-chain equipment checks', 'no sensors configured in this dataset');
}

// ============================================================
console.log('\nEXPIRY ANALYTICS (§9: features 108-112)');
// ============================================================

const calendar = await admin('GET', '/inventory/expiry/calendar?months=12');
check('the expiry calendar returns a month series', calendar.ok && Array.isArray(calendar.body.rows),
  `${calendar.body?.rows?.length} month(s), peak ${calendar.body?.peakMonth?.month ?? 'none'}`);

const trend = await admin('GET', '/inventory/expiry/trend?months=12');
check('the write-off trend reads the ledger', trend.ok && Array.isArray(trend.body.series),
  `${trend.body?.series?.length} month(s), ${trend.body?.totalValue} written off`);

for (const dimension of ['branch', 'category', 'supplier']) {
  const comparison = await admin('GET', `/inventory/expiry/comparison?dimension=${dimension}`);
  check(`expiry exposure compares by ${dimension}`,
    comparison.ok && comparison.body.dimension === dimension,
    `${comparison.body?.rows?.length} group(s)`);
}

// ============================================================
console.log('\nFORECAST SCORING AND CONTROLLED ANOMALIES (§39, §28)');
// ============================================================

const top = (await admin('GET', '/analytics/forecast?limit=1')).body;
const forecastProduct = Array.isArray(top) ? top[0] : top?.[0] ?? top?.data?.[0];
if (forecastProduct?.productId) {
  const accuracy = await admin('GET', `/analytics/forecast/${forecastProduct.productId}/accuracy`);
  check('forecast accuracy is measured against what happened', accuracy.ok,
    accuracy.body?.bestMethod
      ? `best ${accuracy.body.bestMethod.method} at ${accuracy.body.bestMethod.mapePercent}%`
      : accuracy.body?.message);
  check('too little history reports as insufficient rather than as a perfect score',
    accuracy.body.evaluatedPoints > 0 || typeof accuracy.body.message === 'string');
} else {
  check('forecast accuracy is measured against what happened', false, 'no product to forecast');
}

const anomalies = await admin('GET', '/controlled-register/anomalies?days=365');
check('controlled-register anomalies are reported', anomalies.ok && Array.isArray(anomalies.body.signals),
  `${anomalies.body?.entriesExamined} entries, ${anomalies.body?.signals?.length} signal(s)`);
check('the report says plainly that a signal is not a finding',
  typeof anomalies.body?.note === 'string' && /not findings/i.test(anomalies.body.note));

// ============================================================
console.log('\nBRANCH SCOPE ON WRITES AND READS (§4)');
// ============================================================

// A storekeeper is scoped to one branch. Everything below asks whether that
// scope actually holds when the request names somebody else's branch.
const storeUser = storeMe;
const mgrUser = (await branchMgr('GET', '/auth/me')).body;
check('the branch manager holds the permissions these checks need, and one branch',
  mgrUser.permissions.includes('inventory.adjustment.CREATE') &&
    mgrUser.permissions.includes('inventory.adjustment.READ') &&
    mgrUser.branchIds.length === 1,
  `${mgrUser.branchIds.length} branch(es)`);

const otherBranch = org.branches.find((b) => !mgrUser.branchIds.includes(b.id));

if (otherBranch && mgrUser.branchIds.length) {
  const otherWarehouse = otherBranch.warehouses[0];
  const otherBalance = (await admin(
    'GET',
    `/inventory/balances?warehouseId=${otherWarehouse.id}&pageSize=1`,
  )).body.data?.[0];

  if (otherBalance?.batchId) {
    const crossBranchWriteOff = await branchMgr('POST', '/stock-adjustments', {
      branchId: otherBranch.id,
      warehouseId: otherWarehouse.id,
      reason: 'Should be refused: another branch',
      items: [{
        productId: otherBalance.productId,
        batchId: otherBalance.batchId,
        quantityDelta: -1,
        lossType: 'SHRINKAGE',
      }],
    });
    check('a user WITH the permission still cannot write off another branch\'s stock',
      crossBranchWriteOff.status === 403,
      `HTTP ${crossBranchWriteOff.status}: ${crossBranchWriteOff.body?.error ?? ''}`);
  }

  const otherCount = await admin('POST', '/stock-counts', {
    warehouseId: otherWarehouse.id, branchId: otherBranch.id,
    countType: 'RANDOM', sampleSize: 2,
  });
  if (otherCount.ok) {
    const foreignRecord = await branchMgr('POST', `/stock-counts/${otherCount.body.id}/record`, {
      lines: [{ itemId: otherCount.body.items[0].id, countedQty: 1 }],
    });
    check('a scoped user cannot record against another branch\'s count',
      foreignRecord.status === 403,
      `HTTP ${foreignRecord.status}: ${foreignRecord.body?.error ?? ''}`);

    const foreignRead = await branchMgr('GET', `/stock-counts/${otherCount.body.id}`);
    check('nor read it', foreignRead.status === 403, `HTTP ${foreignRead.status}`);
  }

  const foreignLoss = await branchMgr('GET', `/stock-adjustments/loss-analysis?branchId=${otherBranch.id}`);
  check('nor pull another branch\'s loss analysis', foreignLoss.status === 403,
    `HTTP ${foreignLoss.status}: ${foreignLoss.body?.error ?? ''}`);

  const scopedCounts = await branchMgr('GET', '/stock-counts?pageSize=100');
  check('the count list is filtered to the reader\'s branches',
    scopedCounts.ok && (scopedCounts.body.data ?? []).every((c) => mgrUser.branchIds.includes(c.branchId)),
    `${scopedCounts.body?.data?.length ?? 0} count(s) returned`);
} else {
  skip('branch scope checks', 'the counter role is unscoped in this dataset');
}

// A serial held in another branch must not be reachable, listed, or moved.
//
// The pack is planted deliberately rather than found in the dataset: picking
// whichever serial happens to be out of scope makes the check depend on the
// seed, and it silently degenerates into "there wasn't one" on a dataset where
// the reader can reach everything.
if (otherBranch) {
  const foreignWarehouse = otherBranch.warehouses[0];
  const foreignBatch = (await admin(
    'GET',
    `/inventory/balances?warehouseId=${foreignWarehouse.id}&pageSize=1`,
  )).body.data?.[0];

  if (foreignBatch?.batchId) {
    const planted = `E2E-SCOPE-${stamp}`;
    const planting = await admin('POST', '/serials/import', {
      batchId: foreignBatch.batchId,
      serials: [planted],
      warehouseId: foreignWarehouse.id,
      referenceNo: 'E2E-SCOPE',
    });
    check('a pack can be registered into a branch the reader cannot reach',
      planting.body?.created === 1, `created ${planting.body?.created}`);

    const found = await admin('GET', `/serials/by-serial/${planted}`);
    const plantedId = found.body?.id;

    const listed = await branchMgr('GET', '/serials?pageSize=500');
    check('the serial register does not list a pack from another branch',
      listed.ok && !(listed.body.data ?? []).some((r) => r.id === plantedId),
      `${listed.body?.data?.length ?? 0} pack(s) visible`);

    const peek = await branchMgr('GET', `/serials/${plantedId}`);
    check('nor can that pack be opened directly by its id', peek.status === 403,
      `HTTP ${peek.status}: ${peek.body?.error ?? ''}`);

    const move = await branchMgr('POST', `/serials/${plantedId}/events`, {
      eventType: 'DESTROYED', reason: 'Should be refused: another branch',
    });
    check('nor destroyed by a permitted user omitting the warehouse from the request',
      move.status === 403, `HTTP ${move.status}: ${move.body?.error ?? ''}`);

    const stillThere = await admin('GET', `/serials/${plantedId}`);
    check('and the pack is untouched afterwards', stillThere.body?.status === 'IN_STOCK',
      stillThere.body?.status);
  } else {
    skip('serial branch-scope checks', 'no stock in the other branch to attach a serial to');
  }
}

// ============================================================
console.log('\nBLIND COUNT CANNOT BE UNMASKED EARLY (§21)');
// ============================================================

const storeBranch = org.branches.find((b) => storeUser.branchIds.includes(b.id)) ?? branch;
const storeWarehouse = storeBranch.warehouses[0] ?? warehouse;
const blind = await admin('POST', '/stock-counts', {
  warehouseId: storeWarehouse.id, branchId: storeBranch.id,
  countType: 'RANDOM', sampleSize: 3, isBlind: true,
});
if (blind.ok && blind.body.items.length > 1) {
  const blindId = blind.body.id;
  await storekeeper('POST', `/stock-counts/${blindId}/record`, {
    lines: [{ itemId: blind.body.items[0].id, countedQty: 1 }],
  });
  const peekAfterOneLine = await storekeeper('GET', `/stock-counts/${blindId}`);
  check('recording one line does not reveal the rest of a blind sheet',
    peekAfterOneLine.body?.blindMasked === true &&
      peekAfterOneLine.body.items.every((i) => i.systemQty === null),
    `masked=${peekAfterOneLine.body?.blindMasked}`);

  const rest = blind.body.items.slice(1).map((i) => ({ itemId: i.id, countedQty: 1 }));
  await storekeeper('POST', `/stock-counts/${blindId}/record`, { lines: rest });
  const afterAll = await storekeeper('GET', `/stock-counts/${blindId}`);
  check('the sheet is revealed once every line is counted',
    afterAll.body?.blindMasked === false,
    `masked=${afterAll.body?.blindMasked}, status ${afterAll.body?.status}`);
} else {
  skip('blind-count reveal', 'not enough positions to open a multi-line blind count');
}

// ============================================================
console.log('\nSTOCK INTEGRITY GUARDS (§20, §28)');
// ============================================================

// A payload naming the same transfer line twice used to collapse to one ledger
// movement while the document counted both — the destination could then receive
// stock that never left the origin.
const wh2 = org.branches.flatMap((b) => b.warehouses).find((w) => w.id !== warehouse.id);
if (wh2) {
  const src = (await admin('GET', `/inventory/balances?warehouseId=${warehouse.id}&pageSize=1`)).body.data?.[0];
  if (src?.batchId) {
    const draft = await admin('POST', '/transfers', {
      fromWarehouseId: warehouse.id, toWarehouseId: wh2.id,
      reason: 'End-to-end duplicate-line check',
      items: [{ productId: src.productId, batchId: src.batchId, quantity: 4 }],
    });
    if (draft.ok) {
      await admin('POST', `/transfers/${draft.body.id}/submit`, {});
      await admin('POST', `/transfers/${draft.body.id}/approve`, {});
      const itemId = draft.body.items[0].id;

      const doubled = await admin('POST', `/transfers/${draft.body.id}/dispatch`, {
        lines: [{ itemId, quantity: 2 }, { itemId, quantity: 2 }],
      });
      check('a transfer payload naming one line twice is refused',
        doubled.status === 400, `HTTP ${doubled.status}: ${doubled.body?.error ?? ''}`);

      const partial = await admin('POST', `/transfers/${draft.body.id}/dispatch`, {
        lines: [{ itemId, quantity: 2 }], vehicleOrCourier: 'First truck',
      });
      check('a partial dispatch is accepted', partial.ok, `HTTP ${partial.status}`);

      const second = await admin('POST', `/transfers/${draft.body.id}/dispatch`, {
        lines: [{ itemId, quantity: 2 }],
      });
      check('and the rest can follow on a later truck', second.ok,
        `HTTP ${second.status}: ${second.body?.error ?? ''}`);

      const after = (await admin('GET', `/transfers/${draft.body.id}`)).body;
      check('the second dispatch does not erase the first truck\'s courier',
        after.vehicleOrCourier === 'First truck', String(after.vehicleOrCourier));

      const resubmit = await admin('POST', `/transfers/${draft.body.id}/submit`, {});
      check('an in-transit transfer cannot be dragged back to submitted',
        resubmit.status === 409, `HTTP ${resubmit.status}: ${resubmit.body?.error ?? ''}`);
    }
  }
}

// A controlled-register entry reversed twice puts the register permanently
// above physical stock.
//
// Every register write needs a witness while controlled.requireDualAuthorization
// is on, so one is named here. This check used to be skipped for want of a
// register entry to reverse; e2e-dispensing now creates one.
const witness = (await admin('GET', '/admin/users?pageSize=50')).body?.data
  ?.find((u) => u.username === 'pharmacist2' || u.username === 'manager');
const register = (await admin('GET', '/controlled-register?pageSize=50')).body;
const reversible = (register.data ?? []).find(
  (e) => e.entryType !== 'REVERSAL' && !e.reversalOfId,
);
if (reversible && witness) {
  const first = await admin('POST', `/controlled-register/${reversible.id}/reverse`, {
    reason: 'End-to-end reversal check',
    witnessedById: witness.id,
  });
  check('a register entry can be reversed once', first.ok,
    `HTTP ${first.status}: ${first.body?.error ?? ''}`);

  const again = await admin('POST', `/controlled-register/${reversible.id}/reverse`, {
    reason: 'Should be refused: already reversed',
    witnessedById: witness.id,
  });
  check('but not twice', again.status === 409, `HTTP ${again.status}: ${again.body?.error ?? ''}`);

  if (first.ok) {
    const reversalOfReversal = await admin('POST', `/controlled-register/${first.body.id}/reverse`, {
      reason: 'Should be refused: reversing a reversal',
      witnessedById: witness.id,
    });
    check('and a reversal cannot itself be reversed', reversalOfReversal.status === 409,
      `HTTP ${reversalOfReversal.status}`);
  }
} else {
  skip('controlled-register reversal',
    !reversible
      ? 'the register holds no reversible entry — run e2e-dispensing first, which opens the ' +
        'register and makes a witnessed controlled supply'
      : 'no second user is available to witness the reversal');
}

// ============================================================
console.log('\nTIMELINE AUTHORIZATION (§25, §42)');
// ============================================================

const pharmacist = client(await login('pharmacist'));
const anyPatient = (await pharmacist('GET', '/patients?pageSize=1')).body.data?.[0];
if (anyPatient) {
  const cashierTimeline = await cashier('GET', `/timeline/PATIENT/${anyPatient.id}`);
  check('a cashier cannot read a patient timeline', cashierTimeline.status === 403,
    `HTTP ${cashierTimeline.status}: ${cashierTimeline.body?.error ?? ''}`);

  const clinicalTimeline = await pharmacist('GET', `/timeline/PATIENT/${anyPatient.id}`);
  check('a pharmacist can', clinicalTimeline.ok, `HTTP ${clinicalTimeline.status}`);

  const productTimeline = await cashier('GET', `/timeline/PRODUCT/${anyPatient.id}`);
  check('a product timeline is not gated behind the clinical check',
    productTimeline.ok, `HTTP ${productTimeline.status}`);

  const nonsense = await pharmacist('GET', `/timeline/NONSENSE/${anyPatient.id}`);
  check('an unknown timeline type is refused rather than returning an empty one',
    nonsense.status === 400, nonsense.body?.error);
} else {
  check('a cashier cannot read a patient timeline', false, 'no patient in the dataset');
}

// ============================================================
console.log('\nAUDIT');
// ============================================================

const chain = await admin('GET', '/admin/audit-logs/verify');
check('the audit hash chain still verifies after all of the above',
  chain.body?.valid === true, `${chain.body?.checked ?? 0} entries checked`);

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
console.log('ALL LIFECYCLE AND GOVERNANCE CHECKS PASSED');
console.log('='.repeat(60));
