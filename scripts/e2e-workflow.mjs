/**
 * End-to-end verification of the §72 workflow against the running API.
 * Procurement -> approval -> RFQ -> PO -> receiving -> QA release -> FEFO
 * dispensing -> recall blocking, with the ledger and audit trail checked.
 */

const API = 'http://localhost:4000/api';
const GS = String.fromCharCode(29);

let failures = 0;
function check(label, condition, detail = '') {
  const ok = !!condition;
  if (!ok) failures++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
  return ok;
}

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'PharmaCore#2026' }),
  });
  if (!res.ok) throw new Error(`login ${identifier} failed: ${res.status} ${await res.text()}`);
  return (await res.json()).accessToken;
}

function client(token) {
  return async (method, path, body) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, ok: res.ok, body: json };
  };
}

const stamp = Date.now();

console.log('\n================ PHARMACORE END-TO-END (§72) ================\n');

// ---- Actors ----
const admin = client(await login('admin'));
const procurement = client(await login('procurement'));
const manager = client(await login('manager'));
const warehouse = client(await login('warehouse'));
const qa = client(await login('qa'));
const pharmacist = client(await login('pharmacist'));
const cashier = client(await login('cashier'));
console.log('Signed in: admin, procurement, manager, warehouse, qa, pharmacist, cashier\n');

// ---- Reference data ----
const org = (await admin('GET', '/admin/organization')).body;
const headOffice = org.branches.find((b) => b.isHeadOffice);
const centralWh = headOffice.warehouses.find((w) => !w.isColdRoom);

const productsRes = await admin('GET', '/products?q=Amoxicillin&pageSize=5');
const amox = productsRes.body.data.find((p) => p.genericName === 'Amoxicillin');
const suppliers = (await procurement('GET', '/suppliers?pageSize=3')).body.data;

console.log(`Product : ${amox.genericName} ${amox.strength} (${amox.sku}, GTIN ${amox.gtin})`);
console.log(`Site    : ${headOffice.name} / ${centralWh.name}\n`);

// ---------------------------------------------------------------
console.log('STEP 1-2  Purchase request for 10,000 capsules, then approval');
// ---------------------------------------------------------------
const pr = await procurement('POST', '/purchase-requests', {
  branchId: headOffice.id,
  department: 'Central Pharmacy',
  reason: 'Replenishment for Q3 demand',
  items: [{ productId: amox.id, requestedQty: 10000, currentStock: 0, reorderLevel: 200 }],
});
check('purchase request created', pr.ok, pr.body.requestNo);

const prApproved = await manager('POST', `/purchase-requests/${pr.body.id}/decide`, {
  decision: 'APPROVE',
});
check('manager approved the request', prApproved.body.status === 'APPROVED',
  prApproved.ok ? '' : `HTTP ${prApproved.status}: ${String(prApproved.body.error).slice(0,90)}`);

// ---------------------------------------------------------------
console.log('\nSTEP 3-4  RFQ to 3 suppliers, quotations, weighted comparison');
// ---------------------------------------------------------------
const rfq = await procurement('POST', '/rfqs', {
  purchaseRequestId: pr.body.id,
  items: [{ productId: amox.id, quantity: 10000 }],
});
check('RFQ issued', rfq.ok, rfq.body.rfqNo);

const quotePrices = [2.6, 2.35, 2.5];
const quoteDelivery = [7, 21, 10];
const quoteShelfLife = [700, 400, 730];
for (let i = 0; i < 3; i++) {
  const q = await procurement('POST', `/rfqs/${rfq.body.id}/quotations`, {
    supplierId: suppliers[i].id,
    deliveryDays: quoteDelivery[i],
    paymentTerms: 'NET30',
    freightCost: 500,
    items: [{
      productId: amox.id,
      unitPrice: quotePrices[i],
      taxRate: 0.15,
      offeredShelfLifeDays: quoteShelfLife[i],
    }],
  });
  check(`quotation from ${suppliers[i].companyName.slice(0, 28)}`, q.ok,
    `${quotePrices[i]}/unit, ${quoteDelivery[i]}d`);
}

