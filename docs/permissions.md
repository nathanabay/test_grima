# Roles and permissions

## The model

A permission is a code shaped `module.resource.ACTION`, for example
`inventory.batch.RELEASE` or `finance.journal.CANCEL`. The full catalogue lives
in `packages/shared/src/permissions.ts` and is the single source of truth: the
seed writes it, the API guard checks against it, and an API key's scopes are
validated against it.

Actions: `CREATE`, `READ`, `EDIT`, `DELETE`, `APPROVE`, `REJECT`, `CANCEL`,
`PRINT`, `EXPORT`, `IMPORT`.

Controllers declare what they need with `@RequirePermissions('module.resource.ACTION')`.
There is no route that relies on the interface hiding a button.

## Two independent gates

**1. Permission** — may this person do this kind of thing at all?

**2. Scope** — to which branches and warehouses? `ScopeService` turns a user's
assignments into a Prisma filter that goes *inside* the query, not a check after
it. A user with no assignment is organization-wide; a user assigned to two
branches sees exactly those two, in lists, in search, in reports and in the
health score alike.

Both gates apply to API keys, which resolve into the same `AuthenticatedUser`
shape as a person.

## Default roles

| Role | Shape of the job |
| --- | --- |
| `SUPER_ADMIN` | Everything, including configuration and the audit chain. |
| `PHARMACY_ADMIN` | Runs the pharmacy: users, catalogue, operations, reports. Not the ledger. |
| `PHARMACIST` | Dispensing, prescriptions, patients, controlled register, batch release. |
| `PHARMACY_TECHNICIAN` | Dispensing support and stock handling; no release, no approvals. |
| `PROCUREMENT_OFFICER` | Requests, RFQs, quotations, purchase orders, suppliers. |
| `WAREHOUSE_MANAGER` | Warehouse operations, transfers, counts, put-away and picking; reports without cost. |
| `STOREKEEPER` | Executes warehouse tasks; receives and moves stock. |
| `CASHIER` | The till, and looking a customer up at it. |
| `FINANCE_OFFICER` | Invoices, payments, the ledger, valuation, financial reports. |
| `QA_OFFICER` | Quarantine and release, quality incidents, cold chain, recalls, disposal. |
| `AUDITOR` | Reads everything, including the audit chain. Changes nothing. |
| `BRANCH_MANAGER` | One branch end to end, within its scope. |

Roles are data. An administrator can add one and choose its permissions; these
twelve are a starting point, not a fixed set.

## Segregation of duties

Enforced in the approval engine, not by convention:

- One person cannot approve two steps of the same document.
- A requester cannot approve their own request.
- A key cannot be granted a permission its creator does not hold — an
  integration is never a way to escalate privilege.
- Reading commercial cost needs `finance.report.READ` **on top of** the stock
  permission, so a stock report is still useful to someone who may not see cost:
  the cost column is withheld and named, not silently dropped.

## Sensitive actions

These need both a permission and a written reason, and both are audited:

| Action | Permission | Also requires |
| --- | --- | --- |
| Override the FEFO batch | `inventory.batch.EDIT` | A reason, plus the batch FEFO would have chosen is stored alongside |
| Release quarantined stock | `inventory.batch.RELEASE` | An investigation note |
| Reverse a journal entry | `finance.journal.CANCEL` | A reason; the original is marked reversed, never edited |
| Correct the controlled register | `dispensing.controlled.EDIT` | A REVERSAL row pointing at the entry it cancels |
| Reopen a closed period | `finance.journal.APPROVE` | A reason |
| Revoke an API key | `admin.setting.EDIT` | A reason |
| Export patient, financial or audit data | the resource's `EXPORT` | The export itself is audited |

## Demo accounts

All use the password `PharmaCore#2026`. Signing in as several is the quickest
way to see the two gates working:

`admin`, `manager`, `branchmgr`, `pharmacist`, `technician`, `procurement`,
`warehouse`, `storekeeper`, `cashier`, `finance`, `qa`, `auditor`
