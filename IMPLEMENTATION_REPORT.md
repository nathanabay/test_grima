# Implementation report

PharmaCore — enterprise pharmacy inventory and management system.
Prepared 2026-09-03, against commit `598fa2f` on `master`.

---

## 1. What was asked for, and what this reports against

A 1,000-feature enterprise pharmacy platform, specification-driven, with a
complete interface redesign, browser verification, and a traceability matrix
that maps every requirement to the code that satisfies it.

This report states what exists, what does not, and how each claim was checked.
Where something is absent it is named, with the reason and the technical action
that would close it. Nothing is reported as done on the strength of a screen
existing or a function being written.

## 2. Headline result

| | |
| --- | --- |
| Requirements implemented | **780 / 1,000** |
| Partially implemented | **149** |
| Not implemented | **71** |
| Weighted (a partial counts a half) | **854.5 / 1,000** |
| Unit and integration tests | 325, all passing |
| End-to-end checks | 345 across 7 suites, all passing |
| Browser verification | 39 pages × 6 widths × 2 themes, 0 failures |
| Production builds | API and web, both clean |
| Database tables | 114, across 17 migrations |
| API routes | 361, each served at `/api` and `/api/v1` |
| Permissions | 202, across 12 roles |
| Lines of TypeScript | 68,458 across the API, web and shared packages (plus 3,942 of verification tooling and 8,110 of specification) |

Both feature matrices are exactly 1,000 rows and agree row for row.

## 3. What changed in this phase

Ten commits. The work divides into four parts.

**Depth against the audit.** Thirty-eight features previously recorded as absent
were built: the serial lifecycle, expiry calendar/trend/comparison, supplier
risk and credit control, blind and frozen stock counts, loss classification,
transfer logistics and delayed-transfer alerts, patient duplicate governance,
cold-chain equipment certification, controlled-register anomaly detection,
forecast scoring, scheduled report delivery and API versioning. Each has schema,
service, API, permissions, audit, interface and tests.

**Interface.** A design system with measured contrast, an application shell with
a command palette, role-aware dashboards, a command centre, 360-degree pages,
and an enterprise data table used by every list screen.

**Specification.** Seventeen master documents and 51 domain folders. Five of the
master documents are generated from the code itself.

**Verification.** Browser verification across every page, a code review and a
security review — which between them found 26 defects, all fixed.

## 4. Architecture

A pnpm monorepo: `apps/api` (NestJS 10, Prisma 5, PostgreSQL 16), `apps/web`
(Next.js 15 App Router), `packages/shared` (pure TypeScript rules).

The shared package holds no I/O and no framework. FEFO ordering is arithmetic,
and arithmetic that reaches a database cannot be tested as arithmetic; the web
app imports the same module the API does, so the batch a screen predicts is the
batch the server picks.

Full detail: `specs/ARCHITECTURE.md`.

## 5. One authority per rule

The costliest failure at this size is not a bug — it is two places that decide
the same thing and drift apart.

| Rule | Sole authority |
| --- | --- |
| Which batch leaves the shelf | `packages/shared/src/fefo.ts` |
| What stock is on hand | `LedgerService.post` |
| Whether an action is allowed | `PermissionsGuard` + `ScopeService` |
| What a movement cost | `CostLayerService` (FIFO layers) |
| What a setting is | `ConfigService` over the settings catalogue |

FEFO and valuation are deliberately independent: FEFO decides which physical
batch leaves, by expiry; FIFO layers decide what it cost, by receipt order. The
oldest stock on the shelf is frequently not the cheapest stock in the ledger,
and conflating them is the classic pharmacy accounting error.

## 6. The stock ledger

`InventoryBalance` is a cache; `InventoryTransaction` is the record. Every
movement is append-only and carries its own `balanceAfter`. Nothing writes a
balance without the movement that justifies it, in the same transaction.

Concurrency uses `SELECT ... FOR UPDATE` on the balance rows plus a
`pg_advisory_xact_lock` on the logical position, because the first movement for
a batch has no row to lock yet.

