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

- **Per-page translation.** Navigation and app chrome are translated into
  English, Amharic and Afaan Oromo, with live coverage shown in Administration.
  Individual page copy is not yet extracted into the catalogues, so those
  strings render in English whatever locale is selected.
- **GS1 DataMatrix rendering.** Labels emit GS1-128, which carries the same
  Application Identifiers and scans on the same readers. DataMatrix needs
  Reed-Solomon ECC200; rather than ship something that scans inconsistently it
  is omitted and the limitation is stated on the label sheet. A QR code is never
  substituted, per §62/§73.
- **External notification delivery.** In-app notifications work end to end. The
  email/SMS/Telegram/WhatsApp adapters are inert stubs that log and return
  rather than reporting a delivery that did not happen (§35). Outbound
  **webhooks are fully implemented** (§53) with HMAC signing and retry.
- **Automated restore.** Backups are taken, encrypted, verified and pruned, and
  can be decrypted to a file. Restoring is an operator procedure at the console
  — see [docs/disaster-recovery.md](docs/disaster-recovery.md).
- **Clinical decision support** (interactions, allergy and dose checking). §24
  asks for these only as optional external integrations and warns against
  inventing clinical recommendations, so dispensing checks cover product,
  strength, quantity, batch, expiry, prescription requirement and stock only.
- **AI assistant** (§59), which the specification marks optional.
- **Shared cache.** Analytics caching is in-process, so a multi-instance
  deployment would want Redis behind the same `CacheService` interface. Nothing
  touching stock is ever cached — those reads go to the ledger under a lock.

## Verifying the compliance-critical behaviour

These are the guarantees worth checking first, and the commands that prove them:

```bash
pnpm test                      # 82 unit + integration tests
pnpm test:e2e                  # 60-check §72 workflow
pnpm test:e2e:procurement      # 22-check procurement, receiving and AP
pnpm test:e2e:capa             # CAPA ratchet and approval segregation
```

Between them these prove: two pharmacists cannot both dispense the last units;
expired, recalled and quarantined stock cannot leave the shelf; the audit chain
detects a rewritten row; an invoice billing for rejected stock is caught; one
person cannot approve two steps of the same document; and a tampered backup
fails verification instead of restoring corrupted data.
