# Accounting

Screen: **Operations → Accounting**.

## FEFO and valuation are independent

This is the single most important thing to understand here, and conflating the
two is the classic mistake:

- **FEFO decides which physical pack leaves the shelf.** It is a patient-safety
  rule — closest to expiry goes first.
- **The valuation method decides what that movement costs.** FIFO cost layers or
  a running weighted average, set in `finance.valuationMethod`.

A pharmacy can pick FEFO and value on weighted average simultaneously, and most
do. The valuation service never reads an expiry date to decide cost, and the
FEFO service never reads a cost to decide what to pick.

## Chart of accounts

Accounts are `ASSET`, `LIABILITY`, `EQUITY`, `INCOME` or `EXPENSE`, and a
pharmacy numbers them however it likes. Postings look accounts up by a **system
key** — `INVENTORY_ASSET`, `CASH`, `ACCOUNTS_RECEIVABLE`, `SALES_REVENUE`,
`COGS`, `VAT_OUTPUT`, `GRNI`, `ACCOUNTS_PAYABLE`, `STOCK_LOSS` and the rest —
not by code.

**Administration → Accounting → chart of accounts** shows a mapping-health table:
a role with nothing mapped blocks exactly the documents that need it, and says
which. `POST /api/accounting/accounts/ensure-defaults` creates only the missing
ones; it never renames, remaps or deletes an existing account.

## What gets posted

| Document | Debit | Credit |
| --- | --- | --- |
| Goods receipt | Inventory | Goods received not invoiced |
| Supplier invoice | GRNI (+ withholding) | Accounts payable |
| Supplier payment | Accounts payable | Cash |
| Sale | Cash and/or receivables | Revenue, output VAT |
| Cost of a sale | COGS | Inventory |
| Adjustment / damage / disposal | Stock loss | Inventory |

Cash sales carry one wrinkle worth stating: the till records what the customer
**handed over**, not what the sale was worth. 1000 birr tendered against a 2.07
sale is ordinary, and 997.93 goes back across the counter. Only what the drawer
keeps is an asset, so the tender is capped at the sale total and the journal
line records what was tendered and what was given back. Posting the tender
itself would put money in the accounts the pharmacy never had.

## Posting is a background job, not the critical path

`accounting.postPending` runs hourly and posts everything that has not reached
the ledger. A ledger problem must never stop a pharmacist working, so posting
never sits inside a dispensing or a sale.

It selects **what is actually outstanding**, through a join against the journal
— not the oldest N documents filtered in memory, which silently stops reaching
recent work once history grows past the batch size. Failures are returned, not
swallowed: `GET /api/accounting/unposted` is the queue, and the accounting screen
shows it with a button to drain it.

Posting is idempotent per source document: a second attempt returns the existing
entry rather than writing a duplicate.

## Correction is by reversal only

A posted entry is never edited or deleted. Reversing writes the mirror image as
a new entry and marks the original `REVERSED`; both stay in the ledger, so what
was posted and when it was corrected both survive. The same entry cannot be
reversed twice.

Enforced on the way in, each with its own message:

- an entry that does not balance is refused, not corrected;
- a line cannot be both a debit and a credit;
- a negative amount is refused rather than flipped silently;
- a one-sided entry and a zero entry are refused;
- a line must name an account, by id or by system key.

## Valuation and reconciliation

`GET /api/accounting/valuation` reports stock value under the configured method
and states its basis in words. Under FIFO it consumes cost layers oldest first
and records **which layers each issue consumed**, so COGS can be explained line
by line. When layers run short it falls back to the running average and says so
in the explanation rather than quietly inventing a cost.

`GET /api/accounting/valuation/reconciliation` compares the inventory account
against the physical valuation. These are two different questions — what the
ledger accumulated from movements, and what the stock on hand is worth today —
and they legitimately drift when costs change. **Reporting the gap is the
point.** A silent divergence between the accounts and the shelf is exactly what
a stock audit exists to catch, so the difference is stated with its percentage
and a one-percent working tolerance, not reconciled away.

## Periods

A period is `OPEN` or `CLOSED`. Nothing posts into a closed period. Closing is
refused while documents inside it are still unposted, so a period cannot be
closed over a gap. Reopening needs `finance.journal.APPROVE` and a reason, and
is audited.

## Credit and debit notes

Raised against a supplier invoice, a sale or a return, with a reason. A note is
`DRAFT` until issued; issuing posts it. A posted note is corrected by another
note, never by editing it.