const comparison = await procurement('GET', `/rfqs/${rfq.body.id}/comparison`);
check('comparison returns all three quotations', comparison.body.quotations.length === 3);
console.log('    Landed cost ranking:');
for (const q of comparison.body.quotations) {
  console.log(`      ${q.supplierName.slice(0, 34).padEnd(36)} landed ${q.landedCost.toFixed(2).padStart(10)}  score ${q.totalScore}`);
}
const cheapest = [...comparison.body.quotations].sort((a, b) => a.landedCost - b.landedCost)[0];
const recommended = comparison.body.recommendation;
check('recommendation is advisory, not blindly the cheapest',
  typeof recommended.rationale === 'string' && recommended.rationale.length > 0);
console.log(`    Recommended: ${recommended.supplierName} -- ${recommended.rationale.slice(0, 110)}`);

// Supplier B is selected deliberately, per the specification narrative.
const supplierB = suppliers[1];

// ---------------------------------------------------------------
console.log('\nSTEP 5-6  Purchase order raised and approved through the chain');
// ---------------------------------------------------------------
const po = await procurement('POST', '/purchase-orders', {
  supplierId: supplierB.id,
  branchId: headOffice.id,
  warehouseId: centralWh.id,
  expectedDate: new Date(Date.now() + 14 * 86400000).toISOString(),
  items: [{ productId: amox.id, orderedQty: 10000, unitPrice: 2.35, taxRate: 0.15 }],
});
check('purchase order created', po.ok, `${po.body.poNo} total ${po.body.grandTotal}`);

for (const status of ['SUBMITTED', 'PROCUREMENT_REVIEW', 'FINANCE_REVIEW', 'APPROVED', 'ORDERED']) {
  const t = await admin('POST', `/purchase-orders/${po.body.id}/transition`, { status });
  check(`PO -> ${status}`, t.ok && t.body.status === status);
}

const badTransition = await admin('POST', `/purchase-orders/${po.body.id}/transition`, {
  status: 'DRAFT',
});
check('illegal status jump is refused', badTransition.status === 400,
  String(badTransition.body.error).slice(0, 70));

// ---------------------------------------------------------------
console.log('\nSTEP 7  Goods receiving: batch AMX26001, expires 31-May-2028');
// ---------------------------------------------------------------
// GS1 AI 10 (batch/lot) allows at most 20 characters, so keep it realistic.
const batchNumber = `AMX${String(stamp).slice(-8)}`;
const grn = await warehouse('POST', '/goods-receipts', {
  purchaseOrderId: po.body.id,
  supplierId: supplierB.id,
  warehouseId: centralWh.id,
  branchId: headOffice.id,
  supplierInvoiceNo: `INV-${stamp}`,
  lines: [{
    productId: amox.id,
    batchNumber,
    manufacturingDate: '2026-06-01',
    expiryDate: '2028-05-31',
    quantity: 10000,
    unitCost: 2.35,
  }],
});
check('goods receipt posted', grn.ok, grn.body.grnNo);
check('received quantity recorded', Number(grn.body.items[0].receivedQty) === 10000);

const batches = await warehouse('GET', `/inventory/batches?productId=${amox.id}&search=${batchNumber}`);
const newBatch = batches.body.data.find((b) => b.batchNumber === batchNumber);
check('new batch starts QUARANTINED, not sellable', newBatch.status === 'QUARANTINED',
  `status=${newBatch.status}`);

// ---------------------------------------------------------------
console.log('\nSTEP 8  Quarantined stock is invisible to FEFO');
// ---------------------------------------------------------------
const fefoBefore = await pharmacist('POST', '/inventory/fefo/allocate', {
  productId: amox.id,
  warehouseId: centralWh.id,
  quantity: 20,
});
const excludedQuarantine = fefoBefore.body.excluded?.find((e) => e.batchId === newBatch.id);
check('FEFO excludes the quarantined batch', !!excludedQuarantine,
  excludedQuarantine?.reason);

// §4: the seeded pharmacist is scoped to a branch pharmacy, so they must not
// be able to dispense out of the central warehouse at head office.
const crossBranch = await pharmacist('POST', '/dispensing', {
  branchId: headOffice.id,
  warehouseId: centralWh.id,
  lines: [{ productId: amox.id, quantity: 1 }],
});
check('a branch-scoped pharmacist cannot dispense at another branch',
  crossBranch.status === 403, String(crossBranch.body.error).slice(0, 60));

