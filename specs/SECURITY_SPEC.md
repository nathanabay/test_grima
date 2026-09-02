# Security specification

The posture, the controls, and the things that are deliberately not done.

## Authentication

- Passwords are hashed with Argon2id. No plaintext password is stored, logged,
  or written to an audit payload — ever.
- Access tokens are JWTs with a 15-minute lifetime. Refresh tokens are stored
  hashed, are revocable per session, and a logout revokes the session rather
  than trusting the client to forget.
- The password policy (`security.passwordMinLength`, complexity, history) is
  enforced on **change and on reset**. Reset was the path that had no policy at
  all until an audit of the settings catalogue found it.
- Lockout after `security.maxLoginAttempts` for `security.lockoutMinutes`.
- MFA is TOTP, enrolled and confirmed in two steps so a half-enrolled secret
  cannot lock somebody out.

## Authorization

Three independent checks, described in `specs/ARCHITECTURE.md`: authentication,
permission, scope. All three are server-side. The client uses the permission
catalogue only to decide what to render.

There is no frontend-only RBAC anywhere in this system. Hiding a button is a
courtesy to the reader, never a control.

`specs/API_CONTRACTS.md` lists every route that declares no permission, so a
route nobody decided about is visible rather than buried. Routes appear on that
list legitimately when the required permission depends on the path — importing
products versus suppliers, a product timeline versus a patient timeline — and
those enforce inside the service.

## Multi-tenancy and data separation

- Branch and warehouse scope is applied inside the query, never as a filter over
  results already read.
- A user with no scope rows is organisation-wide, checked explicitly rather than
  inferred from an empty list.
- Cross-company and cross-branch reads are prevented at the query, so a
  guessed id returns nothing rather than somebody else's row.

## Direct object references

Every read of a specific record either carries a scope filter or asserts scope
before returning. The patient endpoints additionally restrict clinical fields by
role: a cashier who legitimately holds `sales.patient.READ` receives a patient
record with `allergies` and `notes` removed by the server, not hidden by the
screen.

## Input handling

- Every request body passes a global `ValidationPipe` with `whitelist: true`.
- Write endpoints that accept a whole entity use an explicit allow-list of
  writable fields. Passing a request body straight to Prisma is mass assignment;
  it let a client write the computed supplier KPI fields and the patient
  anonymisation markers until both were fixed.
- All database access is through Prisma's parameterised query builder. The few
  raw queries are `$queryRaw` tagged templates, which parameterise; no string
  concatenation reaches SQL.
- No `dangerouslySetInnerHTML` anywhere in the web application.

## File upload

Imports accept CSV only, checked by extension and content type, with a size
limit. Files are parsed, never executed, and are stored under a generated
identifier rather than a client-supplied filename, so a name like
`../../etc/passwd` cannot escape the directory.

## Secrets and logging

- Secrets come from the environment. `.env.example` documents every variable;
  no secret is committed.
- API keys are stored hashed. The plaintext key is shown once at creation and
  never retrievable afterwards.
- Never logged: passwords, API secrets, access or refresh tokens, and patient
  data beyond the identifier needed to trace a record.
- The global exception filter returns a message and a status. It never returns a
  stack trace, a SQL string, an internal file path, or a driver error to the
  client.

## Rate limiting and abuse

Login is throttled per identifier and per address. The end-to-end suites trip it
when run back to back, which is the control working rather than a defect — the
browser verification counts the 429s it caused and says so, rather than filing
them as page defects.

## Audit

Hash-chained, append-only, verifiable through `GET /admin/audit-logs/verify`.
Application code never updates or deletes an audit row. Reading a patient record
is itself an audited event, from whichever screen it was read.

## Transport and headers

`helmet` sets the security headers. CORS is restricted to the configured
`WEB_ORIGIN` — a variable that was missing from `.env.example` until a
deployment would have hit CORS with nothing pointing at why.

## What the system will not do

- Never fake a successful external transaction. No payment, no regulatory
  submission, and no clinical result is ever simulated.
- Never present generated pharmaceutical, clinical or IoT data as real.
- Never let an automated rule approve a purchase, modify a controlled-drug
  record, dispose of medicine, release quarantined stock, or activate a recall.
- Never erase production data, reset users, or reset passwords as part of a
  deployment.

## Known limits

- MFA is TOTP only; no WebAuthn.
- No field-level encryption at rest beyond what the database provides. Patient
  identity is removable through anonymisation rather than encrypted in place.
- Rate limiting is per instance. A multi-instance deployment needs a shared
  store for the throttle to be global.
- Session revocation is immediate for refresh, but an access token remains valid
  until it expires — at most 15 minutes.
