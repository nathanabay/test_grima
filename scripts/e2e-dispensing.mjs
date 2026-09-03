// Prescriptions and dispensing end to end: entry, validation, the clinical
// checks, FEFO supply, substitution, controlled-drug rules, collection,
// repeats, reversal and branch scoping.
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
const key = () => `e2e-dsp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const admin = client(await login('admin'));
const pharmacist = client(await login('pharmacist'));
const pharmacist2 = client(await login('pharmacist2'));

const me = (await pharmacist('GET', '/auth/me')).body;
const me2 = (await pharmacist2('GET', '/auth/me')).body;
const org = (await admin('GET', '/admin/organization')).body;
const branch = org.branches.find((b) => me.branchIds.includes(b.id)) ?? org.branches[0];
const warehouse = branch.warehouses.find((w) => !w.isColdRoom) ?? branch.warehouses[0];

const patients = (await pharmacist('GET', '/patients?pageSize=5')).body;
const patient = patients.data?.[0];
if (!patient) {
  console.error('\nNo patients in this dataset — cannot exercise dispensing.');
  process.exit(1);
}

// A product with real stock in this warehouse, not controlled, so the ordinary
// path is exercised without tripping the controlled rules.
const balances = (await pharmacist('GET', `/inventory/balances?warehouseId=${warehouse.id}&pageSize=100`)).body;
const stocked = (balances.data ?? []).filter((b) => Number(b.onHand) > 20);
let product = null;
for (const b of stocked) {
  const p = (await pharmacist('GET', `/products/${b.productId}`)).body;
  if (p?.id && !p.isControlled && p.isActive) { product = p; break; }
}
if (!product) {
  console.error('\nNo uncontrolled product with stock in this warehouse — cannot exercise dispensing.');
  process.exit(1);
}

async function newPrescription(overrides = {}, items = null) {
  return pharmacist('POST', '/prescriptions', {
    patientId: patient.id,
    branchId: branch.id,
    prescriberName: 'Dr Almaz Tesfaye',
    prescriberLicense: 'ETH-MD-4410',
    prescriptionDate: new Date().toISOString().slice(0, 10),
    items: items ?? [{ productId: product.id, prescribedQty: 10, dosage: '1 tablet', frequency: 'twice a day', durationDays: 5 }],
    ...overrides,
  });
}

// ============================================================
console.log('\nPRESCRIPTION ENTRY AND VALIDATION (§23)');
// ============================================================

{
  const created = await newPrescription();
  check('a prescription can be recorded', created.ok && !!created.body.prescriptionNo,
    created.ok ? created.body.prescriptionNo : JSON.stringify(created.body));
  check('it gets a validity date even when none was written',
    !!created.body?.validUntil,
    String(created.body?.validUntil));
  check('it starts as NEW, not approved', created.body?.status === 'NEW', String(created.body?.status));
}

{
  const r = await newPrescription({}, []);
  check('a prescription with no items is refused', r.status === 400, `HTTP ${r.status}`);
}
{
  const r = await newPrescription({ prescriberName: '  ' });
  check('a prescription with no prescriber is refused', r.status === 400, `HTTP ${r.status}`);
}
{
  const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const r = await newPrescription({ prescriptionDate: future });
  check('a prescription dated in the future is refused', r.status === 400, `HTTP ${r.status}`);
}
{
  const r = await newPrescription({}, [{ productId: product.id, prescribedQty: 0 }]);
  check('a line with no quantity is refused', r.status === 400, `HTTP ${r.status}`);
}
{
  const r = await newPrescription({}, [{ productId: '00000000-0000-4000-8000-000000000000', prescribedQty: 5 }]);
  check('a line naming a product that does not exist is refused', r.status === 400, `HTTP ${r.status}`);
}
{
  const past = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
  const created = await newPrescription({ prescriptionDate: past, validUntil: new Date(Date.now() - 300 * 86400000).toISOString().slice(0, 10) });
  const approved = await pharmacist('POST', `/prescriptions/${created.body.id}/review`, { decision: 'APPROVE' });
  check('an expired prescription cannot be approved', approved.status === 409, `HTTP ${approved.status}`);
}
{
  const created = await newPrescription();
  const rejected = await pharmacist('POST', `/prescriptions/${created.body.id}/review`, { decision: 'REJECT' });
  check('rejecting without a reason is refused', rejected.status === 400, `HTTP ${rejected.status}`);
  const ok = await pharmacist('POST', `/prescriptions/${created.body.id}/review`, { decision: 'REJECT', reason: 'Illegible' });
  check('rejecting with a reason works', ok.ok && ok.body.status === 'REJECTED', String(ok.body?.status));
  const again = await pharmacist('POST', `/prescriptions/${created.body.id}/review`, { decision: 'APPROVE' });
  check('a decided prescription cannot be decided again', again.status === 400, `HTTP ${again.status}`);
}

// ============================================================
console.log('\nTHE QUEUE (§23)');
// ============================================================

{
  const q = await pharmacist('GET', '/prescriptions/queue');
  check('the queue reads', q.ok && Array.isArray(q.body.data), `HTTP ${q.status}`);
  check('it reports a waiting time per prescription',
    q.body.data.length === 0 || typeof q.body.data[0].waitingMinutes === 'number');
  check('it counts what is waiting on what',
    !!q.body.counts && typeof q.body.counts.awaitingReview === 'number');

  const urgent = await newPrescription({ isUrgent: true });
  const after = await pharmacist('GET', '/prescriptions/queue');
  const index = after.body.data.findIndex((p) => p.id === urgent.body.id);
  const firstNonUrgent = after.body.data.findIndex((p) => !p.isUrgent);
  check('an urgent prescription sorts ahead of the ordinary ones',
    index >= 0 && (firstNonUrgent === -1 || index < firstNonUrgent),
    `urgent at ${index}, first ordinary at ${firstNonUrgent}`);
}

// ============================================================
console.log('\nCLINICAL CHECKS (§24)');
// ============================================================

let approvedRx = null;
{
  const created = await newPrescription();
  await pharmacist('POST', `/prescriptions/${created.body.id}/review`, { decision: 'APPROVE' });
  approvedRx = (await pharmacist('GET', `/prescriptions/${created.body.id}`)).body;

  const preview = await pharmacist('POST', '/dispensing/preview', {
    prescriptionId: approvedRx.id,
    patientId: patient.id,
    branchId: branch.id,
    warehouseId: warehouse.id,
    lines: [{ productId: product.id, prescriptionItemId: approvedRx.items[0].id, quantity: 10 }],
  });
  check('a preview runs without dispensing anything', preview.ok, `HTTP ${preview.status}`);
  check('the preview returns the warnings', Array.isArray(preview.body?.warnings));
  check('the preview shows what FEFO would pick',
    Array.isArray(preview.body?.allocation) && preview.body.allocation.length === 1);
  check('the preview names the batch and its expiry',
    !!preview.body?.allocation?.[0]?.batches?.[0]?.batchId &&
    preview.body.allocation[0].batches[0].expiryDate !== undefined);
  check('the preview says the checks are advisory',
    typeof preview.body?.note === 'string' && /advisor/i.test(preview.body.note));

  const before = (await pharmacist('GET', `/dispensing?prescriptionId=${approvedRx.id}`)).body;
  check('the preview supplied nothing', before.total === 0, `${before.total} dispensing(s)`);
}

// A patient with a documented allergy to what is being supplied should raise a
// CRITICAL warning, and that warning must block an unacknowledged supply.
{
  const allergyWord = (product.genericName ?? '').split(/\s+/)[0];
  if (!allergyWord || allergyWord.length < 4) {
    skip('an allergy raises a critical warning', 'the product name has no word long enough to match on');
  } else {
    const created = await admin('POST', '/patients', {
      fullName: `E2E Allergy ${Date.now()}`,
      // A free-text allergy field, as a receptionist would actually type it.
      allergies: `Reacted badly to ${allergyWord} in 2024 — rash`,
    });
    if (!created.ok) {
      skip('an allergy raises a critical warning', `could not create a patient: HTTP ${created.status}`);
    } else {
      const rx = await pharmacist('POST', '/prescriptions', {
        patientId: created.body.id,
        branchId: branch.id,
        prescriberName: 'Dr Almaz Tesfaye',
        items: [{ productId: product.id, prescribedQty: 4 }],
      });
      await pharmacist('POST', `/prescriptions/${rx.body.id}/review`, { decision: 'APPROVE' });
      const full = (await pharmacist('GET', `/prescriptions/${rx.body.id}`)).body;
      const body = {
        prescriptionId: rx.body.id,
        patientId: created.body.id,
        branchId: branch.id,
        warehouseId: warehouse.id,
        lines: [{ productId: product.id, prescriptionItemId: full.items[0].id, quantity: 4 }],
      };
      const preview = await pharmacist('POST', '/dispensing/preview', body);
      const critical = (preview.body?.warnings ?? []).filter((w) => w.severity === 'CRITICAL');
      check('a documented allergy raises a critical warning', critical.length > 0,
        JSON.stringify((preview.body?.warnings ?? []).map((w) => w.code)));
      check('the warning says what to do about it',
        critical.every((w) => typeof w.action === 'string' && w.action.length > 0));

      const blocked = await pharmacist('POST', '/dispensing', { ...body, idempotencyKey: key() });
      check('supplying past a critical warning without a reason is refused',
        blocked.status === 409, `HTTP ${blocked.status}`);

      const allowed = await pharmacist('POST', '/dispensing', {
        ...body,
        idempotencyKey: key(),
        overrides: critical.map((w) => ({ code: w.code, reason: 'Prescriber confirmed by phone' })),
      });
      check('supplying with a reason recorded works', allowed.ok, `HTTP ${allowed.status}`);
      check('the reason is kept on the dispensing',
        Array.isArray(allowed.body?.overriddenWarnings) && allowed.body.overriddenWarnings.length > 0,
        JSON.stringify(allowed.body?.overriddenWarnings));
    }
  }
}

// ============================================================
console.log('\nDISPENSING (§24)');
// ============================================================

let dispensed = null;
{
  const line = { productId: product.id, prescriptionItemId: approvedRx.items[0].id, quantity: 6 };
  const body = {
    prescriptionId: approvedRx.id,
    patientId: patient.id,
    branchId: branch.id,
    warehouseId: warehouse.id,
    counsellingNotes: 'Take with food; finish the course.',
    lines: [line],
  };
  const idempotencyKey = key();
  const first = await pharmacist('POST', '/dispensing', { ...body, idempotencyKey });
  check('a partial supply is allowed', first.ok, `HTTP ${first.status} ${JSON.stringify(first.body).slice(0, 200)}`);
  dispensed = first.body;

  const replay = await pharmacist('POST', '/dispensing', { ...body, idempotencyKey });
  check('replaying the same key does not dispense twice',
    replay.ok && replay.body.id === first.body.id,
    `${first.body?.id} vs ${replay.body?.id}`);

  const rx = (await pharmacist('GET', `/prescriptions/${approvedRx.id}`)).body;
  check('the prescription is PARTIALLY_DISPENSED after a partial supply',
    rx.status === 'PARTIALLY_DISPENSED', String(rx.status));
  check('the outstanding quantity went down',
    Number(rx.items[0].dispensedQty) === 6, String(rx.items[0].dispensedQty));

  const over = await pharmacist('POST', '/dispensing', {
    ...body, idempotencyKey: key(),
    lines: [{ ...line, quantity: 10 }],
  });
  check('supplying more than remains on the prescription is refused',
    over.status === 409, `HTTP ${over.status}`);

  check('the counselling note is kept',
    typeof first.body?.counsellingNotes === 'string' && first.body.counsellingNotes.length > 0);
}

{
  const label = await pharmacist('GET', `/dispensing/${dispensed.id}/label`);
  check('the label reads in one request', label.ok, `HTTP ${label.status}`);
  check('it names the patient', !!label.body?.patientName);
  check('it carries the batch and expiry',
    !!label.body?.items?.[0]?.batchNumber && !!label.body?.items?.[0]?.expiryDate);
  check('it carries directions the patient can act on',
    typeof label.body?.items?.[0]?.directions === 'string' && label.body.items[0].directions.length > 0,
    String(label.body?.items?.[0]?.directions));

  const printed = await pharmacist('POST', `/dispensing/${dispensed.id}/label`);
  check('a print is counted', printed.ok && printed.body.labelPrintCount >= 1,
    String(printed.body?.labelPrintCount));
  const reprinted = await pharmacist('POST', `/dispensing/${dispensed.id}/label`);
  check('a reprint is counted rather than refused',
    reprinted.ok && reprinted.body.labelPrintCount > printed.body.labelPrintCount);
}

// ============================================================
console.log('\nSUBSTITUTION (§23)');
// ============================================================

{
  // Look across everything stocked here for a pair the catalogue actually
  // records as equivalent, rather than giving up on the first product.
  const stockedIds = new Set(stocked.map((b) => b.productId));
  let prescribed = null;
  let alternative = null;
  for (const b of stocked) {
    const subs = (await pharmacist('GET', `/products/${b.productId}/substitutes`)).body;
    const candidate = (Array.isArray(subs) ? subs : subs?.data ?? [])
      .map((s) => s.product ?? s.relatedProduct ?? s)
      .find((p) => p?.id && p.id !== b.productId && stockedIds.has(p.id));
    if (candidate) {
      prescribed = (await pharmacist('GET', `/products/${b.productId}`)).body;
      alternative = candidate;
      break;
    }
  }

  if (!alternative) {
    skip('a substitution is recorded against the prescribed product',
      'no two stocked products are recorded as equivalent in this dataset');
  } else {
    const rx = await newPrescription({}, [{ productId: prescribed.id, prescribedQty: 2, allowSubstitution: true }]);
    await pharmacist('POST', `/prescriptions/${rx.body.id}/review`, { decision: 'APPROVE' });
    const full = (await pharmacist('GET', `/prescriptions/${rx.body.id}`)).body;
    const body = {
      prescriptionId: rx.body.id, patientId: patient.id, branchId: branch.id, warehouseId: warehouse.id,
      lines: [{ productId: alternative.id, prescriptionItemId: full.items[0].id, quantity: 2 }],
    };
    const noReason = await pharmacist('POST', '/dispensing', { ...body, idempotencyKey: key() });
    check('substituting without a reason is refused', noReason.status === 400, `HTTP ${noReason.status}`);

    const done = await pharmacist('POST', '/dispensing', {
      ...body, idempotencyKey: key(),
      lines: [{ ...body.lines[0], substitutionReason: 'The prescribed brand is out of stock' }],
    });
    check('a substitution with a reason is allowed', done.ok, `HTTP ${done.status} ${JSON.stringify(done.body).slice(0, 160)}`);
    check('the record keeps what was prescribed as well as what was supplied',
      done.body?.items?.[0]?.substitutedForProductId === prescribed.id &&
      done.body.items[0].productId === alternative.id,
      `${done.body?.items?.[0]?.substitutedForProductId} -> ${done.body?.items?.[0]?.productId}`);
    check('the reason for the substitution is kept',
      done.body?.items?.[0]?.substitutionReason === 'The prescribed brand is out of stock');

    const label = await pharmacist('GET', `/dispensing/${done.body.id}/label`);
    check('the label says an equivalent was supplied',
      !!label.body?.items?.[0]?.substitutedFor, String(label.body?.items?.[0]?.substitutedFor));
    check('the label still carries the directions the prescriber wrote',
      label.body?.items?.[0]?.directions !== undefined);
  }
}

{
  const rx = await newPrescription({}, [{ productId: product.id, prescribedQty: 2, allowSubstitution: false }]);
  await pharmacist('POST', `/prescriptions/${rx.body.id}/review`, { decision: 'APPROVE' });
  const full = (await pharmacist('GET', `/prescriptions/${rx.body.id}`)).body;
  const other = stocked.map((b) => b.productId).find((id) => id !== product.id);
  if (!other) {
    skip('"do not substitute" is enforced', 'only one stocked product in this warehouse');
  } else {
    const r = await pharmacist('POST', '/dispensing', {
      prescriptionId: rx.body.id, patientId: patient.id, branchId: branch.id, warehouseId: warehouse.id,
      idempotencyKey: key(),
      lines: [{ productId: other, prescriptionItemId: full.items[0].id, quantity: 1, substitutionReason: 'out of stock' }],
    });
    check('"do not substitute" is enforced, not merely displayed', r.status === 403, `HTTP ${r.status}`);
  }
}

// ============================================================
console.log('\nREADY, COLLECTION AND REPEATS (§23)');
// ============================================================

let collectedRx = null;
{
  const rx = await newPrescription({ refillsAllowed: 2 }, [{ productId: product.id, prescribedQty: 3 }]);
  await pharmacist('POST', `/prescriptions/${rx.body.id}/review`, { decision: 'APPROVE' });
  const full = (await pharmacist('GET', `/prescriptions/${rx.body.id}`)).body;

  const early = await pharmacist('POST', `/prescriptions/${rx.body.id}/ready`);
  check('nothing can be "ready" before anything is made up', early.status === 409, `HTTP ${early.status}`);

  const supply = await pharmacist('POST', '/dispensing', {
    prescriptionId: rx.body.id, patientId: patient.id, branchId: branch.id, warehouseId: warehouse.id,
    idempotencyKey: key(),
    lines: [{ productId: product.id, prescriptionItemId: full.items[0].id, quantity: 3 }],
  });
  check('the whole prescription can be supplied at once', supply.ok, `HTTP ${supply.status}`);

  const ready = await pharmacist('POST', `/prescriptions/${rx.body.id}/ready`);
  check('it can be marked ready for collection',
    ready.ok && ready.body.status === 'READY_FOR_COLLECTION', String(ready.body?.status));
  check('the time it became ready is recorded', !!ready.body?.readyAt);

  const anonymous = await pharmacist('POST', `/prescriptions/${rx.body.id}/collect`, {});
  check('a collection without a name is refused', anonymous.status === 400, `HTTP ${anonymous.status}`);

  const collected = await pharmacist('POST', `/prescriptions/${rx.body.id}/collect`, { collectedBy: 'Sister of the patient' });
  check('collection records who took it',
    collected.ok && collected.body.collectedBy === 'Sister of the patient');
  check('a fully supplied prescription closes on collection',
    collected.body?.status === 'DISPENSED', String(collected.body?.status));

  const twice = await pharmacist('POST', `/prescriptions/${rx.body.id}/collect`, { collectedBy: 'Someone else' });
  check('it cannot be collected twice', twice.status === 409, `HTTP ${twice.status}`);

  collectedRx = rx.body;

  const repeat = await pharmacist('POST', `/prescriptions/${rx.body.id}/refill`);
  check('a repeat is issued as its own prescription',
    repeat.ok && repeat.body.id !== rx.body.id, `HTTP ${repeat.status}`);
  check('the repeat still needs validating', repeat.body?.status === 'NEW', String(repeat.body?.status));
  check('the repeat copies the items',
    repeat.body?.items?.length === 1 && repeat.body.items[0].productId === product.id);
  check('the repeat points back at the original', repeat.body?.refillOfId === rx.body.id);

  const remaining = (await pharmacist('GET', `/prescriptions/${rx.body.id}`)).body;
  check('the allowance goes down', remaining.refillsRemaining === 1, String(remaining.refillsRemaining));
}

{
  const rx = await newPrescription({ refillsAllowed: 0 }, [{ productId: product.id, prescribedQty: 1 }]);
  await pharmacist('POST', `/prescriptions/${rx.body.id}/review`, { decision: 'APPROVE' });
  const full = (await pharmacist('GET', `/prescriptions/${rx.body.id}`)).body;
  await pharmacist('POST', '/dispensing', {
    prescriptionId: rx.body.id, patientId: patient.id, branchId: branch.id, warehouseId: warehouse.id,
    idempotencyKey: key(),
    lines: [{ productId: product.id, prescriptionItemId: full.items[0].id, quantity: 1 }],
  });
  const repeat = await pharmacist('POST', `/prescriptions/${rx.body.id}/refill`);
  check('a prescription written with no repeats cannot be repeated',
    repeat.status === 409, `HTTP ${repeat.status}`);
}

// ============================================================
console.log('\nREVERSAL (§24)');
// ============================================================

{
  const rx = await newPrescription({}, [{ productId: product.id, prescribedQty: 4 }]);
  await pharmacist('POST', `/prescriptions/${rx.body.id}/review`, { decision: 'APPROVE' });
  const full = (await pharmacist('GET', `/prescriptions/${rx.body.id}`)).body;
  const supply = await pharmacist('POST', '/dispensing', {
    prescriptionId: rx.body.id, patientId: patient.id, branchId: branch.id, warehouseId: warehouse.id,
    idempotencyKey: key(),
    lines: [{ productId: product.id, prescriptionItemId: full.items[0].id, quantity: 4 }],
  });

  // Balances are per batch and per location, so the total in the warehouse is
  // the sum: reading row zero would compare two different shelves.
  const onHand = async () => {
    const r = await pharmacist('GET', `/inventory/balances?warehouseId=${warehouse.id}&productId=${product.id}&pageSize=200`);
    return (r.body.data ?? []).reduce((total, row) => total + Number(row.onHand), 0);
  };
  const onHandBefore = await onHand();

  const noReason = await pharmacist('POST', `/dispensing/${supply.body.id}/reverse`, {});
  check('a reversal without a reason is refused', noReason.status === 400, `HTTP ${noReason.status}`);

  const reversed = await pharmacist('POST', `/dispensing/${supply.body.id}/reverse`, {
    reason: 'Wrong patient selected', returnToStock: true,
  });
  check('a dispensing can be reversed', reversed.ok, `HTTP ${reversed.status} ${JSON.stringify(reversed.body).slice(0, 200)}`);
  check('the original record is kept, not deleted',
    !!reversed.body?.dispensingNo && !!reversed.body?.reversedAt);
  check('the reason is kept', reversed.body?.reversalReason === 'Wrong patient selected');

  const onHandAfter = await onHand();
  check('the stock went back', onHandAfter === onHandBefore + 4,
    `${onHandBefore} -> ${onHandAfter}`);

  const rxAfter = (await pharmacist('GET', `/prescriptions/${rx.body.id}`)).body;
  check('what is outstanding on the prescription is restored',
    Number(rxAfter.items[0].dispensedQty) === 0, String(rxAfter.items[0].dispensedQty));
  check('the prescription is dispensable again', rxAfter.status === 'APPROVED', String(rxAfter.status));

  const movements = (await pharmacist('GET', `/inventory/ledger?productId=${product.id}&pageSize=200`)).body;
  const out = (movements.data ?? []).find((m) => m.referenceId === supply.body.id && Number(m.quantityOut) > 0);
  const back = (movements.data ?? []).find((m) => m.referenceType === 'DISPENSING_REVERSAL' && m.referenceId === supply.body.id);
  if (!out || !back) {
    skip('the stock goes back to the shelf it came from', 'the ledger read did not return both movements');
  } else {
    check('the stock goes back to the shelf it came from',
      out.locationId === back.locationId && out.batchId === back.batchId,
      `${out.locationId} -> ${back.locationId}`);
  }

  const twice = await pharmacist('POST', `/dispensing/${supply.body.id}/reverse`, { reason: 'again' });
  check('a reversal cannot itself be reversed', twice.status === 409, `HTTP ${twice.status}`);
}

{
  const supplies = (await pharmacist('GET', `/dispensing?prescriptionId=${collectedRx.id}`)).body;
  const one = supplies.data?.[0];
  if (!one) {
    skip('medicine already collected cannot be reversed', 'no supply found on the collected prescription');
  } else {
    const r = await pharmacist('POST', `/dispensing/${one.id}/reverse`, { reason: 'changed my mind' });
    check('medicine already collected cannot be reversed', r.status === 409, `HTTP ${r.status}`);
  }
}

// ============================================================
console.log('\nCONTROLLED MEDICINES (§28)');
// ============================================================

{
  let controlled = null;
  for (const b of stocked) {
    const p = (await admin('GET', `/products/${b.productId}`)).body;
    if (p?.isControlled && p.isActive) { controlled = p; break; }
  }
  if (!controlled) {
    skip('a controlled supply requires a witness', 'no controlled product with stock in this warehouse');
  } else {
    const rx = await newPrescription({}, [{ productId: controlled.id, prescribedQty: 1 }]);
    await pharmacist('POST', `/prescriptions/${rx.body.id}/review`, { decision: 'APPROVE' });
    const full = (await pharmacist('GET', `/prescriptions/${rx.body.id}`)).body;
    const body = {
      prescriptionId: rx.body.id, patientId: patient.id, branchId: branch.id, warehouseId: warehouse.id,
      lines: [{ productId: controlled.id, prescriptionItemId: full.items[0].id, quantity: 1 }],
    };

    const noWitness = await pharmacist('POST', '/dispensing', { ...body, idempotencyKey: key() });
    check('a controlled supply without a witness is refused',
      noWitness.status === 400, `HTTP ${noWitness.status}`);

    const selfWitness = await pharmacist('POST', '/dispensing', {
      ...body, idempotencyKey: key(), witnessedById: me.id,
    });
    check('the dispenser cannot witness their own controlled supply',
      selfWitness.status === 400, `HTTP ${selfWitness.status}`);
  }
}

{
  const rx = await newPrescription({}, [{ productId: product.id, prescribedQty: 1 }]);
  await pharmacist('POST', `/prescriptions/${rx.body.id}/review`, { decision: 'APPROVE' });
  const full = (await pharmacist('GET', `/prescriptions/${rx.body.id}`)).body;
  const noPrescription = await pharmacist('POST', '/dispensing', {
    patientId: patient.id, branchId: branch.id, warehouseId: warehouse.id, idempotencyKey: key(),
    lines: [{ productId: product.id, quantity: 1 }],
  });
  if (product.requiresPrescription) {
    check('a prescription-only medicine cannot be supplied without one',
      noPrescription.status === 403, `HTTP ${noPrescription.status}`);
  } else {
    check('an over-the-counter medicine can be supplied without a prescription',
      noPrescription.ok, `HTTP ${noPrescription.status}`);
  }
  void full;
}

// ============================================================
console.log('\nBRANCH SCOPE (§4, §33)');
// ============================================================

{
  const otherBranch = org.branches.find((b) => b.id !== branch.id && me2.branchIds.includes(b.id));
  if (!otherBranch || me.branchIds.length === 0) {
    skip('a prescription in another branch is unreachable', 'no second branch, or the pharmacist is organization-wide');
  } else {
    const rx = await newPrescription();
    const read = await pharmacist2('GET', `/prescriptions/${rx.body.id}`);
    check('a prescription in another branch is unreachable by id',
      read.status === 403 || read.status === 404, `HTTP ${read.status}`);

    const list = await pharmacist2('GET', '/prescriptions?pageSize=100');
    check('another branch\'s prescriptions are not in the list',
      !(list.body.data ?? []).some((p) => p.branchId === branch.id),
      `${(list.body.data ?? []).filter((p) => p.branchId === branch.id).length} leaked`);

    const listedByBranch = await pharmacist2('GET', `/prescriptions?branchId=${branch.id}`);
    check('asking for another branch by id does not widen the read',
      listedByBranch.status === 403 || (listedByBranch.body.data ?? []).length === 0,
      `HTTP ${listedByBranch.status}, ${(listedByBranch.body?.data ?? []).length} rows`);

    const supplies = await pharmacist2('GET', '/dispensing?pageSize=100');
    check('another branch\'s dispensings are not in the list',
      !(supplies.body.data ?? []).some((d) => d.branchId === branch.id),
      `${(supplies.body.data ?? []).filter((d) => d.branchId === branch.id).length} leaked`);

    const supply = await pharmacist2('POST', '/dispensing', {
      branchId: branch.id, warehouseId: warehouse.id, patientId: patient.id,
      idempotencyKey: key(), lines: [{ productId: product.id, quantity: 1 }],
    });
    check('dispensing into another branch is refused', supply.status === 403, `HTTP ${supply.status}`);
  }
}

// ============================================================
console.log('\nREPORTING (§23)');
// ============================================================

{
  const summary = await pharmacist('GET', '/dispensing/summary/today');
  check('today\'s summary reads', summary.ok && typeof summary.body.dispensings === 'number',
    `HTTP ${summary.status}`);
  check('it counts the supplies made today', summary.body.dispensings > 0, String(summary.body?.dispensings));

  const workload = await pharmacist('GET', '/dispensing/workload?days=7');
  check('the workload report reads', workload.ok && Array.isArray(workload.body.data), `HTTP ${workload.status}`);
  check('it says it is a workload measure, not a score',
    typeof workload.body?.note === 'string' && /not a performance score/i.test(workload.body.note));

  const history = await pharmacist('GET', `/dispensing/patient/${patient.id}`);
  check('the patient\'s medication history reads', history.ok && Array.isArray(history.body.data),
    `HTTP ${history.status}`);
  check('it names the medicines rather than their ids',
    history.body.data.length === 0 || !!history.body.data[0].items?.[0]?.product?.genericName);
  check('reversed supplies are shown rather than hidden',
    typeof history.body?.note === 'string' && /reversed/i.test(history.body.note));
}

// ============================================================
console.log(`\n${failures === 0 ? 'ALL DISPENSING CHECKS PASSED' : `${failures} DISPENSING CHECK(S) FAILED`}`);
if (skipped.length) console.log(`${skipped.length} skipped: ${skipped.map((s) => s.name).join('; ')}`);
process.exit(failures === 0 ? 0 : 1);
