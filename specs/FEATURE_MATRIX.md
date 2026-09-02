# Feature Matrix

Every one of the 1,000 features in the master specification, with a stable
requirement ID and its implementation status. Nothing is dropped: a feature that
is not built appears here as NOT IMPLEMENTED with the reason, rather than being
quietly absent.

Status values:

| Status | Meaning |
| --- | --- |
| IMPLEMENTED | Built, reachable through the API and the interface, and covered by the evidence named. |
| PARTIALLY IMPLEMENTED | Works, but narrower than the feature asks. The gap is stated. |
| NOT IMPLEMENTED | Not built. The reason is stated in TRACEABILITY_MATRIX.md. |
| EXTERNAL DEPENDENCY | Interface and adapter exist; the live connection needs credentials. See KNOWN_EXTERNAL_DEPENDENCIES.md. |

## Totals

- IMPLEMENTED: **742**
- PARTIALLY IMPLEMENTED: **147**
- NOT IMPLEMENTED: **111**
- Weighted (partial counts a half): **816 / 1000**

## Pack 1 — PRODUCT MASTER

45 implemented, 5 partial, 0 not implemented. Specification: `specs/06-products/`.

| Requirement | # | Feature | Status | Evidence |
| --- | ---: | --- | --- | --- |
| `PHARM-PROD-001` | 1 | Unlimited pharmaceutical product records. | IMPLEMENTED | Product model, unbounded rows |
| `PHARM-PROD-002` | 2 | Generic medicine names. | IMPLEMENTED | Product.genericName |
| `PHARM-PROD-003` | 3 | Trade/brand names. | IMPLEMENTED | Product.brandName |
| `PHARM-PROD-004` | 4 | Multiple active ingredients. | IMPLEMENTED | ProductIngredient (many per product) |
| `PHARM-PROD-005` | 5 | Combination-drug support. | IMPLEMENTED | ProductIngredient with sequence/role |
| `PHARM-PROD-006` | 6 | Ingredient strength records. | IMPLEMENTED | ProductIngredient.strengthValue+strengthUnit |
| `PHARM-PROD-007` | 7 | Multiple dosage strengths. | IMPLEMENTED | Product.strength + per-ingredient strengths |
| `PHARM-PROD-008` | 8 | Dosage-form classification. | IMPLEMENTED | Product.dosageForm |
| `PHARM-PROD-009` | 9 | Route-of-administration classification. | IMPLEMENTED | Product.routeOfAdmin |
| `PHARM-PROD-010` | 10 | Therapeutic-class classification. | IMPLEMENTED | Product.therapeuticClass |
| `PHARM-PROD-011` | 11 | ATC-code support. | IMPLEMENTED | Product.atcCode |
| `PHARM-PROD-012` | 12 | Manufacturer records. | IMPLEMENTED | Manufacturer model |
| `PHARM-PROD-013` | 13 | Marketing-authorization-holder records. | IMPLEMENTED | Product.marketingAuthHolder |
| `PHARM-PROD-014` | 14 | Country-of-origin records. | IMPLEMENTED | Product.countryOfOrigin + Manufacturer.country |
| `PHARM-PROD-015` | 15 | Regulatory-registration-number field. | IMPLEMENTED | Product.registrationNumber |
| `PHARM-PROD-016` | 16 | Product-registration expiration tracking. | IMPLEMENTED | Product.registrationExpiry |
| `PHARM-PROD-017` | 17 | Multiple product images. | IMPLEMENTED | Document entityType=PRODUCT, first image becomes imageUrl |
| `PHARM-PROD-018` | 18 | Package insert attachment. | PARTIALLY IMPLEMENTED | attachable as a PRODUCT document but not typed as a package insert |
| `PHARM-PROD-019` | 19 | Patient-information-leaflet attachment. | PARTIALLY IMPLEMENTED | attachable but not typed as a patient leaflet |
| `PHARM-PROD-020` | 20 | Safety-data-sheet attachment. | PARTIALLY IMPLEMENTED | attachable but not typed as an SDS |
| `PHARM-PROD-021` | 21 | Multiple SKUs. | IMPLEMENTED | Product.sku unique + ProductBarcode per unit |
| `PHARM-PROD-022` | 22 | Internal item codes. | IMPLEMENTED | Product.sku |
| `PHARM-PROD-023` | 23 | GTIN support. | IMPLEMENTED | Product.gtin |
| `PHARM-PROD-024` | 24 | EAN support. | IMPLEMENTED | ProductBarcode symbology EAN13 |
| `PHARM-PROD-025` | 25 | UPC support. | IMPLEMENTED | ProductBarcode symbology UPC |
| `PHARM-PROD-026` | 26 | Code-128 support. | IMPLEMENTED | ProductBarcode symbology CODE128 |
| `PHARM-PROD-027` | 27 | GS1 DataMatrix support. | PARTIALLY IMPLEMENTED | GS1 DataMatrix parsed and scanned (shared/gs1.ts); rendering not implemented |
| `PHARM-PROD-028` | 28 | Multiple barcodes per product. | IMPLEMENTED | ProductBarcode many per product |
| `PHARM-PROD-029` | 29 | Barcode alias mapping. | IMPLEMENTED | ProductBarcode.unitCode maps a barcode to a pack level |
| `PHARM-PROD-030` | 30 | Product-family relationships. | IMPLEMENTED | ProductRelation FAMILY |
| `PHARM-PROD-031` | 31 | Product variant relationships. | IMPLEMENTED | ProductRelation VARIANT |
| `PHARM-PROD-032` | 32 | Alternative-brand relationships. | IMPLEMENTED | ProductRelation ALTERNATIVE_BRAND |
| `PHARM-PROD-033` | 33 | Generic-equivalent relationships. | IMPLEMENTED | ProductRelation GENERIC_EQUIVALENT |
| `PHARM-PROD-034` | 34 | Substitute-product relationships. | IMPLEMENTED | ProductRelation SUBSTITUTE |
| `PHARM-PROD-035` | 35 | Pack-size configuration. | IMPLEMENTED | Product.packSize + ProductUnit ladder |
| `PHARM-PROD-036` | 36 | Carton configuration. | IMPLEMENTED | ProductUnit code CARTON |
| `PHARM-PROD-037` | 37 | Box configuration. | IMPLEMENTED | ProductUnit code BOX |
| `PHARM-PROD-038` | 38 | Strip configuration. | IMPLEMENTED | ProductUnit code STRIP |
| `PHARM-PROD-039` | 39 | Blister configuration. | IMPLEMENTED | ProductUnit code BLISTER |
| `PHARM-PROD-040` | 40 | Tablet/capsule base units. | IMPLEMENTED | Product.baseUnit TABLET/CAPSULE |
| `PHARM-PROD-041` | 41 | Liquid-volume units. | IMPLEMENTED | ProductUnit factorToBase for volume, shared/units.ts |
| `PHARM-PROD-042` | 42 | Weight units. | IMPLEMENTED | ProductUnit factorToBase for weight |
| `PHARM-PROD-043` | 43 | Injectable-unit configuration. | IMPLEMENTED | ProductUnit configurable per product (vial/ampoule) |
| `PHARM-PROD-044` | 44 | Vaccine-dose configuration. | IMPLEMENTED | ProductUnit configurable per product (dose) |
| `PHARM-PROD-045` | 45 | Medical-device compatibility. | PARTIALLY IMPLEMENTED | expressible only as a custom attribute; no dedicated device-compatibility model |
| `PHARM-PROD-046` | 46 | Active/inactive product status. | IMPLEMENTED | Product.isActive |
| `PHARM-PROD-047` | 47 | Product discontinuation dates. | IMPLEMENTED | Product.discontinuedDate |
| `PHARM-PROD-048` | 48 | Product launch dates. | IMPLEMENTED | Product.launchDate |
| `PHARM-PROD-049` | 49 | Custom product attributes. | IMPLEMENTED | AttributeDefinition + ProductAttribute |
| `PHARM-PROD-050` | 50 | Product change-history timeline. | IMPLEMENTED | TimelineService PRODUCT, built from audit + price history + ledger |

## Pack 2 — ADVANCED PRODUCT INTELLIGENCE

49 implemented, 0 partial, 1 not implemented. Specification: `specs/06-products/`.

| Requirement | # | Feature | Status | Evidence |
| --- | ---: | --- | --- | --- |
| `PHARM-PRODX-001` | 51 | High-alert medicine flag. | IMPLEMENTED | Product.isHighAlert |
| `PHARM-PRODX-002` | 52 | Look-alike/sound-alike flag. | IMPLEMENTED | Product.isLookAlikeSoundAlike |
| `PHARM-PRODX-003` | 53 | Cold-chain product flag. | IMPLEMENTED | Product.isColdChain |
| `PHARM-PRODX-004` | 54 | Controlled-drug flag. | IMPLEMENTED | Product.isControlled |
| `PHARM-PRODX-005` | 55 | Narcotic classification support. | IMPLEMENTED | Product.isNarcotic + controlledSchedule |
| `PHARM-PRODX-006` | 56 | Hazardous-drug flag. | IMPLEMENTED | Product.isHazardous |
| `PHARM-PRODX-007` | 57 | Cytotoxic-product flag. | IMPLEMENTED | Product.isCytotoxic |
| `PHARM-PRODX-008` | 58 | Refrigerated-product flag. | IMPLEMENTED | Product.isRefrigerated |
| `PHARM-PRODX-009` | 59 | Frozen-product flag. | IMPLEMENTED | Product.isFrozen |
| `PHARM-PRODX-010` | 60 | Light-sensitive-product flag. | IMPLEMENTED | Product.lightSensitive |
| `PHARM-PRODX-011` | 61 | Humidity-sensitive-product flag. | IMPLEMENTED | Product.humidityRestricted |
| `PHARM-PRODX-012` | 62 | Fragile-product flag. | IMPLEMENTED | Product.isFragile |
| `PHARM-PRODX-013` | 63 | Flammable-product flag. | IMPLEMENTED | Product.isFlammable |
| `PHARM-PRODX-014` | 64 | Prescription-only classification. | IMPLEMENTED | Product.requiresPrescription + saleClassification POM |
| `PHARM-PRODX-015` | 65 | OTC classification. | IMPLEMENTED | saleClassification OTC |
| `PHARM-PRODX-016` | 66 | Pharmacy-only classification. | IMPLEMENTED | saleClassification PHARMACY_ONLY |
| `PHARM-PRODX-017` | 67 | Hospital-use classification. | IMPLEMENTED | saleClassification HOSPITAL_ONLY |
| `PHARM-PRODX-018` | 68 | Veterinary-product classification. | IMPLEMENTED | Product.isVeterinary |
| `PHARM-PRODX-019` | 69 | Pediatric-product classification. | IMPLEMENTED | Product.isPediatric |
| `PHARM-PRODX-020` | 70 | Pregnancy-information metadata. | IMPLEMENTED | Product.pregnancyInfo + lactationInfo, free text from approved info only |
| `PHARM-PRODX-021` | 71 | Storage-temperature requirements. | IMPLEMENTED | Product.minTempC/maxTempC/storageCondition |
| `PHARM-PRODX-022` | 72 | Storage-humidity requirements. | IMPLEMENTED | Product.minHumidityPercent/maxHumidityPercent |
| `PHARM-PRODX-023` | 73 | Maximum excursion duration. | IMPLEMENTED | Product.maxExcursionMinutes |
| `PHARM-PRODX-024` | 74 | Minimum remaining shelf-life rule. | IMPLEMENTED | Product.minShelfLifeDaysOnReceipt, enforced at goods receipt |
| `PHARM-PRODX-025` | 75 | Standard supplier lead time. | IMPLEMENTED | Product.leadTimeDays + SupplierProduct.leadTimeDays |
| `PHARM-PRODX-026` | 76 | Product minimum stock. | IMPLEMENTED | Product.reorderLevel and safetyStock are the minimum-stock thresholds |
| `PHARM-PRODX-027` | 77 | Product maximum stock. | IMPLEMENTED | Product.maximumStock |
| `PHARM-PRODX-028` | 78 | Safety-stock configuration. | IMPLEMENTED | Product.safetyStock |
| `PHARM-PRODX-029` | 79 | Reorder-point configuration. | IMPLEMENTED | Product.reorderLevel |
| `PHARM-PRODX-030` | 80 | Economic-order-quantity field. | IMPLEMENTED | Product.economicOrderQty |
| `PHARM-PRODX-031` | 81 | Seasonal-demand profile. | IMPLEMENTED | Product.seasonalProfile, read by the forecasting service |
| `PHARM-PRODX-032` | 82 | Preferred supplier mapping. | IMPLEMENTED | Product.preferredSupplierId + SupplierProduct.isPreferred |
| `PHARM-PRODX-033` | 83 | Secondary supplier mapping. | IMPLEMENTED | Product.secondarySupplierId |
| `PHARM-PRODX-034` | 84 | Procurement restriction settings. | IMPLEMENTED | Product.procurementRestricted |
| `PHARM-PRODX-035` | 85 | Minimum purchase quantity. | IMPLEMENTED | Product.minPurchaseQty + SupplierProduct.moq |
| `PHARM-PRODX-036` | 86 | Purchase-order multiples. | IMPLEMENTED | Product.purchaseMultiple |
| `PHARM-PRODX-037` | 87 | Minimum sales quantity. | IMPLEMENTED | Product.minSaleQty |
| `PHARM-PRODX-038` | 88 | Maximum dispensing quantity. | IMPLEMENTED | Product.maxDispenseQty |
| `PHARM-PRODX-039` | 89 | Product profit-margin targets. | IMPLEMENTED | Product.targetMarginPct |
| `PHARM-PRODX-040` | 90 | Category-specific markup. | NOT IMPLEMENTED | no markup field on ProductCategory and no category rule in PricingService |
| `PHARM-PRODX-041` | 91 | Branch-specific pricing. | IMPLEMENTED | PriceList.branchId |
| `PHARM-PRODX-042` | 92 | Customer-group pricing. | IMPLEMENTED | PriceList.customerGroupId + CustomerGroup.discountPercent |
| `PHARM-PRODX-043` | 93 | Contract pricing. | IMPLEMENTED | PriceList.listType CONTRACT |
| `PHARM-PRODX-044` | 94 | Promotional pricing. | IMPLEMENTED | PriceList.listType PROMOTIONAL |
| `PHARM-PRODX-045` | 95 | Wholesale pricing. | IMPLEMENTED | Product.wholesalePrice + listType WHOLESALE |
| `PHARM-PRODX-046` | 96 | Retail pricing. | IMPLEMENTED | Product.retailPrice + listType RETAIL |
| `PHARM-PRODX-047` | 97 | Insurance pricing. | IMPLEMENTED | Product.insurancePrice + listType INSURANCE |
| `PHARM-PRODX-048` | 98 | Price-effective-date tracking. | IMPLEMENTED | PriceList.effectiveFrom + PriceListItem.effectiveFrom |
| `PHARM-PRODX-049` | 99 | Price-expiration-date tracking. | IMPLEMENTED | PriceList.effectiveTo + PriceListItem.effectiveTo |
| `PHARM-PRODX-050` | 100 | Complete price-change history. | IMPLEMENTED | PriceHistory model, written on every price change |

## Pack 3 — BATCH & SERIALIZATION

32 implemented, 12 partial, 6 not implemented. Specification: `specs/08-batches/`.

