# Implementation plan

The order the system was built in, and why that order.

## The principle

Nothing is built on top of something that cannot yet be trusted. The ledger came
before anything that moves stock; permissions came before anything worth
protecting; the design system came before the screens that use it. Each phase
ends with tests that pass and a database that migrates cleanly from empty.

## Phase 1 — Foundations

Configuration and the settings catalogue, feature flags, the organisation
hierarchy, internationalisation, the job runner, health checks.

The settings catalogue came first because the alternative is constants scattered
through services, and the cost of collecting them later is an audit of every
file. Resolution order is database, then environment, then the declared default.

## Phase 2 — Identity and access

Users, roles, the permission catalogue, scopes, sessions, MFA, the password
policy, the hash-chained audit trail.

Built before any business module, because retrofitting authorization means
auditing every route already written.

## Phase 3 — Master data

Products with ingredients, relations, attributes and units; manufacturers;
categories; the pricing engine; barcodes and GS1.

## Phase 4 — The ledger

`InventoryTransaction`, `InventoryBalance`, locking, idempotency keys,
FEFO allocation, cost layers, the integrity replay.

This is the phase everything else rests on. FEFO went into `packages/shared` as
pure arithmetic so it could be tested as arithmetic, and so the web app could
predict the same batch the server picks.

## Phase 5 — Stock operations

Receiving, transfers, counts, adjustments, warehouse tasks, put-away, picking,
packing, dispatch.

## Phase 6 — Procurement and finance

Suppliers with computed scoring, purchase requests, RFQs, quotations, purchase
orders with a tiered approval chain, supplier invoices with three-way matching,
the chart of accounts, journals, valuation and COGS.

## Phase 7 — Pharmacy operations

Prescriptions, dispensing, the controlled register, POS with cash sessions,
patients and CRM.

## Phase 8 — Quality and compliance

Quarantine and release, returns, damage, disposal, quality incidents, recalls
with full tracing, cold chain with automatic quarantine.

## Phase 9 — Intelligence

Analytics, the inventory health score, ABC/XYZ, dead stock, forecasting with a
visible method rationale, the report builder, redistribution suggestions,
global search, entity timelines.

## Phase 10 — Platform

The automation rule engine, notifications with escalation, webhooks, API keys,
FHIR, the import engine with validation, preview and rollback, backups.

## Phase 11 — Design system and shell

Tokens, typography, light and dark, density, the primitive components, the
status map, the application shell, the command palette, the enterprise
`DataTable`.

Done as its own phase rather than per screen, so forty pages inherited it
through one compatibility layer instead of forty rewrites.

## Phase 12 — Depth against the feature audit

Every feature in `specs/FEATURE_MATRIX.md` audited against real code with
evidence, then the feasible absent ones closed: the serial lifecycle, blind and
frozen counts, loss classification, transfer logistics, supplier risk and credit
control, patient duplicate governance, cold-chain equipment certification,
expiry analytics, forecast scoring, controlled-register anomaly detection,
scheduled report delivery, API versioning.

## Phase 13 — Verification

Browser verification across every page, six widths and both themes; code review;
security review; the traceability matrix recomputed from real greps rather than
from intent.

## What each phase had to satisfy before it ended

- A migration that applies to an empty database and to a populated one.
- Tests at the right level: arithmetic as unit tests, transactions as
  integration tests, authorization end to end.
- Every new permission in the catalogue and granted to the roles that need it.
- Every new setting either read by code or explicitly marked `notEnforced` with
  a reason — enforced by a test that fails when a new key is added and wired to
  nothing.
- Audit entries for anything that changes stock, money, or a patient record.
