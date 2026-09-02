# Configuration

Two layers, deliberately separated.

## Environment variables

Secrets and deployment facts. They live in one `.env` at the repository root;
every package finds it by walking up from its own directory, so packages can be
run from anywhere. Copy `.env.example` and fill it in — it is the authoritative
list, annotated.

| Group | Variables | Effect if unset |
| --- | --- | --- |
| Database | `DATABASE_URL` | The API will not start. |
| API | `API_PORT`, `NODE_ENV`, `WEB_ORIGIN` | Defaults to 4000, development, `http://localhost:3000`. |
| Auth | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `MFA_ISSUER`, `PASSWORD_MIN_LENGTH`, `MAX_LOGIN_ATTEMPTS`, `LOCKOUT_MINUTES` | The secrets have no safe default; set them before any deployment. |
| Web | `NEXT_PUBLIC_API_URL` | The browser cannot reach the API. |
| Email | `EMAIL_API_URL`, `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_DEFAULT_RECIPIENT` | Channel disabled; notifications recorded as undelivered with the reason. |
| SMS | `SMS_PROVIDER_URL`, `SMS_API_KEY`, `SMS_SENDER_ID`, `SMS_DEFAULT_RECIPIENT` | As above. |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | As above. |
| WhatsApp | `WHATSAPP_API_URL`, `WHATSAPP_TOKEN`, `WHATSAPP_TO` | As above. |
| Web push | `PUSH_API_URL`, `PUSH_API_KEY` | As above. |
| Payments | `PAYMENT_PROVIDER_URL`, `PAYMENT_API_KEY` | Card and mobile-money capture disabled at the till; cash unaffected. |
| Backups | `BACKUP_ENCRYPTION_KEY`, `BACKUP_DIR`, `BACKUP_RETENTION_DAYS`, `PG_DUMP_PATH` | No backup is taken, and system health reports it rather than staying quiet. |
| Storage | `UPLOAD_DIR` | Defaults to `uploads`. |

**Nothing fakes a successful external call.** A channel with no credentials
records the notification as undelivered with the missing variable named. It
never reports a delivery that did not happen, and it never rolls back the
business operation — the medicine was still dispensed even if the SMS was not.

## Settings and feature flags

Operational rules a pharmacy changes without a deployment. They are declared in
`apps/api/src/common/config/settings.catalog.ts` with a type, a default, bounds
and an explanation, and edited at **Administration → System configuration**
(`admin.setting.EDIT`).

Resolution order: **database override → environment variable → catalogue
default**. A value outside its declared bounds or outside its option list is
refused with the reason; nothing is silently clamped. Every change is audited
with both the old and the new value.

Groups: expiry, stock, procurement, dispensing, cold chain, counts, finance,
security, notifications, warehouse, automation, localisation and compliance.

### Feature flags

A flag may declare a `requires` environment variable. **A flag whose dependency
is missing stays off however it is set**, and the screen says which variable is
missing instead of pretending the feature can be turned on.

### Settings that are not enforced yet

A setting that changes nothing is worse than a missing one: the screen agrees
with the administrator and the system ignores them. So each definition can carry
a `notEnforced` note, the configuration screen shows **Not enforced** beside it
with the reason, and a test (`apps/api/test/settings-enforced.spec.ts`) fails if
a key is declared with no call site and no such note — or if a marked key is
later wired without clearing the marker.

At the time of writing 21 of 64 keys carry that note, mostly because they
duplicate a mechanism that already works elsewhere (approval amounts live on
each workflow step; escalation timing lives on each automation rule's ladder) or
because they configure something not yet built (password expiry, session idle
timeout, MFA by role, retention, the Ethiopian calendar renderer). The screen
names each one.

### The rule behind the catalogue

If a number decides something a pharmacy might reasonably want to change — an
expiry horizon, an approval threshold, a discount ceiling, a temperature
tolerance, a count variance limit — it belongs here, not in a constant. What
does *not* belong here is anything clinical or regulatory that the system would
have to invent: jurisdiction-specific rules are exposed as configuration under
`compliance.*` with defaults that are operational starting points, not legal
advice.

## Localisation

`localisation.*` settings carry currency, timezone, date format and the
calendar. The interface ships English, Amharic and Afaan Oromo; live translation
coverage is shown in Administration. All timestamps are stored in UTC and
rendered in the configured timezone — nothing is stored in local time.
