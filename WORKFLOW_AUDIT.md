# Workflow and user-flow audit

An audit of how work actually moves through PharmaCore: the business state
machines, the handoffs between roles, and what a person can reach from a screen.

Every finding below was reproduced against a running system seeded from empty,
not read off the code. The scripts that produced the numbers are in the
repository — `scripts/ui-verify/role-flows.mjs` for §1 and
`scripts/ui-verify/link-check.mjs` for §3 — so the figures can be re-derived
and the fixes measured against them. Both currently fail.

---

## The one-line summary

The rules are sound and the screens are unusable by the people who need them.

Six of eight core jobs cannot be completed in the browser by the role that owns
them. 72 of 177 page/role combinations the product's own sidebar offers are
broken or partial. 47 of 58 notification links cannot reach the record they name.
38 of 43 pages carry at least one problem that costs a reader their data,
their input, or their confidence that an action worked.

Almost none of it is scattered bugs. It is a handful of structural mistakes,
each repeated everywhere — and none of it was visible before, because every
test and every browser sweep signs in as an administrator who holds all 204
permissions, against a seed small enough that the caps never bite.

---

## 1. The product does not work for the people who use it

**Verified in a browser, per role, against a freshly seeded database.**

| Role | Job | Where it stops |
| --- | --- | --- |
| Cashier | Sell something | `/pos` shows *"Missing required permission(s): admin.branch.READ"*. Branch select: **0 options**. Product search never fires. |
| Pharmacist | Dispense a prescription | The "Pick from" warehouse select in the dispense panel is **empty**. `warehouseId` is required by the API. |
| Storekeeper | Receive a delivery | "Against purchase order" offers **only the placeholder** — they are refused `/purchase-orders`. |
| Storekeeper | Run a stock count | Branch **0**, Warehouse **0**. |
| Storekeeper | Send a transfer | From warehouse **1** (placeholder), To warehouse **1** (placeholder). |
| Warehouse manager | Adjust stock | Branch **0**, Warehouse **0**. |
| QA officer | Release a batch | Works. |
| Procurement | Raise a purchase order | Works. |

### Root cause

**The branch and warehouse context is served from administration endpoints,
gated on an administration permission.**

- `GET /admin/organization` and `GET /admin/branches` both require
  `admin.branch.READ`.
- Only `manager`, `admin` and `auditor` hold it.
- `ScopeProvider` — which feeds the context selector in the shell and, through
  `useScope()`, the warehouse dropdowns on the inventory and dispensing
  screens — calls `/admin/organization` and catches the 403 silently, on the
  reasoning that "a reader without `admin.branch.READ` cannot list branches …
  the selector simply does not appear".

That reasoning was defensible when the selector was a convenience. It is not,
now that six operational screens read their warehouse from it. **Knowing which
branches you work in is not an administrative privilege; it is the first thing
an operator needs.**

`/admin/organization` is refused **203 times** across a full page × role sweep —
by a wide margin the most-denied endpoint in the product.

### The fix

Serve the caller's own scope from a non-administrative endpoint — `GET /me/scope`,
returning only the branches and warehouses on their `UserScope` rows, behind no
permission beyond being signed in. Point `ScopeProvider` and the POS page at it.
`/admin/organization` stays where it is, for administering the hierarchy.

Two follow-ons: the storekeeper needs `procurement.purchase_order.READ` (or a
narrowed "receivable orders" endpoint) to receive against a PO, and `/pricing`
needs `catalog.product.READ` for the finance officer.

---

## 2. The approval engine is an island

There are two approval mechanisms. One is enforced and shallow; the other is
sophisticated and wired to nothing.

**`WorkflowService`** supports multi-step definitions, a `requiredPermission`
per step, amount bands, escalation, and a per-user queue. It validates that a
step's permission exists so a step "could never be approved" is caught at
definition time. `/approvals` reads its queue. One definition is seeded.

