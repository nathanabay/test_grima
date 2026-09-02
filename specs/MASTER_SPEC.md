# Master Specification

PharmaCore — enterprise pharmacy inventory and management platform.

## The rule this system is built around

**The rules that matter are enforced at the data layer, not in the interface.**
Expired, recalled and quarantined medicine cannot be dispensed because the stock
ledger refuses the movement, not because a button is hidden. Every screen is a
view onto an API that would refuse the same operation called directly with curl.

This is the test to apply to any change: if the interface were bypassed, would
the rule still hold?

## Scope

The functional scope is the 1,000 numbered features of the master requirement
plus the existing baseline system. Every one carries a stable requirement ID and
appears in `FEATURE_MATRIX.md` and `TRACEABILITY_MATRIX.md` with its status. No
feature is dropped: one that is not built is recorded as NOT IMPLEMENTED with the
reason and the exact technical action, in `KNOWN_EXTERNAL_DEPENDENCIES.md`.

## Requirement identifiers

`PHARM-<DOMAIN>-<NNN>`, stable across releases.

| Domain | Covers | Feature range |
| --- | --- | ---: |
| PROD | Product master | 1–50 |
| PRODX | Product intelligence, flags, planning, pricing | 51–100 |
| BATCH | Batch and serialization | 101–150 |
| FEFO | Expiry and the FEFO engine | 151–200 |
| WHSE | Warehouse management | 201–250 |
| PROC | Procurement | 251–300 |
| SUPP | Supplier management | 301–350 |
| RECV | Receiving and quality | 351–400 |
| LEDG | Stock transaction engine | 401–450 |
| COUNT | Stock counts and loss control | 451–500 |
| XFER | Inter-branch transfers | 501–550 |
| POS | Point of sale | 551–600 |
| RX | Prescriptions and dispensing | 601–650 |
| CRM | Patient and customer | 651–700 |
| RECALL | Recall, return and disposal | 701–750 |
| COLD | Cold chain and IoT | 751–800 |
| CTRL | Controlled medicines and compliance | 801–850 |
| ANLY | Reporting, analytics, forecasting | 851–900 |
| SEC | Security, audit, administration | 901–950 |
| PLAT | Integration, mobile, automation, platform | 951–1000 |

## One authority per rule

A second implementation of a rule is a second set of rules that will drift. Each
of these lives in exactly one place and everything else calls it.

| Rule | Authority | Callers |
| --- | --- | --- |
| Which batch leaves the shelf | `packages/shared/src/fefo.ts` | POS, dispensing, transfers, picking, disposal |
| Moving stock | `modules/inventory/ledger.service.ts` | every module that changes a quantity |
| What a product costs | `modules/catalog/pricing.service.ts` | POS, dispensing, quotation, invoicing |
| What stock is worth | `modules/accounting/valuation.service.ts` | posting, valuation, reconciliation |
| Posting to the ledger | `modules/accounting/journal.service.ts` | every document with an accounting effect |
| Who may do what | `common/guards` + `packages/shared/src/permissions.ts` | every controller, and every API key |
| Configurable thresholds | `common/config/settings.catalog.ts` | every service with a threshold |
| Expiry classification | `packages/shared/src/expiry.ts` | expiry report, dashboard, health score |

## FEFO and valuation are independent

Conflating them is the classic mistake in this domain.

- **FEFO decides which physical pack leaves the shelf.** A patient-safety rule:
  closest to expiry goes first. No setting can override the expiry order.
- **The valuation method decides what that movement cost.** FIFO cost layers or a
  running weighted average, configured in `finance.valuationMethod`.

A pharmacy can pick FEFO and value on weighted average at the same time, and most
do. `valuation.service.ts` never reads an expiry date to decide cost;
`fefo.ts` never reads a cost to decide what to pick.

## Non-negotiables

1. **The stock ledger is append-only.** Nothing updates or deletes a transaction
   row. Balances are a cache, reconstructable from the ledger, and
   `GET /api/inventory/ledger/integrity` proves it has not drifted.
2. **Every movement takes a row lock and an advisory lock** inside one interactive
   transaction. Two cashiers selling the last ten units produce one success, one
   ledger row, and a balance of zero.
3. **Corrections are reversals.** A posted journal entry, a controlled register
   entry and a stock movement are never edited or deleted.
4. **The audit chain is hash-linked.** Rewriting history breaks every subsequent
   hash, and the verify endpoint names the first broken row.
5. **Nothing fakes an external call.** A channel with no credentials records the
   message as undelivered with the missing variable named.
6. **A setting that changes nothing says so.** Every key is read somewhere or
   carries a `notEnforced` note, enforced by a test.

## Definition of done

A feature is done when: specification exists, database exists, migration exists,
domain logic exists, API exists, authorization exists, interface exists,
validation exists, audit exists, tests exist and pass, and the traceability matrix
records the evidence. A rendering page is not done.