| Requirement | # | Feature | Status | Evidence |
| --- | ---: | --- | --- | --- |
| `PHARM-BATCH-001` | 101 | Mandatory batch tracking where configured. | PARTIALLY IMPLEMENTED | every movement is batch-tracked; there is no per-product opt-out flag, so tracking is unconditional rather than configurable |
| `PHARM-BATCH-002` | 102 | Lot-number tracking. | IMPLEMENTED | Batch.lotNumber |
| `PHARM-BATCH-003` | 103 | Manufacturing-date tracking. | IMPLEMENTED | Batch.manufacturingDate |
| `PHARM-BATCH-004` | 104 | Expiration-date tracking. | IMPLEMENTED | Batch.expiryDate |
| `PHARM-BATCH-005` | 105 | Received-date tracking. | IMPLEMENTED | Batch.receivedDate |
| `PHARM-BATCH-006` | 106 | Batch supplier tracking. | IMPLEMENTED | Batch.supplierId |
| `PHARM-BATCH-007` | 107 | Batch manufacturer tracking. | IMPLEMENTED | Batch.manufacturerName |
| `PHARM-BATCH-008` | 108 | Batch purchase-price tracking. | IMPLEMENTED | Batch.purchaseCost per base unit |
| `PHARM-BATCH-009` | 109 | Batch landed-cost tracking. | PARTIALLY IMPLEMENTED | landed cost is computed in quotation comparison; it is not carried onto the Batch |
| `PHARM-BATCH-010` | 110 | Batch warehouse tracking. | IMPLEMENTED | InventoryBalance.warehouseId per batch |
| `PHARM-BATCH-011` | 111 | Batch bin tracking. | IMPLEMENTED | InventoryBalance.locationId per batch |
| `PHARM-BATCH-012` | 112 | Batch quantity tracking. | IMPLEMENTED | Batch.receivedQuantity + InventoryBalance.onHand |
| `PHARM-BATCH-013` | 113 | Batch reserved quantity. | IMPLEMENTED | InventoryBalance.reserved |
| `PHARM-BATCH-014` | 114 | Batch available quantity. | IMPLEMENTED | onHand minus reserved, exposed as available |
| `PHARM-BATCH-015` | 115 | Batch damaged quantity. | PARTIALLY IMPLEMENTED | derivable from DAMAGE ledger rows; no per-batch damaged-quantity field or report |
| `PHARM-BATCH-016` | 116 | Batch quarantine quantity. | IMPLEMENTED | BatchStatus QUARANTINED with quarantineReason |
| `PHARM-BATCH-017` | 117 | Batch recalled quantity. | IMPLEMENTED | RecallBatch link + BatchStatus RECALLED |
| `PHARM-BATCH-018` | 118 | Batch disposal quantity. | PARTIALLY IMPLEMENTED | derivable from DISPOSAL ledger rows; no per-batch disposed-quantity field |
| `PHARM-BATCH-019` | 119 | Batch return quantity. | PARTIALLY IMPLEMENTED | derivable from RETURN_IN/RETURN_OUT ledger rows; no per-batch return-quantity field |
| `PHARM-BATCH-020` | 120 | Batch quality status. | IMPLEMENTED | BatchStatus + qualityNotes |
| `PHARM-BATCH-021` | 121 | Batch certificate-of-analysis attachment. | IMPLEMENTED | Document entityType BATCH |
| `PHARM-BATCH-022` | 122 | Batch regulatory-document attachment. | IMPLEMENTED | Document entityType BATCH |
| `PHARM-BATCH-023` | 123 | Batch quality-release workflow. | IMPLEMENTED | batches/:id/release with releasedById and an investigation note |
| `PHARM-BATCH-024` | 124 | Batch quarantine workflow. | IMPLEMENTED | batches/:id/quarantine with QuarantineReason |
| `PHARM-BATCH-025` | 125 | Batch rejection workflow. | IMPLEMENTED | BatchStatus REJECTED via changeStatus transition rules |
| `PHARM-BATCH-026` | 126 | Batch blocking. | IMPLEMENTED | batches/:id/block |
| `PHARM-BATCH-027` | 127 | Batch unblocking authorization. | IMPLEMENTED | unblock requires inventory.batch.RELEASE and records the actor |
| `PHARM-BATCH-028` | 128 | Batch genealogy. | IMPLEMENTED | Batch.parentBatchId + childBatches |
| `PHARM-BATCH-029` | 129 | Batch movement timeline. | IMPLEMENTED | Batch.transactions + TimelineService BATCH |
| `PHARM-BATCH-030` | 130 | Batch inventory valuation. | IMPLEMENTED | CostLayer.batchId carries cost per batch |
| `PHARM-BATCH-031` | 131 | Batch expiry risk score. | IMPLEMENTED | shared/expiry.ts expiryRiskScore, used by the redistribution engine |
| `PHARM-BATCH-032` | 132 | Batch consumption velocity. | PARTIALLY IMPLEMENTED | consumption velocity is computed per product, not per batch |
| `PHARM-BATCH-033` | 133 | Batch days-of-cover calculation. | PARTIALLY IMPLEMENTED | daysOfCover is computed per product in the STOCK_LEVEL trigger, not per batch |
| `PHARM-BATCH-034` | 134 | Batch-level profitability. | PARTIALLY IMPLEMENTED | SaleItem carries batchId, unitCost and unitPrice so it is derivable; no batch profitability report |
| `PHARM-BATCH-035` | 135 | Batch recall history. | IMPLEMENTED | Batch.recallLinks |
| `PHARM-BATCH-036` | 136 | Unique serial-number tracking. | IMPLEMENTED | SerialNumber model, unique per batch |
| `PHARM-BATCH-037` | 137 | Serial-to-batch relationship. | IMPLEMENTED | SerialNumber.batchId |
| `PHARM-BATCH-038` | 138 | Serial-to-GTIN relationship. | IMPLEMENTED | serial resolves to batch to product GTIN via the scan endpoint |
| `PHARM-BATCH-039` | 139 | Serial receiving. | IMPLEMENTED | receiving accepts serials[] per line |
| `PHARM-BATCH-040` | 140 | Serial dispensing. | NOT IMPLEMENTED | dispensing does not mark a serial DISPENSED |
| `PHARM-BATCH-041` | 141 | Serial transferring. | NOT IMPLEMENTED | transfers do not move serial ownership |
| `PHARM-BATCH-042` | 142 | Serial returning. | NOT IMPLEMENTED | returns do not update serial status |
| `PHARM-BATCH-043` | 143 | Duplicate-serial detection. | PARTIALLY IMPLEMENTED | unique(batchId, serial) blocks duplicates within a batch; the same serial can exist under two batches |
| `PHARM-BATCH-044` | 144 | Invalid-serial alerts. | PARTIALLY IMPLEMENTED | the scan endpoint warns when a serial is not IN_STOCK; there is no unknown-serial alert flow |
| `PHARM-BATCH-045` | 145 | Serial status history. | NOT IMPLEMENTED | SerialNumber has a status field but no history rows |
| `PHARM-BATCH-046` | 146 | Serialization API. | PARTIALLY IMPLEMENTED | serials are readable through scan and search; there is no dedicated serialization API |
| `PHARM-BATCH-047` | 147 | Mass serial import. | NOT IMPLEMENTED | no serial import path |
| `PHARM-BATCH-048` | 148 | Serialized product lookup. | IMPLEMENTED | global search and the scan endpoint both resolve a serial |
| `PHARM-BATCH-049` | 149 | Serial-level audit trail. | NOT IMPLEMENTED | serial changes are not written to the audit log |
| `PHARM-BATCH-050` | 150 | Serialized recall search. | PARTIALLY IMPLEMENTED | recall trace works from batch to patient; it does not search by serial |

## Pack 4 — EXPIRY & FEFO ENGINE

38 implemented, 2 partial, 10 not implemented. Specification: `specs/11-fefo/`.

| Requirement | # | Feature | Status | Evidence |
| --- | ---: | --- | --- | --- |
| `PHARM-FEFO-001` | 151 | Automatic FEFO picking. | IMPLEMENTED | shared/fefo.ts allocateFefo, used by POS, dispensing, transfers and picking |
| `PHARM-FEFO-002` | 152 | Configurable FIFO fallback. | IMPLEMENTED | sortFefo breaks an equal-expiry tie by receipt order, FIFO or LIFO, from inventory.pickStrategy |
| `PHARM-FEFO-003` | 153 | FEFO batch recommendation. | IMPLEMENTED | SaleItem.fefoRecommendedBatchId records what FEFO would have chosen |
| `PHARM-FEFO-004` | 154 | Manual FEFO override permission. | IMPLEMENTED | override needs inventory.batch.EDIT |
| `PHARM-FEFO-005` | 155 | FEFO override reason requirement. | IMPLEMENTED | overrideReason is required on an override |
| `PHARM-FEFO-006` | 156 | FEFO override auditing. | IMPLEMENTED | the override and the batch FEFO recommended are both stored and audited |
| `PHARM-FEFO-007` | 157 | Expired-batch blocking. | IMPLEMENTED | allocateFefo excludes EXPIRED and the ledger refuses the movement |
| `PHARM-FEFO-008` | 158 | Near-expiry detection. | IMPLEMENTED | expiryReport with a configurable horizon |
| `PHARM-FEFO-009` | 159 | 7-day expiry bucket. | IMPLEMENTED | the bucket ladder is built from expiry.alertBuckets, so a 7-day bucket exists when configured |
| `PHARM-FEFO-010` | 160 | 14-day expiry bucket. | IMPLEMENTED | as above for 14 days |
| `PHARM-FEFO-011` | 161 | 30-day expiry bucket. | IMPLEMENTED | bucket DAYS_0_30 |
| `PHARM-FEFO-012` | 162 | 60-day expiry bucket. | IMPLEMENTED | bucket DAYS_31_60 |
| `PHARM-FEFO-013` | 163 | 90-day expiry bucket. | IMPLEMENTED | bucket DAYS_61_90 |
| `PHARM-FEFO-014` | 164 | 180-day expiry bucket. | IMPLEMENTED | bucket DAYS_91_180 |
| `PHARM-FEFO-015` | 165 | 365-day expiry bucket. | IMPLEMENTED | bucket DAYS_181_365 |
| `PHARM-FEFO-016` | 166 | Custom expiry buckets. | IMPLEMENTED | expiry.alertBuckets drives the report ladder, proven by an end-to-end check |
| `PHARM-FEFO-017` | 167 | Expiry countdown display. | IMPLEMENTED | ExpiryPill shows the day countdown on every at-risk row |
| `PHARM-FEFO-018` | 168 | Expiry calendar. | NOT IMPLEMENTED | no expiry calendar view |
| `PHARM-FEFO-019` | 169 | Expiry heat map. | NOT IMPLEMENTED | no expiry heat map |
| `PHARM-FEFO-020` | 170 | Expiry financial-risk calculation. | IMPLEMENTED | potentialLoss per row and totalValueAtRisk |
| `PHARM-FEFO-021` | 171 | Expiry quantity-risk calculation. | IMPLEMENTED | quantity at risk per bucket |
| `PHARM-FEFO-022` | 172 | Expiry rate KPI. | IMPLEMENTED | kpis.expiryRatePct from shared/analytics.ts |
| `PHARM-FEFO-023` | 173 | Historical expiry trend. | NOT IMPLEMENTED | no historical expiry trend series |
| `PHARM-FEFO-024` | 174 | Branch expiry comparison. | NOT IMPLEMENTED | no branch-versus-branch expiry comparison |
| `PHARM-FEFO-025` | 175 | Category expiry comparison. | NOT IMPLEMENTED | no category expiry comparison |
| `PHARM-FEFO-026` | 176 | Supplier expiry comparison. | NOT IMPLEMENTED | no supplier expiry comparison |
| `PHARM-FEFO-027` | 177 | Expiry alert escalation. | IMPLEMENTED | automation EXPIRY_90 and EXPIRY_30 rules with escalation ladders |
| `PHARM-FEFO-028` | 178 | Near-expiry transfer recommendation. | IMPLEMENTED | inventory/expiry/redistribution suggests a receiving branch |
| `PHARM-FEFO-029` | 179 | Near-expiry return recommendation. | PARTIALLY IMPLEMENTED | returns to supplier are supported; nothing recommends one from expiry risk |
| `PHARM-FEFO-030` | 180 | Near-expiry promotional suggestion. | NOT IMPLEMENTED | no promotional suggestion from expiry risk |
| `PHARM-FEFO-031` | 181 | Short-shelf-life receiving warning. | IMPLEMENTED | receiving refuses stock below minShelfLifeDaysOnReceipt |
| `PHARM-FEFO-032` | 182 | Shelf-life acceptance policies. | IMPLEMENTED | Product.minShelfLifeDaysOnReceipt plus the procurement.minShelfLife setting |
| `PHARM-FEFO-033` | 183 | Supplier-specific shelf-life policy. | NOT IMPLEMENTED | the shelf-life policy is per product and global, not per supplier |
| `PHARM-FEFO-034` | 184 | Product-specific shelf-life policy. | IMPLEMENTED | Product.minShelfLifeDaysOnReceipt |
| `PHARM-FEFO-035` | 185 | Expiry write-off workflow. | IMPLEMENTED | disposal workflow with approval, from expired stock |
| `PHARM-FEFO-036` | 186 | Expiry quarantine. | IMPLEMENTED | the expiry sweep moves expired batches out of available stock |
| `PHARM-FEFO-037` | 187 | Expiry disposal workflow. | IMPLEMENTED | disposal module with witness and certificate |
| `PHARM-FEFO-038` | 188 | Expiry approval hierarchy. | IMPLEMENTED | approval engine thresholds apply to disposal |
| `PHARM-FEFO-039` | 189 | Expiry loss reporting. | IMPLEMENTED | waste-disposal report plus expired-inventory report |
| `PHARM-FEFO-040` | 190 | Prevent expired transfers. | IMPLEMENTED | the ledger refuses an expired batch on transfer |
| `PHARM-FEFO-041` | 191 | Prevent expired reservations. | IMPLEMENTED | reservation excludes expired batches |
| `PHARM-FEFO-042` | 192 | Prevent expired POS sales. | IMPLEMENTED | POS refuses expired stock |
| `PHARM-FEFO-043` | 193 | Prevent expired dispensing. | IMPLEMENTED | dispensing refuses expired stock |
| `PHARM-FEFO-044` | 194 | Expiry notification digest. | IMPLEMENTED | expiry.alerts job sends the digest |
| `PHARM-FEFO-045` | 195 | Expiry-risk dashboard. | IMPLEMENTED | dashboard expiry cards, command centre and the health score expiry factor |
| `PHARM-FEFO-046` | 196 | Branch expiry targets. | NOT IMPLEMENTED | no per-branch expiry target |
| `PHARM-FEFO-047` | 197 | Forecast expiry before procurement. | PARTIALLY IMPLEMENTED | forecasting and replenishment run before procurement; neither projects expiry risk of the order |
| `PHARM-FEFO-048` | 198 | Excess-stock expiry simulator. | NOT IMPLEMENTED | no excess-stock expiry simulator |
| `PHARM-FEFO-049` | 199 | Automatic expiry-risk scoring. | IMPLEMENTED | shared/expiry.ts expiryRiskScore drives the redistribution ranking |
| `PHARM-FEFO-050` | 200 | Expiry prevention recommendations. | IMPLEMENTED | redistribution suggestions and the health score priority actions both recommend action |

## Pack 5 — WAREHOUSE MANAGEMENT

48 implemented, 1 partial, 1 not implemented. Specification: `specs/13-warehouse/`.

| Requirement | # | Feature | Status | Evidence |
| --- | ---: | --- | --- | --- |
| `PHARM-WHSE-001` | 201 | Unlimited warehouses. | IMPLEMENTED | Warehouse model, unbounded |
| `PHARM-WHSE-002` | 202 | Unlimited branches. | IMPLEMENTED | Branch model, unbounded |
| `PHARM-WHSE-003` | 203 | Warehouse hierarchy. | IMPLEMENTED | WarehouseLocation.parentId gives an unbounded location tree |
| `PHARM-WHSE-004` | 204 | Storage zones. | IMPLEMENTED | location level ZONE |
| `PHARM-WHSE-005` | 205 | Rooms. | IMPLEMENTED | location level ROOM |
| `PHARM-WHSE-006` | 206 | Cold rooms. | IMPLEMENTED | locationType COLD with storageCondition REFRIGERATED |
| `PHARM-WHSE-007` | 207 | Refrigerators. | IMPLEMENTED | storageCondition REFRIGERATED on a location |
| `PHARM-WHSE-008` | 208 | Freezers. | IMPLEMENTED | locationType FROZEN with storageCondition FROZEN |
| `PHARM-WHSE-009` | 209 | Racks. | IMPLEMENTED | location level RACK |
| `PHARM-WHSE-010` | 210 | Shelves. | IMPLEMENTED | location level SHELF |
| `PHARM-WHSE-011` | 211 | Bins. | IMPLEMENTED | location level BIN |
| `PHARM-WHSE-012` | 212 | Pallet locations. | PARTIALLY IMPLEMENTED | a pallet location is a BIN with BULK type; there is no pallet or licence-plate entity |
| `PHARM-WHSE-013` | 213 | Picking locations. | IMPLEMENTED | locationType PICKING plus isPickFace |
| `PHARM-WHSE-014` | 214 | Receiving areas. | IMPLEMENTED | locationType RECEIVING |
| `PHARM-WHSE-015` | 215 | Dispatch areas. | IMPLEMENTED | locationType DISPATCH |
| `PHARM-WHSE-016` | 216 | Quarantine areas. | IMPLEMENTED | locationType QUARANTINE |
| `PHARM-WHSE-017` | 217 | Damaged-stock areas. | IMPLEMENTED | locationType DAMAGED |
| `PHARM-WHSE-018` | 218 | Controlled-drug storage. | IMPLEMENTED | locationType CONTROLLED, enforced for controlled products on put-away |
| `PHARM-WHSE-019` | 219 | Returned-goods storage. | IMPLEMENTED | locationType RETURNS |
| `PHARM-WHSE-020` | 220 | Recall holding areas. | IMPLEMENTED | locationType RECALL_HOLD |
| `PHARM-WHSE-021` | 221 | Location capacity. | IMPLEMENTED | WarehouseLocation.capacityUnits |
| `PHARM-WHSE-022` | 222 | Location weight limits. | IMPLEMENTED | WarehouseLocation.maxWeightKg |
| `PHARM-WHSE-023` | 223 | Storage-condition compatibility. | IMPLEMENTED | storageCondition matched against the product before put-away |
| `PHARM-WHSE-024` | 224 | Automatic bin recommendations. | IMPLEMENTED | warehouse/bin-suggestions |
| `PHARM-WHSE-025` | 225 | Put-away workflows. | IMPLEMENTED | goods-receipts/:id/putaway-tasks generates the work |
| `PHARM-WHSE-026` | 226 | Directed put-away. | IMPLEMENTED | suggestedLocationId is stored beside where stock actually went, so compliance is measured |
| `PHARM-WHSE-027` | 227 | Barcode bin scanning. | IMPLEMENTED | WarehouseLocation.barcode plus warehouse/locations/by-barcode/:barcode |
| `PHARM-WHSE-028` | 228 | Warehouse maps. | NOT IMPLEMENTED | no graphical warehouse map |
| `PHARM-WHSE-029` | 229 | Warehouse capacity dashboards. | IMPLEMENTED | warehouse/occupancy summary and the warehouse screen |
| `PHARM-WHSE-030` | 230 | Occupancy percentage. | IMPLEMENTED | occupancyPercent per location, null when unmetered |
| `PHARM-WHSE-031` | 231 | Empty-bin detection. | IMPLEMENTED | summary.empty and isEmpty per location |
| `PHARM-WHSE-032` | 232 | Product-location history. | IMPLEMENTED | warehouse/product-location-history |
| `PHARM-WHSE-033` | 233 | Multi-location product stock. | IMPLEMENTED | InventoryBalance is keyed by location, so one product sits in many |
| `PHARM-WHSE-034` | 234 | Bin-to-bin transfers. | IMPLEMENTED | warehouse/tasks/moves creates a bin-to-bin move |
| `PHARM-WHSE-035` | 235 | Replenishment between bins. | IMPLEMENTED | task type REPLENISH |
| `PHARM-WHSE-036` | 236 | Pick-face replenishment. | IMPLEMENTED | warehouse/replenishment-needs drives pick-face top-up |
| `PHARM-WHSE-037` | 237 | Pick lists. | IMPLEMENTED | a released wave produces PICK tasks in walk order |
| `PHARM-WHSE-038` | 238 | Wave picking. | IMPLEMENTED | PickWave strategy WAVE |
| `PHARM-WHSE-039` | 239 | Zone picking. | IMPLEMENTED | PickWave strategy ZONE with zoneId |
| `PHARM-WHSE-040` | 240 | Batch picking. | IMPLEMENTED | PickWave strategy BATCH |
| `PHARM-WHSE-041` | 241 | Picking confirmation scanning. | IMPLEMENTED | task completion takes the scanned location, validated against the task |
| `PHARM-WHSE-042` | 242 | Packing workflows. | IMPLEMENTED | ShipmentPackage with lines |
| `PHARM-WHSE-043` | 243 | Packing verification. | IMPLEMENTED | package verification step with verifiedById and verifiedAt |
| `PHARM-WHSE-044` | 244 | Dispatch verification. | IMPLEMENTED | dispatch verification with dispatchedAt and a dock |
| `PHARM-WHSE-045` | 245 | Shipment staging. | IMPLEMENTED | ShipmentPackage.stagingLocationId plus locationType STAGING |
| `PHARM-WHSE-046` | 246 | Dock management. | IMPLEMENTED | Dock model with direction |
| `PHARM-WHSE-047` | 247 | Warehouse task assignment. | IMPLEMENTED | tasks/:id/assign |
| `PHARM-WHSE-048` | 248 | Warehouse productivity metrics. | IMPLEMENTED | warehouse/tasks/productivity by person and task type |
| `PHARM-WHSE-049` | 249 | Warehouse cycle-time metrics. | IMPLEMENTED | productivity reports average minutes per task and per type |
| `PHARM-WHSE-050` | 250 | Warehouse exception dashboard. | IMPLEMENTED | warehouse/tasks/exceptions: stalled, short picks, unassigned, over capacity |

