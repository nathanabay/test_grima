# Architecture

## Shape

```
apps/api            NestJS 10 — one module per business domain
apps/web            Next.js 15 App Router, React 18, Tailwind
packages/shared     pure domain logic with no I/O and no framework
```

`packages/shared` holds the rules that must be identical everywhere and must be
exhaustively testable: FEFO allocation, GS1 parsing, unit conversion, expiry
bucketing, replenishment arithmetic, ABC/XYZ analysis, the permission
catalogue, the automation condition evaluator and CSV handling. None of it
touches a database or a request, so every branch is reachable from a unit test.

## The rule that shapes everything else

**The rules that matter are enforced at the data layer, not in the interface.**
Expired, recalled and quarantined medicine cannot be dispensed because the stock
ledger refuses the movement, not because a button is hidden. Every screen in
`apps/web` is a view onto an API that would refuse the same operation if it were
called directly with curl.

## One authority per rule

A second implementation of a rule is a second set of rules that will drift, so
each of these lives in exactly one place and everything else calls it:

| Rule | Authority | Callers |
| --- | --- | --- |
| Which batch to take | `packages/shared/src/fefo.ts` | POS, dispensing, transfers, picking, disposal |
| Moving stock | `modules/inventory/ledger.service.ts` | every module that changes a quantity |
| What a product costs | `modules/catalog/pricing.service.ts` | POS, dispensing, quotation, invoicing |
| What stock is worth | `modules/accounting/valuation.service.ts` | ledger posting, valuation report, reconciliation |
| Posting to the ledger | `modules/accounting/journal.service.ts` | every document that has an accounting effect |
| Who may do what | `common/guards` + `packages/shared/src/permissions.ts` | every controller, and API keys |
| Configurable thresholds | `common/config/settings.catalog.ts` | every service that has a threshold |

## Stock ledger

`inventory_transactions` is append-only: nothing updates or deletes a row.
`inventory_balances` is a cache written inside the same transaction, and
`GET /api/inventory/ledger/integrity` replays the ledger to prove the cache has
not drifted. A drift is reported, never silently corrected.

Every movement takes `SELECT … FOR UPDATE` on the balance row plus a
transaction-scoped `pg_advisory_xact_lock`, inside one interactive transaction.
Two cashiers selling the last ten units concurrently produce exactly one
success, one ledger row and a balance of zero.

## FEFO physical picking vs. accounting valuation

These are deliberately independent and must not be conflated:

- **FEFO decides which physical batch leaves the shelf.** It is a patient-safety
  rule: the pack closest to expiry goes first.
- **The valuation method decides what that movement costs.** FIFO cost layers
  or a running weighted average, configured in `finance.valuationMethod`.

A pharmacy can pick FEFO and value on weighted average at the same time, and
most do. `valuation.service.ts` never reads the expiry date to decide cost, and
`fefo.ts` never reads a cost to decide what to pick.

## Configuration, not constants

`common/config/settings.catalog.ts` declares every operational threshold with a
type, a default, bounds and an explanation. Services read them through
`ConfigService`, which resolves database override → environment → catalogue
default. Feature flags additionally declare a `requires` environment variable: a
flag whose dependency is missing stays off however it is set, and the
administration screen says why rather than pretending it can be turned on.

## Audit

Every audit row carries a SHA-256 over its content chained to the previous row's
hash, so rewriting history breaks every subsequent hash.
`GET /api/admin/audit-logs/verify` walks the chain and names the first broken
sequence. Payloads are canonicalised before hashing — `jsonb` does not preserve
key order, dates round-trip as ISO strings, and a Prisma `Decimal` is reduced to
the number `jsonb` will hand back — so an intact row always verifies.

Audit rows are written inside the transaction they describe, so an audit entry
can never survive a rollback of the operation it records.

## Soft delete and correction

Nothing with financial or regulatory weight is edited or deleted:

- A posted journal entry is corrected by a reversal that points back at it.
- A controlled-register correction appends a REVERSAL row.
- A recall blocks batches; it never removes them.
- Products, suppliers and batches deactivate rather than disappear.

## Background work

`modules/jobs` registers every scheduled rule with a runner that writes a
`job_runs` row before and after. That is the difference between "the cron is
configured" and "the job actually ran last night", and it is what
`/admin/jobs` and the system-health screen read.

## Multi-tenancy and scope

`ScopeService` turns a user's branch and warehouse assignments into a Prisma
filter applied inside each query, not after it. An organization → business unit
→ region → branch → department → warehouse hierarchy sits above it. An API key
resolves into the same `AuthenticatedUser` shape as a person, so an integration
is scoped and permission-checked identically and can never reach something no
role could.
