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
them, and 72 of 177 page/role combinations the product's own sidebar offers are
broken or partial. All of it traces to a handful of structural mistakes, not to
scattered bugs — and none of it was visible before, because every test and every
browser sweep signs in as an administrator who holds all 204 permissions.

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

## What is genuinely sound

Worth stating, because an audit that only lists faults misrepresents the system:

- Every state machine has a transition table or an equivalent guard, and no
  declared state is unreachable except the one noted above.
- Notification targeting, role expansion and branch scoping are correct.
- The automation rule engine is wired, active, and its default rules cover the
  gaps a nightly job would otherwise leave.
- The ledger, FEFO, the audit chain and the money arithmetic are unaffected by
  any of this. The rules hold; it is the reach that fails.

---

## Order of work

1. `GET /me/scope` and repoint `ScopeProvider` — unblocks six of six broken
   tasks and 69 of 72 partial pages.
2. `?id=` handling on the fifteen list pages — makes every notification link
   work.
3. Decide between the workflow engine and the inline chains; implement
   distinct approvers wherever the setting claims to apply.
4. The smaller items above.

Step 1 is a few hours and changes the product from unusable to usable for every
operational role. Nothing else on this list matters until it is done.