## Pack 6 — PROCUREMENT

30 implemented, 6 partial, 14 not implemented. Specification: `specs/14-procurement/`.

| Requirement | # | Feature | Status | Evidence |
| --- | ---: | --- | --- | --- |
| `PHARM-PROC-001` | 251 | Purchase requisitions. | IMPLEMENTED | PurchaseRequest model with items |
| `PHARM-PROC-002` | 252 | Purchase-request approvals. | IMPLEMENTED | purchase-requests/:id/decide through the approval engine |
| `PHARM-PROC-003` | 253 | Automated purchase suggestions. | IMPLEMENTED | replenishment recommendations from reorder point and forecast |
| `PHARM-PROC-004` | 254 | Department purchase requests. | IMPLEMENTED | PurchaseRequest.department |
| `PHARM-PROC-005` | 255 | Branch purchase requests. | IMPLEMENTED | PurchaseRequest.branchId |
| `PHARM-PROC-006` | 256 | Centralized procurement. | IMPLEMENTED | head office branch plus organization-wide scope |
| `PHARM-PROC-007` | 257 | Decentralized procurement. | IMPLEMENTED | branch-scoped requests and branch-scoped approvals |
| `PHARM-PROC-008` | 258 | Request-for-quotation creation. | IMPLEMENTED | Rfq model and POST rfqs |
| `PHARM-PROC-009` | 259 | Multiple RFQ suppliers. | IMPLEMENTED | an RFQ carries many supplier quotations |
| `PHARM-PROC-010` | 260 | RFQ email integration. | NOT IMPLEMENTED | no email dispatch of an RFQ |
| `PHARM-PROC-011` | 261 | Supplier quotation entry. | IMPLEMENTED | rfqs/:id/quotations |
| `PHARM-PROC-012` | 262 | Quotation document upload. | IMPLEMENTED | Document entityType PURCHASE_ORDER and RFQ attachments |
| `PHARM-PROC-013` | 263 | Quotation comparison. | IMPLEMENTED | rfqs/:id/comparison |
| `PHARM-PROC-014` | 264 | Total landed-cost comparison. | IMPLEMENTED | comparison computes landed cost including freight tax and discount |
| `PHARM-PROC-015` | 265 | Delivery-time comparison. | IMPLEMENTED | comparison ranks on delivery days |
| `PHARM-PROC-016` | 266 | Shelf-life comparison. | IMPLEMENTED | comparison ranks on offered shelf life |
| `PHARM-PROC-017` | 267 | Payment-term comparison. | IMPLEMENTED | comparison ranks on payment terms |
| `PHARM-PROC-018` | 268 | Supplier-score comparison. | IMPLEMENTED | comparison ranks on the stored supplier score |
| `PHARM-PROC-019` | 269 | Weighted supplier scoring. | IMPLEMENTED | weighted score with configurable weights; never auto-selects the cheapest |
| `PHARM-PROC-020` | 270 | Procurement recommendation engine. | IMPLEMENTED | the comparison states in words why its pick differs from the lowest landed cost |
| `PHARM-PROC-021` | 271 | Purchase-order generation. | IMPLEMENTED | POST purchase-orders, and generation from a selected quotation |
| `PHARM-PROC-022` | 272 | Purchase-order approval. | IMPLEMENTED | purchase-orders/:id/transition through PROCUREMENT_REVIEW and FINANCE_REVIEW |
| `PHARM-PROC-023` | 273 | Blanket purchase orders. | NOT IMPLEMENTED | no blanket purchase order |
| `PHARM-PROC-024` | 274 | Framework agreements. | NOT IMPLEMENTED | no framework agreement |
| `PHARM-PROC-025` | 275 | Contract purchase orders. | PARTIALLY IMPLEMENTED | a PO can be raised from a contract price list; there is no contract PO type |
| `PHARM-PROC-026` | 276 | Recurring purchase orders. | NOT IMPLEMENTED | no recurring purchase order |
| `PHARM-PROC-027` | 277 | Partial purchase-order fulfillment. | IMPLEMENTED | PurchaseOrderStatus PARTIALLY_RECEIVED |
| `PHARM-PROC-028` | 278 | Purchase-order amendment. | PARTIALLY IMPLEMENTED | a DRAFT PO can be edited; there is no amendment record after approval |
| `PHARM-PROC-029` | 279 | Purchase-order revision history. | PARTIALLY IMPLEMENTED | status transitions are audited; there is no line-level revision history |
| `PHARM-PROC-030` | 280 | Purchase-order cancellation. | IMPLEMENTED | PurchaseOrderStatus CANCELLED |
| `PHARM-PROC-031` | 281 | Supplier order acknowledgement. | NOT IMPLEMENTED | no supplier acknowledgement step |
| `PHARM-PROC-032` | 282 | Expected delivery dates. | IMPLEMENTED | PurchaseOrder.expectedDate |
| `PHARM-PROC-033` | 283 | Delivery-delay alerts. | IMPLEMENTED | automation PO_OVERDUE rule with escalation |
| `PHARM-PROC-034` | 284 | Open purchase-order dashboard. | IMPLEMENTED | open purchase orders on the command centre |
| `PHARM-PROC-035` | 285 | Purchase commitments report. | PARTIALLY IMPLEMENTED | open PO value is on the command centre; there is no commitments report |
| `PHARM-PROC-036` | 286 | Procurement budget control. | NOT IMPLEMENTED | no procurement budget or budget control |
| `PHARM-PROC-037` | 287 | Product procurement limits. | IMPLEMENTED | Product.procurementRestricted and minPurchaseQty |
| `PHARM-PROC-038` | 288 | Branch procurement limits. | NOT IMPLEMENTED | no per-branch procurement limit |
| `PHARM-PROC-039` | 289 | Emergency procurement workflow. | NOT IMPLEMENTED | no emergency procurement workflow |
| `PHARM-PROC-040` | 290 | Sole-source procurement workflow. | NOT IMPLEMENTED | no sole-source workflow |
| `PHARM-PROC-041` | 291 | Tender procurement support. | NOT IMPLEMENTED | no tender support |
| `PHARM-PROC-042` | 292 | Procurement committee approvals. | PARTIALLY IMPLEMENTED | the approval engine supports multi-step approval; there is no committee construct |
| `PHARM-PROC-043` | 293 | Bid comparison matrices. | IMPLEMENTED | the RFQ comparison matrix |
| `PHARM-PROC-044` | 294 | Procurement document checklist. | NOT IMPLEMENTED | no procurement document checklist |
| `PHARM-PROC-045` | 295 | Purchase-order PDF generation. | IMPLEMENTED | documents/purchase-order/:id renders the PO |
| `PHARM-PROC-046` | 296 | Purchase-order digital signature support. | NOT IMPLEMENTED | no digital signature |
| `PHARM-PROC-047` | 297 | Supplier portal PO visibility. | NOT IMPLEMENTED | no supplier portal |
| `PHARM-PROC-048` | 298 | Procurement KPI dashboard. | PARTIALLY IMPLEMENTED | supplier KPIs and open PO figures exist; there is no procurement KPI dashboard |
| `PHARM-PROC-049` | 299 | Procurement savings calculation. | NOT IMPLEMENTED | no savings calculation against a baseline |
| `PHARM-PROC-050` | 300 | Procurement audit history. | IMPLEMENTED | every procurement transition is written to the audit chain |

## Pack 7 — SUPPLIER MANAGEMENT

25 implemented, 15 partial, 10 not implemented. Specification: `specs/15-suppliers/`.

| Requirement | # | Feature | Status | Evidence |
| --- | ---: | --- | --- | --- |
| `PHARM-SUPP-001` | 301 | Supplier master records. | IMPLEMENTED | Supplier model |
| `PHARM-SUPP-002` | 302 | Supplier contact people. | PARTIALLY IMPLEMENTED | one contactName, phone and email; no contact-people table |
| `PHARM-SUPP-003` | 303 | Multiple supplier addresses. | PARTIALLY IMPLEMENTED | one address on the supplier; no multi-address table |
| `PHARM-SUPP-004` | 304 | Supplier tax information. | IMPLEMENTED | Supplier.taxId |
| `PHARM-SUPP-005` | 305 | Supplier licenses. | IMPLEMENTED | Supplier.licenseNumber plus Document entityType SUPPLIER |
| `PHARM-SUPP-006` | 306 | Supplier license expiration. | IMPLEMENTED | Supplier.licenseExpiry with the SUPPLIER_LICENCE automation rule |
| `PHARM-SUPP-007` | 307 | Supplier certifications. | PARTIALLY IMPLEMENTED | certificates attach as SUPPLIER documents; there is no certification entity |
| `PHARM-SUPP-008` | 308 | Supplier certification expiration. | PARTIALLY IMPLEMENTED | Document.expiresAt drives the licence and document expiry job |
| `PHARM-SUPP-009` | 309 | Supplier bank details. | IMPLEMENTED | Supplier.bankName and bankAccount |
| `PHARM-SUPP-010` | 310 | Supplier currencies. | IMPLEMENTED | Supplier.currency |
| `PHARM-SUPP-011` | 311 | Supplier payment terms. | IMPLEMENTED | Supplier.paymentTerms |
| `PHARM-SUPP-012` | 312 | Supplier credit limits. | NOT IMPLEMENTED | no supplier credit limit |
| `PHARM-SUPP-013` | 313 | Supplier lead times. | IMPLEMENTED | Supplier.leadTimeDays and avgLeadTimeDays |
| `PHARM-SUPP-014` | 314 | Supplier product catalog. | IMPLEMENTED | SupplierProduct catalogue |
| `PHARM-SUPP-015` | 315 | Supplier-specific product codes. | IMPLEMENTED | SupplierProduct.supplierSku |
| `PHARM-SUPP-016` | 316 | Supplier price lists. | IMPLEMENTED | SupplierProduct.unitPrice |
| `PHARM-SUPP-017` | 317 | Supplier price histories. | PARTIALLY IMPLEMENTED | PriceHistory covers sell prices; supplier cost history is only on batches and receipts |
| `PHARM-SUPP-018` | 318 | Supplier discount schedules. | NOT IMPLEMENTED | no supplier discount schedule |
| `PHARM-SUPP-019` | 319 | Supplier minimum orders. | IMPLEMENTED | Supplier.minimumOrderValue and SupplierProduct.moq |
| `PHARM-SUPP-020` | 320 | Supplier delivery calendars. | NOT IMPLEMENTED | no supplier delivery calendar |
| `PHARM-SUPP-021` | 321 | Approved supplier status. | IMPLEMENTED | Supplier.isApproved |
| `PHARM-SUPP-022` | 322 | Suspended supplier status. | IMPLEMENTED | Supplier.isActive false suspends a supplier |
| `PHARM-SUPP-023` | 323 | Blacklisted supplier status. | PARTIALLY IMPLEMENTED | a supplier can be deactivated; there is no distinct blacklist state or reason |
| `PHARM-SUPP-024` | 324 | Supplier onboarding workflow. | NOT IMPLEMENTED | no onboarding workflow |
| `PHARM-SUPP-025` | 325 | Supplier qualification workflow. | NOT IMPLEMENTED | no qualification workflow |
| `PHARM-SUPP-026` | 326 | Supplier document verification. | PARTIALLY IMPLEMENTED | documents attach and expiry is chased; there is no verification step |
| `PHARM-SUPP-027` | 327 | Supplier performance score. | IMPLEMENTED | Supplier.supplierScore, recomputed by the supplier.scores job |
| `PHARM-SUPP-028` | 328 | On-time-delivery KPI. | IMPLEMENTED | Supplier.onTimeDeliveryRate |
| `PHARM-SUPP-029` | 329 | Order-fill-rate KPI. | IMPLEMENTED | Supplier.shortShipmentRate is the fill-rate KPI |
| `PHARM-SUPP-030` | 330 | Rejection-rate KPI. | IMPLEMENTED | Supplier.rejectionRate |
| `PHARM-SUPP-031` | 331 | Supplier defect-rate KPI. | PARTIALLY IMPLEMENTED | rejectionRate and qualityIncidents cover it; there is no separate defect rate |
| `PHARM-SUPP-032` | 332 | Supplier return-rate KPI. | IMPLEMENTED | Supplier.returnRate |
| `PHARM-SUPP-033` | 333 | Supplier price-competitiveness KPI. | IMPLEMENTED | quotation comparison scores price competitiveness |
| `PHARM-SUPP-034` | 334 | Supplier lead-time KPI. | IMPLEMENTED | Supplier.avgLeadTimeDays |
| `PHARM-SUPP-035` | 335 | Supplier responsiveness KPI. | NOT IMPLEMENTED | no responsiveness KPI |
| `PHARM-SUPP-036` | 336 | Supplier quality incidents. | IMPLEMENTED | Supplier.qualityIncidents plus QualityIncident SUPPLIER_QUALITY_ISSUE |
| `PHARM-SUPP-037` | 337 | Supplier corrective-action requests. | PARTIALLY IMPLEMENTED | CAPA exists on quality incidents; it is not addressed to a supplier as a request |
| `PHARM-SUPP-038` | 338 | Supplier complaints. | PARTIALLY IMPLEMENTED | raised as a quality incident; there is no complaint entity |
| `PHARM-SUPP-039` | 339 | Supplier contract management. | NOT IMPLEMENTED | no contract entity |
| `PHARM-SUPP-040` | 340 | Supplier contract expiration alerts. | PARTIALLY IMPLEMENTED | licence and document expiry are chased; contracts are not modelled |
| `PHARM-SUPP-041` | 341 | Supplier risk level. | NOT IMPLEMENTED | no risk level field |
| `PHARM-SUPP-042` | 342 | Supplier country risk. | PARTIALLY IMPLEMENTED | Supplier.country is recorded; no country risk rating |
| `PHARM-SUPP-043` | 343 | Supplier dependency analysis. | NOT IMPLEMENTED | no dependency analysis |
| `PHARM-SUPP-044` | 344 | Single-source dependency alert. | NOT IMPLEMENTED | no single-source alert |
| `PHARM-SUPP-045` | 345 | Alternate supplier suggestion. | IMPLEMENTED | Product.secondarySupplierId and the supplier catalogue offer alternates |
| `PHARM-SUPP-046` | 346 | Supplier spend analysis. | PARTIALLY IMPLEMENTED | supplier purchases are reportable through the report builder; there is no spend analysis view |
| `PHARM-SUPP-047` | 347 | Supplier payment analysis. | IMPLEMENTED | supplier-invoices/ageing |
| `PHARM-SUPP-048` | 348 | Supplier purchase forecasting. | PARTIALLY IMPLEMENTED | forecasting is per product, not per supplier |
| `PHARM-SUPP-049` | 349 | Supplier performance dashboard. | IMPLEMENTED | suppliers/performance plus the supplier-performance report |
| `PHARM-SUPP-050` | 350 | Supplier 360-degree profile. | PARTIALLY IMPLEMENTED | supplier detail shows products, orders, invoices and KPIs; batches and incidents are not on one profile |

## Pack 8 — RECEIVING & QUALITY

33 implemented, 9 partial, 8 not implemented. Specification: `specs/16-receiving/`.

