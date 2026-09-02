# Acceptance criteria

The criteria the specification names explicitly, in Given-When-Then form, each
mapped to the automated test that proves it. A criterion with no test is not a
criterion, it is a hope.

## PHARM-FEFO-001 — FEFO allocation across batches

```
GIVEN  Batch B01 expires 2026-12-31 with 100 available
  AND  Batch B02 expires 2027-06-30 with 100 available
  AND  Batch B03 expires 2028-01-31 with 100 available
WHEN   150 units are requested
THEN   100 are allocated from B01
  AND  50 are allocated from B02
  AND  0 are allocated from B03
  AND  the allocation is atomic
```
Test: `apps/api/test/fefo.spec.ts` — "allocates across batches, nearest expiry first".

## PHARM-FEFO-002 — Blocked batches are skipped

```
GIVEN  the three batches above
  AND  B01 is RECALLED
WHEN   150 units are requested
THEN   100 come from B02 and 50 from B03
  AND  B01 appears in the excluded list with the reason

GIVEN  B02 is additionally QUARANTINED
THEN   only eligible stock is allocated, and the shortfall is reported
```
Test: `apps/api/test/fefo.spec.ts` — exclusion cases.

## PHARM-LEDG-001 — Concurrency never produces negative stock

```
GIVEN  10 units available
WHEN   two requests for 8 units are submitted concurrently
THEN   exactly one succeeds
  AND  one ledger row is written
  AND  the balance is 2, never -6
```
Test: `apps/api/test/ledger.integration.spec.ts` — concurrent dispensing.

## PHARM-FEFO-003 — Expired stock never leaves the shelf

```
GIVEN  a batch whose expiry date has passed
WHEN   it is sold, dispensed, reserved or transferred as saleable stock
THEN   the ledger refuses the movement with the expiry date in the message
```
Tests: `fefo.spec.ts`, `scripts/e2e-workflow.mjs`, `scripts/e2e-damage-pos.mjs`.

## PHARM-RECALL-001 — Activation blocks stock in the same transaction

```
GIVEN  a batch in stock across several branches, some already dispensed
WHEN   a recall is activated on it
THEN   the batch is blocked in the transaction that creates the recall
  AND  dispensing and sale are refused, and the refusal says "recall"
  AND  every holding location produces a task
  AND  every affected patient produces a task
  AND  historical dispensings and retail sales are both traced
  AND  recovery is tracked against the affected quantity
```
Test: `scripts/e2e-workflow.mjs` — recall section.

## PHARM-COLD-001 — Excursion quarantines, never destroys

```
GIVEN  a product requiring 2–8°C
WHEN   the monitored storage exceeds the configured excursion tolerance
THEN   an excursion is opened with its duration and min/max
  AND  affected batches are identified from the stock at that location
  AND  those batches are quarantined automatically
  AND  QA is notified and the disposition stays PENDING
  AND  nothing is destroyed automatically
```
Test: `scripts/e2e-workflow.mjs` — cold chain section.

## PHARM-CTRL-001 — Controlled corrections are reversals

```
GIVEN  a controlled register entry
WHEN   it is corrected
THEN   the original is not modified
  AND  a REVERSAL entry is appended pointing at it
  AND  the correction needs the controlled permission
  AND  both actions are audited
```
Test: `scripts/e2e-workflow.mjs` — controlled register section.

## PHARM-SEC-001 — Branch isolation cannot be bypassed

```
GIVEN  a user scoped to branch A
WHEN   they request a record in branch B by changing the URL, the record id,
       an API query parameter or the request payload
THEN   the request is refused
  AND  the record does not appear in any list, search or report
```
Tests: `scripts/e2e-workflow.mjs`, `scripts/e2e-enterprise.mjs`.

## PHARM-SEC-002 — Audit preserves old and new values

```
GIVEN  a price of 100
WHEN   it is changed to 120
THEN   the audit row holds 100 as the previous value and 120 as the new one
  AND  the actor and timestamp
  AND  the reason where the change requires one
  AND  the hash chain still verifies
```
Tests: `scripts/e2e-enterprise.mjs` — audit section; `e2e-workflow.mjs` — tamper detection.

## PHARM-PRODX-001 — One pricing authority

```
GIVEN  a product with a retail price, a wholesale price and a matching price list
WHEN   a price is resolved for a customer group at a quantity
THEN   the list price wins over the channel price
  AND  the group discount applies after the list price
  AND  every candidate considered is returned in the explanation
```
Test: `apps/api/test/pricing.integration.spec.ts`, `e2e-enterprise.mjs`.

## PHARM-PLAT-001 — An integration cannot escalate privilege

```
GIVEN  a user who does not hold admin.user.CREATE
WHEN   they create an API key granting that permission
THEN   the request is refused
  AND  a key that is revoked stops working on the next call
  AND  a key cannot reach an endpoint outside its scopes
```
Test: `scripts/e2e-enterprise.mjs` — integration security section.

## PHARM-SEC-003 — Configuration takes effect

```
GIVEN  a declared setting
WHEN   an administrator changes it
THEN   the behaviour it governs changes with it
  OR   the setting is marked "not enforced" with the reason, and a test asserts
       that no code path reads it
```
Tests: `apps/api/test/settings-enforced.spec.ts`, `e2e-enterprise.mjs` — settings section.

## PHARM-UX-001 — The interface never claims what the API refuses

```
GIVEN  any destructive or approval action hidden from a user in the interface
WHEN   that user calls the endpoint directly
THEN   the API refuses it on its own authority
```
Tests: permission checks throughout the end-to-end suites.
