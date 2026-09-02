# Known limitations and external dependencies

Every feature from the master specification that is not fully implemented, with
the reason and the exact technical action that would complete it. Nothing here is
hidden behind a summary: if a feature is absent, it is named.

## Features needing external credentials

These are built to the boundary. The interface, the adapter, the settings and the
validation exist; only the live connection is missing, and nothing pretends a call
succeeded. See `.env.example` for the variables.

| Req | # | Feature | Variable needed | Action |
| --- | ---: | --- | --- | --- |
| `PHARM-PROC-010` | 260 | RFQ email integration. | `EMAIL_API_URL` | Send the RFQ through the existing email adapter once EMAIL_API_URL is configured. |
| `PHARM-PROC-046` | 296 | Purchase-order digital signature support. | `(signing provider)` | Needs a signing provider. The document renderer is in place to sign. |
| `PHARM-RECV-037` | 387 | Supplier discrepancy notification. | `EMAIL_API_URL` | Send the discrepancy through the existing email adapter once configured. |

## Features needing hardware this deployment does not have

| Req | # | Feature | Action |
| --- | ---: | --- | --- |
| `PHARM-XFER-024` | 524 | Transfer temperature logging. | Needs an in-transit logger. ShipmentPackage records the departure temperature only. |
| `PHARM-COLD-021` | 771 | Door-open alerts. | Needs a door contact on the fridge. |
| `PHARM-COLD-022` | 772 | Power-loss alerts. | Needs a power signal from the equipment or its gateway. |
| `PHARM-COLD-039` | 789 | Cold-chain transfer monitoring. | Needs an in-transit logger travelling with the shipment. |

## Deliberately not built

Building these would misrepresent something the system cannot know. Each is a
judgement, stated so it can be overruled.

| Req | # | Feature | Reasoning |
| --- | ---: | --- | --- |
| `PHARM-FEFO-030` | 180 | Near-expiry promotional suggestion. | A promotion is a commercial and sometimes regulatory decision about medicine. The system surfaces the risk and the value; recommending a discount on expiring medicine is not a call it should make unprompted. |
| `PHARM-ANLY-044` | 894 | Natural-language analytics assistant. | A natural-language assistant over pharmaceutical data would need a model call. The AI rule in the specification forbids autonomous high-risk action, and an assistant that can only read is a thin wrapper over the search and report builder that already exist. |
| `PHARM-ANLY-045` | 895 | "Ask inventory" interface. | As above. |

## Commercial contract paperwork

Modelling these well needs the pharmacy's own contract terms. The inventory
consequences (call-off, receipt, invoice matching) are all implemented; the
agreement document itself is not.

| Req | # | Feature | Action |
| --- | ---: | --- | --- |
| `PHARM-PROC-023` | 273 | Blanket purchase orders. | Add a PurchaseAgreement entity with committed quantities that call-off orders draw down. |
| `PHARM-PROC-024` | 274 | Framework agreements. | As above; a framework agreement is the same entity with a different call-off rule. |
| `PHARM-PROC-036` | 286 | Procurement budget control. | Needs a Budget entity per branch and period, checked when a purchase order is approved. |
| `PHARM-PROC-041` | 291 | Tender procurement support. | Tendering is a procurement process with its own legal requirements; the RFQ and comparison engine is the part that belongs in a stock system. |
| `PHARM-SUPP-039` | 339 | Supplier contract management. | A SupplierContract entity with terms, dates and documents. |

## Not built in this run

