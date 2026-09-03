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
| Requirements implemented | **790 / 1,000** |
| Partially implemented | **140** |
| Not implemented | **70** |
| Weighted (a partial counts a half) | **860.0 / 1,000** |
| Unit and integration tests | 334, all passing |
| End-to-end checks | 568 across 10 suites, all passing on a freshly seeded database |
| Browser verification | 40 pages × 6 widths × 2 themes, 0 failures |
| Production builds | API and web, both clean |
| Database tables | 115, across 21 migrations |
| API routes | 385, each served at `/api` and `/api/v1` |
| Permissions | 204, across 12 roles |
| Lines of TypeScript | 71,404 across the API, web and shared packages (plus 6,038 of verification tooling and 8,172 of specification) |

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

**Dispensing and inventory.** Two later passes audited those modules against the
code rather than against the matrix, and the matrix lost both times. Sections 3a
and 3b report them.

## 3a. The dispensing pass

The dispensing screen could review a prescription and hand out medicine. It
could not record one, check anything clinical, print a label, track a
collection, issue a repeat or undo a mistake — and it read across branches.

**Clinical checks (`clinical-checks.service.ts`).** Allergy, duplicate therapy,
therapeutic class, curated interactions, maximum daily dose against the written
regimen, paediatric suitability, renal/hepatic/pregnancy/breastfeeding cautions,
look-alike/sound-alike, cold chain, prescription expiry, exhausted repeats and
early repeat. Every one is advisory: none refuses a supply, because the
pharmacist is the clinician and can see the patient. What the system insists on
is that a CRITICAL warning cannot be passed silently — it needs a typed reason,
kept on the dispensing and in the audit trail. `POST /dispensing/preview` runs
the same checks the supply will run, so the screen cannot show one thing and the
server enforce another.

**The allergy check is a word match against a free-text field, and says so.** It
is a prompt to look, not a clinical determination.

**Six defects found in code that was already marked done:**

| Defect | What it did |
| --- | --- |
| Idempotency key was `dsp-${id}-${Date.now()}` | A different key on every click, so a retry after a network error that had in fact succeeded dispensed the medicine to the patient a second time |
| `patientId` was taken from the request, not checked | A supply could name one patient while its prescription named another |
| Any product could be dispensed against any line | "Do not substitute" was recorded and never read |
| `Product.maxDispenseQty` was never read | The catalogue could set a ceiling and the counter would hand out any quantity |
| Prescriptions and dispensings were organisation-wide | Clinical data about a named patient, readable from any branch |
| `patients.create` skipped the clinical-role guard `patients.update` applies | Allergies and notes could be written by a user who may not read them |

**Two defects outside dispensing, found by testing it:**

- `POST /admin/settings` wrote the row directly rather than through
  `ConfigService`. The value was never validated against its definition, and the
  configuration cache was never invalidated — so an administrator changed a
  setting and the system went on using the old value until the API restarted.
  The write now goes through the same path the batch save uses.
- **The controlled register could never be opened.** Only dispensing wrote
  register entries, and dispensing refuses to take the running balance negative.
  A pharmacy holding controlled stock could therefore never make its first
  supply. `POST /controlled-register/opening` records an opening balance read
  from the stock the branch actually holds — not typed — once per product and
  branch. Goods receipt of a controlled product still does not append a receipt
  entry; that is stated in section 22 rather than fixed here.

**Lifecycle.** Prescription entry with per-line directions and "do not
substitute"; validity dates computed where the prescriber wrote none; an expired
prescription cannot be approved; a daily job expires undispensed ones and leaves
part-supplied ones alone; a queue ordered urgent first then longest waiting;
ready-for-collection and collection recording who took it; repeats issued as new
prescriptions pointing back at the original; reversal that posts stock back
against the original picks, restores what is outstanding and appends a
controlled-register reversal, refusing medicine the patient has already
collected.