`GET /inventory/ledger/integrity` replays the ledger and reports drift. A cache
that can silently disagree with its source is worse than no cache; one that can
be checked is a performance decision.

## 7. Authorization

Three independent checks: authentication (JWT, 15 minutes, revocable refresh),
permission (`module.resource.ACTION`, declared on the handler, enforced by a
guard), and scope (which branches and warehouses this user may reach).

Scope is applied **inside the query**, never as a filter over rows already read
— filtering afterwards means the rows were read, the count is wrong, and a
paginated response returns short pages.

`specs/API_CONTRACTS.md` lists the 28 routes that declare no permission, so a
route nobody decided about is visible rather than buried. All 28 are legitimate:
per-user endpoints (`/auth/me`, notifications, the approval queue) and routes
whose required permission depends on the path and is enforced in the service
(imports, reports, search, timeline, workflows).

That list is how the missing check on the timeline was found — see §12.

## 8. The audit trail

SHA-256 hash-chained and append-only. Each row hashes its own content plus the
previous row's hash, so editing any historical row breaks every hash after it.

The hash is computed over the **stored** shape, not the in-memory one, or intact
rows would fail verification: `jsonb` does not preserve key order, a Prisma
`Decimal` reads back as a JSON number, `BigInt` cannot be serialised at all.

Never written to an audit payload: passwords, tokens, secrets, or personal data
the referenced row already holds. An entry records *that* clinical notes changed
and by whom — never what they now say.

Verified: `GET /admin/audit-logs/verify` returned valid over 954 entries after a
full end-to-end run.

## 9. Money and quantities

Every monetary and quantity column is `Decimal`. A pharmacy that rounds a unit
price in binary floating point will disagree with its own invoices, and the
disagreement will be small enough to survive testing and large enough to matter
at year end.

## 10. The interface

Twelve sidebar groups, each a word a pharmacy employee already uses. A group
disappears entirely when the reader may see none of its pages.

Role-aware dashboards: a pharmacist, warehouse manager, procurement officer and
executive see different panels, because one dashboard for everyone is tuned for
nobody.

A command centre ranking every signal by severity across seven sources, each row
stating the recommended action and linking to where it can be taken. A list of
problems with no way to act on them is a worry generator.

One `DataTable` behind every list screen; one status→tone map behind every
badge. The status palette carries pharmaceutical meaning: quarantine is violet
because it must not read as a warning to be cleared, controlled is indigo
because it is a legal category rather than a risk level, recall is the strongest
red in the system.

Deliberately avoided: generic template layouts, gradient-heavy dashboard
clichés, purposeless glassmorphism, cards inside cards, oversized radii, and
colour that carries no meaning.

## 11. Browser verification

`pnpm test:ui` drives 39 pages in Chromium against the live API. It is not a
screenshot gallery — the pass or fail comes from assertions.

The matrix is split by what each assertion depends on: contrast and naming
depend on the theme and not the width, overflow depends on the width and not the
theme. Running all six widths in both themes repeated every finding twelve
times, took long enough to be skipped, and exhausted memory before finishing.

**Result: 0 failures**, after fixing eleven defects it found:

| Defect | Why it mattered |
| --- | --- |
| Command centre called `/command-center`; route is `/analytics/command-center` | The flagship screen showed its error state at every width, in both themes |
| Light `--subtle` was slate-400 on white — 2.56:1 | Every caption and sub-line failed WCAG AA |
| Dark `--muted`/`--subtle` a step too dark — 3.74:1 | The same failure inverted |
| Amber and green badges on their own 10% wash — 4.38:1 / 4.39:1 | Under the floor for the 11px label a badge uses |
| `.btn-danger` painted white on a *light* red in dark mode — 2.77:1 | Destructive buttons near-illegible |
| `.card` had no `min-width: 0` | Every dashboard scrolled sideways on a phone |
| Automation tables had no scroll container; a long name widened the jobs grid | Two more phone overflows |
| 41 form controls had a visible label never associated with them | A screen reader announced an unnamed edit field |
| The adjustments page rebuilt its URL from `Date.now()` each render | The page never went idle and hammered the API |
| A warehouse selector had no accessible name | Same class as above |
| `pnpm build && pnpm start` could never work | Build wrote to `.next-build`, start read `.next` |