**Nothing ever starts an instance.** `workflowInstance` is written only inside
`workflow.service.ts` itself, reachable through `POST /workflows/start`. No
domain service calls it; the seed creates zero instances. The approvals queue is
therefore structurally always empty, and the e2e check that passes against it
("0 item(s) waiting on finance") passes because there is nothing to wait on.

Meanwhile the real purchase-order chain — `DRAFT → SUBMITTED →
PROCUREMENT_REVIEW → FINANCE_REVIEW → APPROVED → ORDERED` — is guarded by a
transition table and **one permission for every stage**:

```
@Post('purchase-orders/:id/transition')
@RequirePermissions('procurement.purchase_order.APPROVE')
```

So one person walks all five stages alone, including the finance step, without
holding any finance permission. The chain records that the stages happened. It
does not record that different people did them, because they need not have.

### Separation of duties is one setting read in one place

`approval.requireDistinctApprovers` defaults to **true** and its description
reads: *"When enabled one person cannot clear two steps of the same document,
and cannot approve what they raised."*

It is read in exactly one file — `notes.service.ts`, for credit and debit notes.
Purchase requests, purchase orders, supplier invoices, disposals, batch
releases, damage verification, stock adjustments and stock counts all let the
raiser approve their own document.

The other three approval settings — the manager and director purchase-order
thresholds and the adjustment threshold — are read by nothing and are honestly
marked `notEnforced`. But their note says the engine "reads its thresholds from
each WorkflowDefinition step … which is per document type and **already in
use**." That last clause is false. The honest note is itself inaccurate.

### The fix

Pick one. Either route real documents through `WorkflowService` and delete the
inline transition tables, or delete the engine and give each stage of each chain
its own permission plus a distinct-approver check. The present arrangement is
the cost of both and the benefit of neither.

---

## 3. Notifications cannot hand anyone the record they are about

Notifications are how work moves between people. Their targeting is sound — role
codes expand to concrete users, branch-scoped, and an event with no recipient is
still recorded rather than dropped.

Their links are not. Of every `linkUrl` emitted anywhere in the API:

- **15 point at routes that do not exist.** `/receiving/{id}`, `/quality/{id}`,
  `/recalls/{id}`, `/suppliers/{id}`, `/damage/{id}`, `/documents/{id}`,
  `/finance/invoices/{id}`, `/procurement/purchase-orders/{id}`,
  `/cold-chain/excursions/{id}`, `/approvals/{id}`, `/inventory/ledger`,
  `/admin/backups`, `/procurement/replenishment`.
- **32 carry a query parameter no page reads.** `/batches?id=`,
  `/dispensing?prescriptionId=`, `/patients?id=`, `/pos?saleId=`,
  `/procurement?poId=`, `/transfers?id=`, `/invoices?id=`, and the rest.

**47 of 58 distinct links are broken** — and not one of the 32 parameterised
ones lands on its record. A QA officer told a batch has sat in
quarantine for fourteen days is sent to `/quality` — the incident register,
which is not where batches are released.

Only two of 43 web routes take an id at all (`/batches/[id]`, `/products/[id]`),
and one of those was added two commits ago. There is essentially no
record-to-record navigation in the product.

### The fix

Adopt one convention and apply it: `?id=` opens the record in the drawer the
list already has. That is a small change per page — read the param, open the
drawer — and it makes every existing notification link work. Add `[id]` routes
only where a record deserves a page of its own.

---

## 4. Smaller findings

- **`TransferStatus.RECEIVED` is declared and never written.** A transfer goes
  `PARTIALLY_RECEIVED → COMPLETED`. It is offered as a filter, so a user can
  select a state nothing is ever in.
- **A clean goods receipt notifies nobody.** Receiving emits only when a line is
  flagged. Every batch lands `QUARANTINED`, so a normal delivery is unsellable
  and silent until the `QUARANTINE_AGEING` rule fires — **after 14 days**, at
  which point it links to the wrong screen (§3).