| Requirement | # | Feature | Status | Evidence |
| --- | ---: | --- | --- | --- |
| `PHARM-RECV-001` | 351 | Goods receipt notes. | IMPLEMENTED | GoodsReceipt model with grnNo |
| `PHARM-RECV-002` | 352 | PO-based receiving. | IMPLEMENTED | receiving against a purchase order |
| `PHARM-RECV-003` | 353 | Non-PO receiving permission. | IMPLEMENTED | non-PO receipt flagged NOT_ON_PURCHASE_ORDER and permission gated |
| `PHARM-RECV-004` | 354 | Barcode receiving. | IMPLEMENTED | scanning resolves a product barcode during receiving |
| `PHARM-RECV-005` | 355 | GS1 DataMatrix receiving. | IMPLEMENTED | GS1 DataMatrix parsing in shared/gs1.ts |
| `PHARM-RECV-006` | 356 | GTIN extraction. | IMPLEMENTED | AI 01 GTIN extraction |
| `PHARM-RECV-007` | 357 | Batch extraction. | IMPLEMENTED | AI 10 batch extraction |
| `PHARM-RECV-008` | 358 | Expiry extraction. | IMPLEMENTED | AI 17 expiry extraction |
| `PHARM-RECV-009` | 359 | Serial extraction. | IMPLEMENTED | AI 21 serial extraction |
| `PHARM-RECV-010` | 360 | Quantity verification. | IMPLEMENTED | receivedQty against ordered quantity |
| `PHARM-RECV-011` | 361 | Purchase-price verification. | IMPLEMENTED | unitCost checked against the PO price |
| `PHARM-RECV-012` | 362 | Supplier verification. | IMPLEMENTED | the supplier on the receipt is checked against the PO supplier |
| `PHARM-RECV-013` | 363 | PO variance detection. | IMPLEMENTED | PO variance flags on every line |
| `PHARM-RECV-014` | 364 | Over-delivery detection. | IMPLEMENTED | OVER_DELIVERY flag |
| `PHARM-RECV-015` | 365 | Under-delivery detection. | IMPLEMENTED | UNDER_DELIVERY flag |
| `PHARM-RECV-016` | 366 | Wrong-product detection. | IMPLEMENTED | UNKNOWN_PRODUCT and NOT_ON_PURCHASE_ORDER flags |
| `PHARM-RECV-017` | 367 | Duplicate-delivery detection. | PARTIALLY IMPLEMENTED | EXISTING_BATCH_NUMBER catches a repeated batch; there is no delivery-level duplicate check |
| `PHARM-RECV-018` | 368 | Duplicate-GRN detection. | PARTIALLY IMPLEMENTED | grnNo is unique; there is no same-invoice duplicate check |
| `PHARM-RECV-019` | 369 | Short-shelf-life detection. | IMPLEMENTED | SHORT_SHELF_LIFE flag against minShelfLifeDaysOnReceipt |
| `PHARM-RECV-020` | 370 | Expired-delivery rejection. | IMPLEMENTED | EXPIRED_ON_ARRIVAL flag and the batch cannot be released |
| `PHARM-RECV-021` | 371 | Damaged-packaging recording. | IMPLEMENTED | DAMAGED_PACKAGING flag from packagingDamaged |
| `PHARM-RECV-022` | 372 | Receiving photos. | PARTIALLY IMPLEMENTED | photos attach as GOODS_RECEIPT documents; there is no capture step in the flow |
| `PHARM-RECV-023` | 373 | Temperature-at-receipt recording. | NOT IMPLEMENTED | temperature at receipt is not recorded on the GRN |
| `PHARM-RECV-024` | 374 | Cold-chain delivery verification. | PARTIALLY IMPLEMENTED | cold-chain products are flagged and quarantined on receipt; there is no delivery temperature check |
| `PHARM-RECV-025` | 375 | Delivery-document attachment. | IMPLEMENTED | Document entityType GOODS_RECEIPT |
| `PHARM-RECV-026` | 376 | Certificate-of-analysis verification. | PARTIALLY IMPLEMENTED | a CoA attaches to the batch; there is no verification step |
| `PHARM-RECV-027` | 377 | Quality sampling. | NOT IMPLEMENTED | no quality sampling |
| `PHARM-RECV-028` | 378 | Sampling-plan configuration. | NOT IMPLEMENTED | no sampling plan |
| `PHARM-RECV-029` | 379 | Quality inspection checklist. | NOT IMPLEMENTED | no inspection checklist |
| `PHARM-RECV-030` | 380 | Pass status. | IMPLEMENTED | batch release is the pass state |
| `PHARM-RECV-031` | 381 | Fail status. | IMPLEMENTED | batch rejection with a reason |
| `PHARM-RECV-032` | 382 | Conditional release. | PARTIALLY IMPLEMENTED | a batch can be released with a note; there is no conditional-release state |
| `PHARM-RECV-033` | 383 | Quarantine status. | IMPLEMENTED | every batch lands QUARANTINED on receipt |
| `PHARM-RECV-034` | 384 | QA approval. | IMPLEMENTED | batches/:id/release requires inventory.batch.RELEASE |
| `PHARM-RECV-035` | 385 | QA rejection. | IMPLEMENTED | batches/:id status REJECTED with a reason |
| `PHARM-RECV-036` | 386 | Receiving discrepancies. | IMPLEMENTED | receiving flags are stored on the line and reported |
| `PHARM-RECV-037` | 387 | Supplier discrepancy notification. | NOT IMPLEMENTED | no discrepancy notification to the supplier |
| `PHARM-RECV-038` | 388 | Goods-return-from-receiving workflow. | IMPLEMENTED | the returns module handles a return to supplier |
| `PHARM-RECV-039` | 389 | Receiving label printing. | IMPLEMENTED | label printing for received batches |
| `PHARM-RECV-040` | 390 | Automatic put-away tasks. | IMPLEMENTED | goods-receipts/:id/putaway-tasks |
| `PHARM-RECV-041` | 391 | GRN accounting integration. | IMPLEMENTED | the GRN posts Inventory against goods received not invoiced |
| `PHARM-RECV-042` | 392 | Receiving audit logs. | IMPLEMENTED | every receipt is written to the audit chain |
| `PHARM-RECV-043` | 393 | Receiving user productivity. | PARTIALLY IMPLEMENTED | warehouse task productivity covers put-away, not receiving itself |
| `PHARM-RECV-044` | 394 | Average receiving time. | NOT IMPLEMENTED | no average receiving time |
| `PHARM-RECV-045` | 395 | Receiving backlog dashboard. | NOT IMPLEMENTED | no receiving backlog dashboard |
| `PHARM-RECV-046` | 396 | Pending QA dashboard. | IMPLEMENTED | quarantined batches appear on the command centre |
| `PHARM-RECV-047` | 397 | Failed receipt dashboard. | PARTIALLY IMPLEMENTED | flagged lines are stored and visible on the receipt; there is no failed-receipt dashboard |
| `PHARM-RECV-048` | 398 | Quality trend dashboard. | NOT IMPLEMENTED | no quality trend dashboard |
| `PHARM-RECV-049` | 399 | Receiving analytics. | PARTIALLY IMPLEMENTED | receipts are reportable through the report builder; there is no receiving analytics view |
| `PHARM-RECV-050` | 400 | Supplier quality comparison. | IMPLEMENTED | the supplier-performance report compares rejection and quality across suppliers |

## Pack 9 — STOCK TRANSACTION ENGINE

41 implemented, 9 partial, 0 not implemented. Specification: `specs/10-inventory/`.

| Requirement | # | Feature | Status | Evidence |
| --- | ---: | --- | --- | --- |
| `PHARM-LEDG-001` | 401 | Immutable stock ledger. | IMPLEMENTED | inventory_transactions is append-only; nothing updates or deletes a row |
| `PHARM-LEDG-002` | 402 | Double-entry inventory movements. | IMPLEMENTED | every movement writes an in and an out side with a running balanceAfter |
| `PHARM-LEDG-003` | 403 | Purchase receipt entries. | IMPLEMENTED | TransactionType PURCHASE_RECEIPT |
| `PHARM-LEDG-004` | 404 | Sales issue entries. | IMPLEMENTED | TransactionType SALE |
| `PHARM-LEDG-005` | 405 | Dispensing issue entries. | IMPLEMENTED | TransactionType DISPENSING |
| `PHARM-LEDG-006` | 406 | Transfer-out entries. | IMPLEMENTED | TransactionType TRANSFER_OUT |
| `PHARM-LEDG-007` | 407 | Transfer-in entries. | IMPLEMENTED | TransactionType TRANSFER_IN |
| `PHARM-LEDG-008` | 408 | Return-in entries. | IMPLEMENTED | TransactionType RETURN_IN |
| `PHARM-LEDG-009` | 409 | Return-out entries. | IMPLEMENTED | TransactionType RETURN_OUT |
| `PHARM-LEDG-010` | 410 | Adjustment entries. | IMPLEMENTED | TransactionType ADJUSTMENT |
| `PHARM-LEDG-011` | 411 | Damage entries. | IMPLEMENTED | TransactionType DAMAGE |
| `PHARM-LEDG-012` | 412 | Expiry entries. | IMPLEMENTED | TransactionType EXPIRY |
| `PHARM-LEDG-013` | 413 | Recall entries. | IMPLEMENTED | TransactionType RECALL |
| `PHARM-LEDG-014` | 414 | Disposal entries. | IMPLEMENTED | TransactionType DISPOSAL |
| `PHARM-LEDG-015` | 415 | Stock-count entries. | IMPLEMENTED | TransactionType STOCK_COUNT |
| `PHARM-LEDG-016` | 416 | Manufacturing adjustment support. | PARTIALLY IMPLEMENTED | repack and split are modelled through batch genealogy; there is no manufacturing type |
| `PHARM-LEDG-017` | 417 | Donation receipt entries. | PARTIALLY IMPLEMENTED | recordable as an ADJUSTMENT with a reason; there is no donation type |
| `PHARM-LEDG-018` | 418 | Donation issue entries. | PARTIALLY IMPLEMENTED | recordable as an ADJUSTMENT with a reason; there is no donation type |
| `PHARM-LEDG-019` | 419 | Sample issue entries. | PARTIALLY IMPLEMENTED | recordable as an ADJUSTMENT with a reason; there is no sample type |
| `PHARM-LEDG-020` | 420 | Internal-use entries. | PARTIALLY IMPLEMENTED | recordable as an ADJUSTMENT with a reason; there is no internal-use type |
| `PHARM-LEDG-021` | 421 | Stock reservation ledger. | IMPLEMENTED | TransactionType RESERVATION with StockReservation |
| `PHARM-LEDG-022` | 422 | Stock release ledger. | IMPLEMENTED | TransactionType RESERVATION_RELEASE |
| `PHARM-LEDG-023` | 423 | Transaction reference IDs. | IMPLEMENTED | referenceType, referenceId and referenceNo on every row |
| `PHARM-LEDG-024` | 424 | Transaction idempotency keys. | IMPLEMENTED | InventoryTransaction.idempotencyKey unique, plus the IdempotencyKey table |
| `PHARM-LEDG-025` | 425 | Database transactional integrity. | IMPLEMENTED | every movement runs inside one interactive transaction |
| `PHARM-LEDG-026` | 426 | Row-level locking. | IMPLEMENTED | SELECT FOR UPDATE on the balance row plus pg_advisory_xact_lock |
| `PHARM-LEDG-027` | 427 | Optimistic concurrency controls. | PARTIALLY IMPLEMENTED | pessimistic locking is used throughout; there is no version column |
| `PHARM-LEDG-028` | 428 | Negative-stock prevention. | IMPLEMENTED | the ledger refuses a movement that would take a balance below zero |
| `PHARM-LEDG-029` | 429 | Duplicate-posting prevention. | IMPLEMENTED | the unique idempotency key rejects a replayed post |
| `PHARM-LEDG-030` | 430 | Backdated-transaction controls. | IMPLEMENTED | a movement carries occurredAt, bounded by inventory.backdateLimitDays |
| `PHARM-LEDG-031` | 431 | Future-date controls. | IMPLEMENTED | inventory.allowFutureDating refuses a future-dated movement by default |
| `PHARM-LEDG-032` | 432 | Transaction reversal. | IMPLEMENTED | a movement is reversed by an opposing entry, never edited |
| `PHARM-LEDG-033` | 433 | Adjustment instead of deletion. | IMPLEMENTED | corrections are adjustments; no row is deleted |
| `PHARM-LEDG-034` | 434 | Opening-balance migration. | IMPLEMENTED | the seed writes opening balances as PURCHASE_RECEIPT rows through the ledger |
| `PHARM-LEDG-035` | 435 | Closing-balance snapshots. | PARTIALLY IMPLEMENTED | balanceAfter is a snapshot per row; there is no period closing snapshot |
| `PHARM-LEDG-036` | 436 | Inventory reconciliation. | IMPLEMENTED | ledger/integrity replays the ledger against the balance cache |
| `PHARM-LEDG-037` | 437 | Ledger reconstruction. | IMPLEMENTED | ledger/integrity reconstructs the balance from the transactions |
| `PHARM-LEDG-038` | 438 | Stock balance verification. | IMPLEMENTED | ledger/integrity reports drift rather than correcting it |
| `PHARM-LEDG-039` | 439 | Inventory integrity checker. | IMPLEMENTED | ledger/integrity is the integrity checker |
| `PHARM-LEDG-040` | 440 | Orphan transaction detection. | PARTIALLY IMPLEMENTED | foreign keys make an orphan impossible; there is no detection report |
| `PHARM-LEDG-041` | 441 | Invalid-batch detection. | IMPLEMENTED | the ledger refuses a batch that is not allocatable |
| `PHARM-LEDG-042` | 442 | Broken-transfer detection. | PARTIALLY IMPLEMENTED | transfers are two-sided in one transaction so a half transfer cannot persist; there is no broken-transfer report |
| `PHARM-LEDG-043` | 443 | Cost recalculation utilities. | IMPLEMENTED | accounting/valuation/reconciliation plus the cost-layer reconciliation in the seed |
| `PHARM-LEDG-044` | 444 | Stock ledger search. | IMPLEMENTED | inventory/ledger with search |
| `PHARM-LEDG-045` | 445 | Stock ledger filtering. | IMPLEMENTED | ledger filters by product, batch, warehouse, type and date |
| `PHARM-LEDG-046` | 446 | Stock ledger export. | IMPLEMENTED | the stock-ledger report exports to CSV |
| `PHARM-LEDG-047` | 447 | Transaction drilldown. | IMPLEMENTED | every ledger row carries its reference and links to it |
| `PHARM-LEDG-048` | 448 | Source-document drilldown. | IMPLEMENTED | the timeline links each entry to its source document |
| `PHARM-LEDG-049` | 449 | User-action drilldown. | IMPLEMENTED | performedById on every row plus the audit trail |
| `PHARM-LEDG-050` | 450 | Inventory forensic timeline. | IMPLEMENTED | TimelineService assembles the forensic view for a product, batch, patient or supplier |

## Pack 10 — STOCK COUNTS & LOSS CONTROL

29 implemented, 12 partial, 9 not implemented. Specification: `specs/19-stock-counts/`.

| Requirement | # | Feature | Status | Evidence |
| --- | ---: | --- | --- | --- |
| `PHARM-COUNT-001` | 451 | Full physical counts. | IMPLEMENTED | CountType FULL |
| `PHARM-COUNT-002` | 452 | Cycle counting. | IMPLEMENTED | CountType CYCLE |
| `PHARM-COUNT-003` | 453 | Blind counting. | NOT IMPLEMENTED | the count sheet shows the system quantity; there is no blind mode |
| `PHARM-COUNT-004` | 454 | Double counting. | NOT IMPLEMENTED | no double-count step |
| `PHARM-COUNT-005` | 455 | Random counting. | IMPLEMENTED | CountType RANDOM |
| `PHARM-COUNT-006` | 456 | ABC-based counting. | PARTIALLY IMPLEMENTED | ABC analysis exists and can select products; the count does not consume it |
| `PHARM-COUNT-007` | 457 | High-value item counting. | PARTIALLY IMPLEMENTED | selectable by product filter; there is no high-value count type |
| `PHARM-COUNT-008` | 458 | Controlled-drug counting. | PARTIALLY IMPLEMENTED | controlled stock has its own register and reconciliation; the count has no controlled mode |
| `PHARM-COUNT-009` | 459 | Near-expiry counting. | PARTIALLY IMPLEMENTED | selectable by expiry filter; there is no near-expiry count type |
| `PHARM-COUNT-010` | 460 | Warehouse counts. | IMPLEMENTED | CountType WAREHOUSE |
| `PHARM-COUNT-011` | 461 | Zone counts. | PARTIALLY IMPLEMENTED | counts scope to a warehouse and items carry a locationId; there is no zone count type |
| `PHARM-COUNT-012` | 462 | Rack counts. | NOT IMPLEMENTED | no rack count type |
| `PHARM-COUNT-013` | 463 | Shelf counts. | NOT IMPLEMENTED | no shelf count type |
| `PHARM-COUNT-014` | 464 | Bin counts. | IMPLEMENTED | CountType BIN |
| `PHARM-COUNT-015` | 465 | Product-category counts. | IMPLEMENTED | CountType CATEGORY |
| `PHARM-COUNT-016` | 466 | Barcode count mode. | IMPLEMENTED | stock-counts/:id/scan |
| `PHARM-COUNT-017` | 467 | Mobile count mode. | IMPLEMENTED | the counts screen works on a phone and the scan endpoint drives it |
| `PHARM-COUNT-018` | 468 | Offline count capture. | IMPLEMENTED | the offline queue replays count entries when the connection returns |
| `PHARM-COUNT-019` | 469 | Count-sheet generation. | IMPLEMENTED | the stock-count document renders a count sheet |
| `PHARM-COUNT-020` | 470 | Count assignment. | IMPLEMENTED | StockCount.countedById |
| `PHARM-COUNT-021` | 471 | Count freeze option. | NOT IMPLEMENTED | no freeze of movement during a count |
| `PHARM-COUNT-022` | 472 | Snapshot quantity. | IMPLEMENTED | StockCountItem.systemQty |
| `PHARM-COUNT-023` | 473 | Physical quantity. | IMPLEMENTED | StockCountItem.countedQty |
| `PHARM-COUNT-024` | 474 | Variance quantity. | IMPLEMENTED | StockCountItem.varianceQty |
| `PHARM-COUNT-025` | 475 | Variance percentage. | IMPLEMENTED | variance percentage computed from systemQty |
| `PHARM-COUNT-026` | 476 | Variance value. | IMPLEMENTED | StockCountItem.varianceValue |
| `PHARM-COUNT-027` | 477 | Tolerance configuration. | IMPLEMENTED | count.tolerancePercent and count.escalationValue decide what needs approval |
| `PHARM-COUNT-028` | 478 | Variance approval workflow. | IMPLEMENTED | requiresApproval per line, routed through the approval engine |
| `PHARM-COUNT-029` | 479 | Large-variance escalation. | IMPLEMENTED | the COUNT_VARIANCE automation rule escalates a large variance |
| `PHARM-COUNT-030` | 480 | Recount workflow. | PARTIALLY IMPLEMENTED | a line can be recorded again before posting; there is no formal recount round |
| `PHARM-COUNT-031` | 481 | Count reconciliation. | IMPLEMENTED | posting reconciles counted against system quantity |
| `PHARM-COUNT-032` | 482 | Count posting. | IMPLEMENTED | stock-counts/:id/post writes STOCK_COUNT ledger rows |
| `PHARM-COUNT-033` | 483 | Count adjustment ledger. | IMPLEMENTED | the count posts through the ledger like any other movement |
| `PHARM-COUNT-034` | 484 | Shrinkage classification. | PARTIALLY IMPLEMENTED | shrinkage is measured in aggregate; the loss is not classified per line |
| `PHARM-COUNT-035` | 485 | Damage classification. | IMPLEMENTED | damage is its own document type and ledger type |
| `PHARM-COUNT-036` | 486 | Theft-loss classification. | NOT IMPLEMENTED | no theft classification |
| `PHARM-COUNT-037` | 487 | Unknown-loss classification. | PARTIALLY IMPLEMENTED | an unexplained variance is recorded with a free-text reason; there is no category |
| `PHARM-COUNT-038` | 488 | Misplacement classification. | NOT IMPLEMENTED | no misplacement classification |
| `PHARM-COUNT-039` | 489 | Variance root-cause analysis. | PARTIALLY IMPLEMENTED | every variance carries a reason; there is no root-cause analysis |
| `PHARM-COUNT-040` | 490 | Repeated variance alerts. | IMPLEMENTED | the COUNT_VARIANCE rule escalates a subject that keeps matching |
| `PHARM-COUNT-041` | 491 | Inventory accuracy KPI. | IMPLEMENTED | kpis.inventoryAccuracyPct and the health score accuracy factor |
| `PHARM-COUNT-042` | 492 | Shrinkage KPI. | IMPLEMENTED | kpis.shrinkageUnits and shared/analytics.ts shrinkage |
| `PHARM-COUNT-043` | 493 | Count completion KPI. | PARTIALLY IMPLEMENTED | count status is tracked; there is no completion-rate KPI |
| `PHARM-COUNT-044` | 494 | Count productivity metrics. | NOT IMPLEMENTED | no count productivity metric |
| `PHARM-COUNT-045` | 495 | Branch accuracy ranking. | PARTIALLY IMPLEMENTED | the branch-performance report ranks branches; not on count accuracy |
| `PHARM-COUNT-046` | 496 | Warehouse accuracy ranking. | NOT IMPLEMENTED | no warehouse accuracy ranking |
| `PHARM-COUNT-047` | 497 | Stock-count audit trail. | IMPLEMENTED | every count action is written to the audit chain |
| `PHARM-COUNT-048` | 498 | Stock-count report. | IMPLEMENTED | the count-variance report |
| `PHARM-COUNT-049` | 499 | Variance financial report. | IMPLEMENTED | varianceValue on every line and in the count-variance report |
| `PHARM-COUNT-050` | 500 | Inventory-loss dashboard. | PARTIALLY IMPLEMENTED | loss figures appear in KPIs and the waste-disposal report; there is no single loss dashboard |