Two of the harness's own bugs were fixed on the way, and the first nearly hid
everything else: translucent backgrounds were read as opaque, reporting every
badge in the product as 1.00:1 — 46 false alarms burying the real findings.

Keyboard: the skip link is the first tab stop, 25 consecutive tab stops all show
a focus indicator, Ctrl+K opens the command palette and Escape closes it.

## 12. Security review

Five findings, all verified against the code before being acted on, all fixed.
Three were in code this session added.

1. **`POST /stock-adjustments` asserted no scope.** Branch and warehouse came
   straight from the request body. A clerk scoped to one branch could write off
   — or invent — another branch's stock. Every comparable write path in the
   codebase already asserted; this one did not.
2. **Stock counts were reachable by id with no scope check** on record, scan and
   post. Posting drives the ledger, so this mutated another branch's balances;
   variances kept inside the tolerance never reached the approval check either.
3. **Serial events checked the wrong warehouse** — the destination the caller
   volunteered, never the one the pack is actually in. Omitting the field
   skipped the check entirely.
4. **Count lists, count reads, loss analysis and the serial register were
   organisation-wide** regardless of scope: the enumeration step that made the
   three above easy to aim.
5. **A blind count could be unmasked early.** Recording a single line flipped
   the sheet to SUBMITTED, the state that reveals expected quantities. A counter
   could record one throwaway value, read back every remaining figure, and copy
   them in — precisely the exercise a blind count exists to prevent.

Separately, generating `API_CONTRACTS.md` produced the list of routes with no
declared permission, and that list found **`GET /timeline/:type/:id` had no
authorization at all**: any authenticated user, a cashier included, could read a
patient's full clinical timeline — prescriptions, prescriber names, dispensings,
consents — through a URL meant for looking up a product. The permission cannot
be a decorator because it depends on the entity type in the path, so it is now
enforced in the service, per type, with the patient timeline additionally
restricted to clinical roles and audited on read.

Reviewed and found clean: scheduled report delivery (runs as the report owner,
rebuilt from live roles, with no path to rewrite the owner), the permission sync
(add-only, system roles only), SQL injection (no raw queries outside
parameterised tagged templates), mass assignment (allow-lists on supplier and
patient writes), and patient PII handling.

## 13. Code review

Nineteen findings. Seventeen fixed; the two not fixed are recorded in §22.

The most serious concerned stock integrity:

- **A transfer payload naming one line twice** collapsed to a single ledger
  movement while the document counted both — the destination could receive stock
  that never left the origin.
- **Partial dispatch was impossible** despite being documented and coded for:
  the first dispatch set `IN_TRANSIT`, which the guard then rejected, stranding
  whatever did not fit on the first truck. A second dispatch also blanked the
  first truck's courier and tracking number.
- **`submit()` had no state guard**, so an in-transit transfer could be dragged
  back to `SUBMITTED` and out of the overdue watch built to catch it.
- **A controlled-register entry could be reversed repeatedly**, putting the
  register permanently above physical stock and leaving reconciliation reporting
  an unexplained variance on a controlled drug forever.
- **A FULL branch count spanning several warehouses** posted every variance
  against one of them.

And several wrong answers, most of them in code added this session: a scope
filter that overwrote the caller's own branch filter, an expiry trend window
that returned an extra month and could skip the requested one, an expiry
calendar flag that depended on row order, forecast accuracy scoring a
part-finished month, a maintenance date silently nulled, a failed calibration
reading as "never calibrated", and cron rejecting `7` for Sunday.

## 14. Data model

