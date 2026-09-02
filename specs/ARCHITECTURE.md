# Architecture

What the system is made of, and why it is divided this way.

## Shape

A pnpm monorepo with three packages and one shared kernel.

| Package | What it is | Why it is separate |
| --- | --- | --- |
| `apps/api` | NestJS 10 over PostgreSQL 16 via Prisma 5 | Every rule lives here. It is the only thing that decides. |
| `apps/web` | Next.js 15 App Router, React 18, Tailwind | A view. It renders what it is given and asks before it acts. |
| `packages/shared` | Pure TypeScript: FEFO, expiry, GS1, units, permissions, forecasting | The rules both sides must agree about, expressed once. |

`packages/shared` holds no I/O and no framework. That is the point: FEFO ordering
is arithmetic, and arithmetic that reaches a database cannot be tested as
arithmetic. The web app imports the same module the API does, so a batch the
server would pick is the batch the screen predicts.

## One authority per rule

The costliest failure in a system this size is not a bug — it is two places that
both decide the same thing and drift apart. So each rule has exactly one home.

| Rule | Lives in | Nothing else may decide it |
| --- | --- | --- |
| Which batch leaves the shelf | `packages/shared/src/fefo.ts` | POS, dispensing, transfers and picking all call it |
| What stock is on hand | `LedgerService.post` | No screen and no service writes a balance directly |
| Whether an action is allowed | `PermissionsGuard` + `ScopeService` | The client renders on permissions; it never grants them |
| What a movement cost | `CostLayerService` | FIFO layers, independent of which batch physically moved |
| What a setting is | `ConfigService` over the settings catalogue | No constants scattered through services |

FEFO and valuation are deliberately independent. FEFO decides which *physical*
batch leaves, by expiry. FIFO cost layers decide what that movement *cost*, by
receipt order. Conflating them is the classic pharmacy accounting error: the
oldest stock on the shelf is frequently not the cheapest stock in the ledger.

## The ledger is the only truth about stock

`InventoryBalance` is a cache. `InventoryTransaction` is the record.

Every movement — receipt, sale, dispensing, transfer, adjustment, count
variance, disposal, recall — is an append-only row carrying its own
`balanceAfter`. Nothing updates a balance without writing the movement that
justifies it, in the same transaction.

Concurrency is handled with `SELECT ... FOR UPDATE` on the balance rows plus a
`pg_advisory_xact_lock` on the logical stock position, because the first
movement for a batch has no row to lock yet. Two tills selling the last pack at
the same moment serialise; one of them is told the stock is gone.

`GET /inventory/ledger/integrity` replays the ledger and reports any cached
balance that drifted. A cache that can silently disagree with its source is
worse than no cache; a cache that can be checked is a performance decision.

## Authorization is three questions, not one

1. **Authentication** — a valid access token (JWT, 15 minutes), refreshed
   against a hashed refresh token that is revocable per session.
2. **Permission** — `module.resource.ACTION`, declared on the handler with
   `@RequirePermissions` and enforced by a guard before the handler runs.
3. **Scope** — which branches and warehouses this user may reach.

The third is the one that is easy to get wrong. Scope is applied *inside the
query*, as a `where` fragment, never by filtering results after the fact:
filtering afterwards means the rows were already read, the count was already
wrong, and a paginated response silently returns short pages.

A user with no `UserScope` rows is organisation-wide. That is head office, and
it is a deliberate choice rather than an accident of an empty table — every
scoped read asks `isUnscoped` first.

Some routes cannot declare a static permission because the permission depends on
the path: importing products needs a different permission from importing
suppliers, and a patient timeline needs a different permission from a product
timeline. Those enforce inside the service, and `specs/API_CONTRACTS.md` lists
every route with no decorator so the choice stays visible. That list is how the
missing check on `GET /timeline/:entityType/:entityId` was found.

## The audit trail is hash-chained

Each `AuditLog` row stores a SHA-256 over its own content plus the previous
row's hash. Editing or deleting any historical row breaks every hash after it,
so `verifyChain` can prove the log has not been rewritten.

The hash is computed over the *stored* shape, not the in-memory one, or rows
that were perfectly intact would fail verification: `jsonb` does not preserve
key order, a Prisma `Decimal` reads back as a JSON number, `BigInt` cannot be
serialised at all, and dates round-trip as ISO strings. `canonicalize` handles
each of those.

What is never written to the audit payload: passwords, tokens, secrets, and
personal data that the referenced row already holds. An audit entry records
*that* clinical notes changed and by whom — never what they now say.

## Money and quantities

Every monetary and quantity column is `Decimal`, never float. A pharmacy that
rounds a unit price in binary floating point will disagree with its own
invoices, and the disagreement will be small enough to survive testing and large
enough to matter at year end.

## Work that must not block a pharmacist

Accounting posts on a schedule, not inline. A ledger problem must never stop
somebody dispensing. Posting is idempotent, so a missed run catches up on the
next one, and `postPending` selects only what is outstanding rather than
scanning and filtering in memory.

The same reasoning governs webhooks, expiry sweeps, supplier scoring, low-stock
alerts, automation rules and scheduled report delivery: each is registered with
`JobRunnerService`, so every execution is recorded and a job that stopped firing
is visible on the system health screen instead of being assumed healthy.

## What the AI layer may not do

The automation engine evaluates rules and raises notifications and tasks. It may
not approve a purchase, modify a controlled-drug record, dispose of medicine,
release quarantined stock, activate a recall, or offer a clinical diagnosis.
Those are decisions a person is accountable for, and the engine's job is to put
them in front of that person, not to take them.

## Where an integration stops

Adapters are implemented, configured and validated. When credentials are absent
the live connection is disabled and the health check says so. Nothing simulates
a successful external transaction: a payment that was never taken must never
appear to have been taken. `specs/KNOWN_EXTERNAL_DEPENDENCIES.md` lists every
such boundary and the exact action that would close it.