## Pack 11 — INTER-BRANCH TRANSFERS

33 implemented, 8 partial, 9 not implemented. Specification: `specs/18-transfers/`.

| Requirement | # | Feature | Status | Evidence |
| --- | ---: | --- | --- | --- |
| `PHARM-XFER-001` | 501 | Transfer requests. | IMPLEMENTED | StockTransfer DRAFT then SUBMITTED |
| `PHARM-XFER-002` | 502 | Transfer request approval. | IMPLEMENTED | transfers/:id/approve through the approval engine |
| `PHARM-XFER-003` | 503 | Automatic transfer recommendation. | IMPLEMENTED | inventory/expiry/redistribution recommends transfers |
| `PHARM-XFER-004` | 504 | Expiry-saving transfer recommendation. | IMPLEMENTED | the redistribution engine ranks on expiry risk |
| `PHARM-XFER-005` | 505 | Stockout-prevention transfer recommendation. | IMPLEMENTED | the receiving branch is chosen by shortfall against reorder level |
| `PHARM-XFER-006` | 506 | Excess-stock transfer recommendation. | IMPLEMENTED | surplus above maximumStock is what the engine offers to move |
| `PHARM-XFER-007` | 507 | Source branch selection. | IMPLEMENTED | StockTransfer.fromWarehouseId and fromBranchId |
| `PHARM-XFER-008` | 508 | Destination branch selection. | IMPLEMENTED | StockTransfer.toWarehouseId and toBranchId |
| `PHARM-XFER-009` | 509 | Batch selection. | IMPLEMENTED | StockTransferItem.batchId |
| `PHARM-XFER-010` | 510 | FEFO transfer picking. | IMPLEMENTED | dispatch allocates through the FEFO service |
| `PHARM-XFER-011` | 511 | Transfer reservation. | IMPLEMENTED | dispatch reserves the stock it will move |
| `PHARM-XFER-012` | 512 | Transfer pick list. | IMPLEMENTED | a transfer wave produces PICK tasks in walk order |
| `PHARM-XFER-013` | 513 | Transfer packing. | IMPLEMENTED | ShipmentPackage with referenceType TRANSFER |
| `PHARM-XFER-014` | 514 | Transfer dispatch. | IMPLEMENTED | transfers/:id/dispatch |
| `PHARM-XFER-015` | 515 | In-transit status. | IMPLEMENTED | TransferStatus IN_TRANSIT |
| `PHARM-XFER-016` | 516 | Partial dispatch. | IMPLEMENTED | StockTransferItem.dispatchedQty below requestedQty |
| `PHARM-XFER-017` | 517 | Partial receipt. | IMPLEMENTED | TransferStatus PARTIALLY_RECEIVED with receivedQty |
| `PHARM-XFER-018` | 518 | Transfer receiving. | IMPLEMENTED | transfers/:id/receive |
| `PHARM-XFER-019` | 519 | Transfer discrepancy. | IMPLEMENTED | StockTransferItem.varianceReason on a receipt mismatch |
| `PHARM-XFER-020` | 520 | Transfer rejection. | PARTIALLY IMPLEMENTED | a line can be received short with a reason; there is no rejection state |
| `PHARM-XFER-021` | 521 | Transfer cancellation. | IMPLEMENTED | TransferStatus CANCELLED, releasing reservations |
| `PHARM-XFER-022` | 522 | Transfer return. | PARTIALLY IMPLEMENTED | stock can be transferred back; there is no return-of-transfer document |
| `PHARM-XFER-023` | 523 | Transfer damage reporting. | IMPLEMENTED | damage on a transfer is recorded as a damage report against the batch |
| `PHARM-XFER-024` | 524 | Transfer temperature logging. | NOT IMPLEMENTED | no temperature log against a transfer |
| `PHARM-XFER-025` | 525 | Cold-chain transfer tracking. | PARTIALLY IMPLEMENTED | cold-chain products keep their flags and storage rules; the transfer carries no chain record |
| `PHARM-XFER-026` | 526 | Courier information. | IMPLEMENTED | StockTransfer.vehicleOrCourier |
| `PHARM-XFER-027` | 527 | Vehicle information. | IMPLEMENTED | StockTransfer.vehicleOrCourier |
| `PHARM-XFER-028` | 528 | Driver information. | NOT IMPLEMENTED | no driver field |
| `PHARM-XFER-029` | 529 | Tracking-number support. | NOT IMPLEMENTED | no tracking number |
| `PHARM-XFER-030` | 530 | Expected arrival. | NOT IMPLEMENTED | no expected arrival date |
| `PHARM-XFER-031` | 531 | Delayed transfer alerts. | NOT IMPLEMENTED | no delayed-transfer alert |
| `PHARM-XFER-032` | 532 | Transfer proof of delivery. | PARTIALLY IMPLEMENTED | receivedById and receivedAt are recorded; there is no proof-of-delivery capture |
| `PHARM-XFER-033` | 533 | Transfer receiving signatures. | PARTIALLY IMPLEMENTED | receivedById records who signed for it; there is no signature capture |
| `PHARM-XFER-034` | 534 | Transfer barcode verification. | IMPLEMENTED | receiving a transfer scans the batch, and a mismatch is refused |
| `PHARM-XFER-035` | 535 | Batch mismatch prevention. | IMPLEMENTED | the receipt refuses a batch that was not dispatched |
| `PHARM-XFER-036` | 536 | Transfer quantity mismatch alerts. | IMPLEMENTED | a quantity mismatch demands a variance reason |
| `PHARM-XFER-037` | 537 | Transfer document printing. | IMPLEMENTED | the stock-transfer document renders the note |
| `PHARM-XFER-038` | 538 | Transfer labels. | IMPLEMENTED | batch labels print for transferred stock |
| `PHARM-XFER-039` | 539 | Transfer ledger integration. | IMPLEMENTED | dispatch and receipt both write through the ledger in one transaction each |
| `PHARM-XFER-040` | 540 | Transfer audit history. | IMPLEMENTED | every transition is written to the audit chain |
| `PHARM-XFER-041` | 541 | Transfer cost allocation. | NOT IMPLEMENTED | no transfer cost allocation |
| `PHARM-XFER-042` | 542 | Transfer distance field. | NOT IMPLEMENTED | no distance field |
| `PHARM-XFER-043` | 543 | Inter-branch replenishment. | IMPLEMENTED | the redistribution engine drives inter-branch replenishment |
| `PHARM-XFER-044` | 544 | Hub-and-spoke transfers. | PARTIALLY IMPLEMENTED | any branch can send to any branch; there is no hub-and-spoke construct |
| `PHARM-XFER-045` | 545 | Emergency stock requests. | PARTIALLY IMPLEMENTED | a transfer can be raised and approved quickly; there is no emergency flow |
| `PHARM-XFER-046` | 546 | Branch stock sharing. | IMPLEMENTED | cross-branch availability plus transfers are the sharing mechanism |
| `PHARM-XFER-047` | 547 | Cross-branch availability search. | IMPLEMENTED | findAcrossBranches locates stock in other branches |
| `PHARM-XFER-048` | 548 | Transfer analytics. | PARTIALLY IMPLEMENTED | transfers are reportable through the report builder and the stock-transfers report |
| `PHARM-XFER-049` | 549 | Transfer turnaround KPI. | NOT IMPLEMENTED | no turnaround KPI |
| `PHARM-XFER-050` | 550 | Transfer optimization dashboard. | NOT IMPLEMENTED | no transfer optimisation dashboard |

## Pack 12 — POS & SALES

37 implemented, 9 partial, 4 not implemented. Specification: `specs/20-pos/`.

| Requirement | # | Feature | Status | Evidence |
| --- | ---: | --- | --- | --- |
| `PHARM-POS-001` | 551 | Fast pharmacy POS. | IMPLEMENTED | the POS screen with keyboard-first search and checkout |
| `PHARM-POS-002` | 552 | Touch-optimized POS. | IMPLEMENTED | large touch targets and a phone-first layout |
| `PHARM-POS-003` | 553 | Barcode product scanning. | IMPLEMENTED | pos/search plus the scan endpoint |
| `PHARM-POS-004` | 554 | GS1 scanning at sale. | IMPLEMENTED | GS1 parsing resolves GTIN, batch and expiry at the till |
| `PHARM-POS-005` | 555 | Product-name search. | IMPLEMENTED | pos/search matches product name |
| `PHARM-POS-006` | 556 | Generic-name search. | IMPLEMENTED | pos/search matches generic name |
| `PHARM-POS-007` | 557 | Brand-name search. | IMPLEMENTED | pos/search matches brand name |
| `PHARM-POS-008` | 558 | Ingredient search. | PARTIALLY IMPLEMENTED | global search covers ingredients; the till search does not |
| `PHARM-POS-009` | 559 | Category search. | PARTIALLY IMPLEMENTED | products filter by category in the catalogue; the till search does not |
| `PHARM-POS-010` | 560 | Batch-aware cart. | IMPLEMENTED | each cart line carries the batch FEFO allocated |
| `PHARM-POS-011` | 561 | Automatic FEFO allocation. | IMPLEMENTED | checkout allocates through the FEFO service |
| `PHARM-POS-012` | 562 | Prescription-required warning. | IMPLEMENTED | a prescription-only product is refused at the till |
| `PHARM-POS-013` | 563 | Controlled-product restrictions. | IMPLEMENTED | a controlled product cannot be sold through the till |
| `PHARM-POS-014` | 564 | Expiry validation at checkout. | IMPLEMENTED | expired stock is refused at checkout |
| `PHARM-POS-015` | 565 | Recall validation at checkout. | IMPLEMENTED | recalled stock is refused at checkout, and the refusal says so |
| `PHARM-POS-016` | 566 | Quarantine validation at checkout. | IMPLEMENTED | quarantined stock is not allocatable |
| `PHARM-POS-017` | 567 | Real-time inventory availability. | IMPLEMENTED | availability is read from the balance under a lock |
| `PHARM-POS-018` | 568 | Multiple payment methods. | IMPLEMENTED | PaymentMethod CASH CARD MOBILE_MONEY INSURANCE BANK_TRANSFER CREDIT |
| `PHARM-POS-019` | 569 | Cash payments. | IMPLEMENTED | PaymentMethod CASH |
| `PHARM-POS-020` | 570 | Card payments. | PARTIALLY IMPLEMENTED | CARD is recorded from the terminal reference; no gateway confirms it |
| `PHARM-POS-021` | 571 | Mobile-money payments. | PARTIALLY IMPLEMENTED | MOBILE_MONEY is recorded from the reference; no gateway confirms it |
| `PHARM-POS-022` | 572 | Bank-transfer payments. | PARTIALLY IMPLEMENTED | BANK_TRANSFER is recorded from the reference; no bank feed confirms it |
| `PHARM-POS-023` | 573 | Split payments. | IMPLEMENTED | checkout takes a list of payments, so a sale can be split across methods |
| `PHARM-POS-024` | 574 | Customer credit. | IMPLEMENTED | PaymentMethod CREDIT posts to accounts receivable |
| `PHARM-POS-025` | 575 | Store credit. | NOT IMPLEMENTED | no store credit balance |
| `PHARM-POS-026` | 576 | Gift voucher support. | NOT IMPLEMENTED | no gift voucher |
| `PHARM-POS-027` | 577 | Discount permissions. | IMPLEMENTED | a discount needs sales.sale.DISCOUNT |
| `PHARM-POS-028` | 578 | Maximum discount controls. | IMPLEMENTED | the pos.maxDiscountPercent setting is enforced server-side |
| `PHARM-POS-029` | 579 | Promotional discounts. | IMPLEMENTED | a promotional price list applies automatically |
| `PHARM-POS-030` | 580 | Coupon support. | NOT IMPLEMENTED | no coupon |
| `PHARM-POS-031` | 581 | Tax calculation. | IMPLEMENTED | tax is computed per line from the product tax rate |
| `PHARM-POS-032` | 582 | Tax-exempt transactions. | NOT IMPLEMENTED | no tax-exempt flag |
| `PHARM-POS-033` | 583 | Receipt generation. | IMPLEMENTED | the sales-invoice document |
| `PHARM-POS-034` | 584 | Thermal receipt printing. | PARTIALLY IMPLEMENTED | the receipt renders and prints; there is no thermal-printer driver |
| `PHARM-POS-035` | 585 | A4 invoice printing. | IMPLEMENTED | the sales-invoice document prints on A4 |
| `PHARM-POS-036` | 586 | Email receipts. | PARTIALLY IMPLEMENTED | the email channel exists; the receipt is not wired to it |
| `PHARM-POS-037` | 587 | SMS receipt integration. | PARTIALLY IMPLEMENTED | the SMS channel exists; the receipt is not wired to it |
| `PHARM-POS-038` | 588 | Hold transaction. | IMPLEMENTED | pos/hold |
| `PHARM-POS-039` | 589 | Resume transaction. | IMPLEMENTED | pos/held/:id/resume, which releases the reservation correctly |
| `PHARM-POS-040` | 590 | Void transaction authorization. | IMPLEMENTED | sales/:id/void needs sales.sale.CANCEL and a reason |
| `PHARM-POS-041` | 591 | Refund workflow. | IMPLEMENTED | sales/:id/refund with partial quantities |
| `PHARM-POS-042` | 592 | Return workflow. | IMPLEMENTED | the returns module handles a customer return to stock |
| `PHARM-POS-043` | 593 | Cashier shift opening. | IMPLEMENTED | pos/cash-sessions/open |
| `PHARM-POS-044` | 594 | Cashier shift closing. | IMPLEMENTED | pos/cash-sessions/:id/close |
| `PHARM-POS-045` | 595 | Cash drawer tracking. | IMPLEMENTED | CashSession tracks opening cash, sales, refunds and expenses |
| `PHARM-POS-046` | 596 | Till reconciliation. | IMPLEMENTED | close computes expected against actual cash |
| `PHARM-POS-047` | 597 | Cash variance approval. | IMPLEMENTED | a material variance demands a reason and is escalated |
| `PHARM-POS-048` | 598 | Daily sales summary. | IMPLEMENTED | the daily sales report and dashboard sales figures |
| `PHARM-POS-049` | 599 | Cashier productivity dashboard. | PARTIALLY IMPLEMENTED | sales per cashier are reportable; there is no cashier productivity dashboard |
| `PHARM-POS-050` | 600 | POS offline resilience. | IMPLEMENTED | the service worker plus the offline queue replay sales when the connection returns |

## Pack 13 — PRESCRIPTIONS & DISPENSING

42 implemented, 8 partial, 0 not implemented. Specification: `specs/21-prescriptions/`.