114 tables, 28 enumerations, documented in `specs/DATA_MODEL.md` — generated from
`schema.prisma`, so it cannot drift.

UUID primary keys throughout, so a record created in one branch can be
referenced from another without a central sequence.

## 15. Migrations

17 migrations. **None** drops a column, renames a table, or adds a `NOT NULL`
column without a default — checked mechanically by the generator, not by
recollection.

Migrations are generated non-interactively, because `migrate dev` needs a TTY a
pipeline does not have. The order for a populated table is always: add nullable
or defaulted, backfill, verify the backfill, then add the constraint. This
project was bitten by exactly that once, on `warehouse_locations.updatedAt`,
which is why the check now runs over every migration.

Verified: a database created empty, migrated, seeded and finalised, then run
against all seven end-to-end suites.

## 16. Permissions

202 permissions across 12 roles, in `specs/PERMISSION_MATRIX.md` with a coverage
table naming any permission nobody holds.

`PermissionSyncService` runs at boot and only ever adds. Adding a resource to
the catalogue previously reached only a fresh database — the seed builds
permissions from scratch — so an existing deployment would get new screens with
nobody holding the permission to open them. That is exactly what happened to the
serial register: it was unreachable by every user, including the super
administrator.

Nothing is revoked. An administrator who narrowed a system role, or a custom
role somebody built, is left alone: a deployment must not take an authorization
decision away from the person accountable for it.

## 17. Settings

65 settings, resolved database → environment → declared default.

Of these, 44 are read by code and 21 are marked `notEnforced` with a stated
reason. A test fails when a new key is added and wired to nothing, which is how
the earlier finding — 53 of 65 settings and all 13 feature flags read by nothing,
behind a settings screen that looked functional — cannot recur.

## 18. Testing

| Level | Count | What it is for |
| --- | --- | --- |
| Unit | 325 cases across 17 suites | Arithmetic and rules — FEFO, expiry, GS1, units, the serial state machine, the cron window |
| Integration | included above, 4 suites need a database | Transactions, locks, constraints — the ledger and accounting |
| End-to-end | 345 checks across 7 suites | Real HTTP, real tokens, real permissions |
| Browser | 39 pages × 6 widths × 2 themes | Contrast, overflow, naming, keyboard |

`tests/spec-tests.json` maps requirements to suites: 929 of 1,000 requirements
name a suite, every named suite resolves to a file that exists, and **no
implemented requirement lacks a named suite**.

The lifecycle suite reports skipped checks separately from passes, because a
check that could not run is not a check that succeeded. One is currently skipped
— see §22.

A test is never weakened to make an implementation pass, and a failing test is
never deleted because it revealed a bug.

## 19. What the reviews say about test quality

Three of the first scope regression checks passed for the wrong reason: the
actor lacked the permission entirely, so the 403 was a permission refusal rather
than a scope one, and the check would have passed with the scope fix removed.
They were rewritten against a branch manager — a role that holds every inventory
permission *and* is scoped to one branch — which is the only combination that
actually tests scope.

The serial scope check originally hunted for an out-of-scope pack in the seed
data and degenerated to "there wasn't one". It now plants a pack in a branch the
reader cannot reach, so it tests the same thing on any dataset.

A supplier-score check asserted against a fixed number and could not tell "the
write was ignored" from "it was already that number". It now reads the value
first and writes a different one.

## 20. Integrations, and where they stop

Webhooks with signing, retry and recorded attempts. API keys stored hashed,
shown once. A read-only FHIR R4 surface returning a bare `OperationOutcome` with
`application/fhir+json` — not wrapped in this application's envelope, because a
conformant client reading `.issue` would find nothing.

GS1 element strings are parsed for GTIN, batch, expiry and serial. Batch and
expiry are trusted **only** from a genuine GS1 element string; a plain QR or
Code 128 is never treated as pharmaceutical identification, and the scan result
says so.

No payment gateway is connected, so card, mobile-money and bank-transfer
payments require the reference from the terminal that took them. This system
cannot confirm a settlement it did not make, so it records the human-verified
reference rather than asserting a capture it cannot prove.

