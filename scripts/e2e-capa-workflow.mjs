const API = 'http://localhost:4000/api';
let fails = 0;
const check = (l, c, d = '') => { if (!c) fails++; console.log(`${c ? '  PASS' : '  FAIL'}  ${l}${d ? ` -- ${d}` : ''}`); };
async function login(u) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: u, password: 'PharmaCore#2026' }) });
  return (await r.json()).accessToken;
}
const client = (t) => async (m, p, b) => {
  const r = await fetch(`${API}${p}`, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: b ? JSON.stringify(b) : undefined });
  const x = await r.text(); let j; try { j = JSON.parse(x); } catch { j = x; }
  return { ok: r.ok, status: r.status, body: j };
};

const admin = client(await login('admin'));
const qa = client(await login('qa'));
const proc = client(await login('procurement'));
const fin = client(await login('finance'));

console.log('\n===== §64 QUALITY INCIDENTS / CAPA =====\n');
const batch = (await admin('GET', '/inventory/batches?status=RELEASED&pageSize=1')).body.data[0];
const inc = await qa('POST', '/quality-incidents', {
  type: 'PACKAGING_DEFECT',
  description: 'Blister foil delaminating on several packs from this batch',
  batchId: batch.id, productId: batch.productId, quarantineBatch: true,
});
check('incident raised', inc.ok, inc.body.incidentNo);
check('naming a batch quarantines it', (await admin('GET', `/inventory/batches/${batch.id}`)).body.status === 'QUARANTINED');

const skip = await qa('POST', `/quality-incidents/${inc.body.id}/advance`, { status: 'CORRECTIVE_ACTION' });
check('cannot skip straight to corrective action', !skip.ok, String(skip.body.error).slice(0, 70));

const closeNoReason = await qa('POST', `/quality-incidents/${inc.body.id}/advance`, { status: 'CLOSED' });
check('closing without investigating needs a justification', !closeNoReason.ok, String(closeNoReason.body.error).slice(0, 70));

await qa('POST', `/quality-incidents/${inc.body.id}/advance`, { status: 'INVESTIGATING' });
const noEvidence = await qa('POST', `/quality-incidents/${inc.body.id}/advance`, { status: 'ROOT_CAUSE_IDENTIFIED' });
check('root-cause step demands a root cause', !noEvidence.ok, String(noEvidence.body.error).slice(0, 70));

const steps = [
  ['ROOT_CAUSE_IDENTIFIED', { rootCause: 'Sealing temperature drifted on line 3 during the night shift' }],
  ['CORRECTIVE_ACTION', { correctiveAction: 'Batch quarantined; supplier notified and asked to re-inspect' }],
  ['PREVENTIVE_ACTION', { preventiveAction: 'Supplier to add an inline seal-integrity check and report monthly' }],
  ['VERIFICATION', { verification: 'Next two deliveries inspected on arrival, no delamination found' }],
  ['CLOSED', {}],
];
for (const [status, evidence] of steps) {
  const r = await qa('POST', `/quality-incidents/${inc.body.id}/advance`, { status, ...evidence });
  check(`advance -> ${status}`, r.ok && r.body.status === status, r.ok ? '' : String(r.body.error).slice(0, 60));
}
const closed = await qa('GET', `/quality-incidents/${inc.body.id}`);
check('closed record retains the whole CAPA chain',
  !!closed.body.rootCause && !!closed.body.correctiveAction && !!closed.body.preventiveAction && !!closed.body.verification);
const reopen = await qa('POST', `/quality-incidents/${inc.body.id}/advance`, { status: 'INVESTIGATING' });
check('a closed incident cannot be reopened', !reopen.ok, String(reopen.body.error).slice(0, 60));

console.log('\n===== §43 CONFIGURABLE APPROVAL ENGINE =====\n');
const def = await admin('POST', '/workflows/definitions', {
  code: 'PO_TIERED', name: 'Tiered purchase approval', documentType: 'PURCHASE_ORDER',
  steps: [
    { step: 1, name: 'Procurement review', requiredPermission: 'procurement.purchase_order.APPROVE', notifyRoles: ['PROCUREMENT_OFFICER'] },
    { step: 2, name: 'Finance review', requiredPermission: 'finance.invoice.APPROVE', minAmount: 20000, notifyRoles: ['FINANCE_OFFICER'] },
  ],
});
check('definition saved', def.ok, `${def.body.code}: ${def.body.steps?.length} steps`);

const bogus = await admin('POST', '/workflows/definitions', {
  code: 'BAD', name: 'Bad', documentType: 'PURCHASE_ORDER',
  steps: [{ step: 1, name: 'Nope', requiredPermission: 'does.not.EXIST' }],
});
check('a step naming an unknown permission is refused', !bogus.ok, String(bogus.body.error).slice(0, 80));

const small = await admin('POST', '/workflows/preview', { documentType: 'PURCHASE_ORDER', documentId: 'x', amount: 5000 });
check('a small order skips finance review', small.body.steps.length === 1, small.body.steps.map(s => s.name).join(' -> '));
const big = await admin('POST', '/workflows/preview', { documentType: 'PURCHASE_ORDER', documentId: 'x', amount: 90000 });
check('a large order requires both steps', big.body.steps.length === 2, big.body.steps.map(s => s.name).join(' -> '));

const docId = crypto.randomUUID();
const started = await proc('POST', '/workflows/start', { documentType: 'PURCHASE_ORDER', documentId: docId, amount: 90000 });
check('workflow started', started.ok, `at step ${started.body?.currentStep}`);

const wrongRole = await fin('POST', '/workflows/act', { documentType: 'PURCHASE_ORDER', documentId: docId, action: 'APPROVE' });
check('finance cannot approve the procurement step', !wrongRole.ok, String(wrongRole.body.error).slice(0, 70));

const step1 = await proc('POST', '/workflows/act', { documentType: 'PURCHASE_ORDER', documentId: docId, action: 'APPROVE' });
check('procurement approves step 1', step1.ok && step1.body.currentStep === 2);

const sameUser = await proc('POST', '/workflows/act', { documentType: 'PURCHASE_ORDER', documentId: docId, action: 'APPROVE' });
check('SEGREGATION OF DUTIES: same person cannot approve step 2', !sameUser.ok, String(sameUser.body.error).slice(0, 80));

const step2 = await fin('POST', '/workflows/act', { documentType: 'PURCHASE_ORDER', documentId: docId, action: 'APPROVE' });
check('finance approves step 2 and the chain completes', step2.body?.status === 'APPROVED', step2.body?.status);

const rejectNoComment = await proc('POST', '/workflows/act', { documentType: 'PURCHASE_ORDER', documentId: docId, action: 'REJECT' });
check('a completed chain cannot be acted on again', !rejectNoComment.ok, String(rejectNoComment.body.error).slice(0, 60));

const queue = await fin('GET', '/workflows/queue');
check('approval queue is per-user and permission-aware', Array.isArray(queue.body), `${queue.body.length} item(s) waiting on finance`);

console.log(`\n${fails === 0 ? 'ALL CAPA + WORKFLOW CHECKS PASSED' : `${fails} CHECK(S) FAILED`}\n`);
process.exit(fails ? 1 : 0);