- **The count, adjust and transfer shortcuts I added to the stock drawer** pass
  `?productId=` to pages that ignore it. They land on a blank list and the user
  re-finds the product by hand. Same defect as §3, and mine.
- **No route-level permission guard.** `nav.ts` filters the menu; typing a URL
  is unguarded. A cashier who types `/accounting` gets the page with four dead
  panels rather than a clean "not for you". Harmless today because the API
  refuses the data — but the screen should say so.

---

---

## 5. Every page: what a reader can see and do

§1–§4 covered how work moves. This covers what the forty-three screens are like
to use once you can reach them. Every figure here comes from a scan of the pages
themselves or from a browser sweep, both reproducible.

**38 of 43 pages carry at least one of the problems below.** The figures are
produced by `scripts/ui-verify/page-audit.mjs`, which is committed alongside
this document.

### 5.1 The lists do not reach the data

Twenty-seven pages fetch a capped page and give the reader no way to the rest. Only `/inventory` and `/batches` paginate against the
server, and both were touched in the last two days.

Two are **already truncating on demo data**:

| Page | Cap | Records today | Unreachable |
| --- | ---: | ---: | ---: |
| `/products` — the drug master | 25 | 119 | **94** |
| `/dispensing` — All prescriptions | 25 | 59 | **34** |

The rest fit only because the seed is small. `/procurement` shows fifteen
purchase orders and there are exactly fifteen; `/patients` caps at fifty and
holds twenty-seven. Each becomes the same defect on the first ordinary week of
trading, silently.

Six of the twenty-four do not display a total either, so nothing on screen
suggests anything is missing.

### 5.2 The shared table pages inside the slice it was handed

`DataTable` is the product's list component: sorting, column choice, saved
views, density, export, and a **Previous / Next** pager. That pager is
client-side — it pages over the rows the screen passed in. It takes a `total`
prop precisely so it can say "25 of 119" when the server holds more.

**One page out of seventeen passes it** (`/serials`). Twelve of the other
sixteen fetch a capped slice, so their pager cannot reach the rest.

So on twelve screens — `/accounting`, `/adjustments`, `/admin/integrations`,
`/admin/jobs`, `/automation`, `/cold-chain`, `/controlled`, `/forecast`,
`/pricing`, `/suppliers`, `/transfers`, `/warehouse` — the reader sees a pager
reading `1 / 3`, walks it
to the end, and reasonably concludes they have seen everything. They have seen
the first 15 to 200 rows. **A pager that lies about the extent of the data is
worse than no pager**, because no pager at least prompts the question.

The worst of them is `/controlled`: capped at 200 register entries, no total, no
route to the rest. That is the record a regulator reads.

A separate shape of the same mistake: `/inventory/expiry` fetches **670 rows
uncapped** and pages them in the browser. The results are complete and the
response grows with the pharmacy.

The report claims the DataTable is "used by every list screen". It is used by
seventeen of forty-three; the rest hand-roll a `<Table>` and therefore have no
sorting, no column choice, no saved views and no export.

### 5.3 Regulated data is captured through browser prompts

Twenty-one `window.prompt` calls across ten pages, including:

- `/invoices` — **a payment amount**, typed into a browser prompt with no
  validation, no currency, and no way to correct a typo before it posts.
- `/transfers` — **the quantity actually received** against a dispatch.
- `/disposal` — **the witness to a disposal**, which is a regulatory record.
- `/quality` — investigation fields chosen dynamically by key.
- `/dispensing` — four, including the reversal reason and who collected the
  medicine. **Those are mine**, added two commits ago, in the same pass where I
  replaced three of them on `/batches` and called the pattern out.

A `window.prompt` cannot be validated, cannot be styled, cannot show a hint,
returns only a string, and is suppressed outright by some browsers in installed
PWA mode — which this product supports. Every one of these should be the
`Drawer` + `Field` pattern the codebase already has.

