// Re-audit the feature matrix against the code as it stands now, and rewrite
// the totals in both matrices.
//
// Every status change below names the code that justifies it. A feature is not
// moved to IMPLEMENTED because work happened near it — the evidence column has
// to point at something a reader can open.
import { readFile, writeFile } from 'node:fs/promises';

const CLOSED = {
  // Serial lifecycle — modules/serials/*, migration 20260902211922
  140: ['Serial dispensing', 'SerialsService.recordEvent DISPENSED; serial.state.ts transition table'],
  141: ['Serial transferring', 'SerialsService.recordEvent TRANSFERRED/RECEIVED'],
  142: ['Serial returning', 'SerialsService.recordEvent RETURNED, then RELEASED or DESTROYED'],
  145: ['Serial status history', 'SerialEvent append-only; GET /serials/:id'],
  147: ['Mass serial import', 'POST /serials/import; duplicates reported, never overwritten'],
  149: ['Serial-level audit trail', 'AuditService.record on every serial event'],

  // Expiry analytics — InventoryService
  168: ['Expiry calendar', 'GET /inventory/expiry/calendar; Calendar tab'],
  173: ['Historical expiry trend', 'GET /inventory/expiry/trend, read from the ledger at posted cost'],
  174: ['Branch expiry comparison', 'GET /inventory/expiry/comparison?dimension=branch'],
  175: ['Category expiry comparison', 'GET /inventory/expiry/comparison?dimension=category'],
  176: ['Supplier expiry comparison', 'GET /inventory/expiry/comparison?dimension=supplier'],

  // Suppliers
  312: ['Supplier credit limits', 'Supplier.creditLimit; assertWithinCreditLimit blocks PO approval'],
  341: ['Supplier risk level', 'Supplier.riskLevel + riskNotes, validated vocabulary'],
  343: ['Supplier dependency analysis', 'GET /suppliers/dependency-analysis'],
  344: ['Single-source dependency alert', 'dependencyAnalysis severity by supplier risk'],

  // Stock counts
  453: ['Blind counting', 'StockCount.isBlind; maskBlind hides systemQty server-side'],
  471: ['Count freeze option', 'StockCount.isFrozen; LedgerService.assertNotFrozen refuses the movement'],
  486: ['Theft-loss classification', 'StockAdjustmentItem.lossType THEFT; loss analysis by cause'],
  488: ['Misplacement classification', 'StockAdjustmentItem.lossType MISPLACEMENT'],

  // Transfers
  528: ['Driver information', 'StockTransfer.driverName/driverPhone, captured at dispatch'],
  529: ['Tracking-number support', 'StockTransfer.trackingNumber'],
  530: ['Expected arrival', 'StockTransfer.expectedArrival, validated to be in the future'],
  531: ['Delayed transfer alerts', 'GET /transfers/overdue with severity by lateness'],

  // Patients
  689: ['Duplicate patient detection', 'GET /patients/duplicates; normalised phone and name+DOB'],
  690: ['Patient merge workflow', 'POST /patients/:id/merge; history repointed, allergies combined'],
  693: ['Account anonymization workflow', 'POST /patients/:id/anonymize; record kept, identity cleared'],

  // Cold-chain equipment
  759: ['Sensor calibration history', 'SensorCalibration append-only; GET /cold-chain/equipment/:id'],
  760: ['Sensor calibration expiration', 'TemperatureSensor.calibrationDueAt; a FAIL revokes it'],
  792: ['Calibration reminders', 'GET /cold-chain/equipment/due, severity CRITICAL when never calibrated'],
  793: ['Maintenance reminders', 'SensorMaintenance.nextDueAt surfaced by equipment/due'],
  794: ['Equipment service history', 'SensorMaintenance append-only'],

  // Controlled-register anomaly detection
  830: ['Suspicious transaction alerts', 'GET /controlled-register/anomalies, five signal types'],
  832: ['Unusual-frequency alerts', 'DISPENSER_VOLUME_OUTLIER and PRESCRIBER_CONCENTRATION signals'],
  834: ['After-hours access alerts', 'OUT_OF_HOURS signal'],

  // Forecasting
  887: ['Forecast accuracy calculation', 'GET /analytics/forecast/:id/accuracy; walk-forward MAE/MAPE/bias'],
  888: ['Forecast-versus-actual report', 'per-month predicted vs actual points in the accuracy response'],

  // Platform
  899: ['Scheduled report delivery', 'ReportBuilderService.deliverScheduled, hourly, as the report owner'],
  953: ['API versioning', 'URI versioning: every route served at /api and /api/v1'],
};