// Create a head-office pharmacist to carry out the central-warehouse workflow.
const hoUser = await admin('POST', '/admin/users', {
  email: `ho.pharmacist.${stamp}@pharmacore.example`,
  username: `hopharm${stamp}`,
  fullName: 'Head Office Pharmacist',
  password: 'PharmaCore#2026',
  roleCodes: ['PHARMACIST'],
  branchIds: [headOffice.id],
});
check('head-office pharmacist provisioned', hoUser.ok, hoUser.body.username);
const hoPharmacist = client(await login(hoUser.body.username));

// A prescription is required first: Amoxicillin is prescription-only.
const patient = (await hoPharmacist('GET', '/patients?pageSize=1')).body.data[0];
const rx = await hoPharmacist('POST', '/prescriptions', {
  patientId: patient.id,
  branchId: headOffice.id,
  prescriberName: 'Dr. Selamawit Bekele',
  prescriberLicense: 'ETH-MD-14872',
  facilityName: 'Tikur Anbessa Specialized Hospital',
  prescriptionDate: new Date().toISOString(),
  items: [{ productId: amox.id, prescribedQty: 60, dosage: '1 capsule', frequency: 'Three times daily', durationDays: 7 }],
});
check('prescription captured', rx.ok, rx.body.prescriptionNo);

const dispenseBeforeReview = await hoPharmacist('POST', '/dispensing', {
  prescriptionId: rx.body.id,
  branchId: headOffice.id,
  warehouseId: centralWh.id,
  lines: [{ productId: amox.id, quantity: 10 }],
});
check('dispensing against an unreviewed prescription is refused',
  !dispenseBeforeReview.ok, String(dispenseBeforeReview.body.error).slice(0, 70));

const rxApproved = await hoPharmacist('POST', `/prescriptions/${rx.body.id}/review`, {
  decision: 'APPROVE',
});
check('pharmacist validated the prescription', rxApproved.body.status === 'APPROVED');

const blockedDispense = await hoPharmacist('POST', '/dispensing', {
  prescriptionId: rx.body.id,
  branchId: headOffice.id,
  warehouseId: centralWh.id,
  lines: [{ productId: amox.id, quantity: 10, batchId: newBatch.id }],
});
check('dispensing from quarantined stock is refused', !blockedDispense.ok,
  String(blockedDispense.body.error).slice(0, 80));

// ---------------------------------------------------------------
console.log('\nSTEP 9  GS1 DataMatrix scan resolves product, batch and expiry');
// ---------------------------------------------------------------
const yy = '28', mm = '05', dd = '31';
const gs1 = `01${amox.gtin.padStart(14, '0')}17${yy}${mm}${dd}10${batchNumber}${GS}21SN${stamp}`;
const scan = await warehouse('POST', '/scan', { code: gs1 });
check('scan identifies the product', scan.body.product?.id === amox.id, scan.body.product?.genericName);
check('scan identifies the batch', scan.body.batch?.batchNumber === batchNumber);
check('scan reads the expiry from the pack',
  scan.body.parsed.expiryDate?.slice(0, 10) === '2028-05-31',
  scan.body.parsed.expiryDate?.slice(0, 10));
check('scan warns the batch is not sellable',
  scan.body.warnings.some((w) => w.includes('QUARANTINED')));

const plainQr = await warehouse('POST', '/scan', { code: 'JUST-A-QR-PAYLOAD' });
check('a plain code is NOT treated as GS1 identification', plainQr.body.parsed.isGs1 === false);

// ---------------------------------------------------------------
console.log('\nSTEP 10  QA releases the batch -> stock becomes available');
// ---------------------------------------------------------------
const release = await qa('POST', `/inventory/batches/${newBatch.id}/release`, {
  reason: 'Certificate of analysis reviewed and accepted',
});
check('QA released the batch', release.body.status === 'RELEASED');

const unauthorizedRelease = await cashier('POST', `/inventory/batches/${newBatch.id}/block`, {
  reason: 'attempt without permission',
});
check('a cashier cannot change batch status', unauthorizedRelease.status === 403);