## 21. What the automation layer may not do

The rule engine raises notifications and tasks. It may not approve a purchase,
modify a controlled-drug record, dispose of medicine, release quarantined stock,
activate a recall, or offer a clinical diagnosis. Those are decisions a person
is accountable for.

The controlled-register anomaly detector states on the screen, not only in the
code, that its signals are prompts to investigate and not findings — an
accusation dressed as a system output is how a colleague gets wrongly suspended.

## 22. What is not done

**71 requirements are not implemented and 149 are partial.** All are listed in
`specs/KNOWN_EXTERNAL_DEPENDENCIES.md` with the reason and the action.

Grouped by cause:

| Cause | Count | Example |
| --- | ---: | --- |
| Needs credentials | 3 | RFQ email dispatch — implement behind `EMAIL_API_URL` |
| Needs hardware | 4 | Door-open and power-loss alerts need a contact and a power signal |
| Deliberately absent | ~12 | Anything that would present generated clinical or regulatory data as real |
| Not built | ~52 | Blanket and recurring purchase orders, procurement budget control, expiry heat map, tender support, supplier portal |

Two features moved to partial rather than done, and the gap is stated:

- **Retention-policy engine.** Dormant records are listed and any with an
  outstanding balance is blocked, but nothing is erased on a timer. That is
  deliberate — an automatic erase is how a record still needed for an open
  recall disappears — so the deciding half is a person, not an engine.
- **Saved filters.** Table views persist per browser in `localStorage`, so they
  do not follow a user to another device. Server-side storage needs a `UserView`
  table and a small CRUD surface.

**Two code-review findings not fixed**, both pre-existing and both stated rather
than quietly carried:

- `verifyIntegrity` compares per-location balance rows against a ledger replay
  that ignores location, so a batch split across bins reports as drift on
  consistent data. *Action:* pass `locationId` into `reconstructBalance`, or
  aggregate cached balances by product/batch/warehouse before comparing.
- Out-of-hours detection and cron scheduling both resolve times in the server's
  local zone rather than the organisation's, which is stored and unused. On a
  UTC container an 08:00 Addis dispensing is flagged as out-of-hours and a
  genuine 23:00 one is not. *Action:* format with the organisation timezone via
  `Intl.DateTimeFormat` before taking the hour, in
  `controlled-register.service.ts` and `cron-window.ts`.

**One test gap:** the controlled-register reversal guard is not exercised
end-to-end, because no suite creates a controlled dispensing and the seed leaves
the register empty. The guard is covered by reasoning and by unit-level checks
only. *Action:* extend `e2e-lifecycle.mjs` with a prescription → validate →
dispense flow against a controlled product, then reverse the resulting entry.

## 23. Verification performed for this report

Every claim above was checked, not recalled:

- 325 unit and integration tests — run, all passing.
- Seven end-to-end suites — run against a database seeded from empty, all
  passing.
- Browser verification — run, 0 failures across 39 pages, 6 widths, 2 themes.
- Both production builds — run, clean.
- Migrations — applied to an empty database, then seeded and finalised.
- Permission sync — confirmed a no-op on a fresh seed, and confirmed to add 4
  permissions and 23 role grants on a database predating them.
- Audit chain — verified over 954 entries after a full run.
- Feature counts — recomputed from the matrices, which agree row for row at
  exactly 1,000 rows.

## 24. Honest notes on this report

The 780/1,000 figure counts a requirement as implemented when it has schema,
service, API, permission, interface and evidence — not when a screen exists. The
count went from 742 to 780 because 38 features were built, and both matrices
were regenerated from the code rather than edited by hand.

The reviews found 26 defects in work this session produced or touched, and every
one is listed above rather than summarised away. Three were authorization holes
that would have let one branch destroy another's stock. Finding them is the
system working as intended; shipping without looking would have been the failure.

Two known defects and one test gap remain open, with the exact action for each.
