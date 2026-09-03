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


/**
 * The dispensing re-audit.
 *
 * Two directions, and the second one matters more. Reviewing the dispensing
 * module against the code found rows marked IMPLEMENTED whose evidence named
 * something that did not exist — a setting with no key, a field nothing read, a
 * scan step nobody had built. A matrix that agrees with itself rather than with
 * the code is worse than no matrix, so those rows are corrected here whether
 * the correction is upward or downward.
 *
 * `status` is the status the row should now carry; `evidence` is what a reader
 * can open to check it; `tests` names the suite that proves it.
 */
const REAUDIT = {
  623: {
    status: 'IMPLEMENTED',
    evidence:
      'PrescriptionStatus NEW UNDER_REVIEW APPROVED PARTIALLY_DISPENSED READY_FOR_COLLECTION ' +
      'DISPENSED REJECTED CANCELLED EXPIRED',
    tests: 'e2e-dispensing',
    note: 'the evidence named a VERIFIED status the enum has never had',
  },
  628: {
    status: 'IMPLEMENTED',
    evidence: 'GET /prescriptions/queue: urgent first then longest waiting, with waiting times and counts',
    tests: 'e2e-dispensing',
  },
  629: {
    status: 'IMPLEMENTED',
    evidence: 'Prescription.isUrgent, set by the pharmacist; the queue orders by it before age',
    tests: 'e2e-dispensing',
  },
  631: {
    status: 'PARTIALLY IMPLEMENTED',
    evidence:
      'POST /dispensing/preview names the batch and expiry FEFO will pick, and a supplied batchId ' +
      'is validated against stock; there is no scan-to-confirm step at the point of supply',
    tests: 'e2e-dispensing',
    note: 'was IMPLEMENTED on evidence of a scan step that does not exist',
  },
  632: {
    status: 'PARTIALLY IMPLEMENTED',
    evidence:
      'the supplied product is checked against the prescription line and a substitution needs a ' +
      'reason; the check is not driven by a scan',
    tests: 'e2e-dispensing',
    note: 'the product was not checked against the line at all before this release',
  },
  633: {
    status: 'IMPLEMENTED',
    evidence:
      'a patientId that contradicts the prescription is refused rather than stored ' +
      '(DispensingService.dispense)',
    tests: 'e2e-dispensing',
    note: 'the caller could previously send a different patient and have it recorded',
  },
  635: {
    status: 'IMPLEMENTED',
    evidence:
      'GET /dispensing/:id/label assembles the label in one read; components/dispensing/Label.tsx ' +
      'prints it per item with its own page',
    tests: 'e2e-dispensing',
    note: 'there was no label of any kind before this release',
  },
  636: {
    status: 'IMPLEMENTED',
    evidence: 'dose, frequency and duration print as the directions; instructions print beneath them',
    tests: 'e2e-dispensing',
  },
  639: {
    status: 'IMPLEMENTED',
    evidence:
      'POST /dispensing/:id/reverse: compensating movements against the original picks, the ' +
      'prescription restored, a controlled-register REVERSAL, and reversedAt/reversedById/reason ' +
      'kept on the record',
    tests: 'e2e-dispensing',
  },
  640: {
    status: 'IMPLEMENTED',
    evidence:
      '"do not substitute" is enforced; any other product against a line needs a recorded reason',
    tests: 'e2e-dispensing',
  },
  643: {
    status: 'IMPLEMENTED',
    evidence:
      'the dispensing.minRefillIntervalDays setting raises an EARLY_REFILL warning on the preview ' +
      'and the supply',
    tests: 'e2e-dispensing',
    note: 'the setting the old evidence named did not exist',
  },
  644: {
    status: 'IMPLEMENTED',
    evidence: 'Product.maxDispenseQty is read and enforced per supply; 0 means no ceiling',
    tests: 'e2e-dispensing',
    note: 'the field existed and nothing read it',
  },
  646: {
    status: 'IMPLEMENTED',
    evidence: 'Dispensing.notes and Dispensing.counsellingNotes, both captured on the screen',
    tests: 'e2e-dispensing',
  },
  649: {
    status: 'IMPLEMENTED',
    evidence: 'GET /dispensing/summary/today and GET /dispensing/workload',
    tests: 'e2e-dispensing',
  },
  650: {
    status: 'IMPLEMENTED',
    evidence: "the queue counts plus today's supplies, reversals, substitutions and overrides",
    tests: 'e2e-dispensing',
  },
  683: {
    status: 'IMPLEMENTED',
    evidence:
      'PrescriptionStatus.READY_FOR_COLLECTION with readyAt; POST /prescriptions/:id/ready and ' +
      '/collect, which records who collected it',
    tests: 'e2e-dispensing',
  },
  831: {
    status: 'IMPLEMENTED',
    evidence:
      'Product.maxDispenseQty refuses an excessive single supply; an early repeat raises a warning ' +
      'the pharmacist must answer',
    tests: 'e2e-dispensing',
  },
  880: {
    status: 'IMPLEMENTED',
    evidence:
      'GET /dispensing/workload: dispensings, lines, reversals and counselling rate per pharmacist, ' +
      'stated as a workload measure rather than a score',
    tests: 'e2e-dispensing',
  },
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
    } else if (REAUDIT[num]) {
      const { status, evidence, tests } = REAUDIT[num];
      if (file.includes('TRACEABILITY')) {
        const full = status === 'IMPLEMENTED';
        cols[5] = '✓'; cols[6] = '✓'; cols[7] = '✓'; cols[8] = '✓';
        cols[9] = '✓';
        cols[10] = full ? '✓' : '—';
        cols[11] = tests;
        cols[12] = status;
      } else {
        cols[4] = status;
        cols[5] = evidence.replace(/\|/g, '/');
      }
      const rewritten = `| ${cols.slice(1, -1).join(' | ')} |`;
      if (rewritten !== line) changed++;
      lines[i] = rewritten;
    }
  }

  text = lines.join('\n');

  /**
   * Count the row's OVERALL status, which is the last column.
   *
   * This used to count any line containing `| STATUS |` anywhere and then
   * subtract the other statuses to undo the overlap. That subtraction was
   * wrong — the per-layer columns are ticks, not statuses, so nothing
   * overlapped — and it quietly reported 220 fewer implemented features than
   * the matrix itself listed. Reading the one column that carries the answer
   * removes the arithmetic entirely.
   */
  // The two matrices put the status in different columns — last in the
  // traceability matrix, fourth in the feature matrix — so the status is found
  // by what it says rather than by where it sits.
  const STATUSES = ['IMPLEMENTED', 'PARTIALLY IMPLEMENTED', 'NOT IMPLEMENTED', 'EXTERNAL DEPENDENCY'];
  const statusOf = (line) =>
    line
      .split('|')
      .map((c) => c.trim())
      .find((c) => STATUSES.includes(c)) ?? null;
  const count = (needle) =>
    text
      .split('\n')
      .filter((l) => l.startsWith('| `PHARM-') && statusOf(l) === needle).length;
  const pureImpl = count('IMPLEMENTED');
  const part = count('PARTIALLY IMPLEMENTED');
  const not = count('NOT IMPLEMENTED');
  const ext = count('EXTERNAL DEPENDENCY');
  const total = pureImpl + part + not + ext;
  if (total !== 1000) {
    throw new Error(
      `The matrix classifies ${total} rows, not 1000 (${pureImpl} implemented, ${part} partial, ` +
        `${not} not, ${ext} external). A row with an unrecognised status would be silently ` +
        'dropped from the totals, so this refuses rather than reporting a number that is wrong.',
    );
  }
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
