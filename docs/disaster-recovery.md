# Disaster recovery runbook

For the pharmacist or administrator on shift. Written to be followed under
pressure, so each procedure states what to check before acting and what "done"
looks like.

## What is backed up, and what is not

| Data | Covered by | Notes |
| --- | --- | --- |
| Database (all 78 tables) | `BackupService`, nightly 01:30 | AES-256-GCM encrypted |
| Uploaded documents | **Not covered** | `apps/api/uploads` — back this volume up separately |
| Application code | Git | Rebuild from the image or the repository |

The document store is deliberately outside the database backup — it holds
licences, certificates and scanned prescriptions that can be large, and copying
them into every nightly dump would make restores slower without making them
safer. **Back up the `uploads` volume with your normal file backup.**

## Before you start: is the backup usable?

A backup you have not verified is a hope, not a plan.

```bash
curl -s -X POST http://localhost:4000/api/admin/backups/<id>/verify \
  -H "Authorization: Bearer $TOKEN"
```

Verification decrypts the file end to end. AES-GCM authenticates as it goes, so
a truncated, corrupted or tampered file fails here rather than part-way through
a restore. **A failed verification means take a fresh backup and investigate —
do not attempt a restore with it.**

The Administration → Backups screen shows the same thing, plus a health state:

- `OK` — a verified backup completed within 48 hours
- `STALE` — the last success is over 48 hours old
- `LAST_RUN_FAILED` — a backup failed after the last success
- `NO_BACKUP` — nothing has ever succeeded

## Restoring

Restore is **not** exposed over HTTP. Overwriting a live pharmaceutical database
from a web request is not a button worth having: it is done at the console, with
the service stopped, by someone who has decided that is the right call.

### 1. Stop the API

```bash
docker compose stop api        # or: systemctl stop pharmacore-api
```

Stopping matters. A running instance holding open transactions will fight the
restore and can leave the ledger half-written.

### 2. Decrypt the backup

```bash
curl -s -X POST http://localhost:4000/api/admin/backups/<id>/decrypt \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"targetPath":"/tmp/restore.sql"}'
```

If the API is already down, decrypt directly — the file layout is
`MAGIC(8) | salt(16) | iv(12) | authTag(16) | ciphertext`, AES-256-GCM with a
scrypt-derived key over `BACKUP_ENCRYPTION_KEY`.

> **Keep `BACKUP_ENCRYPTION_KEY` somewhere other than the server it protects.**
> Losing it makes every backup permanently unreadable. It is not recoverable.

### 3. Restore into a NEW database first

Never restore over the live database on the first attempt. Prove the dump is
good in a scratch database, then swap.

```bash
createdb pharmacore_restore
psql -d pharmacore_restore -f /tmp/restore.sql

# Sanity-check before trusting it
psql -d pharmacore_restore -c "SELECT count(*) FROM inventory_transactions;"
psql -d pharmacore_restore -c "SELECT max(sequence) FROM audit_logs;"
```

### 4. Verify integrity before going live

Point the API at the restored database and run both checks:

```bash
# Every cached balance matches a replay of the ledger
curl -s "$API/inventory/ledger/integrity" -H "Authorization: Bearer $TOKEN"

# The audit hash chain has not been broken
curl -s "$API/admin/audit-logs/verify" -H "Authorization: Bearer $TOKEN"
```

`mismatches: []` and `valid: true` mean the restore is sound. **A mismatch means
stop** — investigate before letting anyone dispense against it, because the
balances and the ledger disagree about how much stock exists.

### 5. Cut over

```bash
psql -c "ALTER DATABASE pharmacore RENAME TO pharmacore_broken_$(date +%Y%m%d);"
psql -c "ALTER DATABASE pharmacore_restore RENAME TO pharmacore;"
docker compose start api
```

Keep the broken database. It is evidence, and it may hold transactions the
backup predates.

## Recovering transactions written after the backup

A restore loses everything since the backup ran. Before declaring recovery
complete, work out what that window contains:

1. Compare `max(sequence)` in `audit_logs` between the broken and restored
   databases. The gap is what was lost.
2. If the broken database is readable, the audit trail names every dispense,
   sale, receipt and adjustment in the window — these must be re-entered by
   hand, not replayed automatically.
3. Reconcile physical stock for anything affected before dispensing resumes. A
   restored balance that does not match the shelf will oversell.

Controlled medicines need particular care: the register is append-only with a
running balance, so re-entered corrections must be **new entries**, never edits.

## Targets

| Measure | Target | What sets it |
| --- | --- | --- |
| RPO (data loss) | ≤ 24 hours | Nightly backup at 01:30 |
| RTO (time to restore) | ≤ 2 hours | Decrypt, restore, verify, cut over |

To reduce RPO, run backups more often — `@Cron('30 1 * * *')` in
`backup.service.ts` — or enable PostgreSQL WAL archiving for point-in-time
recovery, which the application-level backup does not provide.

## Routine checks

**Weekly:** confirm the Backups screen shows `OK`, and verify the most recent
backup. **Monthly:** run a full restore into a scratch database and confirm both
integrity checks pass. A restore procedure that has never been rehearsed is a
procedure that does not work.

**Quarterly:** confirm `BACKUP_ENCRYPTION_KEY` is still recoverable from wherever
it is stored, by someone other than the person who set it.