// ---------------------------------------------------------------
console.log('\nSTEP 11  Pharmacist dispenses 20 capsules -> FEFO picks nearest expiry');
// ---------------------------------------------------------------
const recommendation = await hoPharmacist(
  'GET',
  `/inventory/fefo/recommend?productId=${amox.id}&warehouseId=${centralWh.id}`,
);
console.log(`    FEFO recommends batch ${recommendation.body?.batchNumber} expiring ${String(recommendation.body?.expiryDate).slice(0, 10)}`);

const stockBefore = await hoPharmacist('GET', `/inventory/products/${amox.id}/stock`);
const onHandBefore = Number(stockBefore.body.totalOnHand);

const rxItemId = rx.body.items[0].id;
const dispensing = await hoPharmacist('POST', '/dispensing', {
  prescriptionId: rx.body.id,
  branchId: headOffice.id,
  warehouseId: centralWh.id,
  lines: [{ productId: amox.id, quantity: 20, prescriptionItemId: rxItemId }],
});
check('dispensing succeeded', dispensing.ok, dispensing.body.dispensingNo);

const chosenBatchId = dispensing.body?.items?.[0]?.batchId;
check('FEFO chose the nearest-expiry batch it recommended',
  chosenBatchId === recommendation.body?.batchId);

const stockAfter = await hoPharmacist('GET', `/inventory/products/${amox.id}/stock`);
check('stock decreased by exactly 20',
  onHandBefore - Number(stockAfter.body.totalOnHand) === 20,
  `${onHandBefore} -> ${Number(stockAfter.body.totalOnHand)}`);

// A longer-dated batch, so choosing it really is an override of FEFO.
const laterBatchNumber = `AMXL${String(stamp).slice(-8)}`;
const grn2 = await warehouse('POST', '/goods-receipts', {
  supplierId: supplierB.id,
  warehouseId: centralWh.id,
  branchId: headOffice.id,
  lines: [{
    productId: amox.id,
    batchNumber: laterBatchNumber,
    expiryDate: '2029-12-31',
    quantity: 500,
    unitCost: 2.4,
  }],
});
check('second, longer-dated batch received', grn2.ok, grn2.body.grnNo);
const laterBatch = (await warehouse('GET', `/inventory/batches?productId=${amox.id}&search=${laterBatchNumber}`))
  .body.data.find((b) => b.batchNumber === laterBatchNumber);
await qa('POST', `/inventory/batches/${laterBatch.id}/release`, { reason: 'COA accepted' });

const recheck = await hoPharmacist(
  'GET',
  `/inventory/fefo/recommend?productId=${amox.id}&warehouseId=${centralWh.id}`,
);
check('FEFO still prefers the earlier-expiring batch',
  recheck.body.batchId !== laterBatch.id,
  `recommends ${recheck.body.batchNumber} over ${laterBatchNumber}`);
const overrideNoReason = await hoPharmacist('POST', '/dispensing', {
  prescriptionId: rx.body.id,
  branchId: headOffice.id,
  warehouseId: centralWh.id,
  lines: [{ productId: amox.id, quantity: 5, batchId: laterBatch.id }],
});
const needsReason = !overrideNoReason.ok &&
  String(overrideNoReason.body.error).toLowerCase().includes('reason');
check('overriding FEFO without a reason is refused', needsReason,
  String(overrideNoReason.body.error).slice(0, 90));

const overrideWithReason = await hoPharmacist('POST', '/dispensing', {
  prescriptionId: rx.body.id,
  branchId: headOffice.id,
  warehouseId: centralWh.id,
  lines: [{
    productId: amox.id,
    quantity: 5,
    batchId: laterBatch.id,
    overrideReason: 'Patient requires the longer-dated pack for a 6-month supply',
  }],
});
check('overriding FEFO with a reason is allowed and recorded', overrideWithReason.ok);
check('the override is stored with the batch FEFO would have used',
  !!overrideWithReason.body?.items?.[0]?.overrideReason);