| Requirement | # | Feature | Status | Evidence |
| --- | ---: | --- | --- | --- |
| `PHARM-RX-001` | 601 | Prescription registration. | IMPLEMENTED | POST dispensing/prescriptions |
| `PHARM-RX-002` | 602 | Prescription number. | IMPLEMENTED | Prescription.prescriptionNo unique |
| `PHARM-RX-003` | 603 | Electronic prescription import. | IMPLEMENTED | FHIR MedicationRequest create with idempotency |
| `PHARM-RX-004` | 604 | Prescription image upload. | IMPLEMENTED | Document entityType PRESCRIPTION plus documentUrl |
| `PHARM-RX-005` | 605 | Prescription PDF upload. | IMPLEMENTED | the same document path accepts a PDF |
| `PHARM-RX-006` | 606 | Prescriber records. | PARTIALLY IMPLEMENTED | prescriberName and prescriberLicense are on the prescription; there is no prescriber entity |
| `PHARM-RX-007` | 607 | Prescriber license data. | IMPLEMENTED | Prescription.prescriberLicense |
| `PHARM-RX-008` | 608 | Healthcare-facility records. | PARTIALLY IMPLEMENTED | Prescription.facilityName; there is no facility entity |
| `PHARM-RX-009` | 609 | Prescription date. | IMPLEMENTED | Prescription.prescriptionDate |
| `PHARM-RX-010` | 610 | Prescription expiration. | IMPLEMENTED | the dispensing.prescriptionValidityDays setting refuses a stale prescription |
| `PHARM-RX-011` | 611 | Patient linkage. | IMPLEMENTED | Prescription.patientId |
| `PHARM-RX-012` | 612 | Medication request lines. | IMPLEMENTED | PrescriptionItem per medication |
| `PHARM-RX-013` | 613 | Strength instructions. | IMPLEMENTED | PrescriptionItem.strength |
| `PHARM-RX-014` | 614 | Dose instructions. | IMPLEMENTED | PrescriptionItem.dosage |
| `PHARM-RX-015` | 615 | Frequency. | IMPLEMENTED | PrescriptionItem.frequency |
| `PHARM-RX-016` | 616 | Duration. | IMPLEMENTED | PrescriptionItem.durationDays |
| `PHARM-RX-017` | 617 | Quantity prescribed. | IMPLEMENTED | PrescriptionItem.prescribedQty |
| `PHARM-RX-018` | 618 | Quantity dispensed. | IMPLEMENTED | PrescriptionItem.dispensedQty |
| `PHARM-RX-019` | 619 | Remaining quantity. | IMPLEMENTED | prescribedQty minus dispensedQty, enforced on every dispense |
| `PHARM-RX-020` | 620 | Refill allowance. | IMPLEMENTED | Prescription.refillsAllowed |
| `PHARM-RX-021` | 621 | Refill tracking. | IMPLEMENTED | Prescription.refillsUsed |
| `PHARM-RX-022` | 622 | Partial dispensing. | IMPLEMENTED | dispensedQty accumulates, so a prescription can be part filled |
| `PHARM-RX-023` | 623 | Prescription status lifecycle. | IMPLEMENTED | PrescriptionStatus NEW VERIFIED PARTIALLY_DISPENSED DISPENSED REJECTED CANCELLED EXPIRED |
| `PHARM-RX-024` | 624 | Pharmacist verification. | IMPLEMENTED | prescriptions/:id/review with reviewedById |
| `PHARM-RX-025` | 625 | Prescription rejection reasons. | IMPLEMENTED | Prescription.rejectionReason |
| `PHARM-RX-026` | 626 | Prescription cancellation. | IMPLEMENTED | PrescriptionStatus CANCELLED |
| `PHARM-RX-027` | 627 | Prescription amendment history. | PARTIALLY IMPLEMENTED | every change is in the audit chain; there is no amendment document |
| `PHARM-RX-028` | 628 | Dispensing queue. | IMPLEMENTED | the prescriptions queue filtered by status |
| `PHARM-RX-029` | 629 | Dispensing priority. | PARTIALLY IMPLEMENTED | the queue orders by age; there is no priority field |
| `PHARM-RX-030` | 630 | FEFO dispensing. | IMPLEMENTED | dispensing allocates through the FEFO service |
| `PHARM-RX-031` | 631 | Batch scan before dispensing. | IMPLEMENTED | the scan endpoint verifies the batch before dispensing |
| `PHARM-RX-032` | 632 | Product scan verification. | IMPLEMENTED | the scanned product is checked against the prescription line |
| `PHARM-RX-033` | 633 | Patient verification. | IMPLEMENTED | the patient on the dispensing is checked against the prescription |
| `PHARM-RX-034` | 634 | Quantity verification. | IMPLEMENTED | quantity is checked against what remains on the line |
| `PHARM-RX-035` | 635 | Dispensing-label generation. | IMPLEMENTED | dispensing labels print per item |
| `PHARM-RX-036` | 636 | Patient-instruction printing. | IMPLEMENTED | PrescriptionItem.instructions print on the label |
| `PHARM-RX-037` | 637 | Dispensing receipt. | IMPLEMENTED | the dispensing-record document |
| `PHARM-RX-038` | 638 | Dispensing audit trail. | IMPLEMENTED | every dispensing is written to the audit chain |
| `PHARM-RX-039` | 639 | Dispensing reversal workflow. | PARTIALLY IMPLEMENTED | a dispensing is corrected by a return to stock; there is no reversal document |
| `PHARM-RX-040` | 640 | Wrong-item prevention. | IMPLEMENTED | the product must match the prescription line |
| `PHARM-RX-041` | 641 | Wrong-strength warning. | PARTIALLY IMPLEMENTED | a different strength is a different product and is refused; there is no strength-similarity warning |
| `PHARM-RX-042` | 642 | Duplicate-dispense detection. | IMPLEMENTED | dispensing beyond the prescribed quantity is refused |
| `PHARM-RX-043` | 643 | Early-refill warning. | IMPLEMENTED | the dispensing.minRefillIntervalDays setting refuses an early refill |
| `PHARM-RX-044` | 644 | Maximum-quantity enforcement. | IMPLEMENTED | Product.maxDispenseQty is enforced |
| `PHARM-RX-045` | 645 | Prescription attachment retention. | IMPLEMENTED | prescription documents are retained and linked |
| `PHARM-RX-046` | 646 | Pharmacist notes. | IMPLEMENTED | the dispensing carries pharmacist notes |
| `PHARM-RX-047` | 647 | Dispensing timeline. | IMPLEMENTED | TimelineService PATIENT shows the dispensing history |
| `PHARM-RX-048` | 648 | Prescription search. | IMPLEMENTED | prescriptions list plus global search |
| `PHARM-RX-049` | 649 | Dispensing analytics. | PARTIALLY IMPLEMENTED | dispensings are reportable through the report builder and the prescriptions report |
| `PHARM-RX-050` | 650 | Pharmacy workload dashboard. | PARTIALLY IMPLEMENTED | the queue shows outstanding work; there is no workload dashboard |

## Pack 14 — PATIENT & CUSTOMER CRM

33 implemented, 6 partial, 11 not implemented. Specification: `specs/23-patients/`.

| Requirement | # | Feature | Status | Evidence |
| --- | ---: | --- | --- | --- |
| `PHARM-CRM-001` | 651 | Patient profiles. | IMPLEMENTED | Patient model |
| `PHARM-CRM-002` | 652 | Customer profiles. | IMPLEMENTED | Patient.patientType INDIVIDUAL or organisation |
| `PHARM-CRM-003` | 653 | Unique patient identifiers. | IMPLEMENTED | Patient.patientCode unique |
| `PHARM-CRM-004` | 654 | Contact details. | IMPLEMENTED | phone, email, addressLine, city |
| `PHARM-CRM-005` | 655 | Date-of-birth records. | IMPLEMENTED | Patient.dateOfBirth |
| `PHARM-CRM-006` | 656 | Configurable demographic fields. | PARTIALLY IMPLEMENTED | the field set is fixed; product attributes are configurable but patient fields are not |
| `PHARM-CRM-007` | 657 | Preferred language. | IMPLEMENTED | Patient.preferredLanguage |
| `PHARM-CRM-008` | 658 | Communication preferences. | IMPLEMENTED | Patient.communicationPrefs |
| `PHARM-CRM-009` | 659 | Emergency contact. | IMPLEMENTED | emergencyContactName and emergencyContactPhone |
| `PHARM-CRM-010` | 660 | Patient consent records. | IMPLEMENTED | PatientConsent model |
| `PHARM-CRM-011` | 661 | Consent versioning. | IMPLEMENTED | PatientConsent.version |
| `PHARM-CRM-012` | 662 | Consent withdrawal. | IMPLEMENTED | PatientConsent.withdrawnAt |
| `PHARM-CRM-013` | 663 | Patient prescription history. | IMPLEMENTED | patients/:id/history includes prescriptions |
| `PHARM-CRM-014` | 664 | Patient dispensing history. | IMPLEMENTED | patients/:id/history includes dispensings |
| `PHARM-CRM-015` | 665 | Purchase history. | IMPLEMENTED | patients/:id/history includes sales |
| `PHARM-CRM-016` | 666 | Return history. | IMPLEMENTED | returns are linked to the sale and appear in the history |
| `PHARM-CRM-017` | 667 | Loyalty profile. | IMPLEMENTED | loyaltyPoints, loyaltyTier and customerGroupId |
| `PHARM-CRM-018` | 668 | Loyalty points. | IMPLEMENTED | Patient.loyaltyPoints |
| `PHARM-CRM-019` | 669 | Loyalty tiers. | IMPLEMENTED | Patient.loyaltyTier |
| `PHARM-CRM-020` | 670 | Customer segmentation. | IMPLEMENTED | CustomerGroup with a standing discount |
| `PHARM-CRM-021` | 671 | Corporate customers. | IMPLEMENTED | patientType with organizationName |
| `PHARM-CRM-022` | 672 | Institutional customers. | IMPLEMENTED | patientType with organizationName |
| `PHARM-CRM-023` | 673 | Insurance profile. | IMPLEMENTED | insuranceProvider and insuranceMemberNo |
| `PHARM-CRM-024` | 674 | Employer account. | IMPLEMENTED | Patient.employerName |
| `PHARM-CRM-025` | 675 | Credit-account management. | IMPLEMENTED | creditLimit and creditBalance with CREDIT payments |
| `PHARM-CRM-026` | 676 | Credit limits. | IMPLEMENTED | Patient.creditLimit |
| `PHARM-CRM-027` | 677 | Outstanding balances. | IMPLEMENTED | Patient.creditBalance |
| `PHARM-CRM-028` | 678 | Payment history. | IMPLEMENTED | payments are linked to sales and appear in the patient history |
| `PHARM-CRM-029` | 679 | Patient communication log. | PARTIALLY IMPLEMENTED | notifications are recorded per user; there is no per-patient communication log |
| `PHARM-CRM-030` | 680 | Appointment/reminder integration. | NOT IMPLEMENTED | no appointment or reminder scheduling |
| `PHARM-CRM-031` | 681 | Refill reminders. | NOT IMPLEMENTED | no refill reminder job |
| `PHARM-CRM-032` | 682 | Pickup notifications. | NOT IMPLEMENTED | no pickup notification |
| `PHARM-CRM-033` | 683 | Ready-for-collection status. | NOT IMPLEMENTED | no ready-for-collection status |
| `PHARM-CRM-034` | 684 | Delivery request. | NOT IMPLEMENTED | no delivery request |
| `PHARM-CRM-035` | 685 | Delivery address management. | PARTIALLY IMPLEMENTED | one address per patient; no address book |
| `PHARM-CRM-036` | 686 | Customer notes. | IMPLEMENTED | Patient.notes |
| `PHARM-CRM-037` | 687 | Restricted-note permissions. | PARTIALLY IMPLEMENTED | patient reads need sales.patient.READ; notes are not separately restricted |
| `PHARM-CRM-038` | 688 | Patient document attachments. | IMPLEMENTED | Document entityType PATIENT through the generic store |
| `PHARM-CRM-039` | 689 | Duplicate patient detection. | NOT IMPLEMENTED | no duplicate detection |
| `PHARM-CRM-040` | 690 | Patient merge workflow. | NOT IMPLEMENTED | mergedIntoId exists on the model but no merge workflow sets it |
| `PHARM-CRM-041` | 691 | Data correction history. | IMPLEMENTED | every patient edit is in the audit chain with old and new values |
| `PHARM-CRM-042` | 692 | Data export controls. | IMPLEMENTED | patient exports need the EXPORT permission and are themselves audited |
| `PHARM-CRM-043` | 693 | Account anonymization workflow. | NOT IMPLEMENTED | isAnonymized and anonymizedAt exist on the model but nothing sets them |
| `PHARM-CRM-044` | 694 | Retention-policy engine. | NOT IMPLEMENTED | no retention policy engine |
| `PHARM-CRM-045` | 695 | Privacy-access auditing. | IMPLEMENTED | reading patient data through a report is audited as a sensitive export |
| `PHARM-CRM-046` | 696 | Patient portal readiness. | PARTIALLY IMPLEMENTED | FHIR Patient read and search make a portal possible; there is no portal |
| `PHARM-CRM-047` | 697 | Customer satisfaction survey. | NOT IMPLEMENTED | no satisfaction survey |
| `PHARM-CRM-048` | 698 | Complaint tracking. | PARTIALLY IMPLEMENTED | a complaint can be raised as a quality incident; there is no complaint entity |
| `PHARM-CRM-049` | 699 | Customer lifetime-value analytics. | NOT IMPLEMENTED | no lifetime-value analytics |
| `PHARM-CRM-050` | 700 | Patient/customer 360-degree view. | IMPLEMENTED | patients/:id/history plus TimelineService PATIENT give the combined view |

## Pack 15 — RECALL, RETURN & DISPOSAL

43 implemented, 6 partial, 1 not implemented. Specification: `specs/25-recalls/`.

| Requirement | # | Feature | Status | Evidence |
| --- | ---: | --- | --- | --- |
| `PHARM-RECALL-001` | 701 | Product recall records. | IMPLEMENTED | Recall.productId |
| `PHARM-RECALL-002` | 702 | Batch recall records. | IMPLEMENTED | RecallBatch links the affected batches |
| `PHARM-RECALL-003` | 703 | Serial recall records. | PARTIALLY IMPLEMENTED | Recall.serialRangeFrom and serialRangeTo are recorded; nothing matches serials against them |
| `PHARM-RECALL-004` | 704 | Manufacturer recall notices. | IMPLEMENTED | Recall.manufacturerName |
| `PHARM-RECALL-005` | 705 | Regulatory recall notices. | IMPLEMENTED | Recall.regulatoryReference |
| `PHARM-RECALL-006` | 706 | Internal recall notices. | IMPLEMENTED | a recall can be raised with no regulatory reference |
| `PHARM-RECALL-007` | 707 | Recall severity levels. | IMPLEMENTED | RecallSeverity CLASS_I CLASS_II CLASS_III |
| `PHARM-RECALL-008` | 708 | Recall reason classification. | IMPLEMENTED | Recall.reason plus severity |
| `PHARM-RECALL-009` | 709 | Immediate stock blocking. | IMPLEMENTED | activation blocks the batches in the same transaction that creates the recall |
| `PHARM-RECALL-010` | 710 | Recall inventory search. | IMPLEMENTED | the recall snapshots quantity in stock at activation |
| `PHARM-RECALL-011` | 711 | Multi-branch recall search. | IMPLEMENTED | the snapshot and the tasks cover every branch holding the batch |
| `PHARM-RECALL-012` | 712 | Historical dispensing search. | IMPLEMENTED | traceBatch reports every dispensing of the batch |
| `PHARM-RECALL-013` | 713 | Historical sales search. | IMPLEMENTED | traceBatch reports retail sales too, with a note about un-contactable walk-in customers |
| `PHARM-RECALL-014` | 714 | Customer notification lists. | IMPLEMENTED | one NOTIFY_PATIENT task per affected patient |
| `PHARM-RECALL-015` | 715 | Recall task generation. | IMPLEMENTED | tasks are generated per holding location and per patient |
| `PHARM-RECALL-016` | 716 | Recall recovery tracking. | IMPLEMENTED | RecallTask.quantityRecovered |
| `PHARM-RECALL-017` | 717 | Recall outstanding tracking. | IMPLEMENTED | quantity minus quantityRecovered is what is still outstanding |
| `PHARM-RECALL-018` | 718 | Recall return tracking. | IMPLEMENTED | task type RETURN_TO_SUPPLIER |
| `PHARM-RECALL-019` | 719 | Recall disposal tracking. | IMPLEMENTED | task type DESTROY, which feeds the disposal module |
| `PHARM-RECALL-020` | 720 | Recall completion percentage. | IMPLEMENTED | recovered against affected quantity across the tasks |
| `PHARM-RECALL-021` | 721 | Recall effectiveness checks. | PARTIALLY IMPLEMENTED | the completion percentage is the effectiveness measure; there is no separate effectiveness check |
| `PHARM-RECALL-022` | 722 | Recall closeout approval. | IMPLEMENTED | recalls/:id/close needs quality.recall.APPROVE |
| `PHARM-RECALL-023` | 723 | Recall report generation. | IMPLEMENTED | the recall-report document |
| `PHARM-RECALL-024` | 724 | Customer returns. | IMPLEMENTED | ReturnType CUSTOMER |
| `PHARM-RECALL-025` | 725 | Supplier returns. | IMPLEMENTED | ReturnType SUPPLIER |
| `PHARM-RECALL-026` | 726 | Warehouse returns. | IMPLEMENTED | returns are raised against a warehouse |
| `PHARM-RECALL-027` | 727 | Branch returns. | IMPLEMENTED | returns are raised against a branch |
| `PHARM-RECALL-028` | 728 | Return reason codes. | IMPLEMENTED | ReturnDocument.reason and per-item condition |
| `PHARM-RECALL-029` | 729 | Return inspection. | IMPLEMENTED | returns/:id/inspect with inspectedById |
| `PHARM-RECALL-030` | 730 | Restock approval. | IMPLEMENTED | inspection decides restock, and only saleable stock goes back |
| `PHARM-RECALL-031` | 731 | Return quarantine. | IMPLEMENTED | returned stock lands quarantined until inspected |
| `PHARM-RECALL-032` | 732 | Return destruction. | IMPLEMENTED | a rejected return routes to disposal |
| `PHARM-RECALL-033` | 733 | Return supplier credit note. | IMPLEMENTED | a supplier return raises a credit note |
| `PHARM-RECALL-034` | 734 | Expired-product disposal. | IMPLEMENTED | disposal of expired stock |
| `PHARM-RECALL-035` | 735 | Damaged-product disposal. | IMPLEMENTED | disposal of damaged stock |
| `PHARM-RECALL-036` | 736 | Recalled-product disposal. | IMPLEMENTED | disposal of recalled stock |
| `PHARM-RECALL-037` | 737 | Disposal approval. | IMPLEMENTED | disposals/:id/approve |
| `PHARM-RECALL-038` | 738 | Disposal witness. | IMPLEMENTED | Disposal.witnessName |
| `PHARM-RECALL-039` | 739 | Disposal vendor tracking. | PARTIALLY IMPLEMENTED | the disposal method is recorded; there is no vendor entity |
| `PHARM-RECALL-040` | 740 | Disposal-method records. | IMPLEMENTED | Disposal.method |
| `PHARM-RECALL-041` | 741 | Disposal certificate. | IMPLEMENTED | Disposal.certificateNo and certificateUrl plus the certificate document |
| `PHARM-RECALL-042` | 742 | Disposal photos. | PARTIALLY IMPLEMENTED | photos attach as DISPOSAL documents; there is no capture step |
| `PHARM-RECALL-043` | 743 | Disposal costs. | IMPLEMENTED | Disposal.totalCostValue |
| `PHARM-RECALL-044` | 744 | Environmental-disposal records. | PARTIALLY IMPLEMENTED | DisposalMethod covers incineration and landfill; there is no environmental return record |
| `PHARM-RECALL-045` | 745 | Disposal audit logs. | IMPLEMENTED | every disposal step is written to the audit chain |
| `PHARM-RECALL-046` | 746 | Recall KPI dashboard. | PARTIALLY IMPLEMENTED | recall progress is on the command centre; there is no recall KPI dashboard |
| `PHARM-RECALL-047` | 747 | Return-rate dashboard. | IMPLEMENTED | Supplier.returnRate plus the returns report |
| `PHARM-RECALL-048` | 748 | Waste-value dashboard. | IMPLEMENTED | the waste-disposal report and the disposal value KPI |
| `PHARM-RECALL-049` | 749 | Recall simulation/drill mode. | NOT IMPLEMENTED | no drill or simulation mode |
| `PHARM-RECALL-050` | 750 | Recall command center. | IMPLEMENTED | the command centre carries open recalls and their outstanding tasks |

## Pack 16 — COLD CHAIN & IoT

29 implemented, 12 partial, 9 not implemented. Specification: `specs/28-cold-chain/`.

