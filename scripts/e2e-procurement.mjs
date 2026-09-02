const API = 'http://localhost:4000/api';
let fails = 0;
const check = (l, c, d = '') => { if (!c) fails++; console.log(`${c ? '  PASS' : '  FAIL'}  ${l}${d ? ` -- ${d}` : ''}`); };

async function login(u) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: u, password: 'PharmaCore#2026' }) });
  if (!r.ok) throw new Error(`${u}: ${r.status}`);
  return (await r.json()).accessToken;
}
const client = (t) => async (m, p, b) => {
  const r = await fetch(`${API}${p}`, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: b ? JSON.stringify(b) : undefined });
  const x = await r.text(); let j; try { j = JSON.parse(x); } catch { j = x; }
  return { ok: r.ok, status: r.status, body: j };
};

const stamp = Date.now();
const admin = client(await login('admin'));
const proc = client(await login('procurement'));
const wh = client(await login('warehouse'));
const fin = client(await login('finance'));

const org = (await admin('GET', '/admin/organization')).body;
const ho = org.branches.find(b => b.isHeadOffice);
const cw = ho.warehouses.find(w => !w.isColdRoom);
const amox = (await admin('GET', '/products?q=Amoxicillin&pageSize=5')).body.data.find(p => p.genericName === 'Amoxicillin');
const sups = (await proc('GET', '/suppliers?pageSize=3')).body.data;

console.log('\n=========== PHASE 4 VERIFICATION ===========\n');
console.log('STEP A  Supplier selection (§11, §14)');
const rfq = await proc('POST', '/rfqs', { items: [{ productId: amox.id, quantity: 5000 }] });
check('RFQ issued', rfq.ok, rfq.body.rfqNo);
for (let i = 0; i < 3; i++) {
  await proc('POST', `/rfqs/${rfq.body.id}/quotations`, {
    supplierId: sups[i].id, deliveryDays: [7, 25, 12][i], paymentTerms: 'NET30', freightCost: 400,
    items: [{ productId: amox.id, unitPrice: [2.7, 2.3, 2.5][i], taxRate: 0.15, offeredShelfLifeDays: [720, 300, 700][i] }],
  });
}
const cmp = (await proc('GET', `/rfqs/${rfq.body.id}/comparison`)).body;
const top = cmp.quotations[0];
const cheapest = [...cmp.quotations].sort((a, b) => a.landedCost - b.landedCost)[0];
console.log(`    top-ranked: ${top.supplierName} (score ${top.totalScore}), cheapest: ${cheapest.supplierName} (${cheapest.landedCost.toFixed(2)})`);

const notTop = cmp.quotations.find(q => q.quotationId !== top.quotationId);
const noReason = await proc('POST', `/quotations/${notTop.quotationId}/select`);
check('selecting a lower-ranked quotation without a reason is refused', !noReason.ok, String(noReason.body.error).slice(0, 80));

const selTop = await proc('POST', `/quotations/${top.quotationId}/select`, {});
check('selecting the top-ranked quotation needs no reason', selTop.ok);
check('isSelected is now recorded', selTop.body.isSelected === true);

const selOther = await proc('POST', `/quotations/${notTop.quotationId}/select`, { reason: 'Existing framework agreement with this supplier' });
check('selecting another supplier with a reason is allowed', selOther.ok);
const after = (await proc('GET', `/rfqs/${rfq.body.id}/comparison`)).body;
check('exactly one quotation stays selected', after.quotations.filter(q => q.isSelected).length <= 1);

console.log('\nSTEP B  Partial rejection at receiving (§15)');
const po = await proc('POST', '/purchase-orders', {
  supplierId: sups[0].id, branchId: ho.id, warehouseId: cw.id,
  expectedDate: new Date(Date.now() + 7 * 864e5).toISOString(),
  items: [{ productId: amox.id, orderedQty: 1000, unitPrice: 2.4, taxRate: 0.15 }],
});
for (const s of ['SUBMITTED', 'PROCUREMENT_REVIEW', 'FINANCE_REVIEW', 'APPROVED', 'ORDERED'])
  await admin('POST', `/purchase-orders/${po.body.id}/transition`, { status: s });

const rejectNoReason = await wh('POST', '/goods-receipts', {
  purchaseOrderId: po.body.id, supplierId: sups[0].id, warehouseId: cw.id, branchId: ho.id,
  lines: [{ productId: amox.id, batchNumber: `RJ${stamp}`.slice(0, 18), expiryDate: '2028-06-30', quantity: 1000, unitCost: 2.4, rejectedQty: 150 }],
});
check('rejecting stock without a reason is refused', !rejectNoReason.ok, String(rejectNoReason.body.error).slice(0, 70));