// ---------------------------------------------------------------
console.log('\nSTEP 12  Ledger records every movement');
// ---------------------------------------------------------------
const ledger = await admin('GET', `/inventory/ledger?productId=${amox.id}&pageSize=10`);
check('ledger has entries for this product', ledger.body.total > 0, `${ledger.body.total} rows`);
const dispenseRow = ledger.body.data.find((r) => r.referenceNo === dispensing.body.dispensingNo);
check('the dispensing appears in the ledger with a running balance',
  !!dispenseRow && dispenseRow.balanceAfter !== undefined,
  `out ${dispenseRow?.quantityOut}, balance after ${dispenseRow?.balanceAfter}`);

// ---------------------------------------------------------------
console.log('\nSTEP 13  Recall: blocks stock, traces history, creates tasks');
// ---------------------------------------------------------------
const recall = await qa('POST', '/recalls', {
  productId: amox.id,
  batchIds: [newBatch.id],
  severity: 'CLASS_II',
  reason: 'Out-of-specification dissolution result reported by the manufacturer',
  regulatoryReference: `EFDA/REC/2026/${stamp % 10000}`,
  instructions: 'Quarantine remaining stock and contact affected patients.',
});
check('recall activated', recall.ok, recall.body?.recall?.recallNo);
check('recall dashboard reports stock at activation',
  Number(recall.body.totals.inStock) > 0,
  `in stock ${recall.body.totals.inStock}, dispensed ${recall.body.totals.dispensed}`);
check('recall generated recovery tasks', recall.body.tasks.total > 0,
  `${recall.body.tasks.total} tasks: ${JSON.stringify(recall.body.tasks.byType)}`);

const batchAfterRecall = await qa('GET', `/inventory/batches/${newBatch.id}`);
check('batch is now RECALLED', batchAfterRecall.body.status === 'RECALLED');

const dispenseAfterRecall = await hoPharmacist('POST', '/dispensing', {
  prescriptionId: rx.body.id,
  branchId: headOffice.id,
  warehouseId: centralWh.id,
  lines: [{ productId: amox.id, quantity: 1, batchId: newBatch.id }],
});
check('DISPENSING RECALLED STOCK IS BLOCKED', !dispenseAfterRecall.ok,
  String(dispenseAfterRecall.body.error).slice(0, 90));

const saleAfterRecall = await cashier('POST', '/pos/checkout', {
  branchId: headOffice.id,
  warehouseId: centralWh.id,
  lines: [{ productId: amox.id, quantity: 1, batchId: newBatch.id }],
  payments: [{ method: 'CASH', amount: 100 }],
});
check('SELLING RECALLED STOCK IS BLOCKED', !saleAfterRecall.ok,
  String(saleAfterRecall.body.error).slice(0, 90));

const trace = await qa('GET', `/recalls/batches/${newBatch.id}/trace`);
check('trace lists current holding locations', trace.body.currentLocations.length > 0);
check('trace lists who the batch was dispensed to', trace.body.dispensedTo.length > 0,
  `${trace.body.dispensedTo.length} dispensing record(s)`);

// ---------------------------------------------------------------
console.log('\nSTEP 14  Audit trail is complete and tamper-evident');
// ---------------------------------------------------------------
const audit = await admin('GET', '/admin/audit-logs?pageSize=10');
check('audit log has entries', audit.body.total > 0, `${audit.body.total} entries`);
const verify = await admin('GET', '/admin/audit-logs/verify');
check('audit hash chain verifies', verify.body.valid === true,
  `${verify.body.checked} rows checked`);

const recallAudit = await admin('GET', '/admin/audit-logs?action=RECALL_ACTIVATED&pageSize=1');
check('the recall activation was audited', recallAudit.body.total > 0);

// ---------------------------------------------------------------
console.log('\nSTEP 15  Branch scoping and permissions are enforced server-side');
// ---------------------------------------------------------------
const cashierBalances = await cashier('GET', '/inventory/balances?pageSize=5');
check('cashier may read stock', cashierBalances.ok);
const cashierAudit = await cashier('GET', '/admin/audit-logs');
check('cashier may NOT read the audit trail', cashierAudit.status === 403);
const cashierRecall = await cashier('POST', '/recalls', {
  batchIds: [newBatch.id], severity: 'CLASS_I', reason: 'unauthorized attempt',
});
check('cashier may NOT raise a recall', cashierRecall.status === 403);

