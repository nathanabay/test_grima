# Workflow matrix

Every state machine in the system: what the states are, who may move between
them, and which transitions are refused.

A transition table is not documentation of the code — in each case below it *is*
the code, encoded as data so that no path can skip it.

## Purchase order

`DRAFT → SUBMITTED → PROCUREMENT_REVIEW → FINANCE_REVIEW → APPROVED → ORDERED →
PARTIALLY_RECEIVED → RECEIVED → CLOSED`, with `CANCELLED` reachable until it is
ordered.

- Approval is refused when it would take the supplier past their agreed credit
  limit, counting orders already approved but not yet invoiced as well as unpaid
  invoices. A dozen orders that each pass individually would otherwise blow the
  limit together.
- A limit of zero means none was agreed, not "nothing may be ordered".
- Finance holds `procurement.purchase_order.READ` but not `APPROVE`, so one
  officer cannot clear both steps of a tiered chain.

## Goods receipt

Delivered, accepted and rejected are three different numbers. Only the accepted
quantity reaches stock; the rest is recorded with its rejection reason.

A batch arrives `QUARANTINED` and is not allocatable by FEFO until QA releases
it. Stock physically exists the moment it is received — it is simply not
sellable.

A line dated with an expiry already past is refused outright.

## Batch status

`QUARANTINED → RELEASED` (QA), `→ BLOCKED` (any reason), `→ RECALLED`,
`→ EXPIRED` (by the sweep).

Only `AVAILABLE` and `RELEASED` batches may be allocated for a sale, a
dispensing, a transfer out or a reservation. Recall and disposal flows are the
only ones that may move otherwise-blocked stock, and they say so explicitly with
`allowBlockedStatus`.

## Stock transfer

`DRAFT → SUBMITTED → APPROVED → PICKING → IN_TRANSIT → PARTIALLY_RECEIVED →
RECEIVED`.

Transit is modelled explicitly, so stock is never invisible and never
double-counted. Dispatch removes it from the origin; receipt adds it at the
destination; a shortfall requires a variance reason.

A transfer past its expected arrival is reported as overdue with a severity
scaled by lateness — a day late is a phone call, a week late is an
investigation. Where no arrival was stated, the configured transit allowance is
used, so a dispatch made without logistics detail is still watched.

## Stock count

`DRAFT → SUBMITTED → CLOSED`.

- A **blind** count masks the system quantity server-side until the sheet is
  submitted, or to a supervisor who must judge the variance. Showing the
  expected number to the person holding the clipboard turns a count into a
  confirmation exercise.
- A **frozen** count refuses any ledger movement touching a counted position
  until it is posted or unfrozen. The freeze is narrow — one warehouse, one
  product — so freezing the cold room never stops the front counter selling
  paracetamol.
- Variances beyond `count.tolerancePercent` or `count.escalationValue` require
  supervisor approval and a written explanation before the count will post.
- A system quantity of zero with anything counted is always outside tolerance:
  stock that should not exist has to be looked at.

## Stock adjustment

Every negative line must state a loss cause from a fixed vocabulary. A positive
line is stock found, not a loss, and carrying a loss type is refused.

Backdating is bounded by `inventory.backdateLimitDays`; future dating is off
unless `inventory.allowFutureDating` is on, because a movement dated in the
future has not happened yet.

## Serial lifecycle

```
IN_STOCK    → DISPENSED | SOLD | TRANSFERRED | RECALLED | DESTROYED
TRANSFERRED → RECEIVED | RECALLED | DESTROYED
DISPENSED   → RETURNED | RECALLED
SOLD        → RETURNED | RECALLED
RETURNED    → RELEASED | DESTROYED | RECALLED
RECALLED    → DESTROYED | RELEASED
DESTROYED   → (terminal)
```

`CORRECTED` is legal from any state and is the only way to fix a wrong entry.
It requires a reason, names its own target status, and leaves the wrong entry
visible — that is the point of a trace.

A returned pack goes through a release decision rather than straight back to
stock: returning stock to the shelf without a QA decision is exactly how a
tampered pack re-enters the supply chain. Destruction is terminal, because a
"movement" after incineration is a data error and accepting it silently would
make the destruction record worthless.

## Temperature excursion

`OPEN → PENDING → RELEASED | QUARANTINED | DESTROYED`.

A breach longer than the sensor tolerance quarantines the affected stock
automatically. Releasing requires an investigation note. The system never
declares temperature-exposed medicine safe by itself.

## Sensor calibration

A certificate is `PASS`, `ADJUSTED` or `FAIL`, and the history is append-only.

A `FAIL` does not merely fail to extend the due date — it **revokes** the
certificate the sensor was still carrying. An instrument that has demonstrably
drifted is not calibrated just because its previous certificate has not expired,
and leaving it reading valid would let a QA release rest on a reading nobody
should trust.

## Recall

`DRAFT → ACTIVE → CLOSED`. Activating traces every batch position, transfer,
dispensing and sale, resolving patient names and phone numbers so the trace
reaches a person rather than an id. Serial-level recall marks every reachable
pack and reports the count it could not reach, because that is the number the
recall report has to state.

## Controlled register

Append-only with a running balance. Nothing is edited or deleted; a mistake is
corrected by appending a reversal that names the entry it reverses and why.

Reconciliation against physical stock reports any difference for investigation
and never auto-corrects. Most jurisdictions run at zero tolerance, which is the
default; `controlled.varianceTolerance` exists for those that allow a stated
allowance on measurable forms.

## Patient merge

The surviving record takes the union of the clinical data — an allergy recorded
only on the duplicate must survive the merge, or the merge has made the patient
less safe. Balances add up. Prescriptions, dispensings, sales, returns,
consents, recall tasks and controlled-register entries are all repointed.

The duplicate is kept, deactivated and marked, never deleted: a prescription
printed last year still has to resolve to something.

## Patient anonymisation

The row is kept and the identifying fields are cleared. Deleting it would orphan
dispensing records a regulator requires to exist and would break the
controlled-drug register.

Refused while the patient has an outstanding balance — a debt that loses its
owner is a debt nobody can collect or write off. Retention candidates are only
ever listed, never erased on a timer: that is how a record still needed for an
open recall disappears.

## Approval workflows

Definitions carry steps, each with a required permission. The queue is
per-user and permission-aware, so somebody sees only what they can actually act
on. A step cannot be actioned by the person who raised the request where the
definition says so.
