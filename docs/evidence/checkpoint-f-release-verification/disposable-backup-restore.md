# Checkpoint F — disposable backup and restore

## Result: NOT EXECUTED

No production backup or restore was run — correctly, since the mission forbids
it. The **disposable** cycle (stage cross-domain transactions, back up, validate
manifest and hashes, restore into a second isolated location, re-run migrations
and integrity checks, compare record counts and source links, execute reads
after restore, confirm sessions and secrets are not copied insecurely, confirm
audit lineage) was **not** performed.

**No backup/restore proof is claimed.**

## What is known without executing it

- `scripts/backup-db.mjs` exists, and the migration runner accepts a
  `backupDir`. Every disposable `freshInstall()` in the Checkpoint F suites
  passed one and completed without error, so the backup directory path is at
  least exercised.
- `POST /api/backup`, `GET /api/backups`, `POST /api/restore`,
  `GET /api/backup/verify` and `GET`/`POST /api/restore/dry-run` are implemented
  in `server.js`.
- A previously recorded behaviour — `/api/backup/verify` fails on a stale
  auto-backup by design and needs a fresh `POST /api/backup` first — was **not**
  re-verified here.
- 24 `database.backup.*.json` files sit in the repository root, the newest from
  the current day, indicating the scheduler's backup path runs in practice.
  Their integrity and manifests were **not** validated.

## Why it was not done

Checkpoint F prioritised the findings that decide the classification: canonical
authority coverage, the legacy-writer gap, atomicity, idempotency and
cross-domain integrity. Backup/restore is a required release gate and remains
outstanding.

Recorded in [unresolved-risks.md](unresolved-risks.md) and
[MAIN_MERGE_READINESS.md](MAIN_MERGE_READINESS.md).
