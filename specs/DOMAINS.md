# Domain specifications

One folder per domain. Each states which of the 1,000 requirements it owns,
what state they are in, and which tables and routes serve them.

| Folder | Requirements | Implemented | Partial | Not implemented |
| --- | ---: | ---: | ---: | ---: |
| [`00-foundation`](00-foundation/spec.md) | 0 | 0 | 0 | 0 |
| [`01-architecture`](01-architecture/spec.md) | 0 | 0 | 0 | 0 |
| [`02-design-system`](02-design-system/spec.md) | 0 | 0 | 0 | 0 |
| [`03-authentication`](03-authentication/spec.md) | 0 | 0 | 0 | 0 |
| [`04-users-rbac`](04-users-rbac/spec.md) | 0 | 0 | 0 | 0 |
| [`05-organizations`](05-organizations/spec.md) | 0 | 0 | 0 | 0 |
| [`06-products`](06-products/spec.md) | 100 | 94 | 5 | 1 |
| [`07-units`](07-units/spec.md) | 0 | 0 | 0 | 0 |
| [`08-batches`](08-batches/spec.md) | 50 | 38 | 12 | 0 |
| [`09-serialization`](09-serialization/spec.md) | 0 | 0 | 0 | 0 |
| [`10-inventory`](10-inventory/spec.md) | 50 | 41 | 9 | 0 |
| [`11-fefo`](11-fefo/spec.md) | 50 | 43 | 2 | 5 |
| [`12-expiry`](12-expiry/spec.md) | 0 | 0 | 0 | 0 |
| [`13-warehouse`](13-warehouse/spec.md) | 50 | 48 | 1 | 1 |
| [`14-procurement`](14-procurement/spec.md) | 50 | 30 | 6 | 14 |
| [`15-suppliers`](15-suppliers/spec.md) | 50 | 29 | 15 | 6 |
| [`16-receiving`](16-receiving/spec.md) | 50 | 33 | 9 | 8 |
| [`17-quality`](17-quality/spec.md) | 0 | 0 | 0 | 0 |
| [`18-transfers`](18-transfers/spec.md) | 50 | 37 | 8 | 5 |
| [`19-stock-counts`](19-stock-counts/spec.md) | 50 | 33 | 12 | 5 |
| [`20-pos`](20-pos/spec.md) | 50 | 37 | 9 | 4 |
| [`21-prescriptions`](21-prescriptions/spec.md) | 50 | 44 | 6 | 0 |
| [`22-dispensing`](22-dispensing/spec.md) | 0 | 0 | 0 | 0 |
| [`23-patients`](23-patients/spec.md) | 50 | 37 | 7 | 6 |
| [`24-returns`](24-returns/spec.md) | 0 | 0 | 0 | 0 |
| [`25-recalls`](25-recalls/spec.md) | 50 | 43 | 6 | 1 |
| [`26-disposal`](26-disposal/spec.md) | 0 | 0 | 0 | 0 |
| [`27-controlled-drugs`](27-controlled-drugs/spec.md) | 50 | 39 | 8 | 3 |
| [`28-cold-chain`](28-cold-chain/spec.md) | 50 | 34 | 12 | 4 |
| [`29-finance`](29-finance/spec.md) | 0 | 0 | 0 | 0 |
| [`30-reporting`](30-reporting/spec.md) | 0 | 0 | 0 | 0 |
| [`31-analytics`](31-analytics/spec.md) | 50 | 45 | 3 | 2 |
| [`32-forecasting`](32-forecasting/spec.md) | 0 | 0 | 0 | 0 |
| [`33-ai`](33-ai/spec.md) | 0 | 0 | 0 | 0 |
| [`34-notifications`](34-notifications/spec.md) | 0 | 0 | 0 | 0 |
| [`35-integrations`](35-integrations/spec.md) | 50 | 39 | 9 | 2 |
| [`36-fhir`](36-fhir/spec.md) | 0 | 0 | 0 | 0 |
| [`37-gs1`](37-gs1/spec.md) | 0 | 0 | 0 | 0 |
| [`38-api`](38-api/spec.md) | 0 | 0 | 0 | 0 |
| [`39-mobile-pwa`](39-mobile-pwa/spec.md) | 0 | 0 | 0 | 0 |
| [`40-offline`](40-offline/spec.md) | 0 | 0 | 0 | 0 |
| [`41-localization`](41-localization/spec.md) | 0 | 0 | 0 | 0 |
| [`42-security`](42-security/spec.md) | 50 | 41 | 6 | 3 |
| [`43-audit`](43-audit/spec.md) | 0 | 0 | 0 | 0 |
| [`44-workflows`](44-workflows/spec.md) | 0 | 0 | 0 | 0 |
| [`45-admin`](45-admin/spec.md) | 0 | 0 | 0 | 0 |
| [`46-performance`](46-performance/spec.md) | 0 | 0 | 0 | 0 |
| [`47-backup-dr`](47-backup-dr/spec.md) | 0 | 0 | 0 | 0 |
| [`48-observability`](48-observability/spec.md) | 0 | 0 | 0 | 0 |
| [`49-testing`](49-testing/spec.md) | 0 | 0 | 0 | 0 |
| [`50-deployment`](50-deployment/spec.md) | 0 | 0 | 0 | 0 |

1000 of 1,000 requirements are filed against a domain folder; the remainder
sit in folders whose names differ from the matrix entry and are reachable
through `specs/TRACEABILITY_MATRIX.md`, which is the authority.
