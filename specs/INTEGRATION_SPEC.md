# Integration specification

What this system talks to, how, and where it stops.

## The rule about credentials

When an integration's credentials are absent, the interface, the adapter, the
settings, the validation and the documented environment variables are all built;
the live connection is disabled; and the health check reports it as not
configured.

Nothing is ever simulated. A payment that was never taken must never appear to
have been taken, and a regulatory submission that was never made must never show
as submitted. `specs/KNOWN_EXTERNAL_DEPENDENCIES.md` lists every boundary of
this kind and the exact technical action that would close it.

## Outbound: webhooks

Endpoints are registered per event type with a shared secret. Deliveries are
queued and drained by a job every minute, with retry and backoff; each attempt
is recorded with its status and response so a failing endpoint is visible rather
than silently dropping events. Payloads are signed so a receiver can verify
origin.

## Inbound: API keys

Machine callers authenticate with an API key, stored hashed. The plaintext is
shown once at creation and never retrievable. Keys carry their own permission
set and can be revoked without touching a user account.

## FHIR

A read-only FHIR R4 surface for `Patient` and `MedicationDispense`, for a
hospital information system that needs to see what a pharmacy dispensed.

Errors are returned as a bare `OperationOutcome` with
`application/fhir+json` — not wrapped in this application's own error envelope,
because a conformant client reading `.issue` would find nothing there.

## GS1 and barcodes

GS1 DataMatrix element strings are parsed for GTIN (01), batch (10), expiry (17)
and serial (21). Batch and expiry are trusted **only** when the code was a
genuine GS1 element string; a plain QR or Code 128 is never treated as
pharmaceutical identification, and the scan result says so in as many words.

GTIN matching tries every equivalent representation — the padded 14-digit form
and the shorter GTIN-13, -12 and -8 forms — but only when the digits being
dropped are zeros. A GTIN-14 with a non-zero indicator digit identifies a case,
which is a different trade item from the inner pack, and conflating them would
put the wrong quantity into stock.

## IoT: cold-chain sensors

`POST /cold-chain/readings` ingests a reading. A reading outside the configured
range opens an excursion; a breach lasting longer than the sensor's tolerance
quarantines the affected stock automatically and requires a QA decision. The
system never declares temperature-exposed medicine safe on its own.

Ingestion is behind `feature.iotIngestion`. With no sensor hardware connected,
the endpoint exists and is authenticated; it simply has nothing sending to it.

Every reading is reported alongside the calibration status of the instrument
that took it. A sensor past its certificate is still read — blinding the cold
room would be worse — but it is labelled everywhere it appears, because a QA
release resting on an uncertified instrument is a release resting on nothing.

## Email, SMS and push

Adapters exist behind `EMAIL_API_URL` and the push configuration, with the
notification service degrading to in-app delivery when they are absent. A
notification that could not be sent is recorded as not sent.

## Payments

No payment gateway is connected. Card, mobile-money and bank-transfer payments
therefore require the reference from the terminal or transfer that took them:
this system cannot confirm a settlement it did not make, so it records the
human-verified reference instead of asserting a capture it cannot prove.

## Accounting export

The general ledger is internal. Journals, the trial balance and the account
mapping health check are all queryable, so an export to an external accounting
package is a report away rather than an integration away.

## API versioning

Every route is served twice: unversioned under `/api`, and under `/api/v1`. An
existing client keeps working while a new integration pins a version. A future
`v2` is added per controller with `@Version('2')`; `v1` stays until it is
deliberately retired.