### 5.4 Errors arrive as one banner and never mark the field

Thirty-five pages render failures through a single `ErrorBox` at the top. The
`Field` primitive takes an `error` prop for exactly this. Nine pages build forms
with `Field`; **none of them passes it** — zero uses across forty-three pages. A reader whose form is rejected is
told what is wrong and left to work out which of eleven inputs it refers to.

### 5.5 Half the pages that change something say nothing when it works

Seventeen pages change data and set no success message. The only evidence an action succeeded is that the list quietly
re-renders — and if the change is off-screen or below the cap in §5.1, there is
no evidence at all.

### 5.6 Nothing on screen updates itself

No page in the product polls or refreshes. `setInterval` appears nowhere.

For most screens that is right. For three it is not: `/cold-chain` presents
**live** sensor readings, `/notifications` is where escalations land, and
`/approvals` is a queue — all of them static until somebody presses reload. A
cold-chain excursion is visible when the reader happens to refresh.

### 5.7 Translation covers the chrome, not the product

`lib/i18n.tsx` is 450 lines: three locales, dotted-key catalogues, placeholder
interpolation, `Intl` number and date formatting, missing-key logging, and a
coverage report on `/admin`. Every nav item carries a `labelKey`.

**No page body uses it** — zero of forty-three call a translate function.
Switching to Amharic translates the sidebar and the header and leaves every
heading, column, button, empty state and error message in English.

### 5.8 Smaller, across the board

- **Loading is a spinner on 39 pages** and a content-shaped skeleton on one.
- **Offline support is one page.** `posQueue` is used by `/pos` alone; the PWA
  claim does not extend past the till.
- **Keyboard shortcuts are one page.** `/pos`, plus the shell's command palette.
- **`/admin/jobs`, `/import` and `/login` have no empty state at all**, and
  `/returns`, `/disposal` and `/notifications` rendered blank in the browser
  sweep — no heading, no explanation, no way to start the thing the page is for.
- **URL state is one page.** Only `/inventory` puts its filters in the address
  bar; every other filter, tab and selection is lost on reload and cannot be
  sent to a colleague.

---

## 6. Page by page

`—` means none of the checks in §5 fired. It does not mean the page is finished.

| Page | Findings |
| --- | --- |
| `/` | no empty state; no error state |
| `/accounting` | caps at 100 with no pager; pager covers only the fetched slice; changes data without confirming it |
| `/adjustments` | caps at 25 with no pager; pager covers only the fetched slice |
| `/admin` | caps at 50 with no pager; changes data without confirming it |
| `/admin/integrations` | caps at 100 with no pager; pager covers only the fetched slice; changes data without confirming it |
| `/admin/jobs` | caps at 50 with no pager; pager covers only the fetched slice; changes data without confirming it; no empty state |
| `/admin/settings` | changes data without confirming it |
| `/approvals` | 2 browser prompts |
| `/automation` | caps at 15 with no pager; pager covers only the fetched slice; changes data without confirming it |
| `/batches` | — |
| `/batches/[id]` | — |
| `/cold-chain` | caps at 25 with no pager; pager covers only the fetched slice; changes data without confirming it |
| `/command-center` | — |
| `/controlled` | caps at 200 with no pager; pager covers only the fetched slice; 1 browser prompt |
| `/counts` | caps at 200 with no pager |
| `/damage` | caps at 25 with no pager; 2 browser prompts |
| `/dashboard` | caps at 100 with no pager |
| `/dispensing` | caps at 25 with no pager — **34 of 59 unreachable today**; 4 browser prompts |
| `/disposal` | caps at 25 with no pager; 2 browser prompts |
| `/forecast` | caps at 25 with no pager; pager covers only the fetched slice |
| `/import` | changes data without confirming it; no empty state |
| `/inventory` | — |
| `/inventory/expiry` | — |
| `/invoices` | caps at 25 with no pager; 3 browser prompts |
| `/login` | no empty state |
| `/notifications` | changes data without confirming it |
| `/patients` | caps at 50 with no pager; 2 browser prompts |
| `/pos` | changes data without confirming it |
| `/pricing` | caps at 200 with no pager; pager covers only the fetched slice; changes data without confirming it |
| `/procurement` | caps at 15 with no pager |
| `/products` | caps at 25 with no pager — **94 of 119 unreachable today** |
| `/products/[id]` | — |
| `/quality` | caps at 25 with no pager; 2 browser prompts |
| `/recalls` | caps at 25 with no pager; changes data without confirming it |
| `/receiving` | caps at 25 with no pager; changes data without confirming it |
| `/reports` | — |
| `/reports/builder` | 1 browser prompt; changes data without confirming it |
| `/returns` | caps at 25 with no pager |
| `/scan` | no error state |
| `/serials` | caps at 100 with no pager; changes data without confirming it |
| `/suppliers` | caps at 50 with no pager; pager covers only the fetched slice; changes data without confirming it |
| `/transfers` | caps at 25 with no pager; pager covers only the fetched slice; 2 browser prompts |
| `/warehouse` | caps at 200 with no pager; pager covers only the fetched slice; changes data without confirming it |

