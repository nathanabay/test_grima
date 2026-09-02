# Installation, migration and deployment

## Requirements

Node 20+, pnpm, PostgreSQL 16.

## First install

```bash
pnpm install
createdb pharmacore
cp .env.example .env                      # set DATABASE_URL and the JWT secrets
pnpm --filter @pharmacore/api prisma migrate deploy
pnpm db:seed                              # development only — see the warning below
pnpm build
```

`pnpm dev` runs both apps in watch mode: API on :4000, web on :3000. OpenAPI is
at http://localhost:4000/api/docs.

### The seed is for development only

`pnpm db:seed` **truncates every table** before writing demo data. It must never
be run against a database that carries real records. It exists so a fresh
checkout has something to look at, and it is two steps:

1. `prisma/seed.ts` writes the demo organization, catalogue, stock and history.
2. `src/scripts/finalize-demo.ts` then posts the ledger, raises warehouse work
   and runs the automation rules **through the real services** — so what the
   demo shows is what the code produces, not rows written to look right.

## Migrations

Schema changes are forward-only migrations; none of them drops or rewrites
existing data.

```bash
# Generate a migration from a schema change (needs an interactive terminal)
pnpm --filter @pharmacore/api prisma migrate dev --name what_changed

# Non-interactively, e.g. in CI or a container
pnpm --filter @pharmacore/api prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma --script > migration.sql

# Apply pending migrations to any environment
pnpm --filter @pharmacore/api prisma migrate deploy
```

Two rules when writing one by hand:

- **A new `NOT NULL` column on a populated table needs a default**, or the
  migration fails on the first real row.
- **Never drop a column that holds history.** Deprecate it, stop writing to it,
  and remove it in a later release once nothing reads it.

`GET /api/admin/health` reports any migration that started and did not finish.

## Deployment

```bash
pnpm build                                        # both apps
node apps/api/dist/src/main.js                    # API
pnpm --filter @pharmacore/web start               # web
```

Behind a process manager or in a container, set `NODE_ENV=production`,
`WEB_ORIGIN` to the browser-facing origin (CORS is restricted to it), and real
values for both JWT secrets. Helmet security headers are on by default.

### Health endpoints

| Endpoint | Purpose | Auth |
| --- | --- | --- |
| `GET /api/health` | Liveness for a load balancer | public |
| `GET /api/health/ready` | Readiness — is the database reachable | public |
| `GET /api/admin/health` | Full dependency picture | `admin.setting.READ` |

Every check does real work: a query, a `statfs` of the disk, a read of the
delivery queue, a look at the sensor table. Nothing reports healthy because a
variable is set. A dependency that is simply not configured reports
`NOT_CONFIGURED` and does **not** drag the overall state down — an unconfigured
SMS provider is a deployment choice, not an outage.

### Background jobs

The scheduler runs in the API process. `GET /api/admin/jobs` shows every
registered job with the outcome of its last run, and a job can be run on demand
from **Administration → System health & jobs**. A job that silently stopped
running is visible rather than assumed healthy, because every attempt writes a
`job_runs` row before and after.

If you run more than one API instance, run the scheduler on exactly one of them
— otherwise two instances will both drain the webhook queue and both post to the
ledger. Posting is idempotent per source document and webhook delivery is
retried rather than duplicated, so a double run is not corrupting, but it is
wasted work.

### Scaling notes

Analytics caching is in-process. A multi-instance deployment wants Redis behind
the same `CacheService` interface. **Nothing touching stock is ever cached** —
those reads go to the ledger under a lock.

## Backup and restore

Backups are encrypted (`BACKUP_ENCRYPTION_KEY`), verified and pruned on a
schedule, and system health reports a stale or failed one. Restoring is an
operator procedure at the console: see
[disaster-recovery.md](disaster-recovery.md).
