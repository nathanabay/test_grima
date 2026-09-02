# Integrations

Screen: **Administration → Integrations** (`admin.setting.READ` / `.EDIT`).

## API keys

Machine callers present `X-Api-Key` instead of a bearer token. The key resolves
into the same `AuthenticatedUser` shape a person gets, so **every downstream
permission and scope check is identical** — an integration can never reach
something no role could.

- A key carries explicit scopes, validated against the permission catalogue.
- **You cannot grant a permission you do not hold yourself.** An integration is
  never a route to escalate privilege.
- A key with no scopes is refused; it could do nothing anyway.
- The key is `pck_<prefix>.<secret>`, shown **once** and stored only as a
  SHA-256 hash. It is never returned again, never written to the audit log, and
  cannot be recovered — only replaced.
- Optional expiry and per-minute rate limit. Revoking takes effect immediately,
  and the row is kept so its history stays readable.

## Outbound webhooks

Register an endpoint against one or more events. The signing secret is returned
**once**; verify the `X-PharmaCore-Signature` HMAC header with it.

Events: `stock.received`, `stock.dispensed`, `stock.sold`, `stock.adjusted`,
`stock.transferred`, `batch.quarantined`, `batch.released`, `recall.activated`,
`expiry.warning`, `coldchain.excursion`, `purchase_order.approved`,
`invoice.matched`, `quality.incident`, `automation.rule_matched`.

Delivery is queued and drained by the `webhooks.deliver` job every minute, with
exponential backoff. Every attempt is recorded with its response status and
error. An endpoint that keeps failing is reported `DEGRADED`; suspending one
stops delivery without deleting its history. A delivery failure never rolls back
business data.

## FHIR R4

Base path `/api/fhir`, declared version **4.0.1**, capability statement at
`/api/fhir/metadata` (public).

| Resource | Operations |
| --- | --- |
| `Patient` | read, search, create |
| `Practitioner` | search |
| `Organization` | search |
| `Medication` | read, search |
| `MedicationRequest` | read, create |
| `MedicationDispense` | read |

Details that matter for conformance:

- The mapping layer is decoupled from the core tables, so a FHIR change is not a
  schema change.
- R4 spellings throughout — `form`, `itemCodeableConcept`, a flat
  `medicationReference`. Advertising 4.0.1 and emitting R5 field names would
  break every conformant client.
- **A field with no source is omitted, never invented.** Nothing clinical is
  fabricated to fill a slot.
- Errors return a bare `OperationOutcome` with `application/fhir+json`, not
  wrapped in this application's error envelope, and each issue names the problem
  and the element it is about.
- Idempotency keys stop a retried create from writing the record twice.
- Every exchange is logged — direction, resource, status, issues — and
  `/api/fhir/_log/health` reports the rejection rate per resource type.
- Authorisation is the same as for a person: reading a `Patient` needs
  `sales.patient.READ`.

## Notification channels

Email, SMS, Telegram, WhatsApp and web push each make a **real HTTP call** to
their provider and record what actually happened.

A channel whose environment variables are unset is disabled, and its
notifications are recorded as undelivered **with the missing variable named**. A
delivery that did not happen is never reported as sent, and a failed delivery
never rolls back the business operation — the medicine was still dispensed even
if the SMS did not go out.

See [configuration.md](configuration.md) for the variables each channel needs.