---

## What is genuinely sound

Worth stating, because an audit that only lists faults misrepresents the system.

- Every state machine has a transition table or an equivalent guard, and no
  declared state is unreachable except `TransferStatus.RECEIVED`.
- Notification targeting is correct: role codes expand to concrete users,
  scoped by branch, and an event with no recipient is recorded rather than
  dropped. It is only the links that fail.
- The automation rule engine is wired, active, and its default rules cover the
  gaps a nightly job would otherwise leave.
- The design system holds up. Contrast, focus order, dark mode and overflow pass
  at six widths across forty pages, and the primitives exist for almost every
  fix listed above — `Drawer`, `Field` with its unused `error` prop, `DataTable`
  with its unused `total` prop, a 450-line i18n layer no page calls. **Most of
  this audit is not missing machinery. It is machinery that was built and not
  connected.**
- The ledger, FEFO, the audit chain and the money arithmetic are untouched by
  any of it. The rules hold; it is the reach that fails.

---

## Order of work

Ordered by how many people each unblocks, not by how interesting it is.

1. ~~**`GET /me/scope`, and repoint `ScopeProvider` and `/pos` at it.**~~
   **Done.** Measured afterwards as the roles themselves: 0 of 179 page/role
   combinations broken or partial, was 72 of 177; 8 of 8 core tasks pass, was
   2 of 8.
2. ~~**Server pagination on the twenty-seven capped lists**, and pass `total`
   to every `DataTable`.~~ **Done.** `usePaged` owns the page number and hands
   `DataTable` a `server` descriptor, so its Previous/Next asks the server
   rather than walking the slice it was given; the hand-rolled lists get the
   same through `<Pager>`. The caps that survive are search-as-you-type
   dropdowns that now say how many matched, deliberate samples that say so
   beside a link to the full list, and probes that read only a total.
   `pager-check.mjs` clicks Next on every converted screen and proves the rows
   changed. §5.1, §5.2.
3. **`?id=` handling on the fifteen list pages.** Makes every notification link
   land on its record, and turns the existing drawers into deep links. §3.
4. **Replace the twenty-one browser prompts** with the `Drawer` + `Field`
   pattern already in the codebase, starting with the payment amount, the
   received quantity and the disposal witness. §5.3.
5. **Decide between the workflow engine and the inline chains**, and implement
   distinct approvers wherever `approval.requireDistinctApprovers` claims to
   apply. §2.
6. Per-field validation, success confirmation on the fourteen silent pages,
   polling on the three live screens, and translation in page bodies. §5.4–§5.7.

Items 1–3 are the difference between a system that demonstrates and a system
that runs a pharmacy. Items 1 and 2 are done; item 3 is next.