**A printable label**, assembled server-side in one read so the product, batch,
expiry and directions on it always belong to the same row, with auxiliary and
cold-chain wording, substitution notice, and reprints counted rather than
prevented.

## 3b. The inventory pass

The stock screen listed positions and nothing else: no filters worth the name,
no way to see what was holding stock, no batch record, and a Value column that
disagreed with the balance sheet.

**Three defects that mattered more than the features:**

- **The stock ledger had no authorization at all.** `GET /inventory/ledger` did
  not take the current user. Anyone holding `inventory.ledger.READ` — which the
  branch roles do — could read every movement in the organisation: each branch,
  each batch, each unit cost. The batch list, batch-read-by-id, the FEFO probe
  endpoints and the integrity replay were open the same way, and a FEFO
  recommendation names batch numbers, quantities and expiry dates one product at
  a time. All of them are scoped now, and asking for another branch by id is
  refused rather than quietly widened.
- **"Below reorder" returned the wrong answer.** The filter ran after
  pagination, over the fifty rows already fetched, while `total` reported the
  unfiltered count — so the screen that tells a pharmacy what to order showed an
  arbitrary subset with a wrong total. It also compared a product-level reorder
  level against a per-bin balance row, so a product split across three locations
  looked short on each of them. Reorder is resolved per product across the
  branch now, before the page is fetched.
- **Reserved stock was never released.** `expiresAt` was on the reservation
  model, never set and never swept. A basket abandoned at the till, or a pick
  wave that died when the van left, held its stock out of `available`
  permanently — and no screen showed a reservation or let anyone release one.
  Holds now lapse on a configurable window, an hourly job releases them, and the
  document they belong to is deliberately left alone: lapsing a hold is not
  cancelling a sale.

**Two more found while writing the tests:**

- Stock was valued at `available × averageCost` on the screen and at
  `onHand × averageCost` in accounting, so the Value column understated the
  balance sheet by exactly the reserved quantity. A reservation is a promise
  about where stock is going, not a disposal.
- `verifyIntegrity` compared per-location balance rows against a ledger replay
  that ignores location, so a batch split across two bins reported drift on
  perfectly consistent data — every single run. The cached rows are aggregated
  to the grain the replay uses before comparing. This was carried as a known
  open defect in section 22 of the previous report; it is closed.

**A batch record**, which did not exist: where the stock is, what it cost, what
moved, what it was split from, which serials belong to it, how fast it is
moving against how long it has left, and who decided its status on what
evidence. Releasing a batch now names the certificate of analysis it was
released on — "released" with nothing behind it is the record an inspector asks
about and nobody can answer.

**Batch splitting**, which closes a column the schema had carried from the
beginning and nothing could write: `parentBatchId`. A split moves quantity
through the ledger into a child batch that keeps the parent's expiry, cost and
supplier, so a repack cannot launder an expiry date.

**The screens**: filters on warehouse, batch status, expiry window, controlled
and cold chain, all in the URL so a filter can be sent to somebody; totals over
the whole filtered set rather than the page; stock age; a row drawer showing
what is holding a position, how it got here and who else has the product; a
reservations view; an anomalies view for negative stock, over-reservation, holds
at zero and expired stock still counted; CSV export fetched with the
Authorization header rather than a token in a URL. The three `window.prompt`
calls on the batch screen — one of which asked the reader to type a quarantine
category by hand from a list printed in the prompt — are a proper dialog.

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

**70 requirements are not implemented and 140 are partial.** All are listed in
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

**One code-review finding not fixed**, pre-existing and stated rather than
quietly carried. The `verifyIntegrity` location bug that stood here is closed —
see section 3b.

- Out-of-hours detection and cron scheduling both resolve times in the server's
  local zone rather than the organisation's, which is stored and unused. On a
  UTC container an 08:00 Addis dispensing is flagged as out-of-hours and a
  genuine 23:00 one is not. *Action:* format with the organisation timezone via
  `Intl.DateTimeFormat` before taking the hour, in
  `controlled-register.service.ts` and `cron-window.ts`.

