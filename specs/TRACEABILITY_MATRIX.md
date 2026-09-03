# Traceability Matrix

Requirement → specification → database → backend → API → permissions → interface →
audit → tests → status. One row per feature, all 1,000 of them.

A layer is ticked when that layer really exists for the module serving the feature
— checked against the schema, the module's services and controllers, its
`@RequirePermissions` decorators, its audit calls, and the page that renders it.
A feature that is not implemented carries no ticks, so the matrix cannot be read as
claiming work that was not done. Where a layer lives in a neighbouring module (the
cold-chain endpoints sit in the quality controller, sensitive report auditing in the
report builder) the check follows the code rather than the folder name.

| Req | # | Feature | Spec | DB | BE | API | RBAC | UI | Audit | Tests | Status |
| --- | ---: | --- | --- | :-: | :-: | :-: | :-: | :-: | :-: | --- | --- |
| `PHARM-PROD-001` | 1 | Unlimited pharmaceutical product records. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-002` | 2 | Generic medicine names. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-003` | 3 | Trade/brand names. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-004` | 4 | Multiple active ingredients. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-005` | 5 | Combination-drug support. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-006` | 6 | Ingredient strength records. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-007` | 7 | Multiple dosage strengths. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-008` | 8 | Dosage-form classification. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-009` | 9 | Route-of-administration classification. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-010` | 10 | Therapeutic-class classification. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-011` | 11 | ATC-code support. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-012` | 12 | Manufacturer records. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-013` | 13 | Marketing-authorization-holder records. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-014` | 14 | Country-of-origin records. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-015` | 15 | Regulatory-registration-number field. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-016` | 16 | Product-registration expiration tracking. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-017` | 17 | Multiple product images. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-018` | 18 | Package insert attachment. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-PROD-019` | 19 | Patient-information-leaflet attachment. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-PROD-020` | 20 | Safety-data-sheet attachment. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-PROD-021` | 21 | Multiple SKUs. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-022` | 22 | Internal item codes. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-023` | 23 | GTIN support. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-024` | 24 | EAN support. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-025` | 25 | UPC support. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-026` | 26 | Code-128 support. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-027` | 27 | GS1 DataMatrix support. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-PROD-028` | 28 | Multiple barcodes per product. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-029` | 29 | Barcode alias mapping. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-030` | 30 | Product-family relationships. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-031` | 31 | Product variant relationships. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-032` | 32 | Alternative-brand relationships. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-033` | 33 | Generic-equivalent relationships. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-034` | 34 | Substitute-product relationships. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-035` | 35 | Pack-size configuration. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-036` | 36 | Carton configuration. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-037` | 37 | Box configuration. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-038` | 38 | Strip configuration. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-039` | 39 | Blister configuration. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-040` | 40 | Tablet/capsule base units. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-041` | 41 | Liquid-volume units. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-042` | 42 | Weight units. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-043` | 43 | Injectable-unit configuration. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-044` | 44 | Vaccine-dose configuration. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-045` | 45 | Medical-device compatibility. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-PROD-046` | 46 | Active/inactive product status. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-047` | 47 | Product discontinuation dates. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-048` | 48 | Product launch dates. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-049` | 49 | Custom product attributes. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PROD-050` | 50 | Product change-history timeline. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-PRODX-001` | 51 | High-alert medicine flag. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-002` | 52 | Look-alike/sound-alike flag. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-003` | 53 | Cold-chain product flag. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-004` | 54 | Controlled-drug flag. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-005` | 55 | Narcotic classification support. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-006` | 56 | Hazardous-drug flag. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-007` | 57 | Cytotoxic-product flag. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-008` | 58 | Refrigerated-product flag. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-009` | 59 | Frozen-product flag. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-010` | 60 | Light-sensitive-product flag. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-011` | 61 | Humidity-sensitive-product flag. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-012` | 62 | Fragile-product flag. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-013` | 63 | Flammable-product flag. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-014` | 64 | Prescription-only classification. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-015` | 65 | OTC classification. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-016` | 66 | Pharmacy-only classification. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-017` | 67 | Hospital-use classification. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-018` | 68 | Veterinary-product classification. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-019` | 69 | Pediatric-product classification. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-020` | 70 | Pregnancy-information metadata. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-021` | 71 | Storage-temperature requirements. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-022` | 72 | Storage-humidity requirements. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-023` | 73 | Maximum excursion duration. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-024` | 74 | Minimum remaining shelf-life rule. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-025` | 75 | Standard supplier lead time. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-026` | 76 | Product minimum stock. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-027` | 77 | Product maximum stock. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-028` | 78 | Safety-stock configuration. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-029` | 79 | Reorder-point configuration. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-030` | 80 | Economic-order-quantity field. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-031` | 81 | Seasonal-demand profile. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-032` | 82 | Preferred supplier mapping. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-033` | 83 | Secondary supplier mapping. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-034` | 84 | Procurement restriction settings. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-035` | 85 | Minimum purchase quantity. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-036` | 86 | Purchase-order multiples. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-037` | 87 | Minimum sales quantity. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-038` | 88 | Maximum dispensing quantity. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-039` | 89 | Product profit-margin targets. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-040` | 90 | Category-specific markup. | `06-products` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-PRODX-041` | 91 | Branch-specific pricing. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-042` | 92 | Customer-group pricing. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-043` | 93 | Contract pricing. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-044` | 94 | Promotional pricing. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-045` | 95 | Wholesale pricing. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-046` | 96 | Retail pricing. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-047` | 97 | Insurance pricing. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-048` | 98 | Price-effective-date tracking. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-049` | 99 | Price-expiration-date tracking. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-PRODX-050` | 100 | Complete price-change history. | `06-products` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | pricing.integration, e2e-enterprise | IMPLEMENTED |
| `PHARM-BATCH-001` | 101 | Mandatory batch tracking where configured. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-BATCH-002` | 102 | Lot-number tracking. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-003` | 103 | Manufacturing-date tracking. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-004` | 104 | Expiration-date tracking. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-005` | 105 | Received-date tracking. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-006` | 106 | Batch supplier tracking. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-007` | 107 | Batch manufacturer tracking. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-008` | 108 | Batch purchase-price tracking. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-009` | 109 | Batch landed-cost tracking. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-BATCH-010` | 110 | Batch warehouse tracking. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-011` | 111 | Batch bin tracking. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-012` | 112 | Batch quantity tracking. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-013` | 113 | Batch reserved quantity. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-inventory | IMPLEMENTED |
| `PHARM-BATCH-014` | 114 | Batch available quantity. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-inventory | IMPLEMENTED |
| `PHARM-BATCH-015` | 115 | Batch damaged quantity. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-inventory | IMPLEMENTED |
| `PHARM-BATCH-016` | 116 | Batch quarantine quantity. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-017` | 117 | Batch recalled quantity. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-018` | 118 | Batch disposal quantity. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-inventory | IMPLEMENTED |
| `PHARM-BATCH-019` | 119 | Batch return quantity. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-inventory | IMPLEMENTED |
| `PHARM-BATCH-020` | 120 | Batch quality status. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-021` | 121 | Batch certificate-of-analysis attachment. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-022` | 122 | Batch regulatory-document attachment. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-023` | 123 | Batch quality-release workflow. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-024` | 124 | Batch quarantine workflow. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-025` | 125 | Batch rejection workflow. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-026` | 126 | Batch blocking. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-027` | 127 | Batch unblocking authorization. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-028` | 128 | Batch genealogy. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-inventory | IMPLEMENTED |
| `PHARM-BATCH-029` | 129 | Batch movement timeline. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-030` | 130 | Batch inventory valuation. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-031` | 131 | Batch expiry risk score. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-032` | 132 | Batch consumption velocity. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-inventory | IMPLEMENTED |
| `PHARM-BATCH-033` | 133 | Batch days-of-cover calculation. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-inventory | IMPLEMENTED |
| `PHARM-BATCH-034` | 134 | Batch-level profitability. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-BATCH-035` | 135 | Batch recall history. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-036` | 136 | Unique serial-number tracking. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-037` | 137 | Serial-to-batch relationship. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-038` | 138 | Serial-to-GTIN relationship. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-039` | 139 | Serial receiving. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-040` | 140 | Serial dispensing. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-BATCH-041` | 141 | Serial transferring. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-BATCH-042` | 142 | Serial returning. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-BATCH-043` | 143 | Duplicate-serial detection. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-BATCH-044` | 144 | Invalid-serial alerts. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-BATCH-045` | 145 | Serial status history. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-BATCH-046` | 146 | Serialization API. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-BATCH-047` | 147 | Mass serial import. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-BATCH-048` | 148 | Serialized product lookup. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow | IMPLEMENTED |
| `PHARM-BATCH-049` | 149 | Serial-level audit trail. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-BATCH-050` | 150 | Serialized recall search. | `08-batches` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-FEFO-001` | 151 | Automatic FEFO picking. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-002` | 152 | Configurable FIFO fallback. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-003` | 153 | FEFO batch recommendation. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-004` | 154 | Manual FEFO override permission. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-005` | 155 | FEFO override reason requirement. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-006` | 156 | FEFO override auditing. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-007` | 157 | Expired-batch blocking. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-008` | 158 | Near-expiry detection. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-009` | 159 | 7-day expiry bucket. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-010` | 160 | 14-day expiry bucket. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-011` | 161 | 30-day expiry bucket. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-012` | 162 | 60-day expiry bucket. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-013` | 163 | 90-day expiry bucket. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-014` | 164 | 180-day expiry bucket. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-015` | 165 | 365-day expiry bucket. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-016` | 166 | Custom expiry buckets. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-017` | 167 | Expiry countdown display. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-018` | 168 | Expiry calendar. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-FEFO-019` | 169 | Expiry heat map. | `11-fefo` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-FEFO-020` | 170 | Expiry financial-risk calculation. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-021` | 171 | Expiry quantity-risk calculation. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-022` | 172 | Expiry rate KPI. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-023` | 173 | Historical expiry trend. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-FEFO-024` | 174 | Branch expiry comparison. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-FEFO-025` | 175 | Category expiry comparison. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-FEFO-026` | 176 | Supplier expiry comparison. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-FEFO-027` | 177 | Expiry alert escalation. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-028` | 178 | Near-expiry transfer recommendation. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-029` | 179 | Near-expiry return recommendation. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-FEFO-030` | 180 | Near-expiry promotional suggestion. | `11-fefo` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-FEFO-031` | 181 | Short-shelf-life receiving warning. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-032` | 182 | Shelf-life acceptance policies. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-033` | 183 | Supplier-specific shelf-life policy. | `11-fefo` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-FEFO-034` | 184 | Product-specific shelf-life policy. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-035` | 185 | Expiry write-off workflow. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-036` | 186 | Expiry quarantine. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-037` | 187 | Expiry disposal workflow. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-038` | 188 | Expiry approval hierarchy. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-039` | 189 | Expiry loss reporting. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-040` | 190 | Prevent expired transfers. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-041` | 191 | Prevent expired reservations. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-042` | 192 | Prevent expired POS sales. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-043` | 193 | Prevent expired dispensing. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-044` | 194 | Expiry notification digest. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-045` | 195 | Expiry-risk dashboard. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-046` | 196 | Branch expiry targets. | `11-fefo` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-FEFO-047` | 197 | Forecast expiry before procurement. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-FEFO-048` | 198 | Excess-stock expiry simulator. | `11-fefo` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-FEFO-049` | 199 | Automatic expiry-risk scoring. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-FEFO-050` | 200 | Expiry prevention recommendations. | `11-fefo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fefo.spec, expiry.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-WHSE-001` | 201 | Unlimited warehouses. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-002` | 202 | Unlimited branches. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-003` | 203 | Warehouse hierarchy. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-004` | 204 | Storage zones. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-005` | 205 | Rooms. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-006` | 206 | Cold rooms. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-007` | 207 | Refrigerators. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-008` | 208 | Freezers. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-009` | 209 | Racks. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-010` | 210 | Shelves. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-011` | 211 | Bins. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-012` | 212 | Pallet locations. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-WHSE-013` | 213 | Picking locations. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-014` | 214 | Receiving areas. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-015` | 215 | Dispatch areas. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-016` | 216 | Quarantine areas. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-017` | 217 | Damaged-stock areas. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-018` | 218 | Controlled-drug storage. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-019` | 219 | Returned-goods storage. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-020` | 220 | Recall holding areas. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-021` | 221 | Location capacity. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-022` | 222 | Location weight limits. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-023` | 223 | Storage-condition compatibility. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-024` | 224 | Automatic bin recommendations. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-025` | 225 | Put-away workflows. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-026` | 226 | Directed put-away. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-027` | 227 | Barcode bin scanning. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-028` | 228 | Warehouse maps. | `13-warehouse` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-WHSE-029` | 229 | Warehouse capacity dashboards. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-030` | 230 | Occupancy percentage. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-031` | 231 | Empty-bin detection. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-032` | 232 | Product-location history. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-033` | 233 | Multi-location product stock. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-034` | 234 | Bin-to-bin transfers. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-035` | 235 | Replenishment between bins. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-036` | 236 | Pick-face replenishment. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-037` | 237 | Pick lists. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-038` | 238 | Wave picking. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-039` | 239 | Zone picking. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-040` | 240 | Batch picking. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-041` | 241 | Picking confirmation scanning. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-042` | 242 | Packing workflows. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-043` | 243 | Packing verification. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-044` | 244 | Dispatch verification. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-045` | 245 | Shipment staging. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-046` | 246 | Dock management. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-047` | 247 | Warehouse task assignment. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-048` | 248 | Warehouse productivity metrics. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-049` | 249 | Warehouse cycle-time metrics. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-WHSE-050` | 250 | Warehouse exception dashboard. | `13-warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-warehouse | IMPLEMENTED |
| `PHARM-PROC-001` | 251 | Purchase requisitions. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-002` | 252 | Purchase-request approvals. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-003` | 253 | Automated purchase suggestions. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-004` | 254 | Department purchase requests. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-005` | 255 | Branch purchase requests. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-006` | 256 | Centralized procurement. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-007` | 257 | Decentralized procurement. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-008` | 258 | Request-for-quotation creation. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-009` | 259 | Multiple RFQ suppliers. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-010` | 260 | RFQ email integration. | `14-procurement` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-PROC-011` | 261 | Supplier quotation entry. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-012` | 262 | Quotation document upload. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-013` | 263 | Quotation comparison. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-014` | 264 | Total landed-cost comparison. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-015` | 265 | Delivery-time comparison. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-016` | 266 | Shelf-life comparison. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-017` | 267 | Payment-term comparison. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-018` | 268 | Supplier-score comparison. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-019` | 269 | Weighted supplier scoring. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-020` | 270 | Procurement recommendation engine. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-021` | 271 | Purchase-order generation. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-022` | 272 | Purchase-order approval. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-023` | 273 | Blanket purchase orders. | `14-procurement` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-PROC-024` | 274 | Framework agreements. | `14-procurement` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-PROC-025` | 275 | Contract purchase orders. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-PROC-026` | 276 | Recurring purchase orders. | `14-procurement` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-PROC-027` | 277 | Partial purchase-order fulfillment. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-028` | 278 | Purchase-order amendment. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-PROC-029` | 279 | Purchase-order revision history. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-PROC-030` | 280 | Purchase-order cancellation. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-031` | 281 | Supplier order acknowledgement. | `14-procurement` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-PROC-032` | 282 | Expected delivery dates. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-033` | 283 | Delivery-delay alerts. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-034` | 284 | Open purchase-order dashboard. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-035` | 285 | Purchase commitments report. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-PROC-036` | 286 | Procurement budget control. | `14-procurement` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-PROC-037` | 287 | Product procurement limits. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-038` | 288 | Branch procurement limits. | `14-procurement` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-PROC-039` | 289 | Emergency procurement workflow. | `14-procurement` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-PROC-040` | 290 | Sole-source procurement workflow. | `14-procurement` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-PROC-041` | 291 | Tender procurement support. | `14-procurement` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-PROC-042` | 292 | Procurement committee approvals. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-PROC-043` | 293 | Bid comparison matrices. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-044` | 294 | Procurement document checklist. | `14-procurement` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-PROC-045` | 295 | Purchase-order PDF generation. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-PROC-046` | 296 | Purchase-order digital signature support. | `14-procurement` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-PROC-047` | 297 | Supplier portal PO visibility. | `14-procurement` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-PROC-048` | 298 | Procurement KPI dashboard. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-PROC-049` | 299 | Procurement savings calculation. | `14-procurement` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-PROC-050` | 300 | Procurement audit history. | `14-procurement` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-SUPP-001` | 301 | Supplier master records. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-SUPP-002` | 302 | Supplier contact people. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-SUPP-003` | 303 | Multiple supplier addresses. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-SUPP-004` | 304 | Supplier tax information. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-SUPP-005` | 305 | Supplier licenses. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-SUPP-006` | 306 | Supplier license expiration. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-SUPP-007` | 307 | Supplier certifications. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-SUPP-008` | 308 | Supplier certification expiration. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-SUPP-009` | 309 | Supplier bank details. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-SUPP-010` | 310 | Supplier currencies. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-SUPP-011` | 311 | Supplier payment terms. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-SUPP-012` | 312 | Supplier credit limits. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-SUPP-013` | 313 | Supplier lead times. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-SUPP-014` | 314 | Supplier product catalog. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-SUPP-015` | 315 | Supplier-specific product codes. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-SUPP-016` | 316 | Supplier price lists. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-SUPP-017` | 317 | Supplier price histories. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-SUPP-018` | 318 | Supplier discount schedules. | `15-suppliers` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-SUPP-019` | 319 | Supplier minimum orders. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-SUPP-020` | 320 | Supplier delivery calendars. | `15-suppliers` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-SUPP-021` | 321 | Approved supplier status. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-SUPP-022` | 322 | Suspended supplier status. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-SUPP-023` | 323 | Blacklisted supplier status. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-SUPP-024` | 324 | Supplier onboarding workflow. | `15-suppliers` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-SUPP-025` | 325 | Supplier qualification workflow. | `15-suppliers` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-SUPP-026` | 326 | Supplier document verification. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-SUPP-027` | 327 | Supplier performance score. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-SUPP-028` | 328 | On-time-delivery KPI. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-SUPP-029` | 329 | Order-fill-rate KPI. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-SUPP-030` | 330 | Rejection-rate KPI. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-SUPP-031` | 331 | Supplier defect-rate KPI. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-SUPP-032` | 332 | Supplier return-rate KPI. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-SUPP-033` | 333 | Supplier price-competitiveness KPI. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-SUPP-034` | 334 | Supplier lead-time KPI. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-SUPP-035` | 335 | Supplier responsiveness KPI. | `15-suppliers` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-SUPP-036` | 336 | Supplier quality incidents. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-SUPP-037` | 337 | Supplier corrective-action requests. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-SUPP-038` | 338 | Supplier complaints. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-SUPP-039` | 339 | Supplier contract management. | `15-suppliers` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-SUPP-040` | 340 | Supplier contract expiration alerts. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-SUPP-041` | 341 | Supplier risk level. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-SUPP-042` | 342 | Supplier country risk. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-SUPP-043` | 343 | Supplier dependency analysis. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-SUPP-044` | 344 | Single-source dependency alert. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-SUPP-045` | 345 | Alternate supplier suggestion. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-SUPP-046` | 346 | Supplier spend analysis. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-SUPP-047` | 347 | Supplier payment analysis. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-SUPP-048` | 348 | Supplier purchase forecasting. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-SUPP-049` | 349 | Supplier performance dashboard. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement | IMPLEMENTED |
| `PHARM-SUPP-050` | 350 | Supplier 360-degree profile. | `15-suppliers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-RECV-001` | 351 | Goods receipt notes. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-002` | 352 | PO-based receiving. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-003` | 353 | Non-PO receiving permission. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-004` | 354 | Barcode receiving. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-005` | 355 | GS1 DataMatrix receiving. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-006` | 356 | GTIN extraction. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-007` | 357 | Batch extraction. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-008` | 358 | Expiry extraction. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-009` | 359 | Serial extraction. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-010` | 360 | Quantity verification. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-011` | 361 | Purchase-price verification. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-012` | 362 | Supplier verification. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-013` | 363 | PO variance detection. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-014` | 364 | Over-delivery detection. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-015` | 365 | Under-delivery detection. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-016` | 366 | Wrong-product detection. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-017` | 367 | Duplicate-delivery detection. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-RECV-018` | 368 | Duplicate-GRN detection. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-RECV-019` | 369 | Short-shelf-life detection. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-020` | 370 | Expired-delivery rejection. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-021` | 371 | Damaged-packaging recording. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-022` | 372 | Receiving photos. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-RECV-023` | 373 | Temperature-at-receipt recording. | `16-receiving` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-RECV-024` | 374 | Cold-chain delivery verification. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-RECV-025` | 375 | Delivery-document attachment. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-026` | 376 | Certificate-of-analysis verification. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-RECV-027` | 377 | Quality sampling. | `16-receiving` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-RECV-028` | 378 | Sampling-plan configuration. | `16-receiving` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-RECV-029` | 379 | Quality inspection checklist. | `16-receiving` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-RECV-030` | 380 | Pass status. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-031` | 381 | Fail status. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-032` | 382 | Conditional release. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-RECV-033` | 383 | Quarantine status. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-034` | 384 | QA approval. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-035` | 385 | QA rejection. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-036` | 386 | Receiving discrepancies. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-037` | 387 | Supplier discrepancy notification. | `16-receiving` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-RECV-038` | 388 | Goods-return-from-receiving workflow. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-039` | 389 | Receiving label printing. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-040` | 390 | Automatic put-away tasks. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-041` | 391 | GRN accounting integration. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-042` | 392 | Receiving audit logs. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-043` | 393 | Receiving user productivity. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-RECV-044` | 394 | Average receiving time. | `16-receiving` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-RECV-045` | 395 | Receiving backlog dashboard. | `16-receiving` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-RECV-046` | 396 | Pending QA dashboard. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-RECV-047` | 397 | Failed receipt dashboard. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-RECV-048` | 398 | Quality trend dashboard. | `16-receiving` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-RECV-049` | 399 | Receiving analytics. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-RECV-050` | 400 | Supplier quality comparison. | `16-receiving` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-procurement, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-001` | 401 | Immutable stock ledger. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-002` | 402 | Double-entry inventory movements. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-003` | 403 | Purchase receipt entries. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-004` | 404 | Sales issue entries. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-005` | 405 | Dispensing issue entries. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-006` | 406 | Transfer-out entries. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-007` | 407 | Transfer-in entries. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-008` | 408 | Return-in entries. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-009` | 409 | Return-out entries. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-010` | 410 | Adjustment entries. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-011` | 411 | Damage entries. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-012` | 412 | Expiry entries. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-013` | 413 | Recall entries. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-014` | 414 | Disposal entries. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-015` | 415 | Stock-count entries. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-016` | 416 | Manufacturing adjustment support. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | — | e2e-inventory | PARTIALLY IMPLEMENTED |
| `PHARM-LEDG-017` | 417 | Donation receipt entries. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-LEDG-018` | 418 | Donation issue entries. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-LEDG-019` | 419 | Sample issue entries. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-LEDG-020` | 420 | Internal-use entries. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-LEDG-021` | 421 | Stock reservation ledger. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-inventory | IMPLEMENTED |
| `PHARM-LEDG-022` | 422 | Stock release ledger. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-inventory | IMPLEMENTED |
| `PHARM-LEDG-023` | 423 | Transaction reference IDs. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-024` | 424 | Transaction idempotency keys. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-025` | 425 | Database transactional integrity. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-026` | 426 | Row-level locking. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-027` | 427 | Optimistic concurrency controls. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-LEDG-028` | 428 | Negative-stock prevention. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-029` | 429 | Duplicate-posting prevention. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-030` | 430 | Backdated-transaction controls. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-031` | 431 | Future-date controls. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-032` | 432 | Transaction reversal. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-033` | 433 | Adjustment instead of deletion. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-034` | 434 | Opening-balance migration. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-035` | 435 | Closing-balance snapshots. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-LEDG-036` | 436 | Inventory reconciliation. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-inventory | IMPLEMENTED |
| `PHARM-LEDG-037` | 437 | Ledger reconstruction. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-inventory | IMPLEMENTED |
| `PHARM-LEDG-038` | 438 | Stock balance verification. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-inventory | IMPLEMENTED |
| `PHARM-LEDG-039` | 439 | Inventory integrity checker. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-inventory | IMPLEMENTED |
| `PHARM-LEDG-040` | 440 | Orphan transaction detection. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-LEDG-041` | 441 | Invalid-batch detection. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-042` | 442 | Broken-transfer detection. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-LEDG-043` | 443 | Cost recalculation utilities. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-044` | 444 | Stock ledger search. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-inventory | IMPLEMENTED |
| `PHARM-LEDG-045` | 445 | Stock ledger filtering. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-inventory | IMPLEMENTED |
| `PHARM-LEDG-046` | 446 | Stock ledger export. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-inventory | IMPLEMENTED |
| `PHARM-LEDG-047` | 447 | Transaction drilldown. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-inventory | IMPLEMENTED |
| `PHARM-LEDG-048` | 448 | Source-document drilldown. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-LEDG-049` | 449 | User-action drilldown. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-inventory | IMPLEMENTED |
| `PHARM-LEDG-050` | 450 | Inventory forensic timeline. | `10-inventory` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ledger.integration, e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-001` | 451 | Full physical counts. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-002` | 452 | Cycle counting. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-003` | 453 | Blind counting. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-COUNT-004` | 454 | Double counting. | `19-stock-counts` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-COUNT-005` | 455 | Random counting. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-006` | 456 | ABC-based counting. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-COUNT-007` | 457 | High-value item counting. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-COUNT-008` | 458 | Controlled-drug counting. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-COUNT-009` | 459 | Near-expiry counting. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-COUNT-010` | 460 | Warehouse counts. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-011` | 461 | Zone counts. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-COUNT-012` | 462 | Rack counts. | `19-stock-counts` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-COUNT-013` | 463 | Shelf counts. | `19-stock-counts` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-COUNT-014` | 464 | Bin counts. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-015` | 465 | Product-category counts. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-016` | 466 | Barcode count mode. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-017` | 467 | Mobile count mode. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-018` | 468 | Offline count capture. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-019` | 469 | Count-sheet generation. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-020` | 470 | Count assignment. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-021` | 471 | Count freeze option. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-COUNT-022` | 472 | Snapshot quantity. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-023` | 473 | Physical quantity. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-024` | 474 | Variance quantity. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-025` | 475 | Variance percentage. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-026` | 476 | Variance value. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-027` | 477 | Tolerance configuration. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-028` | 478 | Variance approval workflow. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-029` | 479 | Large-variance escalation. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-030` | 480 | Recount workflow. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-COUNT-031` | 481 | Count reconciliation. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-032` | 482 | Count posting. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-033` | 483 | Count adjustment ledger. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-034` | 484 | Shrinkage classification. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-COUNT-035` | 485 | Damage classification. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-036` | 486 | Theft-loss classification. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-COUNT-037` | 487 | Unknown-loss classification. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-COUNT-038` | 488 | Misplacement classification. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-COUNT-039` | 489 | Variance root-cause analysis. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-COUNT-040` | 490 | Repeated variance alerts. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-041` | 491 | Inventory accuracy KPI. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-042` | 492 | Shrinkage KPI. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-043` | 493 | Count completion KPI. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-COUNT-044` | 494 | Count productivity metrics. | `19-stock-counts` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-COUNT-045` | 495 | Branch accuracy ranking. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-COUNT-046` | 496 | Warehouse accuracy ranking. | `19-stock-counts` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-COUNT-047` | 497 | Stock-count audit trail. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-048` | 498 | Stock-count report. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-049` | 499 | Variance financial report. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COUNT-050` | 500 | Inventory-loss dashboard. | `19-stock-counts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-XFER-001` | 501 | Transfer requests. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-002` | 502 | Transfer request approval. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-003` | 503 | Automatic transfer recommendation. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-004` | 504 | Expiry-saving transfer recommendation. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-005` | 505 | Stockout-prevention transfer recommendation. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-006` | 506 | Excess-stock transfer recommendation. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-007` | 507 | Source branch selection. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-008` | 508 | Destination branch selection. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-009` | 509 | Batch selection. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-010` | 510 | FEFO transfer picking. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-011` | 511 | Transfer reservation. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-012` | 512 | Transfer pick list. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-013` | 513 | Transfer packing. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-014` | 514 | Transfer dispatch. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-015` | 515 | In-transit status. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-016` | 516 | Partial dispatch. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-017` | 517 | Partial receipt. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-018` | 518 | Transfer receiving. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-019` | 519 | Transfer discrepancy. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-020` | 520 | Transfer rejection. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-XFER-021` | 521 | Transfer cancellation. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-022` | 522 | Transfer return. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-XFER-023` | 523 | Transfer damage reporting. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-024` | 524 | Transfer temperature logging. | `18-transfers` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-XFER-025` | 525 | Cold-chain transfer tracking. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-XFER-026` | 526 | Courier information. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-027` | 527 | Vehicle information. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-028` | 528 | Driver information. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-XFER-029` | 529 | Tracking-number support. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-XFER-030` | 530 | Expected arrival. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-XFER-031` | 531 | Delayed transfer alerts. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-XFER-032` | 532 | Transfer proof of delivery. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-XFER-033` | 533 | Transfer receiving signatures. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-XFER-034` | 534 | Transfer barcode verification. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-035` | 535 | Batch mismatch prevention. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-036` | 536 | Transfer quantity mismatch alerts. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-037` | 537 | Transfer document printing. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-038` | 538 | Transfer labels. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-039` | 539 | Transfer ledger integration. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-040` | 540 | Transfer audit history. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-041` | 541 | Transfer cost allocation. | `18-transfers` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-XFER-042` | 542 | Transfer distance field. | `18-transfers` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-XFER-043` | 543 | Inter-branch replenishment. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-044` | 544 | Hub-and-spoke transfers. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-XFER-045` | 545 | Emergency stock requests. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-XFER-046` | 546 | Branch stock sharing. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-047` | 547 | Cross-branch availability search. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-XFER-048` | 548 | Transfer analytics. | `18-transfers` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-XFER-049` | 549 | Transfer turnaround KPI. | `18-transfers` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-XFER-050` | 550 | Transfer optimization dashboard. | `18-transfers` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-POS-001` | 551 | Fast pharmacy POS. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-002` | 552 | Touch-optimized POS. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-003` | 553 | Barcode product scanning. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-004` | 554 | GS1 scanning at sale. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-005` | 555 | Product-name search. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-006` | 556 | Generic-name search. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-007` | 557 | Brand-name search. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-008` | 558 | Ingredient search. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-POS-009` | 559 | Category search. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-POS-010` | 560 | Batch-aware cart. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-011` | 561 | Automatic FEFO allocation. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-012` | 562 | Prescription-required warning. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-013` | 563 | Controlled-product restrictions. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-014` | 564 | Expiry validation at checkout. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-015` | 565 | Recall validation at checkout. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-016` | 566 | Quarantine validation at checkout. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-017` | 567 | Real-time inventory availability. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-018` | 568 | Multiple payment methods. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-019` | 569 | Cash payments. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-020` | 570 | Card payments. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-POS-021` | 571 | Mobile-money payments. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-POS-022` | 572 | Bank-transfer payments. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-POS-023` | 573 | Split payments. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-024` | 574 | Customer credit. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-025` | 575 | Store credit. | `20-pos` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-POS-026` | 576 | Gift voucher support. | `20-pos` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-POS-027` | 577 | Discount permissions. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-028` | 578 | Maximum discount controls. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-029` | 579 | Promotional discounts. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-030` | 580 | Coupon support. | `20-pos` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-POS-031` | 581 | Tax calculation. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-032` | 582 | Tax-exempt transactions. | `20-pos` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-POS-033` | 583 | Receipt generation. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-034` | 584 | Thermal receipt printing. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-POS-035` | 585 | A4 invoice printing. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-036` | 586 | Email receipts. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-POS-037` | 587 | SMS receipt integration. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-POS-038` | 588 | Hold transaction. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-039` | 589 | Resume transaction. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-040` | 590 | Void transaction authorization. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-041` | 591 | Refund workflow. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-042` | 592 | Return workflow. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-043` | 593 | Cashier shift opening. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-044` | 594 | Cashier shift closing. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-045` | 595 | Cash drawer tracking. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-046` | 596 | Till reconciliation. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-047` | 597 | Cash variance approval. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-048` | 598 | Daily sales summary. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-POS-049` | 599 | Cashier productivity dashboard. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-POS-050` | 600 | POS offline resilience. | `20-pos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-damage-pos, e2e-enterprise | IMPLEMENTED |
| `PHARM-RX-001` | 601 | Prescription registration. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-002` | 602 | Prescription number. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-003` | 603 | Electronic prescription import. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-004` | 604 | Prescription image upload. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-005` | 605 | Prescription PDF upload. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-006` | 606 | Prescriber records. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-RX-007` | 607 | Prescriber license data. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-008` | 608 | Healthcare-facility records. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-RX-009` | 609 | Prescription date. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-010` | 610 | Prescription expiration. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-011` | 611 | Patient linkage. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-012` | 612 | Medication request lines. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-013` | 613 | Strength instructions. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-014` | 614 | Dose instructions. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-015` | 615 | Frequency. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-016` | 616 | Duration. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-017` | 617 | Quantity prescribed. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-018` | 618 | Quantity dispensed. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-019` | 619 | Remaining quantity. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-020` | 620 | Refill allowance. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-021` | 621 | Refill tracking. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-022` | 622 | Partial dispensing. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-023` | 623 | Prescription status lifecycle. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-dispensing | IMPLEMENTED |
| `PHARM-RX-024` | 624 | Pharmacist verification. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-025` | 625 | Prescription rejection reasons. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-026` | 626 | Prescription cancellation. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-027` | 627 | Prescription amendment history. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-RX-028` | 628 | Dispensing queue. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-dispensing | IMPLEMENTED |
| `PHARM-RX-029` | 629 | Dispensing priority. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-dispensing | IMPLEMENTED |
| `PHARM-RX-030` | 630 | FEFO dispensing. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-031` | 631 | Batch scan before dispensing. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | — | e2e-dispensing | PARTIALLY IMPLEMENTED |
| `PHARM-RX-032` | 632 | Product scan verification. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | — | e2e-dispensing | PARTIALLY IMPLEMENTED |
| `PHARM-RX-033` | 633 | Patient verification. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-dispensing | IMPLEMENTED |
| `PHARM-RX-034` | 634 | Quantity verification. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-035` | 635 | Dispensing-label generation. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-dispensing | IMPLEMENTED |
| `PHARM-RX-036` | 636 | Patient-instruction printing. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-dispensing | IMPLEMENTED |
| `PHARM-RX-037` | 637 | Dispensing receipt. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-038` | 638 | Dispensing audit trail. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-039` | 639 | Dispensing reversal workflow. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-dispensing | IMPLEMENTED |
| `PHARM-RX-040` | 640 | Wrong-item prevention. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-dispensing | IMPLEMENTED |
| `PHARM-RX-041` | 641 | Wrong-strength warning. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-RX-042` | 642 | Duplicate-dispense detection. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-043` | 643 | Early-refill warning. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-dispensing | IMPLEMENTED |
| `PHARM-RX-044` | 644 | Maximum-quantity enforcement. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-dispensing | IMPLEMENTED |
| `PHARM-RX-045` | 645 | Prescription attachment retention. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-046` | 646 | Pharmacist notes. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-dispensing | IMPLEMENTED |
| `PHARM-RX-047` | 647 | Dispensing timeline. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-048` | 648 | Prescription search. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RX-049` | 649 | Dispensing analytics. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-dispensing | IMPLEMENTED |
| `PHARM-RX-050` | 650 | Pharmacy workload dashboard. | `21-prescriptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-dispensing | IMPLEMENTED |
| `PHARM-CRM-001` | 651 | Patient profiles. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-002` | 652 | Customer profiles. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-003` | 653 | Unique patient identifiers. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-004` | 654 | Contact details. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-005` | 655 | Date-of-birth records. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-006` | 656 | Configurable demographic fields. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-CRM-007` | 657 | Preferred language. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-008` | 658 | Communication preferences. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-009` | 659 | Emergency contact. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-010` | 660 | Patient consent records. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-011` | 661 | Consent versioning. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-012` | 662 | Consent withdrawal. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-013` | 663 | Patient prescription history. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-014` | 664 | Patient dispensing history. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-015` | 665 | Purchase history. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-016` | 666 | Return history. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-017` | 667 | Loyalty profile. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-018` | 668 | Loyalty points. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-019` | 669 | Loyalty tiers. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-020` | 670 | Customer segmentation. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-021` | 671 | Corporate customers. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-022` | 672 | Institutional customers. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-023` | 673 | Insurance profile. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-024` | 674 | Employer account. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-025` | 675 | Credit-account management. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-026` | 676 | Credit limits. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-027` | 677 | Outstanding balances. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-028` | 678 | Payment history. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-029` | 679 | Patient communication log. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-CRM-030` | 680 | Appointment/reminder integration. | `23-patients` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-CRM-031` | 681 | Refill reminders. | `23-patients` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-CRM-032` | 682 | Pickup notifications. | `23-patients` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-CRM-033` | 683 | Ready-for-collection status. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-dispensing | IMPLEMENTED |
| `PHARM-CRM-034` | 684 | Delivery request. | `23-patients` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-CRM-035` | 685 | Delivery address management. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-CRM-036` | 686 | Customer notes. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-037` | 687 | Restricted-note permissions. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-CRM-038` | 688 | Patient document attachments. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-039` | 689 | Duplicate patient detection. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-CRM-040` | 690 | Patient merge workflow. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-CRM-041` | 691 | Data correction history. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-042` | 692 | Data export controls. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-043` | 693 | Account anonymization workflow. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-CRM-044` | 694 | Retention-policy engine. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | — | e2e-lifecycle | PARTIALLY IMPLEMENTED |
| `PHARM-CRM-045` | 695 | Privacy-access auditing. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CRM-046` | 696 | Patient portal readiness. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-CRM-047` | 697 | Customer satisfaction survey. | `23-patients` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-CRM-048` | 698 | Complaint tracking. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-CRM-049` | 699 | Customer lifetime-value analytics. | `23-patients` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-CRM-050` | 700 | Patient/customer 360-degree view. | `23-patients` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-001` | 701 | Product recall records. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-002` | 702 | Batch recall records. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-003` | 703 | Serial recall records. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-RECALL-004` | 704 | Manufacturer recall notices. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-005` | 705 | Regulatory recall notices. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-006` | 706 | Internal recall notices. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-007` | 707 | Recall severity levels. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-008` | 708 | Recall reason classification. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-009` | 709 | Immediate stock blocking. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-010` | 710 | Recall inventory search. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-011` | 711 | Multi-branch recall search. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-012` | 712 | Historical dispensing search. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-013` | 713 | Historical sales search. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-014` | 714 | Customer notification lists. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-015` | 715 | Recall task generation. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-016` | 716 | Recall recovery tracking. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-017` | 717 | Recall outstanding tracking. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-018` | 718 | Recall return tracking. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-019` | 719 | Recall disposal tracking. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-020` | 720 | Recall completion percentage. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-021` | 721 | Recall effectiveness checks. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-RECALL-022` | 722 | Recall closeout approval. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-023` | 723 | Recall report generation. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-024` | 724 | Customer returns. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-025` | 725 | Supplier returns. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-026` | 726 | Warehouse returns. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-027` | 727 | Branch returns. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-028` | 728 | Return reason codes. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-029` | 729 | Return inspection. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-030` | 730 | Restock approval. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-031` | 731 | Return quarantine. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-032` | 732 | Return destruction. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-033` | 733 | Return supplier credit note. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-034` | 734 | Expired-product disposal. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-035` | 735 | Damaged-product disposal. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-036` | 736 | Recalled-product disposal. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-037` | 737 | Disposal approval. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-038` | 738 | Disposal witness. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-039` | 739 | Disposal vendor tracking. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-RECALL-040` | 740 | Disposal-method records. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-041` | 741 | Disposal certificate. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-042` | 742 | Disposal photos. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-RECALL-043` | 743 | Disposal costs. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-044` | 744 | Environmental-disposal records. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-RECALL-045` | 745 | Disposal audit logs. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-046` | 746 | Recall KPI dashboard. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-RECALL-047` | 747 | Return-rate dashboard. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-048` | 748 | Waste-value dashboard. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-RECALL-049` | 749 | Recall simulation/drill mode. | `25-recalls` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-RECALL-050` | 750 | Recall command center. | `25-recalls` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-001` | 751 | Temperature-sensitive inventory. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-002` | 752 | Product temperature ranges. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-003` | 753 | Product humidity ranges. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-004` | 754 | Refrigeration equipment records. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-COLD-005` | 755 | Freezer equipment records. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-COLD-006` | 756 | Cold-room records. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-COLD-007` | 757 | Temperature sensor registry. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-008` | 758 | Humidity sensor registry. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-COLD-009` | 759 | Sensor calibration history. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-COLD-010` | 760 | Sensor calibration expiration. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-COLD-011` | 761 | IoT gateway support. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-012` | 762 | Sensor API ingestion. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-013` | 763 | Scheduled temperature imports. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-COLD-014` | 764 | Manual temperature entry. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-015` | 765 | Real-time temperature dashboard. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-016` | 766 | Temperature history graph. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-017` | 767 | Humidity history graph. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-COLD-018` | 768 | High-temperature alerts. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-019` | 769 | Low-temperature alerts. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-020` | 770 | Humidity excursion alerts. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-COLD-021` | 771 | Door-open alerts. | `28-cold-chain` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-COLD-022` | 772 | Power-loss alerts. | `28-cold-chain` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-COLD-023` | 773 | Sensor-offline alerts. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-024` | 774 | Refrigerator-failure alerts. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-COLD-025` | 775 | Excursion start detection. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-026` | 776 | Excursion end detection. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-027` | 777 | Excursion-duration calculation. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-028` | 778 | Maximum temperature recording. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-029` | 779 | Minimum temperature recording. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-030` | 780 | Products-at-risk identification. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-031` | 781 | Batches-at-risk identification. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-032` | 782 | Automatic affected-stock quarantine. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-033` | 783 | QA excursion assessment. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-034` | 784 | Excursion investigation. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-035` | 785 | Corrective-action tracking. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-036` | 786 | Release decision. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-037` | 787 | Reject decision. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-038` | 788 | Destruction decision. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-039` | 789 | Cold-chain transfer monitoring. | `28-cold-chain` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-COLD-040` | 790 | Delivery temperature logging. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-COLD-041` | 791 | Temperature-log exports. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-042` | 792 | Calibration reminders. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-COLD-043` | 793 | Maintenance reminders. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-COLD-044` | 794 | Equipment service history. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-COLD-045` | 795 | Backup refrigeration location. | `28-cold-chain` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-COLD-046` | 796 | Cold-chain emergency workflow. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-COLD-047` | 797 | Temperature compliance KPI. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-COLD-048` | 798 | Excursion-frequency KPI. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-COLD-049` | 799 | Cold-chain performance dashboard. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-COLD-050` | 800 | IoT device health dashboard. | `28-cold-chain` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow | IMPLEMENTED |
| `PHARM-CTRL-001` | 801 | Controlled-medicine register. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-002` | 802 | Configurable control schedules. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-003` | 803 | Restricted permissions. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-004` | 804 | Dual authorization. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-005` | 805 | Secure storage location controls. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-006` | 806 | Controlled stock receiving. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-007` | 807 | Controlled stock dispensing. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-008` | 808 | Controlled stock transfer. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-CTRL-009` | 809 | Controlled stock returns. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-010` | 810 | Controlled stock destruction. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-011` | 811 | Prescription-reference requirement. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-012` | 812 | Prescriber-reference requirement. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-013` | 813 | Patient-reference requirement. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-014` | 814 | Running controlled balance. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-015` | 815 | Controlled batch tracking. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-016` | 816 | Controlled serial tracking. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-CTRL-017` | 817 | Daily reconciliation. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-018` | 818 | Shift reconciliation. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-CTRL-019` | 819 | Physical controlled count. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-CTRL-020` | 820 | Variance alerts. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-021` | 821 | Zero-tolerance variance option. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-022` | 822 | Variance investigation. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-023` | 823 | Supervisor escalation. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-024` | 824 | Immutable controlled ledger. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-025` | 825 | Correction-by-reversal only. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-026` | 826 | No silent deletion. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-027` | 827 | Controlled register printout. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-028` | 828 | Controlled register export restrictions. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-029` | 829 | Controlled access logs. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-030` | 830 | Suspicious transaction alerts. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-CTRL-031` | 831 | Excess-quantity alerts. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-dispensing | IMPLEMENTED |
| `PHARM-CTRL-032` | 832 | Unusual-frequency alerts. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-CTRL-033` | 833 | Repeated-void alerts. | `27-controlled-drugs` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-CTRL-034` | 834 | After-hours access alerts. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-CTRL-035` | 835 | Controlled stockout alert. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-036` | 836 | Controlled expiry tracking. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-037` | 837 | Controlled waste tracking. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-038` | 838 | Witnessed destruction. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-039` | 839 | Witness digital signatures. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-CTRL-040` | 840 | Compliance document management. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-041` | 841 | License-expiry reminders. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-042` | 842 | Inspection readiness dashboard. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-CTRL-043` | 843 | Compliance checklist. | `27-controlled-drugs` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-CTRL-044` | 844 | Compliance incident reporting. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-045` | 845 | Corrective actions. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-046` | 846 | Preventive actions. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-047` | 847 | Compliance audit calendar. | `27-controlled-drugs` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-CTRL-048` | 848 | Configurable jurisdiction rules. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa | IMPLEMENTED |
| `PHARM-CTRL-049` | 849 | Compliance KPI dashboard. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-CTRL-050` | 850 | Controlled-drug command center. | `27-controlled-drugs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-workflow, e2e-capa (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-ANLY-001` | 851 | Executive dashboard. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-002` | 852 | Inventory value dashboard. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-003` | 853 | Inventory quantity dashboard. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-004` | 854 | Sales dashboard. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-005` | 855 | Gross-profit dashboard. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-006` | 856 | Purchase dashboard. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-007` | 857 | Expiry dashboard. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-008` | 858 | Stockout dashboard. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-009` | 859 | Low-stock dashboard. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-010` | 860 | Dead-stock dashboard. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-011` | 861 | Slow-moving inventory. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-012` | 862 | Fast-moving inventory. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-013` | 863 | ABC analysis. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-014` | 864 | XYZ analysis. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-015` | 865 | ABC-XYZ matrix. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-016` | 866 | Inventory-turnover calculation. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-017` | 867 | Days inventory outstanding. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-018` | 868 | Days-of-cover calculation. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-019` | 869 | Fill-rate calculation. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-020` | 870 | Service-level calculation. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-ANLY-021` | 871 | Stockout-rate calculation. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-022` | 872 | Inventory-accuracy calculation. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-023` | 873 | Shrinkage calculation. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-024` | 874 | Expiry-rate calculation. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-025` | 875 | Waste-rate calculation. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-ANLY-026` | 876 | Gross-margin calculation. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-027` | 877 | Supplier KPI analytics. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-028` | 878 | Branch KPI analytics. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-029` | 879 | Warehouse KPI analytics. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-030` | 880 | Pharmacist productivity analytics. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-dispensing | IMPLEMENTED |
| `PHARM-ANLY-031` | 881 | Cashier productivity analytics. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-ANLY-032` | 882 | Demand forecasting. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-033` | 883 | Moving-average forecast. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-034` | 884 | Weighted-moving-average forecast. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-035` | 885 | Exponential-smoothing forecast. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-036` | 886 | Seasonal forecast support. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-037` | 887 | Forecast accuracy calculation. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-ANLY-038` | 888 | Forecast-versus-actual report. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-ANLY-039` | 889 | Reorder recommendations. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-040` | 890 | Excess-stock prediction. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-041` | 891 | Stockout prediction. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-042` | 892 | Expiry-risk prediction. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-043` | 893 | Branch redistribution recommendations. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-044` | 894 | Natural-language analytics assistant. | `31-analytics` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-ANLY-045` | 895 | "Ask inventory" interface. | `31-analytics` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-ANLY-046` | 896 | AI explanation of recommendations. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-047` | 897 | No autonomous high-risk approval. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-048` | 898 | Dashboard drill-down everywhere. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-ANLY-049` | 899 | Scheduled report delivery. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-ANLY-050` | 900 | Custom report builder. | `31-analytics` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | intelligence.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-SEC-001` | 901 | Secure authentication. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-002` | 902 | Role-based access control. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-003` | 903 | Custom roles. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-004` | 904 | Fine-grained permissions. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-005` | 905 | Branch-level permissions. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-006` | 906 | Warehouse-level permissions. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-007` | 907 | Product-category permissions. | `42-security` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-SEC-008` | 908 | Financial-data permissions. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-009` | 909 | Patient-data permissions. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-010` | 910 | Controlled-drug permissions. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-011` | 911 | Approval-level permissions. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-012` | 912 | Multi-factor authentication. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-013` | 913 | Session management. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-014` | 914 | Device session list. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-015` | 915 | Forced logout. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-016` | 916 | Password policies. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-017` | 917 | Login lockout. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-018` | 918 | Rate limiting. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-019` | 919 | Brute-force protection. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-020` | 920 | HTTPS enforcement. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-SEC-021` | 921 | Secure cookies. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-SEC-022` | 922 | CSRF protection. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-023` | 923 | XSS protection. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-024` | 924 | SQL-injection defenses. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-025` | 925 | Input validation. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-026` | 926 | Output encoding. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-027` | 927 | Secrets management. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-028` | 928 | Encryption-at-rest readiness. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-SEC-029` | 929 | Sensitive-field encryption. | `42-security` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-SEC-030` | 930 | Encrypted backups. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-031` | 931 | Audit trail. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-032` | 932 | Old-value tracking. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-033` | 933 | New-value tracking. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-034` | 934 | User tracking. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-035` | 935 | Timestamp tracking. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-036` | 936 | IP/device metadata where lawful. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-037` | 937 | Authentication audit logs. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-038` | 938 | Permission-change auditing. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-039` | 939 | Price-change auditing. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-040` | 940 | Stock-adjustment auditing. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-041` | 941 | Approval auditing. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-042` | 942 | Audit-log tamper resistance. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-043` | 943 | Security-alert dashboard. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-SEC-044` | 944 | Suspicious-login detection. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-SEC-045` | 945 | Data retention policies. | `42-security` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-SEC-046` | 946 | Automatic backups. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-047` | 947 | Backup verification. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-048` | 948 | Restore testing. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-SEC-049` | 949 | Disaster-recovery configuration. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-SEC-050` | 950 | System-health dashboard. | `42-security` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-enterprise, e2e-capa | IMPLEMENTED |
| `PHARM-PLAT-001` | 951 | REST API. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-002` | 952 | OpenAPI documentation. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-003` | 953 | API versioning. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | e2e-lifecycle | IMPLEMENTED |
| `PHARM-PLAT-004` | 954 | API authentication. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-005` | 955 | API authorization. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-006` | 956 | API rate limiting. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-007` | 957 | API audit logging. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-PLAT-008` | 958 | Webhook framework. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-009` | 959 | Outbound webhooks. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-010` | 960 | Inbound integration endpoints. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-PLAT-011` | 961 | HL7 FHIR interoperability layer. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-012` | 962 | FHIR MedicationRequest mapping. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-013` | 963 | FHIR MedicationDispense mapping. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-014` | 964 | FHIR Medication mapping. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-015` | 965 | FHIR Patient mapping. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-016` | 966 | FHIR Practitioner mapping. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-017` | 967 | FHIR Organization mapping. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-018` | 968 | EHR integration readiness. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-019` | 969 | Hospital-system integration. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-020` | 970 | ERP integration. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-PLAT-021` | 971 | Accounting integration. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-022` | 972 | Payment gateway adapters. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-PLAT-023` | 973 | SMS gateway adapters. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-024` | 974 | Email integration. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-025` | 975 | WhatsApp integration adapter. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-026` | 976 | Telegram integration adapter. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-027` | 977 | Barcode-scanner integration. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-028` | 978 | Receipt-printer integration. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-PLAT-029` | 979 | Label-printer integration. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-030` | 980 | IoT integration adapters. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-031` | 981 | Responsive desktop interface. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-032` | 982 | Tablet-optimized interface. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-033` | 983 | Mobile warehouse interface. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-034` | 984 | Progressive Web App. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-035` | 985 | Offline data queue. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-036` | 986 | Conflict resolution. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-037` | 987 | Synchronization status. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-038` | 988 | Background sync. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-PLAT-039` | 989 | Global search. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-040` | 990 | Typo-tolerant search. | `35-integrations` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-PLAT-041` | 991 | Saved filters. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | — | e2e-lifecycle | PARTIALLY IMPLEMENTED |
| `PHARM-PLAT-042` | 992 | Saved views. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-PLAT-043` | 993 | Configurable dashboards. | `35-integrations` | — | — | — | — | — | — | — | NOT IMPLEMENTED |
| `PHARM-PLAT-044` | 994 | Notification rule engine. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-045` | 995 | Workflow rule engine. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-046` | 996 | Approval rule engine. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-047` | 997 | Background job processing. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-048` | 998 | Internationalization architecture. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
| `PHARM-PLAT-049` | 999 | English/Amharic/Afaan Oromo readiness. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise (partial) | PARTIALLY IMPLEMENTED |
| `PHARM-PLAT-050` | 1000 | Enterprise feature-flag system. | `35-integrations` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | fhir.spec, automation.spec, import.spec, e2e-enterprise | IMPLEMENTED |