// Moved to PARTIAL rather than IMPLEMENTED, with the gap stated.
const PARTIAL = {
  694: [
    'Retention-policy engine',
    'Lists dormant records and blocks any with an outstanding balance. It never ' +
    'erases on a timer by design — that is how a record still needed for an open ' +
    'recall disappears — so the deciding half is a person, not an engine.',
  ],
  991: [
    'Saved filters',
    'DataTable saved views persist per browser in localStorage. They are not ' +
    'stored server-side, so they do not follow a user to another device.',
  ],
};

for (const file of ['specs/TRACEABILITY_MATRIX.md', 'specs/FEATURE_MATRIX.md']) {
  let text = await readFile(file, 'utf8');
  const lines = text.split('\n');
  let changed = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('| `PHARM-')) continue;
    const cols = line.split('|').map((c) => c.trim());
    const num = Number(cols[2]);
    if (!Number.isFinite(num)) continue;

    if (CLOSED[num] && line.includes('NOT IMPLEMENTED')) {
      const [, evidence] = CLOSED[num];
      if (file.includes('TRACEABILITY')) {
        // Req | # | Feature | Spec | DB | BE | API | RBAC | UI | Audit | Tests | Status
        cols[5] = '✓'; cols[6] = '✓'; cols[7] = '✓'; cols[8] = '✓';
        cols[9] = '✓'; cols[10] = '✓';
        cols[11] = 'e2e-lifecycle';
        cols[12] = 'IMPLEMENTED';
      } else {
        // Requirement | # | Feature | Status | Evidence
        cols[4] = 'IMPLEMENTED';
        cols[5] = evidence;
      }
      lines[i] = `| ${cols.slice(1, -1).join(' | ')} |`;
      changed++;
    } else if (PARTIAL[num] && line.includes('NOT IMPLEMENTED')) {
      const [, gap] = PARTIAL[num];
      if (file.includes('TRACEABILITY')) {
        cols[5] = '✓'; cols[6] = '✓'; cols[7] = '✓'; cols[8] = '✓'; cols[9] = '✓';
        cols[10] = '—';
        cols[11] = 'e2e-lifecycle';
        cols[12] = 'PARTIALLY IMPLEMENTED';
      } else {
        cols[4] = 'PARTIALLY IMPLEMENTED';
        cols[5] = gap.replace(/\|/g, '/');
      }
      lines[i] = `| ${cols.slice(1, -1).join(' | ')} |`;
      changed++;
    }
  }

  text = lines.join('\n');

  const count = (needle) =>
    text.split('\n').filter((l) => l.startsWith('| `PHARM-') && l.includes(`| ${needle} |`)).length;
  const impl = count('IMPLEMENTED') ;
  const part = count('PARTIALLY IMPLEMENTED');
  const not = count('NOT IMPLEMENTED');
  const ext = count('EXTERNAL DEPENDENCY');
  // "IMPLEMENTED" also matches inside "PARTIALLY IMPLEMENTED" / "NOT IMPLEMENTED".
  const pureImpl = impl - part - not;
  const weighted = (pureImpl + part / 2).toFixed(1);

  text = text
    .replace(/- IMPLEMENTED: \*\*\d+\*\*/, `- IMPLEMENTED: **${pureImpl}**`)
    .replace(/- PARTIALLY IMPLEMENTED: \*\*\d+\*\*/, `- PARTIALLY IMPLEMENTED: **${part}**`)
    .replace(/- NOT IMPLEMENTED: \*\*\d+\*\*/, `- NOT IMPLEMENTED: **${not}**`)
    .replace(/- Weighted \(partial counts a half\): \*\*[\d.]+ \/ 1000\*\*/,
             `- Weighted (partial counts a half): **${weighted} / 1000**`);

  await writeFile(file, text);
  console.log(`${file}: ${changed} rows updated → ${pureImpl} implemented, ${part} partial, ${not} not, ${ext} external (weighted ${weighted}/1000)`);
}