**The controlled-register test gap is closed.** `e2e-dispensing.mjs` opens the
register, makes a witnessed controlled supply and reverses the entry;
`e2e-lifecycle.mjs`'s reversal guard now runs instead of skipping.

**Still open in the controlled register:** goods receipt of a controlled product
does not append a RECEIPT entry, so the register only tracks what leaves and the
opening balance has to be recorded deliberately. *Action:* call
`ControlledRegisterService.record` from `receiving.service.ts` for controlled
lines, and decide there whether the goods-receipt document's own signatures
satisfy `controlled.requireDualAuthorization` or whether receiving a controlled
line should ask for a witness of its own. Left out of the dispensing pass
because it changes the receiving path, which has its own suites.

**Two dispensing requirements are partial, and were marked done on evidence
that did not exist:**

- **Batch scan before dispensing.** The preview names the batch and expiry FEFO
  will pick and a supplied batch is validated against stock, but there is no
  scan-to-confirm step at the point of supply. The matrix claimed one.
- **Product scan verification.** The supplied product is now checked against the
  prescription line and a substitution needs a reason, but the check is not
  driven by a scan. Before this release the product was not checked against the
  line at all.

## 23. Verification performed for this report

Every claim above was checked, not recalled:

- 334 unit and integration tests — run, all passing.
- Ten end-to-end suites, 568 checks — run in sequence against a database
  seeded from empty, all passing with nothing skipped.
- Browser verification — run, 0 failures across 40 pages, 6 widths, 2 themes.
  The sweep now resolves a real batch id, so the batch record — the page a
  recall is worked from — is rendered rather than assumed.
- Both production builds — run, clean.
- Migrations — applied to an empty database, then seeded and finalised.
- Permission sync — confirmed to add the one new permission on a database
  predating it.
- Audit chain — verified after a full run.
- Feature counts — recomputed from the matrices, which agree row for row at
  exactly 1,000 rows.

## 24. Honest notes on this report

The 785/1,000 figure counts a requirement as implemented when it has schema,
service, API, permission, interface and evidence — not when a screen exists. The
count went from 742 to 780 because 38 features were built, and both matrices
were regenerated from the code rather than edited by hand.

**The dispensing pass moved it to 785, and two of its eighteen changes were
downward. The inventory pass moved it to 790, and fifteen of its twenty changes
moved nothing at all** — they replaced evidence that named a column nothing
wrote, a filter nobody had built and a checker that reported drift on consistent
data, with evidence that is now true. The score barely moved because most of
that work was making the matrix honest rather than adding rows to it. Re-auditing that module found rows marked IMPLEMENTED whose evidence
named a setting with no key, a field nothing read, and a scan step nobody had
built. Those rows are corrected here in the direction the code actually
supports. A net gain of five, from a pass that closed a dozen real gaps, is what
an honest re-audit looks like: the number moved less than the work did, because
part of the work was undoing an earlier overstatement. A matrix that agrees with
itself rather than with the code is worse than no matrix.

The count itself was also wrong in the tooling. `recount.mjs` counted a status
by matching it anywhere in the row and then subtracting the other statuses to
undo an overlap that did not exist, and it read the wrong column in one of the
two matrices. It now reads the one column that carries the answer, in whichever
position that matrix puts it, and refuses to report a total that is not 1,000.

The reviews found 26 defects in work this session produced or touched, and every
one is listed above rather than summarised away. Three were authorization holes
that would have let one branch destroy another's stock. The dispensing pass
added eight more, two of them outside dispensing; the inventory pass added five,
one of which had every branch role reading the whole organisation's stock ledger
and its costs. Finding them is the system
working as intended; shipping without looking would have been the failure.

Two known defects remain open, with the exact action for each.