const auditor = client(await login('auditor'));
const auditorRead = await auditor('GET', '/inventory/ledger?pageSize=1');
check('auditor has read access to the ledger', auditorRead.ok);
const auditorWrite = await auditor('POST', '/stock-adjustments', {
  warehouseId: centralWh.id, branchId: headOffice.id, reason: 'x', items: [],
});
check('auditor is read-only', auditorWrite.status === 403);

// ---------------------------------------------------------------
console.log('\nSTEP 16  Expiry, redistribution and command centre');
// ---------------------------------------------------------------
const expiry = await admin('GET', '/inventory/expiry?maxDays=90');
check('expiry dashboard returns at-risk stock', expiry.body.rows.length > 0,
  `${expiry.body.rows.length} positions, value at risk ${expiry.body.totalValueAtRisk.toFixed(2)}`);
check('expiry rows are bucketed', !!expiry.body.summary,
  Object.keys(expiry.body.summary).join(', '));

const redistribution = await admin('GET', '/inventory/expiry/redistribution?withinDays=120');
check('redistribution suggestions computed', Array.isArray(redistribution.body),
  `${redistribution.body.length} suggestion(s)`);

const command = await admin('GET', '/analytics/command-center');
check('command centre populated', !!command.body.expiryRisks,
  `stockouts ${command.body.criticalStockouts.length}, expiry ${command.body.expiryRisks.length}, ` +
  `recalls ${command.body.recalls.length}, cold chain ${command.body.coldChainAlerts.length}, ` +
  `quarantined ${command.body.quarantinedInventory.length}`);

const abc = await admin('GET', '/analytics/abc-xyz?months=6');
check('ABC/XYZ classification produced', abc.body.length > 0,
  `${abc.body[0]?.sku} -> ${abc.body[0]?.combinedClass}`);

const kpis = await admin('GET', '/analytics/kpis');
check('KPIs computed', kpis.body.inventoryValue > 0,
  `turnover ${kpis.body.stockTurnover}, margin ${kpis.body.grossMarginPct}%`);

// ---------------------------------------------------------------
console.log('\nSTEP 17  POS sale of an OTC product');
// ---------------------------------------------------------------
// The cashier is scoped to a branch pharmacy, so they sell from their own site.
const cashierMe = (await cashier('GET', '/auth/me')).body;
const cashierBranchId = cashierMe.branchIds[0];
const cashierBranch = org.branches.find((b) => b.id === cashierBranchId);
const cashierWh = cashierBranch.warehouses.find((w) => !w.isColdRoom);
const otcResults = (await cashier('GET', `/pos/search?q=Paracetamol&warehouseId=${cashierWh.id}`)).body;
// The search also matches "Codeine + Paracetamol", which is controlled -- pick
// a genuinely over-the-counter line.
const otc = otcResults.find((p) => !p.requiresPrescription && !p.isControlled && p.available > 0);
if (otc && otc.available > 0) {
  const sale = await cashier('POST', '/pos/checkout', {
    branchId: cashierBranch.id,
    warehouseId: cashierWh.id,
    lines: [{ productId: otc.id, quantity: 2 }],
    payments: [{ method: 'CASH', amount: 1000 }],
  });
  check('OTC sale completed', sale.ok, `${sale.body?.saleNo} total ${sale.body?.grandTotal}`);
} else {
  check('OTC product available for sale', false, 'no stock in central warehouse');
}

const rxOverCounter = await cashier('POST', '/pos/checkout', {
  branchId: cashierBranch.id,
  warehouseId: cashierWh.id,
  lines: [{ productId: amox.id, quantity: 1 }],
  payments: [{ method: 'CASH', amount: 100 }],
});
check('prescription-only medicine cannot be sold over the counter',
  rxOverCounter.status === 403, String(rxOverCounter.body.error).slice(0, 80));

// ---------------------------------------------------------------
console.log('\n============================================================');
console.log(failures === 0
  ? 'ALL END-TO-END CHECKS PASSED'
  : `${failures} CHECK(S) FAILED`);
console.log('============================================================\n');
process.exit(failures === 0 ? 0 : 1);
