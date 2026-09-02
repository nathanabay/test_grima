# PharmaCore — Enterprise Pharmacy Inventory & Management System

A pharmaceutical inventory system built around one principle: **the rules that
matter are enforced at the data layer, not in the user interface.** Expired,
recalled and quarantined medicine cannot be dispensed because the stock ledger
refuses the movement — not because a button is hidden.

## Stack

| Layer    | Choice                                                     |
| -------- | ---------------------------------------------------------- |
| API      | NestJS 10, one module per business domain                  |
| Database | PostgreSQL via Prisma 5 — 60+ tables, UUID keys            |
| Web      | Next.js 15 (App Router), React 18, Tailwind                |
| Shared   | `@pharmacore/shared` — FEFO, GS1, units, expiry, forecasting|
| Monorepo | pnpm workspaces                                            |

## Running it

Requires Node 20+, pnpm and a local PostgreSQL.

```bash
pnpm install
createdb pharmacore
cp .env.example .env          # then set DATABASE_URL for your Postgres user
pnpm --filter @pharmacore/api prisma migrate dev
pnpm db:seed
pnpm dev                       # API on :4000, web on :3000
```

Open http://localhost:3000. OpenAPI docs are at http://localhost:4000/api/docs.

**Demo accounts** — all use the password `PharmaCore#2026`. Each sees a
different subset of the system, so signing in as several is the fastest way to
see RBAC working:

`admin`, `manager`, `pharmacist`, `technician`, `procurement`, `warehouse`,
`storekeeper`, `cashier`, `finance`, `qa`, `auditor`, `branchmgr`

## Verification

```bash
pnpm test          # 70 unit + integration tests
pnpm test:e2e      # 60-check workflow against a running API
```

`pnpm test:e2e` walks the §72 scenario end to end: purchase request → approval →
RFQ → weighted quotation comparison → purchase order through its approval chain →
goods receipt (batch lands quarantined) → GS1 DataMatrix scan → QA release →
FEFO dispensing against a prescription → recall activation → blocked dispensing
→ audit-chain verification.

## The parts that carry the weight

### Stock ledger (§19)

`inventory_transactions` is append-only. Nothing updates or deletes a row.
`inventory_balances` is a cache written in the same transaction, and
`GET /api/inventory/ledger/integrity` replays the ledger to prove the cache has
not drifted. A drift is reported, never silently corrected.

### Concurrency (§48, §68)

Every stock movement takes `SELECT ... FOR UPDATE` on the balance row plus a
transaction-scoped advisory lock, inside one interactive transaction. The
integration suite proves the specification's own scenario: two pharmacists
dispensing the last 10 units concurrently — exactly one succeeds, one ledger row
is written, and the balance lands at zero.

### FEFO (§8)

`packages/shared/src/fefo.ts` is pure and side-effect free, so it is exhaustively
unit tested. It excludes expired, quarantined, blocked, damaged, recalled,
returned and destroyed batches, and stock already reserved by another document.
A manual batch override is allowed but requires a permission *and* a written
reason, and stores the batch FEFO would have chosen alongside the one taken.

### Recalls (§27)

Activating a recall blocks the affected batches in the same transaction that
creates it — there is no window in which recalled stock is still dispensable. It
snapshots quantity in stock and quantity already dispensed, then generates one
task per holding location and one per affected patient.

### Audit trail (§42)

Each row carries a SHA-256 over its content chained to the previous row's hash,
so rewriting history breaks every subsequent hash.
`GET /api/admin/audit-logs/verify` walks the chain and names the first broken
sequence. JSON payloads are canonicalized before hashing because PostgreSQL
`jsonb` does not preserve key order.

### Cold chain (§29, §30)

A reading outside range opens an excursion. If the breach outlasts the sensor's
tolerance, affected cold-chain stock is quarantined **automatically** and a
quality incident is raised. The system never declares temperature-exposed
medicine safe — only a QA officer can release it, and they must record an
investigation note.

### Controlled medicines (§28)

An append-only register with a running balance. Corrections append a REVERSAL
row pointing at the entry they cancel; nothing is ever edited or deleted.
Reconciliation reports variances rather than fixing them.

## Layout

```
apps/api/          NestJS API
  prisma/          schema (60+ models), migration, demo seed
  src/common/      Prisma (with row locking), audit, guards, decorators
  src/modules/     auth, admin, catalog, inventory, scanning, procurement,
                   receiving, transfers, dispensing, patients, pos, quality,
                   coldchain, recalls, counts, analytics, notifications, jobs
  test/            unit + integration specs
apps/web/          Next.js app (dashboard, command centre, inventory, expiry,
                   batches, POS, prescriptions, procurement, recalls, cold chain)
packages/shared/   FEFO, GS1 parsing, unit conversion, expiry, forecasting,
                   ABC/XYZ, permission catalogue and default roles
scripts/           end-to-end workflow verification
```

## Deliberate design decisions

- **Audit columns are plain UUIDs, not Prisma relations.** Relating every
  `createdById` would add 80+ back-relation fields to `User` for no query
  benefit; integrity is enforced in the service layer and mirrored into
  `audit_logs`.
- **Batches start QUARANTINED on receipt.** Stock physically exists and appears
  in balances, but FEFO will not allocate it until QA releases it. This is why
  receiving and releasing are separate acts.
- **Replenishment only ever suggests.** Every recommendation returns the inputs
  that produced it, and no order is placed automatically.
- **Quotation comparison never auto-selects the cheapest.** It ranks on a
  configurable weighted score and states in words why its pick differs from the
  lowest landed cost.
- **A plain QR or Code 128 is never treated as GS1 identification.** The parser
  reports `isGs1: false` and the scan endpoint warns that batch and expiry must
  be verified manually.

## What is not built yet

Reported honestly rather than left to be discovered:

- **Reporting exports.** Report *data* is served by the analytics endpoints, but
  PDF/Excel/CSV generation and the printable document templates (§41, §63) are
  not implemented.
- **Offline PWA mode** (§51) — no service worker or sync queue.
- **File uploads.** The `documents` table and expiry alerting exist, but there is
  no upload endpoint or storage backend (§44).
- **External notification delivery.** In-app notifications are written and read;
  the email/SMS/Telegram/WhatsApp adapters are deliberately inert stubs that log
  and return rather than faking a delivery (§35).
- **Backup automation** (§55) — `backup_records` is modelled, but no scheduled
  dump or restore procedure runs.
- **Localization** (§66) — UI strings are not yet extracted into message
  catalogues, though currency, timezone and date format are configurable.
- **AI assistant** (§59), which the specification itself marks optional.
- **Workflow engine.** `workflow_definitions` / `workflow_instances` are
  modelled and seeded, but approvals currently run through hard-coded state
  machines per document type rather than the configurable engine (§43).
- **Web coverage.** The API exposes every module; the web app covers the
  dashboard, command centre, inventory, expiry, batches, POS, prescriptions,
  procurement, recalls and cold chain. Transfers, counts, returns, disposal,
  supplier CRUD and administration are API-only so far.