const grn = await wh('POST', '/goods-receipts', {
  purchaseOrderId: po.body.id, supplierId: sups[0].id, warehouseId: cw.id, branchId: ho.id,
  supplierInvoiceNo: `SINV-${stamp}`,
  lines: [{ productId: amox.id, batchNumber: `RJ${String(stamp).slice(-8)}`, expiryDate: '2028-06-30', quantity: 1000, unitCost: 2.4, rejectedQty: 150, rejectionReason: 'Crushed outer cartons on 150 units' }],
});
check('receipt with partial rejection accepted', grn.ok, grn.body.grnNo);
const item = grn.body?.items?.[0];
check('delivered / accepted / rejected recorded separately', item &&
  Number(item.receivedQty) === 1000 && Number(item.acceptedQty) === 850 && Number(item.rejectedQty) === 150,
  item ? `received ${item.receivedQty}, accepted ${item.acceptedQty}, rejected ${item.rejectedQty}` : 'no item');

const stock = await wh('GET', `/inventory/balances?warehouseId=${cw.id}&search=Amoxicillin&pageSize=50`);
const batchRow = stock.body.data.find(r => r.batch?.batchNumber === `RJ${String(stamp).slice(-8)}`);
check('only the ACCEPTED quantity entered stock', batchRow && Number(batchRow.onHand) === 850,
  batchRow ? `on hand ${batchRow.onHand}` : 'batch not found');

console.log('\nSTEP C  Supplier invoice and three-way match (§11, §45)');
const goodInv = await fin('POST', '/supplier-invoices', {
  supplierInvoiceNo: `INV-OK-${stamp}`, supplierId: sups[0].id, branchId: ho.id,
  purchaseOrderId: po.body.id, goodsReceiptId: grn.body.id,
  invoiceDate: new Date().toISOString(), dueDate: new Date(Date.now() + 30 * 864e5).toISOString(),
  items: [{ productId: amox.id, quantity: 850, unitPrice: 2.4, taxRate: 0.15 }],
});
check('invoice billing the received quantity at the ordered price MATCHES', goodInv.body.matchStatus === 'MATCHED',
  `${goodInv.body.matchStatus} — ${String(goodInv.body.matchNotes).slice(0, 60)}`);

const dupe = await fin('POST', '/supplier-invoices', {
  supplierInvoiceNo: `INV-OK-${stamp}`, supplierId: sups[0].id, branchId: ho.id,
  invoiceDate: new Date().toISOString(), items: [{ productId: amox.id, quantity: 1, unitPrice: 1 }],
});
check('duplicate invoice number is refused', dupe.status === 409, String(dupe.body.error).slice(0, 70));

const badInv = await fin('POST', '/supplier-invoices', {
  supplierInvoiceNo: `INV-BAD-${stamp}`, supplierId: sups[0].id, branchId: ho.id,
  purchaseOrderId: po.body.id, invoiceDate: new Date().toISOString(),
  // Billing the full 1000 at an inflated price: both variances at once.
  items: [{ productId: amox.id, quantity: 1000, unitPrice: 3.1, taxRate: 0.15 }],
});
check('invoice billing rejected stock at a higher price is DISPUTED', badInv.body.matchStatus === 'BOTH_VARIANCE',
  badInv.body.matchStatus);
check('the variance names both the price and the quantity', /PRICE/.test(badInv.body.matchNotes) && /QUANTITY/.test(badInv.body.matchNotes),
  String(badInv.body.matchNotes).slice(0, 100));

const approveBad = await fin('POST', `/supplier-invoices/${badInv.body.id}/approve`, {});
check('approving a disputed invoice without a reason is refused', !approveBad.ok, String(approveBad.body.error).slice(0, 80));

console.log('\nSTEP D  Payment (§11 final step)');
const payBeforeApprove = await fin('POST', `/supplier-invoices/${goodInv.body.id}/pay`, { amount: 100, method: 'BANK_TRANSFER' });
check('paying an unapproved invoice is refused', !payBeforeApprove.ok, String(payBeforeApprove.body.error).slice(0, 70));

await fin('POST', `/supplier-invoices/${goodInv.body.id}/approve`, {});
const total = Number(goodInv.body.grandTotal);
const part = await fin('POST', `/supplier-invoices/${goodInv.body.id}/pay`, { amount: Math.round(total / 2 * 100) / 100, method: 'BANK_TRANSFER', reference: 'TT-001' });
check('part payment recorded', part.ok && part.body.status === 'PARTIALLY_PAID', `paid ${part.body?.amountPaid} of ${total}`);

const over = await fin('POST', `/supplier-invoices/${goodInv.body.id}/pay`, { amount: total, method: 'CASH' });
check('overpayment is refused', !over.ok, String(over.body.error).slice(0, 70));

const rest = Number(part.body.grandTotal) - Number(part.body.amountPaid);
const final = await fin('POST', `/supplier-invoices/${goodInv.body.id}/pay`, { amount: Math.round(rest * 100) / 100, method: 'BANK_TRANSFER', reference: 'TT-002' });
check('settling the balance marks it PAID', final.body.status === 'PAID', `paid ${final.body.amountPaid}`);

const ageing = await fin('GET', '/supplier-invoices/ageing');
check('AP ageing computed', typeof ageing.body.totalOutstanding === 'number',
  `outstanding ${ageing.body.totalOutstanding?.toFixed(2)} across ${ageing.body.rows.length} invoice(s)`);

console.log(`\n${fails === 0 ? 'ALL PHASE 4 CHECKS PASSED' : `${fails} CHECK(S) FAILED`}\n`);
process.exit(fails ? 1 : 0);