| Req | # | Feature | Exact technical action |
| --- | ---: | --- | --- |
| `PHARM-PRODX-040` | 90 | Category-specific markup. | Add `markupPercent` to ProductCategory and a category rung in PricingService.resolve, ranked below a price list and above the channel price. |
| `PHARM-BATCH-040` | 140 | Serial dispensing. | On dispense, update SerialNumber.status to DISPENSED for scanned serials inside the dispensing transaction. |
| `PHARM-BATCH-041` | 141 | Serial transferring. | Carry serials on StockTransferItem and move their batch association on receipt. |
| `PHARM-BATCH-042` | 142 | Serial returning. | On a return to stock, set the serial back to IN_STOCK; on a return to supplier, to RETURNED. |
| `PHARM-BATCH-045` | 145 | Serial status history. | Add a SerialEvent table written on every status change, mirroring the controlled register pattern. |
| `PHARM-BATCH-047` | 147 | Mass serial import. | Add a serial source to the import engine, validating against the batch and rejecting duplicates. |
| `PHARM-BATCH-049` | 149 | Serial-level audit trail. | Route serial status changes through AuditService like every other regulated change. |
| `PHARM-FEFO-018` | 168 | Expiry calendar. | A month-grid view over the existing expiry report, grouped by expiry date. |
| `PHARM-FEFO-019` | 169 | Expiry heat map. | A product-by-bucket matrix over the existing expiry rows, coloured by value at risk. |
| `PHARM-FEFO-023` | 173 | Historical expiry trend. | Snapshot bucket totals daily into a table so a trend has history to draw; the ledger alone cannot reconstruct what was near-expiry last month. |
| `PHARM-FEFO-024` | 174 | Branch expiry comparison. | Group the existing expiry rows by branch; the data is already scoped per branch. |
| `PHARM-FEFO-025` | 175 | Category expiry comparison. | Group the existing expiry rows by product category. |
| `PHARM-FEFO-026` | 176 | Supplier expiry comparison. | Group the existing expiry rows by the batch supplier. |
| `PHARM-FEFO-033` | 183 | Supplier-specific shelf-life policy. | Add minShelfLifeDays to Supplier and take the strictest of product, supplier and organisation in the receiving check. |
| `PHARM-FEFO-046` | 196 | Branch expiry targets. | Add an expiry target to Branch and compare the branch expiry rate against it in the health score. |
| `PHARM-FEFO-048` | 198 | Excess-stock expiry simulator. | Project holdings against forecast consumption to the expiry date; the forecast and the holdings both exist, the projection does not. |
| `PHARM-WHSE-028` | 228 | Warehouse maps. | A rendered warehouse map needs coordinates on WarehouseLocation and an SVG floor plan per warehouse. |
| `PHARM-PROC-026` | 276 | Recurring purchase orders. | A schedule on PurchaseOrder plus a job that raises the next copy, reusing the job runner. |
| `PHARM-PROC-031` | 281 | Supplier order acknowledgement. | An acknowledgement state and timestamp on PurchaseOrder, set through a supplier-facing endpoint or manually. |
| `PHARM-PROC-038` | 288 | Branch procurement limits. | Add a per-branch limit alongside the existing per-product restriction and check it in the approval engine. |
| `PHARM-PROC-039` | 289 | Emergency procurement workflow. | A workflow definition with a shortened approval chain, gated on a permission; the approval engine already supports the shape. |
| `PHARM-PROC-040` | 290 | Sole-source procurement workflow. | A justification field and a workflow definition that demands it when only one supplier is quoted. |
| `PHARM-PROC-044` | 294 | Procurement document checklist. | A checklist definition per document type, validated before a status transition. |
| `PHARM-PROC-047` | 297 | Supplier portal PO visibility. | A supplier-facing surface needs its own authentication boundary; the API key mechanism is the right foundation. |
| `PHARM-PROC-049` | 299 | Procurement savings calculation. | Compare the awarded price against the lowest quoted and the previous price; the quotation comparison already computes both. |
| `PHARM-SUPP-012` | 312 | Supplier credit limits. | Add creditLimit to Supplier and check it when an invoice is approved. |
| `PHARM-SUPP-018` | 318 | Supplier discount schedules. | A discount schedule table on SupplierProduct with quantity breaks, mirroring PriceListItem. |
| `PHARM-SUPP-020` | 320 | Supplier delivery calendars. | A delivery calendar on Supplier consulted when an expected date is computed. |
| `PHARM-SUPP-024` | 324 | Supplier onboarding workflow. | A workflow definition for onboarding with a document checklist; both mechanisms exist. |
| `PHARM-SUPP-025` | 325 | Supplier qualification workflow. | As above, with a qualification questionnaire. |
| `PHARM-SUPP-035` | 335 | Supplier responsiveness KPI. | Needs a first-response timestamp on RFQ and quotation to measure against. |
| `PHARM-SUPP-041` | 341 | Supplier risk level. | A risk field on Supplier, scored from the KPIs already computed. |
| `PHARM-SUPP-043` | 343 | Supplier dependency analysis. | Group spend by supplier and report concentration; the purchase history is there. |
| `PHARM-SUPP-044` | 344 | Single-source dependency alert. | Flag a product whose only supplier link is one supplier; SupplierProduct already answers the question. |
| `PHARM-RECV-023` | 373 | Temperature-at-receipt recording. | Add arrivalTempC to GoodsReceipt and compare it against the product range on a cold-chain line. |
| `PHARM-RECV-027` | 377 | Quality sampling. | A sampling record against a goods receipt line, feeding the batch release decision. |
| `PHARM-RECV-028` | 378 | Sampling-plan configuration. | A sampling plan per product or category driving how much is sampled. |
| `PHARM-RECV-029` | 379 | Quality inspection checklist. | A checklist definition per product category, answered before release. |
| `PHARM-RECV-044` | 394 | Average receiving time. | Measure receipt start to post; the timestamps exist, nothing aggregates them. |
| `PHARM-RECV-045` | 395 | Receiving backlog dashboard. | Count receipts by status over time in the same shape as the warehouse exception list. |
| `PHARM-RECV-048` | 398 | Quality trend dashboard. | Trend quality incidents and rejection rate over time; both are recorded. |
| `PHARM-COUNT-003` | 453 | Blind counting. | Hide systemQty from the count sheet and the record endpoint when the count is blind. |
| `PHARM-COUNT-004` | 454 | Double counting. | A second count round compared against the first before posting. |
| `PHARM-COUNT-012` | 462 | Rack counts. | A rack count type filtering by the location tree, which already nests. |
| `PHARM-COUNT-013` | 463 | Shelf counts. | A shelf count type, as above. |
| `PHARM-COUNT-021` | 471 | Count freeze option. | Freezing movement during a count needs a lock on the counted positions; the ledger takes row locks already, so this is a status check in the ledger. |
| `PHARM-COUNT-036` | 486 | Theft-loss classification. | A loss classification on the adjustment line, chosen from a configured list. |
| `PHARM-COUNT-038` | 488 | Misplacement classification. | As above, one of the classifications. |
| `PHARM-COUNT-044` | 494 | Count productivity metrics. | Count lines per counter per hour; the timestamps and the counter are recorded. |
| `PHARM-COUNT-046` | 496 | Warehouse accuracy ranking. | Rank warehouses by count accuracy; the accuracy figure is computed per count already. |
| `PHARM-XFER-028` | 528 | Driver information. | A driver field beside the existing vehicleOrCourier. |
| `PHARM-XFER-029` | 529 | Tracking-number support. | A tracking number field and a link out to the courier. |
| `PHARM-XFER-030` | 530 | Expected arrival. | An expected arrival on StockTransfer, set at dispatch. |
| `PHARM-XFER-031` | 531 | Delayed transfer alerts. | An automation trigger over transfers past their expected arrival; the engine and the ladder already exist. |
| `PHARM-XFER-041` | 541 | Transfer cost allocation. | Allocate freight to the transfer lines; needs a freight cost on the transfer. |
| `PHARM-XFER-042` | 542 | Transfer distance field. | A distance field, or a lookup between branch addresses. |
| `PHARM-XFER-049` | 549 | Transfer turnaround KPI. | Measure dispatch to receipt; both timestamps are recorded. |
| `PHARM-XFER-050` | 550 | Transfer optimization dashboard. | Rank transfer lanes by turnaround and shortfall once the turnaround KPI exists. |
| `PHARM-POS-025` | 575 | Store credit. | A store-credit balance on Patient with a ledger of its own, so it cannot be spent twice. |
| `PHARM-POS-026` | 576 | Gift voucher support. | A voucher entity with a redemption record; the same double-spend care as store credit. |
| `PHARM-POS-030` | 580 | Coupon support. | A coupon entity checked at the till, applied through PricingService so the discount is explained. |
| `PHARM-POS-032` | 582 | Tax-exempt transactions. | A tax-exempt flag on Patient or the sale, zeroing the line tax with the exemption recorded. |
| `PHARM-CRM-030` | 680 | Appointment/reminder integration. | An appointment entity and a reminder job; the job runner and the channels are in place. |
| `PHARM-CRM-031` | 681 | Refill reminders. | A job comparing dispensing dates against the prescribed duration, sending through the notification channels. |
| `PHARM-CRM-032` | 682 | Pickup notifications. | A notification when a prescription reaches ready-for-collection, once that status exists. |
| `PHARM-CRM-033` | 683 | Ready-for-collection status. | A ready-for-collection state on Dispensing between preparation and hand-over. |
| `PHARM-CRM-034` | 684 | Delivery request. | A delivery request entity with an address and a status; the address book is the prerequisite. |
| `PHARM-CRM-039` | 689 | Duplicate patient detection. | Compare new patients against existing ones on name, date of birth and phone, and warn on a near match. |
| `PHARM-CRM-040` | 690 | Patient merge workflow. | A merge that repoints prescriptions, sales and consents, then sets mergedIntoId. The field is on the model; the operation is not. |
| `PHARM-CRM-043` | 693 | Account anonymization workflow. | Overwrite the identifying fields, keep the clinical history, set isAnonymized. The fields are on the model; the operation is not. |
| `PHARM-CRM-044` | 694 | Retention-policy engine. | A retention job driven by compliance.retentionYears, which currently changes nothing. |
| `PHARM-CRM-047` | 697 | Customer satisfaction survey. | A survey entity and a response record. |
| `PHARM-CRM-049` | 699 | Customer lifetime-value analytics. | Sum sales and dispensings per patient over their lifetime; the data is there, the report is not. |
| `PHARM-RECALL-049` | 749 | Recall simulation/drill mode. | A drill mode that runs the recall trace and task generation without blocking stock, clearly labelled as a drill. |
| `PHARM-COLD-009` | 759 | Sensor calibration history. | A calibration record per sensor with a certificate and a due date. |
| `PHARM-COLD-010` | 760 | Sensor calibration expiration. | A due date on the calibration record, chased by the existing document expiry job. |
| `PHARM-COLD-042` | 792 | Calibration reminders. | Once calibration records exist, the existing document expiry job chases them. |
| `PHARM-COLD-043` | 793 | Maintenance reminders. | A maintenance schedule per equipment item, chased the same way. |
| `PHARM-COLD-044` | 794 | Equipment service history. | A service history against an equipment entity, which does not yet exist as distinct from a sensor. |
| `PHARM-COLD-045` | 795 | Backup refrigeration location. | A designated fallback location per cold-chain area, offered when an excursion is declared. |
| `PHARM-CTRL-030` | 830 | Suspicious transaction alerts. | Needs a defined pattern to detect. Statistical anomaly detection over controlled dispensing is a real feature but an invented threshold would be worse than none. |
| `PHARM-CTRL-032` | 832 | Unusual-frequency alerts. | Compare dispensing frequency per patient and per prescriber against their own history; the register holds both. |
| `PHARM-CTRL-033` | 833 | Repeated-void alerts. | Count voids per user per shift and raise a rule when it exceeds a configured number. |
| `PHARM-CTRL-034` | 834 | After-hours access alerts. | Compare the entry time against controlled.afterHoursStart and End, which are declared and currently do nothing. |
| `PHARM-CTRL-043` | 843 | Compliance checklist. | A checklist definition and a completion record, reusing the workflow engine. |
| `PHARM-CTRL-047` | 847 | Compliance audit calendar. | A calendar of scheduled compliance activities with reminders. |
| `PHARM-ANLY-037` | 887 | Forecast accuracy calculation. | Store each forecast and compare it against what actually happened; nothing keeps the forecast today, so accuracy has nothing to measure against. |
| `PHARM-ANLY-038` | 888 | Forecast-versus-actual report. | Follows from storing forecasts. |
| `PHARM-ANLY-049` | 899 | Scheduled report delivery. | SavedReport stores a schedule and recipients; a job must run them and deliver through the notification channels. |
| `PHARM-SEC-007` | 907 | Product-category permissions. | Add a category dimension to ScopeService alongside branch and warehouse. |
| `PHARM-SEC-029` | 929 | Sensitive-field encryption. | Column-level encryption for the most sensitive patient fields, with key management. Deployment-level encryption at rest is the documented interim. |
| `PHARM-SEC-045` | 945 | Data retention policies. | A retention policy engine; the same job as feature 694. |
| `PHARM-PLAT-003` | 953 | API versioning. | A version segment in the path with the current routes aliased, so an integration is not broken by the next change. |
| `PHARM-PLAT-040` | 990 | Typo-tolerant search. | PostgreSQL pg_trgm with a similarity index on the searched columns. |
| `PHARM-PLAT-041` | 991 | Saved filters. | Persist a filter set per user per screen; the report builder already persists a definition, so the pattern exists. |
| `PHARM-PLAT-043` | 993 | Configurable dashboards. | A per-role dashboard layout stored and rendered from configuration. |

## Partially implemented

147 features work but are narrower than the specification asks. The gap is
stated per feature in `FEATURE_MATRIX.md`; the evidence column says what exists and
what does not.

