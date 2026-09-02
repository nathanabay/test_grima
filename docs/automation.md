# Automation rules

Rules are **configured data, not code**. An administrator changes what the
system watches for, and what it does about it, without a deployment. Screen:
**Administration → Automation rules** (`admin.automation.READ` / `.EDIT`).

## The shape

    TRIGGER  →  CONDITION  →  ACTION  →  ESCALATION

**Trigger** names what the rule looks at. It is chosen from a fixed list,
because each one is a real query over real tables — a rule cannot invent a data
source:

`BATCH_EXPIRY`, `STOCK_LEVEL`, `TEMPERATURE_EXCURSION`, `PURCHASE_ORDER_OVERDUE`,
`STOCK_VARIANCE`, `CONTROLLED_VARIANCE`, `SUPPLIER_LICENCE`, `QUARANTINED_STOCK`.

**Condition** is a list of field/operator/value tests, all of which must hold.
Operators: `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `not_in`, `contains`,
`starts_with`, `is_null`, `is_not_null`, `between`.

There is deliberately **no expression language**. A stored expression evaluated
at runtime is an injection surface and cannot be explained back to the person
who wrote it. Comparison is numeric-aware, so `"10" > "9"` is true, and a field
the subject does not carry never matches — it does not match by accident.

**Action** is one of six, and only six. Each does something the system can
actually do:

| Action | Effect |
| --- | --- |
| `NOTIFY` | Raises a notification to a role or a user, on the configured channels. |
| `CREATE_INCIDENT` | Opens a quality incident. |
| `QUARANTINE_BATCH` | Moves a batch out of available stock. |
| `CREATE_TASK` | Raises a warehouse task. |
| `FLAG_FOR_APPROVAL` | Sends a document into the approval engine. |
| `WEBHOOK` | Emits an integration event to subscribed endpoints. |

Nothing here writes stock quantities directly, dispenses, sells, or pays
anybody. An automation rule can quarantine a batch — the safe direction — but it
cannot release one.

**Escalation** is a ladder of steps, each with an `afterHours` and its own
actions. A subject that keeps matching climbs it.

## Cooldown and escalation, precisely

The first time a rule matches a subject, it acts and opens an escalation record.
Within `cooldownHours` the same match is **suppressed** rather than repeated —
so an expiry rule running hourly does not send the same alert 24 times a day.

When the next escalation step falls due, that step's actions run and the record
climbs a level. A subject that stops matching is **resolved**, which stops the
ladder chasing something already dealt with.

One subtlety worth stating because it is easy to get wrong: coming round again
after a cooldown moves only the "last acted" stamp, not the escalation due date.
Pushing the due date forward on every re-notification would mean a problem that
keeps re-notifying never escalates.

## Preview before you let it loose

`GET /api/automation/rules/:id/preview` reports, without doing anything:

- how many subjects were scanned and how many matched;
- **the rendered message** each action would send, so you see the actual text;
- per-condition detail for each match — which test passed and against what value;
- **near misses**: examples that did not match and why, which is what explains a
  rule that is quieter than expected.

Nobody should have to discover what a rule matches by letting it loose on live
data.

## Running

The `automation.runAll` job evaluates every active rule hourly, and each run
writes an `automation_runs` row: scanned, matched, actions run, suppressed,
failed, plus a sample of the subjects. A single rule can be run on demand from
the screen. A rule that errors records the error and does not stop the others.

## The shipped rules

Ten, seeded as a starting point and all editable:

`EXPIRY_90`, `EXPIRY_30`, `LOW_STOCK`, `STOCKOUT`, `COLD_CHAIN_EXCURSION`,
`PO_OVERDUE`, `COUNT_VARIANCE`, `CONTROLLED_VARIANCE`, `SUPPLIER_LICENCE`,
`QUARANTINE_AGEING`.

Their thresholds come from the settings catalogue, not from the rules
themselves, so changing the expiry horizon in configuration changes what these
rules watch.