| Requirement | # | Feature | Status | Evidence |
| --- | ---: | --- | --- | --- |
| `PHARM-COLD-001` | 751 | Temperature-sensitive inventory. | IMPLEMENTED | Product.isColdChain and isRefrigerated |
| `PHARM-COLD-002` | 752 | Product temperature ranges. | IMPLEMENTED | Product.minTempC and maxTempC |
| `PHARM-COLD-003` | 753 | Product humidity ranges. | IMPLEMENTED | Product.minHumidityPercent and maxHumidityPercent |
| `PHARM-COLD-004` | 754 | Refrigeration equipment records. | PARTIALLY IMPLEMENTED | modelled as a sensor and a location with a storage condition; there is no equipment entity |
| `PHARM-COLD-005` | 755 | Freezer equipment records. | PARTIALLY IMPLEMENTED | as above, a freezer is a FROZEN location with a sensor |
| `PHARM-COLD-006` | 756 | Cold-room records. | PARTIALLY IMPLEMENTED | as above, a cold room is a COLD location with a sensor |
| `PHARM-COLD-007` | 757 | Temperature sensor registry. | IMPLEMENTED | TemperatureSensor registry |
| `PHARM-COLD-008` | 758 | Humidity sensor registry. | PARTIALLY IMPLEMENTED | humidity arrives on the same sensor reading; there is no separate humidity sensor type |
| `PHARM-COLD-009` | 759 | Sensor calibration history. | NOT IMPLEMENTED | no calibration history |
| `PHARM-COLD-010` | 760 | Sensor calibration expiration. | NOT IMPLEMENTED | no calibration expiry |
| `PHARM-COLD-011` | 761 | IoT gateway support. | IMPLEMENTED | cold-chain/readings accepts gateway posts, gated by feature.iotIngest |
| `PHARM-COLD-012` | 762 | Sensor API ingestion. | IMPLEMENTED | POST cold-chain/readings, also reachable with an API key |
| `PHARM-COLD-013` | 763 | Scheduled temperature imports. | PARTIALLY IMPLEMENTED | readings can be posted in bulk at any time; there is no scheduled import |
| `PHARM-COLD-014` | 764 | Manual temperature entry. | IMPLEMENTED | the same endpoint accepts a manual entry |
| `PHARM-COLD-015` | 765 | Real-time temperature dashboard. | IMPLEMENTED | cold-chain/live |
| `PHARM-COLD-016` | 766 | Temperature history graph. | IMPLEMENTED | the cold-chain screen charts the temperature history |
| `PHARM-COLD-017` | 767 | Humidity history graph. | PARTIALLY IMPLEMENTED | humidity is stored on every reading; the chart shows temperature |
| `PHARM-COLD-018` | 768 | High-temperature alerts. | IMPLEMENTED | a reading above maxTempC opens an excursion and alerts |
| `PHARM-COLD-019` | 769 | Low-temperature alerts. | IMPLEMENTED | a reading below minTempC opens an excursion and alerts |
| `PHARM-COLD-020` | 770 | Humidity excursion alerts. | PARTIALLY IMPLEMENTED | humidity is recorded and compared against the product range; there is no humidity excursion type |
| `PHARM-COLD-021` | 771 | Door-open alerts. | NOT IMPLEMENTED | no door sensor |
| `PHARM-COLD-022` | 772 | Power-loss alerts. | NOT IMPLEMENTED | no power-loss signal |
| `PHARM-COLD-023` | 773 | Sensor-offline alerts. | IMPLEMENTED | the health check reports a sensor silent beyond coldchain.sensorOfflineMinutes |
| `PHARM-COLD-024` | 774 | Refrigerator-failure alerts. | PARTIALLY IMPLEMENTED | an offline or breaching sensor is reported; failure is not classified as equipment failure |
| `PHARM-COLD-025` | 775 | Excursion start detection. | IMPLEMENTED | the first breaching reading opens the excursion |
| `PHARM-COLD-026` | 776 | Excursion end detection. | IMPLEMENTED | a reading back in range closes it |
| `PHARM-COLD-027` | 777 | Excursion-duration calculation. | IMPLEMENTED | TemperatureExcursion.durationMinutes |
| `PHARM-COLD-028` | 778 | Maximum temperature recording. | IMPLEMENTED | TemperatureExcursion.maxTempC |
| `PHARM-COLD-029` | 779 | Minimum temperature recording. | IMPLEMENTED | TemperatureExcursion.minTempC |
| `PHARM-COLD-030` | 780 | Products-at-risk identification. | IMPLEMENTED | affected products are resolved from the stock at that location |
| `PHARM-COLD-031` | 781 | Batches-at-risk identification. | IMPLEMENTED | TemperatureExcursion.affectedBatchIds and affectedQuantity |
| `PHARM-COLD-032` | 782 | Automatic affected-stock quarantine. | IMPLEMENTED | stock is quarantined automatically when the breach outlasts the tolerance |
| `PHARM-COLD-033` | 783 | QA excursion assessment. | IMPLEMENTED | ExcursionDisposition PENDING until QA decides |
| `PHARM-COLD-034` | 784 | Excursion investigation. | IMPLEMENTED | TemperatureExcursion.investigation |
| `PHARM-COLD-035` | 785 | Corrective-action tracking. | IMPLEMENTED | TemperatureExcursion.correctiveAction |
| `PHARM-COLD-036` | 786 | Release decision. | IMPLEMENTED | disposition RELEASED, which needs quality.cold_chain.APPROVE |
| `PHARM-COLD-037` | 787 | Reject decision. | IMPLEMENTED | disposition REJECTED |
| `PHARM-COLD-038` | 788 | Destruction decision. | IMPLEMENTED | disposition DESTROYED, feeding disposal |
| `PHARM-COLD-039` | 789 | Cold-chain transfer monitoring. | NOT IMPLEMENTED | no in-transit cold-chain monitoring |
| `PHARM-COLD-040` | 790 | Delivery temperature logging. | PARTIALLY IMPLEMENTED | ShipmentPackage.departureTempC records the temperature a box left at; nothing logs the journey |
| `PHARM-COLD-041` | 791 | Temperature-log exports. | IMPLEMENTED | the cold-chain report exports the log |
| `PHARM-COLD-042` | 792 | Calibration reminders. | NOT IMPLEMENTED | no calibration reminder |
| `PHARM-COLD-043` | 793 | Maintenance reminders. | NOT IMPLEMENTED | no maintenance reminder |
| `PHARM-COLD-044` | 794 | Equipment service history. | NOT IMPLEMENTED | no equipment service history |
| `PHARM-COLD-045` | 795 | Backup refrigeration location. | NOT IMPLEMENTED | no backup refrigeration location |
| `PHARM-COLD-046` | 796 | Cold-chain emergency workflow. | PARTIALLY IMPLEMENTED | an excursion quarantines stock and raises an incident; there is no emergency runbook |
| `PHARM-COLD-047` | 797 | Temperature compliance KPI. | IMPLEMENTED | the health score cold-chain factor |
| `PHARM-COLD-048` | 798 | Excursion-frequency KPI. | PARTIALLY IMPLEMENTED | excursions are counted and reportable; there is no frequency KPI |
| `PHARM-COLD-049` | 799 | Cold-chain performance dashboard. | PARTIALLY IMPLEMENTED | the cold-chain screen shows live status, excursions and history |
| `PHARM-COLD-050` | 800 | IoT device health dashboard. | IMPLEMENTED | system health reports every sensor and how long each has been silent |

## Pack 17 — CONTROLLED MEDICINES & COMPLIANCE

35 implemented, 9 partial, 6 not implemented. Specification: `specs/27-controlled-drugs/`.

| Requirement | # | Feature | Status | Evidence |
| --- | ---: | --- | --- | --- |
| `PHARM-CTRL-001` | 801 | Controlled-medicine register. | IMPLEMENTED | ControlledRegisterEntry with an autoincrement entry number |
| `PHARM-CTRL-002` | 802 | Configurable control schedules. | IMPLEMENTED | Product.controlledSchedule plus the compliance settings group |
| `PHARM-CTRL-003` | 803 | Restricted permissions. | IMPLEMENTED | dispensing.controlled.READ and EDIT gate the register |
| `PHARM-CTRL-004` | 804 | Dual authorization. | IMPLEMENTED | controlled.requireDualAuthorization refuses a register entry with no witness |
| `PHARM-CTRL-005` | 805 | Secure storage location controls. | IMPLEMENTED | locationType CONTROLLED, enforced on put-away for controlled products |
| `PHARM-CTRL-006` | 806 | Controlled stock receiving. | IMPLEMENTED | receipt writes a RECEIPT register entry |
| `PHARM-CTRL-007` | 807 | Controlled stock dispensing. | IMPLEMENTED | dispensing writes a DISPENSE entry |
| `PHARM-CTRL-008` | 808 | Controlled stock transfer. | PARTIALLY IMPLEMENTED | a controlled transfer moves stock and is audited; it writes no register entry |
| `PHARM-CTRL-009` | 809 | Controlled stock returns. | IMPLEMENTED | entryType RETURN |
| `PHARM-CTRL-010` | 810 | Controlled stock destruction. | IMPLEMENTED | entryType DESTRUCTION with a witness |
| `PHARM-CTRL-011` | 811 | Prescription-reference requirement. | IMPLEMENTED | the register entry carries prescriptionId |
| `PHARM-CTRL-012` | 812 | Prescriber-reference requirement. | IMPLEMENTED | the register entry carries prescriberName |
| `PHARM-CTRL-013` | 813 | Patient-reference requirement. | IMPLEMENTED | the register entry carries patientId |
| `PHARM-CTRL-014` | 814 | Running controlled balance. | IMPLEMENTED | ControlledRegisterEntry.runningBalance |
| `PHARM-CTRL-015` | 815 | Controlled batch tracking. | IMPLEMENTED | every entry carries batchId |
| `PHARM-CTRL-016` | 816 | Controlled serial tracking. | PARTIALLY IMPLEMENTED | serials exist on batches; the register does not record a serial |
| `PHARM-CTRL-017` | 817 | Daily reconciliation. | IMPLEMENTED | controlled-register/reconcile |
| `PHARM-CTRL-018` | 818 | Shift reconciliation. | PARTIALLY IMPLEMENTED | reconciliation runs on demand for any window; there is no shift construct |
| `PHARM-CTRL-019` | 819 | Physical controlled count. | PARTIALLY IMPLEMENTED | a stock count covers controlled products; there is no controlled-specific count |
| `PHARM-CTRL-020` | 820 | Variance alerts. | IMPLEMENTED | the CONTROLLED_VARIANCE automation rule |
| `PHARM-CTRL-021` | 821 | Zero-tolerance variance option. | IMPLEMENTED | controlled.varianceTolerance defaults to zero and reconciliation reports against it |
| `PHARM-CTRL-022` | 822 | Variance investigation. | IMPLEMENTED | reconciliation reports the variance for investigation rather than fixing it |
| `PHARM-CTRL-023` | 823 | Supervisor escalation. | IMPLEMENTED | the CONTROLLED_VARIANCE rule escalates |
| `PHARM-CTRL-024` | 824 | Immutable controlled ledger. | IMPLEMENTED | the register is append-only |
| `PHARM-CTRL-025` | 825 | Correction-by-reversal only. | IMPLEMENTED | a correction appends a REVERSAL row pointing at the entry it cancels |
| `PHARM-CTRL-026` | 826 | No silent deletion. | IMPLEMENTED | nothing deletes a register row |
| `PHARM-CTRL-027` | 827 | Controlled register printout. | IMPLEMENTED | the controlled-register report prints |
| `PHARM-CTRL-028` | 828 | Controlled register export restrictions. | IMPLEMENTED | export needs dispensing.controlled.EXPORT and the export is audited |
| `PHARM-CTRL-029` | 829 | Controlled access logs. | IMPLEMENTED | every register read and write is in the audit chain |
| `PHARM-CTRL-030` | 830 | Suspicious transaction alerts. | NOT IMPLEMENTED | no suspicious-transaction detection |
| `PHARM-CTRL-031` | 831 | Excess-quantity alerts. | PARTIALLY IMPLEMENTED | Product.maxDispenseQty caps a single dispense; there is no excess-quantity alert |
| `PHARM-CTRL-032` | 832 | Unusual-frequency alerts. | NOT IMPLEMENTED | no frequency-anomaly alert |
| `PHARM-CTRL-033` | 833 | Repeated-void alerts. | NOT IMPLEMENTED | no repeated-void alert |
| `PHARM-CTRL-034` | 834 | After-hours access alerts. | NOT IMPLEMENTED | no after-hours access alert |
| `PHARM-CTRL-035` | 835 | Controlled stockout alert. | IMPLEMENTED | the STOCKOUT automation rule covers controlled products |
| `PHARM-CTRL-036` | 836 | Controlled expiry tracking. | IMPLEMENTED | controlled batches follow the same expiry rules and appear in the expiry report |
| `PHARM-CTRL-037` | 837 | Controlled waste tracking. | IMPLEMENTED | entryType DESTRUCTION plus the disposal module |
| `PHARM-CTRL-038` | 838 | Witnessed destruction. | IMPLEMENTED | Disposal.witnessName and the register witness |
| `PHARM-CTRL-039` | 839 | Witness digital signatures. | PARTIALLY IMPLEMENTED | the witness is named and recorded against the user; there is no signature capture |
| `PHARM-CTRL-040` | 840 | Compliance document management. | IMPLEMENTED | the document store with expiry tracking |
| `PHARM-CTRL-041` | 841 | License-expiry reminders. | IMPLEMENTED | the documents.expiryAlerts job and the SUPPLIER_LICENCE rule |
| `PHARM-CTRL-042` | 842 | Inspection readiness dashboard. | PARTIALLY IMPLEMENTED | the audit verify endpoint, the controlled register and system health cover it; there is no readiness dashboard |
| `PHARM-CTRL-043` | 843 | Compliance checklist. | NOT IMPLEMENTED | no compliance checklist |
| `PHARM-CTRL-044` | 844 | Compliance incident reporting. | IMPLEMENTED | the quality incident module |
| `PHARM-CTRL-045` | 845 | Corrective actions. | IMPLEMENTED | CAPA corrective action, enforced as a stage |
| `PHARM-CTRL-046` | 846 | Preventive actions. | IMPLEMENTED | CAPA preventive action, enforced as a stage |
| `PHARM-CTRL-047` | 847 | Compliance audit calendar. | NOT IMPLEMENTED | no audit calendar |
| `PHARM-CTRL-048` | 848 | Configurable jurisdiction rules. | IMPLEMENTED | the compliance settings group holds the jurisdiction rules as configuration |
| `PHARM-CTRL-049` | 849 | Compliance KPI dashboard. | PARTIALLY IMPLEMENTED | compliance figures appear in the health score and KPIs; there is no compliance dashboard |
| `PHARM-CTRL-050` | 850 | Controlled-drug command center. | PARTIALLY IMPLEMENTED | the register, reconciliation and variance rules cover it; there is no dedicated command centre |

## Pack 18 — REPORTING, ANALYTICS & AI

41 implemented, 4 partial, 5 not implemented. Specification: `specs/31-analytics/`.

| Requirement | # | Feature | Status | Evidence |
| --- | ---: | --- | --- | --- |
| `PHARM-ANLY-001` | 851 | Executive dashboard. | IMPLEMENTED | the dashboard with the health score, cards and charts |
| `PHARM-ANLY-002` | 852 | Inventory value dashboard. | IMPLEMENTED | inventory value on the dashboard and in the valuation report |
| `PHARM-ANLY-003` | 853 | Inventory quantity dashboard. | IMPLEMENTED | stock quantity cards and the balances screen |
| `PHARM-ANLY-004` | 854 | Sales dashboard. | IMPLEMENTED | sales figures on the dashboard and the sales report |
| `PHARM-ANLY-005` | 855 | Gross-profit dashboard. | IMPLEMENTED | gross margin in the KPIs and the profitability report |
| `PHARM-ANLY-006` | 856 | Purchase dashboard. | IMPLEMENTED | purchase figures in the KPIs and the purchases report |
| `PHARM-ANLY-007` | 857 | Expiry dashboard. | IMPLEMENTED | expiry cards, buckets and value at risk |
| `PHARM-ANLY-008` | 858 | Stockout dashboard. | IMPLEMENTED | out-of-stock card and the out-of-stock report |
| `PHARM-ANLY-009` | 859 | Low-stock dashboard. | IMPLEMENTED | low-stock card and the low-stock report |
| `PHARM-ANLY-010` | 860 | Dead-stock dashboard. | IMPLEMENTED | analytics/dead-stock and the dead-stock report |
| `PHARM-ANLY-011` | 861 | Slow-moving inventory. | IMPLEMENTED | slow-moving chart and report |
| `PHARM-ANLY-012` | 862 | Fast-moving inventory. | IMPLEMENTED | fast-moving chart and report |
| `PHARM-ANLY-013` | 863 | ABC analysis. | IMPLEMENTED | analytics/abc-xyz with classifyAbc |
| `PHARM-ANLY-014` | 864 | XYZ analysis. | IMPLEMENTED | classifyXyz with coefficient of variation |
| `PHARM-ANLY-015` | 865 | ABC-XYZ matrix. | IMPLEMENTED | the combined ABC-XYZ matrix |
| `PHARM-ANLY-016` | 866 | Inventory-turnover calculation. | IMPLEMENTED | shared/analytics.ts stockTurnover |
| `PHARM-ANLY-017` | 867 | Days inventory outstanding. | IMPLEMENTED | daysInventoryOutstanding |
| `PHARM-ANLY-018` | 868 | Days-of-cover calculation. | IMPLEMENTED | days of cover in the STOCK_LEVEL trigger and replenishment |
| `PHARM-ANLY-019` | 869 | Fill-rate calculation. | IMPLEMENTED | fillRate |
| `PHARM-ANLY-020` | 870 | Service-level calculation. | PARTIALLY IMPLEMENTED | fill rate and stockout rate are the service measures; there is no separate service level |
| `PHARM-ANLY-021` | 871 | Stockout-rate calculation. | IMPLEMENTED | stockOutRate |
| `PHARM-ANLY-022` | 872 | Inventory-accuracy calculation. | IMPLEMENTED | inventoryAccuracy |
| `PHARM-ANLY-023` | 873 | Shrinkage calculation. | IMPLEMENTED | shrinkage |
| `PHARM-ANLY-024` | 874 | Expiry-rate calculation. | IMPLEMENTED | expiryRate |
| `PHARM-ANLY-025` | 875 | Waste-rate calculation. | PARTIALLY IMPLEMENTED | disposal value is reported; there is no waste-rate ratio |
| `PHARM-ANLY-026` | 876 | Gross-margin calculation. | IMPLEMENTED | grossMargin |
| `PHARM-ANLY-027` | 877 | Supplier KPI analytics. | IMPLEMENTED | suppliers/performance and the supplier-performance report |
| `PHARM-ANLY-028` | 878 | Branch KPI analytics. | IMPLEMENTED | the branch-performance report |
| `PHARM-ANLY-029` | 879 | Warehouse KPI analytics. | IMPLEMENTED | warehouse occupancy, task productivity and exceptions |
| `PHARM-ANLY-030` | 880 | Pharmacist productivity analytics. | PARTIALLY IMPLEMENTED | dispensings per pharmacist are reportable; there is no productivity view |
| `PHARM-ANLY-031` | 881 | Cashier productivity analytics. | PARTIALLY IMPLEMENTED | sales per cashier are reportable; there is no productivity view |
| `PHARM-ANLY-032` | 882 | Demand forecasting. | IMPLEMENTED | the forecast service over the sales and dispensing history |
| `PHARM-ANLY-033` | 883 | Moving-average forecast. | IMPLEMENTED | movingAverage |
| `PHARM-ANLY-034` | 884 | Weighted-moving-average forecast. | IMPLEMENTED | weightedMovingAverage |
| `PHARM-ANLY-035` | 885 | Exponential-smoothing forecast. | IMPLEMENTED | exponentialSmoothing |
| `PHARM-ANLY-036` | 886 | Seasonal forecast support. | IMPLEMENTED | seasonalNaive plus Product.seasonalProfile |
| `PHARM-ANLY-037` | 887 | Forecast accuracy calculation. | NOT IMPLEMENTED | no forecast accuracy measure |
| `PHARM-ANLY-038` | 888 | Forecast-versus-actual report. | NOT IMPLEMENTED | no forecast-versus-actual report |
| `PHARM-ANLY-039` | 889 | Reorder recommendations. | IMPLEMENTED | replenishment recommendations, which only ever suggest |
| `PHARM-ANLY-040` | 890 | Excess-stock prediction. | IMPLEMENTED | the redistribution engine identifies surplus above maximum stock |
| `PHARM-ANLY-041` | 891 | Stockout prediction. | IMPLEMENTED | the forecast and the STOCKOUT rule both predict a stockout |
| `PHARM-ANLY-042` | 892 | Expiry-risk prediction. | IMPLEMENTED | expiryRiskScore ranks batches by risk |
| `PHARM-ANLY-043` | 893 | Branch redistribution recommendations. | IMPLEMENTED | inventory/expiry/redistribution |
| `PHARM-ANLY-044` | 894 | Natural-language analytics assistant. | NOT IMPLEMENTED | no natural-language assistant |
| `PHARM-ANLY-045` | 895 | "Ask inventory" interface. | NOT IMPLEMENTED | no ask-inventory interface |
| `PHARM-ANLY-046` | 896 | AI explanation of recommendations. | IMPLEMENTED | every recommendation returns the inputs that produced it, in words |
| `PHARM-ANLY-047` | 897 | No autonomous high-risk approval. | IMPLEMENTED | nothing is approved automatically; the six automation actions exclude approval |
| `PHARM-ANLY-048` | 898 | Dashboard drill-down everywhere. | IMPLEMENTED | dashboard cards, health score factors and command centre rows all link through |
| `PHARM-ANLY-049` | 899 | Scheduled report delivery. | NOT IMPLEMENTED | SavedReport stores a schedule and recipients but no job delivers them |
| `PHARM-ANLY-050` | 900 | Custom report builder. | IMPLEMENTED | the report builder over a whitelist of sources and columns |

## Pack 19 — SECURITY, AUDIT & ENTERPRISE ADMINISTRATION

41 implemented, 6 partial, 3 not implemented. Specification: `specs/42-security/`.

| Requirement | # | Feature | Status | Evidence |
| --- | ---: | --- | --- | --- |
| `PHARM-SEC-001` | 901 | Secure authentication. | IMPLEMENTED | bcrypt hashing with JWT access and refresh tokens |
| `PHARM-SEC-002` | 902 | Role-based access control. | IMPLEMENTED | roles carry permissions and every controller declares what it needs |
| `PHARM-SEC-003` | 903 | Custom roles. | IMPLEMENTED | roles are data; an administrator can create one and choose its permissions |
| `PHARM-SEC-004` | 904 | Fine-grained permissions. | IMPLEMENTED | 198 permissions coded module.resource.ACTION |
| `PHARM-SEC-005` | 905 | Branch-level permissions. | IMPLEMENTED | UserScope branch assignments applied inside every query |
| `PHARM-SEC-006` | 906 | Warehouse-level permissions. | IMPLEMENTED | UserScope warehouse assignments |
| `PHARM-SEC-007` | 907 | Product-category permissions. | NOT IMPLEMENTED | scope covers branch and warehouse, not product category |
| `PHARM-SEC-008` | 908 | Financial-data permissions. | IMPLEMENTED | finance.* permissions, with cost columns needing finance.report.READ |
| `PHARM-SEC-009` | 909 | Patient-data permissions. | IMPLEMENTED | sales.patient.* permissions, and patient exports are audited |
| `PHARM-SEC-010` | 910 | Controlled-drug permissions. | IMPLEMENTED | dispensing.controlled.* permissions |
| `PHARM-SEC-011` | 911 | Approval-level permissions. | IMPLEMENTED | APPROVE and REJECT are separate actions per resource |
| `PHARM-SEC-012` | 912 | Multi-factor authentication. | IMPLEMENTED | TOTP enrolment and confirmation with MFA_ISSUER |
| `PHARM-SEC-013` | 913 | Session management. | IMPLEMENTED | the Session table, checked on every request so a revoked session dies at once |
| `PHARM-SEC-014` | 914 | Device session list. | IMPLEMENTED | auth/sessions lists devices with last-seen |
| `PHARM-SEC-015` | 915 | Forced logout. | IMPLEMENTED | logout revokes the session immediately |
| `PHARM-SEC-016` | 916 | Password policies. | IMPLEMENTED | one password policy on change and reset, from the security.password settings |
| `PHARM-SEC-017` | 917 | Login lockout. | IMPLEMENTED | MAX_LOGIN_ATTEMPTS and LOCKOUT_MINUTES with the LoginAttempt table |
| `PHARM-SEC-018` | 918 | Rate limiting. | IMPLEMENTED | the throttler, tighter on login and password reset |
| `PHARM-SEC-019` | 919 | Brute-force protection. | IMPLEMENTED | lockout plus rate limiting plus recorded login attempts |
| `PHARM-SEC-020` | 920 | HTTPS enforcement. | PARTIALLY IMPLEMENTED | helmet sets HSTS; TLS termination is a deployment concern and is documented |
| `PHARM-SEC-021` | 921 | Secure cookies. | PARTIALLY IMPLEMENTED | tokens are held by the client rather than in cookies, so there is no cookie to harden |
| `PHARM-SEC-022` | 922 | CSRF protection. | IMPLEMENTED | no cookie authentication and CORS restricted to WEB_ORIGIN, so there is no CSRF surface |
| `PHARM-SEC-023` | 923 | XSS protection. | IMPLEMENTED | React escapes by default, no dangerouslySetInnerHTML, and helmet sets the headers |
| `PHARM-SEC-024` | 924 | SQL-injection defenses. | IMPLEMENTED | Prisma parameterises every query; the few raw queries use tagged templates |
| `PHARM-SEC-025` | 925 | Input validation. | IMPLEMENTED | a global ValidationPipe with whitelist and transform |
| `PHARM-SEC-026` | 926 | Output encoding. | IMPLEMENTED | React escaping plus CSV formula neutralisation on export |
| `PHARM-SEC-027` | 927 | Secrets management. | IMPLEMENTED | secrets come from the environment and are never returned by an endpoint |
| `PHARM-SEC-028` | 928 | Encryption-at-rest readiness. | PARTIALLY IMPLEMENTED | documented as a deployment concern; the application does not manage disk encryption |
| `PHARM-SEC-029` | 929 | Sensitive-field encryption. | NOT IMPLEMENTED | no column-level encryption |
| `PHARM-SEC-030` | 930 | Encrypted backups. | IMPLEMENTED | backups are encrypted with BACKUP_ENCRYPTION_KEY and refuse to run without it |
| `PHARM-SEC-031` | 931 | Audit trail. | IMPLEMENTED | the hash-chained audit log |
| `PHARM-SEC-032` | 932 | Old-value tracking. | IMPLEMENTED | AuditLog.previousValue |
| `PHARM-SEC-033` | 933 | New-value tracking. | IMPLEMENTED | AuditLog.newValue |
| `PHARM-SEC-034` | 934 | User tracking. | IMPLEMENTED | userId and userLabel on every row |
| `PHARM-SEC-035` | 935 | Timestamp tracking. | IMPLEMENTED | createdAt, part of the hashed content |
| `PHARM-SEC-036` | 936 | IP/device metadata where lawful. | IMPLEMENTED | ipAddress and userAgent |
| `PHARM-SEC-037` | 937 | Authentication audit logs. | IMPLEMENTED | login, logout and failed attempts are recorded |
| `PHARM-SEC-038` | 938 | Permission-change auditing. | IMPLEMENTED | role and permission changes are audited with old and new values |
| `PHARM-SEC-039` | 939 | Price-change auditing. | IMPLEMENTED | PriceHistory plus an audit row on every price change |
| `PHARM-SEC-040` | 940 | Stock-adjustment auditing. | IMPLEMENTED | every adjustment is audited with its reason |
| `PHARM-SEC-041` | 941 | Approval auditing. | IMPLEMENTED | every approval action is recorded with the actor and the step |
| `PHARM-SEC-042` | 942 | Audit-log tamper resistance. | IMPLEMENTED | SHA-256 chained hashes; admin/audit-logs/verify names the first broken sequence |
| `PHARM-SEC-043` | 943 | Security-alert dashboard. | PARTIALLY IMPLEMENTED | failed logins, sessions and the audit chain are all visible; there is no security dashboard |
| `PHARM-SEC-044` | 944 | Suspicious-login detection. | PARTIALLY IMPLEMENTED | repeated failures lock the account and are recorded; there is no anomaly detection |
| `PHARM-SEC-045` | 945 | Data retention policies. | NOT IMPLEMENTED | no retention policy engine |
| `PHARM-SEC-046` | 946 | Automatic backups. | IMPLEMENTED | the backup job runs on a schedule |
| `PHARM-SEC-047` | 947 | Backup verification. | IMPLEMENTED | every backup is verified and a tampered one fails verification |
| `PHARM-SEC-048` | 948 | Restore testing. | PARTIALLY IMPLEMENTED | a backup can be decrypted to a file and verified; restore itself is an operator procedure |
| `PHARM-SEC-049` | 949 | Disaster-recovery configuration. | IMPLEMENTED | docs/disaster-recovery.md |
| `PHARM-SEC-050` | 950 | System-health dashboard. | IMPLEMENTED | admin/health plus the system health screen |

## Pack 20 — INTEGRATION, MOBILE, AUTOMATION & PLATFORM

38 implemented, 8 partial, 4 not implemented. Specification: `specs/35-integrations/`.

| Requirement | # | Feature | Status | Evidence |
| --- | ---: | --- | --- | --- |
| `PHARM-PLAT-001` | 951 | REST API. | IMPLEMENTED | a REST API across 23 controllers and about 306 routes |
| `PHARM-PLAT-002` | 952 | OpenAPI documentation. | IMPLEMENTED | Swagger at /api/docs |
| `PHARM-PLAT-003` | 953 | API versioning. | NOT IMPLEMENTED | the prefix is /api with no version segment |
| `PHARM-PLAT-004` | 954 | API authentication. | IMPLEMENTED | bearer tokens and X-Api-Key |
| `PHARM-PLAT-005` | 955 | API authorization. | IMPLEMENTED | the same permission and scope checks apply to both |
| `PHARM-PLAT-006` | 956 | API rate limiting. | IMPLEMENTED | the throttler, plus a per-key rateLimit field |
| `PHARM-PLAT-007` | 957 | API audit logging. | PARTIALLY IMPLEMENTED | the request carries apiKeyId and key usage is counted; per-call API audit rows are not written |
| `PHARM-PLAT-008` | 958 | Webhook framework. | IMPLEMENTED | endpoints, events, signing, retry and a delivery log |
| `PHARM-PLAT-009` | 959 | Outbound webhooks. | IMPLEMENTED | fourteen events with HMAC signing and backoff |
| `PHARM-PLAT-010` | 960 | Inbound integration endpoints. | PARTIALLY IMPLEMENTED | cold-chain readings and FHIR create are the inbound endpoints; there is no generic inbound framework |
| `PHARM-PLAT-011` | 961 | HL7 FHIR interoperability layer. | IMPLEMENTED | the FHIR R4 layer |
| `PHARM-PLAT-012` | 962 | FHIR MedicationRequest mapping. | IMPLEMENTED | MedicationRequest read and create |
| `PHARM-PLAT-013` | 963 | FHIR MedicationDispense mapping. | IMPLEMENTED | MedicationDispense read, carrying batch and expiry extensions |
| `PHARM-PLAT-014` | 964 | FHIR Medication mapping. | IMPLEMENTED | Medication read and search |
| `PHARM-PLAT-015` | 965 | FHIR Patient mapping. | IMPLEMENTED | Patient read, search and create |
| `PHARM-PLAT-016` | 966 | FHIR Practitioner mapping. | IMPLEMENTED | Practitioner search |
| `PHARM-PLAT-017` | 967 | FHIR Organization mapping. | IMPLEMENTED | Organization search |
| `PHARM-PLAT-018` | 968 | EHR integration readiness. | IMPLEMENTED | FHIR plus API keys make an EHR integration possible without new code |
| `PHARM-PLAT-019` | 969 | Hospital-system integration. | IMPLEMENTED | the same FHIR surface |
| `PHARM-PLAT-020` | 970 | ERP integration. | PARTIALLY IMPLEMENTED | webhooks and API keys give an ERP a route in and out; there is no ERP-specific adapter |
| `PHARM-PLAT-021` | 971 | Accounting integration. | IMPLEMENTED | the ledger, trial balance and valuation are built in, and journals are exportable |
| `PHARM-PLAT-022` | 972 | Payment gateway adapters. | PARTIALLY IMPLEMENTED | the flag and health check exist; no adapter is written and the README says so |
| `PHARM-PLAT-023` | 973 | SMS gateway adapters. | IMPLEMENTED | the SMS adapter, disabled without credentials |
| `PHARM-PLAT-024` | 974 | Email integration. | IMPLEMENTED | the email adapter, disabled without credentials |
| `PHARM-PLAT-025` | 975 | WhatsApp integration adapter. | IMPLEMENTED | the WhatsApp Cloud API adapter |
| `PHARM-PLAT-026` | 976 | Telegram integration adapter. | IMPLEMENTED | the Telegram Bot API adapter |
| `PHARM-PLAT-027` | 977 | Barcode-scanner integration. | IMPLEMENTED | the scan endpoint plus keyboard-wedge input on the scan screen |
| `PHARM-PLAT-028` | 978 | Receipt-printer integration. | PARTIALLY IMPLEMENTED | receipts render and print through the browser; there is no thermal driver |
| `PHARM-PLAT-029` | 979 | Label-printer integration. | IMPLEMENTED | label sheets render for batches and shelf edges |
| `PHARM-PLAT-030` | 980 | IoT integration adapters. | IMPLEMENTED | cold-chain/readings accepts gateway posts, gated by feature.iotIngest |
| `PHARM-PLAT-031` | 981 | Responsive desktop interface. | IMPLEMENTED | a responsive layout across 40 pages |
| `PHARM-PLAT-032` | 982 | Tablet-optimized interface. | IMPLEMENTED | the same responsive layout |
| `PHARM-PLAT-033` | 983 | Mobile warehouse interface. | IMPLEMENTED | the scan screen and warehouse tasks work on a phone |
| `PHARM-PLAT-034` | 984 | Progressive Web App. | IMPLEMENTED | manifest, service worker and installability |
| `PHARM-PLAT-035` | 985 | Offline data queue. | IMPLEMENTED | the offline queue in localStorage |
| `PHARM-PLAT-036` | 986 | Conflict resolution. | IMPLEMENTED | a conflict is surfaced to the user, never silently retried or discarded |
| `PHARM-PLAT-037` | 987 | Synchronization status. | IMPLEMENTED | the offline bar shows queued count and connectivity |
| `PHARM-PLAT-038` | 988 | Background sync. | PARTIALLY IMPLEMENTED | the queue replays when connectivity returns; there is no Background Sync API registration |
| `PHARM-PLAT-039` | 989 | Global search. | IMPLEMENTED | cross-entity search, permission-gated per entity type |
| `PHARM-PLAT-040` | 990 | Typo-tolerant search. | NOT IMPLEMENTED | substring matching only; no trigram or fuzzy search |
| `PHARM-PLAT-041` | 991 | Saved filters. | NOT IMPLEMENTED | no saved filters |
| `PHARM-PLAT-042` | 992 | Saved views. | PARTIALLY IMPLEMENTED | saved reports persist a definition; there is no saved view on a list screen |
| `PHARM-PLAT-043` | 993 | Configurable dashboards. | NOT IMPLEMENTED | the dashboard is fixed |
| `PHARM-PLAT-044` | 994 | Notification rule engine. | IMPLEMENTED | NotificationRule plus the automation engine |
| `PHARM-PLAT-045` | 995 | Workflow rule engine. | IMPLEMENTED | WorkflowDefinition with the workflow module |
| `PHARM-PLAT-046` | 996 | Approval rule engine. | IMPLEMENTED | the approval engine with configurable thresholds and segregation of duties |
| `PHARM-PLAT-047` | 997 | Background job processing. | IMPLEMENTED | the job runner, recording every attempt |
| `PHARM-PLAT-048` | 998 | Internationalization architecture. | IMPLEMENTED | the i18n provider with message ids and a coverage report |
| `PHARM-PLAT-049` | 999 | English/Amharic/Afaan Oromo readiness. | PARTIALLY IMPLEMENTED | navigation and chrome are translated into all three; page copy is not yet extracted |
| `PHARM-PLAT-050` | 1000 | Enterprise feature-flag system. | IMPLEMENTED | thirteen flags that gate their features, with dependencies and enforcement state both reported |
